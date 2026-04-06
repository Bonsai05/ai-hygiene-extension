// src/background.ts — Phase 2A
// Changes vs Phase 1:
//   1. Level-up detection: sends "levelUp" message to popup when level increases
//   2. onSecureLoginAttempt wired — called when content-script reports HTTPS + password field
//   3. onPasswordFieldHttp wired — called when content-script reports HTTP + password field
//   4. RiskEvent now persisted via saveRiskEvent after every analysis
//   5. getNewlyEarnedBadges used to announce badges without duplicates
//   6. All XP functions imported from gamification (no inline logic here)

import {
  loadStats,
  saveStats,
  updateStats,
  loadRiskLevel,
  saveRiskLevel,
  saveRiskEvent,
  type UserStats,
} from "./lib/storage";
import { analyzeUrl, contentRiskFromSignals } from "./lib/risk-detection";
import {
  awardSafeBrowsingXp,
  awardDangerAvoidedXp,
  applyDangerPenalty,
  onPanicButtonClicked,
  onRecoveryCompleted,
  onSecureLoginAttempt,
  onPasswordFieldHttp,
  getLevelTitle,
  getXpToNextLevel,
  getNewlyEarnedBadges,
  XP_REWARDS,
} from "./lib/gamification";
import { showBrowserNotification } from "./lib/notifications";

// ---------------------------------------------------------------------------
// Session storage helpers
// ---------------------------------------------------------------------------
const VISITED_KEY = "visitedUrls";
const DANGER_TABS_KEY = "dangerTabs";

async function wasRecentlyVisited(url: string): Promise<boolean> {
  const r = await chrome.storage.session.get([VISITED_KEY]);
  return (r[VISITED_KEY] ?? []).includes(url);
}

async function markVisited(url: string): Promise<void> {
  const r = await chrome.storage.session.get([VISITED_KEY]);
  const list: string[] = r[VISITED_KEY] ?? [];
  if (!list.includes(url)) {
    await chrome.storage.session.set({ [VISITED_KEY]: [...list, url].slice(-300) });
  }
}

async function clearVisited(): Promise<void> {
  await chrome.storage.session.remove([VISITED_KEY, DANGER_TABS_KEY]);
}

async function markTabAsDanger(tabId: number, url: string): Promise<void> {
  const r = await chrome.storage.session.get([DANGER_TABS_KEY]);
  const tabs: Record<number, string> = r[DANGER_TABS_KEY] ?? {};
  tabs[tabId] = url;
  await chrome.storage.session.set({ [DANGER_TABS_KEY]: tabs });
}

async function clearDangerTab(tabId: number): Promise<string | null> {
  const r = await chrome.storage.session.get([DANGER_TABS_KEY]);
  const tabs: Record<number, string> = r[DANGER_TABS_KEY] ?? {};
  const prev = tabs[tabId] ?? null;
  if (prev) {
    delete tabs[tabId];
    await chrome.storage.session.set({ [DANGER_TABS_KEY]: tabs });
  }
  return prev;
}

// ---------------------------------------------------------------------------
// Backend ML
// ---------------------------------------------------------------------------
interface BackendMLResult {
  level: "safe" | "warning" | "danger";
  score: number;
  provider: string;
}

async function analyzeUrlWithBackend(url: string): Promise<BackendMLResult | null> {
  try {
    const res = await fetch("http://127.0.0.1:8000/analyze/url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) throw new Error("offline");
    const data = await res.json();
    const score: number = data.phishing_score ?? data.score / 100 ?? 0;
    const level: "safe" | "warning" | "danger" =
      score >= 0.7 ? "danger" : score >= 0.3 ? "warning" : "safe";
    return { level, score, provider: data.provider ?? "Local FastAPI" };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Risk level state
// ---------------------------------------------------------------------------
let currentRiskLevel: "safe" | "warning" | "danger" = "safe";
let lastAnalyzedUrl = "";

function setRiskLevel(level: "safe" | "warning" | "danger") {
  currentRiskLevel = level;
  saveRiskLevel(level);
  chrome.runtime.sendMessage({ type: "riskUpdate", level }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
async function notifyXpGain(stats: UserStats, amount: number, reason: string): Promise<void> {
  if (amount <= 0) return;
  const { current, needed } = getXpToNextLevel(stats.xp, stats.level);
  const title = getLevelTitle(stats.level);
  chrome.runtime.sendMessage({
    type: "xpGain", xpAmount: amount, reason,
    totalXp: stats.xp, level: stats.level, levelTitle: title,
    xpProgress: { current, max: needed },
  }).catch(() => {});
  await showBrowserNotification(`+${amount} XP — ${reason}`,
    `Level ${stats.level} ${title} | ${current}/${needed} XP to next level`);
}

async function notifyXpLoss(stats: UserStats, amount: number, reason: string): Promise<void> {
  if (amount <= 0) return;
  const { current, needed } = getXpToNextLevel(stats.xp, stats.level);
  const title = getLevelTitle(stats.level);
  chrome.runtime.sendMessage({
    type: "xpLoss", xpAmount: amount, reason,
    totalXp: stats.xp, level: stats.level, levelTitle: title,
    xpProgress: { current, max: needed },
  }).catch(() => {});
  await showBrowserNotification(`-${amount} XP — ${reason}`,
    `Level ${stats.level} ${title} | ${current}/${needed} XP to next level`);
}

// NEW: notify popup of level-up so it can show the celebration toast
function notifyLevelUp(newLevel: number): void {
  const title = getLevelTitle(newLevel);
  chrome.runtime.sendMessage({ type: "levelUp", level: newLevel, levelTitle: title }).catch(() => {});
  showBrowserNotification(`Level Up! You are now Level ${newLevel}`, `New title: ${title}`);
}

// ---------------------------------------------------------------------------
// Banner injection
// ---------------------------------------------------------------------------
function injectWarningBanner(tabId: number, level: "warning" | "danger"): void {
  chrome.scripting.executeScript({
    target: { tabId },
    func: (riskLevel: string) => {
      if (document.getElementById("ai-hygiene-warning-banner")) return;
      const banner = document.createElement("div");
      banner.id = "ai-hygiene-warning-banner";
      Object.assign(banner.style, {
        position: "fixed", top: "0", left: "0", width: "100%",
        backgroundColor: riskLevel === "danger" ? "#ef4444" : "#f59e0b",
        color: "white", padding: "16px", textAlign: "center",
        fontFamily: "monospace", fontSize: "18px", fontWeight: "bold",
        zIndex: "9999999", boxShadow: "0 4px 6px rgba(0,0,0,0.3)",
      });
      banner.innerText = riskLevel === "danger"
        ? "🚨 AI HYGIENE ALERT: This site has been flagged as a severe phishing risk!"
        : "⚠️ AI HYGIENE WARNING: Proceed with caution. Do not share sensitive info here.";
      document.body.prepend(banner);
    },
    args: [level],
  }).catch(err => console.error("[AI Hygiene] banner inject error:", err));
}

// ---------------------------------------------------------------------------
// Core analysis + XP awards
// ---------------------------------------------------------------------------
async function analyzeAndAward(url: string, tabId?: number): Promise<void> {
    if (!url || !url.startsWith("http")) return;
    if (visitedUrls.has(url)) return;
    visitedUrls.add(url);

    // Run both analyses in parallel — ML is authoritative, heuristic is fallback
    const [heuristicResult, mlResult] = await Promise.all([
        Promise.resolve(analyzeUrl(url)),             // Heuristic (always available)
        analyzeUrlWithBackend(url).catch(() => null), // Local API Backend
    ]);

    // Determine final risk level: ML wins if available
    let finalLevel: "safe" | "warning" | "danger" = heuristicResult.level;
    if (mlResult) {
        // ML overrides heuristic if it detects danger, otherwise combine
        if (mlResult.level === "danger") {
            finalLevel = "danger";
        } else if (mlResult.level === "warning" && finalLevel !== "danger") {
            finalLevel = "warning";
        }
        console.info(`[AI Hygiene] ML risk: ${mlResult.level} (${mlResult.score.toFixed(3)}), Heuristic: ${heuristicResult.level} [Hardware: ${mlResult.provider}]`);
    }
  }

  if (await wasRecentlyVisited(url)) return;
  await markVisited(url);

  const [heuristic, ml] = await Promise.all([
    Promise.resolve(analyzeUrl(url)),
    analyzeUrlWithBackend(url).catch(() => null),
  ]);

  let finalLevel: "safe" | "warning" | "danger" = heuristic.level;
  if (ml) {
    if (ml.level === "danger") finalLevel = "danger";
    else if (ml.level === "warning" && finalLevel !== "danger") finalLevel = "warning";
    console.info(`[AI Hygiene] ML:${ml.level}(${ml.score.toFixed(3)}) Heuristic:${heuristic.level} [${ml.provider}]`);
  }

  chrome.runtime.sendMessage({
    type: "mlRiskResult", level: finalLevel,
    mlScore: ml?.score ?? null,
    modelVersion: ml?.provider ?? "Local CPU/Heuristic",
  }).catch(() => {});

  if (tabId !== undefined && (finalLevel === "danger" || finalLevel === "warning")) {
    injectWarningBanner(tabId, finalLevel);
  }

  try {
    const before = await loadStats();
    let after: UserStats;

    if (finalLevel === "danger") {
      if (tabId !== undefined) await markTabAsDanger(tabId, url);
      after = await applyDangerPenalty(before);
      await saveStats(after);
      await saveRiskEvent({ url, riskLevel: "danger", detectedPatterns: heuristic.patterns, timestamp: Date.now(), xpChange: -XP_REWARDS.DANGER_PENALTY });
      await notifyXpLoss(after, XP_REWARDS.DANGER_PENALTY, "Loaded a dangerous site");
      setRiskLevel("danger");
      return;
    }

    if (finalLevel === "warning") {
      after = await awardSafeBrowsingXp(before);
      await saveStats(after);
      await saveRiskEvent({ url, riskLevel: "warning", detectedPatterns: heuristic.patterns, timestamp: Date.now(), xpChange: XP_REWARDS.SAFE_BROWSE });
      if (after.safeBrowsingStreak > 1) {
        await notifyXpGain(after, XP_REWARDS.WARNING_IGNORED, "Proceeded carefully on a risky page");
      }
    } else {
      after = await awardSafeBrowsingXp(before);
      await saveStats(after);
      await saveRiskEvent({ url, riskLevel: "safe", detectedPatterns: [], timestamp: Date.now(), xpChange: XP_REWARDS.SAFE_BROWSE });
      await notifyXpGain(after, XP_REWARDS.SAFE_BROWSE, "Safe browsing session recorded");
    }

    announceNewBadges(before, after);
    if (after.level > before.level) notifyLevelUp(after.level);
    setRiskLevel(finalLevel);
  } catch (e) {
    console.error("[AI Hygiene] analyzeAndAward error:", e);
    setRiskLevel("safe");
  }
}

// Announce newly earned badges via browser notifications
async function announceNewBadges(before: UserStats, after: UserStats): Promise<void> {
  const newBadges = getNewlyEarnedBadges(before, after);
  for (const badge of newBadges) {
    await showBrowserNotification(
      `Badge Earned: ${badge.name} (${badge.tier})`,
      `${badge.description}\n+${XP_REWARDS.BADGE_EARNED} XP bonus!`
    );
  }
}

// ---------------------------------------------------------------------------
// Tab listeners
// ---------------------------------------------------------------------------
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && tab?.active) {
    lastAnalyzedUrl = changeInfo.url;
    analyzeAndAward(changeInfo.url, tabId);
  } else if (changeInfo.status === "complete" && tab?.active && tab.url) {
    if (tab.url !== lastAnalyzedUrl) {
      lastAnalyzedUrl = tab.url;
      analyzeAndAward(tab.url, tabId);
    }
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab?.url) {
      lastAnalyzedUrl = tab.url;
      setRiskLevel(await loadRiskLevel());
    }
  } catch {
    setRiskLevel("safe");
  }
});

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "getRiskLevel") {
    loadRiskLevel().then(level => sendResponse({ level }));
    return true;
  }
  if (message.type === "getStats") {
    loadStats().then(stats => sendResponse({ stats }));
    return true;
  }
  if (message.type === "getDashboardData") {
    loadStats().then(async (stats) => {
      const riskLevel = await loadRiskLevel();
      sendResponse({
        stats, riskLevel,
        levelTitle: getLevelTitle(stats.level),
        xpProgress: getXpToNextLevel(stats.xp, stats.level),
      });
    });
    return true;
  }
  if (message.type === "pageScanResult") {
    const { url, signals } = message;
    const urlAnalysis = analyzeUrl(url);
    const { level } = contentRiskFromSignals(signals, urlAnalysis);

    // NEW: wire up HTTPS login and HTTP password-field signals from content script
    if (signals.hasPasswordField) {
      if (signals.missingSecurityIndicators) {
        // HTTP + password field — award password-pro badge
        updateStats(onPasswordFieldHttp).then(() => {});
      } else if (!signals.missingSecurityIndicators && url.startsWith("https://")) {
        // HTTPS + password field — award secure login XP
        updateStats(onSecureLoginAttempt).then(() => {});
      }
    }

    if (level === "danger") setRiskLevel("danger");
    else if (level === "warning") setRiskLevel("warning");
    sendResponse({ received: true });
    return true;
  }
  if (message.type === "panicInitiated") {
    updateStats(onPanicButtonClicked).then(updated => sendResponse({ stats: updated }));
    return true;
  }
  if (message.type === "recoveryCompleted") {
    loadStats().then(async (before) => {
      const after = await onRecoveryCompleted(before);
      await saveStats(after);
      announceNewBadges(before, after);
      if (after.level > before.level) notifyLevelUp(after.level);
      await notifyXpGain(after, XP_REWARDS.PANIC_RECOVERY_COMPLETE, "Recovery steps completed!");
      sendResponse({ stats: after });
    });
    return true;
  }
  if (message.type === "dismissWarning") {
    loadStats().then(async (before) => {
      const after = await awardSafeBrowsingXp(before);
      await saveStats(after);
      await notifyXpGain(after, XP_REWARDS.WARNING_IGNORED, "Continued with caution on a warning page");
      sendResponse({ stats: after });
    });
    return true;
  }
  return false;
});

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(async () => {
  const stats = await loadStats();
  if (!stats.createdAt) {
    await saveStats({
      ...(await import("./lib/storage")).getDefaultStats(),
      createdAt: Date.now(),
      lastUpdated: Date.now(),
    });
  }
  setRiskLevel("safe");
  await clearVisited();
  await showBrowserNotification(
    "AI Hygiene Companion Activated",
    "Stay safe online! We'll help you browse securely and earn XP."
  );
});