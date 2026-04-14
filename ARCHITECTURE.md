# Architecture

This document is the definitive technical reference for the AI Hygiene Companion v2.0 internal architecture. It covers the Chrome Manifest V3 constraints, the mandatory FastAPI backend, the two-tier ML pipeline, Native Messaging lifecycle, message passing, state management, and the gamification engine.

---

## Table of Contents

- [Overview](#overview)
- [Manifest V3 Constraints](#manifest-v3-constraints)
- [System Topology](#system-topology)
- [Layer 1 — Always-On FastAPI Backend](#layer-1--always-on-fastapi-backend-mandatory)
- [Layer 2 — Heavy Generative LLM (Opt-In)](#layer-2--heavy-generative-llm-opt-in)
- [Native Messaging Bridge](#native-messaging-bridge)
- [Message Passing Protocol](#message-passing-protocol)
- [State Management & Mutex](#state-management--mutex)
- [XP & Gamification Pipeline](#xp--gamification-pipeline)
- [Content Script & DOM Scanning](#content-script--dom-scanning)
- [Risk Scoring](#risk-scoring)
- [Banner Injection Policy (False Positive Prevention)](#banner-injection-policy)

---

## Overview

Starting v2.0, the extension uses a **mandatory local FastAPI backend** as its primary ML engine. The backend runs 7 lightweight models continuously using ONNX Runtime + DirectML (for NPU/GPU acceleration). All analysis is on-device — no browsing data ever leaves the machine.

### Key design decisions

| Decision | Rationale |
|---|---|
| **FastAPI backend is mandatory** | ScamLLM (RoBERTa) and other models require PyTorch, which cannot run in a browser environment |
| **Native Messaging auto-start** | `host.py` is registered with Chrome Native Messaging so the backend launches automatically when the extension loads — no manual setup per session |
| **Offscreen retained as dead fallback** | `offscreen.ts` (Transformers.js) is retained but no longer the primary inference path. It is only present for future use |
| **Banner requires ML or hard heuristic** | To prevent false positives, warning banners are only injected when the ML ensemble confirms a threat OR the URL contains absolute danger signals (typosquatting, IP host, data URI) |

---

## Manifest V3 Constraints

| Constraint | Impact | Solution |
|---|---|---|
| **No persistent background pages** | Service Worker (`background.ts`) is ephemeral | All state persisted to `chrome.storage.local`; session state uses `chrome.storage.session` |
| **No WebAssembly in Service Workers** | ONNX/WASM inference impossible in `background.ts` | Moved to local **FastAPI backend** (primary) and **Offscreen Document** (dead fallback) |
| **No `URL.createObjectURL` in SW** | Dynamic Blob/SVG icons crash the background | Static PNG icons; badge colour communicates risk state |
| **Native Messaging required** | Extension cannot spawn processes directly | `host.py` registered as Native Messaging host; spawns FastAPI in a visible terminal |

---

## System Topology

```
 Browser Process
 ┌──────────────────────────────────────────────────────────────────────┐
 │  ┌─────────────────┐  pageScanResult    ┌──────────────────────────┐ │
 │  │ content-script  │ ─────────────────► │  background.ts           │ │
 │  │ (every tab)     │                    │  (MV3 Service Worker)    │ │
 │  │                 │ ◄─────────────────  │                          │ │
 │  │ DOM scraper     │  injectBanner       │  Message router          │ │
 │  │ PII monitor     │                    │  XP orchestrator         │ │
 │  └─────────────────┘                    │  Domain cache (30s TTL)  │ │
 │                                         │  Native Messaging client │ │
 │  ┌─────────────────┐  Native Messaging  │                          │ │
 │  │ host.py         │ ◄─────────────────  │  connectNativeHost()     │ │
 │  │ (stdio bridge)  │                    └──────────┬───────────────┘ │
 │  │ Spawns FastAPI  │                               │                  │
 │  └────────┬────────┘                    ┌──────────▼───────────────┐ │
 │           │                             │  Popup (React)           │ │
 │           ▼                             │  Dashboard / Settings    │ │
 │  ┌────────────────────────────────┐     └──────────────────────────┘ │
 │  │  FastAPI Backend (port 8000)   │                                   │
 │  │  7 Lightweight Models (ONNX)   │                                   │
 │  │  DirectML / CUDA / CPU         │                                   │
 │  │  + Heavy LLM (on-demand)       │                                   │
 │  └────────────────────────────────┘                                   │
 └──────────────────────────────────────────────────────────────────────┘
```

---

## Layer 1 — Always-On FastAPI Backend (Mandatory)

### Models (7 lightweight, always loaded)

| Key | Model ID | Size | Execution |
|---|---|---|---|
| `url_phishing` | `ealvaradob/phishing-url-detection` | 30 MB | ONNX + DirectML |
| `scam_llm` | `phishbot/ScamLLM` | 66 MB | PyTorch CPU |
| `bert_phishing` | `onnx-community/bert-finetuned-phishing-ONNX` | 68 MB | ONNX + DirectML |
| `pii_detection` | `gravitee-io/bert-small-pii-detection` | 45 MB | ONNX + DirectML |
| `bert_phishing_v2` | `ealvaradob/bert-base-uncased-ft-phishing-urls` | 110 MB | ONNX + DirectML |
| `email_phishing` | `cybersectony/phishing-email-detection-distilbert` | 65 MB | ONNX + DirectML |
| `spam_detection` | `mrm8488/bert-tiny-finetuned-sms-spam-detection` | 17 MB | ONNX + DirectML |

### Inference Endpoints

```
POST /analyze/ensemble  — All models, combined score + individual results
POST /analyze/url       — URL phishing model only (fast path)
POST /analyze/pii       — PII detection in page text
GET  /health            — Model status, hardware provider, heavy model state
POST /heavy/load        — Download + load heavy generative LLM
POST /heavy/unload      — Unload heavy LLM from memory
GET  /heavy/status      — Heavy model loading progress
```

### Hardware Acceleration

The backend uses ONNX Runtime with provider priority:

```python
providers = ["DmlExecutionProvider", "CUDAExecutionProvider", "CPUExecutionProvider"]
```

DirectML (`DmlExecutionProvider`) runs on AMD/Intel/NVIDIA GPUs and AMD NPUs (XDNA) via Windows DirectML API. The terminal window shows a live ASCII hardware monitor.

---

## Layer 2 — Heavy Generative LLM (Opt-In)

When the user enables the heavy model in Settings, the extension sends `loadHeavyModel` to `background.ts`, which calls `POST /heavy/load`. The backend downloads the model (~1–3 GB) from HuggingFace and loads it into memory.

### Supported Heavy Models

| Model | Size | Best For |
|---|---|---|
| `Qwen/Qwen2.5-1.5B-Instruct` | ~1 GB | Fast, recommended |
| `deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B` | ~1 GB | Chain-of-thought reasoning |
| `microsoft/Phi-4-mini-instruct` | ~2.5 GB | Edge device, low power |
| `google/gemma-4-it` | ~3 GB | High accuracy |

The heavy model runs on the same hardware as the lightweight models (DirectML / CUDA / CPU). It is unloaded via `POST /heavy/unload` when the user disables the toggle.

---

## Native Messaging Bridge

The backend lifecycle is managed entirely automatically via Chrome Native Messaging.

### Lifecycle

```
Extension loads
  └── chrome.runtime.onInstalled / onStartup
        └── ensureBackend()
              └── chrome.runtime.connectNative("com.ai_hygiene")
                    └── host.py (registered in Windows Registry)
                          └── Spawns: python main.py (in visible terminal window)
                                └── FastAPI starts on http://127.0.0.1:8000
                                      └── background.ts polls /health every 3s
                                            └── Broadcasts backendStatus to popup
```

### Setup (one-time)

1. Run `api/setup.bat`
2. Enter Extension ID when prompted
3. Registry key `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.ai_hygiene` is created
4. Reload extension — backend auto-starts on every browser session

### Status States

| State | Meaning |
|---|---|
| `starting` | Native host connected, waiting for FastAPI to bind |
| `ready` | `/health` returned 200 — models loading or loaded |
| `offline` | `/health` failed — heuristic-only mode active |
| `setup_required` | Native host binary not found — `setup.bat` not run yet |

---

## Message Passing Protocol

All cross-context communication uses `chrome.runtime.sendMessage`. Full message catalogue:

| Type | Direction | Payload | Response |
|---|---|---|---|
| `getDashboardData` | Popup → SW | — | `{ stats, riskLevel, backendStatus, modelsReady, modelsTotal, heavyModel, ... }` |
| `getBackendStatus` | Settings → SW | — | `{ status, provider, models, heavyModel }` |
| `getSettings` | Settings → SW | — | `{ backend, notifications }` |
| `saveSettings` | Settings → SW | `{ backend, notifications }` | `{ success }` |
| `loadHeavyModel` | Settings → SW | `{ modelId }` | `{ ok }` |
| `unloadHeavyModel` | Settings → SW | — | `{ ok }` |
| `pageScanResult` | Content → SW | `{ url, signals, trackers, pageText }` | `{ ok }` |
| `piiInputScan` | Content → SW | `{ text, fieldId, url }` | — |
| `domMutationScan` | Content → SW | `{ url, text }` | — |
| `riskyActionDetected` | Content → SW | `{ pageRiskLevel, action }` | `{ ok }` |
| `panicInitiated` | Popup → SW | — | `{ stats }` |
| `recoveryCompleted` | Popup → SW | — | `{ stats }` |
| `backendStatus` | SW → All | `{ status, provider, modelsReady, modelsTotal, models }` | — |
| `riskUpdate` | SW → Popup | `{ level }` | — |
| `xpGain` / `xpLoss` | SW → Popup | `{ xpAmount, reason, totalXp, level, xpProgress }` | — |
| `levelUp` | SW → Popup | `{ level, levelTitle }` | — |
| `mlRiskResult` | SW → Popup | `{ level, mlScore, modelVersion, threats }` | — |
| `threatUpdate` | SW → Popup | `{ threats, level }` | — |
| `piiDetected` | SW → Popup | `{ entities, confidence }` | — |
| `heavyModelStatus` | SW → Popup | `{ loaded, model_id, status, progress }` | — |

---

## State Management & Mutex

All persistent state lives in `chrome.storage.local`. Session state (XP deduplication, toast cooldown, danger tabs) lives in `chrome.storage.session`.

### The Stats Mutex

`updateStats()` in `src/lib/storage.ts` implements a **promise-chain mutex** to prevent XP race conditions:

```typescript
let statsLockResult: Promise<UserStats> = Promise.resolve({} as UserStats);

export async function updateStats(
  updater: (stats: UserStats) => UserStats | Promise<UserStats>
): Promise<{ stats: UserStats; newBadges: string[] }> {
  statsLockResult = statsLockResult.then(async () => {
    const current = await loadStats();
    return updater(current);
  });
  const updated = await statsLockResult;
  // ...badge detection, saveStats...
}
```

Every write is chained. Concurrent callers queue. **Never call `saveStats()` directly — always use `updateStats()`.**

---

## XP & Gamification Pipeline

See [GAMIFICATION.md](./GAMIFICATION.md) for the full reference.

```
tabs.onUpdated (URL changed)
  └── analyzeAndAward(url, tabId)
        ├── shouldSkipUrl(url)         — filter chrome://, localhost, etc.
        ├── analyzeUrl(url)            — heuristic scorer (instant)
        ├── domainCache.get(hostname)  — 30s in-memory cache
        │     └── [miss] queryBackendEnsemble(url, text)
        │                 └── POST /analyze/ensemble
        │                       └── 7 model votes → combined score
        ├── Combine heuristic + ML → finalLevel
        ├── saveRiskLevel(finalLevel)
        ├── setBadge(tabId, finalLevel)
        ├── [if banner conditions met] injectBanner(tabId, ...)
        └── [per-URL dedup] updateStats(applySafeBrowse | applyDanger)
```

---

## Content Script & DOM Scanning

`src/content-script.ts` runs on every `document_idle` and sends a `pageScanResult` to the service worker with:

| Signal | Detection |
|---|---|
| `hasPasswordField` | `input[type='password']` present |
| `hasLoginForm` | Form with password field |
| `formActionExternal` | Form `action` points outside current origin |
| `hasEmailField` | `input[type='email']` or `input[name='email']` |
| `suspiciousPhrases` | Body text contains phishing phrases |
| `hasIframeEmbed` | `<iframe>` + password field present |
| `missingSecurityIndicators` | Password field on HTTP page |
| `hasObfuscatedText` | `eval(atob(` or `eval(unescape(` pattern in inline scripts |

It also monitors form field input in real-time and sends `piiInputScan` messages for PII detection.

---

## Risk Scoring

### URL Heuristics (`risk-detection.ts`)

**Immediate danger (any single signal):**
- Typosquatting pattern (e.g. `g00gle.com`)
- Data URI scheme
- IP address as hostname
- `@` symbol in URL

**Warning (requires 2+ signals):**
- Suspicious TLD (`.tk`, `.xyz`, `.top`, etc.)
- HTTP protocol
- 4+ subdomains
- URL length > 200 chars
- Redirect parameter (`?redirect=`, `?url=`, etc.)

**Always safe (bypasses all checks):**
- Known brand domain (Google, Microsoft, GitHub, etc.)
- `localhost` / `127.0.0.1`

### ML Escalation

ML ensemble can only **escalate** risk, never downgrade a heuristic `danger`. Final level = `max(heuristic, ml)`.

---

## Banner Injection Policy

To prevent false positives, `injectBanner()` is only called when:

```
bannerConfirmedByMl = backendHealthy AND (
  (mlScore >= 70 AND level === "danger") OR
  (mlScore >= 35 AND level === "warning" AND heuristic.level === "warning")
)

bannerConfirmedByHeuristic = level === "danger" AND (
  patterns includes "typosquatting" OR "ip_address_hostname" OR
  "data_uri" OR "url_with_at_symbol"
)

injectBanner() ← bannerConfirmedByMl OR bannerConfirmedByHeuristic
```

A plain `http://` site with no other signals **never** triggers a banner.
