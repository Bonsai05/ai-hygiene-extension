// src/lib/analysis-strategy.ts
// SIMPLIFIED — Domain-level caching is now handled inside background.ts
// with a simple in-memory Map. This file is kept for backwards compatibility
// with any test files that reference it.

export interface AnalysisDecision {
  shouldAnalyze: boolean;
}

/** @deprecated Domain caching is now handled in background.ts directly. */
export async function shouldAnalyzeUrl(_url: string): Promise<AnalysisDecision> {
  return { shouldAnalyze: true };
}

/** @deprecated */
export function markDomainAnalyzed(_url: string, _level: string, _patterns: string[]): void {}

/** @deprecated */
export function getCachedAnalysis(_url: string): null {
  return null;
}

/** @deprecated */
export function setDomainHasSensitiveForm(_domain: string, _has: boolean): void {}

/** @deprecated */
export function clearDomainCache(): void {}
