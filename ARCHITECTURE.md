# Architecture

This document is the technical reference for the AI Hygiene Companion's current standalone architecture. It covers MV3 constraints, the offscreen model runtime, message flow, scanner simulation page, state management, and gamification.

---

## Table of Contents

- [Overview](#overview)
- [Manifest V3 Constraints](#manifest-v3-constraints)
- [System Topology](#system-topology)
- [Layer 1 — Lightweight ML Engine](#layer-1--lightweight-detection-engine-default)
- [Layer 2 — Scanner Simulation](#layer-2--scanner-simulation-ui-debug)
- [Message Passing Protocol](#message-passing-protocol)
- [State Management & Mutex](#state-management--mutex)
- [XP & Gamification Pipeline](#xp--gamification-pipeline)
- [Content Script & DOM Scanning](#content-script--dom-scanning)
- [Risk Scoring](#risk-scoring)
- [Data Flow Diagram](#data-flow-diagram)

---

## Overview

The extension is built around a **standalone offscreen** philosophy: fast local inference handles URL/content/PII checks directly in-browser, while the scanner page provides deterministic staged simulation for product UX and debugging.

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

Primary path uses offscreen Transformers.js models loaded in `src/offscreen.ts`.

- **Input:** URL and/or page text
- **Output:** `{ level, score, urlScore, contentScore, modelVersion }`
- **Latency:** model readiness updates as sequential downloads complete

### Execution Environment

- **Primary:** Offscreen document (`src/offscreen.ts`) for in-browser inference
- **Runtime:** ONNX Runtime Web (WASM assets bundled into extension)

### Inference Pipeline

`background.ts` runs heuristics first, then offscreen model inference, and applies strict confidence thresholds before escalating to warning/danger.

### Model Caching

Model artifacts are downloaded/cached via Transformers.js browser cache; inference remains fully local after weights are available.

### Domain-Level Analysis Caching

To avoid redundant inference bursts, `background.ts` maintains a short-lived in-memory domain cache plus a per-tab inference queue/debounce.

---

## Layer 2 — Scanner Simulation (UI/Debug)

`src/popup/pages/ScannerPage.tsx` implements a deterministic simulator that mirrors an AMD NPU-style staged pipeline:

1. URL parse
2. Reddit scan
3. Quora scan
4. NPU infer
5. Score fuse

This page is currently simulation-driven (hardcoded scenarios) and is intentionally separate from runtime risk enforcement.

---

## Message Passing Protocol

All cross-context communication uses `chrome.runtime.sendMessage`. The full message catalogue:

| Type | Direction | Payload | Response |
|---|---|---|---|
| `offscreen.downloadModels` | SW → Offscreen | — | `{ ok, error? }` |
| `offscreen.getModelStatus` | SW → Offscreen | — | `{ statusMap }` |
| `offscreen.dismissModelPrompt` | SW → Offscreen | — | `{ ok }` |
| `analyzeUrl` | SW → Offscreen | `{ url }` | `{ level, score, modelVersion }` |
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
| `getModelStatus` | Popup → SW | — | `{ statusMap, error? }` |
| `downloadModels` | Popup → SW | — | `{ ok, error? }` |
| `getSettings` | Popup → SW | — | `{ backend, notifications }` |
| `saveSettings` | Popup → SW | `{ backend, notifications }` | `{ success }` |

---

## State Management & Mutex

All persistent state lives in `chrome.storage.local` when available. Session-scoped state (XP deduplication, danger tabs, toast cooldown) lives in `chrome.storage.session`.

Offscreen storage calls are guarded to prevent runtime crashes when `chrome.storage.local` is temporarily unavailable.

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
