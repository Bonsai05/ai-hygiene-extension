// src/lib/gamification.ts
// COMPATIBILITY SHIM — All XP/badge logic lives in storage.ts.
// This file provides the function signatures expected by gamification.test.ts.
// The test imports functions with "action-verb" names (e.g. awardSafeBrowsingXp)
// while the storage module uses "apply-verb" names (e.g. applySafeBrowse).

export {
  getLevelTitle,
  xpInLevel,
  applySafeBrowse,
  applyDanger,
  applyRiskyAction,
  applyDangerAvoided,
  applySecureLogin,
  applyPasswordOnHttp,
  applyPanicInitiated,
  applyRecoveryCompleted,
  addXp,
  awardBadge,
} from "./storage";

import { xpInLevel } from "./storage";
import { XP_PER_LEVEL } from "./constants";
import type { UserStats } from "./storage";
import {
  applySafeBrowse,
  applyDanger,
  applyDangerAvoided,
  applySecureLogin,
  applyPasswordOnHttp,
  applyPanicInitiated,
  applyRecoveryCompleted,
} from "./storage";

// ---------------------------------------------------------------------------
// Aliases matching gamification.test.ts import names
// These are async wrappers that return the updated UserStats directly (not
// the {stats, newBadges} tuple) for simpler test assertions.
// ---------------------------------------------------------------------------

/** Award safe-browsing XP. Returns updated stats. */
export async function awardSafeBrowsingXp(stats: UserStats): Promise<UserStats> {
  return applySafeBrowse(stats, "safe").stats;
}

/** Apply danger penalty (-15 XP, streak reset). Returns updated stats. */
export async function applyDangerPenalty(stats: UserStats): Promise<UserStats> {
  return applyDanger(stats).stats;
}

/** Award danger-avoided XP (+25 XP). Returns updated stats. */
export async function awardDangerAvoidedXp(stats: UserStats): Promise<UserStats> {
  return applyDangerAvoided(stats).stats;
}

/** Called when panic button is clicked (+5 XP). Returns updated stats. */
export async function onPanicButtonClicked(stats: UserStats): Promise<UserStats> {
  return applyPanicInitiated(stats).stats;
}

/** Called when recovery is completed (+30 XP + badge). Returns updated stats. */
export async function onRecoveryCompleted(stats: UserStats): Promise<UserStats> {
  return applyRecoveryCompleted(stats).stats;
}

/** Called when user logs in on HTTPS (+10 XP + badge). Returns updated stats. */
export async function onSecureLoginAttempt(stats: UserStats): Promise<UserStats> {
  return applySecureLogin(stats).stats;
}

/** Called when password field is detected on HTTP (badge only). Returns updated stats. */
export async function onPasswordFieldHttp(stats: UserStats): Promise<UserStats> {
  return applyPasswordOnHttp(stats).stats;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Legacy helper — kept for test compatibility. */
export function getXpToNextLevel(xp: number, _level: number): { current: number; needed: number } {
  return { current: xpInLevel(xp), needed: XP_PER_LEVEL };
}

/** Return badge objects that became earned between two stat snapshots. */
export function getNewlyEarnedBadges(
  before: { badges: Array<{ id: string; earned: boolean }> },
  after: { badges: Array<{ id: string; earned: boolean }> }
): Array<{ id: string; earned: boolean }> {
  return after.badges.filter(b => {
    if (!b.earned) return false;
    const prev = before.badges.find(p => p.id === b.id);
    return prev && !prev.earned;
  });
}