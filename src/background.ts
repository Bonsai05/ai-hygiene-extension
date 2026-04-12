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
  applyRiskyActionPenalty,
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
// Tracks URLs that already received XP this session (avoids double-awarding same URL)
const XP_AWARDED_URLS_KEY = "xpAwardedUrls";
// Tracks domains where ML analysis already ran (avoids re-running model on same domain)
const ML_ANALYZED_DOMAINS_KEY = "mlAnalyzedDomains";

// Notification toast cooldown — only prevents toast spam, NOT XP awarding
const SW_TOAST_COOLDOWN_KEY = "sw_last_toast_time";
const TOAST_COOLDOWN_MS = 3_000; // 3 seconds between toasts so they don't pile up

async function canShowToast(): Promise<boolean> {
  const r = await chrome.storage.session.get([SW_TOAST_COOLDOWN_KEY]);
  const last: number = r[SW_TOAST_COOLDOWN_KEY] ?? 0;
  const now = Date.now();
  if (now - last < TOAST_COOLDOWN_MS) return false;
  await chrome.storage.session.set({ [SW_TOAST_COOLDOWN_KEY]: now });
  return true;
}

/** Returns true if this exact URL has never been awarded XP this session */
async function hasXpBeenAwardedForUrl(url: string): Promise<boolean> {
  const r = await chrome.storage.session.get([XP_AWARDED_URLS_KEY]);
  const awarded: string[] = r[XP_AWARDED_URLS_KEY] ?? [];
  return awarded.includes(url);
}

/** Mark a URL as XP-awarded so we don't double-award on refresh */
async function markXpAwardedForUrl(url: string): Promise<void> {
  const r = await chrome.storage.session.get([XP_AWARDED_URLS_KEY]);
  const awarded: string[] = r[XP_AWARDED_URLS_KEY] ?? [];
  if (!awarded.includes(url)) {
    await chrome.storage.session.set({ [XP_AWARDED_URLS_KEY]: [...awarded, url].slice(-500) });
  }
}

/** Returns true if this domain's ML analysis has already run this session */
async function hasDomainBeenMLAnalyzed(domain: string): Promise<boolean> {
  const r = await chrome.storage.session.get([ML_ANALYZED_DOMAINS_KEY]);
  const analyzed: string[] = r[ML_ANALYZED_DOMAINS_KEY] ?? [];
  return analyzed.includes(domain);
}

/** Mark domain as ML-analyzed */
async function markDomainMLAnalyzed(domain: string): Promise<void> {
  const r = await chrome.storage.session.get([ML_ANALYZED_DOMAINS_KEY]);
  const analyzed: string[] = r[ML_ANALYZED_DOMAINS_KEY] ?? [];
  if (!analyzed.includes(domain)) {
    await chrome.storage.session.set({ [ML_ANALYZED_DOMAINS_KEY]: [...analyzed, domain].slice(-200) });
  }
}

async function clearVisited(): Promise<void> {
  await chrome.storage.session.remove([
    VISITED_KEY, DANGER_TABS_KEY, XP_AWARDED_URLS_KEY,
    ML_ANALYZED_DOMAINS_KEY, SW_TOAST_COOLDOWN_KEY,
  ]);
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

// Deduplicate concurrent requests for the same URL
const pendingBackendRequests = new Map<string, Promise<BackendMLResult | null>>();

async function analyzeUrlWithBackend(url: string): Promise<BackendMLResult | null> {
  // Deduplicate: return existing promise if request is already in flight
  const existing = pendingBackendRequests.get(url);
  if (existing) return existing;

  const request = (async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(`${DEFAULT_BACKEND_URL}/analyze/url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) throw new Error("offline");
      const data = await res.json();
      const score: number = data.phishing_score ?? data.score / 100 ?? 0;
      const level: "safe" | "warning" | "danger" =
        score >= 0.7 ? "danger" : score >= 0.3 ? "warning" : "safe";
      return { level, score, provider: data.provider ?? "Local FastAPI" };
    } catch {
      return null;
    } finally {
      pendingBackendRequests.delete(url);
    }
  })();

  pendingBackendRequests.set(url, request);
  return request;
}

// ---------------------------------------------------------------------------
// Offscreen ML (Transformers.js WASM)
// ---------------------------------------------------------------------------
let creatingOffscreenPromise: Promise<void> | null = null;

async function setupOffscreenDocument() {
  const hasOffscreen = await chrome.offscreen.hasDocument();
  if (hasOffscreen) return;
  if (creatingOffscreenPromise) {
    await creatingOffscreenPromise;
    return;
  }
  creatingOffscreenPromise = chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['WORKERS'],
    justification: 'ML inference with Transformers.js',
  });
  await creatingOffscreenPromise;
  creatingOffscreenPromise = null;
}

async function analyzeUrlWithOffscreenML(url: string): Promise<BackendMLResult | null> {
  try {
    await setupOffscreenDocument();

    const result = await chrome.runtime.sendMessage({
      type: 'analyzeUrl',
      url,
    });

    if (!result) return null;

    return {
      level: result.level,
      score: result.score,
      provider: result.provider ?? result.modelVersion ?? 'Transformers.js (WASM)',
    };
  } catch (err) {
    console.warn('[AI Hygiene] Offscreen ML failed:', err);
    creatingOffscreenPromise = null;
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
  const textConfig: chrome.action.BadgeTextDetails = {
    text: level === "danger" ? "⚠️" : level === "warning" ? "!" : "",
    tabId,
  };
  chrome.action.setBadgeText(textConfig);
  chrome.action.setBadgeBackgroundColor({
    color: level === "danger" ? "#ef4444" : level === "warning" ? "#f59e0b" : "#22c55e",
    tabId,
  });
}

function updateToolbarIcon(tabId: number, level: RiskLevel): void {
  // Service Workers do NOT have URL.createObjectURL.
  // Use static icon paths bundled in public/icons/.
  // The badge text + background color (set above) provides the visual state.
  // We can still attempt to set a path-based icon if static files exist.
  const iconMap: Record<RiskLevel, Record<string, string>> = {
    safe:    { "16": "icons/icon16.png",  "48": "icons/icon48.png",  "128": "icons/icon128.png" },
    warning: { "16": "icons/icon16.png",  "48": "icons/icon48.png",  "128": "icons/icon128.png" },
    danger:  { "16": "icons/icon16.png",  "48": "icons/icon48.png",  "128": "icons/icon128.png" },
  };
  chrome.action.setIcon({ path: iconMap[level], tabId }).catch(() => {
    // Silently fail — badge color already communicates state
  });
}

// ---------------------------------------------------------------------------
// Banner injection — Shadow DOM so the host page cannot tamper with it
// ---------------------------------------------------------------------------
function injectWarningBanner(tabId: number, level: "warning" | "danger"): void {
  chrome.scripting.executeScript({
    target: { tabId },
    func: (riskLevel: string) => {
      const BANNER_ID = "ai-hygiene-host";
      if (document.getElementById(BANNER_ID)) return;

      // Attach a Shadow DOM root to an invisible host element
      const host = document.createElement("div");
      host.id = BANNER_ID;
      Object.assign(host.style, {
        position: "fixed",
        top: "0",
        left: "0",
        width: "100%",
        zIndex: "2147483647",  // Max z-index
        pointerEvents: "none", // host is invisible; shadow children get events
      });
      document.documentElement.appendChild(host);

      const shadow = host.attachShadow({ mode: "closed" });

      const isDanger = riskLevel === "danger";
      const bg = isDanger ? "#dc2626" : "#d97706";
      const msg = isDanger
        ? "🚨 DANGER: This site has been flagged as a phishing attack. Leave immediately."
        : "⚠️ WARNING: Suspicious signals detected. Do not enter passwords or personal data.";

      shadow.innerHTML = `
        <div id="banner" style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: ${bg};
          color: #ffffff;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', monospace;
          font-size: 14px;
          font-weight: 700;
          padding: 12px 20px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.4);
          pointer-events: all;
          box-sizing: border-box;
          width: 100%;
        ">
          <span>${msg}</span>
          <button id="dismiss" style="
            background: rgba(255,255,255,0.2);
            border: 2px solid rgba(255,255,255,0.6);
            color: #ffffff;
            font-size: 12px;
            font-weight: 700;
            padding: 4px 12px;
            cursor: pointer;
            border-radius: 4px;
            flex-shrink: 0;
            margin-left: 12px;
          ">Dismiss</button>
        </div>
      `;

      shadow.getElementById("dismiss")?.addEventListener("click", () => {
        host.remove();
        // Notify extension that user dismissed the warning
        try { (window as Window & typeof globalThis & { chrome?: typeof chrome }).chrome?.runtime?.sendMessage({ type: "dismissWarning" }); } catch {}
      });
    },
    args: [level],
  }).catch(() => {
    // Silently fail — scripting may be blocked on certain pages (chrome://, etc.)
  });
}

// ---------------------------------------------------------------------------
// Core analysis + XP awards
// KEY DESIGN:
//   XP awarding  = per unique URL (each YouTube short = new URL = new XP)
//   ML analysis  = per domain    (youtube.com analyzed once, then cached)
// ---------------------------------------------------------------------------
async function analyzeAndAward(url: string, tabId?: number): Promise<void> {
  if (!url || !url.startsWith("http")) return;

  let domain = "";
  try { domain = new URL(url).hostname; } catch { return; }

  // Restore badge/icon state from domain cache immediately
  const cached = getCachedAnalysis(url);
  if (cached && tabId !== undefined) {
    updateBrowserActionBadge(tabId, cached.level);
    updateToolbarIcon(tabId, cached.level);
    setRiskLevel(cached.level);

    // Award XP for this safe navigation if we haven't awarded for this exact URL yet
    if (cached.level !== "danger") {
      const alreadyAwarded = await hasXpBeenAwardedForUrl(url);
      if (!alreadyAwarded) {
        await markXpAwardedForUrl(url);
        await updateStats(async (before) => {
          const after = await awardSafeBrowsingXp(before, cached.level as "safe" | "warning");
          announceNewBadges(before, after);
          if (after.level > before.level) notifyLevelUp(after.level);
          const toastOk = await canShowToast();
          if (toastOk) {
            const xpAmt = cached.level === "warning" ? XP_REWARDS.WARNING_BROWSE : XP_REWARDS.SAFE_BROWSE;
            notifyXpGain(after, xpAmt, cached.level === "warning" ? "Careful browsing on risky page — +10 XP ⚠️" : "Safe visit — +5 XP! 🛡️").catch(() => {});
          }
          return after;
        });
        await saveRiskEvent({
          url,
          riskLevel: cached.level,
          detectedPatterns: cached.patterns,
          timestamp: Date.now(),
          xpChange: XP_REWARDS.SAFE_BROWSE,
        });
      }
    }
    return;
  }

  // Check shouldAnalyzeUrl for ML-layer decisions (whitelist, skip list, etc.)
  const decision = await shouldAnalyzeUrl(url);
  if (!decision.shouldAnalyze && !cached) {
    return; // Genuinely should not analyze (chrome://, localhost, etc.)
  }

  // ML analysis — only run once per domain per session to avoid redundant compute
  const domainAlreadyAnalyzed = await hasDomainBeenMLAnalyzed(domain);

  // Fetch settings to orchestrate model fallback appropriately
  const resultObj = await chrome.storage.local.get(["backendSettings"]);
  const backendConfig = resultObj.backendSettings ?? getDefaultBackendSettings();

  // Run heuristics immediately (always, for every URL)
  const heuristic = analyzeUrl(url);
  let finalLevel: "safe" | "warning" | "danger" = heuristic.level;
  let mlResult: BackendMLResult | null = null;

  if (!domainAlreadyAnalyzed) {
    // Waterfall priority: Backend NPU -> Local Browser ML -> Heuristics
    if (backendConfig.useLocalBackend) {
      mlResult = await analyzeUrlWithBackend(url).catch(() => null);
    }
    if (!mlResult && backendConfig.enabled) {
      mlResult = await analyzeUrlWithOffscreenML(url).catch(() => null);
    }
    await markDomainMLAnalyzed(domain);
  } else {
    console.info(`[AI Hygiene] Skipping ML for ${domain} — already analyzed this session`);
  }

  if (mlResult) {
    if (mlResult.level === "danger") {
      finalLevel = "danger";
    } else if (mlResult.level === "warning" && finalLevel !== "danger") {
      finalLevel = "warning";
    } else if (mlResult.level === "safe" && finalLevel !== "danger") {
      finalLevel = "safe";
    }
    console.info(`[AI Hygiene] ML:${mlResult.level}(${mlResult.score.toFixed(3)}) Heuristic:${heuristic.level} [${mlResult.provider}]`);
  } else {
    console.info(`[AI Hygiene] Heuristic only: ${heuristic.level}`);
  }

  // Cache the analysis result for this domain
  markDomainAnalyzed(url, finalLevel, heuristic.patterns);

  // Update popup with analysis result
  chrome.runtime.sendMessage({
    type: "mlRiskResult",
    level: finalLevel,
    mlScore: mlResult?.score ?? null,
    modelVersion: mlResult?.provider ?? "Heuristic",
  }).catch(() => {});

  // Update badge and icon
  if (tabId !== undefined) {
    updateBrowserActionBadge(tabId, finalLevel);
    updateToolbarIcon(tabId, finalLevel);
    if (finalLevel === "danger" || finalLevel === "warning") {
      injectWarningBanner(tabId, finalLevel);
    }
  }

  try {
    let finalXpChange = 0;

    if (finalLevel === "danger") {
      // Always apply danger penalty — no rate limiting
      if (tabId !== undefined) await markTabAsDanger(tabId, url);
      await updateStats(async (before) => {
        const after = await applyDangerPenalty(before);
        finalXpChange = -XP_REWARDS.DANGER_PENALTY;
        notifyXpLoss(after, XP_REWARDS.DANGER_PENALTY, "Landed on a dangerous phishing site").catch(() => {});
        announceNewBadges(before, after);
        if (after.level > before.level) notifyLevelUp(after.level);
        return after;
      });
    } else {
      // Award XP for every unique URL visit on safe/warning pages
      const alreadyAwarded = await hasXpBeenAwardedForUrl(url);
      if (!alreadyAwarded) {
        await markXpAwardedForUrl(url);
        await updateStats(async (before) => {
          const after = await awardSafeBrowsingXp(before, finalLevel as "safe" | "warning");
          finalXpChange = finalLevel === "warning" ? XP_REWARDS.WARNING_BROWSE : XP_REWARDS.SAFE_BROWSE;
          announceNewBadges(before, after);
          if (after.level > before.level) notifyLevelUp(after.level);
          const toastOk = await canShowToast();
          if (toastOk) {
            const msg = finalLevel === "warning"
              ? `Browsed carefully through a risky page — +${XP_REWARDS.WARNING_BROWSE} XP ⚠️`
              : `Safe visit — +${XP_REWARDS.SAFE_BROWSE} XP! 🛡️`;
            notifyXpGain(after, finalXpChange, msg).catch(() => {});
          }
          return after;
        });
      }
    }

    await saveRiskEvent({ url, riskLevel: finalLevel, detectedPatterns: heuristic.patterns, timestamp: Date.now(), xpChange: finalXpChange });
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
chrome.runtime.onMessage.addListener((message: Record<string, unknown>, _sender, sendResponse) => {
  if (typeof message.type !== "string") {
    return false;
  }

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

    try {
      const domain = new URL(url).hostname;
      setDomainHasSensitiveForm(domain, signals.hasPasswordField || signals.hasLoginForm);
    } catch {
      // Skip tracking if parsing fails
    }

    const urlAnalysis = analyzeUrl(url);
    const contentAnalysis = contentRiskFromSignals(signals, urlAnalysis);
    const level = contentAnalysis.level;
    const tabId = _sender.tab?.id;

    if (signals.hasPasswordField) {
      if (signals.missingSecurityIndicators) {
        updateStats(onPasswordFieldHttp).then(() => {});
      } else if (!signals.missingSecurityIndicators && url.startsWith("https://")) {
        updateStats(onSecureLoginAttempt).then(() => {});
      }
    }

    if (level === "danger" || level === "warning") {
      setRiskLevel(level);

      if (tabId !== undefined) {
        updateBrowserActionBadge(tabId, level);
        updateToolbarIcon(tabId, level);
        injectWarningBanner(tabId, level);
      }

      if (level === "danger") {
        // Always penalise danger — no rate limiting here
        updateStats(async (before) => {
          if (tabId !== undefined) await markTabAsDanger(tabId, url);
          const after = await applyDangerPenalty(before);
          notifyXpLoss(after, XP_REWARDS.DANGER_PENALTY, "Page content flagged as dangerous").catch(() => {});
          announceNewBadges(before, after);
          return after;
        }).then(() => {});
      }
    }
    
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
      const after = await awardSafeBrowsingXp(before, "warning");
      await saveStats(after);
      await notifyXpGain(after, XP_REWARDS.WARNING_IGNORED, "Continued with caution on a warning page");
      sendResponse({ stats: after });
    });
    return true;
  }

  // Risky action detected on a risky page (download / malicious link click)
  if (message.type === "riskyActionDetected") {
    const { action, pageRiskLevel } = message as { action: string; pageRiskLevel: string };
    // Only penalise if the page was already flagged as risky
    if (pageRiskLevel === "warning" || pageRiskLevel === "danger") {
      updateStats(async (before) => {
        const after = await applyRiskyActionPenalty(before);
        notifyXpLoss(after, XP_REWARDS.RISKY_ACTION_PENALTY,
          `Risky action on flagged page: ${action} (-${XP_REWARDS.RISKY_ACTION_PENALTY} XP) 🚨`
        ).catch(() => {});
        announceNewBadges(before, after);
        return after;
      }).then(() => {});
    }
    sendResponse({ received: true });
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