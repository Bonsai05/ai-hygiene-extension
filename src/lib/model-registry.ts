// src/lib/model-registry.ts
// Single source of truth for model status types and storage key.
// Used by background.ts (model status tracking) and Settings UI.
// NOTE: v2 backend-first — offscreen Transformers.js is a dead fallback only.

// ---------------------------------------------------------------------------
// Model definitions (3 models; no TinyBERT per spec)
// ---------------------------------------------------------------------------
export const MODELS = {
  /** Layer 1A: Lexical URL phishing detection — smallest, loads first */
  URL_PHISHING: {
    id: "pirocheto/phishing-url-detection",
    nickname: "URL Phishing Detector",
    description: "Lexical analysis of URLs to detect phishing domains. Runs on every page visit.",
    size: "~12 MB",
    dtype: "fp32" as const,
    priority: 1,
  },
  /** Layer 1B: RoBERTa-based social engineering / scam content detection */
  CONTENT_SCAM: {
    id: "phishbot/ScamLLM",
    nickname: "ScamLLM",
    description: "Identifies deceptive social engineering and AI-generated phishing in page text.",
    size: "~125 MB",
    dtype: "q8" as const,
    priority: 2,
  },
  /** Layer 1C: DistilBERT fine-tuned for phishing DOM text & credential harvesting */
  BERT_PHISHING: {
    id: "onnx-community/bert-finetuned-phishing-ONNX",
    nickname: "BERT Phishing (DOM)",
    description: "Detects credential harvesting and phishing patterns in page content.",
    size: "~67 MB",
    dtype: "q8" as const,
    priority: 3,
  },
  /** Layer 1D: BERT-small PII detection — scans form input for sensitive data leakage */
  PII_DETECTION: {
    id: "gravitee-io/bert-small-pii-detection",
    nickname: "PII Shield",
    description: "Detects personally identifiable information typed into form fields on risky pages.",
    size: "~25 MB",
    dtype: "q8" as const,
    priority: 4,
  },
} as const;

export type ModelKey = keyof typeof MODELS;

// ---------------------------------------------------------------------------
// Per-model runtime status (persisted to chrome.storage.local)
// ---------------------------------------------------------------------------
export type ModelState = "idle" | "downloading" | "ready" | "failed";

export interface ModelStatus {
  key: ModelKey;
  state: ModelState;
  /** Download progress 0–100 (only relevant during "downloading" state) */
  progress: number;
  /** Human-readable error message when state === "failed" */
  error?: string;
  /** Timestamp when model reached "ready" state */
  readyAt?: number;
}

export type ModelStatusMap = Record<ModelKey, ModelStatus>;

// ---------------------------------------------------------------------------
// Default status (all idle)
// ---------------------------------------------------------------------------
export function defaultModelStatusMap(): ModelStatusMap {
  return Object.fromEntries(
    (Object.keys(MODELS) as ModelKey[]).map((key) => [
      key,
      { key, state: "idle" as ModelState, progress: 0 },
    ])
  ) as ModelStatusMap;
}

// ---------------------------------------------------------------------------
// Storage key for persisted model status
// ---------------------------------------------------------------------------
export const MODEL_STATUS_STORAGE_KEY = "modelStatusMap_v1";

// ---------------------------------------------------------------------------
// Message types used for offscreen ↔ background ↔ popup communication
// ---------------------------------------------------------------------------
export type ModelProgressMessage = {
  type: "modelProgress";
  key: ModelKey;
  progress: number; // 0–100
};

export type ModelStatusUpdateMessage = {
  type: "modelStatusUpdate";
  statusMap: ModelStatusMap;
};
