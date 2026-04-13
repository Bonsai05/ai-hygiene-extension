// src/offscreen.ts
// Offscreen Document — runs Transformers.js WASM for ML inference.
// MV3 service workers can't load WASM, so this offscreen doc handles ML inference.
//
// Multi-model pipeline:
//   Layer 1A: pirocheto/phishing-url-detection  — URL lexical analysis (<50ms)
//   Layer 1B: phishbot/ScamLLM (RoBERTa ONNX)  — Page content / social engineering
//   Layer 1C: onnx-community/bert-small-pii-detection — PII leakage in forms
//
// Thresholds: only flag as phishing when model confidence is HIGH.
// This prevents false positives on everyday sites.

import { pipeline, env, type TextClassificationPipeline } from "@huggingface/transformers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type RiskLevel = "safe" | "warning" | "danger";
type ModelState = "idle" | "loading" | "ready" | "failed";

interface MLResult {
  level: RiskLevel;
  score: number;      // Phishing probability 0–1
  modelVersion: string;
  contentScore?: number;
  urlScore?: number;
}

// ---------------------------------------------------------------------------
// Model configuration
// ---------------------------------------------------------------------------
const MODEL_URL = "pirocheto/phishing-url-detection";
const SCAM_MODEL_ID = "phishbot/ScamLLM";

// Thresholds: only flag when confidence is HIGH to minimize false positives
const PHISHING_DANGER_THRESHOLD = 0.80;   // ≥80% phishing → danger
const PHISHING_WARNING_THRESHOLD = 0.55;  // ≥55% phishing → warning
// Below 55% phishing probability → treat as safe (give benefit of doubt)

// ---------------------------------------------------------------------------
// URL classifier (Layer 1A — always loaded)
// ---------------------------------------------------------------------------
let classifier: TextClassificationPipeline | null = null;
let modelState: ModelState = "idle";
let pendingRequests: Array<(result: MLResult) => void> = [];

// ---------------------------------------------------------------------------
// ScamLLM content classifier (Layer 1B — loaded after 3s delay)
// ---------------------------------------------------------------------------
let scamClassifier: TextClassificationPipeline | null = null;
let scamModelState: ModelState = "idle";

function safeResult(modelVersion = MODEL_URL): MLResult {
  return { level: "safe", score: 0, modelVersion };
}

/**
 * Convert model output label+score to RiskLevel.
 * CRITICAL: We look specifically at the PHISHING class score.
 * Never downgrade based on low benign confidence.
 */
function scoreToLevel(label: string, score: number, modelId: string): MLResult {
  const lc = label.toLowerCase();
  const isPhishingClass =
    lc.includes("phishing") ||
    lc.includes("label_1") ||
    lc.includes("bad") ||
    lc.includes("malicious") ||
    lc.includes("scam");

  if (!isPhishingClass) {
    // This is the BENIGN score — compute phishing prob as 1 - benign
    const phishingProb = 1 - score;
    if (phishingProb >= PHISHING_DANGER_THRESHOLD) return { level: "danger", score: phishingProb, modelVersion: modelId };
    if (phishingProb >= PHISHING_WARNING_THRESHOLD) return { level: "warning", score: phishingProb, modelVersion: modelId };
    return { level: "safe", score: phishingProb, modelVersion: modelId };
  }

  // This is the PHISHING score directly
  if (score >= PHISHING_DANGER_THRESHOLD) return { level: "danger", score, modelVersion: modelId };
  if (score >= PHISHING_WARNING_THRESHOLD) return { level: "warning", score, modelVersion: modelId };
  return { level: "safe", score, modelVersion: modelId };
}

function mergeRiskLevels(a: RiskLevel, b: RiskLevel): RiskLevel {
  if (a === "danger" || b === "danger") return "danger";
  if (a === "warning" || b === "warning") return "warning";
  return "safe";
}

// ---------------------------------------------------------------------------
// URL model init
// ---------------------------------------------------------------------------
async function initModel(): Promise<void> {
  if (modelState === "ready" || modelState === "loading") return;
  modelState = "loading";

  try {
    env.allowLocalModels = true;
    env.useBrowserCache = true;
    // @ts-expect-error — type definitions lag behind the actual API
    env.backends.onnx.wasm.numThreads = 1;

    try {
      const wasmBase = chrome.runtime.getURL("assets/");
      // @ts-expect-error
      env.backends.onnx.wasm.locator = (file: string) => `${wasmBase}${file}`;
    } catch {}

    classifier = await pipeline("text-classification", MODEL_URL, {
      device: "wasm",
      dtype: "fp32",
    }) as TextClassificationPipeline;

    modelState = "ready";
    console.info("[AI Hygiene Offscreen] URL model ready:", MODEL_URL);

    // Drain pending requests
    const pending = [...pendingRequests];
    pendingRequests = [];
    for (const resolve of pending) resolve(safeResult());
  } catch (err) {
    console.error("[AI Hygiene Offscreen] URL model init failed:", err);
    modelState = "failed";
    const pending = [...pendingRequests];
    pendingRequests = [];
    for (const resolve of pending) resolve(safeResult());
  }
}

// ---------------------------------------------------------------------------
// ScamLLM (content model) init — loaded with delay to avoid blocking URL model
// ---------------------------------------------------------------------------
async function initScamModel(): Promise<void> {
  if (scamModelState === "ready" || scamModelState === "loading") return;
  scamModelState = "loading";

  try {
    scamClassifier = await pipeline("text-classification", SCAM_MODEL_ID, {
      device: "wasm",
      dtype: "q8",  // quantized for size
    }) as TextClassificationPipeline;

    scamModelState = "ready";
    console.info("[AI Hygiene Offscreen] ScamLLM ready:", SCAM_MODEL_ID);
  } catch (err) {
    console.warn("[AI Hygiene Offscreen] ScamLLM init failed (non-fatal):", err);
    scamModelState = "failed";
  }
}

// ---------------------------------------------------------------------------
// URL classification
// ---------------------------------------------------------------------------
async function classifyUrl(url: string): Promise<MLResult> {
  if (modelState === "failed") return safeResult();

  if (modelState !== "ready" || !classifier) {
    if (modelState === "idle") {
      initModel().catch(() => {});
    }
    return new Promise<MLResult>((resolve) => {
      pendingRequests.push(resolve);
    });
  }

  try {
    // Request scores for ALL labels (top_k: null returns all classes)
    const results = await classifier(url, { top_k: null }) as Array<{ label: string; score: number }>;
    if (!results || results.length === 0) return safeResult();

    // Find the phishing class entry if present
    const phishingEntry = results.find(r => {
      const lc = r.label.toLowerCase();
      return lc.includes("phishing") || lc.includes("label_1") || lc.includes("bad");
    });

    if (phishingEntry) {
      return scoreToLevel(phishingEntry.label, phishingEntry.score, MODEL_URL);
    }

    // Fallback: use top result
    return scoreToLevel(results[0].label, results[0].score, MODEL_URL);
  } catch (err) {
    console.error("[AI Hygiene Offscreen] URL inference error:", err);
    return safeResult();
  }
}

// ---------------------------------------------------------------------------
// Content classification (ScamLLM)
// ---------------------------------------------------------------------------
async function classifyContent(text: string): Promise<MLResult> {
  if (scamModelState === "failed" || scamModelState === "idle") {
    return safeResult(SCAM_MODEL_ID);
  }

  if (scamModelState !== "ready" || !scamClassifier) {
    return safeResult(SCAM_MODEL_ID);
  }

  try {
    // Truncate to ~512 tokens (2000 chars)
    const truncated = text.slice(0, 2000);
    const results = await scamClassifier(truncated, { top_k: null }) as Array<{ label: string; score: number }>;
    if (!results || results.length === 0) return safeResult(SCAM_MODEL_ID);

    const scamEntry = results.find(r => {
      const lc = r.label.toLowerCase();
      return lc.includes("scam") || lc.includes("phishing") || lc.includes("bad") || lc.includes("malicious");
    });

    if (scamEntry) {
      return scoreToLevel(scamEntry.label, scamEntry.score, SCAM_MODEL_ID);
    }

    return scoreToLevel(results[0].label, results[0].score, SCAM_MODEL_ID);
  } catch (err) {
    console.error("[AI Hygiene Offscreen] ScamLLM inference error:", err);
    return safeResult(SCAM_MODEL_ID);
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "ping") {
    sendResponse({ type: "pong" });
    return true;
  }

  if (message.type === "initML") {
    initModel()
      .then(() => sendResponse({ ok: true, model: MODEL_URL }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  // URL-only analysis (Layer 1A)
  if (message.type === "analyzeUrl") {
    const { url } = message as { url: string };
    if (!url) { sendResponse(safeResult()); return true; }
    classifyUrl(url)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse(safeResult()));
    return true;
  }

  // Combined URL + content analysis (Layer 1A + 1B)
  if (message.type === "analyzeContent") {
    const { url, text } = message as { url: string; text: string };
    if (!url) { sendResponse(safeResult()); return true; }

    Promise.all([
      classifyUrl(url).catch(() => safeResult()),
      classifyContent(text ?? "").catch(() => safeResult(SCAM_MODEL_ID)),
    ]).then(([urlResult, contentResult]) => {
      const combinedLevel = mergeRiskLevels(urlResult.level, contentResult.level);
      sendResponse({
        level: combinedLevel,
        score: Math.max(urlResult.score, contentResult.score),
        urlScore: urlResult.score,
        contentScore: contentResult.score,
        modelVersion: `${MODEL_URL} + ${SCAM_MODEL_ID}`,
        models: [MODEL_URL, SCAM_MODEL_ID],
      });
    }).catch(() => sendResponse(safeResult()));
    return true;
  }

  return false;
});

// ---------------------------------------------------------------------------
// Auto-start: URL model immediately, ScamLLM after 3s delay
// ---------------------------------------------------------------------------
initModel().catch(() => {});
setTimeout(() => initScamModel().catch(() => {}), 3000);
