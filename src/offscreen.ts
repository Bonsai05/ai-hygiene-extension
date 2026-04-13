// src/offscreen.ts
// Offscreen Document — runs Transformers.js WASM for phishing URL classification.
// MV3 service workers can't load WASM, so this offscreen doc handles ML inference.
//
// Model: pirocheto/phishing-url-detection
// Labels: LABEL_0 = legitimate, LABEL_1 = phishing
//
// FIX: Previous version was randomly flagging sites because it treated any
// low-confidence benign score as "warning". Now we ONLY flag as risky when
// the PHISHING class score is HIGH. Benign = benign, regardless of confidence.

import { pipeline, env, type TextClassificationPipeline } from "@huggingface/transformers";

const MODEL_ID = "pirocheto/phishing-url-detection";
type RiskLevel = "safe" | "warning" | "danger";

interface MLResult {
  level: RiskLevel;
  score: number;      // Phishing probability 0–1
  modelVersion: string;
}

// Thresholds: only flag as phishing when confidence is HIGH
// This prevents false positives on everyday sites.
const PHISHING_DANGER_THRESHOLD = 0.80;   // ≥80% phishing → danger
const PHISHING_WARNING_THRESHOLD = 0.55;  // ≥55% phishing → warning
// Below 55% phishing probability → treat as safe (model is uncertain → give benefit of doubt)

let classifier: TextClassificationPipeline | null = null;
let modelState: "idle" | "loading" | "ready" | "failed" = "idle";
let pendingRequests: Array<(result: MLResult) => void> = [];

function safeResult(): MLResult {
  return { level: "safe", score: 0, modelVersion: MODEL_ID };
}

/**
 * Convert model output to risk level.
 * IMPORTANT: We look specifically at the PHISHING class score.
 * Never downgrade based on low benign confidence.
 */
function scoreToLevel(label: string, score: number): MLResult {
  const lc = label.toLowerCase();
  const isPhishingClass =
    lc.includes("phishing") ||
    lc.includes("label_1") ||
    lc.includes("bad") ||
    lc.includes("malicious");

  if (!isPhishingClass) {
    // This is the BENIGN score — ignore for risk purposes
    // Compute phishing prob as 1 - benign prob for completeness
    const phishingProb = 1 - score;
    if (phishingProb >= PHISHING_DANGER_THRESHOLD) return { level: "danger", score: phishingProb, modelVersion: MODEL_ID };
    if (phishingProb >= PHISHING_WARNING_THRESHOLD) return { level: "warning", score: phishingProb, modelVersion: MODEL_ID };
    return { level: "safe", score: phishingProb, modelVersion: MODEL_ID };
  }

  // This is the PHISHING score directly
  if (score >= PHISHING_DANGER_THRESHOLD) return { level: "danger", score, modelVersion: MODEL_ID };
  if (score >= PHISHING_WARNING_THRESHOLD) return { level: "warning", score, modelVersion: MODEL_ID };
  return { level: "safe", score, modelVersion: MODEL_ID };
}

async function initModel(): Promise<void> {
  if (modelState === "ready" || modelState === "loading") return;
  modelState = "loading";

  try {
    // Configure WASM backend
    env.allowLocalModels = true;
    env.useBrowserCache = true;
    // @ts-expect-error — type definitions lag behind the actual API
    env.backends.onnx.wasm.numThreads = 1;

    try {
      const wasmBase = chrome.runtime.getURL("assets/");
      // @ts-expect-error
      env.backends.onnx.wasm.locator = (file: string) => `${wasmBase}${file}`;
    } catch {}

    classifier = await pipeline("text-classification", MODEL_ID, {
      device: "wasm",
      dtype: "fp32",
    }) as TextClassificationPipeline;

    modelState = "ready";
    console.info("[AI Hygiene Offscreen] Model ready:", MODEL_ID);

    // Drain pending requests
    const pending = [...pendingRequests];
    pendingRequests = [];
    for (const resolve of pending) resolve(safeResult());
  } catch (err) {
    console.error("[AI Hygiene Offscreen] Model init failed:", err);
    modelState = "failed";
    // Drain pending with safe result
    const pending = [...pendingRequests];
    pendingRequests = [];
    for (const resolve of pending) resolve(safeResult());
  }
}

async function classifyUrl(url: string): Promise<MLResult> {
  if (modelState === "failed") return safeResult();

  if (modelState !== "ready" || !classifier) {
    if (modelState === "idle") {
      // Kick off loading
      initModel().catch(() => {});
    }
    // Queue this request until model is ready
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
      // Use the phishing class probability directly
      return scoreToLevel(phishingEntry.label, phishingEntry.score);
    }

    // Fallback: use top result
    return scoreToLevel(results[0].label, results[0].score);
  } catch (err) {
    console.error("[AI Hygiene Offscreen] Inference error:", err);
    return safeResult();
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
      .then(() => sendResponse({ ok: true, model: MODEL_ID }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (message.type === "analyzeUrl") {
    const { url } = message as { url: string };
    if (!url) { sendResponse(safeResult()); return true; }
    classifyUrl(url)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse(safeResult()));
    return true;
  }

  return false;
});

// Auto-start model loading when offscreen document is created
initModel().catch(() => {});
