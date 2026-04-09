// Unit tests for risk-detection.ts
import { describe, it, expect } from "vitest";
import { analyzeUrl, analyzePageContent, contentRiskFromSignals, type PageRiskSignals } from "./risk-detection";

describe("analyzeUrl - Safe URLs", () => {
  it("identifies GitHub login as safe", () => {
    const result = analyzeUrl("https://github.com/login");
    expect(result.level).toBe("safe");
  });

  it("identifies Google accounts as safe", () => {
    const result = analyzeUrl("https://accounts.google.com/signin");
    expect(result.level).toBe("safe");
  });

  it("identifies localhost as safe", () => {
    const result = analyzeUrl("http://localhost:3000/login");
    expect(result.level).toBe("safe");
  });
});

describe("analyzeUrl - Danger URLs", () => {
  it("detects typosquatting (g00gle)", () => {
    const result = analyzeUrl("http://g00gle.com/login");
    expect(result.level).toBe("danger");
    expect(result.patterns).toContain("typosquatting");
  });

  it("detects IP address hostname", () => {
    const result = analyzeUrl("http://192.168.1.100/paypal-signin");
    expect(result.level).toBe("danger");
    expect(result.patterns).toContain("ip_address_hostname");
  });

  it("detects suspicious TLD (.tk)", () => {
    const result = analyzeUrl("https://amaz0n-verify.ga/account");
    expect(result.level).toBe("danger");
    expect(result.patterns).toContain("suspicious_tld");
  });

  it("detects data: URI", () => {
    const result = analyzeUrl("data:text/html,<form>password</form>");
    expect(result.level).toBe("danger");
    expect(result.patterns).toContain("data_uri");
  });

  it("detects URL with @ symbol", () => {
    const result = analyzeUrl("https://google.com@evil.com/login");
    expect(result.level).toBe("danger");
    expect(result.patterns).toContain("url_with_at_symbol");
  });
});

describe("analyzeUrl - Warning URLs", () => {
  it("identifies suspicious TLD without other indicators as warning", () => {
    const result = analyzeUrl("http://example.tk/page");
    expect(result.level).toBe("warning");
  });

  it("identifies HTTP protocol as warning", () => {
    const result = analyzeUrl("http://example.com/page");
    expect(result.level).toBe("warning");
  });
});

describe("analyzeUrl - Edge cases", () => {
  it("handles invalid URLs gracefully", () => {
    const result = analyzeUrl("not-a-valid-url");
    expect(result.level).toBe("safe");
    expect(result.reason).toContain("Could not parse");
  });

  it("handles empty URL gracefully", () => {
    const result = analyzeUrl("");
    expect(result.level).toBe("safe");
  });
});

describe("analyzePageContent", () => {
  it("detects password fields", () => {
    document.body.innerHTML = '<input type="password" name="password" />';
    const signals = analyzePageContent();
    expect(signals.hasPasswordField).toBe(true);
  });

  it("detects login forms", () => {
    document.body.innerHTML = '<form><input type="text" name="username" /></form>';
    const signals = analyzePageContent();
    expect(signals.hasLoginForm).toBe(true);
  });

  it("detects external form actions", () => {
    document.body.innerHTML = '<form action="https://evil.com/collect"></form>';
    const signals = analyzePageContent();
    expect(signals.formActionExternal).toBe(true);
    expect(signals.externalFormAction).toBe("https://evil.com/collect");
  });

  it("detects suspicious phrases", () => {
    document.body.innerHTML = "<p>Verify your account immediately to avoid suspension</p>";
    const signals = analyzePageContent();
    expect(signals.suspiciousPhrases.length).toBeGreaterThan(0);
    expect(signals.suspiciousPhrases).toContain("verify your account");
  });

  it("detects missing security indicators on HTTP password pages", () => {
    // Mock window.location to be HTTP
    Object.defineProperty(window, "location", {
      value: { protocol: "http:", hostname: "example.com" },
      writable: true,
    });
    document.body.innerHTML = '<input type="password" />';
    const signals = analyzePageContent();
    expect(signals.missingSecurityIndicators).toBe(true);
  });
});

describe("contentRiskFromSignals", () => {
  const baseUrlAnalysis = { level: "safe" as const, score: 0, patterns: [], reason: "" };

  it("upgrades to danger for password field on HTTP", () => {
    const signals: PageRiskSignals = {
      hasLoginForm: false,
      formActionExternal: false,
      hasPasswordField: true,
      hasEmailField: false,
      externalFormAction: null,
      hasObfuscatedText: false,
      suspiciousPhrases: [],
      hasIframeEmbed: false,
      missingSecurityIndicators: true,
    };
    const result = contentRiskFromSignals(signals, baseUrlAnalysis);
    expect(result.level).toBe("danger");
    expect(result.patterns).toContain("password_field_http");
  });

  it("upgrades to danger for password field with external form action", () => {
    const signals: PageRiskSignals = {
      hasLoginForm: true,
      formActionExternal: true,
      hasPasswordField: true,
      hasEmailField: false,
      externalFormAction: "https://evil.com/collect",
      hasObfuscatedText: false,
      suspiciousPhrases: [],
      hasIframeEmbed: false,
      missingSecurityIndicators: false,
    };
    const result = contentRiskFromSignals(signals, baseUrlAnalysis);
    expect(result.level).toBe("danger");
    expect(result.patterns).toContain("password_field_external_submit");
  });

  it("upgrades to warning for 3+ suspicious phrases", () => {
    const signals: PageRiskSignals = {
      hasLoginForm: false,
      formActionExternal: false,
      hasPasswordField: false,
      hasEmailField: false,
      externalFormAction: null,
      hasObfuscatedText: true,
      suspiciousPhrases: ["verify your account", "confirm your identity", "urgent action required"],
      hasIframeEmbed: false,
      missingSecurityIndicators: false,
    };
    const result = contentRiskFromSignals(signals, baseUrlAnalysis);
    expect(result.level).toBe("warning");
    expect(result.patterns).toContain("urgency_language_detected");
  });

  it("awards XP for safe pages", () => {
    const signals: PageRiskSignals = {
      hasLoginForm: false,
      formActionExternal: false,
      hasPasswordField: false,
      hasEmailField: false,
      externalFormAction: null,
      hasObfuscatedText: false,
      suspiciousPhrases: [],
      hasIframeEmbed: false,
      missingSecurityIndicators: false,
    };
    const result = contentRiskFromSignals(signals, baseUrlAnalysis);
    expect(result.level).toBe("safe");
    expect(result.xpAwarded).toBe(5);
  });
});

describe("Score thresholds", () => {
  it("danger threshold is score >= 50", () => {
    expect(analyzeUrl("http://g00gle.com").score).toBeGreaterThanOrEqual(50);
  });

  it("warning threshold is score >= 25", () => {
    const result = analyzeUrl("http://example.com/page");
    expect(result.score).toBeGreaterThanOrEqual(25);
    expect(result.level).toBe("warning");
  });
});
