// content-script.ts
// Runs in every page context. Self-contained — cannot import from lib/.
// Analyzes page content and reports signals to background.
// Also detects risky click actions (downloads / external links) on risky pages.

// ── Suspicious phrases for content scanning ───────────────────────────────
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

// ── Risky file extensions ─────────────────────────────────────────────────
const RISKY_EXTS = [
  ".exe", ".msi", ".bat", ".cmd", ".ps1", ".vbs",
  ".zip", ".rar", ".7z", ".tar", ".gz",
  ".dmg", ".pkg", ".apk",
];

interface PageSignals {
  hasLoginForm: boolean;
  formActionExternal: boolean;
  hasPasswordField: boolean;
  hasEmailField: boolean;
  externalFormAction: string | null;
  suspiciousPhrases: string[];
  hasIframeEmbed: boolean;
  /** true when password field on HTTP */
  passwordOnHttp: boolean;
}

// ── Page analysis ─────────────────────────────────────────────────────────
function scanPageContent(): PageSignals {
  const signals: PageSignals = {
    hasLoginForm: false,
    formActionExternal: false,
    hasPasswordField: false,
    hasEmailField: false,
    externalFormAction: null,
    suspiciousPhrases: [],
    hasIframeEmbed: false,
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
    for (const form of forms) {
      const action = form.getAttribute("action") ?? "";
      if (action && !action.startsWith("/") && !action.startsWith(window.location.origin)) {
        signals.formActionExternal = true;
        signals.externalFormAction = action;
      }
    }

    // Suspicious phrases
    const bodyText = document.body?.innerText?.toLowerCase() ?? "";
    for (const phrase of SUSPICIOUS_PHRASES) {
      if (bodyText.includes(phrase)) signals.suspiciousPhrases.push(phrase);
    }

    // Iframe check
    signals.hasIframeEmbed = document.querySelectorAll("iframe").length > 0;

    // Password on HTTP
    if (signals.hasPasswordField && window.location.protocol !== "https:") {
      signals.passwordOnHttp = true;
    }
  } catch {}

  return signals;
}

function sendSignals(signals: PageSignals): void {
  try {
    chrome.runtime.sendMessage({ type: "pageScanResult", url: window.location.href, signals });
  } catch {}
}

function runPageScan(): void {
  if (!document.body || document.body.children.length === 0) return;
  sendSignals(scanPageContent());
}

// Run after page settles
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => setTimeout(runPageScan, 500));
} else {
  setTimeout(runPageScan, 500);
}

// ── Risky action detection ────────────────────────────────────────────────
let currentRiskLevel: "safe" | "warning" | "danger" = "safe";

function isRiskyDownload(a: HTMLAnchorElement): boolean {
  if (a.hasAttribute("download")) return true;
  try {
    const path = new URL(a.href).pathname.toLowerCase();
    return RISKY_EXTS.some(ext => path.endsWith(ext));
  } catch { return false; }
}

function isExternalLink(a: HTMLAnchorElement): boolean {
  try {
    return new URL(a.href).hostname !== window.location.hostname;
  } catch { return false; }
}

function reportAction(action: string): void {
  try {
    chrome.runtime.sendMessage({
      type: "riskyActionDetected",
      action,
      pageRiskLevel: currentRiskLevel,
    });
  } catch {}
}

function initClickMonitor(): void {
  // Fetch risk level once
  try {
    chrome.runtime.sendMessage({ type: "getRiskLevel" }, (res) => {
      if (res?.level) currentRiskLevel = res.level;
    });
  } catch {}

  // Listen for risk updates from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "riskUpdate" && msg.level) {
      currentRiskLevel = msg.level as typeof currentRiskLevel;
    }
  });

  // Click listener to detect risky actions
  document.addEventListener("click", (e: MouseEvent) => {
    if (currentRiskLevel === "safe") return;
    const a = (e.target as HTMLElement).closest("a") as HTMLAnchorElement | null;
    if (!a) return;
    if (isRiskyDownload(a)) reportAction("file download on risky page");
    else if (isExternalLink(a)) reportAction("external link click on risky page");
  }, { capture: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => setTimeout(initClickMonitor, 600));
} else {
  setTimeout(initClickMonitor, 600);
}
