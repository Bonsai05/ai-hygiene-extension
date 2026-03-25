// Storage utilities for the extension
// All chrome.storage access goes through these helpers

export interface Badge {
    id: string;
    name: string;
    icon: "shield" | "lock" | "eye" | "key" | "zap" | "award" | "check" | "alert";
    earned: boolean;
    description: string;
    earnedAt?: number; // timestamp
}

export interface QuickTip {
    id: string;
    text: string;
    type: "info" | "success";
}

export interface UserStats {
    xp: number;
    maxXp: number;
    level: number;
    badges: Badge[];
    tips: QuickTip[];
    safeBrowsingStreak: number; // consecutive safe pages visited
    totalPagesAnalyzed: number;
    phishingAttemptsAvoided: number;
    panicButtonUsed: boolean; // tracks if user used panic button this session
    createdAt: number;
    lastUpdated: number;
}

export interface RiskEvent {
    url: string;
    riskLevel: "safe" | "warning" | "danger";
    detectedPatterns: string[]; // e.g. ["http Protocol", "login_form", "external_redirect"]
    timestamp: number;
    xpAwarded: number;
}

const DEFAULT_STATS: UserStats = {
    xp: 0,
    maxXp: 100,
    level: 1,
    badges: [
        {
            id: "phish-spotter",
            name: "Phish Spotter",
            icon: "eye",
            earned: false,
            description: "Avoided a phishing link and continued safely.",
        },
        {
            id: "password-pro",
            name: "Password Pro",
            icon: "lock",
            earned: false,
            description: "Identified a password field on an unsecured page.",
        },
        {
            id: "safe-surfer",
            name: "Safe Surfer",
            icon: "shield",
            earned: false,
            description: "Completed your first safe browsing session.",
        },
        {
            id: "streak-starter",
            name: "Streak Starter",
            icon: "zap",
            earned: false,
            description: "Visited 10 pages without triggering any warnings.",
        },
        {
            id: "recovery-hero",
            name: "Recovery Hero",
            icon: "award",
            earned: false,
            description: "Used the panic button and followed all recovery steps.",
        },
        {
            id: "secure-login",
            name: "Secure Login",
            icon: "check",
            earned: false,
            description: "Logged into a site using HTTPS with visible security indicators.",
        },
    ],
    tips: [
        { id: "tip-1", text: "Always check the URL bar before entering any password.", type: "info" },
        { id: "tip-2", text: "HTTPS alone isn't enough — verify the domain is correct.", type: "info" },
        { id: "tip-3", text: "No legitimate site will ask for your password via email.", type: "warning" as const },
    ],
    safeBrowsingStreak: 0,
    totalPagesAnalyzed: 0,
    phishingAttemptsAvoided: 0,
    panicButtonUsed: false,
    createdAt: Date.now(),
    lastUpdated: Date.now(),
};

export function getDefaultStats(): UserStats {
    return { ...DEFAULT_STATS, badges: DEFAULT_STATS.badges.map(b => ({ ...b })) };
}

// --- XP thresholds per level ---
const XP_PER_LEVEL = [0, 100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500];

export function xpForLevel(level: number): number {
    if (level <= 1) return 0;
    if (level >= XP_PER_LEVEL.length) return XP_PER_LEVEL[XP_PER_LEVEL.length - 1];
    return XP_PER_LEVEL[level - 1];
}

export function maxXpForLevel(level: number): number {
    if (level >= XP_PER_LEVEL.length) return XP_PER_LEVEL[XP_PER_LEVEL.length - 1];
    return XP_PER_LEVEL[level];
}

export function levelFromXp(xp: number): number {
    let level = 1;
    for (let i = XP_PER_LEVEL.length - 1; i >= 0; i--) {
        if (xp >= XP_PER_LEVEL[i]) {
            level = i + 1;
            break;
        }
    }
    return Math.min(level, XP_PER_LEVEL.length - 1);
}

export function xpProgressInLevel(xp: number, level: number): { current: number; max: number } {
    const levelStart = xpForLevel(level);
    const levelEnd = maxXpForLevel(level);
    return {
        current: xp - levelStart,
        max: levelEnd - levelStart,
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
    const newXp = stats.xp + amount;
    const newLevel = levelFromXp(newXp);
    return { ...stats, xp: newXp, level: newLevel, lastUpdated: Date.now() };
}

// --- Storage access ---
export function loadStats(): Promise<UserStats> {
    return new Promise((resolve) => {
        chrome.storage.local.get(["userStats"], (result) => {
            if (result.userStats) {
                // Merge with defaults to handle new fields from updates
                resolve({ ...getDefaultStats(), ...result.userStats });
            } else {
                resolve(getDefaultStats());
            }
        });
    });
}

export function saveStats(stats: UserStats): Promise<void> {
    return new Promise((resolve) => {
        chrome.storage.local.set({ userStats: stats }, resolve);
    });
}

export async function updateStats(updater: (stats: UserStats) => UserStats | Promise<UserStats>): Promise<UserStats> {
    const current = await loadStats();
    const updated = await updater(current);
    await saveStats(updated);
    return updated;
}

export function loadRiskLevel(): Promise<"safe" | "warning" | "danger"> {
    return new Promise((resolve) => {
        chrome.storage.local.get(["currentRiskLevel"], (result) => {
            resolve(result.currentRiskLevel || "safe");
        });
    });
}

export function saveRiskLevel(level: "safe" | "warning" | "danger"): Promise<void> {
    return new Promise((resolve) => {
        chrome.storage.local.set({ currentRiskLevel: level }, resolve);
    });
}
