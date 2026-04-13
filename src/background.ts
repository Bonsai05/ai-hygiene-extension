// src/background.ts
// Service worker — core orchestration.
//
// XP award rules:
//   • Every unique URL visit on a safe/warning page → +5 or +10 XP
//   • Landing on a danger page → -15 XP + streak reset (deduped per URL)
//   • Risky action (download / ext link) on risky page → -15 XP
//   • "Unique URL" is tracked in chrome.storage.session so it survives
//     across SW restarts but resets on browser restart.
//
// ML pipeline (optional):
//   • Backend (local FastAPI / Ollama) → Offscreen Transformers.js → Heuristics only

import {
  loadStats,
  saveStats,
  updateStats,
  loadRiskLevel,
  saveRiskLevel,
  saveRiskEvent,
  applySafeBrowse,
  applyDanger,
  applyRiskyAction,
  applyDangerAvoided,
  applySecureLogin,
  applyPasswordOnHttp,
  applyPanicInitiated,
  applyRecoveryCompleted,
  getLevelTitle,
  levelFromXp,
  xpInLevel,
  type UserStats,
  type RiskLevel,
} from "./lib/storage";

import { analyzeUrl, contentRiskFromSignals } from "./lib/risk-detection";
import { showBrowserNotification } from "./lib/notifications";
import { SKIP_PREFIXES, DEFAULT_BACKEND_URL, XP_PER_LEVEL, XP } from "./lib/constants";

// ---------------------------------------------------------------------------
// Session helpers (XP deduplication per URL)
// ---------------------------------------------------------------------------
const SESSION_XP_KEY = "xpAwardedUrls_v2";
const SESSION_DANGER_TABS_KEY = "dangerTabIds_v2";
const SW_LAST_TOAST = "sw_lastToast";
const TOAST_GAP = 4000; // ms between toasts

async function hasAwardedXpForUrl(url: string): Promise<boolean> {
  const r = await chrome.storage.session.get([SESSION_XP_KEY]);
  const awarded: string[] = r[SESSION_XP_KEY] ?? [];
  return awarded.includes(url);
}

async function markXpAwardedForUrl(url: string): Promise<void> {
  const r = await chrome.storage.session.get([SESSION_XP_KEY]);
  const awarded: string[] = r[SESSION_XP_KEY] ?? [];
  if (!awarded.includes(url)) {
    await chrome.storage.session.set({ [SESSION_XP_KEY]: [...awarded, url].slice(-500) });
  }
}

async function markTabAsDanger(tabId: number): Promise<void> {
  const r = await chrome.storage.session.get([SESSION_DANGER_TABS_KEY]);
  const tabs: number[] = r[SESSION_DANGER_TABS_KEY] ?? [];
  if (!tabs.includes(tabId)) {
    await chrome.storage.session.set({ [SESSION_DANGER_TABS_KEY]: [...tabs, tabId].slice(-100) });
  }
}

async function isTabDanger(tabId: number): Promise<boolean> {
  const r = await chrome.storage.session.get([SESSION_DANGER_TABS_KEY]);
  const tabs: number[] = r[SESSION_DANGER_TABS_KEY] ?? [];
  return tabs.includes(tabId);
}

async function unmarkTabDanger(tabId: number): Promise<void> {
  const r = await chrome.storage.session.get([SESSION_DANGER_TABS_KEY]);
  const tabs: number[] = r[SESSION_DANGER_TABS_KEY] ?? [];
  await chrome.storage.session.set({
    [SESSION_DANGER_TABS_KEY]: tabs.filter(id => id !== tabId),
  });
}

async function canShowToast(): Promise<boolean> {
  const r = await chrome.storage.session.get([SW_LAST_TOAST]);
  const last: number = r[SW_LAST_TOAST] ?? 0;
  if (Date.now() - last < TOAST_GAP) return false;
  await chrome.storage.session.set({ [SW_LAST_TOAST]: Date.now() });
  return true;
}

// ---------------------------------------------------------------------------
// URL filtering
// ---------------------------------------------------------------------------
function shouldSkipUrl(url: string): boolean {
  if (!url || !url.startsWith("http")) return true;
  return SKIP_PREFIXES.some(p => url.startsWith(p));
}

// ---------------------------------------------------------------------------
// Badge + toolbar updates
// ---------------------------------------------------------------------------
function setBadge(tabId: number, level: RiskLevel): void {
  chrome.action.setBadgeText({ text: level === "danger" ? "!" : level === "warning" ? "⚠" : "", tabId });
  chrome.action.setBadgeBackgroundColor({
    color: level === "danger" ? "#ef4444" : level === "warning" ? "#f59e0b" : "#22c55e",
    tabId,
  });
}

// ---------------------------------------------------------------------------
// Warning banner (Shadow DOM, tamper-proof)
// Uses plain-English messages for non-technical users.
// ---------------------------------------------------------------------------
function injectBanner(tabId: number, level: "warning" | "danger"): void {
  chrome.scripting.executeScript({
    target: { tabId },
    func: (riskLevel: string) => {
      const BANNER_ID = "ai-hygiene-banner-host";
      if (document.getElementById(BANNER_ID)) return;

      const host = document.createElement("div");
      host.id = BANNER_ID;
      Object.assign(host.style, {
        position: "fixed",
        top: "0",
        left: "0",
        width: "100%",
        zIndex: "2147483647",
        pointerEvents: "none",
      });
      document.documentElement.appendChild(host);
      const shadow = host.attachShadow({ mode: "closed" });

      const isDanger = riskLevel === "danger";
      const bg = isDanger ? "#dc2626" : "#d97706";
      // Plain-English messages for non-technical users
      const msg = isDanger
        ? "🚨 This looks like a fake website trying to steal your information. Close this tab now."
        : "⚠️ This website might be trying to steal your password. Don't type anything here.";

      shadow.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;
          background:${bg};color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
          font-size:13px;font-weight:700;padding:10px 16px;box-shadow:0 2px 8px rgba(0,0,0,.4);
          pointer-events:all;box-sizing:border-box;width:100%;">
          <span>${msg}</span>
          <button id="dismiss" style="background:rgba(255,255,255,.2);border:2px solid rgba(255,255,255,.6);
            color:#fff;font-size:12px;font-weight:700;padding:4px 12px;cursor:pointer;border-radius:4px;
            flex-shrink:0;margin-left:12px;">Dismiss</button>
        </div>`;

      shadow.getElementById("dismiss")?.addEventListener("click", () => {
        host.remove();
        try {
          (window as Window & { chrome?: typeof chrome }).chrome?.runtime?.sendMessage({ type: "dismissWarning" });
        } catch {}
      });
    },
    args: [level],
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Popup messaging
// ---------------------------------------------------------------------------
function broadcast(msg: Record<string, unknown>): void {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

async function notifyXpChange(stats: UserStats, xpDelta: number, reason: string): Promise<void> {
  const progress = xpInLevel(stats.xp);
  broadcast({
    type: xpDelta >= 0 ? "xpGain" : "xpLoss",
    xpAmount: Math.abs(xpDelta),
    reason,
    totalXp: stats.xp,
    level: stats.level,
    levelTitle: getLevelTitle(stats.level),
    xpProgress: { current: progress, max: XP_PER_LEVEL },
  });

  if (await canShowToast()) {
    const sign = xpDelta >= 0 ? "+" : "-";
    await showBrowserNotification(
      `${sign}${Math.abs(xpDelta)} XP — ${reason}`,
      `Level ${stats.level} ${getLevelTitle(stats.level)} | ${progress}/${XP_PER_LEVEL} XP`
    ).catch(() => {});
  }
}

function notifyLevelUp(level: number): void {
  broadcast({ type: "levelUp", level, levelTitle: getLevelTitle(level) });
  showBrowserNotification(`🎉 Level Up! You are now Level ${level}`, `New title: ${getLevelTitle(level)}`).catch(() => {});
}

async function notifyNewBadges(badgeIds: string[], stats: UserStats): Promise<void> {
  for (const id of badgeIds) {
    const badge = stats.badges.find(b => b.id === id);
    if (badge) {
      await showBrowserNotification(`🏅 Badge Earned: ${badge.name} (${badge.tier})`, badge.description).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// ML: Backend FastAPI / Ollama (optional)
// ---------------------------------------------------------------------------
interface MLResult { level: RiskLevel; score: number; provider: string }

async function queryBackend(url: string, backendUrl: string): Promise<MLResult | null> {
  try {
    const res = await fetch(`${backendUrl}/analyze/url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Backend returns score as integer 0-100. data.phishing_score is a dead field — removed.
    const rawScore = typeof data.score === "number" ? data.score : 0;
    const score: number = rawScore / 100;
    const level: RiskLevel = score >= 0.7 ? "danger" : score >= 0.3 ? "warning" : "safe";
    return { level, score, provider: data.provider ?? "Local FastAPI" };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ML: Offscreen Transformers.js (optional)
// FIX: creatingOffscreen reset now happens in ensureOffscreen's catch, not
// in queryOffscreenML's catch, so a failed creation doesn't leave a broken lock.
// ---------------------------------------------------------------------------
let creatingOffscreen: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  if (creatingOffscreen) { await creatingOffscreen; return; }
  creatingOffscreen = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["WORKERS"],
    justification: "ML inference with Transformers.js",
  }).then(() => {
    creatingOffscreen = null;  // Success: reset lock
  }).catch((err) => {
    creatingOffscreen = null;  // Failure: reset lock so next call can retry
    throw err;
  });
  await creatingOffscreen;
}

async function queryOffscreenML(url: string): Promise<MLResult | null> {
  try {
    await ensureOffscreen();
    const result = await chrome.runtime.sendMessage({ type: "analyzeUrl", url });
    if (!result) return null;
    return { level: result.level, score: result.score, provider: result.modelVersion ?? "Transformers.js" };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------
interface BackendSettings {
  enabled: boolean;
  useLocalBackend: boolean;
  backendUrl: string;
}

function defaultBackendSettings(): BackendSettings {
  return { enabled: true, useLocalBackend: false, backendUrl: DEFAULT_BACKEND_URL };
}

async function getBackendSettings(): Promise<BackendSettings> {
  const r = await chrome.storage.local.get(["backendSettings"]);
  return r.backendSettings ?? defaultBackendSettings();
}

// ---------------------------------------------------------------------------
// Core analysis + XP award
// FIX: XP is awarded AFTER analysis completes, not before.
// FIX: Danger pages are now deduped the same way as safe pages.
// ---------------------------------------------------------------------------

// In-memory domain cache (service worker lifetime)
const domainCache = new Map<string, { level: RiskLevel; patterns: string[]; time: number }>();
const CACHE_TTL_MS = 30_000; // 30s per domain

async function analyzeAndAward(url: string, tabId?: number): Promise<void> {
  if (shouldSkipUrl(url)) return;

  let hostname = "";
  try { hostname = new URL(url).hostname; } catch { return; }

  // ── 1. Heuristic analysis (always, very fast) ────────────────────────────
  const heuristic = analyzeUrl(url);

  // ── 2. Check domain cache ────────────────────────────────────────────────
  const cached = domainCache.get(hostname);
  const useCached = cached && (Date.now() - cached.time) < CACHE_TTL_MS;

  let finalLevel: RiskLevel = heuristic.level;
  let patterns: string[] = heuristic.patterns;

  if (!useCached) {
    // ── 3. ML analysis (optional) ──────────────────────────────────────────
    const settings = await getBackendSettings();
    let mlResult: MLResult | null = null;

    if (settings.useLocalBackend) {
      mlResult = await queryBackend(url, settings.backendUrl).catch(() => null);
    }
    if (!mlResult && settings.enabled) {
      mlResult = await queryOffscreenML(url).catch(() => null);
    }

    if (mlResult) {
      // ML can only escalate risk, never downgrade heuristic danger
      if (mlResult.level === "danger") finalLevel = "danger";
      else if (mlResult.level === "warning" && finalLevel === "safe") finalLevel = "warning";
      console.info(`[AI Hygiene] ML:${mlResult.level}(${mlResult.score?.toFixed(2)}) Heuristic:${heuristic.level} | ${mlResult.provider}`);
    }

    domainCache.set(hostname, { level: finalLevel, patterns, time: Date.now() });
  } else {
    finalLevel = cached.level;
    patterns = cached.patterns;
  }

  // ── 4. Update passive indicators ─────────────────────────────────────────
  saveRiskLevel(finalLevel);
  if (tabId !== undefined) {
    setBadge(tabId, finalLevel);
    if (finalLevel !== "safe") injectBanner(tabId, finalLevel);
  }

  broadcast({ type: "riskUpdate", level: finalLevel });
  broadcast({ type: "mlRiskResult", level: finalLevel, mlScore: null, modelVersion: "Heuristic" });

  // ── 5. XP awards / penalties — deduped per URL ───────────────────────────
  // FIX: check dedup BEFORE awarding, for both safe AND danger.
  try {
    const alreadyAwarded = await hasAwardedXpForUrl(url);
    if (alreadyAwarded) return;

    await markXpAwardedForUrl(url);

    if (finalLevel === "danger") {
      if (tabId !== undefined) await markTabAsDanger(tabId);

      const prevLevel = (await loadStats()).level;
      const { stats, newBadges } = await updateStats(s => applyDanger(s));
      await saveRiskEvent({ url, riskLevel: finalLevel, detectedPatterns: patterns, timestamp: Date.now(), xpChange: -XP.DANGER_PENALTY });
      await notifyXpChange(stats, -XP.DANGER_PENALTY, "Landed on a dangerous site 🚨");
      if (newBadges.length) await notifyNewBadges(newBadges, stats);
      if (stats.level < prevLevel) { /* de-level handled by XP floor at 0 */ }
    } else {
      const prevLevel = (await loadStats()).level;
      const { stats, newBadges } = await updateStats(s => applySafeBrowse(s, finalLevel));
      const xpGained = finalLevel === "warning" ? XP.WARNING_BROWSE : XP.SAFE_BROWSE;
      await saveRiskEvent({ url, riskLevel: finalLevel, detectedPatterns: patterns, timestamp: Date.now(), xpChange: xpGained });
      const msg = finalLevel === "warning"
        ? `Browsed carefully on a risky page (+${xpGained} XP) ⚠️`
        : `Safe visit (+${xpGained} XP) 🛡️`;
      await notifyXpChange(stats, xpGained, msg);
      if (newBadges.length) await notifyNewBadges(newBadges, stats);
      if (stats.level > prevLevel) notifyLevelUp(stats.level);
    }
  } catch (e) {
    console.error("[AI Hygiene] XP award error:", e);
  }
}

// ---------------------------------------------------------------------------
// Tab listeners
// ---------------------------------------------------------------------------
let lastUrl = "";

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Fire on URL change in active tab
  if (changeInfo.url && tab?.active) {
    lastUrl = changeInfo.url;
    // If navigating away from a danger tab, award danger-avoided XP
    isTabDanger(tabId).then(wasDanger => {
      if (wasDanger) {
        unmarkTabDanger(tabId);
        loadStats().then(prevStats => {
          updateStats(s => applyDangerAvoided(s)).then(async ({ stats, newBadges }) => {
            await notifyXpChange(stats, XP.DANGER_AVOIDED, "Navigated away from danger 🛡️");
            if (newBadges.length) await notifyNewBadges(newBadges, stats);
            if (stats.level > prevStats.level) notifyLevelUp(stats.level);
          });
        });
      }
    });
    analyzeAndAward(changeInfo.url, tabId);
  } else if (changeInfo.status === "complete" && tab?.active && tab.url) {
    if (tab.url !== lastUrl) {
      lastUrl = tab.url;
      analyzeAndAward(tab.url, tabId);
    }
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab?.url) {
      const level = await loadRiskLevel();
      setBadge(tabId, level);
      lastUrl = tab.url;
    }
  } catch {}
});

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message: Record<string, unknown>, sender, sendResponse) => {
  if (typeof message.type !== "string") return false;

  // ── getRiskLevel ──────────────────────────────────────────────────────────
  if (message.type === "getRiskLevel") {
    loadRiskLevel().then(level => sendResponse({ level }));
    return true;
  }

  // ── getStats ──────────────────────────────────────────────────────────────
  if (message.type === "getStats") {
    loadStats().then(stats => sendResponse({ stats }));
    return true;
  }

  // ── getDashboardData ──────────────────────────────────────────────────────
  if (message.type === "getDashboardData") {
    Promise.all([loadStats(), loadRiskLevel()]).then(([stats, riskLevel]) => {
      sendResponse({
        stats,
        riskLevel,
        levelTitle: getLevelTitle(stats.level),
        xpProgress: { current: xpInLevel(stats.xp), max: XP_PER_LEVEL },
      });
    });
    return true;
  }

  // ── pageScanResult (from content script) ─────────────────────────────────
  if (message.type === "pageScanResult") {
    const { url, signals, trackers, pageText } = message as {
      url: string;
      signals: Parameters<typeof contentRiskFromSignals>[0];
      trackers?: string[];
      pageText?: string;
    };
    const tabId = sender.tab?.id;

    const urlAnalysis = analyzeUrl(url);
    const contentAnalysis = contentRiskFromSignals(signals, urlAnalysis);

    // Broadcast tracker information to popup
    if (trackers && trackers.length > 0) {
      broadcast({ type: "trackersDetected", count: trackers.length, trackers });
    }

    if (contentAnalysis.level !== "safe") {
      saveRiskLevel(contentAnalysis.level);
      broadcast({ type: "riskUpdate", level: contentAnalysis.level });
      if (tabId !== undefined) {
        setBadge(tabId, contentAnalysis.level);
        injectBanner(tabId, contentAnalysis.level);
      }

      if (contentAnalysis.level === "danger" && tabId !== undefined) {
        markTabAsDanger(tabId);
        updateStats(s => applyDanger(s)).then(({ stats, newBadges }) => {
          notifyXpChange(stats, -XP.DANGER_PENALTY, "Dangerous page content detected 🚨");
          if (newBadges.length) notifyNewBadges(newBadges, stats);
        });
      }
    }

    // Habit signals
    const isPasswordOnHttp = signals.passwordOnHttp || signals.missingSecurityIndicators;
    if (isPasswordOnHttp) {
      updateStats(s => applyPasswordOnHttp(s)).then(({ stats, newBadges }) => {
        if (newBadges.length) notifyNewBadges(newBadges, stats);
      });
    } else if (signals.hasPasswordField && !isPasswordOnHttp && url.startsWith("https://")) {
      updateStats(s => applySecureLogin(s)).then(({ stats, newBadges }) => {
        if (newBadges.length) notifyNewBadges(newBadges, stats);
      });
    }

    sendResponse({ ok: true });
    return true;
  }

  // ── riskyActionDetected ───────────────────────────────────────────────────
  if (message.type === "riskyActionDetected") {
    const { pageRiskLevel, action } = message as { pageRiskLevel: string; action: string };
    if (pageRiskLevel === "warning" || pageRiskLevel === "danger") {
      updateStats(s => applyRiskyAction(s)).then(({ stats }) => {
        notifyXpChange(stats, -XP.RISKY_ACTION_PENALTY, `Risky action on flagged page: ${action} 🚨`);
      });
    }
    sendResponse({ ok: true });
    return true;
  }

  // ── dismissWarning ────────────────────────────────────────────────────────
  if (message.type === "dismissWarning") {
    sendResponse({ ok: true });
    return true;
  }

  // ── panicInitiated ────────────────────────────────────────────────────────
  if (message.type === "panicInitiated") {
    updateStats(s => applyPanicInitiated(s)).then(({ stats }) => {
      sendResponse({ stats });
    });
    return true;
  }

  // ── recoveryCompleted ─────────────────────────────────────────────────────
  if (message.type === "recoveryCompleted") {
    loadStats().then(prevStats => {
      updateStats(s => applyRecoveryCompleted(s)).then(async ({ stats, newBadges }) => {
        await notifyXpChange(stats, XP.PANIC_RECOVERY, "Recovery completed! +30 XP 💪");
        if (newBadges.length) await notifyNewBadges(newBadges, stats);
        if (stats.level > prevStats.level) notifyLevelUp(stats.level);
        sendResponse({ stats });
      });
    });
    return true;
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  if (message.type === "getSettings") {
    chrome.storage.local.get(["backendSettings", "notificationSettings"]).then((result) => {
      sendResponse({
        backend: result.backendSettings ?? defaultBackendSettings(),
        notifications: result.notificationSettings ?? defaultNotificationSettings(),
      });
    });
    return true;
  }

  if (message.type === "saveSettings") {
    chrome.storage.local.set({
      backendSettings: message.backend,
      notificationSettings: message.notifications,
    }).then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === "startBackend") {
    sendResponse({ success: true, note: "Start the backend manually via the API folder." });
    return true;
  }

  // ── Daemon manager (heavy model / Ollama) ─────────────────────────────────
  if (message.type === "detectRuntime") {
    detectAvailableRuntime().then(runtime => sendResponse(runtime));
    return true;
  }

  if (message.type === "installOllama") {
    chrome.tabs.create({ url: "https://ollama.com/download" });
    pollForRuntime("ollama", 120_000).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "pullModel") {
    const { model } = message as { model: string };
    pullModelWithProgress(model, (pct) => {
      broadcast({ type: "modelPullProgress", percent: pct });
    }).then(() => sendResponse({ ok: true })).catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  return false;
});

// ---------------------------------------------------------------------------
// Notification settings default
// ---------------------------------------------------------------------------
interface NotificationSettings {
  xpGainEnabled: boolean;
  badgeEarnedEnabled: boolean;
  levelUpEnabled: boolean;
  dangerAlertEnabled: boolean;
}

function defaultNotificationSettings(): NotificationSettings {
  return { xpGainEnabled: true, badgeEarnedEnabled: true, levelUpEnabled: true, dangerAlertEnabled: true };
}

// ---------------------------------------------------------------------------
// Daemon manager helpers (Ollama / LM Studio / Lemonade detection)
// ---------------------------------------------------------------------------
type DaemonRuntime = "ollama" | "lemonade" | "lmstudio" | "none";

async function detectAvailableRuntime(): Promise<DaemonRuntime> {
  const endpoints = [
    { url: "http://localhost:11434/api/tags", runtime: "ollama" as const },
    { url: "http://localhost:8000/health", runtime: "lemonade" as const },
    { url: "http://localhost:1234/v1/models", runtime: "lmstudio" as const },
  ];

  for (const { url, runtime } of endpoints) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return runtime;
    } catch {}
  }
  return "none";
}

async function pollForRuntime(runtime: DaemonRuntime, timeoutMs: number): Promise<void> {
  const startTime = Date.now();
  const urlMap: Record<string, string> = {
    ollama: "http://localhost:11434/api/tags",
    lemonade: "http://localhost:8000/health",
    lmstudio: "http://localhost:1234/v1/models",
  };
  const checkUrl = urlMap[runtime];
  if (!checkUrl) throw new Error("Unknown runtime");

  while (Date.now() - startTime < timeoutMs) {
    try {
      const res = await fetch(checkUrl, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error(`Runtime ${runtime} not available after ${timeoutMs}ms`);
}

async function pullModelWithProgress(model: string, onProgress: (pct: number) => void): Promise<void> {
  const res = await fetch("http://localhost:11434/api/pull", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: model, stream: true }),
  });

  if (!res.ok) throw new Error(`Pull failed: ${res.status}`);
  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const lines = decoder.decode(value).split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const data = JSON.parse(line);
        if (data.total && data.completed) {
          onProgress(Math.round((data.completed / data.total) * 100));
        }
        if (data.status === "success") onProgress(100);
      } catch {}
    }
  }
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await loadStats();
  if (!existing.createdAt || existing.createdAt === 0) {
    const { getDefaultStats } = await import("./lib/storage");
    await saveStats({ ...getDefaultStats(), createdAt: Date.now(), lastUpdated: Date.now() });
  }
  saveRiskLevel("safe");
  await showBrowserNotification(
    "AI Hygiene Companion Activated 🛡️",
    "Ready to help you browse safely and earn XP!"
  ).catch(() => {});
});