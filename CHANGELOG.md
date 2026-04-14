# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Dedicated **Scanner page** (`src/popup/pages/ScannerPage.tsx`) with staged AMD NPU-style simulation UI and scenario logs.
- Standalone model diagnostics surfaced in popup/settings when offscreen runtime or model load fails.
- Explicit offscreen message namespace (`offscreen.downloadModels`, `offscreen.getModelStatus`, `offscreen.dismissModelPrompt`) for model-control requests.

### Changed
- Runtime architecture now defaults to **standalone offscreen-only model flow**.
- Model registry updated to browser-compatible DistilBERT/BERT-NER baseline identifiers.
- Model load flow now applies timeout-based failure handling to prevent silent idle/stuck states.
- Docs aligned to standalone architecture and scanner UX.

### Fixed
- Fixed relay-loop risk in background model event forwarding by accepting model broadcasts only from offscreen sender.
- Fixed `TypeError: Cannot read properties of undefined (reading 'local')` in offscreen runtime with guarded storage wrappers.
- Fixed "Download / Retry Models" no-op path by surfacing request failures and wiring direct offscreen message routes.
- Reduced aggressive warning escalation by requiring strict ML confidence before upgrading safe pages.

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
