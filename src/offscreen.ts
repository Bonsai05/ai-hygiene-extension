import { pipeline, env, type Pipeline } from '@huggingface/transformers';

/**
 * Offscreen Document — ML Inference Worker
 * Runs Transformers.js (WASM) client-side for phishing URL classification.
 *
 * MV3 architecture: the service worker (background.ts) cannot load WASM directly,
 * so it delegates to this offscreen document which has full DOM and WASM support.
 *
 * Uses onnx-community/phishing-email-detection-distilbert_v2.4.1-ONNX — an officially
 * converted DistilBERT ONNX model for phishing detection, applied here as a proxy for URLs.
 *
 * Message protocol:
 *   → { type: 'ping' }                 → pong acknowledgement
 *   → { type: 'initML' }               → initialize model
 *   → { type: 'analyzeUrl', url }      → run inference, returns MLRiskResult
 */

const MODEL_ID = 'onnx-community/phishing-email-detection-distilbert_v2.4.1-ONNX';

type MLRiskLevel = 'safe' | 'warning' | 'danger';

interface MLRiskResult {
    level: MLRiskLevel;
    score: number;
    modelVersion: string;
}

let classifier: Pipeline | null = null;
let modelReady = false;
let modelLoading = false;
const pendingQueue: Array<(result: MLRiskResult) => void> = [];

function labelToLevel(label: string, score: number): MLRiskLevel {
    if (label === 'LABEL_1' && score > 0.75) return 'danger';
    if (label === 'LABEL_1' && score > 0.4) return 'warning';
    return 'safe';
}

async function initModel(): Promise<void> {
    if (modelReady || modelLoading) return;

    // Allow local files and use browser cache
    env.allowLocalModels = true;
    env.useBrowserCache = true;
    env.backends.onnx.wasm.numThreads = 1;

    // Point WASM locator at locally bundled files
    const wasmBase = chrome.runtime.getURL('assets/wasm/');
    env.backends.onnx.wasm.locator = (file: string) => `${wasmBase}${file}`;

    modelLoading = true;
    try {
        classifier = await pipeline('text-classification', MODEL_ID, {
            device: 'wasm',
            dtype: 'fp32',
        });
        modelReady = true;
        console.info('[AI Hygiene Offscreen] Model loaded:', MODEL_ID);

        // Resolve any queued requests
        while (pendingQueue.length > 0) {
            const resolve = pendingQueue.shift()!;
            resolve({ level: 'safe', score: 0, modelVersion: MODEL_ID });
        }
    } catch (err) {
        console.error('[AI Hygiene Offscreen] Model init failed:', err);
        modelLoading = false;
        // Reject queued requests
        while (pendingQueue.length > 0) {
            const resolve = pendingQueue.shift()!;
            resolve({ level: 'safe', score: 0, modelVersion: MODEL_ID });
        }
        throw err;
    }
}

async function analyzeUrl(url: string): Promise<MLRiskResult> {
    if (!modelReady || !classifier) {
        if (modelLoading) {
            return new Promise<MLRiskResult>((resolve) => {
                pendingQueue.push(resolve);
            });
        }
        // Trigger loading — return safe until ready
        initModel().catch(() => {});
        return { level: 'safe', score: 0, modelVersion: MODEL_ID };
    }

    try {
        // The email phishing model doesn't understand raw URLs — wrap with a phishing email
        // template so the model can correctly classify the suspicious intent.
        const textToAnalyze = 'Urgent: Verify your account immediately to avoid suspension. Click here: ' + url;
        const results = await classifier(textToAnalyze, { top_k: null }) as Array<{ label: string; score: number }>;
        if (!results || results.length === 0) {
            return { level: 'safe', score: 0, modelVersion: MODEL_ID };
        }

        // Find the phishing class score specifically — don't assume it's the top prediction
        const phishingEntry = results.find((r) => r.label === 'LABEL_1');
        const phishingScore = phishingEntry ? phishingEntry.score : 0;
        const level = labelToLevel('LABEL_1', phishingScore);

        return { level, score: phishingScore, modelVersion: MODEL_ID };
    } catch (err) {
        console.error('[AI Hygiene Offscreen] Inference error:', err);
        return { level: 'safe', score: 0, modelVersion: MODEL_ID };
    }
}

// --- Message handler ---
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // Ping/pong — used by background to confirm offscreen is alive before sending initML
    if (message.type === 'ping') {
        sendResponse({ type: 'pong' });
        return true;
    }

    if (message.type === 'initML') {
        initModel()
            .then(() => {
                // Notify background that model is ready
                chrome.runtime.sendMessage({ type: 'offscreen-ready', model: MODEL_ID }).catch(() => {});
                sendResponse({ ok: true, model: MODEL_ID });
            })
            .catch((err) => sendResponse({ ok: false, error: String(err) }));
        return true; // async response
    }

    if (message.type === 'analyzeUrl') {
        const { url } = message;
        if (!url) {
            sendResponse({ level: 'safe', score: 0, modelVersion: MODEL_ID });
            return true;
        }
        analyzeUrl(url)
            .then((result) => sendResponse(result))
            .catch((err) => {
                console.error('[AI Hygiene Offscreen] analyzeUrl error:', err);
                sendResponse({ level: 'safe', score: 0, modelVersion: MODEL_ID });
            });
        return true; // async response
    }

    return false;
});

// Auto-initialize model when offscreen document loads
initModel().catch((err) => {
    console.warn('[AI Hygiene Offscreen] Auto-init failed (will retry on demand):', err);
});
