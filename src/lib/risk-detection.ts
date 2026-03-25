// Risk detection engine for the extension
// Analyzes URLs and page content for potential threats

export type RiskLevel = "safe" | "warning" | "danger";

export interface RiskAnalysis {
    level: RiskLevel;
    score: number; // 0–100
    patterns: string[];
    reason: string;
}

// --- URL-based heuristics ---
export function analyzeUrl(url: string): RiskAnalysis {
    const patterns: string[] = [];
    let score = 0;
    let reason = "No risks detected.";

    try {
        const parsed = new URL(url);

        // Protocol check
        if (parsed.protocol === "http:") {
            patterns.push("http_protocol");
            score += 30;
        }

        // IP address in hostname (common in phishing)
        const hostname = parsed.hostname;
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
            patterns.push("ip_address_hostname");
            score += 40;
        }

        // Excessive subdomains (e.g. login.secure.bank.com.fake.com)
        const subdomains = hostname.split(".").length;
        if (subdomains > 4) {
            patterns.push("excessive_subdomains");
            score += 25;
        }

        // Known phishing patterns in hostname
        const phishingKeywords = [
            "login", "signin", "account", "verify", "secure",
            "update", "confirm", "banking", "password", "credential",
        ];
        const pathLower = (parsed.pathname + parsed.search).toLowerCase();
        const hasLoginPath = phishingKeywords.some(k => pathLower.includes(k));
        const hasBrandInHost = phishingKeywords.some(k =>
            hostname.includes(k) && !hostname.includes("google") && !hostname.includes("microsoft")
        );
        if (hasLoginPath && hasBrandInHost) {
            patterns.push("suspicious_login_path");
            score += 35;
        }

        // Typosquatting indicators (common misspellings of popular brands)
        const typosquats = [
            "g00gle", "googIe", "goog1e", "faceb00k", "facebok",
            "twltter", "l1nkedin", "amazon-login", "apple-id", "paypa1",
        ];
        if (typosquats.some(t => hostname.includes(t))) {
            patterns.push("typosquatting");
            score += 50;
        }

        // Suspicious TLDs
        const suspiciousTlds = [".tk", ".ml", ".ga", ".cf", ".gq", ".xyz", ".top", ".work"];
        if (suspiciousTlds.some(t => hostname.endsWith(t))) {
            patterns.push("suspicious_tld");
            score += 20;
        }

        // Very long URLs (obfuscation technique)
        if (url.length > 200) {
            patterns.push("long_url");
            score += 10;
        }

        // Data: URL (phishing can use data: URIs)
        if (parsed.protocol === "data:") {
            patterns.push("data_uri");
            score += 60;
        }

        // External redirect in URL params
        if (parsed.searchParams.has("redirect") ||
            parsed.searchParams.has("url") ||
            parsed.searchParams.has("continue") ||
            parsed.searchParams.has("return")) {
            patterns.push("external_redirect_param");
            score += 20;
        }

        // @ in URL (phishing technique: https://google.com@evil.com)
        if (url.includes("@")) {
            patterns.push("url_with_at_symbol");
            score += 45;
        }

        // Determine level
        let level: RiskLevel = "safe";
        if (score >= 50) {
            level = "danger";
            reason = "High-risk indicators detected.";
        } else if (score >= 25) {
            level = "warning";
            reason = "Some suspicious patterns found.";
        } else if (patterns.length > 0) {
            reason = "Minor concerns detected.";
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
    const emailInputs = document.querySelectorAll("input[type='email'], input[name='email'], input[name='username']");

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
            if (action && !action.startsWith("/") && !action.startsWith(window.location.origin)) {
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
    const hasSecureIndicator = document.querySelectorAll("input[type='password']").length > 0 &&
        isHttps && document.querySelector(`[src*="lock"], [class*="lock"], [id*="lock"]`) !== null;

    if (signals.hasPasswordField && !hasSecureIndicator && !isHttps) {
        signals.missingSecurityIndicators = true;
    }

    return signals;
}

// --- Content script risk scoring ---
export function contentRiskFromSignals(signals: PageRiskSignals, urlAnalysis: RiskAnalysis): {
    level: RiskLevel;
    patterns: string[];
    xpAwarded: number;
} {
    let score = urlAnalysis.score;
    const patterns = [...urlAnalysis.patterns];

    // Password field on non-HTTPS
    if (signals.hasPasswordField && !window.location.protocol.startsWith("https:")) {
        patterns.push("password_field_http");
        score += 40;
    }

    // Password field on HTTP page with external form action
    if (signals.hasPasswordField && signals.formActionExternal) {
        patterns.push("password_field_external_submit");
        score += 60;
    }

    // Multiple suspicious phrases
    if (signals.suspiciousPhrases.length >= 3) {
        patterns.push("urgency_language_detected");
        score += 25;
    }

    // Login form with urgency phrases
    if (signals.hasLoginForm && signals.suspiciousPhrases.length >= 2) {
        patterns.push("phishing_page_characteristics");
        score += 30;
    }

    // Iframe embedding on login pages
    if (signals.hasLoginForm && signals.hasIframeEmbed) {
        patterns.push("login_page_with_iframe");
        score += 20;
    }

    // Level determination
    let level: RiskLevel = "safe";
    let xpAwarded = 0;

    if (score >= 50) {
        level = "danger";
    } else if (score >= 25) {
        level = "warning";
    }

    // Award XP if user avoided a danger/warning
    if (level === "safe") {
        xpAwarded = 5; // Safe browsing base XP
    }

    return { level, patterns, xpAwarded };
}
