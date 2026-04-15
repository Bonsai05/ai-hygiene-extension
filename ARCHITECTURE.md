# Architecture

This document is the definitive technical reference for the AI Hygiene Companion's internal architecture. It covers the Chrome Manifest V3 constraints, the dual-layer AI pipeline, message passing, state management, and gamification engine.

---

## Table of Contents

- [Overview](#overview)
- [Manifest V3 Constraints](#manifest-v3-constraints)
- [System Topology](#system-topology)
- [Layer 1 — Lightweight ML Engine](#layer-1--lightweight-ml-engine-zero-config)
- [Layer 2 — Heavyweight NPU Engine](#layer-2--heavyweight-npu-engine-opt-in)
- [Message Passing Protocol](#message-passing-protocol)
- [State Management & Mutex](#state-management--mutex)
- [XP & Gamification Pipeline](#xp--gamification-pipeline)
- [Content Script & DOM Scanning](#content-script--dom-scanning)
- [Risk Scoring](#risk-scoring)
- [Data Flow Diagram](#data-flow-diagram)

---

## Overview

The extension is built around a **split-compute** philosophy: fast, zero-config local inference handles the common case (the vast majority of URLs are safe), while an opt-in local NPU daemon handles deep de-obfuscation tasks that cannot be solved by lightweight encoders.

All analysis is on-device. No browsing data leaves the machine.

Current startup flow:

1. Service worker creates/ensures offscreen document.
2. Offscreen runtime initializes Transformers.js WASM with extension-local ORT assets.
3. Lightweight models download sequentially and publish progress/status events.
4. Popup/Settings render live model lifecycle (`idle/downloading/ready/failed`).
5. Risk decisions use fused scoring (heuristics + model confidence) with strict thresholds to avoid random flags.

---

## Manifest V3 Constraints

Chrome's Manifest V3 introduces three constraints that shape the entire architecture:

| Constraint | Impact | Solution |
|---|---|---|
| **No persistent background pages** | Service Worker (`background.ts`) is ephemeral — it can be killed at any time | All state is persisted to `chrome.storage` immediately; session-scoped state uses `chrome.storage.session` |
| **No WebAssembly in Service Workers** | ML inference with Transformers.js (ONNX/WASM) is impossible in `background.ts` | Moved to an **Offscreen Document** (`offscreen.ts`) which has full DOM and WASM access |
| **No `URL.createObjectURL` in SW** | Dynamic Blob/SVG icons crash the background script | Extension uses static PNG icon paths via `chrome.action.setIcon`; badge colour communicates risk state |

---

## System Topology

```
 Browser Process
 ┌──────────────────────────────────────────────────────────────────┐
 │                                                                  │
 │  ┌─────────────────┐  pageScanResult   ┌──────────────────────┐ │
 │  │ content-script  │ ────────────────► │  background.ts       │ │
 │  │ (every tab)     │                   │  (MV3 Service Worker) │ │
 │  │                 │ ◄──────────────── │                      │ │
 │  │ DOM scraper     │  injectBanner     │  Message router      │ │
 │  └─────────────────┘                   │  XP orchestrator     │ │
 │                                        │  Domain cache        │ │
 │  ┌─────────────────┐  analyzeUrl msg   │  State mutex         │ │
 │  │ offscreen.ts    │ ◄──────────────── │                      │ │
 │  │ (hidden page)   │  ML result        └──────────┬───────────┘ │
 │  │                 │ ────────────────►            │             │
 │  │ Transformers.js │                              │ chrome.storage │
 │  │ ONNX / WASM     │              ┌───────────────▼───────────┐ │
 │  └─────────────────┘              │  Popup (React)            │ │
 │                                   │  Dashboard / Settings     │ │
 │                                   └───────────────────────────┘ │
 └──────────────────────────────────────────────────────────────────┘
                              │ optional (localhost only)
                              ▼
             ┌─────────────────────────────────┐
             │  Local NPU Daemon               │
             │  Lemonade / GAIA / LM Studio    │
             │  AMD Ryzen™ AI NPU (XDNA)       │
             │  Llama 3.2 · DeepSeek-R1 Distill│
             └─────────────────────────────────┘
```

---

## Layer 1 — Lightweight Detection Engine (Default)

### Model

Primary path uses backend lightweight models started by the native host (`api/main.py`), with offscreen Transformers as fallback when backend is unavailable.

- **Input:** URL and/or page text
- **Output:** `{ level, score, patterns, provider }`
- **Latency:** backend health starts immediately; model readiness updates as models load

### Execution Environment

- **Primary:** Local FastAPI backend started via Native Messaging host
- **Fallback:** Offscreen document (`src/offscreen.ts`) for in-browser inference

### Inference Pipeline

`background.ts` tries backend first (`/analyze/url`) and falls back to offscreen inference only if backend is unavailable.

### Model Caching

Backend and offscreen layers both keep local model caches; no remote inference API is used.

### Domain-Level Analysis Caching

To avoid redundant ML inference, `background.ts` tracks which domains have been analyzed this session in `chrome.storage.session` under `mlAnalyzedDomains`. The model runs once per domain per session. XP awarding is separate and runs per URL.

---

## Layer 2 — Heavyweight NPU Engine (Opt-In)

When the user enables "Heavyweight Local NPU Daemon" in Settings, the extension routes high-complexity requests to a locally running LLM server.

### Supported Runtimes

| Runtime | URL | Models |
|---|---|---|
| AMD GAIA | `http://127.0.0.1:8000` | Llama 3.2 (1B/3B), DeepSeek-R1 Distill |
| Lemonade Server | `http://127.0.0.1:11434` | Llama 3.2, Qwen 2.5 Coder |
| LM Studio | `http://127.0.0.1:1234` | Any OpenAI-compatible model |

### Security Constraint

The backend URL is validated to only accept `127.0.0.1` or `localhost` origins. No external API endpoints are allowed. This is enforced in `Settings.tsx` and `background.ts`.

### Request Format

```
POST /analyze/url
Content-Type: application/json

{ "url": "https://susp1cious-site.tk/login" }
```

### Response Format

```json
{
  "phishing_score": 0.92,
  "provider": "Llama 3.2 (XDNA NPU)",
  "reasoning": "..."
}
```

---

## Message Passing Protocol

All cross-context communication uses `chrome.runtime.sendMessage`. The full message catalogue:

| Type | Direction | Payload | Response |
|---|---|---|---|
| `analyzeUrl` | SW → Offscreen | `{ url }` | `{ level, score, modelVersion }` |
| `initML` | SW → Offscreen | — | `{ ok, model }` |
| `pageScanResult` | Content → SW | `{ url, signals }` | `{ received }` |
| `getRiskLevel` | Popup → SW | — | `{ level }` |
| `getStats` | Popup → SW | — | `{ stats }` |
| `getDashboardData` | Popup → SW | — | `{ stats, riskLevel, levelTitle, xpProgress }` |
| `riskUpdate` | SW → Popup | `{ level }` | — |
| `xpGain` | SW → Popup | `{ xpAmount, reason, totalXp, level, levelTitle, xpProgress }` | — |
| `xpLoss` | SW → Popup | `{ xpAmount, reason, ... }` | — |
| `levelUp` | SW → Popup | `{ level, levelTitle }` | — |
| `mlRiskResult` | SW → Popup | `{ level, mlScore, modelVersion }` | — |
| `dismissWarning` | Content → SW | — | — |
| `panicInitiated` | Popup → SW | — | `{ stats }` |
| `recoveryCompleted` | Popup → SW | — | `{ stats }` |
| `getSettings` | Popup → SW | — | `{ backend, notifications }` |
| `saveSettings` | Popup → SW | `{ backend, notifications }` | `{ success }` |

---

## State Management & Mutex

All persistent state lives in `chrome.storage.local`. Session-scoped state (XP deduplication, ML domain cache, toast cooldown) lives in `chrome.storage.session` which clears when the browser closes.

### The Stats Mutex

Because a Service Worker can receive multiple concurrent messages (e.g., `pageScanResult` arriving while `analyzeAndAward` is already running), the `updateStats()` function in `src/lib/storage.ts` implements a **promise chain mutex**:

```typescript
let statsLockResult: Promise<UserStats> = Promise.resolve({} as UserStats);

export async function updateStats(
  updater: (stats: UserStats) => UserStats | Promise<UserStats>
): Promise<UserStats> {
  statsLockResult = statsLockResult.then(async () => {
    const current = await loadStats();
    const updated = await updater(current);
    await saveStats(updated);
    return updated;
  });
  return statsLockResult;
}
```

Every write is chained onto the previous one. Concurrent callers queue up and execute in order, each reading the result of the previous write. This prevents XP double-award races.

**Critical rule:** All XP and badge mutations must go through `updateStats()`. Never call `saveStats()` directly.

---

## XP & Gamification Pipeline

See [GAMIFICATION.md](./GAMIFICATION.md) for the full gamification reference.

### Flow for a safe page navigation

```
tabs.onUpdated (URL changed)
  └── analyzeAndAward(url, tabId)
        ├── getCachedAnalysis(url)     — in-memory domain cache
        │     └── [hit] Award XP if URL not yet in xpAwardedUrls
        │           └── updateStats(awardSafeBrowsingXp)
        │                 └── chrome.storage.local write (mutex-protected)
        │
        └── [miss] shouldAnalyzeUrl(url)
              ├── [skip] chrome://, localhost, etc. → return
              └── [analyze]
                    ├── analyzeUrl(url)           — heuristic scorer
                    ├── analyzeUrlWithOffscreenML  — Transformers.js
                    ├── markDomainAnalyzed()      — cache result
                    ├── Award XP (if URL not in xpAwardedUrls)
                    └── injectWarningBanner()     — if danger/warning
```

---

## Content Script & DOM Scanning

`src/content-script.ts` runs on every HTTP/HTTPS page load. It scans the DOM for signals that corroborate or contradict the URL-level risk score:

| Signal | Detection Method |
|---|---|
| `hasPasswordField` | `input[type='password']` present |
| `hasLoginForm` | `<form>` element present |
| `formActionExternal` | Form `action` attribute points outside current origin |
| `hasEmailField` | `input[type='email']` or `input[name='email']` present |
| `suspiciousPhrases` | Body text contains phishing language (e.g., "verify your account") |
| `hasIframeEmbed` | `<iframe>` elements present |
| `missingSecurityIndicators` | Password field exists but page is HTTP (not HTTPS) |

These signals are sent to the Service Worker via `pageScanResult`, where `contentRiskFromSignals()` combines them with the URL analysis to produce a final risk level.

---

## Risk Scoring

`src/lib/risk-detection.ts` implements a **weighted score** system:

| Pattern | Weight | Category |
|---|---|---|
| Typosquatting (e.g. `g00gle.com`) | 65 | Critical |
| Password on HTTP | 65 | Critical |
| Data URI | 65 | Critical |
| `@` in URL | 65 | Critical |
| IP address as hostname | 65 | High |
| External form action | 30 | High |
| 3+ urgent phrases | 30 | High |
| HTTP protocol | 20 | Medium |
| Suspicious TLD (`.tk`, `.xyz`, etc.) | 20 | Medium |
| Excessive subdomains (4+) | 20 | Medium |
| Redirect parameter | 15 | Medium |
| Unusually long URL | 10 | Low |
| Brand keyword in path | 10 | Low |

**Thresholds:**
- Score ≥ 65 → `danger`
- Score ≥ 35 → `warning`
- Score < 35 → `safe`

A single Critical-weight signal immediately produces a `danger` result.
