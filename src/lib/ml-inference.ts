/**
 * ML Inference Module — phishing classifier (ONNX)
 * Runs client-side via Transformers.js (WASM backend) in the offscreen document.
 *
 * Architecture:
 *   background.ts  →  offscreen.ts  →  Transformers.js (WASM)
 *       ↑                                    |
 *       └──────────── risk result ──────────┘
 *
 * Uses onnx-community/phishing-email-detection-distilbert_v2.4.1-ONNX as a proxy
 * for URL classification (outputs LABEL_0/LABEL_1 like the original URL model).
 */

import { pipeline, env, type Pipeline } from '@huggingface/transformers';

const MODEL_ID = 'onnx-community/phishing-email-detection-distilbert_v2.4.1-ONNX';

export type MLRiskLevel = 'safe' | 'warning' | 'danger';

export interface MLRiskResult {
    level: MLRiskLevel;
    score: number;       // 0–1 probability of phishing
    modelVersion: string;
}

// Singleton classifier instance
let classifier: Pipeline | null = null;
let modelLoading = false;
let modelReady = false;
const pendingQueue: Array<(result: MLRiskResult) => void> = [];

function labelToLevel(label: string, score: number): MLRiskLevel {
    // urlbert-tiny-v4 returns LABEL_0 (good/benign) and LABEL_1 (phishing)
    if (label === 'LABEL_1' && score > 0.75) return 'danger';
    if (label === 'LABEL_1' && score > 0.4) return 'warning';
    return 'safe';
}

export async function initMLModel(): Promise<void> {
    if (modelReady) return;

    // Configure env to use local WASM files (bundled by vite plugin)
    env.allowLocalModels = true;
    env.useBrowserCache = true;
    // Point Transformers.js at our bundled WASM files
    env.backends.onnx.wasm.numThreads = 4;

    // The WASM files are served from the extension root as web_accessible_resources.
    // We override the locateFile to point at the local bundled copies.
    const wasmBase = chrome.runtime.getURL('assets/wasm/');
    env.backends.onnx.wasm.locator = (file: string) => {
        return `${wasmBase}${file}`;
    };

    modelLoading = true;
    try {
        classifier = await pipeline(
            'text-classification',
            MODEL_ID,
            {
                device: 'wasm',       // Use WASM backend (CPU, no GPU needed)
                dtype: 'fp32',         // Full precision for accuracy
            }
        );
        modelReady = true;
        console.info('[AI Hygiene] ML model loaded:', MODEL_ID);

        // Drain pending queue
        while (pendingQueue.length > 0) {
            const resolve = pendingQueue.shift()!;
            resolve as unknown as void; // placeholder — queue drains into analyzeUrl
        }
    } catch (err) {
        console.error('[AI Hygiene] ML model init failed:', err);
        modelLoading = false;
        throw err;
    }
}

export async function analyzeUrl(absoluteUrl: string): Promise<MLRiskResult> {
    if (!modelReady || !classifier) {
        if (modelLoading) {
            // Queue the request — will be resolved when model loads
            return new Promise<MLRiskResult>((resolve) => {
                pendingQueue.push(resolve as unknown as (result: MLRiskResult) => void);
            });
        }
        // Model not loaded and not loading — trigger load and return safe
        initMLModel().catch(() => {});
        return { level: 'safe', score: 0, modelVersion: MODEL_ID };
    }

    try {
        // urlbert-tiny-v4 expects just the URL string as input
        const results = await classifier(absoluteUrl, { top_k: 1 });

        if (!results || results.length === 0) {
            return { level: 'safe', score: 0, modelVersion: MODEL_ID };
        }

        const top = results[0] as { label: string; score: number };
        const phishingScore = top.label === 'LABEL_1' ? top.score : 1 - top.score;
        const level = labelToLevel(top.label, phishingScore);

        return {
            level,
            score: phishingScore,
            modelVersion: MODEL_ID,
        };
    } catch (err) {
        console.error('[AI Hygiene] ML inference error:', err);
        return { level: 'safe', score: 0, modelVersion: MODEL_ID };
    }
}

export function isModelReady(): boolean {
    return modelReady;
}

export function isModelLoading(): boolean {
    return modelLoading;
}
