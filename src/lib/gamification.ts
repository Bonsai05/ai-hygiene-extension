// src/lib/gamification.ts
// COMPATIBILITY SHIM — All XP/badge logic has moved to storage.ts.
// This file re-exports from storage.ts so old test files still compile.

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