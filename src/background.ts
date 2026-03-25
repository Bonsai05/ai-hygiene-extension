// src/background.ts — Final fixed version
// Changes vs previous draft:
//   1. Uses applyDangerPenalty() from gamification (single source of truth for XP logic)
//   2. Tracks "pending danger tabs" — if user navigates away from a danger page,
//      awards DANGER_AVOIDED XP instead of penalising them
//   3. chrome.storage.session used for visitedUrls (survives SW sleep/wake cycles)
//   4. notifyXpGain / notifyXpLoss only fire when amount > 0

import {
  loadStats,
  saveStats,
  updateStats,
  loadRiskLevel,
  saveRiskLevel,
  type UserStats,
} from "./lib/storage";
import { analyzeUrl, contentRiskFromSignals } from "./lib/risk-detection";
import {
  awardSafeBrowsingXp,
  awardDangerAvoidedXp,
  applyDangerPenalty,
  onPanicButtonClicked,
  onRecoveryCompleted,
  getLevelTitle,
  getXpToNextLevel,
  XP_REWARDS,
} from "./lib/gamification";
import { showBrowserNotification } from "./lib/notifications";

// ---------------------------------------------------------------------------
// Persistent visited-URL deduplication
// chrome.storage.session survives SW restarts but clears on browser close.
// ---------------------------------------------------------------------------
const VISITED_KEY = "visitedUrls";
const DANGER_TABS_KEY = "dangerTabs"; // tabId -> url mapping

async function wasRecentlyVisited(url: string): Promise<boolean> {
  const result = await chrome.storage.session.get([VISITED_KEY]);
  const list: string[] = result[VISITED_KEY] ?? [];
  return list.includes(url);
}

async function markVisited(url: string): Promise<void> {
  const result = await chrome.storage.session.get([VISITED_KEY]);
  const list: string[] = result[VISITED_KEY] ?? [];
  if (!list.includes(url)) {
    await chrome.storage.session.set({ [VISITED_KEY]: [...list, url].slice(-300) });
  }
}

async function clearVisited(): Promise<void> {
  await chrome.storage.session.remove([VISITED_KEY, DANGER_TABS_KEY]);
}

async function markTabAsDanger(tabId: number, url: string): Promise<void> {
  const result = await chrome.storage.session.get([DANGER_TABS_KEY]);
  const tabs: Record<number, string> = result[DANGER_TABS_KEY] ?? {};
  tabs[tabId] = url;
  await chrome.storage.session.set({ [DANGER_TABS_KEY]: tabs });
}

async function clearDangerTab(tabId: number): Promise<string | null> {
  const result = await chrome.storage.session.get([DANGER_TABS_KEY]);
  const tabs: Record<number, string> = result[DANGER_TABS_KEY] ?? {};
  const prevUrl = tabs[tabId] ?? null;
  if (prevUrl) {
    delete tabs[tabId];
    await chrome.storage.session.set({ [DANGER_TABS_KEY]: tabs });
  }
  return prevUrl;
}

// ---------------------------------------------------------------------------
// Backend ML integration
// ---------------------------------------------------------------------------
interface BackendMLResult {
  level: "safe" | "warning" | "danger";
  score: number;
  provider: string;
}

async function analyzeUrlWithBackend(url: string): Promise<BackendMLResult | null> {
  try {
    const response = await fetch("http://127.0.0.1:8000/analyze/url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!response.ok) throw new Error("Backend offline");
    const data = await response.json();
    const score: number = data.phishing_score ?? data.score / 100 ?? 0;
    let level: "safe" | "warning" | "danger" = "safe";
    if (score >= 0.7) level = "danger";
    else if (score >= 0.3) level = "warning";
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
// XP notifications
// ---------------------------------------------------------------------------
async function notifyXpGain(stats: UserStats, amount: number, reason: string): Promise<void> {
  if (amount <= 0) return;
  const { current, needed } = getXpToNextLevel(stats.xp, stats.level);
  const title = getLevelTitle(stats.level);
  chrome.runtime.sendMessage({
    type: "xpGain",
    xpAmount: amount,
    reason,
    totalXp: stats.xp,
    level: stats.level,
    levelTitle: title,
    xpProgress: { current, max: needed },
  }).catch(() => {});
  await showBrowserNotification(
    `+${amount} XP — ${reason}`,
    `Level ${stats.level} ${title} | ${current}/${needed} XP to next level`
  );
}

async function notifyXpLoss(stats: UserStats, amount: number, reason: string): Promise<void> {
  if (amount <= 0) return;
  const { current, needed } = getXpToNextLevel(stats.xp, stats.level);
  const title = getLevelTitle(stats.level);
  chrome.runtime.sendMessage({
    type: "xpLoss",
    xpAmount: amount,
    reason,
    totalXp: stats.xp,
    level: stats.level,
    levelTitle: title,
    xpProgress: { current, max: needed },
  }).catch(() => {});
  await showBrowserNotification(
    `-${amount} XP — ${reason}`,
    `Level ${stats.level} ${title} | ${current}/${needed} XP to next level`
  );
}

// ---------------------------------------------------------------------------
// Warning banner injection
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
  }).catch(err => console.error("[AI Hygiene] Could not inject banner:", err));
}

// ---------------------------------------------------------------------------
// Core: analyse URL + award / deduct XP
// ---------------------------------------------------------------------------
async function analyzeAndAward(url: string, tabId?: number): Promise<void> {
  if (!url.startsWith("http://") && !url.startsWith("https://")) return;

  // If this tab was previously showing a danger page and is navigating somewhere
  // new, the user avoided it — reward them before processing the new URL.
  if (tabId !== undefined) {
    const prevDangerUrl = await clearDangerTab(tabId);
    if (prevDangerUrl && prevDangerUrl !== url) {
      const stats = await loadStats();
      const updated = await awardDangerAvoidedXp(stats);
      await saveStats(updated);
      await notifyXpGain(updated, XP_REWARDS.DANGER_AVOIDED, "Navigated away from a dangerous site");
    }
  }

  if (await wasRecentlyVisited(url)) return;
  await markVisited(url);

  const [heuristicResult, mlResult] = await Promise.all([
    Promise.resolve(analyzeUrl(url)),
    analyzeUrlWithBackend(url).catch(() => null),
  ]);

  let finalLevel: "safe" | "warning" | "danger" = heuristicResult.level;
  if (mlResult) {
    if (mlResult.level === "danger") finalLevel = "danger";
    else if (mlResult.level === "warning" && finalLevel !== "danger") finalLevel = "warning";
    console.info(
      `[AI Hygiene] ML: ${mlResult.level} (${mlResult.score.toFixed(3)}) | ` +
      `Heuristic: ${heuristicResult.level} | Hardware: ${mlResult.provider}`
    );
  }

  chrome.runtime.sendMessage({
    type: "mlRiskResult",
    level: finalLevel,
    mlScore: mlResult?.score ?? null,
    modelVersion: mlResult?.provider ?? "Local CPU/Heuristic",
  }).catch(() => {});

  if (tabId !== undefined && (finalLevel === "danger" || finalLevel === "warning")) {
    injectWarningBanner(tabId, finalLevel);
  }

  try {
    const stats = await loadStats();

    if (finalLevel === "danger") {
      if (tabId !== undefined) await markTabAsDanger(tabId, url);
      const updated = await applyDangerPenalty(stats);
      await saveStats(updated);
      await notifyXpLoss(updated, XP_REWARDS.DANGER_PENALTY, "Loaded a dangerous site");
      setRiskLevel("danger");
      return;
    }

    let updated: UserStats;

    if (finalLevel === "warning") {
      updated = await awardSafeBrowsingXp(stats);
      await saveStats(updated);
      if (updated.safeBrowsingStreak > 1) {
        await notifyXpGain(updated, XP_REWARDS.WARNING_IGNORED, "Proceeded carefully on a risky page");
      }
    } else {
      updated = await awardSafeBrowsingXp(stats);
      await saveStats(updated);
      await notifyXpGain(updated, XP_REWARDS.SAFE_BROWSE, "Safe browsing session recorded");
    }

    // Announce newly-earned badges
    const newBadges = updated.badges.filter(
      (b, i) => b.earned && (!stats.badges[i] || !stats.badges[i].earned)
    );
    for (const badge of newBadges) {
      await showBrowserNotification(
        `Badge Earned: ${badge.name}`,
        `${badge.description}\n+${XP_REWARDS.BADGE_EARNED} XP bonus!`
      );
    }

    setRiskLevel(finalLevel);
  } catch (e) {
    console.error("[AI Hygiene] Error in analyzeAndAward:", e);
    setRiskLevel("safe");
  }
}

// ---------------------------------------------------------------------------
// Tab event listeners
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
      const savedLevel = await loadRiskLevel();
      setRiskLevel(savedLevel);
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
        stats,
        riskLevel,
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
    updateStats(onRecoveryCompleted).then(async (updated) => {
      await notifyXpGain(updated, XP_REWARDS.PANIC_RECOVERY_COMPLETE, "Recovery steps completed!");
      sendResponse({ stats: updated });
    });
    return true;
  }
  if (message.type === "dismissWarning") {
    updateStats(async (stats) => {
      const updated = await awardSafeBrowsingXp(stats);
      await notifyXpGain(updated, XP_REWARDS.WARNING_IGNORED, "Continued with caution on a warning page");
      return updated;
    }).then(updated => sendResponse({ stats: updated }));
    return true;
  }
  return false;
});

// ---------------------------------------------------------------------------
// Install / update
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