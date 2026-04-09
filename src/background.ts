// src/background.ts — Phase 2C
// Core analysis orchestration, XP awards, tab listeners
// Key flows:
//   1. Tab listeners trigger analysis on URL changes
//   2. shouldAnalyzeUrl() filters based on skip list, domain cache, known-safe domains
//   3. Triple analysis: heuristic + offscreen ML + backend ML (parallel)
//   4. XP awarded for safe browsing via awardSafeBrowsingXp()
//   5. Passive indicators (badge + icon) updated for at-a-glance status

import {
  loadStats,
  saveStats,
  updateStats,
  loadRiskLevel,
  saveRiskLevel,
  saveRiskEvent,
  type UserStats,
} from "./lib/storage";
import { analyzeUrl, contentRiskFromSignals, type RiskLevel } from "./lib/risk-detection";
import {
  awardSafeBrowsingXp,
  applyDangerPenalty,
  onPanicButtonClicked,
  onRecoveryCompleted,
  onSecureLoginAttempt,
  onPasswordFieldHttp,
  getLevelTitle,
  getXpToNextLevel,
  getNewlyEarnedBadges,
} from "./lib/gamification";
import { XP_REWARDS, DEFAULT_BACKEND_URL } from "./lib/constants";
import { showBrowserNotification } from "./lib/notifications";
import {
  shouldAnalyzeUrl,
  markDomainAnalyzed,
  setDomainHasSensitiveForm,
  getCachedAnalysis,
} from "./lib/analysis-strategy";

// ---------------------------------------------------------------------------
// Session storage helpers
// ---------------------------------------------------------------------------
const VISITED_KEY = "visitedUrls";
const DANGER_TABS_KEY = "dangerTabs";

// In-memory visited URLs cache (supplements session storage)
const visitedUrls = new Set<string>();

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

// ---------------------------------------------------------------------------
// Backend ML (Local FastAPI)
// ---------------------------------------------------------------------------
interface BackendMLResult {
  level: "safe" | "warning" | "danger";
  score: number;
  provider: string;
}

async function analyzeUrlWithBackend(url: string): Promise<BackendMLResult | null> {
  try {
    const res = await fetch(`${DEFAULT_BACKEND_URL}/analyze/url`, {
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
// Offscreen ML (Transformers.js WASM)
// ---------------------------------------------------------------------------
async function analyzeUrlWithOffscreenML(url: string): Promise<BackendMLResult | null> {
  try {
    // Ensure offscreen document exists
    const hasOffscreen = await chrome.offscreen.hasDocument();
    if (!hasOffscreen) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['WORKERS'],
        justification: 'ML inference with Transformers.js',
      });
    }

    const result = await chrome.runtime.sendMessage({
      type: 'analyzeUrl',
      url,
    });

    if (!result) return null;

    return {
      level: result.level,
      score: result.score,
      provider: result.modelVersion ?? 'Transformers.js (WASM)',
    };
  } catch (err) {
    console.warn('[AI Hygiene] Offscreen ML failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Risk level state
// ---------------------------------------------------------------------------
let lastAnalyzedUrl = "";

function setRiskLevel(level: "safe" | "warning" | "danger") {
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
// Passive Risk Indicators (toolbar badge + icon color)
// ---------------------------------------------------------------------------
function updateBrowserActionBadge(tabId: number, level: RiskLevel): void {
  const badgeConfig: chrome.action.BadgeDetails = {
    text: level === "danger" ? "⚠️" : level === "warning" ? "!" : "",
    color: level === "danger" ? "#ef4444" : level === "warning" ? "#f59e0b" : "#22c55e",
    tabId,
  };
  chrome.action.setBadgeText(badgeConfig);
  chrome.action.setBadgeBackgroundColor({
    color: badgeConfig.color,
    tabId,
  });
}

function updateToolbarIcon(tabId: number, level: RiskLevel): void {
  // Generate colored icon using canvas (no external files needed)
  const colors: Record<RiskLevel, string> = {
    safe: "#22c55e",
    warning: "#f59e0b",
    danger: "#ef4444",
  };

  // Create SVG icon with shield and status indicator
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="14" fill="${colors[level]}" stroke="#1a1a1a" stroke-width="2"/>
      <text x="16" y="22" text-anchor="middle" fill="white" font-size="16" font-weight="bold">
        ${level === "danger" ? "⚠" : level === "warning" ? "!" : "✓"}
      </text>
    </svg>
  `;
  const svgBlob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(svgBlob);

  chrome.action.setIcon({ path: url, tabId });

  // Clean up blob URL after a delay
  setTimeout(() => URL.revokeObjectURL(url), 5000);
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

  // Intelligent analysis: skip internal URLs, use domain caching, check whitelist
  const decision = await shouldAnalyzeUrl(url);

  // Handle cached result - restore risk level and award XP for safe browsing
  if (!decision.shouldAnalyze) {
    const cached = decision.cachedResult || getCachedAnalysis(url);
    if (cached) {
      // Restore risk level from cache
      if (tabId !== undefined) {
        updateBrowserActionBadge(tabId, cached.level);
        updateToolbarIcon(tabId, cached.level);
      }
      setRiskLevel(cached.level);

      // Award XP for safe/warning cached pages (user is still browsing safely)
      if (cached.level !== "danger") {
        try {
          const before = await loadStats();
          const after = await awardSafeBrowsingXp(before);
          await saveStats(after);
          await saveRiskEvent({
            url,
            riskLevel: cached.level,
            detectedPatterns: cached.patterns,
            timestamp: Date.now(),
            xpChange: XP_REWARDS.SAFE_BROWSE,
          });
          if (canAwardXp()) {
            await notifyXpGain(after, XP_REWARDS.SAFE_BROWSE, "Safe browsing (cached)");
          }
        } catch (e) {
          console.error("[AI Hygiene] cached XP award error:", e);
        }
      }
    }
    return;
  }

  // Skip if already visited in this session
  if (visitedUrls.has(url)) return;
  visitedUrls.add(url);

  if (await wasRecentlyVisited(url)) return;
  await markVisited(url);

  // Run all analyses in parallel — offscreen ML (WASM), backend ML (FastAPI), and heuristics
  const [heuristic, offscreenML, backendML] = await Promise.all([
    Promise.resolve(analyzeUrl(url)),
    analyzeUrlWithOffscreenML().catch(() => null),  // On-device ML (WASM)
    analyzeUrlWithBackend(url).catch(() => null),   // Optional FastAPI backend
  ]);

  // Determine final risk level: ML wins if available (offscreen preferred, then backend)
  let finalLevel: "safe" | "warning" | "danger" = heuristic.level;
  const mlResult = offscreenML || backendML;

  if (mlResult) {
    if (mlResult.level === "danger") {
      finalLevel = "danger";
    } else if (mlResult.level === "warning" && finalLevel !== "danger") {
      finalLevel = "warning";
    }
    console.info(`[AI Hygiene] ML:${mlResult.level}(${mlResult.score.toFixed(3)}) Heuristic:${heuristic.level} [${mlResult.provider}]`);
  }

  // Cache the analysis result for this domain
  markDomainAnalyzed(url, finalLevel, heuristic.patterns);

  // Notify popup of ML result
  chrome.runtime.sendMessage({
    type: "mlRiskResult",
    level: finalLevel,
    mlScore: mlResult?.score ?? null,
    modelVersion: mlResult?.provider ?? "Local CPU/Heuristic",
  }).catch(() => {});

  // Inject warning banner if needed
  if (tabId !== undefined && (finalLevel === "danger" || finalLevel === "warning")) {
    injectWarningBanner(tabId, finalLevel);
  }

  // Update passive indicators (toolbar badge + icon)
  if (tabId !== undefined) {
    updateBrowserActionBadge(tabId, finalLevel);
    updateToolbarIcon(tabId, finalLevel);
  }

  try {
    const before = await loadStats();
    let after: UserStats;

    if (finalLevel === "danger") {
      if (tabId !== undefined) await markTabAsDanger(tabId, url);
      after = await applyDangerPenalty(before);
      await saveStats(after);
      await saveRiskEvent({ url, riskLevel: "danger", detectedPatterns: heuristic.patterns, timestamp: Date.now(), xpChange: -XP_REWARDS.DANGER_PENALTY });

      // Rate limit XP loss NOTIFICATIONS (still apply the penalty)
      if (canAwardXp()) {
        await notifyXpLoss(after, XP_REWARDS.DANGER_PENALTY, "Loaded a dangerous site");
      }
      setRiskLevel("danger");
      return;
    }

    // Always award XP for safe/warning pages
    after = await awardSafeBrowsingXp(before);
    await saveStats(after);
    await saveRiskEvent({ url, riskLevel: finalLevel, detectedPatterns: heuristic.patterns, timestamp: Date.now(), xpChange: XP_REWARDS.SAFE_BROWSE });

    // Rate limit XP gain NOTIFICATIONS (still award the XP)
    if (canAwardXp()) {
      if (finalLevel === "warning" && after.safeBrowsingStreak > 1) {
        await notifyXpGain(after, XP_REWARDS.WARNING_IGNORED, "Proceeded carefully on a risky page");
      } else if (finalLevel === "safe") {
        await notifyXpGain(after, XP_REWARDS.SAFE_BROWSE, "Safe browsing session recorded");
      }
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

      // Restore risk level from storage
      const level = await loadRiskLevel();
      setRiskLevel(level);

      // Restore passive indicators from cache or default to safe
      const cached = getCachedAnalysis(tab.url);
      const levelForIcon = cached?.level ?? level;
      updateBrowserActionBadge(activeInfo.tabId, levelForIcon);
      updateToolbarIcon(activeInfo.tabId, levelForIcon);
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

    // Inform analysis strategy about sensitive forms for future analysis decisions
    try {
      const domain = new URL(url).hostname;
      setDomainHasSensitiveForm(domain, signals.hasPasswordField || signals.hasLoginForm);
    } catch {
      // URL parsing failed, skip sensitive form tracking
    }

    const urlAnalysis = analyzeUrl(url);
    const { level } = contentRiskFromSignals(signals, urlAnalysis);

    // Wire up HTTPS login and HTTP password-field signals from content script
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

  // Settings handlers
  if (message.type === "getSettings") {
    chrome.storage.local.get(["backendSettings", "notificationSettings"]).then((result) => {
      sendResponse({
        backend: result.backendSettings ?? getDefaultBackendSettings(),
        notifications: result.notificationSettings ?? getDefaultNotificationSettings(),
      });
    });
    return true;
  }

  if (message.type === "saveSettings") {
    chrome.storage.local
      .set({
        backendSettings: message.backend,
        notificationSettings: message.notifications,
      })
      .then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === "startBackend") {
    // Backend auto-start would be handled by native messaging or a separate script
    // For now, just acknowledge the request
    sendResponse({ success: true, note: "Backend should be started manually" });
    return true;
  }

  return false;
});

// Default settings helpers
function getDefaultBackendSettings(): BackendSettings {
  return {
    enabled: true,
    useLocalBackend: false,
    backendUrl: "http://127.0.0.1:8000",
    useAmdNpu: false,
    autoStartBackend: true,
    mlModelLazyLoad: true,
  };
}

function getDefaultNotificationSettings(): NotificationSettings {
  return {
    xpGainEnabled: true,
    badgeEarnedEnabled: true,
    levelUpEnabled: true,
    dangerAlertEnabled: true,
  };
}

// Types for settings (shared with Settings.tsx)
interface BackendSettings {
  enabled: boolean;
  useLocalBackend: boolean;
  backendUrl: string;
  useAmdNpu: boolean;
  autoStartBackend: boolean;
  mlModelLazyLoad: boolean;
}

interface NotificationSettings {
  xpGainEnabled: boolean;
  badgeEarnedEnabled: boolean;
  levelUpEnabled: boolean;
  dangerAlertEnabled: boolean;
}

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