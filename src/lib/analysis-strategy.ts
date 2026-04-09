// src/lib/analysis-strategy.ts
// Intelligent site analysis algorithm with multi-layer filtering
//
// Problem: Analyzing EVERY page load causes performance degradation and alert fatigue
// Solution: Skip internal URLs, cache domain results, prioritize high-value targets

import { isWhitelisted } from "./whitelist";
import { SKIP_LIST, HIGH_PRIORITY_PATTERNS, TIMINGS } from "./constants";

/**
 * Known-safe domains that are verified legitimate sites
 * These will always be marked as safe without analysis
 */
const KNOWN_SAFE_DOMAINS = new Set([
  'accounts.google.com',
  'mail.google.com',
  'google.com',
  'www.google.com',
  'paypal.com',
  'www.paypal.com',
  'account.paypal.com',
  'signin.ebay.com',
  'signin.amazon.com',
  'amazon.com',
  'www.amazon.com',
  'microsoft.com',
  'www.microsoft.com',
  'login.live.com',
  'apple.com',
  'www.apple.com',
  'iforgot.apple.com',
  'github.com',
  'www.github.com',
  'login.github.com',
  'facebook.com',
  'www.facebook.com',
  'messenger.com',
  'www.messenger.com',
  'netflix.com',
  'www.netflix.com',
  'spotify.com',
  'www.spotify.com',
  'dropbox.com',
  'www.dropbox.com',
  'outlook.live.com',
  'mail.outlook.com',
]);

/**
 * Domain cache: stores analysis results per domain
 * Key: hostname, Value: analysis result + timestamp
 */
interface CachedAnalysis {
  time: number;
  level: 'safe' | 'warning' | 'danger';
  patterns: string[];
}

const analyzedDomains = new Map<string, CachedAnalysis>();
const domainHasSensitiveForms = new Map<string, boolean>();

export interface AnalysisDecision {
  shouldAnalyze: boolean;
  cachedResult?: CachedAnalysis;
}

/**
 * Check if a URL should be analyzed based on intelligent filtering
 * Returns decision with cached result if available
 * 
 * Key principle: When a domain has been recently analyzed (within cooldown),
 * we ALWAYS use the cached result for both risk level AND XP awarding.
 * This prevents inconsistent behavior where some revisits award XP and others don't.
 */
export async function shouldAnalyzeUrl(url: string): Promise<AnalysisDecision> {
  // 0. Check whitelist first (user-trusted domains)
  if (await isWhitelisted(url)) {
    return { shouldAnalyze: false };
  }

  // 1. Skip internal/safe URLs
  if (SKIP_LIST.some((skip) => url.startsWith(skip))) {
    return { shouldAnalyze: false };
  }

  try {
    const parsed = new URL(url);
    const domain = parsed.hostname;

    // 1.5. Check known-safe domains - always mark as safe
    if (KNOWN_SAFE_DOMAINS.has(domain)) {
      return {
        shouldAnalyze: false,
        cachedResult: {
          time: Date.now(),
          level: 'safe',
          patterns: ['known_safe_domain'],
        },
      };
    }

    // 2. Check domain cache and cooldown FIRST
    // This ensures consistent behavior: if recently analyzed, use cache
    const cached = analyzedDomains.get(domain);
    const inCooldown = cached && Date.now() - cached.time < TIMINGS.ANALYSIS_COOLDOWN_MS;

    // If in cooldown period, ALWAYS use cached result (for consistent XP awarding)
    if (inCooldown) {
      return { shouldAnalyze: false, cachedResult: cached };
    }

    // 3. Check high-priority patterns (only when NOT in cooldown)
    const isHighPriority = HIGH_PRIORITY_PATTERNS.some((p) => p.test(url));
    if (isHighPriority) {
      return { shouldAnalyze: true };
    }

    // 4. Analyze if domain has sensitive forms (from content script)
    if (domainHasSensitiveForms.get(domain)) {
      return { shouldAnalyze: true };
    }

    // 5. Default: don't re-analyze, but return cached result if available
    return { shouldAnalyze: false, cachedResult: cached };
  } catch {
    return { shouldAnalyze: false };
  }
}

/**
 * Mark a domain as analyzed and cache the result
 */
export function markDomainAnalyzed(
  url: string,
  level: 'safe' | 'warning' | 'danger',
  patterns: string[]
): void {
  try {
    const domain = new URL(url).hostname;
    analyzedDomains.set(domain, {
      time: Date.now(),
      level,
      patterns,
    });
  } catch {
    // Invalid URL, skip caching
  }
}

/**
 * Get cached analysis result for a domain
 */
export function getCachedAnalysis(url: string): CachedAnalysis | null {
  try {
    const domain = new URL(url).hostname;
    return analyzedDomains.get(domain) ?? null;
  } catch {
    return null;
  }
}

/**
 * Mark a domain as having sensitive forms (from content script signals)
 */
export function setDomainHasSensitiveForm(domain: string, hasForm: boolean): void {
  domainHasSensitiveForms.set(domain, hasForm);
}

/**
 * Clear the domain cache (useful for testing or manual refresh)
 */
export function clearDomainCache(): void {
  analyzedDomains.clear();
  domainHasSensitiveForms.clear();
}

/**
 * Get cache statistics (for debugging)
 */
export function getCacheStats(): { size: number; domains: string[] } {
  return {
    size: analyzedDomains.size,
    domains: Array.from(analyzedDomains.keys()),
  };
}
