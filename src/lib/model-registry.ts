// src/lib/model-registry.ts
// Single source of truth for all local ONNX model identifiers, metadata,
// and status types. Imported by offscreen.ts, background.ts, and Settings UI.

// ---------------------------------------------------------------------------
// Model definitions for standalone offscreen inference.
// ---------------------------------------------------------------------------
export const MODELS = {
  /** Layer 1A: URL classifier (lightweight) */
  URL_PHISHING: {
    id: "Xenova/distilbert-base-uncased-finetuned-sst-2-english",
    nickname: "URL Phishing Detector",
    description: "Fast local classifier used as one signal in URL risk scoring.",
    size: "~67 MB",
    dtype: "fp32" as const,
    priority: 1,
  },
  /** Layer 1B: Content phishing signal */
  BERT_PHISHING: {
    id: "Xenova/twitter-roberta-base-sentiment-latest",
    nickname: "BERT Phishing (DOM)",
    description: "Content sentiment/risk signal blended with phishing heuristics.",
    size: "~124 MB",
    dtype: "q8" as const,
    priority: 2,
  },
  /** Layer 1C: PII token detector */
  PII_DETECTION: {
    id: "Xenova/bert-base-NER",
    nickname: "PII Shield",
    description: "Detects personally identifiable information typed into form fields on risky pages.",
    size: "~108 MB",
    dtype: "q8" as const,
    priority: 3,
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
