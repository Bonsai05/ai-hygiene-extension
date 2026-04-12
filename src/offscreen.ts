import { pipeline, env, type Pipeline } from '@huggingface/transformers';

/**
 * Offscreen Document — ML Inference Worker
 * Runs Transformers.js (WASM) client-side for phishing URL classification.
 *
 * MV3 architecture: the service worker (background.ts) cannot load WASM directly,
 * so it delegates to this offscreen document which has full DOM and WASM support.
 *
 * Uses Xenova/phishing-url-detection — a lightweight DistilRoBERTa model specific for URLs.
 */

const MODEL_ID = 'Xenova/phishing-url-detection';

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
    label = label.toLowerCase();
    const isPhishing = label.includes('phishing') || label.includes('bad') || label.includes('malware') || label.includes('label_1');
    if (isPhishing) {
        if (score >= 0.70) return 'danger';
        return 'warning';
    }
    // Benign
    if (score < 0.60) return 'warning'; // Low confidence in safe = warning
    return 'safe';
}

async function initModel(): Promise<void> {
    if (modelReady || modelLoading) return;

    // Allow remote loading since we're fetching from HF Hub for the URL model by default
    // Or if local models are present, use them.
    env.allowLocalModels = true;
    env.useBrowserCache = true;
    env.backends.onnx.wasm.numThreads = 1;

    try {
        const wasmBase = chrome.runtime.getURL('assets/wasm/');
        env.backends.onnx.wasm.locator = (file: string) => `${wasmBase}${file}`;
    } catch {
        // Fallback if not in extension context
    }

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
    } finally {
        modelLoading = false;
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
        // Evaluate the URL directly
        const results = await classifier(url, { top_k: null }) as Array<{ label: string; score: number }>;
        if (!results || results.length === 0) {
            return { level: 'safe', score: 0, modelVersion: MODEL_ID };
        }

        // Find the phishing/positive class score if multiple are returned, or just take top
        // Some models return just one label dict, others top_k.
        let bestMatch = results[0];
        const phishingEntry = results.find((r) => r.label.toLowerCase().includes('phishing') || r.label.includes('LABEL_1'));
        
        if (phishingEntry && phishingEntry.score > bestMatch.score) {
             bestMatch = phishingEntry;
        }

        const level = labelToLevel(bestMatch.label, bestMatch.score);

        return { level, score: bestMatch.score, modelVersion: MODEL_ID };
    } catch (err) {
        console.error('[AI Hygiene Offscreen] Inference error:', err);
        return { level: 'safe', score: 0, modelVersion: MODEL_ID };
    }
}

// --- Message handler ---
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'ping') {
        sendResponse({ type: 'pong' });
        return true;
    }

    if (message.type === 'initML') {
        initModel()
            .then(() => {
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

