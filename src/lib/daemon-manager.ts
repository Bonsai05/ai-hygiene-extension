// src/lib/daemon-manager.ts
// Detects and manages local AI runtime daemons (Ollama, LM Studio, Lemonade).
// Used by the Settings page to provide guided heavy-model setup.

export type DaemonRuntime = "ollama" | "lemonade" | "lmstudio" | "none";

export type SetupPhase =
  | "idle"
  | "detecting"
  | "installing"
  | "downloading"
  | "ready"
  | "failed";

export interface PullProgress {
  percent: number;
  completedBytes?: number;
  totalBytes?: number;
  status?: string;
}

// Runtime endpoint probes
const RUNTIME_ENDPOINTS: Array<{ url: string; runtime: DaemonRuntime }> = [
  { url: "http://localhost:11434/api/tags", runtime: "ollama" },
  { url: "http://localhost:8000/health", runtime: "lemonade" },
  { url: "http://localhost:1234/v1/models", runtime: "lmstudio" },
];

const RUNTIME_PULL_URLS: Record<string, string> = {
  ollama: "http://localhost:11434/api/pull",
};

/**
 * Probe all known local runtimes and return the first one that responds.
 * Times out per probe at 1 second.
 */
export async function detectAvailableRuntime(): Promise<DaemonRuntime> {
  for (const { url, runtime } of RUNTIME_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(1000),
        cache: "no-store",
      });
      if (res.ok) return runtime;
    } catch {
      // Not available — try next
    }
  }
  return "none";
}

/**
 * Check if a specific runtime is available.
 */
export async function isRuntimeAvailable(runtime: DaemonRuntime): Promise<boolean> {
  const endpoint = RUNTIME_ENDPOINTS.find(e => e.runtime === runtime);
  if (!endpoint) return false;
  try {
    const res = await fetch(endpoint.url, {
      signal: AbortSignal.timeout(1000),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Poll for a runtime to become available.
 * Useful after guiding the user to install Ollama.
 */
export async function pollForRuntime(
  runtime: DaemonRuntime,
  timeoutMs: number,
  intervalMs = 3000
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (await isRuntimeAvailable(runtime)) return;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Runtime ${runtime} not available after ${timeoutMs}ms`);
}

/**
 * Pull a model from Ollama with streaming progress updates.
 * Calls onProgress with 0-100 percentage.
 */
export async function pullModel(
  runtime: DaemonRuntime,
  model: string,
  onProgress: (progress: PullProgress) => void
): Promise<void> {
  if (runtime !== "ollama") {
    throw new Error(`Model pull not supported for runtime: ${runtime}`);
  }

  const pullUrl = RUNTIME_PULL_URLS[runtime];
  const res = await fetch(pullUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: model, stream: true }),
  });

  if (!res.ok) throw new Error(`Pull request failed: ${res.status} ${res.statusText}`);
  if (!res.body) throw new Error("Response body is null");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const lines = decoder.decode(value, { stream: true }).split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const data = JSON.parse(line) as {
          status?: string;
          total?: number;
          completed?: number;
        };

        const progress: PullProgress = { percent: 0, status: data.status };

        if (data.total && data.completed) {
          progress.percent = Math.round((data.completed / data.total) * 100);
          progress.completedBytes = data.completed;
          progress.totalBytes = data.total;
        }

        if (data.status === "success") {
          progress.percent = 100;
        }

        onProgress(progress);
      } catch {
        // Skip malformed JSON lines
      }
    }
  }
}

/**
 * List available models from a runtime.
 */
export async function listModels(runtime: DaemonRuntime): Promise<string[]> {
  if (runtime === "ollama") {
    try {
      const res = await fetch("http://localhost:11434/api/tags", {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return [];
      const data = await res.json() as { models?: Array<{ name: string }> };
      return (data.models ?? []).map(m => m.name);
    } catch {
      return [];
    }
  }

  if (runtime === "lmstudio") {
    try {
      const res = await fetch("http://localhost:1234/v1/models", {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return [];
      const data = await res.json() as { data?: Array<{ id: string }> };
      return (data.data ?? []).map(m => m.id);
    } catch {
      return [];
    }
  }

  return [];
}

/** Models recommended for the heavy AI feature, ordered by recommendation. */
export const RECOMMENDED_MODELS = [
  { id: "llama3.2:3b",      label: "Llama 3.2 (3B) — Recommended",        size: "~2 GB", bestFor: "Threat explanation, multilingual" },
  { id: "deepseek-r1:1.5b", label: "DeepSeek-R1 (1.5B) — Lightweight",    size: "~1 GB", bestFor: "Chain-of-thought threat reasoning" },
  { id: "qwen2.5-coder:3b", label: "Qwen 2.5 Coder (3B)",                 size: "~2 GB", bestFor: "JS de-obfuscation, redirect analysis" },
  { id: "phi4-mini",        label: "Phi-4 Mini — Edge device",              size: "~2.5 GB", bestFor: "Low power, Microsoft optimized" },
] as const;
