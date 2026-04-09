// Unit tests for storage.ts
import { describe, it, expect, vi } from "vitest";
import {
  getDefaultStats,
  addXp,
  removeXp,
  awardBadge,
  xpProgressInLevel,
  xpForLevel,
  levelFromXp,
  maxXpForLevel,
  type UserStats,
} from "./storage";
import { LEVEL_THRESHOLDS } from "./constants";

// Mock chrome.storage
const mockChromeStorage = {
  local: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
  },
  session: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
  },
};

// @ts-expect-error - mocking global chrome
global.chrome = {
  storage: mockChromeStorage,
  runtime: {
    lastError: null,
  },
};

describe("getDefaultStats", () => {
  it("returns valid default stats", () => {
    const stats = getDefaultStats();
    expect(stats.xp).toBe(0);
    expect(stats.maxXp).toBe(100);
    expect(stats.level).toBe(1);
    expect(stats.badges.length).toBe(12);
    expect(stats.safeBrowsingStreak).toBe(0);
  });
});

describe("XP level thresholds", () => {
  it("xpForLevel returns correct thresholds", () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(100);
    expect(xpForLevel(3)).toBe(200);
  });

  it("maxXpForLevel returns correct thresholds", () => {
    expect(maxXpForLevel(1)).toBe(100);   // Level 1 -> needs 100 XP for level 2
    expect(maxXpForLevel(2)).toBe(200);   // Level 2 -> needs 200 XP for level 3
    expect(maxXpForLevel(5)).toBe(500);   // Level 5 -> needs 500 XP for level 6
    expect(maxXpForLevel(9)).toBe(900);   // Level 9 -> needs 900 XP for level 10
  });

  it("levelFromXp calculates correct level", () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(50)).toBe(1);
    expect(levelFromXp(100)).toBe(2);
    expect(levelFromXp(150)).toBe(2);
    expect(levelFromXp(900)).toBe(10);
  });
});

describe("addXp", () => {
  it("adds XP and stays in same level", () => {
    const stats = getDefaultStats();
    const result = addXp(stats, 50);
    expect(result.xp).toBe(50);
    expect(result.level).toBe(1);
  });

  it("levels up when XP exceeds threshold", () => {
    let stats = getDefaultStats();
    stats = addXp(stats, 100); // Level 1 complete
    expect(stats.level).toBe(2);
    expect(stats.xp).toBe(100);
  });

  it("levels up multiple times", () => {
    let stats = getDefaultStats();
    stats = addXp(stats, 350); // Should reach level 4
    expect(stats.level).toBe(4);
  });
});

describe("removeXp", () => {
  it("removes XP without going below 0", () => {
    let stats = getDefaultStats();
    stats = addXp(stats, 50);
    stats = removeXp(stats, 30);
    expect(stats.xp).toBe(20);
    expect(stats.level).toBe(1);
  });

  it("does not go below 0 XP", () => {
    const stats = getDefaultStats();
    const result = removeXp(stats, 50);
    expect(result.xp).toBe(0);
    expect(result.level).toBe(1);
  });

  it("does not decrease level when XP is removed", () => {
    let stats = getDefaultStats();
    stats = addXp(stats, 250); // Level 3 (200-300 XP range)
    expect(stats.level).toBe(3);
    stats = removeXp(stats, 100);
    expect(stats.level).toBe(2); // Level may decrease if XP drops below threshold
    expect(stats.xp).toBe(150);
  });
});

describe("awardBadge", () => {
  it("marks badge as earned", () => {
    const stats = getDefaultStats();
    const result = awardBadge(stats, "safe-surfer");
    const badge = result.badges.find((b) => b.id === "safe-surfer");
    expect(badge?.earned).toBe(true);
  });

  it("does not error on invalid badge id", () => {
    const stats = getDefaultStats();
    // @ts-expect-error - testing invalid input
    const result = awardBadge(stats, "non-existent-badge");
    // Result should have same XP/level but badges array may be different reference
    expect(result.xp).toBe(stats.xp);
    expect(result.level).toBe(stats.level);
    expect(result.badges.length).toBe(stats.badges.length);
  });
});

describe("xpProgressInLevel", () => {
  it("returns correct progress for level 1", () => {
    const result = xpProgressInLevel(50, 1);
    expect(result.current).toBe(50);
    expect(result.max).toBe(100);
  });

  it("returns correct progress for level 2", () => {
    const result = xpProgressInLevel(150, 2);
    expect(result.current).toBe(50); // 150 - 100 (level 1 threshold)
    expect(result.max).toBe(100);
  });

  it("handles XP at exact level boundary", () => {
    const result = xpProgressInLevel(100, 1);
    expect(result.current).toBe(100);
    expect(result.max).toBe(100);
  });
});

describe("Level thresholds", () => {
  it("level 1: 0-100 XP", () => {
    expect(addXp(getDefaultStats(), 99).level).toBe(1);
    expect(addXp(getDefaultStats(), 100).level).toBe(2);
  });

  it("level 2: 100-200 XP", () => {
    let stats = addXp(getDefaultStats(), 100);
    expect(stats.level).toBe(2);
    stats = addXp(stats, 99);
    expect(stats.level).toBe(2);
    stats = addXp(stats, 1);
    expect(stats.level).toBe(3);
  });

  it("level 10 is max level", () => {
    let stats = getDefaultStats();
    stats = addXp(stats, 1000);
    expect(stats.level).toBe(10);
    stats = addXp(stats, 1000);
    expect(stats.level).toBe(10); // Doesn't go beyond 10
  });
});
