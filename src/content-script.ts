// Content script: Runs on page load to analyze page content for risk signals
// Communicates with background service worker
// Note: Self-contained — cannot import from lib/ (runs in page context)

// Suspicious phrases for page content scanning
const SUSPICIOUS_PHRASES = [
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

interface PageRiskSignals {
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

function analyzePageContent(): PageRiskSignals {
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

    try {
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
        for (const form of forms) {
            const action = form.getAttribute("action") || "";
            if (action && !action.startsWith("/") && !action.startsWith(window.location.origin)) {
                signals.formActionExternal = true;
                signals.externalFormAction = action;
                signals.suspiciousPhrases.push("Form submits to external domain");
            }
        }

        // Suspicious phrases
        const bodyText = document.body?.innerText?.toLowerCase() || "";
        for (const phrase of SUSPICIOUS_PHRASES) {
            if (bodyText.includes(phrase)) {
                signals.suspiciousPhrases.push(phrase);
            }
        }

        if (signals.suspiciousPhrases.length >= 3) {
            signals.hasObfuscatedText = true;
        }

        // Iframes
        if (document.querySelectorAll("iframe").length > 0) {
            signals.hasIframeEmbed = true;
        }

        // HTTPS check
        const isHttps = window.location.protocol === "https:";
        if (signals.hasPasswordField && !isHttps) {
            signals.missingSecurityIndicators = true;
        }
    } catch {
        // Cross-origin restrictions may apply
    }

    return signals;
}

function sendPageSignals(signals: PageRiskSignals, url: string) {
    try {
        chrome.runtime.sendMessage({
            type: "pageScanResult",
            url,
            signals,
        });
    } catch (e) {
        console.warn("[AI Hygiene] Failed to send page signals:", e);
    }
}

function scanPage() {
    // Skip analysis for trivial/empty pages
    if (document.body === null || document.body.children.length === 0) {
        return;
    }

    try {
        const signals = analyzePageContent();
        sendPageSignals(signals, window.location.href);
    } catch (e) {
        console.warn("[AI Hygiene] Page scan failed:", e);
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(scanPage, 500));
} else {
    setTimeout(scanPage, 500);
}
