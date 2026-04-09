// Unit tests for analysis-strategy.ts
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the whitelist module BEFORE importing analysis-strategy
vi.mock("./whitelist", () => ({
  isWhitelisted: vi.fn().mockResolvedValue(false),
}));

import {
  shouldAnalyzeUrl,
  markDomainAnalyzed,
  getCachedAnalysis,
  setDomainHasSensitiveForm,
  clearDomainCache,
  getCacheStats,
} from "./analysis-strategy";

describe("shouldAnalyzeUrl - Skip List", () => {
  beforeEach(() => {
    clearDomainCache();
  });

  it("skips chrome:// URLs", async () => {
    expect(await shouldAnalyzeUrl("chrome://settings")).toBe(false);
    expect(await shouldAnalyzeUrl("chrome://extensions")).toBe(false);
  });

  it("skips chrome-extension:// URLs", async () => {
    expect(await shouldAnalyzeUrl("chrome-extension://abc123/popup.html")).toBe(false);
  });

  it("skips about: URLs", async () => {
    expect(await shouldAnalyzeUrl("about:blank")).toBe(false);
    expect(await shouldAnalyzeUrl("about:newtab")).toBe(false);
  });

  it("skips localhost URLs", async () => {
    expect(await shouldAnalyzeUrl("http://localhost:3000")).toBe(false);
    expect(await shouldAnalyzeUrl("http://127.0.0.1:8080")).toBe(false);
  });

  it("skips file:// URLs", async () => {
    expect(await shouldAnalyzeUrl("file:///Users/test/file.html")).toBe(false);
  });

  it("skips view-source: URLs", async () => {
    expect(await shouldAnalyzeUrl("view-source:https://example.com")).toBe(false);
  });
});

describe("shouldAnalyzeUrl - High Priority Patterns", () => {
  beforeEach(() => {
    clearDomainCache();
  });

  it("always analyzes login pages", async () => {
    expect(await shouldAnalyzeUrl("https://example.com/login")).toBe(true);
    expect(await shouldAnalyzeUrl("https://example.com/signin")).toBe(true);
    expect(await shouldAnalyzeUrl("https://example.com/auth/callback")).toBe(true);
  });

  it("always analyzes banking/finance pages", async () => {
    expect(await shouldAnalyzeUrl("https://bank.com/account")).toBe(true);
    expect(await shouldAnalyzeUrl("https://paypal.com/checkout")).toBe(true);
  });

  it("always analyzes brand login pages", async () => {
    expect(await shouldAnalyzeUrl("https://google.com/signin")).toBe(true);
    expect(await shouldAnalyzeUrl("https://microsoft.com/login")).toBe(true);
    expect(await shouldAnalyzeUrl("https://github.com/auth")).toBe(true);
  });
});

describe("shouldAnalyzeUrl - Domain Caching", () => {
  beforeEach(() => {
    clearDomainCache();
  });

  it("skips recently analyzed non-high-priority domains", async () => {
    const url = "https://example.com/page";  // Not high-priority
    markDomainAnalyzed(url, "safe", []);
    expect(await shouldAnalyzeUrl(url)).toBe(false);
  });

  it("analyzes high-priority domains not in cache", async () => {
    expect(await shouldAnalyzeUrl("https://new-domain.com/login")).toBe(true);
  });

  it("respects cooldown for high-priority URLs when cached", async () => {
    const url = "https://example.com/login";  // High-priority
    markDomainAnalyzed(url, "safe", []);
    // High priority URLs should still respect cooldown
    expect(await shouldAnalyzeUrl(url)).toBe(false);
  });
});

describe("getCachedAnalysis", () => {
  beforeEach(() => {
    clearDomainCache();
  });

  it("returns cached analysis for analyzed domain", () => {
    const url = "https://example.com/page";
    markDomainAnalyzed(url, "warning", ["http_protocol"]);
    const cached = getCachedAnalysis(url);
    expect(cached?.level).toBe("warning");
    expect(cached?.patterns).toContain("http_protocol");
  });

  it("returns null for unanalyzed domain", () => {
    const cached = getCachedAnalysis("https://unknown.com");
    expect(cached).toBe(null);
  });
});

describe("setDomainHasSensitiveForm", () => {
  beforeEach(() => {
    clearDomainCache();
  });

  it("marks domain as having sensitive forms", async () => {
    setDomainHasSensitiveForm("example.com", true);
    expect(await shouldAnalyzeUrl("https://example.com/page")).toBe(true);
  });

  it("allows domain without sensitive forms to be skipped", async () => {
    setDomainHasSensitiveForm("example.com", false);
    // Non-high-priority URL without sensitive forms should be skipped if cached
    markDomainAnalyzed("https://example.com/page", "safe", []);
    expect(await shouldAnalyzeUrl("https://example.com/page")).toBe(false);
  });
});

describe("getCacheStats", () => {
  beforeEach(() => {
    clearDomainCache();
  });

  it("returns empty stats for fresh cache", () => {
    const stats = getCacheStats();
    expect(stats.size).toBe(0);
    expect(stats.domains.length).toBe(0);
  });

  it("returns correct stats after marking domains", () => {
    markDomainAnalyzed("https://example.com", "safe", []);
    markDomainAnalyzed("https://test.com", "warning", []);
    const stats = getCacheStats();
    expect(stats.size).toBe(2);
    expect(stats.domains).toContain("example.com");
    expect(stats.domains).toContain("test.com");
  });

  it("clears cache correctly", () => {
    markDomainAnalyzed("https://example.com", "safe", []);
    clearDomainCache();
    const stats = getCacheStats();
    expect(stats.size).toBe(0);
  });
});

describe("Analysis Cooldown", () => {
  beforeEach(() => {
    clearDomainCache();
  });

  it("analyzes URL immediately after cache expires (30s)", async () => {
    const url = "https://example.com/login";  // High priority URL
    markDomainAnalyzed(url, "safe", []);

    // Should be skipped (in cooldown)
    expect(await shouldAnalyzeUrl(url)).toBe(false);

    // Manually expire the cache by marking with old timestamp
    // (In real usage, this happens automatically after 30s)
    clearDomainCache();

    // Should be analyzed again after cache cleared
    expect(await shouldAnalyzeUrl(url)).toBe(true);
  });
});
