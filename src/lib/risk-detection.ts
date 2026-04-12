// Risk detection engine for the extension
// Analyzes URLs and page content for potential threats
//
// Phase 2B: Weighted scoring system with contextual modifiers to reduce false positives

import {
  RISK_WEIGHTS,
  CONTEXT_MODIFIERS,
  KNOWN_BRANDS,
  TYPOSQUAT_PATTERNS,
  SUSPICIOUS_TLDS,
  SUSPICIOUS_PHRASES,
  RISK_THRESHOLDS,
} from "./constants";

export type RiskLevel = "safe" | "warning" | "danger";

export interface RiskAnalysis {
    level: RiskLevel;
    score: number; // 0–100
    patterns: string[];
    reason: string;
}

// --- Weighted Scoring System ---
// Each signal has a weight based on its reliability as a phishing indicator
// (Imported from constants.ts for single source of truth)

/**
 * Detect typosquatting attempts in hostname
 */
function detectTyposquatting(hostname: string): boolean {
    const lower = hostname.toLowerCase();
    return TYPOSQUAT_PATTERNS.some((pattern) => pattern.test(lower));
}

/**
 * Check if hostname contains known brand keywords
 */
function containsBrandKeywords(hostname: string): boolean {
    const lower = hostname.toLowerCase();
    return KNOWN_BRANDS.some((brand) => lower.includes(brand));
}

// Re-export constants for use in other modules
export { KNOWN_BRANDS, TYPOSQUAT_PATTERNS };

export function analyzeUrl(url: string): RiskAnalysis {
    const patterns: string[] = [];

    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname;

        // --- CRITICAL SIGNALS (Immediate Danger) ---
        if (detectTyposquatting(hostname)) patterns.push("typosquatting");
        if (parsed.protocol === "data:") patterns.push("data_uri");
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) patterns.push("ip_address_hostname");
        if (url.includes("@")) patterns.push("url_with_at_symbol");

        if (patterns.length > 0) {
            return { level: "danger", score: 90, patterns, reason: "Critical phishing indicators detected in URL." };
        }

        // --- WARNING SIGNALS ---
        if (SUSPICIOUS_TLDS.some((t) => hostname.endsWith(t))) patterns.push("suspicious_tld");
        if (parsed.protocol === "http:") patterns.push("http_protocol");
        if (hostname.split(".").length > 4) patterns.push("excessive_subdomains");
        if (url.length > 200) patterns.push("long_url");

        if (
            parsed.searchParams.has("redirect") ||
            parsed.searchParams.has("url") ||
            parsed.searchParams.has("continue") ||
            parsed.searchParams.has("return")
        ) {
            patterns.push("redirect_param");
        }

        // Context check: If it contains a known trusted brand keyword and didn't trigger critical signs above, 
        // we can safely assume it's legitimate (e.g. accounts.google.com).
        if (containsBrandKeywords(hostname)) {
            return { level: "safe", score: 10, patterns: [], reason: "Known trusted brand detected." };
        }

        if (patterns.length >= 2) {
            return { level: "warning", score: 50, patterns, reason: "Multiple suspicious patterns detected in URL." };
        }

        return { level: "safe", score: 0, patterns: [], reason: "No significant risks detected in URL." };
    } catch {
        return { level: "safe", score: 0, patterns: [], reason: "Could not parse URL." };
    }
}

// --- Content-based detection (run in content script) ---
export interface PageRiskSignals {
    hasLoginForm: boolean;
    formActionExternal: boolean;
    hasPasswordField: boolean;
    hasEmailField: boolean;
    externalFormAction: string | null;
    hasObfuscatedText: boolean;
    suspiciousPhrases: string[];
    hasIframeEmbed: boolean;
    missingSecurityIndicators: boolean;
}

export function analyzePageContent(): PageRiskSignals {
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

    // Detect login/password forms
    const forms = document.querySelectorAll("form");
    const passwordInputs = document.querySelectorAll("input[type='password']");
    const emailInputs = document.querySelectorAll(
        "input[type='email'], input[name='email'], input[name='username']"
    );

    if (forms.length > 0 || passwordInputs.length > 0) {
        signals.hasLoginForm = true;
    }

    if (passwordInputs.length > 0) {
        signals.hasPasswordField = true;
    }

    if (emailInputs.length > 0) {
        signals.hasEmailField = true;
    }

    // Check form action destinations
    try {
        for (const form of forms) {
            const action = form.getAttribute("action") || "";
            if (
                action &&
                !action.startsWith("/") &&
                !action.startsWith(window.location.origin)
            ) {
                // Form submits to external domain
                signals.formActionExternal = true;
                signals.externalFormAction = action;
                signals.suspiciousPhrases.push("Form submits to external domain");
            }
        }
    } catch {
        // Cross-origin, skip
    }

    // Suspicious phrases on page
    const bodyText = document.body?.innerText?.toLowerCase() || "";
    for (const phrase of SUSPICIOUS_PHRASES) {
        if (bodyText.includes(phrase)) {
            signals.suspiciousPhrases.push(phrase);
        }
    }

    if (signals.suspiciousPhrases.length >= 3) {
        signals.hasObfuscatedText = true;
    }

    // Iframe detection
    const iframes = document.querySelectorAll("iframe");
    if (iframes.length > 0) {
        signals.hasIframeEmbed = true;
    }

    // HTTPS + lock icon check
    const isHttps = window.location.protocol === "https:";
    const hasSecureIndicator =
        document.querySelectorAll("input[type='password']").length > 0 &&
        isHttps &&
        document.querySelector(`[src*="lock"], [class*="lock"], [id*="lock"]`) !== null;

    if (signals.hasPasswordField && !hasSecureIndicator && !isHttps) {
        signals.missingSecurityIndicators = true;
    }

    return signals;
}

// --- Content script risk scoring ---
// NOTE: XP is awarded in background.ts via gamification logic.
// This function only determines risk level and patterns.
export function contentRiskFromSignals(
    signals: PageRiskSignals,
    urlAnalysis: RiskAnalysis
): {
    level: RiskLevel;
    patterns: string[];
} {
    let level = urlAnalysis.level;
    const patterns = [...urlAnalysis.patterns];

    if (level === "danger") return { level, patterns };

    // Password field on non-HTTPS (CRITICAL)
    if (signals.hasPasswordField && !window.location.protocol.startsWith("https:")) {
        patterns.push("password_field_http");
        return { level: "danger", patterns };
    }

    // Password field with external form action (HIGH)
    if (signals.hasPasswordField && signals.formActionExternal) {
        patterns.push("password_field_external_submit");
        return { level: "danger", patterns };
    }

    // Multiple suspicious phrases (HIGH)
    if (signals.suspiciousPhrases.length >= 3) {
        patterns.push("urgency_language_detected");
        if (level === "safe") level = "warning";
    }

    // Login form with urgency phrases (MEDIUM)
    if (signals.hasLoginForm && signals.suspiciousPhrases.length >= 2) {
        patterns.push("phishing_page_characteristics");
        if (level === "safe") level = "warning";
    }

    // Iframe embedding on login pages (LOW)
    if (signals.hasLoginForm && signals.hasIframeEmbed) {
        patterns.push("login_page_with_iframe");
        if (level === "safe") level = "warning";
    }

    return { level, patterns };
}
