<div align="center">

# 🛡️ AI Hygiene Companion

**A production-grade Chrome Extension for real-time, on-device protection against phishing, trackers, and social engineering — powered by a Dual-Layer AI pipeline and a gamified "Safe-to-Earn" reward system.**

[![Build](https://img.shields.io/github/actions/workflow/status/your-org/ai-hygiene-extension/ci.yml?style=flat-square)](https://github.com/your-org/ai-hygiene-extension/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.2-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/)
[![Transformers.js](https://img.shields.io/badge/HuggingFace-Transformers.js-FFD21E?style=flat-square&logo=huggingface&logoColor=black)](https://huggingface.co/docs/transformer[Features](#-features) · [Architecture](ARCHITECTURE.md) · [Gamification](GAMIFICATION.md) · [Tech Stack](#-tech-stack) · [Installation](#-installation) · [Usage](#-usage) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [License](#-license)

</div>

---

## Overview

Traditional browser security tools rely on static blocklists and cloud-based heuristics — both of which lag behind the rapid mutation rate of modern phishing campaigns and trackers. The **AI Hygiene Companion** runs entirely on-device, combining a lightweight ONNX inference engine with an optional AMD NPU-accelerated heavyweight model to deliver real-time, privacy-preserving threat detection with zero external telemetry.

---

## ✨ Features

| Feature | Description |
|---|---|
| **Real-Time URL Analysis** | Detects phishing URLs using a locally executing ONNX model before the page fully renders |
| **DOM Content Scanning** | Content scripts continuously analyse page text for credential-harvesting language, fake urgency, and dark patterns |
| **Dual-Layer AI Pipeline** | Lightweight built-in WASM models for instant classification; opt-in heavyweight LLMs (Llama 3.2, DeepSeek R1) for deep de-obfuscation via a local NPU daemon |
| **Shadow DOM Warning Banners** | Threat alerts are injected inside a ShadowRoot, making them tamper-proof even on malicious pages |
| **Safe-to-Earn Gamification** | Earn XP and badges for safe behaviour; receive penalties for bypassing threat warnings — all enforced via a mutex-locked state engine |
| **Per-URL XP Awarding** | Every unique page navigation awards +5 XP — scrolling YouTube Shorts awards XP for each new video |
| **Privacy First** | All inference runs locally. No browsing data, URLs, or page content is ever sent to an external server |
| **Manifest V3 Compliant** | Built on ephemeral Service Workers and the Offscreen Document API in strict accordance with Chrome's MV3 spec |

---

## 🏗 Architecture

The extension is built around a **split-compute pipeline** that resolves the tension between real-time performance and deep analytical capability.

```
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                         Chrome Browser Sandbox                              │
 │                                                                             │
 │  ┌─────────────────┐    messages     ┌──────────────────────────────┐       │
 │  │  content-script  │ ─────────────► │   background.ts (SW)         │       │
 │  │  (DOM scraper)   │                │   Orchestrator + Mutex State  │       │
 │  └─────────────────┘                └──────────┬───────────────────┘       │
 │                                                │ routes to                  │
 │                                    ┌───────────▼───────────┐               │
 │                                    │   offscreen.ts         │               │
 │                                    │   Transformers.js +    │               │
 │                                    │   ONNX WebGPU/WASM     │               │
 │                                    └───────────────────────┘               │
 └─────────────────────────────────────────────────────────────────────────────┘
                                               │ optional localhost call
                                               ▼
                                  ┌─────────────────────────┐
                                  │  Local NPU Daemon        │
                                  │  (Lemonade / GAIA /      │
                                  │   LM Studio)             │
                                  │  Llama 3.2 · DeepSeek R1 │
                                  │  AMD Ryzen™ AI NPU       │
                                  └─────────────────────────┘
```

### Layer 1 — Lightweight Built-In Engine *(Zero Configuration)*

Runs entirely inside the browser via the [Offscreen Document API](https://developer.chrome.com/docs/extensions/reference/offscreen/), which provides access to WebAssembly and WebGPU without violating MV3 restrictions.

- **Model:** `pirocheto/phishing-url-detection` — a fast, ONNX-quantised model for lexical URL classification
- **Execution:** WebGPU (primary) → WASM SIMD (fallback)
- **Latency:** Sub-100ms URL classification before the page finishes loading
- **Privacy:** Model weights are fetched from HuggingFace and cached locally in IndexedDB. Zero data leaves the device at inference time.

### Layer 2 — Heavyweight NPU Engine *(Opt-In)*

For advanced tasks — de-obfuscating malicious JavaScript payloads, analysing multi-stage redirect chains, or generating plain-language threat explanations — the extension routes requests to a locally running LLM endpoint.

- **Supported Runtimes:** [AMD GAIA](https://github.com/amd/gaia), [Lemonade Server](https://www.amd.com/en/developer/resources/technical-articles/2025/ryzen-ai-radeon-llms-with-lemonade.html), or any OpenAI-compatible local API
- **Models:** `Llama 3.2 (1B/3B)`, `DeepSeek-R1 Distill`, `Qwen 2.5 Coder`
- **Hardware:** AMD Ryzen™ AI NPU via the XDNA architecture and Vitis AI Execution Provider
- **Communication:** Strictly bound to `localhost` — the extension never calls external LLM APIs

For the full technical breakdown see **[ARCHITECTURE.md](ARCHITECTURE.md)**.

---

## 🔧 Tech Stack

| Layer | Technology |
|---|---|
| **Language** | TypeScript 5.2 |
| **UI Framework** | React 18 |
| **Build Tool** | Vite 5 + `@crxjs/vite-plugin` |
| **ML Runtime** | `@huggingface/transformers` (Transformers.js v3) |
| **ML Format** | ONNX via WASM / WebGPU |
| **Styling** | Tailwind CSS 3, Radix UI primitives |
| **State Management** | `chrome.storage.local` + promise-based Mutex |
| **Testing** | Vitest + jsdom |
| **Linting** | ESLint + TypeScript ESLint |

---

## 📦 Installation

### Prerequisites

- **Node.js** ≥ 18.0.0 and **npm** ≥ 9
- A Chromium-based browser (Chrome 116+)
- *(Optional)* A local LLM daemon for NPU acceleration

### Clone & Build

```bash
# 1. Clone the repository
git clone https://github.com/your-org/ai-hygiene-extension.git
cd ai-hygiene-extension

# 2. Install dependencies
npm install

# 3. Build the extension
npm run build
```

The compiled extension is placed in the `dist/` directory.

### Load as an Unpacked Extension

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `dist/` folder from this repository

### Development Mode (Hot Reload)

```bash
npm run dev
```

Vite watches for file changes and rebuilds automatically. Reload the extension in `chrome://extensions` after each rebuild during development.

### Running Tests

```bash
# Run all tests in watch mode
npm test

# Single test run (for CI)
npm run test:run
```

---

## 🚀 Usage

Once installed, the extension operates automatically. No configuration is required.

### Dashboard

Click the **shield icon** in the Chrome toolbar to open the popup dashboard. It displays:

- Your current **XP** and **Level** (with title)
- A live **Risk Status** indicator for the active tab
- Earned **Badges** and unlock progress
- A **Panic Button** for guided recovery after a security incident

### Risk States

| State | Badge | Meaning |
|---|---|---|
| 🟢 **Safe** | ✓ | No threats detected on the current page |
| 🟡 **Warning** | ! | Suspicious signals present; proceed with caution |
| 🔴 **Danger** | ⚠️ | Active phishing or credential-harvesting threat detected |

A persistent warning **banner** is injected directly into the page via Shadow DOM whenever the extension enters `warning` or `danger` state. The banner includes a **Dismiss** button.

### Gamification & XP

> The extension rewards consistent safe browsing and penalises risky decisions to build lasting cybersecurity habits.

| Event | XP Change |
|---|---|
| Safe page visit (every unique URL) | +5 XP |
| Danger detected and avoided | +25 XP |
| Secure password field (HTTPS) | +10 XP |
| Dangerous site loaded | −15 XP |
| Panic recovery completed | +30 XP |
| Badge earned | +50 XP |

For the full badge catalogue and level titles see **[GAMIFICATION.md](GAMIFICATION.md)**.

### Settings

Click the **⚙ gear icon** in the dashboard to access Settings:

- **Lightweight Built-In Models** — toggle in-browser URL and content classification (enabled by default, zero config)
- **Heavyweight Local NPU Daemon** — configure a local daemon URL (`http://127.0.0.1:8000`) for AMD NPU-accelerated LLM analysis

---

## 📂 Folder Structure

```
ai-hygiene-extension/
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   └── feature_request.md
│   └── PULL_REQUEST_TEMPLATE.md
├── public/                      # Static assets (icons, manifest base)
├── src/
│   ├── lib/                     # Core business logic
│   │   ├── analysis-strategy.ts # Domain caching and analysis orchestration
│   │   ├── constants.ts         # XP rewards, badge definitions, default settings
│   │   ├── gamification.ts      # XP calculation and badge award functions
│   │   ├── notifications.ts     # Browser notification helpers
│   │   ├── risk-detection.ts    # Heuristic URL and content risk scoring
│   │   ├── storage.ts           # chrome.storage wrapper with mutex locking
│   │   └── whitelist.ts         # Trusted domain allowlist
│   ├── popup/
│   │   ├── components/          # Reusable UI components (XPBar, BadgeGrid, etc.)
│   │   ├── pages/
│   │   │   ├── Onboarding.tsx   # First-run onboarding flow
│   │   │   └── Settings.tsx     # Extension settings panel
│   │   └── Popup.tsx            # Root popup component
│   ├── background.ts            # MV3 Service Worker — message router and state orchestrator
│   ├── content-script.ts        # Page-injected DOM scanner
│   └── offscreen.ts             # Isolated Transformers.js inference worker
├── ARCHITECTURE.md              # Comprehensive technical architecture documentation
├── CHANGELOG.md                 # Version history
├── CONTRIBUTING.md              # Contributor guide and coding rules
├── GAMIFICATION.md              # XP, badge, and level system reference
├── LICENSE                      # MIT License
├── SECURITY.md                  # Vulnerability disclosure policy
├── package.json
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

---

## 🤝 Contributing

Contributions are welcome — whether it's improving the ML models, expanding the heuristic ruleset, or hardening the gamification logic.

Please read **[CONTRIBUTING.md](CONTRIBUTING.md)** for the full guide, including the critical mutex usage rules that prevent race conditions in the XP engine.

```bash
# Quick start for contributors
git checkout -b feature/your-feature-name
npm run test:run && npm run build
# Then open a Pull Request
```

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for full terms.

---

## 🙏 Credits

- [**pirocheto**](https://huggingface.co/pirocheto) — for the `phishing-url-detection` ONNX model
- [**ONNX Community**](https://huggingface.co/onnx-community) — for maintaining quantised, browser-ready model distributions
- [**Hugging Face**](https://huggingface.co/) — for Transformers.js, which makes in-browser ML inference possible
- [**AMD**](https://www.amd.com/en/developer/resources/ryzen-ai-software.html) — for the Ryzen™ AI / XDNA NPU architecture and the GAIA open-source framework
- The academic research documented in [`AI Hygiene Companion Chrome Extension.md`](AI%20Hygiene%20Companion%20Chrome%20Extension.md) that informed the dual-model threat detection strategy

---


<div align="center">
  <sub>Built with ❤️ by the AI Hygiene Companion OSS Collective</sub>
</div>
