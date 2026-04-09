// Unit tests for gamification.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  awardSafeBrowsingXp,
  awardDangerAvoidedXp,
  applyDangerPenalty,
  onPanicButtonClicked,
  onRecoveryCompleted,
  onSecureLoginAttempt,
  onPasswordFieldHttp,
  getNewlyEarnedBadges,
  getLevelTitle,
  getXpToNextLevel,
  XP_REWARDS,
} from "./gamification";
import type { UserStats } from "./storage";

function createDefaultStats(): UserStats {
  return {
    xp: 0,
    maxXp: 100,
    level: 1,
    badges: [
      { id: "safe-surfer", name: "Safe Surfer", description: "Browse your first page safely", tier: "bronze", category: "habit", icon: "shield", earned: false },
      { id: "streak-starter", name: "Streak Starter", description: "10 page safe streak", tier: "bronze", category: "streak", icon: "award", earned: false },
      { id: "streak-veteran", name: "Streak Veteran", description: "25 page safe streak", tier: "silver", category: "streak", icon: "award", earned: false },
      { id: "streak-legend", name: "Streak Legend", description: "50 page safe streak", tier: "gold", category: "streak", icon: "award", earned: false },
      { id: "phish-spotter", name: "Phish Spotter", description: "Avoid your first phishing attempt", tier: "bronze", category: "threat", icon: "eye", earned: false },
      { id: "danger-survivor", name: "Danger Survivor", description: "Avoid 3 danger sites", tier: "silver", category: "threat", icon: "shield", earned: false },
      { id: "threat-hunter", name: "Threat Hunter", description: "Avoid 10 threats", tier: "gold", category: "threat", icon: "eye", earned: false },
      { id: "secure-login", name: "Secure Login", description: "Use HTTPS for login", tier: "bronze", category: "habit", icon: "lock", earned: false },
      { id: "password-pro", name: "Password Pro", description: "Detected password field on HTTP", tier: "bronze", category: "habit", icon: "key", earned: false },
      { id: "recovery-hero", name: "Recovery Hero", description: "Complete panic recovery", tier: "bronze", category: "recovery", icon: "zap", earned: false },
      { id: "bounce-back", name: "Bounce Back", description: "3 recoveries completed", tier: "silver", category: "recovery", icon: "check", earned: false },
      { id: "hygiene-master", name: "Hygiene Master", description: "Reach Level 5", tier: "gold", category: "habit", icon: "award", earned: false },
    ],
    tips: [],
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
}

describe("XP Rewards", () => {
  it("has expected reward values", () => {
    expect(XP_REWARDS.SAFE_BROWSE).toBe(5);
    expect(XP_REWARDS.DANGER_PENALTY).toBe(15);
    expect(XP_REWARDS.PANIC_RECOVERY_COMPLETE).toBe(30);
  });
});

describe("awardSafeBrowsingXp", () => {
  it("awards 5 XP for safe browsing", async () => {
    const stats = createDefaultStats();
    const result = await awardSafeBrowsingXp(stats);
    expect(result.xp).toBe(5);
    expect(result.safeBrowsingStreak).toBe(1);
    expect(result.totalPagesAnalyzed).toBe(1);
  });

  it("awards safe-surfer badge on first safe page", async () => {
    const stats = createDefaultStats();
    const result = await awardSafeBrowsingXp(stats);
    const safeSurfer = result.badges.find((b) => b.id === "safe-surfer");
    expect(safeSurfer?.earned).toBe(true);
    expect(result.xp).toBe(5 + XP_REWARDS.BADGE_EARNED); // 5 + 50
  });

  it("awards streak-starter badge at 10 pages", async () => {
    let stats = createDefaultStats();
    for (let i = 0; i < 10; i++) {
      stats = await awardSafeBrowsingXp(stats);
    }
    expect(stats.safeBrowsingStreak).toBe(10);
    const streakStarter = stats.badges.find((b) => b.id === "streak-starter");
    expect(streakStarter?.earned).toBe(true);
  });

  it("does not double-award badges", async () => {
    let stats = createDefaultStats();
    stats = await awardSafeBrowsingXp(stats); // Earn safe-surfer
    const xpAfterFirst = stats.xp;
    stats = await awardSafeBrowsingXp(stats); // Second page
    expect(stats.xp).toBe(xpAfterFirst + XP_REWARDS.SAFE_BROWSE); // Only 5 XP, no badge bonus
  });
});

describe("applyDangerPenalty", () => {
  it("removes 15 XP and resets streak", async () => {
    let stats = createDefaultStats();
    stats = await awardSafeBrowsingXp(stats); // +5 XP, streak = 1
    stats = await awardSafeBrowsingXp(stats); // +5 XP, streak = 2
    expect(stats.xp).toBe(10);
    expect(stats.safeBrowsingStreak).toBe(2);

    const result = await applyDangerPenalty(stats);
    expect(result.xp).toBe(-5); // 10 - 15
    expect(result.safeBrowsingStreak).toBe(0);
    expect(result.dangerSitesClicked).toBe(1);
  });
});

describe("awardDangerAvoidedXp", () => {
  it("awards 25 XP for avoiding danger", async () => {
    const stats = createDefaultStats();
    const result = await awardDangerAvoidedXp(stats);
    expect(result.xp).toBe(25);
    expect(result.phishingAttemptsAvoided).toBe(1);
  });

  it("awards phish-spotter badge on first avoidance", async () => {
    const stats = createDefaultStats();
    const result = await awardDangerAvoidedXp(stats);
    const phishSpotter = result.badges.find((b) => b.id === "phish-spotter");
    expect(phishSpotter?.earned).toBe(true);
    expect(result.xp).toBe(25 + XP_REWARDS.BADGE_EARNED);
  });

  it("awards danger-survivor badge at 3 avoidances", async () => {
    let stats = createDefaultStats();
    for (let i = 0; i < 3; i++) {
      stats = await awardDangerAvoidedXp(stats);
    }
    expect(stats.phishingAttemptsAvoided).toBe(3);
    const dangerSurvivor = stats.badges.find((b) => b.id === "danger-survivor");
    expect(dangerSurvivor?.earned).toBe(true);
  });
});

describe("onPanicButtonClicked and onRecoveryCompleted", () => {
  it("awards 5 XP for panic button click", async () => {
    const stats = createDefaultStats();
    const result = await onPanicButtonClicked(stats);
    expect(result.xp).toBe(5);
    expect(result.panicButtonUsed).toBe(true);
  });

  it("awards 30 XP + recovery-hero badge for completing recovery", async () => {
    let stats = createDefaultStats();
    stats = await onPanicButtonClicked(stats);
    const result = await onRecoveryCompleted(stats);
    expect(result.xp).toBe(5 + 30 + XP_REWARDS.BADGE_EARNED); // panic + recovery + badge
    expect(result.panicButtonUsed).toBe(false);
    expect(result.panicButtonUsedCount).toBe(1);
    const recoveryHero = result.badges.find((b) => b.id === "recovery-hero");
    expect(recoveryHero?.earned).toBe(true);
  });
});

describe("onSecureLoginAttempt", () => {
  it("awards 10 XP for secure login", async () => {
    const stats = createDefaultStats();
    const result = await onSecureLoginAttempt(stats);
    expect(result.xp).toBe(10);
    expect(result.secureLoginsDetected).toBe(1);
  });

  it("awards secure-login badge on first secure login", async () => {
    const stats = createDefaultStats();
    const result = await onSecureLoginAttempt(stats);
    const secureLogin = result.badges.find((b) => b.id === "secure-login");
    expect(secureLogin?.earned).toBe(true);
  });
});

describe("onPasswordFieldHttp", () => {
  it("awards password-pro badge without XP loss", async () => {
    const stats = createDefaultStats();
    const result = await onPasswordFieldHttp(stats);
    expect(result.xp).toBe(0); // No XP loss, just badge
    const passwordPro = result.badges.find((b) => b.id === "password-pro");
    expect(passwordPro?.earned).toBe(true);
  });
});

describe("getNewlyEarnedBadges", () => {
  it("finds badges earned between snapshots", () => {
    const before = createDefaultStats();
    const after = createDefaultStats();
    after.badges[0].earned = true; // safe-surfer

    const newBadges = getNewlyEarnedBadges(before, after);
    expect(newBadges.length).toBe(1);
    expect(newBadges[0].id).toBe("safe-surfer");
  });

  it("returns empty array when no new badges", () => {
    const before = createDefaultStats();
    const after = createDefaultStats();
    const newBadges = getNewlyEarnedBadges(before, after);
    expect(newBadges.length).toBe(0);
  });
});

describe("getLevelTitle", () => {
  it("returns correct titles for each level", () => {
    expect(getLevelTitle(1)).toBe("Newcomer");
    expect(getLevelTitle(5)).toBe("Guardian");
    expect(getLevelTitle(10)).toBe("Digital Hygiene Hero");
  });
});

describe("getXpToNextLevel", () => {
  it("returns progress within current level", () => {
    // Level 1: 0-100 XP
    const result = getXpToNextLevel(50, 1);
    expect(result.current).toBe(50);
    expect(result.needed).toBe(100);
  });
});
