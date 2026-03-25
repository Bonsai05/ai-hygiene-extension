// storage.ts — Fixed version
// Key changes:
//   1. Added removeXp() for danger deductions
//   2. maxXp in UserStats now auto-updates (was hardcoded 100)
//   3. xpProgressInLevel() exported for UI use

export interface Badge {
  id: string;
  name: string;
  icon: "shield" | "lock" | "eye" | "key" | "zap" | "award" | "check" | "alert";
  earned: boolean;
  description: string;
  earnedAt?: number;
}

export interface QuickTip {
  id: string;
  text: string;
  type: "info" | "success";
}

export interface UserStats {
  xp: number;
  maxXp: number;       // XP needed for NEXT level (updates on level up)
  level: number;
  badges: Badge[];
  tips: QuickTip[];
  safeBrowsingStreak: number;
  totalPagesAnalyzed: number;
  phishingAttemptsAvoided: number;
  dangerSitesClicked: number;   // NEW: track bad clicks
  panicButtonUsed: boolean;
  createdAt: number;
  lastUpdated: number;
}

export interface RiskEvent {
  url: string;
  riskLevel: "safe" | "warning" | "danger";
  detectedPatterns: string[];
  timestamp: number;
  xpAwarded: number;
}

// --- XP thresholds per level ---
// xpForLevel(n) = total XP needed to REACH level n
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

/**
 * Returns XP progress WITHIN the current level.
 * This is what the UI bar should display — resets to 0 on level up.
 */
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
  const newXp = Math.max(0, stats.xp + amount);  // floor at 0
  const newLevel = levelFromXp(newXp);
  const newMaxXp = maxXpForLevel(newLevel);       // keep maxXp in sync with level
  return { ...stats, xp: newXp, level: newLevel, maxXp: newMaxXp, lastUpdated: Date.now() };
}

/**
 * NEW: Deduct XP (e.g. user clicked a dangerous link).
 * XP floors at 0, level can drop.
 */
export function removeXp(stats: UserStats, amount: number): UserStats {
  return addXp(stats, -amount);  // addXp already clamps to 0
}

const DEFAULT_STATS: UserStats = {
  xp: 0,
  maxXp: 100,    // XP_PER_LEVEL[1] = 100 (first level threshold)
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
      id: "streak-veteran",
      name: "Streak Veteran",
      icon: "zap",
      earned: false,
      description: "Visited 25 pages without triggering any warnings.",
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
    {
      id: "danger-survivor",
      name: "Danger Survivor",
      icon: "alert",
      earned: false,
      description: "Navigated away from 3 dangerous sites.",
    },
  ],
  tips: [
    { id: "tip-1", text: "Always check the URL bar before entering any password.", type: "info" },
    { id: "tip-2", text: "HTTPS alone isn't enough — verify the domain is correct.", type: "info" },
    { id: "tip-3", text: "No legitimate site will ask for your password via email.", type: "info" },
  ],
  safeBrowsingStreak: 0,
  totalPagesAnalyzed: 0,
  phishingAttemptsAvoided: 0,
  dangerSitesClicked: 0,
  panicButtonUsed: false,
  createdAt: Date.now(),
  lastUpdated: Date.now(),
};

export function getDefaultStats(): UserStats {
  return { ...DEFAULT_STATS, badges: DEFAULT_STATS.badges.map(b => ({ ...b })) };
}

// --- Storage access ---
export function loadStats(): Promise<UserStats> {
  return new Promise((resolve) => {
    chrome.storage.local.get(["userStats"], (result) => {
      if (result.userStats) {
        // Merge with defaults to handle new fields from updates
        const merged = { ...getDefaultStats(), ...result.userStats };
        // Ensure maxXp is always correct for current level (fixes stale 100 values)
        merged.maxXp = maxXpForLevel(merged.level);
        // Ensure new badges from DEFAULT_STATS are added to existing installs
        const existingIds = new Set(merged.badges.map((b: Badge) => b.id));
        for (const defaultBadge of DEFAULT_STATS.badges) {
          if (!existingIds.has(defaultBadge.id)) {
            merged.badges.push({ ...defaultBadge });
          }
        }
        resolve(merged);
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

export async function updateStats(
  updater: (stats: UserStats) => UserStats | Promise<UserStats>
): Promise<UserStats> {
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