# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Planned
- Visual badge showcase in the extension popup
- Export activity report as PDF
- macOS/Linux support for Native Messaging host

---

## [2.0.0] — 2026-04-15

### Breaking Changes
- **Backend is now mandatory.** Run `api/setup.bat` once to register the Native Messaging bridge. The extension will show a `setup_required` banner until this is done.
- `src/lib/daemon-manager.ts` (Ollama/LM Studio integration) removed — replaced by the built-in FastAPI backend.

### Added
- **Mandatory FastAPI backend** (`api/main.py`) — 7 lightweight ML models (ScamLLM, BERT phishing, PII detection, spam) running via ONNX Runtime + DirectML for NPU/GPU acceleration.
- **Native Messaging bridge** (`api/host.py`, `api/com.ai_hygiene.json`) — backend auto-starts in a visible terminal window when the extension loads, showing a live ASCII hardware utilization monitor.
- **One-time `setup.bat`** — installs Python deps, writes the Native Messaging manifest, registers the Windows Registry key, and prompts for Extension ID.
- **7-model ensemble endpoint** (`POST /analyze/ensemble`) — weighted vote across all 7 models, returning combined score, level, individual model scores, and PII scan result.
- **Heavy LLM download toggle** — Settings page allows downloading and loading a generative LLM (Qwen 2.5 1.5B, DeepSeek R1, Phi-4 Mini, Gemma 4) for deep threat reasoning. Includes real-time download progress bar.
- **Backend status banners** in Popup — colour-coded banners show `starting` (yellow), `setup_required` (red), `offline` (grey), and model loading progress.
- **PII real-time monitor** — content script monitors form field inputs and sends them to `POST /analyze/pii` for entity detection.
- **`/heavy/status` polling** — background.ts polls for heavy model loading progress and broadcasts `heavyModelStatus` events to Settings UI.

### Fixed
- **Critical — False positives:** Warning banners now require ML confirmation (score ≥ 35) or an absolute heuristic danger signal (typosquatting, IP host, data URI, `@` in URL). Plain `http://` sites without other signals are never flagged.
- **Critical — XP bar broken at level boundaries:** `Popup.tsx` switched from `xpInLevel()` to `xpProgressInLevel()` which correctly handles the boundary case where `xp === level × XP_PER_LEVEL`.
- **`getDashboardData` missing fields:** The response now includes `modelsReady` and `modelsTotal` so the Popup loading indicator works correctly on open.
- **`getModelStatus` backward compat:** Legacy handler preserved so older Settings code does not crash during transition.

### Changed
- `background.ts` — complete rewrite. Native Messaging replaces the old Ollama daemon. `queryBackendEnsemble()` replaces `analyzeUrlWithOffscreenML()`.
- `Settings.tsx` — complete rewrite with live backend model table, heavy LLM selector, progress bar, and offline setup guide card.
- `ARCHITECTURE.md` — rewritten to reflect v2.0 backend-first topology.
- `nativeMessaging` added to `manifest.json` permissions.

### Removed
- `src/lib/daemon-manager.ts` — Ollama/LM Studio/Lemonade integration (replaced by FastAPI backend)
- `src/lib/analysis-strategy.ts` — all functions were `@deprecated` and unused in production
- `src/popup/components/figma/` — Figma design artefacts directory
- `src/popup/components/ui/RiskStatus.tsx` — empty re-export stub
- `postcss.config.js` — duplicate of `postcss.config.mjs`
- `test-inline.mjs`, `test-inline2.mjs` — debug scratch scripts

---

## [1.1.0] — 2026-04-12

### Added
- **Per-URL XP awarding**: XP is now awarded for every unique URL navigation, not per domain. Scrolling through YouTube Shorts awards +5 XP for each new video.
- **Persistent XP cooldown**: XP cooldown state is now saved to `chrome.storage.session` and survives Service Worker restarts.
- **Shadow DOM warning banners**: Threat banners are now injected inside a `ShadowRoot` with `mode: "closed"`, making them tamper-proof against malicious page CSS and script.
- **Dismiss button on banners**: Users can dismiss threat warning banners without losing XP — only intentionally interacting with dangerous content causes penalties.
- **Separate ML analysis caching**: ML inference now runs once per domain per session. XP awarding runs independently for every new URL.
- **Toast cooldown**: Notification toasts are rate-limited to 3 seconds to prevent spam. XP accrual is unaffected.
- `CONTRIBUTING.md` — full contributor guide with mutex usage rules and PR standards.
- `SECURITY.md` — vulnerability disclosure policy and threat model.
- `GAMIFICATION.md` — complete reference for the XP, badge, and level systems.
- `ARCHITECTURE.md` — comprehensive technical architecture documentation.
- `LICENSE` — MIT license.
- `CHANGELOG.md` — this file.

### Fixed
- **Critical**: `URL.createObjectURL is not a function` crash in the Service Worker. MV3 Service Workers have no DOM API access. Dynamic SVG icon generation was replaced with static bundled PNG icon paths.
- **Critical**: `updateStats()` mutex was typed `Promise<void>` but cast as `Promise<UserStats>`, returning `undefined` to all callers. Re-typed correctly so callers receive fresh stats.
- **Critical**: XP was never awarded reliably because `canAwardXp()` stored its cooldown timestamp as a module-level variable. Service Workers restart constantly, resetting the variable to `0` on every wake, causing the first call to always pass. Replaced with `chrome.storage.session`-persisted cooldown.
- **Critical**: Danger XP penalty was gated behind the same rate limiter as safe browsing XP, meaning landing on a phishing site might not trigger a penalty. Danger penalties are now unconditional.
- `injectWarningBanner` silently failed on `chrome://` pages with an unhandled rejection. Now catches gracefully.
- Safe browsing XP was blocked for site revisits (YouTube, Google, etc.) due to the `wasRecentlyVisited` check applying to both ML analysis and XP awarding.

### Changed
- ML analysis backend now only triggers when `backendConfig.useLocalBackend` is `true`, preventing unwanted calls to `127.0.0.1` for users who have not configured a daemon.
- Settings panel redesigned to clearly separate "Lightweight Built-In Models" from "Heavyweight Local NPU Daemon".
- Removed dummy "Browser Extension Popup 🔌" footer button from the popup UI.

---

## [1.0.0] — 2026-04-12

### Added
- Initial architecture: MV3 Service Worker + Offscreen Document + Content Script pipeline.
- Heuristic URL risk scoring (`src/lib/risk-detection.ts`) covering typosquatting, IP hostnames, suspicious TLDs, excessive subdomains, redirect parameters, and brand keyword injection.
- Transformers.js offscreen ML inference using `pirocheto/phishing-url-detection`.
- Optional localhost FastAPI backend for AMD NPU-accelerated heavyweight models.
- Gamification engine: XP, 10 levels, 12 badges across 4 categories (streak, threat, recovery, habit).
- Panic Button with guided recovery flow.
- React popup dashboard with XP progress bar, badge grid, risk status, and quick tips.
- Settings panel with toggles for ML layers, backend URL, and notification preferences.
- Shadow DOM warning banner injection from content script signals.
- `chrome.storage.local` persistence with promise-based mutex for race-condition-free state updates.
- Unit test suite using Vitest + jsdom for gamification, risk detection, storage, whitelist, and analysis strategy logic.

[Unreleased]: https://github.com/your-org/ai-hygiene-extension/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/your-org/ai-hygiene-extension/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/your-org/ai-hygiene-extension/releases/tag/v1.0.0
