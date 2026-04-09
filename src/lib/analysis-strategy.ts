// src/lib/analysis-strategy.ts
// Intelligent site analysis algorithm with multi-layer filtering
//
// Problem: Analyzing EVERY page load causes performance degradation and alert fatigue
// Solution: Skip internal URLs, cache domain results, prioritize high-value targets

import { isWhitelisted } from "./whitelist";

/**
 * Sites to NEVER analyze (skip list)
 * These are internal/safe URLs that should never trigger analysis
 */
const SKIP_LIST = [
  'chrome://',
  'chrome-extension://',
  'about:',
  'edge:',
  'chrome-search://',
  'localhost',
  '127.0.0.1',
  'newtab',
  'blank',
  'devtools',
  'file://',
  'view-source:',
];

/**
 * Sites to ALWAYS analyze (high-value targets)
 * These patterns indicate pages that are common phishing targets
 */
const HIGH_PRIORITY_PATTERNS = [
  /login|signin|auth|account|verify|secure/i,
  /bank|finance|payment|checkout|paypal|stripe/i,
  /google|microsoft|apple|amazon|facebook|meta/i,
  /netflix|spotify|dropbox|adobe|github/i,
  /crypto|wallet|blockchain|coinbase/i,
];

/**
 * Minimum time between analyses per domain (30 seconds)
 * Prevents redundant analysis on rapid tab switches
 */
const ANALYSIS_COOLDOWN_MS = 30000;

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

/**
 * Check if a URL should be analyzed based on intelligent filtering
 */
export async function shouldAnalyzeUrl(url: string): Promise<boolean> {
  // 0. Check whitelist first (user-trusted domains)
  if (await isWhitelisted(url)) {
    return false;
  }

  // 1. Skip internal/safe URLs
  if (SKIP_LIST.some((skip) => url.startsWith(skip))) {
    return false;
  }

  try {
    const parsed = new URL(url);
    const domain = parsed.hostname;

    // 2. Check domain cache (skip if recently analyzed)
    const cached = analyzedDomains.get(domain);
    if (cached && Date.now() - cached.time < ANALYSIS_COOLDOWN_MS) {
      return false;
    }

    // 3. Check high-priority patterns (always analyze these when not in cooldown)
    const isHighPriority = HIGH_PRIORITY_PATTERNS.some((p) => p.test(url));
    if (isHighPriority) {
      return true;
    }

    // 4. Analyze if domain has sensitive forms (from content script)
    return domainHasSensitiveForms.get(domain) ?? false;
  } catch {
    return false;
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
