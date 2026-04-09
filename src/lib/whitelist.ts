// src/lib/whitelist.ts
// Domain whitelist for allowing trusted sites without warnings
//
// Users can add domains to the whitelist to disable warnings/analysis
// Useful for internal company sites, development environments, etc.

import { STORAGE_KEYS } from "./constants";

export interface WhitelistEntry {
  domain: string;
  addedAt: number;
  reason: string;
}

/**
 * Load the whitelist from storage
 */
export async function loadWhitelist(): Promise<WhitelistEntry[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.WHITELIST], (result) => {
      if (chrome.runtime.lastError) {
        console.error("[Whitelist] Load failed:", chrome.runtime.lastError);
        resolve([]);
        return;
      }
      resolve((result[STORAGE_KEYS.WHITELIST] as WhitelistEntry[]) || []);
    });
  });
}

/**
 * Save the whitelist to storage
 */
export async function saveWhitelist(entries: WhitelistEntry[]): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEYS.WHITELIST]: entries }, () => {
      if (chrome.runtime.lastError) {
        console.error("[Whitelist] Save failed:", chrome.runtime.lastError);
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });
}

/**
 * Check if a domain is whitelisted
 */
export async function isWhitelisted(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname;
    const whitelist = await loadWhitelist();
    return whitelist.some((entry) => entry.domain === domain);
  } catch {
    return false;
  }
}

/**
 * Add a domain to the whitelist
 */
export async function addToWhitelist(url: string, reason: string): Promise<void> {
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname;
    const whitelist = await loadWhitelist();

    // Don't add duplicates
    if (whitelist.some((entry) => entry.domain === domain)) {
      return;
    }

    const newEntry: WhitelistEntry = {
      domain,
      addedAt: Date.now(),
      reason,
    };

    await saveWhitelist([...whitelist, newEntry]);
  } catch (err) {
    console.error("[Whitelist] Add failed:", err);
  }
}

/**
 * Remove a domain from the whitelist
 */
export async function removeFromWhitelist(url: string): Promise<void> {
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname;
    const whitelist = await loadWhitelist();
    const filtered = whitelist.filter((entry) => entry.domain !== domain);
    await saveWhitelist(filtered);
  } catch (err) {
    console.error("[Whitelist] Remove failed:", err);
  }
}

/**
 * Clear the entire whitelist
 */
export async function clearWhitelist(): Promise<void> {
  await saveWhitelist([]);
}

/**
 * Get whitelist statistics
 */
export async function getWhitelistStats(): Promise<{ count: number; domains: string[] }> {
  const whitelist = await loadWhitelist();
  return {
    count: whitelist.length,
    domains: whitelist.map((entry) => entry.domain),
  };
}

/**
 * Export whitelist for backup
 */
export async function exportWhitelist(): Promise<string> {
  const whitelist = await loadWhitelist();
  return JSON.stringify(whitelist, null, 2);
}

/**
 * Import whitelist from JSON
 */
export async function importWhitelist(json: string): Promise<void> {
  try {
    const entries = JSON.parse(json) as WhitelistEntry[];
    // Validate entries
    const valid = entries.filter(
      (entry) =>
        typeof entry.domain === "string" &&
        typeof entry.addedAt === "number" &&
        typeof entry.reason === "string"
    );
    await saveWhitelist(valid);
  } catch (err) {
    console.error("[Whitelist] Import failed:", err);
    throw new Error("Invalid whitelist JSON");
  }
}
