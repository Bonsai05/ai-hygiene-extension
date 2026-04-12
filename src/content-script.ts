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

// ---------------------------------------------------------------------------
// Risky action detection — only penalise when page is already flagged risky
// ---------------------------------------------------------------------------

// Executable / archive extensions that signal a potentially dangerous download
const RISKY_EXTENSIONS = [
    ".exe", ".msi", ".bat", ".cmd", ".ps1", ".vbs", ".js", ".jar",
    ".zip", ".rar", ".7z", ".tar", ".gz",
    ".dmg", ".pkg", ".apk",
];

function isRiskyDownloadLink(anchor: HTMLAnchorElement): boolean {
    // Explicit download attribute always flagged
    if (anchor.hasAttribute("download")) return true;
    // Check href extension
    try {
        const href = anchor.href;
        if (!href) return false;
        const url = new URL(href);
        const path = url.pathname.toLowerCase();
        return RISKY_EXTENSIONS.some(ext => path.endsWith(ext));
    } catch {
        return false;
    }
}

function isExternalLink(anchor: HTMLAnchorElement): boolean {
    try {
        const href = anchor.href;
        if (!href) return false;
        const linkHost = new URL(href).hostname;
        const pageHost = window.location.hostname;
        // Different host and not same-domain = external
        return linkHost !== "" && linkHost !== pageHost;
    } catch {
        return false;
    }
}

/** Current page risk level — fetched once from background on load */
let currentPageRiskLevel: "safe" | "warning" | "danger" = "safe";

function reportRiskyAction(action: string): void {
    try {
        chrome.runtime.sendMessage({
            type: "riskyActionDetected",
            action,
            pageRiskLevel: currentPageRiskLevel,
        });
    } catch (e) {
        console.warn("[AI Hygiene] Failed to report risky action:", e);
    }
}

function initRiskyActionDetection(): void {
    // Fetch the current risk level from background (non-blocking)
    try {
        chrome.runtime.sendMessage({ type: "getRiskLevel" }, (response) => {
            if (response?.level) {
                currentPageRiskLevel = response.level as "safe" | "warning" | "danger";
            }
        });
    } catch {
        // If the runtime is unavailable, fall back to "safe" (no penalty)
    }

    // Listen for clicks on the entire document and check the target anchor
    document.addEventListener("click", (event: MouseEvent) => {
        // Only apply penalties when on a risky page
        if (currentPageRiskLevel === "safe") return;

        const target = event.target as HTMLElement;
        // Walk up the DOM tree to find the nearest anchor (handles clicks on child elements)
        const anchor = target.closest("a") as HTMLAnchorElement | null;
        if (!anchor) return;

        if (isRiskyDownloadLink(anchor)) {
            reportRiskyAction("file download on risky page");
        } else if (isExternalLink(anchor)) {
            reportRiskyAction("external link click on risky page");
        }
    }, { capture: true });
}

// Initialise risky action detection after a short delay to let the page settle
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(initRiskyActionDetection, 600));
} else {
    setTimeout(initRiskyActionDetection, 600);
}
