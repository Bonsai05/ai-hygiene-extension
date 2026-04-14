// src/background.ts
// Service worker — core orchestration.
//
// Architecture (v2):
//   PRIMARY:  FastAPI backend (http://127.0.0.1:8000) — 7 lightweight models, always-on.
//             Started automatically via Chrome Native Messaging (host.py) on extension load.
//   FALLBACK: Heuristic-only analysis when backend is offline.
//   OFFSCREEN: Retained as dead fallback (Transformers.js), not used as primary path.
//
// XP award rules:
//   • Every unique URL visit on a safe/warning page → +5 or +10 XP
//   • Landing on a danger page → -15 XP + streak reset (deduped per URL)
//   • Risky action (download / ext link) on risky page → -15 XP
//
// ML pipeline (backend, 7 models):
//   1A. ealvaradob/phishing-url-detection      — URL lexical analysis (ONNX)
//   1B. phishbot/ScamLLM                       — Social engineering / scam content
//   1C. onnx-community/bert-finetuned-phishing — Credential harvesting DOM text
//   1D. gravitee-io/bert-small-pii-detection   — PII leakage in form fields
//   1E. ealvaradob/bert-base-uncased-ft-phishing-urls — URL redundancy model
//   1F. cybersectony/phishing-email-detection-distilbert — Email phishing content
//   1G. mrm8488/bert-tiny-finetuned-sms-spam-detection  — Spam/smishing signal

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
  xpProgressInLevel,
  type UserStats,
  type RiskLevel,
} from "./lib/storage";

import { analyzeUrl, contentRiskFromSignals } from "./lib/risk-detection";
import { showBrowserNotification } from "./lib/notifications";
import { SKIP_PREFIXES, DEFAULT_BACKEND_URL, XP_PER_LEVEL, XP } from "./lib/constants";
import { MODEL_STATUS_STORAGE_KEY, defaultModelStatusMap, type ModelStatusMap } from "./lib/model-registry";

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
// Only injected when we have HIGH CONFIDENCE (ML confirms OR heuristic is "danger")
// FIXED: Never inject banners on heuristic "warning" alone without ML confirmation.
// ---------------------------------------------------------------------------
function injectBanner(
  tabId: number,
  level: "warning" | "danger",
  score = 0,
  threats: string[] = []
): void {
  chrome.scripting.executeScript({
    target: { tabId },
    func: (riskLevel: string, riskScore: number, threatList: string[]) => {
      const BANNER_ID = "ai-hygiene-banner-host";
      document.getElementById(BANNER_ID)?.remove();

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
      const pct = riskScore > 0 ? ` (${Math.round(riskScore)}% confidence)` : "";
      const headline = isDanger
        ? `🚨 Dangerous site detected${pct} — close this tab immediately.`
        : `⚠️ Suspicious site detected${pct} — don't enter personal information.`;

      const threatHTML = threatList.length
        ? `<div style="margin-top:6px;font-size:11px;opacity:.9;">
            ${threatList.map(t => `<span style="background:rgba(0,0,0,.25);padding:2px 7px;border-radius:10px;margin-right:4px;">${t}</span>`).join("")}
           </div>`
        : "";

      shadow.innerHTML = `
        <div style="display:flex;flex-direction:column;
          background:${bg};color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
          font-size:13px;font-weight:700;padding:10px 16px;box-shadow:0 2px 8px rgba(0,0,0,.4);
          pointer-events:all;box-sizing:border-box;width:100%;">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <div style="flex:1">
              <div>${headline}</div>
              ${threatHTML}
            </div>
            <button id="dismiss" style="background:rgba(255,255,255,.2);border:2px solid rgba(255,255,255,.6);
              color:#fff;font-size:12px;font-weight:700;padding:4px 12px;cursor:pointer;border-radius:4px;
              flex-shrink:0;margin-left:12px;">Dismiss</button>
          </div>
        </div>`;

      shadow.getElementById("dismiss")?.addEventListener("click", () => {
        host.remove();
        try {
          (window as Window & { chrome?: typeof chrome }).chrome?.runtime?.sendMessage({ type: "dismissWarning" });
        } catch {}
      });
    },
    args: [level, score, threats],
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Popup messaging
// ---------------------------------------------------------------------------
function broadcast(msg: Record<string, unknown>): void {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

async function notifyXpChange(stats: UserStats, xpDelta: number, reason: string): Promise<void> {
  // FIXED: use xpProgressInLevel instead of xpInLevel to avoid boundary issues
  const progress = xpProgressInLevel(stats.xp, stats.level);
  broadcast({
    type: xpDelta >= 0 ? "xpGain" : "xpLoss",
    xpAmount: Math.abs(xpDelta),
    reason,
    totalXp: stats.xp,
    level: stats.level,
    levelTitle: getLevelTitle(stats.level),
    xpProgress: progress,
  });

  if (await canShowToast()) {
    const sign = xpDelta >= 0 ? "+" : "-";
    await showBrowserNotification(
      `${sign}${Math.abs(xpDelta)} XP — ${reason}`,
      `Level ${stats.level} ${getLevelTitle(stats.level)} | ${progress.current}/${XP_PER_LEVEL} XP`
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
// Native Messaging — manages host.py lifecycle
// ---------------------------------------------------------------------------
let nativePort: chrome.runtime.Port | null = null;
let backendStatus: "setup_required" | "starting" | "ready" | "offline" = "starting";
let _backendHealthy = false;
let _backendProvider = "CPU";
let _backendModels: Record<string, string> = {};
let _heavyModelStatus: { loaded: boolean; model_id: string | null; status: string } = {
  loaded: false, model_id: null, status: "unloaded"
};

function connectNativeHost(): void {
  try {
    nativePort = chrome.runtime.connectNative("com.ai_hygiene");
    nativePort.onMessage.addListener((msg: Record<string, unknown>) => {
      console.info("[AI Hygiene] Native host:", msg);
      if (msg.status === "started" || msg.server_running) {
        // Server process started — start polling health
        pollBackendHealth();
      }
    });
    nativePort.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError?.message ?? "unknown";
      nativePort = null;
      if (err.includes("Native host has exited") || err.includes("not found")) {
        // Host binary not registered — setup not done yet
        backendStatus = "setup_required";
        broadcast({ type: "backendStatus", status: "setup_required" });
      } else {
        backendStatus = "offline";
        broadcast({ type: "backendStatus", status: "offline" });
        // Retry in 10s
        setTimeout(ensureBackend, 10_000);
      }
    });
    // Send START action
    nativePort.postMessage({ action: "START" });
  } catch (e) {
    backendStatus = "setup_required";
    broadcast({ type: "backendStatus", status: "setup_required" });
  }
}

let _pollInterval: ReturnType<typeof setInterval> | null = null;

function pollBackendHealth(): void {
  if (_pollInterval) return; // already polling
  _pollInterval = setInterval(async () => {
    try {
      const res = await fetch(`${DEFAULT_BACKEND_URL}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json();
        _backendHealthy = true;
        _backendProvider = data.provider ?? "CPU";
        _backendModels = data.models ?? {};
        _heavyModelStatus = data.heavy_model ?? { loaded: false, model_id: null, status: "unloaded" };
        const readyCount = Object.values(_backendModels).filter(s => s === "ready").length;
        backendStatus = "ready";
        broadcast({
          type: "backendStatus",
          status: "ready",
          provider: _backendProvider,
          modelsReady: readyCount,
          modelsTotal: Object.keys(_backendModels).length,
          models: _backendModels,
          heavyModel: _heavyModelStatus,
        });
      } else {
        _backendHealthy = false;
        backendStatus = "offline";
        broadcast({ type: "backendStatus", status: "offline" });
      }
    } catch {
      _backendHealthy = false;
      if (backendStatus !== "starting") {
        backendStatus = "offline";
        broadcast({ type: "backendStatus", status: "offline" });
      }
    }
  }, 3000);
}

async function ensureBackend(): Promise<void> {
  backendStatus = "starting";
  broadcast({ type: "backendStatus", status: "starting" });
  connectNativeHost();
}

// ---------------------------------------------------------------------------
// ML: Backend FastAPI — primary inference path
// ---------------------------------------------------------------------------
interface MLResult { level: RiskLevel; score: number; provider: string; signals?: string[] }
interface EnsembleResult extends MLResult {
  individual?: Record<string, number>;
  pii?: { has_pii: boolean; pii_types: string[] } | null;
  modelsReady?: number;
  modelsTotal?: number;
  heavyModelActive?: boolean;
}

async function queryBackendEnsemble(url: string, text = ""): Promise<EnsembleResult | null> {
  try {
    const res = await fetch(`${DEFAULT_BACKEND_URL}/analyze/ensemble`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      level: (data.level as RiskLevel) ?? "safe",
      score: typeof data.score === "number" ? data.score : 0,
      provider: data.provider ?? "Backend",
      signals: data.models_used ?? [],
      individual: data.individual,
      pii: data.pii,
      modelsReady: data.models_ready,
      modelsTotal: data.models_total,
      heavyModelActive: data.heavy_model_active,
    };
  } catch {
    return null;
  }
}

async function queryBackendUrl(url: string): Promise<MLResult | null> {
  try {
    const res = await fetch(`${DEFAULT_BACKEND_URL}/analyze/url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      level: (data.level as RiskLevel) ?? "safe",
      score: typeof data.score === "number" ? data.score : 0,
      provider: data.provider ?? "Backend",
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ML: Offscreen Transformers.js (fallback only — not primary path)
// ---------------------------------------------------------------------------
let creatingOffscreen: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  if (creatingOffscreen) { await creatingOffscreen; return; }
  creatingOffscreen = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["BLOBS"],  // FIXED: was "WORKERS" — incorrect for WASM blob URLs
    justification: "Fallback ML inference with Transformers.js",
  }).then(() => {
    creatingOffscreen = null;
  }).catch((err) => {
    creatingOffscreen = null;
    throw err;
  });
  await creatingOffscreen;
}

// ---------------------------------------------------------------------------
// Inference Queue — per-tab, max 1 in-flight, 500ms debounce
// ---------------------------------------------------------------------------
class InferenceQueue {
  private inFlight = new Set<number>();
  private timers = new Map<number, ReturnType<typeof setTimeout>>();

  schedule(tabId: number, fn: () => Promise<void>, debounceMs = 500): void {
    const existing = this.timers.get(tabId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(tabId);
      if (this.inFlight.has(tabId)) return;
      this.inFlight.add(tabId);
      fn().catch(() => {}).finally(() => this.inFlight.delete(tabId));
    }, debounceMs);
    this.timers.set(tabId, timer);
  }

  isActive(tabId: number): boolean {
    return this.inFlight.has(tabId) || this.timers.has(tabId);
  }
}

const inferenceQueue = new InferenceQueue();

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------
interface BackendSettings {
  enabled: boolean;
  useLocalBackend: boolean;
  backendUrl: string;
}

function defaultBackendSettings(): BackendSettings {
  return { enabled: true, useLocalBackend: true, backendUrl: DEFAULT_BACKEND_URL };
}

async function getBackendSettings(): Promise<BackendSettings> {
  const r = await chrome.storage.local.get(["backendSettings"]);
  return r.backendSettings ?? defaultBackendSettings();
}

// ---------------------------------------------------------------------------
// Core analysis + XP award
// FIXED: Banner only injected with ML confirmation OR hard heuristic danger signal
// FIXED: http_protocol alone never triggers a banner (handled in risk-detection.ts)
// ---------------------------------------------------------------------------

// In-memory domain cache (service worker lifetime)
const domainCache = new Map<string, { level: RiskLevel; patterns: string[]; score: number; time: number }>();
const CACHE_TTL_MS = 30_000; // 30s per domain

async function analyzeAndAward(url: string, tabId?: number): Promise<void> {
  if (shouldSkipUrl(url)) return;

  let hostname = "";
  try { hostname = new URL(url).hostname; } catch { return; }

  // ── 1. Heuristic analysis (always, very fast) ──────────────────────────────
  const heuristic = analyzeUrl(url);

  // ── 2. Check domain cache ──────────────────────────────────────────────────
  const cached = domainCache.get(hostname);
  const useCached = cached && (Date.now() - cached.time) < CACHE_TTL_MS;

  let finalLevel: RiskLevel = heuristic.level;
  let patterns: string[] = heuristic.patterns;
  let mlScore = 0;

  if (!useCached) {
    // ── 3. Query backend ensemble (primary ML path) ──────────────────────────
    let mlResult: EnsembleResult | null = null;

    if (_backendHealthy) {
      mlResult = await queryBackendEnsemble(url, "").catch(() => null);
    }

    if (mlResult && !mlResult.individual?.url_phishing) {
      // If ensemble didn't include URL model, also run URL-specific check
      const urlCheck = await queryBackendUrl(url).catch(() => null);
      if (urlCheck && urlCheck.level === "danger") {
        mlResult = { ...mlResult, level: "danger", score: Math.max(mlResult.score, urlCheck.score) };
      }
    }

    if (mlResult) {
      // ML can only escalate risk, never downgrade a heuristic "danger"
      if (mlResult.level === "danger") finalLevel = "danger";
      else if (mlResult.level === "warning" && finalLevel === "safe") finalLevel = "warning";
      mlScore = mlResult.score;
      console.info(`[AI Hygiene] Ensemble:${mlResult.level}(${mlResult.score}) Heuristic:${heuristic.level} | ${mlResult.provider} | Models: ${mlResult.modelsReady}/${mlResult.modelsTotal}`);
    } else {
      console.info(`[AI Hygiene] Backend offline — heuristic only: ${heuristic.level}`);
    }

    domainCache.set(hostname, { level: finalLevel, patterns, score: mlScore, time: Date.now() });
  } else {
    finalLevel = cached.level;
    patterns = cached.patterns;
    mlScore = cached.score;
  }

  // ── 4. Update badge (always) ───────────────────────────────────────────────
  saveRiskLevel(finalLevel);
  if (tabId !== undefined) setBadge(tabId, finalLevel);

  // ── 5. Build threat display strings ───────────────────────────────────────
  const threatStrings = patterns.map(p => p.replace(/_/g, " "));

  // ── 6. Inject banner — ONLY with sufficient evidence ──────────────────────
  // FIXED: No banner for heuristic "warning" alone (avoids false positives on HTTP sites)
  // Banner fires when:
  //   a) ML ensemble confirms danger (score >= 70) OR
  //   b) Heuristic hard-signals danger (IP, typosquat, data URI) — no ML needed
  //   c) ML ensemble confirms warning (score >= 35) AND heuristic also warns
  const bannerConfirmedByMl = _backendHealthy && (
    (mlScore >= 70 && finalLevel === "danger") ||
    (mlScore >= 35 && finalLevel === "warning" && heuristic.level === "warning")
  );
  const bannerConfirmedByHeuristic = finalLevel === "danger" && (
    patterns.includes("typosquatting") ||
    patterns.includes("ip_address_hostname") ||
    patterns.includes("data_uri") ||
    patterns.includes("url_with_at_symbol")
  );

  if (tabId !== undefined && finalLevel !== "safe") {
    if (bannerConfirmedByMl || bannerConfirmedByHeuristic) {
      injectBanner(tabId, finalLevel, mlScore, threatStrings);
    }
  }

  // ── 7. Broadcast to popup ─────────────────────────────────────────────────
  broadcast({ type: "riskUpdate", level: finalLevel });
  broadcast({
    type: "mlRiskResult",
    level: finalLevel,
    mlScore,
    mlScorePct: mlScore,
    modelVersion: _backendHealthy ? `Backend (${_backendProvider})` : "Heuristic",
    threats: threatStrings,
    backendHealthy: _backendHealthy,
  });
  broadcast({ type: "threatUpdate", threats: threatStrings, level: finalLevel });

  // ── 8. XP awards / penalties — deduped per URL ────────────────────────────
  try {
    const alreadyAwarded = await hasAwardedXpForUrl(url);
    if (alreadyAwarded) return;

    await markXpAwardedForUrl(url);

    if (finalLevel === "danger") {
      if (tabId !== undefined) await markTabAsDanger(tabId);

      const { stats, newBadges } = await updateStats(s => applyDanger(s));
      await saveRiskEvent({ url, riskLevel: finalLevel, detectedPatterns: patterns, timestamp: Date.now(), xpChange: -XP.DANGER_PENALTY });
      await notifyXpChange(stats, -XP.DANGER_PENALTY, "Landed on a dangerous site 🚨");
      if (newBadges.length) await notifyNewBadges(newBadges, stats);
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
  if (changeInfo.url && tab?.active) {
    lastUrl = changeInfo.url;
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
// Message handlers
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message: Record<string, unknown>, sender, sendResponse) => {
  if (typeof message.type !== "string") return false;

  // ── getRiskLevel ───────────────────────────────────────────────────────────
  if (message.type === "getRiskLevel") {
    loadRiskLevel().then(level => sendResponse({ level }));
    return true;
  }

  // ── getStats ───────────────────────────────────────────────────────────────
  if (message.type === "getStats") {
    loadStats().then(stats => sendResponse({ stats }));
    return true;
  }

  // ── getDashboardData ───────────────────────────────────────────────────────
  if (message.type === "getDashboardData") {
    Promise.all([loadStats(), loadRiskLevel()]).then(([stats, riskLevel]) => {
      const progress = xpProgressInLevel(stats.xp, stats.level);
      const modelsReady = Object.values(_backendModels).filter(s => s === "ready").length;
      const modelsTotal = Object.keys(_backendModels).length || 7; // default 7 known models
      sendResponse({
        stats,
        riskLevel,
        levelTitle: getLevelTitle(stats.level),
        xpProgress: progress,
        backendStatus,
        backendProvider: _backendProvider,
        backendModels: _backendModels,
        modelsReady,
        modelsTotal,
        heavyModel: _heavyModelStatus,
      });
    });
    return true;
  }

  // ── getBackendStatus ───────────────────────────────────────────────────────
  if (message.type === "getBackendStatus") {
    sendResponse({
      status: backendStatus,
      provider: _backendProvider,
      models: _backendModels,
      heavyModel: _heavyModelStatus,
    });
    return true;
  }

  // ── loadHeavyModel ─────────────────────────────────────────────────────────
  if (message.type === "loadHeavyModel") {
    const modelId = (message.modelId as string) ?? "Qwen/Qwen2.5-1.5B-Instruct";
    fetch(`${DEFAULT_BACKEND_URL}/heavy/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model_id: modelId }),
      signal: AbortSignal.timeout(10000),
    }).then(r => r.json()).then(data => {
      sendResponse({ ok: true, ...data });
      // Start polling heavy model status
      _pollHeavyModelStatus();
    }).catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  // ── unloadHeavyModel ───────────────────────────────────────────────────────
  if (message.type === "unloadHeavyModel") {
    fetch(`${DEFAULT_BACKEND_URL}/heavy/unload`, {
      method: "POST",
      signal: AbortSignal.timeout(10000),
    }).then(r => r.json()).then(data => {
      _heavyModelStatus = { loaded: false, model_id: null, status: "unloaded" };
      broadcast({ type: "heavyModelStatus", loaded: false, status: "unloaded" });
      sendResponse({ ok: true, ...data });
    }).catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  // ── pageScanResult (from content script) ──────────────────────────────────
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

    if (trackers && trackers.length > 0) {
      broadcast({ type: "trackersDetected", count: trackers.length, trackers });
    }

    if (contentAnalysis.level !== "safe") {
      saveRiskLevel(contentAnalysis.level);
      broadcast({ type: "riskUpdate", level: contentAnalysis.level });
      if (tabId !== undefined) {
        setBadge(tabId, contentAnalysis.level);
        // Content scan confirms danger — inject banner
        if (contentAnalysis.level === "danger") {
          injectBanner(tabId, contentAnalysis.level, 90, contentAnalysis.patterns.map(p => p.replace(/_/g, " ")));
        }
      }

      if (contentAnalysis.level === "danger" && tabId !== undefined) {
        markTabAsDanger(tabId);
        updateStats(s => applyDanger(s)).then(({ stats, newBadges }) => {
          notifyXpChange(stats, -XP.DANGER_PENALTY, "Dangerous page content detected 🚨");
          if (newBadges.length) notifyNewBadges(newBadges, stats);
        });
      }
    }

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

    // Route PII scan to backend if available, fallback to offscreen
    if (signals.hasPasswordField && pageText && contentAnalysis.level !== "safe") {
      if (_backendHealthy) {
        fetch(`${DEFAULT_BACKEND_URL}/analyze/pii`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: pageText }),
          signal: AbortSignal.timeout(5000),
        }).then(r => r.json()).then(piiData => {
          if (piiData.has_pii) {
            broadcast({ type: "piiDetected", entities: piiData.pii_types, confidence: piiData.confidence });
          }
        }).catch(() => {});
      }
    }

    sendResponse({ ok: true });
    return true;
  }

  // ── riskyActionDetected ────────────────────────────────────────────────────
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

  // ── dismissWarning ─────────────────────────────────────────────────────────
  if (message.type === "dismissWarning") {
    sendResponse({ ok: true });
    return true;
  }

  // ── panicInitiated ─────────────────────────────────────────────────────────
  if (message.type === "panicInitiated") {
    updateStats(s => applyPanicInitiated(s)).then(({ stats }) => {
      sendResponse({ stats });
    });
    return true;
  }

  // ── recoveryCompleted ──────────────────────────────────────────────────────
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

  // ── Settings ───────────────────────────────────────────────────────────────
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

  // ── Model status (for Settings UI backward compat) ────────────────────────
  if (message.type === "getModelStatus") {
    // Return backend model status as ModelStatusMap format
    const statusMap: ModelStatusMap = defaultModelStatusMap();
    // Map backend models to the legacy format for Settings UI compatibility
    sendResponse({ statusMap, backendModels: _backendModels, backendStatus });
    return true;
  }

  // ── domMutationScan (from content script MutationObserver) ────────────────
  if (message.type === "domMutationScan") {
    const { url, text } = message as { url: string; text: string };
    const tabId = sender.tab?.id;
    if (tabId !== undefined && url && text && _backendHealthy) {
      inferenceQueue.schedule(tabId, async () => {
        const result = await queryBackendEnsemble(url, text).catch(() => null);
        if (!result || result.level === "safe") return;

        loadRiskLevel().then(currentLevel => {
          const escalated: RiskLevel =
            result.level === "danger" || currentLevel === "danger" ? "danger" : "warning";
          saveRiskLevel(escalated);
          setBadge(tabId, escalated);
          const mutThreats = result.score >= 70
            ? [`ML Threat Detection (${result.score}%)`]
            : ["Suspicious Dynamic Content"];
          // Only inject for confirmed threats from ML
          if (result.score >= 35) injectBanner(tabId, escalated, result.score, mutThreats);
          broadcast({ type: "riskUpdate", level: escalated });
          broadcast({ type: "threatUpdate", threats: mutThreats, level: escalated });
        });
      }, 1500);
    }
    return false;
  }

  // ── piiInputScan (from content script field monitor) ──────────────────────
  if (message.type === "piiInputScan") {
    const { text, fieldId } = message as { text: string; fieldId: string; url: string };
    const tabId = sender.tab?.id;
    if (tabId !== undefined && text && _backendHealthy) {
      fetch(`${DEFAULT_BACKEND_URL}/analyze/pii`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(5000),
      }).then(r => r.json()).then(piiData => {
        if (!piiData.has_pii) return;
        chrome.tabs.sendMessage(tabId, {
          type: "piiFieldWarning",
          fieldId,
          entities: piiData.pii_types,
          confidence: piiData.confidence,
        }).catch(() => {});
        broadcast({ type: "piiDetected", fieldId, entities: piiData.pii_types, confidence: piiData.confidence });
      }).catch(() => {});
    }
    return false;
  }

  // ── Relay modelProgress / modelStatusUpdate (for offscreen fallback) ───────
  if (message.type === "modelProgress" || message.type === "modelStatusUpdate") {
    broadcast(message);
    return false;
  }

  return false;
});

// ---------------------------------------------------------------------------
// Heavy model status polling (started when heavy model begins loading)
// ---------------------------------------------------------------------------
let _heavyPollInterval: ReturnType<typeof setInterval> | null = null;

function _pollHeavyModelStatus(): void {
  if (_heavyPollInterval) clearInterval(_heavyPollInterval);
  _heavyPollInterval = setInterval(async () => {
    try {
      const res = await fetch(`${DEFAULT_BACKEND_URL}/heavy/status`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return;
      const data = await res.json();
      _heavyModelStatus = {
        loaded: data.loaded,
        model_id: data.model_id,
        status: data.status,
      };
      broadcast({
        type: "heavyModelStatus",
        loaded: data.loaded,
        model_id: data.model_id,
        status: data.status,
        progress: data.progress,
      });
      if (data.status === "ready" || data.status === "failed") {
        clearInterval(_heavyPollInterval!);
        _heavyPollInterval = null;
      }
    } catch {}
  }, 2000);
}

// ---------------------------------------------------------------------------
// Install + Startup
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
    "Starting local ML backend — 7 models loading in background…"
  ).catch(() => {});

  // Auto-start backend via Native Messaging
  ensureBackend();
});

chrome.runtime.onStartup.addListener(() => {
  // Re-connect and re-start backend on browser restart
  ensureBackend();
});