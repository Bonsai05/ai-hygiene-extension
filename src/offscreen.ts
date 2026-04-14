import { pipeline, env, type TextClassificationPipeline, type TokenClassificationPipeline, type ProgressCallback } from "@huggingface/transformers";
import { MODELS, MODEL_STATUS_STORAGE_KEY, defaultModelStatusMap, type ModelKey, type ModelState, type ModelStatusMap } from "./lib/model-registry";

type RiskLevel = "safe" | "warning" | "danger";
interface MLResult { level: RiskLevel; score: number; modelVersion: string; contentScore?: number; urlScore?: number; }

const DANGER_THRESHOLD = 0.86;
const WARNING_THRESHOLD = 0.68;
const DOWNLOAD_PROMPT_KEY = "modelDownloadPromptDismissed";
const MODEL_LOAD_TIMEOUT_MS = 120000;

let urlClassifier: TextClassificationPipeline | null = null;
let contentClassifier: TextClassificationPipeline | null = null;
let piiClassifier: TokenClassificationPipeline | null = null;
let statusMap: ModelStatusMap = defaultModelStatusMap();
let downloadSequenceRunning = false;

function storageLocal(): chrome.storage.StorageArea | null {
  return globalThis.chrome?.storage?.local ?? null;
}

async function safeStorageGet<T = Record<string, unknown>>(keys: string[]): Promise<T> {
  const area = storageLocal();
  if (!area) return {} as T;
  try {
    return await area.get(keys) as T;
  } catch {
    return {} as T;
  }
}

async function safeStorageSet(payload: Record<string, unknown>): Promise<void> {
  const area = storageLocal();
  if (!area) return;
  try {
    await area.set(payload);
  } catch {}
}

function setModelState(key: ModelKey, state: ModelState, progress = 0, error?: string): void {
  statusMap = { ...statusMap, [key]: { key, state, progress, error, readyAt: state === "ready" ? Date.now() : statusMap[key].readyAt } };
  safeStorageSet({ [MODEL_STATUS_STORAGE_KEY]: statusMap });
  chrome.runtime.sendMessage({ type: "modelStatusUpdate", statusMap }).catch(() => {});
}

function normalizeModelError(key: ModelKey, err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.toLowerCase();
  if (msg.includes("failed to fetch")) {
    return `${MODELS[key].nickname}: network/CSP fetch failed. Reload extension and retry model download. Details: ${raw}`;
  }
  if (msg.includes("no available backend found") || msg.includes("wasm")) {
    return `${MODELS[key].nickname}: wasm backend init failed. Verify extension was reloaded after build and ORT assets are present. Details: ${raw}`;
  }
  if (msg.includes("unsupported model type")) {
    return `${MODELS[key].nickname}: unsupported model architecture for transformers.js runtime. Details: ${raw}`;
  }
  return `${MODELS[key].nickname}: ${raw}`;
}

function makeProgressCallback(key: ModelKey): ProgressCallback {
  return (progressEvent) => {
    if (progressEvent.status !== "progress" || typeof progressEvent.progress !== "number") return;
    const pct = Math.max(0, Math.min(100, Math.round(progressEvent.progress)));
    statusMap = { ...statusMap, [key]: { ...statusMap[key], state: "downloading", progress: pct } };
    chrome.runtime.sendMessage({ type: "modelProgress", key, progress: pct }).catch(() => {});
  };
}

function configureEnv(): void {
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;
  try {
    // @ts-expect-error runtime option
    env.backends.onnx.wasm.numThreads = 1;
    // @ts-expect-error runtime option
    env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("assets/");
    // @ts-expect-error runtime option
    env.backends.onnx.wasm.proxy = false;
  } catch {}
}

async function loadModel(key: ModelKey): Promise<void> {
  if (statusMap[key].state === "ready" || statusMap[key].state === "downloading") return;
  setModelState(key, "downloading", 1);
  try {
    const modelLoadPromise = (async () => {
      if (key === "URL_PHISHING") {
        urlClassifier = await pipeline("text-classification", MODELS[key].id, {
          device: "wasm",
          dtype: MODELS[key].dtype,
          progress_callback: makeProgressCallback(key),
        }) as TextClassificationPipeline;
      } else if (key === "BERT_PHISHING") {
        contentClassifier = await pipeline("text-classification", MODELS[key].id, {
          device: "wasm",
          dtype: MODELS[key].dtype,
          progress_callback: makeProgressCallback(key),
        }) as TextClassificationPipeline;
      } else if (key === "PII_DETECTION") {
        piiClassifier = await pipeline("token-classification", MODELS[key].id, {
          device: "wasm",
          dtype: MODELS[key].dtype,
          progress_callback: makeProgressCallback(key),
        }) as TokenClassificationPipeline;
      }
    })();
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Timed out after ${Math.round(MODEL_LOAD_TIMEOUT_MS / 1000)}s while downloading/loading model`)),
        MODEL_LOAD_TIMEOUT_MS
      );
    });
    await Promise.race([modelLoadPromise, timeoutPromise]);
    setModelState(key, "ready", 100);
  } catch (err) {
    const msg = normalizeModelError(key, err);
    setModelState(key, "failed", 0, msg);
  }
}

async function runDownloadSequence(force = false): Promise<void> {
  if (downloadSequenceRunning) return;
  downloadSequenceRunning = true;
  configureEnv();
  try {
    if (force) {
      urlClassifier = null;
      contentClassifier = null;
      piiClassifier = null;
      for (const key of Object.keys(statusMap) as ModelKey[]) {
        setModelState(key, "idle", 0);
      }
    }
    const keys = (Object.keys(MODELS) as ModelKey[]).sort((a, b) => MODELS[a].priority - MODELS[b].priority);
    for (const key of keys) {
      if (!force && statusMap[key].state === "ready") continue;
      await loadModel(key);
    }
  } finally {
    downloadSequenceRunning = false;
    await emitPromptIfNeeded();
  }
}

async function emitPromptIfNeeded(): Promise<void> {
  try {
    const dismissed = await safeStorageGet<Record<string, boolean>>([DOWNLOAD_PROMPT_KEY]);
    if (dismissed[DOWNLOAD_PROMPT_KEY]) return;
    const states = Object.values(statusMap).map((s) => s.state);
    const needsPrompt = states.some((s) => s === "idle" || s === "failed");
    if (needsPrompt) {
      chrome.runtime.sendMessage({ type: "modelDownloadRequired", statusMap }).catch(() => {});
    }
  } catch {}
}

function socialContextScore(url: string, text: string): { score: number; signals: string[] } {
  const lowerUrl = url.toLowerCase();
  const lowerText = text.toLowerCase();
  const signals: string[] = [];
  let score = 0;

  if (/\b(paypa1|amaz0n|micr0soft|g00gle)\b/.test(lowerUrl)) { score += 0.34; signals.push("typosquatting"); }
  if (/\.(tk|ml|xyz|top|gq)\b/.test(lowerUrl)) { score += 0.23; signals.push("suspicious_tld"); }
  if (/http:\/\//.test(lowerUrl)) { score += 0.12; signals.push("http_protocol"); }
  if (/@/.test(lowerUrl)) { score += 0.18; signals.push("url_with_at_symbol"); }
  if (/(verify|urgent|suspend|confirm|reset password)/.test(lowerText)) { score += 0.22; signals.push("urgency_language"); }
  if (/(gift|free money|crypto payout|bank alert)/.test(lowerText)) { score += 0.18; signals.push("social_scam_phrase"); }

  return { score: Math.min(1, score), signals };
}

function inferLevel(score: number): RiskLevel {
  if (score >= DANGER_THRESHOLD) return "danger";
  if (score >= WARNING_THRESHOLD) return "warning";
  return "safe";
}

async function classifyUrl(url: string): Promise<MLResult> {
  const social = socialContextScore(url, "");
  if (!urlClassifier || statusMap.URL_PHISHING.state !== "ready") {
    return { level: inferLevel(social.score), score: social.score, modelVersion: "heuristic_social_fallback" };
  }
  try {
    const outputs = await urlClassifier(url, { top_k: null }) as Array<{ label: string; score: number }>;
    const top = outputs?.[0];
    const modelRisk = top ? (top.label.toLowerCase().includes("negative") ? top.score : 1 - top.score) : 0;
    const fused = Math.max(social.score, modelRisk * 0.55);
    return { level: inferLevel(fused), score: fused, modelVersion: MODELS.URL_PHISHING.id };
  } catch {
    return { level: inferLevel(social.score), score: social.score, modelVersion: "heuristic_social_fallback" };
  }
}

async function classifyContent(url: string, text: string): Promise<MLResult> {
  const social = socialContextScore(url, text);
  if (!contentClassifier || statusMap.BERT_PHISHING.state !== "ready") {
    return { level: inferLevel(social.score), score: social.score, modelVersion: "heuristic_social_fallback" };
  }
  try {
    const outputs = await contentClassifier(text.slice(0, 1200), { top_k: null }) as Array<{ label: string; score: number }>;
    const top = outputs?.[0];
    const modelRisk = top ? (top.label.toLowerCase().includes("negative") ? top.score : 1 - top.score) : 0;
    const fused = Math.max(social.score, modelRisk * 0.5);
    return { level: inferLevel(fused), score: fused, modelVersion: MODELS.BERT_PHISHING.id };
  } catch {
    return { level: inferLevel(social.score), score: social.score, modelVersion: "heuristic_social_fallback" };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "downloadModels" || message.type === "offscreen.downloadModels") {
    runDownloadSequence(true).then(() => sendResponse({ ok: true })).catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (message.type === "getModelStatus" || message.type === "offscreen.getModelStatus") {
    sendResponse({ statusMap });
    return true;
  }

  if (message.type === "dismissModelPrompt" || message.type === "offscreen.dismissModelPrompt") {
    safeStorageSet({ [DOWNLOAD_PROMPT_KEY]: true }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "analyzeUrl" || message.type === "scanUrl") {
    const { url } = message as { url: string };
    classifyUrl(url ?? "").then((result) => sendResponse(result)).catch(() => sendResponse({ level: "safe", score: 0, modelVersion: "fallback" }));
    return true;
  }

  if (message.type === "analyzeContent" || message.type === "scanContent") {
    const { url, text } = message as { url: string; text: string };
    Promise.all([classifyUrl(url ?? ""), classifyContent(url ?? "", text ?? "")]).then(([urlRes, contentRes]) => {
      const combined = Math.max(urlRes.score, contentRes.score);
      sendResponse({
        level: inferLevel(combined),
        score: combined,
        urlScore: urlRes.score,
        contentScore: contentRes.score,
        modelVersion: `${urlRes.modelVersion} | ${contentRes.modelVersion}`,
      });
    }).catch(() => sendResponse({ level: "safe", score: 0, modelVersion: "fallback" }));
    return true;
  }

  if (message.type === "scanPii") {
    const { text } = message as { text: string };
    if (!piiClassifier || statusMap.PII_DETECTION.state !== "ready") {
      sendResponse({ hasPii: false, entities: [], confidence: 0 });
      return true;
    }
    piiClassifier(text?.slice(0, 600) ?? "")
      .then((results) => {
        const flagged = (results ?? []).filter((r: { label: string; score: number }) => r.label !== "O" && r.score > 0.8);
        sendResponse({
          hasPii: flagged.length > 0,
          entities: [...new Set(flagged.map((r: { label: string }) => r.label.replace(/^[BI]-/, "")))],
          confidence: flagged.length ? flagged.reduce((s: number, r: { score: number }) => s + r.score, 0) / flagged.length : 0,
        });
      })
      .catch(() => sendResponse({ hasPii: false, entities: [], confidence: 0 }));
    return true;
  }

  return false;
});

(async () => {
  try {
    const stored = await safeStorageGet<Record<string, ModelStatusMap>>([MODEL_STATUS_STORAGE_KEY]);
    if (stored[MODEL_STATUS_STORAGE_KEY]) {
      const saved = stored[MODEL_STATUS_STORAGE_KEY] as ModelStatusMap;
      statusMap = Object.fromEntries((Object.keys(saved) as ModelKey[]).map((key) => [
        key,
        { ...saved[key], state: saved[key].state === "downloading" ? "idle" : saved[key].state, progress: saved[key].state === "downloading" ? 0 : saved[key].progress },
      ])) as ModelStatusMap;
    }
  } catch {}
  chrome.runtime.sendMessage({ type: "modelStatusUpdate", statusMap }).catch(() => {});
  runDownloadSequence(false).catch(() => {});
})();
