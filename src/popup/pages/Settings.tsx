// src/popup/pages/Settings.tsx
// Settings page — backend status dashboard, lightweight model panel, heavy LLM toggle.
//
// Layout (top→bottom):
//   1. Backend Status card (live health, provider, models status table)
//   2. Heavy LLM toggle (download + load on-demand)
//   3. Notification preferences
//   4. About / setup instructions

import { useState, useEffect, useCallback } from "react";
import { DEFAULT_BACKEND_URL } from "../../lib/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface BackendModel {
  key: string;
  description: string;
  size: string;
  status: "loading" | "ready" | "failed" | "unknown";
}

interface HeavyModelState {
  loaded: boolean;
  model_id: string | null;
  status: string;
  progress?: number;
}

interface NotificationSettings {
  xpGainEnabled: boolean;
  badgeEarnedEnabled: boolean;
  levelUpEnabled: boolean;
  dangerAlertEnabled: boolean;
}

interface SettingsPageProps {
  onBack: () => void;
}

const HEAVY_MODEL_OPTIONS = [
  { id: "Qwen/Qwen2.5-1.5B-Instruct",   size: "~1 GB",   label: "Qwen 2.5 1.5B (Recommended)" },
  { id: "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B", size: "~1 GB", label: "DeepSeek R1 Distill 1.5B" },
  { id: "microsoft/Phi-4-mini-instruct", size: "~2.5 GB", label: "Phi-4 Mini" },
  { id: "google/gemma-4-it",             size: "~3 GB",   label: "Gemma 4 Instruct" },
];

// Status dot colors (matching Tailwind classes)
const STATUS_DOT: Record<string, string> = {
  ready:   "bg-green-500",
  loading: "bg-yellow-400 animate-pulse",
  failed:  "bg-red-500",
  unknown: "bg-gray-400",
};

// ---------------------------------------------------------------------------
// Main Settings component
// ---------------------------------------------------------------------------
export function SettingsPage({ onBack }: SettingsPageProps) {
  const [backendConnected, setBackendConnected] = useState(false);
  const [backendProvider, setBackendProvider] = useState("CPU");
  const [backendModels, setBackendModels] = useState<BackendModel[]>([]);
  const [heavyModel, setHeavyModel] = useState<HeavyModelState>({
    loaded: false, model_id: null, status: "unloaded", progress: 0
  });
  const [heavyEnabled, setHeavyEnabled] = useState(false);
  const [selectedHeavyModel, setSelectedHeavyModel] = useState(HEAVY_MODEL_OPTIONS[0].id);
  const [notifications, setNotifications] = useState<NotificationSettings>({
    xpGainEnabled: true,
    badgeEarnedEnabled: true,
    levelUpEnabled: true,
    dangerAlertEnabled: true,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // ── Load current state ────────────────────────────────────────────────────
  const loadState = useCallback(async () => {
    try {
      // Get notification settings
      const settingsRes = await chrome.runtime.sendMessage({ type: "getSettings" });
      if (settingsRes?.notifications) setNotifications(settingsRes.notifications);

      // Get backend status from background
      const statusRes = await chrome.runtime.sendMessage({ type: "getBackendStatus" });
      if (statusRes) {
        setBackendConnected(statusRes.status === "ready");
        if (statusRes.provider) setBackendProvider(statusRes.provider);
        if (statusRes.models) {
          const modelList: BackendModel[] = Object.entries(statusRes.models as Record<string, string>).map(
            ([key, status]) => ({
              key,
              description: MODEL_DESCRIPTIONS[key] ?? key,
              size: MODEL_SIZES[key] ?? "?",
              status: (status as BackendModel["status"]) ?? "unknown",
            })
          );
          setBackendModels(modelList);
        }
        if (statusRes.heavyModel) {
          setHeavyModel(statusRes.heavyModel);
          setHeavyEnabled(statusRes.heavyModel.loaded);
          if (statusRes.heavyModel.model_id) setSelectedHeavyModel(statusRes.heavyModel.model_id);
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    loadState();

    // Listen for live backend updates
    const handler = (msg: Record<string, unknown>) => {
      if (msg.type === "backendStatus") {
        setBackendConnected(msg.status === "ready");
        if (msg.provider) setBackendProvider(msg.provider as string);
        if (msg.models && typeof msg.models === "object") {
          const modelList: BackendModel[] = Object.entries(msg.models as Record<string, string>).map(
            ([key, status]) => ({
              key,
              description: MODEL_DESCRIPTIONS[key] ?? key,
              size: MODEL_SIZES[key] ?? "?",
              status: (status as BackendModel["status"]) ?? "unknown",
            })
          );
          setBackendModels(modelList);
        }
        if (msg.heavyModel) setHeavyModel(msg.heavyModel as HeavyModelState);
      }
      if (msg.type === "heavyModelStatus") {
        setHeavyModel({
          loaded: !!msg.loaded,
          model_id: msg.model_id as string | null,
          status: msg.status as string,
          progress: msg.progress as number | undefined,
        });
        setHeavyEnabled(!!msg.loaded);
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, [loadState]);

  // ── Heavy model toggle handler ────────────────────────────────────────────
  const handleHeavyToggle = async (enable: boolean) => {
    if (enable) {
      // Start download + load
      setHeavyModel(prev => ({ ...prev, status: "downloading", progress: 0 }));
      try {
        await chrome.runtime.sendMessage({ type: "loadHeavyModel", modelId: selectedHeavyModel });
      } catch {}
    } else {
      // Unload
      try {
        await chrome.runtime.sendMessage({ type: "unloadHeavyModel" });
        setHeavyModel({ loaded: false, model_id: null, status: "unloaded", progress: 0 });
        setHeavyEnabled(false);
      } catch {}
    }
  };

  // ── Save notification settings ────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      await chrome.runtime.sendMessage({
        type: "saveSettings",
        backend: { enabled: true, useLocalBackend: true, backendUrl: DEFAULT_BACKEND_URL },
        notifications,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    setSaving(false);
  };

  // ── Toggle notification item ──────────────────────────────────────────────
  const toggleNotif = (key: keyof NotificationSettings) => {
    setNotifications(prev => ({ ...prev, [key]: !prev[key] }));
    setSaved(false);
  };

  const readyCount = backendModels.filter(m => m.status === "ready").length;

  return (
    <div className="w-[380px] h-[600px] bg-background border-4 border-border flex flex-col font-mono text-foreground font-medium overflow-hidden">

      {/* Header */}
      <div className="bg-background border-b-2 border-border p-4 flex-shrink-0 flex items-center gap-3">
        <button
          id="settings-back-btn"
          onClick={onBack}
          className="size-8 border-2 border-border flex items-center justify-center text-muted-foreground hover:bg-accent transition-colors cursor-pointer flex-shrink-0"
          aria-label="Back"
        >
          ←
        </button>
        <div>
          <h1 className="text-base font-bold font-['Syne']">Settings</h1>
          <p className="text-[10px] text-muted-foreground">AI Hygiene Companion</p>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* ── Backend Status Card ──────────────────────────────────────────── */}
        <div className="border-2 border-border bg-background">
          <div className="px-3 py-2 border-b border-border bg-muted flex items-center justify-between">
            <h2 className="text-xs font-bold font-['Syne'] uppercase tracking-wider">🧠 Local ML Backend</h2>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
              backendConnected ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
            }`}>
              {backendConnected ? "● ONLINE" : "● OFFLINE"}
            </span>
          </div>

          <div className="px-3 py-2 space-y-2">
            {/* Provider row */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Hardware</span>
              <span className={`font-bold ${
                backendProvider.includes("Dml") ? "text-purple-600" :
                backendProvider.includes("CUDA") ? "text-green-600" :
                "text-blue-600"
              }`}>
                {backendProvider.replace("ExecutionProvider", "")}
              </span>
            </div>

            {/* Models table */}
            {backendConnected && backendModels.length > 0 ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground border-b border-border pb-1">
                  <span>Model</span>
                  <span>{readyCount}/{backendModels.length} ready</span>
                </div>
                {backendModels.map(m => (
                  <div key={m.key} className="flex items-center gap-2 text-[10px]">
                    <div className={`size-2 rounded-full flex-shrink-0 ${STATUS_DOT[m.status] ?? STATUS_DOT.unknown}`} />
                    <span className="flex-1 truncate text-muted-foreground">{m.description}</span>
                    <span className="text-muted-foreground flex-shrink-0">{m.size}</span>
                  </div>
                ))}
              </div>
            ) : backendConnected ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                <div className="size-3 border-2 border-border border-t-foreground animate-spin rounded-full" />
                <span>Loading model status…</span>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground py-1 space-y-1">
                <p className="font-medium text-red-600">Backend not running.</p>
                <p>Run <code className="bg-muted px-1 rounded">api/setup.bat</code> once, then reload the extension.</p>
                <p className="text-[10px]">
                  The backend runs 7 lightweight ML models (phishing, scam, PII detection) locally on your device.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── Heavy LLM Card ───────────────────────────────────────────────── */}
        <div className="border-2 border-border bg-background">
          <div className="px-3 py-2 border-b border-border bg-muted flex items-center justify-between">
            <h2 className="text-xs font-bold font-['Syne'] uppercase tracking-wider">🔥 Deep Analysis LLM</h2>
            <span className="text-[10px] text-muted-foreground">Optional — 1–3 GB</span>
          </div>

          <div className="px-3 py-3 space-y-3">
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Download a local generative LLM for deep threat reasoning. The model runs entirely on-device — no data leaves your machine.
              Requires the backend to be online.
            </p>

            {/* Model selector */}
            {!heavyModel.loaded && (
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground font-medium">Select model:</label>
                <select
                  id="settings-heavy-model-select"
                  value={selectedHeavyModel}
                  onChange={e => setSelectedHeavyModel(e.target.value)}
                  disabled={!backendConnected || heavyModel.status === "downloading" || heavyModel.status === "loading"}
                  className="w-full text-[11px] border border-border bg-background px-2 py-1 rounded disabled:opacity-40 text-foreground"
                >
                  {HEAVY_MODEL_OPTIONS.map(m => (
                    <option key={m.id} value={m.id}>{m.label} ({m.size})</option>
                  ))}
                </select>
              </div>
            )}

            {/* Status / progress */}
            {(heavyModel.status === "downloading" || heavyModel.status === "loading") && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs">
                  <div className="size-3 border-2 border-border border-t-foreground animate-spin rounded-full flex-shrink-0" />
                  <span className="text-muted-foreground">
                    {heavyModel.status === "downloading" ? "Downloading…" : "Loading into memory…"}
                    {typeof heavyModel.progress === "number" && ` ${heavyModel.progress}%`}
                  </span>
                </div>
                {typeof heavyModel.progress === "number" && (
                  <div className="w-full bg-muted border border-border h-1.5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-foreground transition-all duration-300"
                      style={{ width: `${heavyModel.progress}%` }}
                    />
                  </div>
                )}
              </div>
            )}

            {heavyModel.status === "ready" && heavyModel.model_id && (
              <div className="text-[10px] text-green-600 font-medium">
                ✓ {heavyModel.model_id.split("/").pop()} loaded and ready
              </div>
            )}

            {heavyModel.status === "failed" && (
              <div className="text-[10px] text-red-600 font-medium">
                ✗ Load failed — check backend terminal for errors
              </div>
            )}

            {/* Toggle button */}
            {heavyModel.status === "ready" ? (
              <button
                id="settings-heavy-unload-btn"
                onClick={() => handleHeavyToggle(false)}
                className="w-full border-2 border-red-300 text-red-600 text-xs font-bold py-2 hover:bg-red-50 transition-colors cursor-pointer"
              >
                Unload Model (free RAM)
              </button>
            ) : heavyModel.status === "downloading" || heavyModel.status === "loading" ? (
              <div className="text-center text-[10px] text-muted-foreground py-1">
                Please wait for download to complete…
              </div>
            ) : (
              <button
                id="settings-heavy-load-btn"
                onClick={() => handleHeavyToggle(true)}
                disabled={!backendConnected}
                className="w-full bg-foreground text-background text-xs font-bold py-2 border-2 border-border hover:opacity-80 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              >
                {backendConnected ? "⬇ Download & Load LLM" : "Backend offline"}
              </button>
            )}
          </div>
        </div>

        {/* ── Notification Preferences ──────────────────────────────────────── */}
        <div className="border-2 border-border bg-background">
          <div className="px-3 py-2 border-b border-border bg-muted">
            <h2 className="text-xs font-bold font-['Syne'] uppercase tracking-wider">🔔 Notifications</h2>
          </div>
          <div className="px-3 py-2 space-y-2">
            {(
              [
                { key: "xpGainEnabled" as const, label: "XP gains" },
                { key: "badgeEarnedEnabled" as const, label: "Badge earned" },
                { key: "levelUpEnabled" as const, label: "Level up" },
                { key: "dangerAlertEnabled" as const, label: "Danger alerts" },
              ] as const
            ).map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{label}</span>
                <button
                  id={`settings-notif-${key}-btn`}
                  onClick={() => toggleNotif(key)}
                  role="switch"
                  aria-checked={notifications[key]}
                  className={`relative w-9 h-5 border-2 border-border transition-colors cursor-pointer ${
                    notifications[key] ? "bg-foreground" : "bg-muted"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 size-3 bg-background border border-border transition-all ${
                      notifications[key] ? "left-4" : "left-0.5"
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* ── Setup Instructions Card (shown when backend offline) ──────────── */}
        {!backendConnected && (
          <div className="border-2 border-yellow-400 bg-yellow-50">
            <div className="px-3 py-2 border-b border-yellow-400 bg-yellow-100">
              <h2 className="text-xs font-bold font-['Syne'] uppercase tracking-wider text-yellow-800">⚙ Setup Guide</h2>
            </div>
            <div className="px-3 py-2 space-y-1 text-[10px] text-yellow-900">
              <p className="font-bold">One-time setup (takes ~2 minutes):</p>
              <ol className="space-y-1 list-decimal list-inside">
                <li>Open the extension folder → navigate to <code className="bg-yellow-200 px-1">api/</code></li>
                <li>Double-click <code className="bg-yellow-200 px-1">setup.bat</code> and follow prompts</li>
                <li>Enter your Extension ID from <code className="bg-yellow-200 px-1">chrome://extensions</code></li>
                <li>Reload the extension — backend auto-starts</li>
              </ol>
            </div>
          </div>
        )}

        {/* About */}
        <div className="text-[10px] text-muted-foreground text-center pb-2 space-y-1">
          <p>AI Hygiene Companion v2.0</p>
          <p>All analysis runs locally — your data never leaves your device.</p>
        </div>
      </div>

      {/* Save button */}
      <div className="border-t-2 border-border p-4 flex-shrink-0">
        <button
          id="settings-save-btn"
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-foreground text-background border-2 border-border py-2 text-sm font-bold font-['Syne'] hover:opacity-80 transition-opacity disabled:opacity-50 cursor-pointer"
        >
          {saving ? "Saving…" : saved ? "✓ Saved" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Model metadata (matches api/main.py LIGHTWEIGHT_MODELS)
// ---------------------------------------------------------------------------
const MODEL_DESCRIPTIONS: Record<string, string> = {
  url_phishing:    "URL Phishing Detector",
  scam_llm:        "ScamLLM (Social Eng.)",
  bert_phishing:   "BERT Phishing (ONNX)",
  pii_detection:   "PII Entity Detector",
  bert_phishing_v2: "BERT Phishing v2",
  email_phishing:  "Email Phishing (DistilBERT)",
  spam_detection:  "SMS Spam / Smishing",
};

const MODEL_SIZES: Record<string, string> = {
  url_phishing:    "30 MB",
  scam_llm:        "66 MB",
  bert_phishing:   "68 MB",
  pii_detection:   "45 MB",
  bert_phishing_v2: "110 MB",
  email_phishing:  "65 MB",
  spam_detection:  "17 MB",
};
