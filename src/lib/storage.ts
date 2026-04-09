// src/lib/storage.ts — Phase 2B
// Changes vs Phase 2A:
//   1. Mutex queue for concurrent XP/badge updates (prevents race conditions)
//   2. Error handling for Chrome storage (quota exceeded, corrupted data)
//   3. Constants imported from constants.ts

import { STORAGE_KEYS, MAX_LEVEL, LEVEL_THRESHOLDS } from "./constants";

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
  maxXp: number;
  level: number;
  badges: Badge[];
  tips: QuickTip[];
  safeBrowsingStreak: number;
  totalPagesAnalyzed: number;
  phishingAttemptsAvoided: number;
  dangerSitesClicked: number;
  secureLoginsDetected: number;
  panicButtonUsed: boolean;
  panicButtonUsedCount: number;   // tracks total recovery completions for bounce-back badge
  createdAt: number;
  lastUpdated: number;
}

export interface RiskEvent {
  url: string;
  riskLevel: "safe" | "warning" | "danger";
  detectedPatterns: string[];
  timestamp: number;
  xpChange: number;   // positive = earned, negative = deducted
}

// --- XP thresholds (total XP to reach that level) ---
// Using constants from constants.ts for single source of truth

export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  if (level >= LEVEL_THRESHOLDS.length) return LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
  return LEVEL_THRESHOLDS[level - 1];
}

export function maxXpForLevel(level: number): number {
  if (level >= LEVEL_THRESHOLDS.length) return LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
  return LEVEL_THRESHOLDS[level];
}

export function levelFromXp(xp: number): number {
  let level = 1;
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= LEVEL_THRESHOLDS[i]) { level = i + 1; break; }
  }
  return Math.min(level, MAX_LEVEL);
}

/** XP progress within the current level — resets to 0 on level up. Use this for the bar. */
export function xpProgressInLevel(xp: number, level: number): { current: number; max: number } {
  return {
    current: xp - xpForLevel(level),
    max: maxXpForLevel(level) - xpForLevel(level),
  };
}

// --- Badge helpers ---
export function awardBadge(stats: UserStats, badgeId: string): UserStats {
  const badges = stats.badges.map(b =>
    b.id === badgeId && !b.earned
      ? { ...b, earned: true, earnedAt: Date.now() }
      : b
  );
  return { ...stats, badges, lastUpdated: Date.now() };
}

export function addXp(stats: UserStats, amount: number): UserStats {
  const newXp = Math.max(0, stats.xp + amount);
  const newLevel = levelFromXp(newXp);
  return {
    ...stats,
    xp: newXp,
    level: newLevel,
    maxXp: maxXpForLevel(newLevel),
    lastUpdated: Date.now(),
  };
}

export function removeXp(stats: UserStats, amount: number): UserStats {
  return addXp(stats, -amount);
}

// --- Full 12-badge catalog ---
// 4 categories × 3 tiers (bronze → silver → gold)
const ALL_BADGES: Badge[] = [
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

const DEFAULT_STATS: UserStats = {
  xp: 0,
  maxXp: 100,
  level: 1,
  badges: ALL_BADGES.map(b => ({ ...b })),
  tips: [
    { id: "tip-1", text: "Always check the URL bar before entering any password.", type: "info" },
    { id: "tip-2", text: "HTTPS alone isn't enough — verify the domain is correct.", type: "info" },
    { id: "tip-3", text: "No legitimate site will ask for your password via email.", type: "warning" },
  ],
  safeBrowsingStreak: 0,
  totalPagesAnalyzed: 0,
  phishingAttemptsAvoided: 0,
  dangerSitesClicked: 0,
  secureLoginsDetected: 0,
  panicButtonUsed: false,
  panicButtonUsedCount: 0,
  createdAt: Date.now(),
  lastUpdated: Date.now(),
};

export function getDefaultStats(): UserStats {
  return { ...DEFAULT_STATS, badges: ALL_BADGES.map(b => ({ ...b })) };
}

// ---------------------------------------------------------------------------
// Mutex queue for concurrent updates (prevents race conditions)
// ---------------------------------------------------------------------------
let statsLock = Promise.resolve();
let lastXpAwardTime = 0;

/**
 * Update stats with mutex protection - prevents race conditions when multiple
 * XP awards happen simultaneously (e.g., safe browsing + streak milestone)
 */
export async function updateStats(
  updater: (stats: UserStats) => UserStats | Promise<UserStats>
): Promise<UserStats> {
  statsLock = statsLock.then(async () => {
    const current = await loadStats();
    const updated = await updater(current);
    await saveStats(updated);
    return updated;
  });
  return statsLock;
}

/**
 * Check if XP can be awarded (rate limiting to prevent rapid-fire awards)
 */
export function canAwardXp(): boolean {
  const now = Date.now();
  if (now - lastXpAwardTime < 5000) return false; // 5 second cooldown
  lastXpAwardTime = now;
  return true;
}

/**
 * Reset XP cooldown (for testing)
 */
export function resetXpCooldown(): void {
  lastXpAwardTime = 0;
}

// ---------------------------------------------------------------------------
// Storage access with error handling
// ---------------------------------------------------------------------------
export function loadStats(): Promise<UserStats> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.USER_STATS], (result) => {
      // Error handling for storage issues
      if (chrome.runtime.lastError) {
        console.error("[Storage] Load failed:", chrome.runtime.lastError);
        resolve(getDefaultStats()); // Fallback to defaults
        return;
      }

      if (result[STORAGE_KEYS.USER_STATS]) {
        const raw = result[STORAGE_KEYS.USER_STATS];
        const merged: UserStats = { ...getDefaultStats(), ...raw };
        // Always recompute maxXp from level (fixes stale 100s)
        merged.maxXp = maxXpForLevel(merged.level);
        // Merge badge catalog — preserve earned/earnedAt, add any new badges, keep order
        const existingMap = new Map<string, Badge>(
          (raw.badges ?? []).map((b: Badge) => [b.id, b])
        );
        merged.badges = ALL_BADGES.map(template => {
          const existing = existingMap.get(template.id);
          if (existing) return { ...template, earned: existing.earned, earnedAt: existing.earnedAt };
          return { ...template };
        });
        resolve(merged);
      } else {
        resolve(getDefaultStats());
      }
    });
  });
}

export function saveStats(stats: UserStats): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEYS.USER_STATS]: stats }, () => {
      // Error handling for storage quota exceeded, etc.
      if (chrome.runtime.lastError) {
        console.error("[Storage] Save failed:", chrome.runtime.lastError);
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });
}

export function loadRiskLevel(): Promise<"safe" | "warning" | "danger"> {
  return new Promise((resolve) => {
    chrome.storage.local.get(["currentRiskLevel"], (result) => {
      resolve(result.currentRiskLevel ?? "safe");
    });
  });
}

export function saveRiskLevel(level: "safe" | "warning" | "danger"): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ currentRiskLevel: level }, resolve);
  });
}

// --- Risk event log (last 50, newest first) ---
export async function loadRiskEvents(): Promise<RiskEvent[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.RISK_EVENTS], (result) => {
      resolve(result[STORAGE_KEYS.RISK_EVENTS] ?? []);
    });
  });
}

export async function saveRiskEvent(event: RiskEvent): Promise<void> {
  const existing = await loadRiskEvents();
  const updated = [event, ...existing].slice(0, 50);
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEYS.RISK_EVENTS]: updated }, resolve);
  });
}