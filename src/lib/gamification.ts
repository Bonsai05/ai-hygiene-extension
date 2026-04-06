// src/lib/gamification.ts — Phase 2A
// Changes vs Phase 1:
//   1. All 12 badge unlock conditions implemented
//   2. onSecureLoginAttempt now actually called from background (was dead code)
//   3. onPasswordFieldHttp is a new soft-warning trigger (no XP loss, just a flag)
//   4. checkLevelUpBadge checks for hygiene-master at Level 5
//   5. getNewlyEarnedBadges helper for popup to detect level-up badge grants

import {
  type UserStats,
  addXp,
  removeXp,
  awardBadge,
  xpProgressInLevel,
} from "./storage";

// --- XP reward table (single source of truth) ---
export const XP_REWARDS = {
  SAFE_BROWSE: 5,
  WARNING_IGNORED: 10,
  DANGER_AVOIDED: 25,
  DANGER_PENALTY: 15,
  SECURE_LOGIN: 10,
  PANIC_RECOVERY_COMPLETE: 30,
  PANIC_INITIATED: 5,
  BADGE_EARNED: 50,
  STREAK_MILESTONE: 15,
} as const;

// Streak milestones: pages → badge id
const STREAK_MILESTONES: Record<number, string> = {
  10: "streak-starter",
  25: "streak-veteran",
  50: "streak-legend",
};

// --- Safe browsing XP + streak badges ---
export async function awardSafeBrowsingXp(stats: UserStats): Promise<UserStats> {
  let s = addXp(stats, XP_REWARDS.SAFE_BROWSE);
  s.safeBrowsingStreak = (s.safeBrowsingStreak ?? 0) + 1;
  s.totalPagesAnalyzed = (s.totalPagesAnalyzed ?? 0) + 1;

  const streak = s.safeBrowsingStreak;

  // safe-surfer: first safe page ever
  if (streak === 1) {
    const b = s.badges.find(b => b.id === "safe-surfer");
    if (b && !b.earned) {
      s = awardBadge(s, "safe-surfer");
      s = addXp(s, XP_REWARDS.BADGE_EARNED);
    }
  }

  // streak milestone badges
  const milestoneId = STREAK_MILESTONES[streak];
  if (milestoneId) {
    const b = s.badges.find(b => b.id === milestoneId);
    if (b && !b.earned) {
      s = awardBadge(s, milestoneId);
      s = addXp(s, XP_REWARDS.STREAK_MILESTONE);
      s = addXp(s, XP_REWARDS.BADGE_EARNED);
    }
  }

  return checkLevelUpBadge(s);
}

// --- Danger avoided (user navigated away from a danger page) ---
export async function awardDangerAvoidedXp(stats: UserStats): Promise<UserStats> {
  let s = addXp(stats, XP_REWARDS.DANGER_AVOIDED);
  s.phishingAttemptsAvoided = (s.phishingAttemptsAvoided ?? 0) + 1;
  s.safeBrowsingStreak = (s.safeBrowsingStreak ?? 0) + 1;
  s.totalPagesAnalyzed = (s.totalPagesAnalyzed ?? 0) + 1;

  // phish-spotter: first avoidance
  const phishSpotter = s.badges.find(b => b.id === "phish-spotter");
  if (phishSpotter && !phishSpotter.earned) {
    s = awardBadge(s, "phish-spotter");
    s = addXp(s, XP_REWARDS.BADGE_EARNED);
  }

  // danger-survivor: 3 avoidances
  if (s.phishingAttemptsAvoided === 3) {
    const b = s.badges.find(b => b.id === "danger-survivor");
    if (b && !b.earned) {
      s = awardBadge(s, "danger-survivor");
      s = addXp(s, XP_REWARDS.BADGE_EARNED);
    }
  }

  // threat-hunter: 10 total avoidances
  if (s.phishingAttemptsAvoided === 10) {
    const b = s.badges.find(b => b.id === "threat-hunter");
    if (b && !b.earned) {
      s = awardBadge(s, "threat-hunter");
      s = addXp(s, XP_REWARDS.BADGE_EARNED);
    }
  }

  return checkLevelUpBadge(s);
}

// --- Danger penalty (user loaded a dangerous page) ---
export async function applyDangerPenalty(stats: UserStats): Promise<UserStats> {
  let s = removeXp(stats, XP_REWARDS.DANGER_PENALTY);
  s.safeBrowsingStreak = 0;
  s.dangerSitesClicked = (s.dangerSitesClicked ?? 0) + 1;
  return s;
}

// --- Secure login detected (HTTPS + password field) ---
export async function onSecureLoginAttempt(stats: UserStats): Promise<UserStats> {
  let s = addXp(stats, XP_REWARDS.SECURE_LOGIN);
  s.secureLoginsDetected = (s.secureLoginsDetected ?? 0) + 1;

  // secure-login badge: first HTTPS login
  const b = s.badges.find(b => b.id === "secure-login");
  if (b && !b.earned) {
    s = awardBadge(s, "secure-login");
    s = addXp(s, XP_REWARDS.BADGE_EARNED);
  }

  // password-pro badge: detected a password field on HTTP — awarded from content-script signal
  return checkLevelUpBadge(s);
}

// --- Password field on HTTP detected (soft signal, no XP loss — just the badge) ---
export async function onPasswordFieldHttp(stats: UserStats): Promise<UserStats> {
  let s = stats;
  const b = s.badges.find(b => b.id === "password-pro");
  if (b && !b.earned) {
    s = awardBadge(s, "password-pro");
    s = addXp(s, XP_REWARDS.BADGE_EARNED);
  }
  return s;
}

// --- Panic button clicked ---
export async function onPanicButtonClicked(stats: UserStats): Promise<UserStats> {
  let s = stats;
  s.panicButtonUsed = true;
  s = addXp(s, XP_REWARDS.PANIC_INITIATED);
  return s;
}

// --- Recovery completed ---
export async function onRecoveryCompleted(stats: UserStats): Promise<UserStats> {
  let s = addXp(stats, XP_REWARDS.PANIC_RECOVERY_COMPLETE);
  s.panicButtonUsedCount = (s.panicButtonUsedCount ?? 0) + 1;
  s.panicButtonUsed = false;

  // recovery-hero: first recovery
  const hero = s.badges.find(b => b.id === "recovery-hero");
  if (hero && !hero.earned) {
    s = awardBadge(s, "recovery-hero");
    s = addXp(s, XP_REWARDS.BADGE_EARNED);
  }

  // bounce-back: 3 recoveries
  if (s.panicButtonUsedCount === 3) {
    const b = s.badges.find(b => b.id === "bounce-back");
    if (b && !b.earned) {
      s = awardBadge(s, "bounce-back");
      s = addXp(s, XP_REWARDS.BADGE_EARNED);
    }
  }

  return checkLevelUpBadge(s);
}

// --- Level-up badge check (hygiene-master at Level 5) ---
// Called after every XP-awarding function
function checkLevelUpBadge(stats: UserStats): UserStats {
  let s = stats;
  if (s.level >= 5) {
    const b = s.badges.find(b => b.id === "hygiene-master");
    if (b && !b.earned) {
      s = awardBadge(s, "hygiene-master");
      s = addXp(s, XP_REWARDS.BADGE_EARNED);
    }
  }
  return s;
}

// --- Helper: find badges that became earned between two stat snapshots ---
// Used in background.ts to detect which badges to announce
export function getNewlyEarnedBadges(before: UserStats, after: UserStats) {
  return after.badges.filter(b => {
    if (!b.earned) return false;
    const prev = before.badges.find(p => p.id === b.id);
    return prev && !prev.earned;
  });
}

// --- Level helpers ---
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

export function getXpToNextLevel(xp: number, level: number): { current: number; needed: number } {
  const p = xpProgressInLevel(xp, level);
  return { current: p.current, needed: p.max };
}