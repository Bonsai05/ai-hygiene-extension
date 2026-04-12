# Contributing to AI Hygiene Companion

Thank you for your interest in contributing! This document explains how to get involved, what we expect from contributors, and how to submit your work.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Project Structure](#project-structure)
- [Contribution Guidelines](#contribution-guidelines)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Reporting Bugs](#reporting-bugs)
- [Requesting Features](#requesting-features)

---

## Code of Conduct

By participating in this project, you agree to maintain a respectful and constructive environment. Harassment, discrimination, or hostile behaviour of any kind will not be tolerated.

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 18.0.0
- **npm** ≥ 9
- A Chromium-based browser (Chrome 116+)
- Git

### Local Setup

```bash
# 1. Fork the repository on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/ai-hygiene-extension.git
cd ai-hygiene-extension

# 2. Install dependencies
npm install

# 3. Start the Vite development watcher
npm run dev

# 4. Load in Chrome
# Navigate to chrome://extensions → Enable Developer mode → Load unpacked → select /dist
```

---

## Development Workflow

### Commands

| Command | Description |
|---|---|
| `npm run dev` | Start the Vite watcher with hot rebuild |
| `npm run build` | Build the production bundle into `/dist` |
| `npm test` | Run all Vitest unit tests in watch mode |
| `npm run test:run` | Run all tests once (for CI) |
| `npm run lint` | Run ESLint across all TypeScript files |

### Making Changes

1. **Always work on a feature branch.**  
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Keep each branch focused** — one feature or bugfix per PR.

3. **Run tests and lint** before committing:
   ```bash
   npm run test:run && npm run lint
   ```

4. **Rebuild** after every significant change to verify the extension loads correctly:
   ```bash
   npm run build
   ```

---

## Project Structure

Understanding where things live before you contribute:

```
src/
├── background.ts        # MV3 Service Worker — message routing, XP orchestration, ML dispatch
├── content-script.ts    # Injected into every page — DOM scanning for phishing signals
├── offscreen.ts         # Isolated WebWorker — Transformers.js ML inference
├── lib/
│   ├── constants.ts     # All magic numbers: XP values, level thresholds, badge IDs
│   ├── gamification.ts  # Pure XP/badge logic — no side effects, fully testable
│   ├── storage.ts       # chrome.storage wrapper with promise-based mutex
│   ├── risk-detection.ts# Heuristic URL scorer
│   ├── analysis-strategy.ts  # Domain caching and shouldAnalyze decisions
│   ├── notifications.ts # chrome.notifications wrapper
│   └── whitelist.ts     # Trusted domain list
└── popup/
    ├── Popup.tsx        # Root popup dashboard
    ├── pages/
    │   ├── Settings.tsx # Settings panel
    │   └── Onboarding.tsx
    └── components/      # Reusable UI elements
```

---

## Contribution Guidelines

### Critical Rules

These rules exist to prevent race conditions and data corruption in the extension:

1. **All XP state changes must go through `updateStats()`** in `src/lib/storage.ts`.  
   Never call `saveStats()` directly from business logic. The mutex ensures concurrent XP awards serialize correctly.

   ```typescript
   // ✅ Correct
   await updateStats(async (before) => {
     const after = await awardSafeBrowsingXp(before);
     return after;
   });

   // ❌ Wrong — bypasses mutex
   const stats = await loadStats();
   const updated = await awardSafeBrowsingXp(stats);
   await saveStats(updated);
   ```

2. **`background.ts` must not contain DOM logic.**  
   The Service Worker has no DOM access. All DOM operations must live in `content-script.ts` or the offscreen document.

3. **`content-script.ts` cannot import from `src/lib/`.**  
   Content scripts run in the page context and cannot share module scope with the background worker. Keep content script logic self-contained.

4. **All ML inference must run in `offscreen.ts`.**  
   Service Workers cannot use WebAssembly or WebGPU. Never call Transformers.js from `background.ts`.

5. **Do not add external network calls** outside of the HuggingFace model hub fetch in `offscreen.ts` and the optional localhost daemon endpoint. The extension must function without any internet dependency during inference.

### Code Style

- All new files must be **TypeScript** — no plain `.js` files in `src/`
- Follow the existing **ESLint configuration** (`npm run lint`)
- Use `async/await` over raw Promise chains
- Name constants in `SCREAMING_SNAKE_CASE` and add them to `src/lib/constants.ts`

### Testing

All gamification logic in `src/lib/gamification.ts` and `src/lib/risk-detection.ts` must have unit tests in the corresponding `.test.ts` file. Tests use Vitest + jsdom.

```bash
# Run specific test file
npx vitest run src/lib/gamification.test.ts
```

---

## Submitting a Pull Request

1. Push your branch to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```

2. Open a Pull Request against the `main` branch of this repository.

3. Fill in the PR template (title, what changed, how to test).

4. Your PR will be reviewed. Please respond to feedback within a reasonable time.

5. Once approved, a maintainer will merge it.

### PR Title Format

Use [Conventional Commits](https://www.conventionalcommits.org/) style:

```
feat: add dark pattern detection for countdown timers
fix: resolve XP double-award on YouTube navigation
docs: update architecture diagram for dual-layer pipeline
refactor: extract toast cooldown to separate helper
test: add unit tests for onPasswordFieldHttp
```

---

## Reporting Bugs

Open a [GitHub Issue](https://github.com/your-org/ai-hygiene-extension/issues/new) with:

- **Browser version** (e.g., Chrome 124)
- **Extension version** (found in `package.json`)
- **Steps to reproduce**
- **Expected behaviour**
- **Actual behaviour**
- **Console errors** (from `chrome://extensions` → Errors, or DevTools of the popup)

---

## Requesting Features

Open a GitHub Issue tagged `enhancement` with:

- **Problem statement** — what limitation or gap you are addressing
- **Proposed solution** — how you'd like it to work
- **Alternatives considered**
- Whether you are willing to implement it yourself
