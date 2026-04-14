<div align="center">

# 🛡️ AI Hygiene Companion

**A production-grade Chrome Extension for real-time, on-device protection against phishing, trackers, and social engineering — powered by a mandatory FastAPI backend running 7 ML models via DirectML/NPU, a two-tier inference pipeline, and a gamified "Safe-to-Earn" reward system.**

[![Build](https://img.shields.io/github/actions/workflow/status/your-org/ai-hygiene-extension/ci.yml?style=flat-square)](https://github.com/your-org/ai-hygiene-extension/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.2-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/)
[![Transformers.js](https://img.shields.io/badge/HuggingFace-Transformers.js-FFD21E?style=flat-square&logo=huggingface&logoColor=black)](https://huggingface.co/docs/transformer[Features](#-features) · [Architecture](ARCHITECTURE.md) · [Gamification](GAMIFICATION.md) · [Tech Stack](#-tech-stack) · [Installation](#-installation) · [Usage](#-usage) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [License](#-license)

</div>

---

## Overview

Traditional browser security tools rely on static blocklists and cloud-based heuristics — both of which lag behind the rapid mutation rate of modern phishing campaigns and trackers. The **AI Hygiene Companion v2.0** runs entirely on-device using a mandatory local FastAPI backend that continuously runs 7 ONNX/PyTorch ML models (ScamLLM, BERT phishing, PII detection, spam) via DirectML hardware acceleration. A full generative LLM (Qwen, Gemma, DeepSeek) can be optionally loaded from Settings. Zero browsing data ever leaves the machine.

---

## ✨ Features

| Feature | Description |
|---|---|
| **7-Model ML Ensemble** | ScamLLM, BERT phishing (×2), PII detection, URL phishing, email phishing, spam — weighted vote ensemble running on the local FastAPI server |
| **NPU / DirectML Acceleration** | ONNX Runtime + DirectML runs models on AMD/Intel/NVIDIA GPUs and NPUs (XDNA) — visible in Task Manager as real hardware load |
| **Auto-Start Backend** | Native Messaging bridge (`host.py`) auto-starts the FastAPI server in a visible terminal on extension load — a live hardware monitor is shown |
| **Heavy LLM Toggle** | Settings page downloads and loads a generative LLM (Qwen 2.5, DeepSeek R1, Phi-4, Gemma 4) on demand for deep threat reasoning |
| **Zero False Positives** | Banners are only injected when ML confirms a threat (score ≥ 35) or absolute URL danger signals are present (typosquatting, IP host, data URI) |
| **PII Real-Time Monitor** | Content script monitors form inputs and sends text to `/analyze/pii` for live entity detection |
| **Safe-to-Earn Gamification** | Earn XP and badges for safe behaviour; receive penalties for bypassing threat warnings — all enforced via a mutex-locked state engine |
| **Privacy First** | All inference runs locally — no browsing data, URLs, or page content is ever sent to an external server |

---

## 🏗 Architecture

The extension is built around a **mandatory local FastAPI backend** — the primary ML engine — which runs 7 lightweight models continuously. A generative LLM is available as an opt-in Tier 2 layer.

```
 Browser Process
 ┌──────────────────────────────────────────────────────────────────────┐
 │  ┌─────────────────┐  pageScanResult    ┌──────────────────────────┐ │
 │  │ content-script  │ ─────────────────► │  background.ts (SW)      │ │
 │  │ DOM scraper     │                    │  Message router          │ │
 │  │ PII monitor     │ ◄─────────────────  │  Native Messaging client │ │
 │  └─────────────────┘  injectBanner      └──────────┬───────────────┘ │
 │                                                     │ Native Messaging │
 │  ┌─────────────────┐                    ┌──────────▼───────────────┐ │
 │  │ host.py bridge  │ ◄─────────────────  │  Popup / Settings (React)│ │
 │  │ Spawns FastAPI  │                    └──────────────────────────┘ │
 │  └────────┬────────┘                                                  │
 └───────────│──────────────────────────────────────────────────────────┘
             ▼
  ┌────────────────────────────────────────────────────────┐
  │  FastAPI Backend  http://127.0.0.1:8000                │
  │                                                        │
  │  Tier 1 (always-on): 7 Lightweight Models (ONNX RT)    │
  │    url_phishing · scam_llm · bert_phishing · pii ·     │
  │    bert_phishing_v2 · email_phishing · spam            │
  │    Hardware: DirectML → CUDA → CPU                     │
  │                                                        │
  │  Tier 2 (on-demand): Heavy Generative LLM              │
  │    Qwen 2.5 · DeepSeek R1 · Phi-4 · Gemma 4           │
  └────────────────────────────────────────────────────────┘
```

For the full technical breakdown see **[ARCHITECTURE.md](ARCHITECTURE.md)**. Zero data leaves the device at inference time.

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
| **Language** | TypeScript 5.2 (extension) + Python 3.10+ (backend) |
| **UI Framework** | React 18 |
| **Build Tool** | Vite 5 + `@crxjs/vite-plugin` |
| **Backend** | FastAPI + Uvicorn |
| **ML Runtime** | ONNX Runtime + DirectML (Tier 1), PyTorch CPU (ScamLLM), HuggingFace Transformers (Tier 2) |
| **ML Format** | ONNX (DirectML / CUDA / CPU) + PyTorch `.pt` |
| **Backend Lifecycle** | Chrome Native Messaging (`host.py`) — auto-start, visible terminal |
| **Styling** | Tailwind CSS 3, Radix UI primitives |
| **State Management** | `chrome.storage.local` + promise-based Mutex |
| **Testing** | Vitest + jsdom |
| **Linting** | ESLint + TypeScript ESLint |

---

## 📦 Installation

### Prerequisites

- **Node.js** ≥ 18.0.0 and **npm** ≥ 9
- **Python** ≥ 3.10 (for the local backend)
- A Chromium-based browser (Chrome 116+)
- Windows (for DirectML / Native Messaging; macOS/Linux planned)

### Step 1 — Clone & Build the Extension

```bash
git clone https://github.com/your-org/ai-hygiene-extension.git
cd ai-hygiene-extension
npm install
npm run build
```

The compiled extension is placed in the `dist/` directory.

### Step 2 — Load as an Unpacked Extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `dist/` folder
4. Note your **Extension ID** (shown on the extensions card)

### Step 3 — Set Up the Backend (**Required**)

```bat
cd api
setup.bat
```

The script will:
1. Check Python and install pip dependencies (`fastapi`, `onnxruntime-directml`, `transformers`, etc.)
2. Prompt you to enter your Extension ID
3. Register the Native Messaging host in the Windows Registry
4. Reload the extension — the backend auto-starts every time the extension loads

> The 7 lightweight models (~400 MB total) are downloaded from HuggingFace on first run and cached locally.

### Development Mode (Hot Reload)

```bash
npm run dev
```

Vite watches for file changes and rebuilds automatically. Reload the extension after each rebuild.

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

- **Backend Status** — shows model loading progress (modelsReady / modelsTotal)
- **Heavy Model** — select and download a generative LLM (Qwen 2.5, DeepSeek R1, Phi-4, Gemma 4) for deep threat reasoning
- **Notifications** — toggle XP awards, threat alerts, and PII warnings

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
├── api/                         # Local FastAPI backend (mandatory)
│   ├── main.py                  # FastAPI server — 7 lightweight models + heavy LLM
│   ├── host.py                  # Native Messaging bridge (Chrome → FastAPI)
│   ├── com.ai_hygiene.json      # Native Messaging host manifest
│   ├── setup.bat                # One-time Windows setup and Registry registration
│   └── requirements.txt         # Python deps (fastapi, onnxruntime-directml, ...)
├── src/
│   ├── lib/                     # Core business logic
│   │   ├── constants.ts         # XP rewards, risk patterns, default settings
│   │   ├── gamification.ts      # XP calculation and badge award functions
│   │   ├── model-registry.ts    # Model status types (used by background + Settings)
│   │   ├── notifications.ts     # Browser notification helpers
│   │   ├── risk-detection.ts    # Heuristic URL and content risk scoring
│   │   ├── storage.ts           # chrome.storage wrapper with mutex locking
│   │   └── whitelist.ts         # Trusted domain allowlist
│   ├── popup/
│   │   ├── components/          # Reusable UI components (XPBar, BadgeGrid, etc.)
│   │   ├── pages/
│   │   │   ├── Onboarding.tsx   # First-run onboarding flow
│   │   │   └── Settings.tsx     # Backend status, model table, heavy LLM toggle
│   │   └── Popup.tsx            # Root popup (backend status banner, XP bar)
│   ├── background.ts            # MV3 Service Worker — Native Messaging + ensemble API
│   ├── content-script.ts        # Page-injected DOM + PII scanner
│   └── offscreen.ts             # Dead fallback Transformers.js worker (not primary path)
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

- [**phishbot**](https://huggingface.co/phishbot) — for the `ScamLLM` (RoBERTa-based scam/social engineering classifier)
- [**ealvaradob**](https://huggingface.co/ealvaradob) — for `phishing-url-detection` and `bert-base-uncased-ft-phishing-urls`
- [**ONNX Community**](https://huggingface.co/onnx-community) — for `bert-finetuned-phishing-ONNX` and quantised model distributions
- [**gravitee-io**](https://huggingface.co/gravitee-io) — for `bert-small-pii-detection`
- [**cybersectony**](https://huggingface.co/cybersectony) — for `phishing-email-detection-distilbert`
- [**mrm8488**](https://huggingface.co/mrm8488) — for `bert-tiny-finetuned-sms-spam-detection`
- [**Hugging Face**](https://huggingface.co/) — for the Transformers Python library and ONNX export pipeline
- [**Microsoft**](https://github.com/microsoft/onnxruntime) — for ONNX Runtime and the DirectML execution provider

---


<div align="center">
  <sub>Built with ❤️ by the AI Hygiene Companion OSS Collective</sub>
</div>
