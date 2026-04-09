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

/**
 * Analyze URL with weighted scoring system
 */
export function analyzeUrl(url: string): RiskAnalysis {
    const patterns: string[] = [];
    let score = 0;
    let contextMultiplier = 1.0;

    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname;
        const pathLower = (parsed.pathname + parsed.search).toLowerCase();

        // --- CRITICAL SIGNALS ---

        // Typosquatting (CRITICAL — never a false positive)
        if (detectTyposquatting(hostname)) {
            score += RISK_WEIGHTS.TYPOSQUAT;
            patterns.push("typosquatting");
        }

        // Data URI (CRITICAL)
        if (parsed.protocol === "data:") {
            score += RISK_WEIGHTS.DATA_URI;
            patterns.push("data_uri");
        }

        // URL with @ symbol (credentials in URL — common phishing technique)
        if (url.includes("@")) {
            score += RISK_WEIGHTS.URL_WITH_AT;
            patterns.push("url_with_at_symbol");
        }

        // --- HIGH SIGNALS ---

        // IP address hostname (HIGH — rare for legitimate sites)
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
            score += RISK_WEIGHTS.IP_HOSTNAME;
            patterns.push("ip_address_hostname");
        }

        // --- MEDIUM SIGNALS ---

        // Suspicious TLD
        const suspiciousTlds = [".tk", ".ml", ".ga", ".cf", ".gq", ".xyz", ".top", ".work"];
        if (suspiciousTlds.some((t) => hostname.endsWith(t))) {
            score += RISK_WEIGHTS.SUSPICIOUS_TLD;
            patterns.push("suspicious_tld");
        }

        // HTTP protocol (MEDIUM — but very common)
        if (parsed.protocol === "http:") {
            score += RISK_WEIGHTS.HTTP_PROTOCOL;
            patterns.push("http_protocol");
        }

        // Excessive subdomains (>4)
        if (hostname.split(".").length > 4) {
            score += RISK_WEIGHTS.EXCESSIVE_SUBDOMAINS;
            patterns.push("excessive_subdomains");
        }

        // Redirect parameters
        if (
            parsed.searchParams.has("redirect") ||
            parsed.searchParams.has("url") ||
            parsed.searchParams.has("continue") ||
            parsed.searchParams.has("return")
        ) {
            score += RISK_WEIGHTS.REDIRECT_PARAM;
            patterns.push("redirect_param");
        }

        // --- LOW SIGNALS ---

        // Very long URL (>200 chars)
        if (url.length > 200) {
            score += RISK_WEIGHTS.LONG_URL;
            patterns.push("long_url");
        }

        // Brand keywords in suspicious path context - removed to avoid false positives
        // Legitimate brand login pages (e.g., accounts.google.com/signin) should not be flagged
        // Typosquatting attempts are already caught by detectTyposquatting()

        // --- CONTEXT MODIFIERS ---

        if (containsBrandKeywords(hostname)) {
            contextMultiplier *= CONTEXT_MODIFIERS.KNOWN_BRAND;
        }

        if (patterns.length >= 3) {
            contextMultiplier *= CONTEXT_MODIFIERS.MULTIPLE_SIGNALS;
        }

        // Apply context multiplier
        score = Math.round(score * contextMultiplier);

        // --- LEVEL DETERMINATION (with hysteresis) ---
        // Using higher thresholds to reduce false positives

        let level: RiskLevel = "safe";
        let reason: string;

        if (score >= RISK_THRESHOLDS.DANGER) {
            level = "danger";
            reason = "High-risk phishing indicators detected.";
        } else if (score >= RISK_THRESHOLDS.WARNING) {
            level = "warning";
            reason = "Some suspicious patterns found. Proceed with caution.";
        } else if (score >= RISK_THRESHOLDS.MINOR) {
            level = "safe";
            reason = "Minor concerns detected, but likely safe.";
        } else {
            level = "safe";
            reason = "No significant risks detected.";
        }

        return { level, score, patterns, reason };
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
        const currentHost = window.location.hostname;
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
    const suspiciousTextPatterns = [
        "verify your account",
        "confirm your identity",
        "update your information",
        "suspend your account",
        "unusual activity",
        "verify your password",
        "click here to verify",
        "your account has been",
        "confirm your account",
        "security alert",
        "urgent action required",
    ];

    const bodyText = document.body?.innerText?.toLowerCase() || "";
    for (const phrase of suspiciousTextPatterns) {
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
export function contentRiskFromSignals(
    signals: PageRiskSignals,
    urlAnalysis: RiskAnalysis
): {
    level: RiskLevel;
    patterns: string[];
    xpAwarded: number;
} {
    let score = urlAnalysis.score;
    const patterns = [...urlAnalysis.patterns];

    // Password field on non-HTTPS (CRITICAL)
    if (signals.hasPasswordField && !window.location.protocol.startsWith("https:")) {
        patterns.push("password_field_http");
        score += RISK_WEIGHTS.PASSWORD_ON_HTTP;
    }

    // Password field with external form action (HIGH)
    if (signals.hasPasswordField && signals.formActionExternal) {
        patterns.push("password_field_external_submit");
        score += RISK_WEIGHTS.EXTERNAL_FORM_ACTION;
    }

    // Multiple suspicious phrases (HIGH)
    if (signals.suspiciousPhrases.length >= 3) {
        patterns.push("urgency_language_detected");
        score += RISK_WEIGHTS.URGENT_LANGUAGE_3_PLUS;
    }

    // Login form with urgency phrases (MEDIUM)
    if (signals.hasLoginForm && signals.suspiciousPhrases.length >= 2) {
        patterns.push("phishing_page_characteristics");
        score += 25;
    }

    // Iframe embedding on login pages (LOW)
    if (signals.hasLoginForm && signals.hasIframeEmbed) {
        patterns.push("login_page_with_iframe");
        score += 20;
    }

    // Level determination (aligned with URL analysis thresholds)
    let level: RiskLevel = "safe";
    let xpAwarded = 0;

    if (score >= RISK_THRESHOLDS.DANGER) {
        level = "danger";
    } else if (score >= RISK_THRESHOLDS.WARNING) {
        level = "warning";
    }

    // Award XP if user avoided a danger/warning
    if (level === "safe") {
        xpAwarded = 5; // Safe browsing base XP
    }

    return { level, patterns, xpAwarded };
}
