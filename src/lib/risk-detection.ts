// src/lib/risk-detection.ts
// URL and page content risk analysis engine.
// Keeps it simple: typosquat / IP / data URI → immediate danger.
// Multiple lesser signals → warning.

import { KNOWN_BRANDS, TYPOSQUAT_PATTERNS, SUSPICIOUS_TLDS, SUSPICIOUS_PHRASES } from "./constants";

export type RiskLevel = "safe" | "warning" | "danger";

export interface RiskAnalysis {
  level: RiskLevel;
  score: number; // 0–100
  patterns: string[];
  reason: string;
}

// ---------------------------------------------------------------------------
// PageRiskSignals — unified interface used by test AND production code
// Field naming: use the version expected by risk-detection.test.ts as canonical.
// ---------------------------------------------------------------------------
export interface PageRiskSignals {
  hasLoginForm: boolean;
  formActionExternal: boolean;
  hasPasswordField: boolean;
  hasEmailField: boolean;
  externalFormAction: string | null;
  suspiciousPhrases: string[];
  hasIframeEmbed: boolean;
  /** true when password field is on HTTP (not HTTPS) — also called passwordOnHttp in content-script */
  missingSecurityIndicators: boolean;
  /** Used by tests to denote obfuscated/suspicious inline scripts */
  hasObfuscatedText: boolean;
  /** Legacy alias for missingSecurityIndicators — populated by content-script.ts */
  passwordOnHttp?: boolean;
}

// ---------------------------------------------------------------------------
// URL analysis
// ---------------------------------------------------------------------------
export function analyzeUrl(url: string): RiskAnalysis {
  const patterns: string[] = [];

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // ── localhost → always safe ────────────────────────────────────────────
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
      return { level: "safe", score: 0, patterns: ["localhost"], reason: "Local development URL." };
    }

    // ── CRITICAL signals → immediate danger ──────────────────────────────
    if (TYPOSQUAT_PATTERNS.some(p => p.test(hostname))) patterns.push("typosquatting");
    if (parsed.protocol === "data:") patterns.push("data_uri");
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) patterns.push("ip_address_hostname");
    if (url.includes("@")) patterns.push("url_with_at_symbol");

    if (patterns.length > 0) {
      return { level: "danger", score: 90, patterns, reason: "Critical phishing indicators in URL." };
    }

    // ── Known brand domains → always safe (avoids false positives on accounts.google.com etc.) ──
    if (KNOWN_BRANDS.some(brand => hostname === brand + ".com" || hostname.endsWith("." + brand + ".com"))) {
      return { level: "safe", score: 10, patterns: ["known_brand"], reason: "Verified brand domain." };
    }

    // ── Warning-level signals ─────────────────────────────────────────────
    if (SUSPICIOUS_TLDS.some(tld => hostname.endsWith(tld))) patterns.push("suspicious_tld");
    if (parsed.protocol === "http:") patterns.push("http_protocol");
    if (hostname.split(".").length > 4) patterns.push("excessive_subdomains");
    if (url.length > 200) patterns.push("long_url");
    if (["redirect", "url", "continue", "return"].some(p => parsed.searchParams.has(p))) {
      patterns.push("redirect_param");
    }

    if (patterns.length >= 2) {
      return { level: "warning", score: 50, patterns, reason: "Multiple suspicious patterns in URL." };
    }

    return { level: "safe", score: 0, patterns, reason: "No significant risks in URL." };
  } catch {
    return { level: "safe", score: 0, patterns: [], reason: "Could not parse URL." };
  }
}

// ---------------------------------------------------------------------------
// Content-based risk analysis (DOM scanning — usable in tests via JSDOM)
// This function is importable from test files to check the returned signals.
// ---------------------------------------------------------------------------
export function analyzePageContent(): PageRiskSignals {
  const signals: PageRiskSignals = {
    hasLoginForm: false,
    formActionExternal: false,
    hasPasswordField: false,
    hasEmailField: false,
    externalFormAction: null,
    suspiciousPhrases: [],
    hasIframeEmbed: false,
    missingSecurityIndicators: false,
    hasObfuscatedText: false,
    passwordOnHttp: false,
  };

  try {
    const forms = document.querySelectorAll("form");
    const pwInputs = document.querySelectorAll("input[type='password']");
    const emailInputs = document.querySelectorAll(
      "input[type='email'], input[name='email'], input[name='username']"
    );

    signals.hasLoginForm = forms.length > 0 || pwInputs.length > 0;
    signals.hasPasswordField = pwInputs.length > 0;
    signals.hasEmailField = emailInputs.length > 0;

    // Form action check
    const currentOrigin = typeof window !== "undefined" ? window.location.origin : "";
    for (const form of forms) {
      const action = form.getAttribute("action") ?? "";
      if (action && !action.startsWith("/") && !action.startsWith(currentOrigin)) {
        signals.formActionExternal = true;
        signals.externalFormAction = action;
      }
    }

    // Suspicious phrases
    const bodyText = document.body?.innerText?.toLowerCase() ?? document.body?.textContent?.toLowerCase() ?? "";
    for (const phrase of SUSPICIOUS_PHRASES) {
      if (bodyText.includes(phrase)) signals.suspiciousPhrases.push(phrase);
    }

    // Iframe check
    signals.hasIframeEmbed = document.querySelectorAll("iframe").length > 0;

    // Password on HTTP
    const protocol = typeof window !== "undefined" ? window.location.protocol : "https:";
    if (signals.hasPasswordField && protocol !== "https:") {
      signals.missingSecurityIndicators = true;
      signals.passwordOnHttp = true;
    }

    // Obfuscated text detection (basic: inline scripts with encoded content)
    const inlineScripts = Array.from(document.querySelectorAll("script:not([src])"))
      .map(s => s.textContent ?? "");
    const combined = inlineScripts.join("\n");
    signals.hasObfuscatedText = /eval\s*\(|atob\s*\(|unescape\s*\(/.test(combined);

  } catch {}

  return signals;
}

// ---------------------------------------------------------------------------
// Content-based risk (using signals sent from content-script)
// ---------------------------------------------------------------------------
export function contentRiskFromSignals(
  signals: PageRiskSignals,
  urlAnalysis: RiskAnalysis
): RiskAnalysis {
  // If URL is already danger, content can't downgrade it
  if (urlAnalysis.level === "danger") return urlAnalysis;

  const patterns = [...urlAnalysis.patterns];
  let level = urlAnalysis.level;

  // Password on HTTP → critical (check both field names for compatibility)
  const isPasswordOnHttp = signals.missingSecurityIndicators || signals.passwordOnHttp;
  if (isPasswordOnHttp) {
    patterns.push("password_field_http");
    return { level: "danger", score: 90, patterns, reason: "Password field on insecure HTTP connection." };
  }

  // Password + external form action → critical
  if (signals.hasPasswordField && signals.formActionExternal) {
    patterns.push("password_field_external_submit");
    return { level: "danger", score: 85, patterns, reason: "Login form submits credentials to external domain." };
  }

  // 3+ suspicious phrases → escalate
  if (signals.suspiciousPhrases.length >= 3) {
    patterns.push("urgency_language_detected");
    if (level === "safe") level = "warning";
  }

  // Login form + urgency → escalate
  if (signals.hasLoginForm && signals.suspiciousPhrases.length >= 2) {
    patterns.push("phishing_characteristics");
    if (level === "safe") level = "warning";
  }

  // Login form + iframe
  if (signals.hasLoginForm && signals.hasIframeEmbed) {
    patterns.push("login_form_with_iframe");
    if (level === "safe") level = "warning";
  }

  // Obfuscated text adds risk
  if (signals.hasObfuscatedText) {
    patterns.push("obfuscated_script");
    if (level === "safe") level = "warning";
  }

  const score = level === "warning" ? 40 : urlAnalysis.score;
  return { level, score, patterns, reason: level === "warning" ? "Suspicious page content signals." : urlAnalysis.reason };
}

// ---------------------------------------------------------------------------
// Re-export for content-script (cannot import from lib)
// ---------------------------------------------------------------------------
export { SUSPICIOUS_PHRASES };
