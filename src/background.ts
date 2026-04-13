// src/background.ts
// Service worker — core orchestration.
//
// XP award rules:
//   • Every unique URL visit on a safe/warning page → +5 or +10 XP
//   • Landing on a danger page → -15 XP + streak reset
//   • Risky action (download / ext link) on risky page → -15 XP
//   • "Unique URL" is tracked in chrome.storage.session so it survives
//     across SW restarts but resets on browser restart.
//
// ML pipeline (optional):
//   • Backend (local FastAPI) → Offscreen Transformers.js → Heuristics only

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
import { SKIP_PREFIXES, DEFAULT_BACKEND_URL, XP_PER_LEVEL } from "./lib/constants";

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
      const msg = isDanger
        ? "🚨 DANGER: This site is flagged as a phishing attack. Leave immediately."
        : "⚠️ WARNING: Suspicious signals detected. Do not enter passwords or personal data.";

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
// ML: Backend FastAPI (optional)
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
    const score: number = data.phishing_score ?? (data.score / 100) ?? 0;
    const level: RiskLevel = score >= 0.7 ? "danger" : score >= 0.3 ? "warning" : "safe";
    return { level, score, provider: data.provider ?? "Local FastAPI" };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ML: Offscreen Transformers.js (optional)
// ---------------------------------------------------------------------------
let creatingOffscreen: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  if (creatingOffscreen) { await creatingOffscreen; return; }
  creatingOffscreen = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["WORKERS"],
    justification: "ML inference with Transformers.js",
  });
  await creatingOffscreen;
  creatingOffscreen = null;
}

async function queryOffscreenML(url: string): Promise<MLResult | null> {
  try {
    await ensureOffscreen();
    const result = await chrome.runtime.sendMessage({ type: "analyzeUrl", url });
    if (!result) return null;
    return { level: result.level, score: result.score, provider: result.modelVersion ?? "Transformers.js" };
  } catch {
    creatingOffscreen = null;
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

  // ── 5. XP awards / penalties ─────────────────────────────────────────────
  try {
    if (finalLevel === "danger") {
      if (tabId !== undefined) await markTabAsDanger(tabId);

      const prevLevel = (await loadStats()).level;
      const { stats, newBadges } = await updateStats(s => applyDanger(s));
      await saveRiskEvent({ url, riskLevel: finalLevel, detectedPatterns: patterns, timestamp: Date.now(), xpChange: -15 });
      await notifyXpChange(stats, -15, "Landed on a dangerous site 🚨");
      if (newBadges.length) await notifyNewBadges(newBadges, stats);
      if (stats.level < prevLevel) { /* de-level not needed */ }
    } else {
      // Award XP once per unique URL
      const alreadyAwarded = await hasAwardedXpForUrl(url);
      if (!alreadyAwarded) {
        await markXpAwardedForUrl(url);
        const prevLevel = (await loadStats()).level;
        const { stats, newBadges } = await updateStats(s => applySafeBrowse(s, finalLevel));
        const xpGained = finalLevel === "warning" ? 10 : 5;
        await saveRiskEvent({ url, riskLevel: finalLevel, detectedPatterns: patterns, timestamp: Date.now(), xpChange: xpGained });
        const msg = finalLevel === "warning"
          ? `Browsed carefully on a risky page (+${xpGained} XP) ⚠️`
          : `Safe visit (+${xpGained} XP) 🛡️`;
        await notifyXpChange(stats, xpGained, msg);
        if (newBadges.length) await notifyNewBadges(newBadges, stats);
        if (stats.level > prevLevel) notifyLevelUp(stats.level);
      }
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
        const prevXp = 0; // will be read inside
        loadStats().then(prevStats => {
          updateStats(s => applyDangerAvoided(s)).then(async ({ stats, newBadges }) => {
            await notifyXpChange(stats, 25, "Navigated away from danger 🛡️");
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
    const { url, signals } = message as { url: string; signals: Parameters<typeof contentRiskFromSignals>[0] };
    const tabId = sender.tab?.id;

    const urlAnalysis = analyzeUrl(url);
    const contentAnalysis = contentRiskFromSignals(signals, urlAnalysis);

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
          notifyXpChange(stats, -15, "Dangerous page content detected 🚨");
          if (newBadges.length) notifyNewBadges(newBadges, stats);
        });
      }
    }

    // Habit signals
    if (signals.passwordOnHttp) {
      updateStats(s => applyPasswordOnHttp(s)).then(({ stats, newBadges }) => {
        if (newBadges.length) notifyNewBadges(newBadges, stats);
      });
    } else if (signals.hasPasswordField && !signals.passwordOnHttp && url.startsWith("https://")) {
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
        notifyXpChange(stats, -15, `Risky action on flagged page: ${action} 🚨`);
      });
    }
    sendResponse({ ok: true });
    return true;
  }

  // ── dismissWarning ────────────────────────────────────────────────────────
  if (message.type === "dismissWarning") {
    // No XP change for dismiss, just acknowledge
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
        await notifyXpChange(stats, 30, "Recovery completed! +30 XP 💪");
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
// Install
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await loadStats();
  if (!existing.createdAt || existing.createdAt === 0) {
    // Fresh install — save defaults with timestamps
    const { getDefaultStats } = await import("./lib/storage");
    await saveStats({ ...getDefaultStats(), createdAt: Date.now(), lastUpdated: Date.now() });
  }
  saveRiskLevel("safe");
  await showBrowserNotification(
    "AI Hygiene Companion Activated 🛡️",
    "Ready to help you browse safely and earn XP!"
  ).catch(() => {});
});