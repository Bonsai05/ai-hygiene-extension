// src/lib/gamification.ts
// Fixed version — key changes vs original:
//   1. XP_REWARDS values tuned for meaningful progression
//   2. awardSafeBrowsingXp: streak badge logic checks correct badge IDs per milestone
//   3. awardDangerAvoidedXp: now called when user navigates AWAY from a danger page
//   4. getLevelTitle / getXpToNextLevel unchanged but re-exported cleanly
//   5. No duplicate "safe-surfer" badge award on every page visit

import {
  type UserStats,
  addXp,
  removeXp,
  awardBadge,
  xpProgressInLevel,
  maxXpForLevel,
} from "./storage";

// --- XP reward table ---
// These are the ONLY places XP should be awarded. All callers import from here.
export const XP_REWARDS = {
  SAFE_BROWSE: 5,                // Visited a page safely
  WARNING_IGNORED: 10,           // Saw a warning, continued safely anyway
  DANGER_AVOIDED: 25,            // Backed away from a danger-flagged page
  DANGER_PENALTY: 15,            // Penalty for proceeding into a danger page (deducted)
  PANIC_RECOVERY_COMPLETE: 30,   // Completed all recovery steps after panic
  PANIC_INITIATED: 5,            // Clicked the panic button (encouragement)
  BADGE_EARNED: 50,              // Bonus per badge earned
  STREAK_MILESTONE: 15,          // Every streak milestone (10, 25, 50, 100 pages)
} as const;

// Streak milestones that unlock badges
const STREAK_MILESTONES: Record<number, string> = {
  10: "streak-starter",
  25: "streak-veteran",
  50: "streak-master",
  100: "streak-legend",
};

// --- Award XP for a safe page visit ---
export async function awardSafeBrowsingXp(stats: UserStats): Promise<UserStats> {
  let updated = addXp(stats, XP_REWARDS.SAFE_BROWSE);
  updated.safeBrowsingStreak = (updated.safeBrowsingStreak ?? 0) + 1;
  updated.totalPagesAnalyzed = (updated.totalPagesAnalyzed ?? 0) + 1;

  const streak = updated.safeBrowsingStreak;

  // First safe page ever — award safe-surfer badge (once only)
  if (streak === 1) {
    const badge = updated.badges.find(b => b.id === "safe-surfer");
    if (badge && !badge.earned) {
      updated = awardBadge(updated, "safe-surfer");
      updated = addXp(updated, XP_REWARDS.BADGE_EARNED);
    }
  }

  // Streak milestone badges — only award the specific badge for THIS milestone
  if (STREAK_MILESTONES[streak]) {
    const badgeId = STREAK_MILESTONES[streak];
    const badge = updated.badges.find(b => b.id === badgeId);
    if (badge && !badge.earned) {
      updated = awardBadge(updated, badgeId);
      updated = addXp(updated, XP_REWARDS.STREAK_MILESTONE);
      updated = addXp(updated, XP_REWARDS.BADGE_EARNED);
    }
  }

  return updated;
}

// --- Award XP when user successfully avoided a danger-level page ---
// Call this when: the user navigated away from a page that was flagged DANGER
// (i.e. they saw the banner and left, rather than staying and interacting)
export async function awardDangerAvoidedXp(stats: UserStats): Promise<UserStats> {
  let updated = addXp(stats, XP_REWARDS.DANGER_AVOIDED);
  updated.phishingAttemptsAvoided = (updated.phishingAttemptsAvoided ?? 0) + 1;
  updated.safeBrowsingStreak = (updated.safeBrowsingStreak ?? 0) + 1;
  updated.totalPagesAnalyzed = (updated.totalPagesAnalyzed ?? 0) + 1;

  // First phishing attempt avoided
  const phishSpotter = updated.badges.find(b => b.id === "phish-spotter");
  if (phishSpotter && !phishSpotter.earned) {
    updated = awardBadge(updated, "phish-spotter");
    updated = addXp(updated, XP_REWARDS.BADGE_EARNED);
  }

  // 3 danger sites avoided — award danger-survivor badge
  if (updated.phishingAttemptsAvoided === 3) {
    const survivor = updated.badges.find(b => b.id === "danger-survivor");
    if (survivor && !survivor.earned) {
      updated = awardBadge(updated, "danger-survivor");
      updated = addXp(updated, XP_REWARDS.BADGE_EARNED);
    }
  }

  return updated;
}

// --- Apply XP penalty when user proceeded into a danger page ---
// Called from background.ts when finalLevel === "danger" and URL was visited
export async function applyDangerPenalty(stats: UserStats): Promise<UserStats> {
  let updated = removeXp(stats, XP_REWARDS.DANGER_PENALTY);
  updated.safeBrowsingStreak = 0;   // reset streak
  updated.dangerSitesClicked = (updated.dangerSitesClicked ?? 0) + 1;
  return updated;
}

// --- Called when user clicks the panic button ---
export async function onPanicButtonClicked(stats: UserStats): Promise<UserStats> {
  let updated = stats;
  updated.panicButtonUsed = true;
  updated = addXp(updated, XP_REWARDS.PANIC_INITIATED);
  return updated;
}

// --- Called when user completes the recovery flow ---
export async function onRecoveryCompleted(stats: UserStats): Promise<UserStats> {
  let updated = addXp(stats, XP_REWARDS.PANIC_RECOVERY_COMPLETE);

  const badge = updated.badges.find(b => b.id === "recovery-hero");
  if (badge && !badge.earned) {
    updated = awardBadge(updated, "recovery-hero");
    updated = addXp(updated, XP_REWARDS.BADGE_EARNED);
  }

  updated.panicButtonUsed = false;   // reset for next time
  return updated;
}

// --- Called when user logs in securely (HTTPS + password field) ---
export async function onSecureLoginAttempt(stats: UserStats): Promise<UserStats> {
  let updated = addXp(stats, XP_REWARDS.SAFE_BROWSE);
  const badge = updated.badges.find(b => b.id === "secure-login");
  if (badge && !badge.earned) {
    updated = awardBadge(updated, "secure-login");
    updated = addXp(updated, XP_REWARDS.BADGE_EARNED);
  }
  return updated;
}

// --- Badge query helpers ---
export function getEarnedBadges(stats: UserStats) {
  return stats.badges.filter(b => b.earned);
}

export function getUnearnedBadges(stats: UserStats) {
  return stats.badges.filter(b => !b.earned);
}

// --- Level display ---
export function getLevelTitle(level: number): string {
  const titles: Record<number, string> = {
    1: "Newcomer",
    2: "Browser",
    3: "Surfer",
    4: "Defender",
    5: "Guardian",
    6: "Sentinel",
    7: "Shield Master",
    8: "Security Expert",
    9: "Cyber Guardian",
    10: "Digital Hygiene Hero",
  };
  return titles[level] ?? `Level ${level}`;
}

// --- XP progress within the current level (for the UI bar) ---
// Returns { current, needed } where current resets to 0 on each level up
export function getXpToNextLevel(xp: number, level: number): { current: number; needed: number } {
  const progress = xpProgressInLevel(xp, level);
  return {
    current: progress.current,
    needed: progress.max,
  };
}