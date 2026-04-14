// content-script.ts
// Runs in every page context. Self-contained — cannot import from lib/.
//
// Responsibilities:
//   1. Initial page scan → pageScanResult → background
//   2. MutationObserver for dynamic DOM changes → domMutationScan → background
//   3. Form input PII monitoring → piiInputScan → background
//   4. Listen for piiFieldWarning → inject red outline + tooltip on the field
//   5. Listen for riskUpdate → update currentRiskLevel for click monitoring
//   6. Risky click detection (download/external links on risky pages)

// ── Suspicious phrases ──────────────────────────────────────────────────────
const SUSPICIOUS_PHRASES = [
  "verify your account",
  "confirm your identity",
  "suspend your account",
  "verify your password",
  "click here to verify",
  "confirm your account",
  "urgent action required",
  "your account will be suspended",
  "enter your credit card",
  "validate your account",
];

// ── Known tracker scripts ────────────────────────────────────────────────────
const KNOWN_TRACKERS = [
  "google-analytics.com", "doubleclick.net", "facebook.com/tr",
  "hotjar.com", "fullstory.com", "mixpanel.com", "amplitude.com",
  "segment.com", "heap.io", "clarity.ms", "mouseflow.com",
  "intercom.com", "crisp.chat",
];

// ── Risky file extensions ────────────────────────────────────────────────────
const RISKY_EXTS = [
  ".exe", ".msi", ".bat", ".cmd", ".ps1", ".vbs",
  ".zip", ".rar", ".7z", ".tar", ".gz",
  ".dmg", ".pkg", ".apk",
];

// ── Tooltip / PII warning styles ─────────────────────────────────────────────
const PII_OUTLINE_STYLE = "2px solid #ef4444";
const PII_TOOLTIP_ATTR = "data-aih-tooltip";
const PII_MARKED_ATTR = "data-aih-pii-marked";

// ── Interfaces ───────────────────────────────────────────────────────────────
interface PageSignals {
  hasLoginForm: boolean;
  formActionExternal: boolean;
  hasPasswordField: boolean;
  hasEmailField: boolean;
  externalFormAction: string | null;
  suspiciousPhrases: string[];
  hasIframeEmbed: boolean;
  passwordOnHttp: boolean;
  missingSecurityIndicators: boolean;
  hasObfuscatedText: boolean;
  formCount: number;
  inputCount: number;
}

// ── Page text extraction ─────────────────────────────────────────────────────
function extractPageText(maxLen = 2000): string {
  try {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("script, style, noscript, svg").forEach(el => el.remove());
    const text = clone.innerText ?? clone.textContent ?? "";
    return text.replace(/\s+/g, " ").trim().slice(0, maxLen);
  } catch {
    return "";
  }
}

// ── Tracker detection ────────────────────────────────────────────────────────
function detectTrackers(): string[] {
  try {
    const scripts = Array.from(document.querySelectorAll("script[src]"))
      .map(s => s.getAttribute("src") ?? "");
    return KNOWN_TRACKERS.filter(t => scripts.some(src => src.includes(t)));
  } catch {
    return [];
  }
}

// ── Full page scan ────────────────────────────────────────────────────────────
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
    missingSecurityIndicators: false,
    hasObfuscatedText: false,
    formCount: 0,
    inputCount: 0,
  };

  try {
    const forms = document.querySelectorAll("form");
    const pwInputs = document.querySelectorAll("input[type='password']");
    const emailInputs = document.querySelectorAll(
      "input[type='email'], input[name='email'], input[name='username']"
    );
    const allInputs = document.querySelectorAll("input, textarea, select");

    signals.formCount = forms.length;
    signals.inputCount = allInputs.length;
    signals.hasPasswordField = pwInputs.length > 0;
    signals.hasEmailField = emailInputs.length > 0;
    signals.hasLoginForm = pwInputs.length > 0;

    // Form action — only flag absolute external URLs
    for (const form of forms) {
      const action = form.getAttribute("action") ?? "";
      if (
        action &&
        (action.startsWith("http://") || action.startsWith("https://")) &&
        !action.startsWith(window.location.origin)
      ) {
        signals.formActionExternal = true;
        signals.externalFormAction = action;
      }
    }

    // Suspicious phrases
    const bodyText = document.body?.innerText?.toLowerCase() ?? "";
    for (const phrase of SUSPICIOUS_PHRASES) {
      if (bodyText.includes(phrase)) signals.suspiciousPhrases.push(phrase);
    }

    // Iframe — only meaningful with password field
    signals.hasIframeEmbed =
      signals.hasPasswordField && document.querySelectorAll("iframe").length > 0;

    // Password on HTTP
    if (signals.hasPasswordField && window.location.protocol !== "https:") {
      signals.passwordOnHttp = true;
      signals.missingSecurityIndicators = true;
    }

    // Obfuscated inline scripts
    const inlineScripts = Array.from(document.querySelectorAll("script:not([src])"))
      .map(s => s.textContent ?? "");
    signals.hasObfuscatedText = /eval\s*\(\s*(?:atob|unescape)/.test(inlineScripts.join("\n"));
  } catch {}

  return signals;
}

// ── Message helpers ──────────────────────────────────────────────────────────
function safeSendMessage(msg: Record<string, unknown>): void {
  try {
    chrome.runtime.sendMessage(msg);
  } catch {}
}

// ── Initial page scan ────────────────────────────────────────────────────────
function runInitialPageScan(): void {
  if (!document.body || document.body.children.length === 0) return;
  const signals = scanPageContent();
  const trackers = detectTrackers();
  const pageText = extractPageText(2000);
  safeSendMessage({
    type: "pageScanResult",
    url: window.location.href,
    signals,
    trackers,
    pageText,
  });
}

// ── MutationObserver for dynamic DOM ────────────────────────────────────────
// Fires at most once per 2s. Only sends first 1024 chars of new text.
let mutationTimer: ReturnType<typeof setTimeout> | null = null;
let mutationBuffer = "";
let mutationObserverActive = false;

function flushMutationBuffer(): void {
  const text = mutationBuffer.slice(0, 1024).trim();
  mutationBuffer = "";
  if (!text || text.length < 20) return; // skip tiny mutations
  safeSendMessage({
    type: "domMutationScan",
    url: window.location.href,
    text,
  });
}

function setupMutationObserver(): void {
  if (mutationObserverActive) return;
  mutationObserverActive = true;

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          mutationBuffer += " " + (node.textContent ?? "");
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          // Skip scripts/styles
          if (el.tagName === "SCRIPT" || el.tagName === "STYLE") continue;
          mutationBuffer += " " + (el.innerText ?? el.textContent ?? "").slice(0, 256);
        }
      }
    }
    if (mutationTimer) clearTimeout(mutationTimer);
    mutationTimer = setTimeout(flushMutationBuffer, 2000);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: false, // don't watch every keystroke
  });
}

// ── PII field monitoring ─────────────────────────────────────────────────────
// Debounced 800ms per field. Only active when page is not "safe".
const piiFieldTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
let currentRiskLevel: "safe" | "warning" | "danger" = "safe";

function monitorFieldForPii(field: HTMLInputElement | HTMLTextAreaElement): void {
  field.addEventListener("input", () => {
    if (currentRiskLevel === "safe") return;
    const text = field.value.trim();
    if (text.length < 3) return;
    const existing = piiFieldTimers.get(field);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      // Include a field identifier so background can send it back
      const fieldId = field.id || field.name || field.getAttribute("placeholder") || "unknown";
      safeSendMessage({
        type: "piiInputScan",
        text,
        fieldId,
        url: window.location.href,
      });
    }, 800);
    piiFieldTimers.set(field, timer);
  });
}

function setupPiiFieldMonitors(): void {
  const sensitiveFields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    "input[type='email'], input[type='text'], input[type='tel'], input[name='email'], " +
    "input[name='username'], input[name='phone'], input[name='ssn'], " +
    "input[name='card'], input[name='cc'], textarea"
  );
  for (const field of sensitiveFields) {
    monitorFieldForPii(field as HTMLInputElement | HTMLTextAreaElement);
  }

  // Also watch for dynamically added fields
  const observer = new MutationObserver(() => {
    const newFields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      "input[type='email'], input[type='text'], input[name='email'], textarea"
    );
    for (const field of newFields) {
      if (!piiFieldTimers.has(field)) {
        monitorFieldForPii(field as HTMLInputElement | HTMLTextAreaElement);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// ── PII visual warning injection ─────────────────────────────────────────────
// Called when background sends back a piiFieldWarning message.
function applyPiiWarning(fieldId: string): void {
  try {
    const selector = fieldId !== "unknown"
      ? `[id="${fieldId}"], [name="${fieldId}"], [placeholder="${fieldId}"]`
      : "input[type='email'], input[type='text'], input[name='email']";

    const fields = document.querySelectorAll<HTMLElement>(selector);
    for (const field of fields) {
      if (field.getAttribute(PII_MARKED_ATTR)) continue; // already warned
      field.setAttribute(PII_MARKED_ATTR, "1");

      // Red outline
      const prevOutline = field.style.outline;
      field.style.outline = PII_OUTLINE_STYLE;
      field.style.outlineOffset = "1px";

      // Tooltip
      createPiiTooltip(field);

      // Auto-remove after 8s so UX isn't permanently degraded
      setTimeout(() => {
        field.style.outline = prevOutline;
        field.style.outlineOffset = "";
        field.removeAttribute(PII_MARKED_ATTR);
        removePiiTooltip(field);
      }, 8000);
    }
  } catch {}
}

function createPiiTooltip(field: HTMLElement): void {
  // Inject into a Shadow DOM so it can't be styled-away by the page
  const host = document.createElement("div");
  host.setAttribute(PII_TOOLTIP_ATTR, "1");
  Object.assign(host.style, {
    position: "absolute",
    zIndex: "2147483647",
    pointerEvents: "none",
  });

  // Position near the field
  const rect = field.getBoundingClientRect();
  Object.assign(host.style, {
    top: `${rect.bottom + window.scrollY + 4}px`,
    left: `${rect.left + window.scrollX}px`,
  });

  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <div style="background:#1e1e1e;color:#fff;font-family:-apple-system,sans-serif;
      font-size:11px;font-weight:600;padding:5px 10px;border-radius:4px;
      border-left:3px solid #ef4444;white-space:nowrap;
      box-shadow:0 2px 8px rgba(0,0,0,.5);">
      🔴 Sensitive data detected on a risky site
    </div>`;

  // Tag field so we can find the tooltip to remove it
  field.dataset.aihTooltipId = String(Date.now());
  host.dataset.fieldTag = field.dataset.aihTooltipId;
}

function removePiiTooltip(field: HTMLElement): void {
  const tag = field.dataset.aihTooltipId;
  if (!tag) return;
  document.querySelectorAll(`[${PII_TOOLTIP_ATTR}]`).forEach(host => {
    if ((host as HTMLElement).dataset.fieldTag === tag) host.remove();
  });
}

// ── Risky action detection ────────────────────────────────────────────────────
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

function initClickMonitor(): void {
  try {
    chrome.runtime.sendMessage({ type: "getRiskLevel" }, (res) => {
      if (res?.level) currentRiskLevel = res.level;
    });
  } catch {}

  document.addEventListener("click", (e: MouseEvent) => {
    if (currentRiskLevel === "safe") return;
    const a = (e.target as HTMLElement).closest("a") as HTMLAnchorElement | null;
    if (!a) return;
    if (isRiskyDownload(a)) {
      safeSendMessage({ type: "riskyActionDetected", action: "file download on risky page", pageRiskLevel: currentRiskLevel });
    } else if (isExternalLink(a)) {
      safeSendMessage({ type: "riskyActionDetected", action: "external link click on risky page", pageRiskLevel: currentRiskLevel });
    }
  }, { capture: true });
}

// ── Message listener (from background) ───────────────────────────────────────
chrome.runtime.onMessage.addListener((msg: Record<string, unknown>) => {
  // Risk level updated — keep currentRiskLevel in sync
  if (msg.type === "riskUpdate" && msg.level) {
    currentRiskLevel = msg.level as typeof currentRiskLevel;
    // If page just became non-safe, activate PII monitoring
    if (currentRiskLevel !== "safe") {
      setupPiiFieldMonitors();
    }
  }

  // PII warning for a specific field
  if (msg.type === "piiFieldWarning" && msg.fieldId) {
    applyPiiWarning(msg.fieldId as string);
  }
});

// ── Bootstrap ────────────────────────────────────────────────────────────────
function bootstrap(): void {
  // 1. Initial full page scan (run after DOM is ready)
  runInitialPageScan();

  // 2. Set up MutationObserver for dynamic content
  setupMutationObserver();

  // 3. Set up PII monitors — initially only on non-safe pages
  //    (setupPiiFieldMonitors is also called when riskUpdate arrives)
  chrome.runtime.sendMessage({ type: "getRiskLevel" }, (res) => {
    if (res?.level && res.level !== "safe") {
      setupPiiFieldMonitors();
    }
  });

  // 4. Click monitor
  initClickMonitor();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => setTimeout(bootstrap, 500));
} else {
  setTimeout(bootstrap, 500);
}
