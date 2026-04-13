// src/offscreen.ts
// Offscreen Document — runs Transformers.js WASM for ML inference.
// MV3 service workers cannot load WASM, so this offscreen doc handles all ML.
//
// Model pipeline (3 models, no TinyBERT):
//   Layer 1A: pirocheto/phishing-url-detection        — URL lexical analysis (<50ms)
//   Layer 1B: phishbot/ScamLLM (RoBERTa ONNX q8)     — social engineering / scam content
//   Layer 1C: onnx-community/bert-finetuned-phishing-ONNX — DOM text / credential harvesting
//   Layer 1D: gravitee-io/bert-small-pii-detection    — PII leakage in form fields
//
// Download order: 1A → 1B → 1C → 1D (priority-ordered, sequential to avoid OOM).
// Progress is broadcast back to background via chrome.runtime.sendMessage.

import {
  pipeline,
  env,
  type TextClassificationPipeline,
  type ProgressCallback,
} from "@huggingface/transformers";

import {
  MODELS,
  defaultModelStatusMap,
  MODEL_STATUS_STORAGE_KEY,
  type ModelKey,
  type ModelState,
  type ModelStatusMap,
} from "./lib/model-registry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type RiskLevel = "safe" | "warning" | "danger";

interface MLResult {
  level: RiskLevel;
  score: number;
  modelVersion: string;
  contentScore?: number;
  urlScore?: number;
}

interface PiiResult {
  hasPii: boolean;
  entities: string[];
  confidence: number;
}

// ---------------------------------------------------------------------------
// Classification thresholds
// Only flag when confidence is HIGH — minimises false positives.
// ---------------------------------------------------------------------------
const DANGER_THRESHOLD = 0.80;   // ≥80% phishing → danger
const WARNING_THRESHOLD = 0.55;  // ≥55% phishing → warning

// ---------------------------------------------------------------------------
// Pipeline references
// ---------------------------------------------------------------------------
let urlClassifier: TextClassificationPipeline | null = null;
let scamClassifier: TextClassificationPipeline | null = null;
let bertPhishingClassifier: TextClassificationPipeline | null = null;
let piiClassifier: TextClassificationPipeline | null = null;

// ---------------------------------------------------------------------------
// Model status (in-memory mirror — persisted to chrome.storage.local)
// ---------------------------------------------------------------------------
let statusMap: ModelStatusMap = defaultModelStatusMap();

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------
function setModelState(key: ModelKey, state: ModelState, progress = 0, error?: string): void {
  statusMap = {
    ...statusMap,
    [key]: { key, state, progress, error, readyAt: state === "ready" ? Date.now() : statusMap[key].readyAt },
  };
  // Persist to storage so background/popup can read on demand
  try {
    chrome.storage.local.set({ [MODEL_STATUS_STORAGE_KEY]: statusMap });
  } catch {}
  // Broadcast to background (which relays to popup)
  try {
    chrome.runtime.sendMessage({ type: "modelStatusUpdate", statusMap });
  } catch {}
}

function makeProgressCallback(key: ModelKey): ProgressCallback {
  return (progressEvent) => {
    if (
      progressEvent.status === "progress" &&
      typeof progressEvent.progress === "number"
    ) {
      const pct = Math.round(progressEvent.progress);
      statusMap = {
        ...statusMap,
        [key]: { ...statusMap[key], state: "downloading", progress: pct },
      };
      // Broadcast progress (lightweight — just the key + number)
      try {
        chrome.runtime.sendMessage({ type: "modelProgress", key, progress: pct });
      } catch {}
    }
  };
}

// ---------------------------------------------------------------------------
// WASM environment setup (called once)
// ---------------------------------------------------------------------------
function configureEnv(): void {
  env.allowLocalModels = true;
  env.useBrowserCache = true;
  // Single-threaded WASM for browser extension context
  try {
    // @ts-expect-error — type definitions lag API
    env.backends.onnx.wasm.numThreads = 1;
  } catch {}
  // Point WASM loader at extension assets if available
  try {
    const wasmBase = chrome.runtime.getURL("assets/");
    // @ts-expect-error
    env.backends.onnx.wasm.locator = (file: string) => `${wasmBase}${file}`;
  } catch {}
}

// ---------------------------------------------------------------------------
// Individual model loaders
// ---------------------------------------------------------------------------
async function loadUrlModel(): Promise<void> {
  const key: ModelKey = "URL_PHISHING";
  if (statusMap[key].state === "ready" || statusMap[key].state === "downloading") return;
  setModelState(key, "downloading", 0);
  try {
    urlClassifier = await pipeline(
      "text-classification",
      MODELS.URL_PHISHING.id,
      {
        device: "wasm",
        dtype: MODELS.URL_PHISHING.dtype,
        progress_callback: makeProgressCallback(key),
      }
    ) as TextClassificationPipeline;
    setModelState(key, "ready", 100);
    console.info("[AI Hygiene] URL model ready:", MODELS.URL_PHISHING.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[AI Hygiene] URL model failed:", msg);
    setModelState(key, "failed", 0, msg);
  }
}

async function loadScamModel(): Promise<void> {
  const key: ModelKey = "CONTENT_SCAM";
  if (statusMap[key].state === "ready" || statusMap[key].state === "downloading") return;
  setModelState(key, "downloading", 0);
  try {
    scamClassifier = await pipeline(
      "text-classification",
      MODELS.CONTENT_SCAM.id,
      {
        device: "wasm",
        dtype: MODELS.CONTENT_SCAM.dtype,
        progress_callback: makeProgressCallback(key),
      }
    ) as TextClassificationPipeline;
    setModelState(key, "ready", 100);
    console.info("[AI Hygiene] ScamLLM ready:", MODELS.CONTENT_SCAM.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[AI Hygiene] ScamLLM failed (non-fatal):", msg);
    setModelState(key, "failed", 0, msg);
  }
}

async function loadBertPhishingModel(): Promise<void> {
  const key: ModelKey = "BERT_PHISHING";
  if (statusMap[key].state === "ready" || statusMap[key].state === "downloading") return;
  setModelState(key, "downloading", 0);
  try {
    bertPhishingClassifier = await pipeline(
      "text-classification",
      MODELS.BERT_PHISHING.id,
      {
        device: "wasm",
        dtype: MODELS.BERT_PHISHING.dtype,
        progress_callback: makeProgressCallback(key),
      }
    ) as TextClassificationPipeline;
    setModelState(key, "ready", 100);
    console.info("[AI Hygiene] BERT phishing model ready:", MODELS.BERT_PHISHING.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[AI Hygiene] BERT phishing model failed (non-fatal):", msg);
    setModelState(key, "failed", 0, msg);
  }
}

async function loadPiiModel(): Promise<void> {
  const key: ModelKey = "PII_DETECTION";
  if (statusMap[key].state === "ready" || statusMap[key].state === "downloading") return;
  setModelState(key, "downloading", 0);
  try {
    piiClassifier = await pipeline(
      "token-classification",
      MODELS.PII_DETECTION.id,
      {
        device: "wasm",
        dtype: MODELS.PII_DETECTION.dtype,
        progress_callback: makeProgressCallback(key),
      }
    ) as TextClassificationPipeline;
    setModelState(key, "ready", 100);
    console.info("[AI Hygiene] PII model ready:", MODELS.PII_DETECTION.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[AI Hygiene] PII model failed (non-fatal):", msg);
    setModelState(key, "failed", 0, msg);
  }
}

// ---------------------------------------------------------------------------
// Priority-ordered sequential download sequence
// Sequential (not parallel) to avoid memory pressure in WASM context.
// ---------------------------------------------------------------------------
let downloadSequenceRunning = false;

async function runDownloadSequence(): Promise<void> {
  if (downloadSequenceRunning) return;
  downloadSequenceRunning = true;
  configureEnv();
  try {
    await loadUrlModel();
    await loadScamModel();
    await loadBertPhishingModel();
    await loadPiiModel();
  } finally {
    downloadSequenceRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Inference helpers
// ---------------------------------------------------------------------------
function safeResult(modelId = MODELS.URL_PHISHING.id): MLResult {
  return { level: "safe", score: 0, modelVersion: modelId };
}

/**
 * Map a model output label+score to a RiskLevel.
 * We always look at the PHISHING class score specifically.
 */
function scoreToLevel(label: string, score: number, modelId: string): MLResult {
  const lc = label.toLowerCase();
  const isPhishingClass =
    lc.includes("phishing") ||
    lc.includes("label_1") ||
    lc.includes("bad") ||
    lc.includes("malicious") ||
    lc.includes("scam");

  const phishingProb = isPhishingClass ? score : 1 - score;
  if (phishingProb >= DANGER_THRESHOLD) return { level: "danger",  score: phishingProb, modelVersion: modelId };
  if (phishingProb >= WARNING_THRESHOLD) return { level: "warning", score: phishingProb, modelVersion: modelId };
  return { level: "safe", score: phishingProb, modelVersion: modelId };
}

function pickPhishingEntry(results: Array<{ label: string; score: number }>): { label: string; score: number } | null {
  return (
    results.find((r) => {
      const lc = r.label.toLowerCase();
      return lc.includes("phishing") || lc.includes("label_1") || lc.includes("bad") || lc.includes("scam") || lc.includes("malicious");
    }) ?? null
  );
}

function mergeRiskLevels(levels: RiskLevel[]): RiskLevel {
  if (levels.includes("danger")) return "danger";
  if (levels.includes("warning")) return "warning";
  return "safe";
}

// ---------------------------------------------------------------------------
// URL classification (Layer 1A)
// ---------------------------------------------------------------------------
async function classifyUrl(url: string): Promise<MLResult> {
  if (!urlClassifier || statusMap.URL_PHISHING.state !== "ready") return safeResult();
  try {
    const results = await urlClassifier(url, { top_k: null }) as Array<{ label: string; score: number }>;
    if (!results?.length) return safeResult();
    const entry = pickPhishingEntry(results) ?? results[0];
    return scoreToLevel(entry.label, entry.score, MODELS.URL_PHISHING.id);
  } catch (err) {
    console.error("[AI Hygiene] URL inference error:", err);
    return safeResult();
  }
}

// ---------------------------------------------------------------------------
// ScamLLM content classification (Layer 1B)
// ---------------------------------------------------------------------------
async function classifyScam(text: string): Promise<MLResult> {
  if (!scamClassifier || statusMap.CONTENT_SCAM.state !== "ready") return safeResult(MODELS.CONTENT_SCAM.id);
  try {
    const truncated = text.slice(0, 2000);
    const results = await scamClassifier(truncated, { top_k: null }) as Array<{ label: string; score: number }>;
    if (!results?.length) return safeResult(MODELS.CONTENT_SCAM.id);
    const entry = pickPhishingEntry(results) ?? results[0];
    return scoreToLevel(entry.label, entry.score, MODELS.CONTENT_SCAM.id);
  } catch (err) {
    console.error("[AI Hygiene] ScamLLM inference error:", err);
    return safeResult(MODELS.CONTENT_SCAM.id);
  }
}

// ---------------------------------------------------------------------------
// BERT phishing classification (Layer 1C)
// ---------------------------------------------------------------------------
async function classifyBertPhishing(text: string): Promise<MLResult> {
  if (!bertPhishingClassifier || statusMap.BERT_PHISHING.state !== "ready") return safeResult(MODELS.BERT_PHISHING.id);
  try {
    const truncated = text.slice(0, 512);
    const results = await bertPhishingClassifier(truncated, { top_k: null }) as Array<{ label: string; score: number }>;
    if (!results?.length) return safeResult(MODELS.BERT_PHISHING.id);
    const entry = pickPhishingEntry(results) ?? results[0];
    return scoreToLevel(entry.label, entry.score, MODELS.BERT_PHISHING.id);
  } catch (err) {
    console.error("[AI Hygiene] BERT phishing inference error:", err);
    return safeResult(MODELS.BERT_PHISHING.id);
  }
}

// ---------------------------------------------------------------------------
// PII detection (Layer 1D)
// ---------------------------------------------------------------------------
async function classifyPii(text: string): Promise<PiiResult> {
  const empty: PiiResult = { hasPii: false, entities: [], confidence: 0 };
  if (!piiClassifier || statusMap.PII_DETECTION.state !== "ready") return empty;
  try {
    const truncated = text.slice(0, 512);
    // token-classification returns per-token labels
    const results = await (piiClassifier as unknown as (text: string) => Promise<Array<{ label: string; score: number; word: string }>>)(truncated);
    if (!results?.length) return empty;
    const piiEntities = results.filter((r) => r.label !== "O" && r.score > 0.85);
    if (!piiEntities.length) return empty;
    const entityTypes = [...new Set(piiEntities.map((e) => e.label.replace(/^[BI]-/, "")))];
    const avgScore = piiEntities.reduce((s, e) => s + e.score, 0) / piiEntities.length;
    return { hasPii: true, entities: entityTypes, confidence: avgScore };
  } catch (err) {
    console.error("[AI Hygiene] PII inference error:", err);
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // ── Health check ──────────────────────────────────────────────────────────
  if (message.type === "ping") {
    sendResponse({ type: "pong" });
    return true;
  }

  // ── Trigger full model download sequence ──────────────────────────────────
  if (message.type === "downloadModels") {
    runDownloadSequence()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  // ── Return current model status map ───────────────────────────────────────
  if (message.type === "getModelStatus") {
    sendResponse({ statusMap });
    return true;
  }

  // ── Backward-compat: initML (starts URL model only) ───────────────────────
  if (message.type === "initML") {
    configureEnv();
    loadUrlModel()
      .then(() => sendResponse({ ok: true, model: MODELS.URL_PHISHING.id }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  // ── URL-only analysis (Layer 1A) — was "analyzeUrl" ──────────────────────
  if (message.type === "analyzeUrl" || message.type === "scanUrl") {
    const { url } = message as { url: string };
    if (!url) { sendResponse(safeResult()); return true; }
    classifyUrl(url)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse(safeResult()));
    return true;
  }

  // ── Combined URL + content analysis (Layers 1A + 1B + 1C) ────────────────
  if (message.type === "analyzeContent" || message.type === "scanContent") {
    const { url, text } = message as { url: string; text: string };
    if (!url) { sendResponse(safeResult()); return true; }
    const safeText = text ?? "";

    Promise.all([
      classifyUrl(url).catch(() => safeResult()),
      classifyScam(safeText).catch(() => safeResult(MODELS.CONTENT_SCAM.id)),
      classifyBertPhishing(safeText).catch(() => safeResult(MODELS.BERT_PHISHING.id)),
    ]).then(([urlResult, scamResult, bertResult]) => {
      const combinedLevel = mergeRiskLevels([urlResult.level, scamResult.level, bertResult.level]);
      const combinedScore = Math.max(urlResult.score, scamResult.score, bertResult.score);
      sendResponse({
        level: combinedLevel,
        score: combinedScore,
        urlScore: urlResult.score,
        contentScore: Math.max(scamResult.score, bertResult.score),
        modelVersion: `${MODELS.URL_PHISHING.id} | ${MODELS.CONTENT_SCAM.id} | ${MODELS.BERT_PHISHING.id}`,
        models: [MODELS.URL_PHISHING.id, MODELS.CONTENT_SCAM.id, MODELS.BERT_PHISHING.id],
      });
    }).catch(() => sendResponse(safeResult()));
    return true;
  }

  // ── PII scan (Layer 1D) ───────────────────────────────────────────────────
  if (message.type === "scanPii") {
    const { text } = message as { text: string };
    if (!text) { sendResponse({ hasPii: false, entities: [], confidence: 0 }); return true; }
    classifyPii(text)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ hasPii: false, entities: [], confidence: 0 }));
    return true;
  }

  return false;
});

// ---------------------------------------------------------------------------
// Bootstrap: restore persisted status, then start download sequence
// ---------------------------------------------------------------------------
(async () => {
  try {
    const stored = await chrome.storage.local.get([MODEL_STATUS_STORAGE_KEY]);
    if (stored[MODEL_STATUS_STORAGE_KEY]) {
      // Restore persisted status — but reset "downloading" states (incomplete downloads)
      const saved = stored[MODEL_STATUS_STORAGE_KEY] as typeof statusMap;
      statusMap = Object.fromEntries(
        (Object.keys(saved) as Array<keyof typeof saved>).map((key) => [
          key,
          {
            ...saved[key],
            // A model can't be mid-download across a service worker restart
            state: saved[key].state === "downloading" ? "idle" : saved[key].state,
            progress: saved[key].state === "downloading" ? 0 : saved[key].progress,
          },
        ])
      ) as typeof statusMap;
    }
  } catch {}

  // Broadcast current status so the popup sees correct states immediately
  try {
    chrome.runtime.sendMessage({ type: "modelStatusUpdate", statusMap });
  } catch {}

  // Begin sequential download of any models not yet ready
  runDownloadSequence().catch(() => {});
})();
