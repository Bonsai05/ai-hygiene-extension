// src/lib/constants.ts
// Centralized configuration constants for the AI Hygiene Extension

// ---------------------------------------------------------------------------
// Extension metadata
// ---------------------------------------------------------------------------
export const EXTENSION_NAME = "AI Hygiene Companion";
export const EXTENSION_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------
export const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000";

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------
export const STORAGE_KEYS = {
  USER_STATS: "userStats",
  RISK_LEVEL: "currentRiskLevel",
  RISK_EVENTS: "riskEventLog",
  VISITED_URLS: "visitedUrls",
  DANGER_TABS: "dangerTabs",
  ONBOARDING_COMPLETED: "onboardingCompleted",
  BACKEND_SETTINGS: "backendSettings",
  NOTIFICATION_SETTINGS: "notificationSettings",
  WHITELIST: "domainWhitelist",
} as const;

// ---------------------------------------------------------------------------
// XP Rewards (single source of truth)
// ---------------------------------------------------------------------------
export const XP_REWARDS = {
  SAFE_BROWSE: 5,        // Safe page visit
  WARNING_BROWSE: 10,    // Browsed a warning page without risky action (+10 XP)
  WARNING_IGNORED: 10,   // Dismissed warning banner (same tier)
  DANGER_AVOIDED: 25,    // Navigated away from danger page
  DANGER_PENALTY: 15,    // Landed on a danger page
  RISKY_ACTION_PENALTY: 15, // Performed risky action (download/mal-link) on a risky page
  SECURE_LOGIN: 10,
  PANIC_RECOVERY_COMPLETE: 30,
  PANIC_INITIATED: 5,
  BADGE_EARNED: 50,
  STREAK_MILESTONE: 15,
} as const;

// ---------------------------------------------------------------------------
// Risk thresholds (weighted scoring system)
// ---------------------------------------------------------------------------
export const RISK_THRESHOLDS = {
  DANGER: 65,  // Score >= 65 = danger
  WARNING: 35, // Score >= 35 = warning
  MINOR: 15,   // Score >= 15 = safe with minor concerns
} as const;

// ---------------------------------------------------------------------------
// Risk weights (for weighted scoring)
// ---------------------------------------------------------------------------
export const RISK_WEIGHTS = {
  // CRITICAL (never a false positive) - ensure DANGER on single signal
  TYPOSQUAT: 65,
  PASSWORD_ON_HTTP: 65,
  DATA_URI: 65,
  URL_WITH_AT: 65,

  // HIGH (strong phishing indicators)
  IP_HOSTNAME: 65,
  EXTERNAL_FORM_ACTION: 30,
  URGENT_LANGUAGE_3_PLUS: 30,

  // MEDIUM (worth noting)
  HTTP_PROTOCOL: 20,
  SUSPICIOUS_TLD: 20,
  EXCESSIVE_SUBDOMAINS: 20,
  REDIRECT_PARAM: 15,

  // LOW (minor concerns)
  LONG_URL: 10,
  BRAND_KEYWORD_PATH: 10,
} as const;

// ---------------------------------------------------------------------------
// Context modifiers (for weighted scoring)
// ---------------------------------------------------------------------------
export const CONTEXT_MODIFIERS = {
  KNOWN_BRAND: 0.5,    // Brand keywords REDUCE risk (legitimate sites)
  HAS_USER_INPUT: 1.3, // Forms increase stakes
  MULTIPLE_SIGNALS: 1.2, // 3+ signals = compound risk
} as const;

// ---------------------------------------------------------------------------
// Level thresholds (XP required for each level)
// ---------------------------------------------------------------------------
export const LEVEL_THRESHOLDS = [
  0,    // Level 1
  100,  // Level 2
  200,  // Level 3
  300,  // Level 4
  400,  // Level 5
  500,  // Level 6
  600,  // Level 7
  700,  // Level 8
  800,  // Level 9
  900,  // Level 10 (max)
] as const;

export const MAX_LEVEL = 10;
export const XP_PER_LEVEL = 100;

// ---------------------------------------------------------------------------
// Timing constants
// ---------------------------------------------------------------------------
export const TIMINGS = {
  XP_COOLDOWN_MS: 5000,           // Minimum time between XP awards
  ANALYSIS_COOLDOWN_MS: 30000,    // Minimum time between domain analyses
  TOAST_DURATION_MS: 3000,        // How long XP toasts show
  LEVEL_UP_DURATION_MS: 4000,     // How long level-up celebration shows
  SCAN_DELAY_MS: 1000,            // Delay before content script scan
  NOTIFICATION_DELAY_MS: 500,     // Delay between notifications
} as const;

// ---------------------------------------------------------------------------
// Streak milestones (pages → badge id)
// ---------------------------------------------------------------------------
export const STREAK_MILESTONES: Record<number, string> = {
  10: "streak-starter",
  25: "streak-veteran",
  50: "streak-legend",
} as const;

// ---------------------------------------------------------------------------
// Level titles
// ---------------------------------------------------------------------------
export const LEVEL_TITLES: Record<number, string> = {
  1: "Newcomer",
  2: "Browser",
  3: "Surfer",
  4: "Defender",
  5: "Guardian",
  6: "Sentinel",
  7: "Shield Master",
  8: "Security Expert",
  9: "Cyber Guardian",
  10: "Digital Hygiene Hero",
} as const;

// ---------------------------------------------------------------------------
// Known brands (for typosquatting and brand keyword detection)
// ---------------------------------------------------------------------------
export const KNOWN_BRANDS = [
  "google",
  "microsoft",
  "apple",
  "amazon",
  "facebook",
  "meta",
  "paypal",
  "stripe",
  "netflix",
  "spotify",
  "dropbox",
  "adobe",
  "github",
] as const;

// ---------------------------------------------------------------------------
// Suspicious TLDs (commonly used for phishing)
// ---------------------------------------------------------------------------
export const SUSPICIOUS_TLDS = [".tk", ".ml", ".ga", ".cf", ".gq", ".xyz", ".top", ".work"] as const;

// ---------------------------------------------------------------------------
// Skip list (URLs to never analyze)
// ---------------------------------------------------------------------------
export const SKIP_LIST = [
  "chrome://",
  "chrome-extension://",
  "about:",
  "edge:",
  "chrome-search://",
  "localhost",
  "127.0.0.1",
  "newtab",
  "blank",
  "devtools",
  "file://",
  "view-source:",
] as const;

// ---------------------------------------------------------------------------
// High-priority patterns (URLs to always analyze)
// ---------------------------------------------------------------------------
export const HIGH_PRIORITY_PATTERNS = [
  /login|signin|auth|account|verify|secure/i,
  /bank|finance|payment|checkout|paypal|stripe/i,
  /google|microsoft|apple|amazon|facebook|meta/i,
  /netflix|spotify|dropbox|adobe|github/i,
  /crypto|wallet|blockchain|coinbase/i,
] as const;

// ---------------------------------------------------------------------------
// Typosquatting patterns (anchored to match brand name at start of hostname)
// NOTE: Only include ACTUAL typosquats, NOT legitimate brand domains
// ---------------------------------------------------------------------------
export const TYPOSQUAT_PATTERNS = [
  /^g00gle\./,      // g-zero-zero-gle
  /^goog1e\./,      // goog-one-e
  /^googl3\./,      // googl-three
  /^faceb00k\./,    // faceb-zero-zero-k
  /^facebok\./,     // missing 'o'
  /^twltter\./,     // missing 'i'
  /^l1nkedin\./,    // l-one-nked-in
  /^amaz0n\./,      // amaz-zero-n
  /^paypa1\./,      // paypa-one
  /^app1e\./,       // app-one-e
  /^micros0ft\./,   // micros-zero-ft
  /^g00g1e\./,      // g-zero-zero-g-one-e
] as const;

// ---------------------------------------------------------------------------
// Suspicious phrases (for page content scanning)
// ---------------------------------------------------------------------------
export const SUSPICIOUS_PHRASES = [
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
] as const;
