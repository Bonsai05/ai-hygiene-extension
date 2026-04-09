// Unit tests for whitelist.ts
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock chrome.storage
const mockChromeStorage = {
  local: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
  },
};

// @ts-expect-error - mocking global chrome
global.chrome = {
  storage: mockChromeStorage,
  runtime: {
    lastError: null,
  },
};

// Clear mock call history before each test
beforeEach(() => {
  vi.clearAllMocks();
  chrome.runtime.lastError = null;
});

import {
  loadWhitelist,
  saveWhitelist,
  isWhitelisted,
  addToWhitelist,
  removeFromWhitelist,
  clearWhitelist,
  getWhitelistStats,
  exportWhitelist,
  importWhitelist,
  type WhitelistEntry,
} from "./whitelist";

describe("loadWhitelist", () => {
  it("returns empty array when storage is empty", async () => {
    mockChromeStorage.local.get.mockImplementation((keys, callback) => {
      callback({});
    });

    const result = await loadWhitelist();
    expect(result).toEqual([]);
  });

  it("returns whitelist from storage", async () => {
    const entries: WhitelistEntry[] = [
      { domain: "example.com", addedAt: 1234567890, reason: "Work site" },
    ];
    mockChromeStorage.local.get.mockImplementation((keys, callback) => {
      callback({ domainWhitelist: entries });
    });

    const result = await loadWhitelist();
    expect(result).toEqual(entries);
  });

  it("returns empty array on storage error", async () => {
    mockChromeStorage.local.get.mockImplementation((keys, callback) => {
      chrome.runtime.lastError = new Error("Storage error");
      callback({});
    });

    const result = await loadWhitelist();
    expect(result).toEqual([]);
    chrome.runtime.lastError = null;
  });
});

describe("saveWhitelist", () => {
  it("saves whitelist to storage", async () => {
    mockChromeStorage.local.set.mockImplementation((data, callback) => {
      callback();
    });

    const entries: WhitelistEntry[] = [
      { domain: "example.com", addedAt: 1234567890, reason: "Work site" },
    ];
    await saveWhitelist(entries);

    expect(mockChromeStorage.local.set).toHaveBeenCalled();
    const call = mockChromeStorage.local.set.mock.calls[0];
    expect(call[0].domainWhitelist).toEqual(entries);
  });

  it("rejects on storage error", async () => {
    mockChromeStorage.local.set.mockImplementation((data, callback) => {
      chrome.runtime.lastError = new Error("Storage error");
      callback();
    });

    await expect(saveWhitelist([])).rejects.toThrow();
    chrome.runtime.lastError = null;
  });
});

describe("isWhitelisted", () => {
  it("returns false for non-whitelisted domain", async () => {
    mockChromeStorage.local.get.mockImplementation((keys, callback) => {
      callback({});
    });

    const result = await isWhitelisted("https://example.com");
    expect(result).toBe(false);
  });

  it("returns true for whitelisted domain", async () => {
    mockChromeStorage.local.get.mockImplementation((keys, callback) => {
      callback({
        domainWhitelist: [{ domain: "example.com", addedAt: 123, reason: "Test" }],
      });
    });

    const result = await isWhitelisted("https://example.com");
    expect(result).toBe(true);
  });

  it("returns false for invalid URL", async () => {
    const result = await isWhitelisted("not-a-valid-url");
    expect(result).toBe(false);
  });
});

describe("addToWhitelist", () => {
  it("adds new domain to whitelist", async () => {
    mockChromeStorage.local.get.mockImplementation((keys, callback) => {
      callback({});
    });
    mockChromeStorage.local.set.mockImplementation((data, callback) => {
      callback();
    });

    await addToWhitelist("https://example.com", "Test reason");

    expect(mockChromeStorage.local.set).toHaveBeenCalled();
    const call = mockChromeStorage.local.set.mock.calls[0];
    expect(call[0].domainWhitelist[0].domain).toBe("example.com");
  });

  it("does not add duplicate domains", async () => {
    mockChromeStorage.local.get.mockImplementation((keys, callback) => {
      callback({
        domainWhitelist: [{ domain: "example.com", addedAt: 123, reason: "Existing" }],
      });
    });
    mockChromeStorage.local.set.mockImplementation((data, callback) => {
      callback();
    });

    await addToWhitelist("https://example.com", "New reason");

    // Should not call set since domain already exists
    expect(mockChromeStorage.local.set).not.toHaveBeenCalled();
  });
});

describe("removeFromWhitelist", () => {
  it("removes domain from whitelist", async () => {
    mockChromeStorage.local.get.mockImplementation((keys, callback) => {
      callback({
        domainWhitelist: [
          { domain: "example.com", addedAt: 123, reason: "Test" },
          { domain: "other.com", addedAt: 456, reason: "Other" },
        ],
      });
    });
    mockChromeStorage.local.set.mockImplementation((data, callback) => {
      callback();
    });

    await removeFromWhitelist("https://example.com");

    expect(mockChromeStorage.local.set).toHaveBeenCalled();
    const call = mockChromeStorage.local.set.mock.calls[0];
    expect(call[0].domainWhitelist.length).toBe(1);
    expect(call[0].domainWhitelist[0].domain).toBe("other.com");
  });
});

describe("clearWhitelist", () => {
  it("clears all entries", async () => {
    mockChromeStorage.local.set.mockImplementation((data, callback) => {
      callback();
    });

    await clearWhitelist();

    expect(mockChromeStorage.local.set).toHaveBeenCalled();
    const call = mockChromeStorage.local.set.mock.calls[0];
    expect(call[0].domainWhitelist).toEqual([]);
  });
});

describe("getWhitelistStats", () => {
  it("returns count and domains", async () => {
    mockChromeStorage.local.get.mockImplementation((keys, callback) => {
      callback({
        domainWhitelist: [
          { domain: "example.com", addedAt: 123, reason: "Test" },
          { domain: "other.com", addedAt: 456, reason: "Other" },
        ],
      });
    });

    const result = await getWhitelistStats();
    expect(result.count).toBe(2);
    expect(result.domains).toEqual(["example.com", "other.com"]);
  });
});

describe("exportWhitelist", () => {
  it("exports whitelist as JSON string", async () => {
    mockChromeStorage.local.get.mockImplementation((keys, callback) => {
      callback({
        domainWhitelist: [{ domain: "example.com", addedAt: 123, reason: "Test" }],
      });
    });

    const result = await exportWhitelist();
    expect(JSON.parse(result)).toEqual([
      { domain: "example.com", addedAt: 123, reason: "Test" },
    ]);
  });
});

describe("importWhitelist", () => {
  it("imports valid whitelist from JSON", async () => {
    mockChromeStorage.local.set.mockImplementation((data, callback) => {
      callback();
    });

    const json = JSON.stringify([
      { domain: "example.com", addedAt: 123, reason: "Test" },
    ]);
    await importWhitelist(json);

    expect(mockChromeStorage.local.set).toHaveBeenCalled();
  });

  it("rejects invalid JSON", async () => {
    await expect(importWhitelist("not-json")).rejects.toThrow("Invalid whitelist JSON");
  });

  it("filters invalid entries", async () => {
    mockChromeStorage.local.set.mockImplementation((data, callback) => {
      callback();
    });

    const json = JSON.stringify([
      { domain: "valid.com", addedAt: 123, reason: "Valid" },
      { domain: "invalid.com" }, // Missing required fields
    ]);
    await importWhitelist(json);

    const call = mockChromeStorage.local.set.mock.calls[0];
    expect(call[0].domainWhitelist.length).toBe(1);
    expect(call[0].domainWhitelist[0].domain).toBe("valid.com");
  });
});
