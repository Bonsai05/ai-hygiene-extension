// src/lib/constants.ts
// Single source of truth for all configuration values

export const EXTENSION_NAME = "AI Hygiene Companion";
export const EXTENSION_VERSION = "2.0.0";
export const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000";

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------
export const STORAGE_KEYS = {
  USER_STATS: "userStats",
  RISK_LEVEL: "currentRiskLevel",
  RISK_EVENTS: "riskEventLog",
  ONBOARDING_COMPLETED: "onboardingCompleted",
  BACKEND_SETTINGS: "backendSettings",
  NOTIFICATION_SETTINGS: "notificationSettings",
  WHITELIST: "domainWhitelist",
} as const;

// ---------------------------------------------------------------------------
// XP values (used in production code — storage.ts, background.ts)
// ---------------------------------------------------------------------------
export const XP = {
  SAFE_BROWSE: 5,
  WARNING_BROWSE: 10,
  DANGER_PENALTY: 15,
  RISKY_ACTION_PENALTY: 15,
  DANGER_AVOIDED: 25,
  SECURE_LOGIN: 10,
  PANIC_INITIATED: 5,
  PANIC_RECOVERY: 30,
  BADGE_BONUS: 50,
  STREAK_BONUS: 15,
} as const;

// ---------------------------------------------------------------------------
// XP_REWARDS — test-compatible alias export
// gamification.test.ts imports these names specifically.
// BADGE_EARNED corresponds to XP.BADGE_BONUS
// PANIC_RECOVERY_COMPLETE corresponds to XP.PANIC_RECOVERY
// ---------------------------------------------------------------------------
export const XP_REWARDS = {
  SAFE_BROWSE: 5,
  WARNING_BROWSE: 10,
  DANGER_PENALTY: 15,
  RISKY_ACTION_PENALTY: 15,
  DANGER_AVOIDED: 25,
  SECURE_LOGIN: 10,
  PANIC_INITIATED: 5,
  PANIC_RECOVERY_COMPLETE: 30,
  BADGE_EARNED: 50,
  STREAK_BONUS: 15,
} as const;

// ---------------------------------------------------------------------------
// Levels: 10 levels, 100 XP each
// ---------------------------------------------------------------------------
export const XP_PER_LEVEL = 100;
export const MAX_LEVEL = 10;

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
};

// ---------------------------------------------------------------------------
// Risk detection
// ---------------------------------------------------------------------------
export const KNOWN_BRANDS = [
  "google", "microsoft", "apple", "amazon", "facebook", "meta",
  "paypal", "stripe", "netflix", "spotify", "dropbox", "adobe", "github",
] as const;

export const SUSPICIOUS_TLDS = [".tk", ".ml", ".ga", ".cf", ".gq", ".xyz", ".top", ".work"] as const;

export const TYPOSQUAT_PATTERNS = [
  /^g00gle\./,
  /^goog1e\./,
  /^googl3\./,
  /^faceb00k\./,
  /^facebok\./,
  /^twltter\./,
  /^l1nkedin\./,
  /^amaz0n\./,
  /^paypa1\./,
  /^app1e\./,
  /^micros0ft\./,
  /^g00g1e\./,
] as const;

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

// Skip analysis for these URL prefixes.
// IMPORTANT: localhost is included to prevent false analyses on dev environments.
export const SKIP_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "about:",
  "edge:",
  "devtools://",
  "file://",
  "view-source:",
  "http://localhost",
  "https://localhost",
] as const;

// ---------------------------------------------------------------------------
// Streak → badge milestones
// ---------------------------------------------------------------------------
export const STREAK_MILESTONES: Record<number, string> = {
  10: "streak-starter",
  25: "streak-veteran",
  50: "streak-legend",
};

// ---------------------------------------------------------------------------
// Session/timing
// ---------------------------------------------------------------------------
export const TOAST_COOLDOWN_MS = 4000;
export const XP_SESSION_KEY = "xpAwardedUrls";

// ---------------------------------------------------------------------------
// Tracker detection — known third-party trackers
// ---------------------------------------------------------------------------
export const KNOWN_TRACKERS = [
  "google-analytics.com",
  "doubleclick.net",
  "facebook.com/tr",
  "hotjar.com",
  "fullstory.com",
  "mixpanel.com",
  "amplitude.com",
  "segment.com",
  "heap.io",
  "clarity.ms",
  "mouseflow.com",
  "intercom.com",
  "crisp.chat",
] as const;
