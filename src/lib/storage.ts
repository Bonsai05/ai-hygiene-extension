// src/lib/storage.ts
// All Chrome storage I/O and in-memory stat manipulation.
// RULE: XP math is done here; background.ts only calls these functions.

import { STORAGE_KEYS, XP_PER_LEVEL, MAX_LEVEL, LEVEL_TITLES, XP, STREAK_MILESTONES } from "./constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type RiskLevel = "safe" | "warning" | "danger";
export type BadgeTier = "bronze" | "silver" | "gold";
export type BadgeCategory = "streak" | "threat" | "recovery" | "habit";

export interface Badge {
  id: string;
  name: string;
  icon: "shield" | "lock" | "eye" | "key" | "zap" | "award" | "check" | "alert";
  earned: boolean;
  description: string;
  tier: BadgeTier;
  category: BadgeCategory;
  earnedAt?: number;
}

export interface QuickTip {
  id: string;
  text: string;
  type: "info" | "success" | "warning";
}

export interface UserStats {
  xp: number;
  maxXp: number;          // always 100 per level — kept on interface for test compatibility
  level: number;
  badges: Badge[];
  tips: QuickTip[];
  safeBrowsingStreak: number;
  totalPagesAnalyzed: number;
  phishingAttemptsAvoided: number;
  dangerSitesVisited: number;   // canonical field name
  dangerSitesClicked: number;   // alias — kept for gamification.test.ts compatibility
  secureLoginsDetected: number;
  panicButtonUsed: boolean;
  panicButtonUsedCount: number;
  createdAt: number;
  lastUpdated: number;
}

export interface RiskEvent {
  url: string;
  riskLevel: RiskLevel;
  detectedPatterns: string[];
  timestamp: number;
  xpChange: number;
}

// ---------------------------------------------------------------------------
// Level math
// ---------------------------------------------------------------------------
/** Total XP required to START a given level */
export function xpForLevel(level: number): number {
  return (Math.min(level, MAX_LEVEL) - 1) * XP_PER_LEVEL;
}

/** Total XP required to REACH the start of the next level */
export function maxXpForLevel(level: number): number {
  return Math.min(level, MAX_LEVEL) * XP_PER_LEVEL;
}

/** Compute level from total XP */
export function levelFromXp(xp: number): number {
  return Math.min(Math.floor(xp / XP_PER_LEVEL) + 1, MAX_LEVEL);
}

/** XP progress within the current level (0 .. XP_PER_LEVEL) */
export function xpInLevel(xp: number): number {
  return xp % XP_PER_LEVEL;
}

/** XP progress object within the current level — used by storage.test.ts.
 * At an exact level boundary (e.g. xp=100 for level 1), returns { current: 100, max: 100 }
 * so the XP bar shows as full before the level-up animation triggers.
 */
export function xpProgressInLevel(xp: number, _level: number): { current: number; max: number } {
  const remainder = xp % XP_PER_LEVEL;
  // At the exact boundary (e.g. 100, 200, …), show the bar as full rather than empty.
  const current = remainder === 0 && xp > 0 ? XP_PER_LEVEL : remainder;
  return { current, max: XP_PER_LEVEL };
}

/** XP needed to complete the current level */
export function xpNeededForLevel(_level: number): number {
  return XP_PER_LEVEL; // always 100 per level
}

export function getLevelTitle(level: number): string {
  return LEVEL_TITLES[level] ?? `Level ${level}`;
}

// ---------------------------------------------------------------------------
// Badge catalog — immutable template list
// ---------------------------------------------------------------------------
const BADGE_CATALOG: Badge[] = [
  // Streak
  { id: "streak-starter",  name: "Streak Starter",  icon: "zap",    tier: "bronze", category: "streak",   earned: false, description: "Browse 10 pages safely in a row." },
  { id: "streak-veteran",  name: "Streak Veteran",  icon: "zap",    tier: "silver", category: "streak",   earned: false, description: "Browse 25 pages safely in a row." },
  { id: "streak-legend",   name: "Streak Legend",   icon: "zap",    tier: "gold",   category: "streak",   earned: false, description: "Browse 50 pages safely in a row." },
  // Threat
  { id: "phish-spotter",   name: "Phish Spotter",   icon: "eye",    tier: "bronze", category: "threat",   earned: false, description: "Avoid your first phishing attempt." },
  { id: "danger-survivor", name: "Danger Survivor", icon: "shield", tier: "silver", category: "threat",   earned: false, description: "Navigate away from 3 dangerous sites." },
  { id: "threat-hunter",   name: "Threat Hunter",   icon: "alert",  tier: "gold",   category: "threat",   earned: false, description: "Avoid 10 phishing or dangerous sites total." },
  // Recovery
  { id: "safe-surfer",     name: "Safe Surfer",     icon: "shield", tier: "bronze", category: "recovery", earned: false, description: "Complete your first safe browsing session." },
  { id: "recovery-hero",   name: "Recovery Hero",   icon: "award",  tier: "silver", category: "recovery", earned: false, description: "Use the panic button and complete all recovery steps." },
  { id: "bounce-back",     name: "Bounce Back",     icon: "award",  tier: "gold",   category: "recovery", earned: false, description: "Complete recovery 3 times — resilience is a skill." },
  // Habit
  { id: "password-pro",    name: "Password Pro",    icon: "lock",   tier: "bronze", category: "habit",    earned: false, description: "Spot a password field on an unsecured page." },
  { id: "secure-login",    name: "Secure Login",    icon: "check",  tier: "silver", category: "habit",    earned: false, description: "Successfully log in on an HTTPS site." },
  { id: "hygiene-master",  name: "Hygiene Master",  icon: "key",    tier: "gold",   category: "habit",    earned: false, description: "Reach Level 5." },
];

function freshBadges(): Badge[] {
  return BADGE_CATALOG.map(b => ({ ...b }));
}

// ---------------------------------------------------------------------------
// Default stats
// ---------------------------------------------------------------------------
export function getDefaultStats(): UserStats {
  return {
    xp: 0,
    maxXp: XP_PER_LEVEL,  // always 100 — per-level constant, not per-user data
    level: 1,
    badges: freshBadges(),
    tips: [
      { id: "tip-1", text: "Always check the URL bar before entering any password.", type: "info" },
      { id: "tip-2", text: "HTTPS alone isn't enough — verify the domain is correct.", type: "info" },
      { id: "tip-3", text: "No legitimate site will ask for your password via email.", type: "warning" },
    ],
    safeBrowsingStreak: 0,
    totalPagesAnalyzed: 0,
    phishingAttemptsAvoided: 0,
    dangerSitesVisited: 0,
    dangerSitesClicked: 0,  // alias kept in sync
    secureLoginsDetected: 0,
    panicButtonUsed: false,
    panicButtonUsedCount: 0,
    createdAt: Date.now(),
    lastUpdated: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Pure stat mutation helpers (no I/O)
// ---------------------------------------------------------------------------
export function addXp(stats: UserStats, amount: number): UserStats {
  const newXp = Math.max(0, stats.xp + amount);
  return { ...stats, xp: newXp, level: levelFromXp(newXp), lastUpdated: Date.now() };
}

/** Remove XP (cannot go below 0). Level adjusts downward if XP crosses threshold. */
export function removeXp(stats: UserStats, amount: number): UserStats {
  return addXp(stats, -amount);
}

export function awardBadge(stats: UserStats, id: string): UserStats {
  const badges = stats.badges.map(b =>
    b.id === id && !b.earned ? { ...b, earned: true, earnedAt: Date.now() } : b
  );
  return { ...stats, badges, lastUpdated: Date.now() };
}

/** Apply safe/warning browsing XP + streak logic. Returns updated stats + list of newly earned badge ids. */
export function applySafeBrowse(stats: UserStats, level: "safe" | "warning"): { stats: UserStats; newBadges: string[] } {
  const amount = level === "warning" ? XP.WARNING_BROWSE : XP.SAFE_BROWSE;
  let s = addXp(stats, amount);
  s = { ...s, safeBrowsingStreak: s.safeBrowsingStreak + 1, totalPagesAnalyzed: s.totalPagesAnalyzed + 1 };

  const newBadges: string[] = [];

  // safe-surfer: first safe page
  if (s.safeBrowsingStreak === 1 && !s.badges.find(b => b.id === "safe-surfer")?.earned) {
    s = awardBadge(s, "safe-surfer");
    s = addXp(s, XP.BADGE_BONUS);
    newBadges.push("safe-surfer");
  }

  // Streak milestone badges
  const milestoneId = STREAK_MILESTONES[s.safeBrowsingStreak];
  if (milestoneId && !s.badges.find(b => b.id === milestoneId)?.earned) {
    s = awardBadge(s, milestoneId);
    s = addXp(s, XP.STREAK_BONUS + XP.BADGE_BONUS);
    newBadges.push(milestoneId);
  }

  // hygiene-master at level 5
  if (s.level >= 5 && !s.badges.find(b => b.id === "hygiene-master")?.earned) {
    s = awardBadge(s, "hygiene-master");
    s = addXp(s, XP.BADGE_BONUS);
    newBadges.push("hygiene-master");
  }

  return { stats: s, newBadges };
}

/** Apply danger penalty + streak reset. */
export function applyDanger(stats: UserStats): { stats: UserStats; newBadges: string[] } {
  let s = addXp(stats, -XP.DANGER_PENALTY);
  s = {
    ...s,
    safeBrowsingStreak: 0,
    dangerSitesVisited: s.dangerSitesVisited + 1,
    dangerSitesClicked: s.dangerSitesClicked + 1,  // keep both in sync
    totalPagesAnalyzed: s.totalPagesAnalyzed + 1,
  };
  return { stats: s, newBadges: [] };
}

/** Apply risky action penalty (download/external link on a risky page). */
export function applyRiskyAction(stats: UserStats): { stats: UserStats; newBadges: string[] } {
  let s = addXp(stats, -XP.RISKY_ACTION_PENALTY);
  s = { ...s, safeBrowsingStreak: 0 };
  return { stats: s, newBadges: [] };
}

/** Award XP for navigating away from danger. */
export function applyDangerAvoided(stats: UserStats): { stats: UserStats; newBadges: string[] } {
  let s = addXp(stats, XP.DANGER_AVOIDED);
  s = { ...s, phishingAttemptsAvoided: s.phishingAttemptsAvoided + 1, safeBrowsingStreak: s.safeBrowsingStreak + 1 };
  const newBadges: string[] = [];

  const spotter = s.badges.find(b => b.id === "phish-spotter");
  if (spotter && !spotter.earned) { s = awardBadge(s, "phish-spotter"); s = addXp(s, XP.BADGE_BONUS); newBadges.push("phish-spotter"); }

  if (s.phishingAttemptsAvoided === 3) {
    const sb = s.badges.find(b => b.id === "danger-survivor");
    if (sb && !sb.earned) { s = awardBadge(s, "danger-survivor"); s = addXp(s, XP.BADGE_BONUS); newBadges.push("danger-survivor"); }
  }
  if (s.phishingAttemptsAvoided === 10) {
    const sb = s.badges.find(b => b.id === "threat-hunter");
    if (sb && !sb.earned) { s = awardBadge(s, "threat-hunter"); s = addXp(s, XP.BADGE_BONUS); newBadges.push("threat-hunter"); }
  }
  return { stats: s, newBadges };
}

/** Award XP for secure login. */
export function applySecureLogin(stats: UserStats): { stats: UserStats; newBadges: string[] } {
  let s = addXp(stats, XP.SECURE_LOGIN);
  s = { ...s, secureLoginsDetected: s.secureLoginsDetected + 1 };
  const newBadges: string[] = [];
  const b = s.badges.find(b => b.id === "secure-login");
  if (b && !b.earned) { s = awardBadge(s, "secure-login"); s = addXp(s, XP.BADGE_BONUS); newBadges.push("secure-login"); }
  return { stats: s, newBadges };
}

/** Award password-pro badge (password on HTTP, no XP change). */
export function applyPasswordOnHttp(stats: UserStats): { stats: UserStats; newBadges: string[] } {
  const newBadges: string[] = [];
  const b = stats.badges.find(b => b.id === "password-pro");
  if (b && !b.earned) {
    const s = addXp(awardBadge(stats, "password-pro"), XP.BADGE_BONUS);
    newBadges.push("password-pro");
    return { stats: s, newBadges };
  }
  return { stats, newBadges };
}

/** Panic initiated. */
export function applyPanicInitiated(stats: UserStats): { stats: UserStats; newBadges: string[] } {
  return { stats: addXp({ ...stats, panicButtonUsed: true }, XP.PANIC_INITIATED), newBadges: [] };
}

/** Recovery completed. */
export function applyRecoveryCompleted(stats: UserStats): { stats: UserStats; newBadges: string[] } {
  let s = addXp(stats, XP.PANIC_RECOVERY);
  s = { ...s, panicButtonUsedCount: s.panicButtonUsedCount + 1, panicButtonUsed: false };
  const newBadges: string[] = [];

  const hero = s.badges.find(b => b.id === "recovery-hero");
  if (hero && !hero.earned) { s = awardBadge(s, "recovery-hero"); s = addXp(s, XP.BADGE_BONUS); newBadges.push("recovery-hero"); }

  if (s.panicButtonUsedCount === 3) {
    const bb = s.badges.find(b => b.id === "bounce-back");
    if (bb && !bb.earned) { s = awardBadge(s, "bounce-back"); s = addXp(s, XP.BADGE_BONUS); newBadges.push("bounce-back"); }
  }
  return { stats: s, newBadges };
}

// ---------------------------------------------------------------------------
// Chrome storage I/O
// ---------------------------------------------------------------------------
/** Load UserStats from chrome.storage.local. Always succeeds (returns defaults on error). */
export async function loadStats(): Promise<UserStats> {
  return new Promise<UserStats>((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.USER_STATS], (result) => {
      if (chrome.runtime.lastError || !result[STORAGE_KEYS.USER_STATS]) {
        resolve(getDefaultStats());
        return;
      }
      const raw = result[STORAGE_KEYS.USER_STATS] as Partial<UserStats>;
      const defaults = getDefaultStats();
      // Merge: preserve earned badges from storage, add any new catalog badges
      const savedBadgeMap = new Map((raw.badges ?? []).map((b: Badge) => [b.id, b]));
      const badges = BADGE_CATALOG.map(template => {
        const saved = savedBadgeMap.get(template.id);
        if (saved) return { ...template, earned: saved.earned, earnedAt: saved.earnedAt };
        return { ...template };
      });
      const merged: UserStats = {
        ...defaults,
        ...raw,
        badges,
        level: levelFromXp(raw.xp ?? 0),
        maxXp: XP_PER_LEVEL,
        dangerSitesVisited: raw.dangerSitesVisited ?? raw.dangerSitesClicked ?? 0,
        dangerSitesClicked: raw.dangerSitesClicked ?? raw.dangerSitesVisited ?? 0,
      };
      resolve(merged);
    });
  });
}

/** Save UserStats to chrome.storage.local. */
export async function saveStats(stats: UserStats): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEYS.USER_STATS]: stats }, () => {
      if (chrome.runtime.lastError) { reject(chrome.runtime.lastError); return; }
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Mutex-protected updateStats
// The queue passes forward the last-written stats to avoid stale reads.
// ---------------------------------------------------------------------------
let statsQueue: Promise<UserStats> = Promise.resolve(getDefaultStats());

/**
 * Thread-safe stats update.
 * Rather than reloading from storage on each call (which can cause stale reads
 * under concurrent writes), we chain on the queue so the next write always
 * sees the result of the previous one.
 */
export function updateStats(
  updater: (stats: UserStats) => UserStats | { stats: UserStats; newBadges: string[] }
): Promise<{ stats: UserStats; newBadges: string[] }> {
  const next = statsQueue.then(async (prevStats) => {
    // Re-load from storage to pick up any out-of-band changes (e.g. popup edits),
    // but use prevStats as the base if storage is empty (fresh session).
    let current: UserStats;
    try {
      current = await loadStats();
      // If the stored XP is behind what we've accumulated in the queue, use the queue value.
      // This prevents concurrent writes from clobbering each other.
      if (current.xp < prevStats.xp) current = prevStats;
    } catch {
      current = prevStats;
    }

    const result = updater(current);
    let newStats: UserStats;
    let newBadges: string[];
    if ("stats" in result && "newBadges" in result) {
      newStats = result.stats;
      newBadges = result.newBadges;
    } else {
      newStats = result as UserStats;
      newBadges = [];
    }
    await saveStats(newStats);
    return { stats: newStats, newBadges };
  });
  // Keep the queue alive even on error — pass forward the last good state
  statsQueue = next.then(r => r.stats).catch(() => loadStats());
  return next;
}

// ---------------------------------------------------------------------------
// Risk level storage
// ---------------------------------------------------------------------------
export async function loadRiskLevel(): Promise<RiskLevel> {
  return new Promise<RiskLevel>((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.RISK_LEVEL], (r) => {
      resolve((r[STORAGE_KEYS.RISK_LEVEL] as RiskLevel) ?? "safe");
    });
  });
}

export function saveRiskLevel(level: RiskLevel): void {
  chrome.storage.local.set({ [STORAGE_KEYS.RISK_LEVEL]: level });
}

// ---------------------------------------------------------------------------
// Risk event log (last 50)
// ---------------------------------------------------------------------------
export async function loadRiskEvents(): Promise<RiskEvent[]> {
  return new Promise<RiskEvent[]>((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.RISK_EVENTS], (r) => {
      resolve((r[STORAGE_KEYS.RISK_EVENTS] as RiskEvent[]) ?? []);
    });
  });
}

export async function saveRiskEvent(event: RiskEvent): Promise<void> {
  const existing = await loadRiskEvents();
  const updated = [event, ...existing].slice(0, 50);
  return new Promise<void>((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEYS.RISK_EVENTS]: updated }, resolve);
  });
}