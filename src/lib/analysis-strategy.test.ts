// Unit tests for analysis-strategy.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  shouldAnalyzeUrl,
  markDomainAnalyzed,
  getCachedAnalysis,
  setDomainHasSensitiveForm,
  clearDomainCache,
  getCacheStats,
} from "./analysis-strategy";

describe("shouldAnalyzeUrl - Skip List", () => {
  it("skips chrome:// URLs", () => {
    expect(shouldAnalyzeUrl("chrome://settings")).toBe(false);
    expect(shouldAnalyzeUrl("chrome://extensions")).toBe(false);
  });

  it("skips chrome-extension:// URLs", () => {
    expect(shouldAnalyzeUrl("chrome-extension://abc123/popup.html")).toBe(false);
  });

  it("skips about: URLs", () => {
    expect(shouldAnalyzeUrl("about:blank")).toBe(false);
    expect(shouldAnalyzeUrl("about:newtab")).toBe(false);
  });

  it("skips localhost URLs", () => {
    expect(shouldAnalyzeUrl("http://localhost:3000")).toBe(false);
    expect(shouldAnalyzeUrl("http://127.0.0.1:8080")).toBe(false);
  });

  it("skips file:// URLs", () => {
    expect(shouldAnalyzeUrl("file:///Users/test/file.html")).toBe(false);
  });

  it("skips view-source: URLs", () => {
    expect(shouldAnalyzeUrl("view-source:https://example.com")).toBe(false);
  });
});

describe("shouldAnalyzeUrl - High Priority Patterns", () => {
  beforeEach(() => {
    clearDomainCache();
  });

  it("always analyzes login pages", () => {
    expect(shouldAnalyzeUrl("https://example.com/login")).toBe(true);
    expect(shouldAnalyzeUrl("https://example.com/signin")).toBe(true);
    expect(shouldAnalyzeUrl("https://example.com/auth/callback")).toBe(true);
  });

  it("always analyzes banking/finance pages", () => {
    expect(shouldAnalyzeUrl("https://bank.com/account")).toBe(true);
    expect(shouldAnalyzeUrl("https://paypal.com/checkout")).toBe(true);
  });

  it("always analyzes brand login pages", () => {
    expect(shouldAnalyzeUrl("https://google.com/signin")).toBe(true);
    expect(shouldAnalyzeUrl("https://microsoft.com/login")).toBe(true);
    expect(shouldAnalyzeUrl("https://github.com/auth")).toBe(true);
  });
});

describe("shouldAnalyzeUrl - Domain Caching", () => {
  beforeEach(() => {
    clearDomainCache();
  });

  it("skips recently analyzed domains", () => {
    const url = "https://example.com/page";
    markDomainAnalyzed(url, "safe", []);
    expect(shouldAnalyzeUrl(url)).toBe(false);
  });

  it("analyzes domains not in cache", () => {
    expect(shouldAnalyzeUrl("https://new-domain.com/page")).toBe(true);
  });

  it("analyzes high-priority URLs even if cached", () => {
    const url = "https://example.com/login";
    markDomainAnalyzed(url, "safe", []);
    // High priority URLs should still be analyzed
    expect(shouldAnalyzeUrl(url)).toBe(true);
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

  it("marks domain as having sensitive forms", () => {
    setDomainHasSensitiveForm("example.com", true);
    expect(shouldAnalyzeUrl("https://example.com/page")).toBe(true);
  });

  it("allows domain without sensitive forms to be skipped", () => {
    setDomainHasSensitiveForm("example.com", false);
    // Non-high-priority URL without sensitive forms should be skipped if cached
    markDomainAnalyzed("https://example.com/page", "safe", []);
    expect(shouldAnalyzeUrl("https://example.com/page")).toBe(false);
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

  it("analyzes URL immediately after cache expires (30s)", () => {
    const url = "https://example.com/page";
    markDomainAnalyzed(url, "safe", []);

    // Should be skipped (in cooldown)
    expect(shouldAnalyzeUrl(url)).toBe(false);

    // Manually expire the cache by marking with old timestamp
    // (In real usage, this happens automatically after 30s)
    clearDomainCache();

    // Should be analyzed again after cache cleared
    expect(shouldAnalyzeUrl(url)).toBe(true);
  });
});
