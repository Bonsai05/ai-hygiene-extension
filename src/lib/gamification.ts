// Gamification logic: XP rewards, badge awards, and progression
import {
    type UserStats,
    type Badge,
    loadStats,
    saveStats,
    addXp,
    awardBadge,
    xpForLevel,
    maxXpForLevel,
} from "./storage";

export const XP_REWARDS = {
    SAFE_BROWSE: 5,           // Visited a page safely
    WARNING_IGNORED: 10,      // Saw a warning and continued safely
    DANGER_AVOIDED: 25,       // Avoided a dangerous page
    PANIC_RECOVERY_COMPLETE: 30, // Completed all recovery steps
    PANIC_INITIATED: 5,       // Just clicked the panic button (encouragement to use it)
    BADGE_EARNED: 50,         // Per-badge bonus
    STREAK_MILESTONE: 15,     // Every 10-page safe streak
} as const;

export const STREAK_BADGES = [10, 25, 50, 100] as const;

// Award XP for safe browsing
export async function awardSafeBrowsingXp(stats: UserStats): Promise<UserStats> {
    let updated = addXp(stats, XP_REWARDS.SAFE_BROWSE);
    updated.safeBrowsingStreak += 1;
    updated.totalPagesAnalyzed += 1;

    // Check streak milestones
    const streak = updated.safeBrowsingStreak;
    if (STREAK_BADGES.includes(streak as 10 | 25 | 50 | 100)) {
        updated = awardBadge(updated, "streak-starter");
        updated = addXp(updated, XP_REWARDS.STREAK_MILESTONE);
    }

    // First safe page badge
    if (streak === 1) {
        updated = awardBadge(updated, "safe-surfer");
    }

    return updated;
}

// Award XP when user avoided a danger-level risk
export async function awardDangerAvoidedXp(stats: UserStats): Promise<UserStats> {
    let updated = addXp(stats, XP_REWARDS.DANGER_AVOIDED);
    updated.phishingAttemptsAvoided += 1;
    updated.safeBrowsingStreak += 1;
    updated.totalPagesAnalyzed += 1;

    // Phish spotter badge (first phishing attempt avoided)
    if (updated.phishingAttemptsAvoided === 1) {
        updated = awardBadge(updated, "phish-spotter");
    }

    return updated;
}

// Called when user clicks the panic button
export async function onPanicButtonClicked(stats: UserStats): Promise<UserStats> {
    let updated = stats;
    updated.panicButtonUsed = true;
    updated = addXp(updated, XP_REWARDS.PANIC_INITIATED);
    // Badge is awarded when they close the modal after reading
    return updated;
}

// Called when user completes the recovery flow
export async function onRecoveryCompleted(stats: UserStats): Promise<UserStats> {
    let updated = addXp(stats, XP_REWARDS.PANIC_RECOVERY_COMPLETE);
    updated = awardBadge(updated, "recovery-hero");
    updated = addXp(updated, XP_REWARDS.BADGE_EARNED);
    updated.panicButtonUsed = false; // Reset for next time
    return updated;
}

// Check if user earns XP for a safe login (HTTPS site with password field they didn't enter)
export async function onSecureLoginAttempt(stats: UserStats): Promise<UserStats> {
    let updated = addXp(stats, XP_REWARDS.SAFE_BROWSE);
    updated = awardBadge(updated, "secure-login");
    return updated;
}

// XP to award when a badge is earned
export async function onBadgeEarned(stats: UserStats, badgeId: string): Promise<UserStats> {
    let updated = awardBadge(stats, badgeId);
    updated = addXp(updated, XP_REWARDS.BADGE_EARNED);
    return updated;
}

// --- Badge query helpers ---
export function getEarnedBadges(stats: UserStats): Badge[] {
    return stats.badges.filter(b => b.earned);
}

export function getUnearnedBadges(stats: UserStats): Badge[] {
    return stats.badges.filter(b => !b.earned);
}

export function getBadgeById(stats: UserStats, id: string): Badge | undefined {
    return stats.badges.find(b => b.id === id);
}

// --- Level display helpers ---
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
    return titles[level] || `Level ${level}`;
}

export function getXpToNextLevel(xp: number, level: number): { current: number; needed: number } {
    const currentLevelXp = xpForLevel(level);
    const nextLevelXp = maxXpForLevel(level);
    return {
        current: xp - currentLevelXp,
        needed: nextLevelXp - currentLevelXp,
    };
}
