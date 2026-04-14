import { useState, useEffect } from "react";
import { MODELS, defaultModelStatusMap, type ModelKey, type ModelStatusMap } from "../../lib/model-registry";

interface BackendSettings { enabled: boolean; useLocalBackend: boolean; backendUrl: string; }

interface NotificationSettings {
  xpGainEnabled: boolean;
  badgeEarnedEnabled: boolean;
  levelUpEnabled: boolean;
  dangerAlertEnabled: boolean;
}

interface SettingsPageProps {
  onBack: () => void;
}

export function SettingsPage({ onBack }: SettingsPageProps) {
  const [backend, setBackend] = useState<BackendSettings>({
    enabled: true,
    useLocalBackend: false,
    backendUrl: "http://127.0.0.1:8000",
  });

  const [notifications, setNotifications] = useState<NotificationSettings>({
    xpGainEnabled: true,
    badgeEarnedEnabled: true,
    levelUpEnabled: true,
    dangerAlertEnabled: true,
  });

  const [modelStatus, setModelStatus] = useState<ModelStatusMap>(defaultModelStatusMap());
  const [modelStatusError, setModelStatusError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load settings from background
  const loadSettings = async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: "getSettings" });
      if (res?.backend) setBackend(res.backend);
      if (res?.notifications) setNotifications(res.notifications);
    } catch {}
  };

  const loadModelStatus = async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: "getModelStatus" });
      if (res?.statusMap) setModelStatus(res.statusMap as ModelStatusMap);
      setModelStatusError(typeof res?.error === "string" ? res.error : null);
    } catch {}
  };

  useEffect(() => {
    loadSettings();
    loadModelStatus();
    const handler = (msg: Record<string, unknown>) => {
      if (msg.type === "modelStatusUpdate" && msg.statusMap) {
        setModelStatus(msg.statusMap as ModelStatusMap);
        setDownloading(false);
      }
      if (msg.type === "modelProgress" && typeof msg.key === "string" && typeof msg.progress === "number") {
        const key = msg.key as ModelKey;
        setModelStatus((prev) => ({
          ...prev,
          [key]: { ...prev[key], state: "downloading", progress: msg.progress },
        }));
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await chrome.runtime.sendMessage({ type: "saveSettings", backend, notifications });
      setSaved(true);
      setTimeout(() => { setSaved(false); onBack(); }, 800);
    } catch {
      alert("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDownloadModels() {
    setDownloading(true);
    setModelStatusError(null);
    try {
      const res = await chrome.runtime.sendMessage({ type: "downloadModels" });
      if (!res?.ok) {
        if (typeof res?.error === "string") {
          setModelStatusError(res.error);
        } else {
          setModelStatusError("Model download request failed.");
        }
        setDownloading(false);
      }
      setTimeout(loadModelStatus, 1000);
    } catch {
      setModelStatusError("Failed to send model download request.");
      setDownloading(false);
    }
  }

  return (
    <div className="w-[380px] min-h-[600px] bg-background border-4 border-border flex flex-col font-mono text-foreground">
      {/* Header */}
      <div className="bg-background border-b-2 border-border p-4 flex items-center gap-3">
        <button
          id="settings-back-btn"
          onClick={onBack}
          className="text-lg hover:bg-accent transition-colors px-2 py-1 border border-border rounded"
        >
          ←
        </button>
        <h2 className="text-lg font-bold font-['Syne']">Settings</h2>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-[#f8f9fa]">

        <Section title="Standalone Models">
          <p className="text-xs text-muted-foreground">
            Models download automatically on extension load. Retry download if any model is failed/idle.
          </p>
          {modelStatusError && (
            <div className="text-[10px] border border-red-500 bg-red-50 text-red-700 p-2">
              {modelStatusError}
            </div>
          )}
          <div className="space-y-2">
            {(Object.keys(MODELS) as ModelKey[]).map((key) => {
              const s = modelStatus[key];
              return (
                <div key={key} className="text-xs border border-border p-2 bg-white">
                  <div className="flex items-center justify-between">
                    <span>{MODELS[key].nickname}</span>
                    <span className={s.state === "ready" ? "text-emerald-700" : s.state === "failed" ? "text-red-700" : "text-amber-700"}>
                      {s.state}
                    </span>
                  </div>
                  {(s.state === "downloading" || s.progress > 0) && (
                    <div className="mt-1 text-[10px] text-muted-foreground">Progress: {s.progress}%</div>
                  )}
                  {s.error && <div className="mt-1 text-[10px] text-red-700 break-words">{s.error}</div>}
                </div>
              );
            })}
          </div>
          <button
            id="settings-download-models-btn"
            onClick={handleDownloadModels}
            disabled={downloading}
            className="text-xs px-3 py-1.5 border-2 border-border bg-foreground text-background font-mono hover:opacity-80 transition-opacity disabled:opacity-60"
          >
            {downloading ? "Downloading..." : "Download / Retry Models"}
          </button>
        </Section>

        <Section title="Scan Behavior">
          <ToggleRow
            id="toggle-standalone-ml"
            label="Enable On-Device AI Scanning"
            description="Uses offscreen models only. No backend required."
            checked={backend.enabled}
            onChange={(v) => setBackend((s) => ({ ...s, enabled: v, useLocalBackend: false }))}
          />
        </Section>

        {/* ── Notifications ───────────────────────────────────────────────── */}
        <Section title="Notifications">
          <ToggleRow id="toggle-xp-notif" label="XP Gain / Loss" checked={notifications.xpGainEnabled} onChange={v => setNotifications(s => ({ ...s, xpGainEnabled: v }))} />
          <ToggleRow id="toggle-badge-notif" label="Badge Earned" checked={notifications.badgeEarnedEnabled} onChange={v => setNotifications(s => ({ ...s, badgeEarnedEnabled: v }))} />
          <ToggleRow id="toggle-levelup-notif" label="Level Up" checked={notifications.levelUpEnabled} onChange={v => setNotifications(s => ({ ...s, levelUpEnabled: v }))} />
          <ToggleRow id="toggle-danger-notif" label="Danger Alerts" checked={notifications.dangerAlertEnabled} onChange={v => setNotifications(s => ({ ...s, dangerAlertEnabled: v }))} />
        </Section>
      </div>

      {/* Save */}
      <div className="bg-background border-t-2 border-border p-4">
        <button
          id="settings-save-btn"
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-foreground text-background border-2 border-border px-4 py-3 text-sm font-bold font-['Syne'] hover:opacity-80 transition-opacity disabled:opacity-50"
        >
          {saving ? "Saving…" : saved ? "✅ Saved!" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{title}</h3>
      <div className="border-2 border-border bg-white p-3 space-y-3">{children}</div>
    </div>
  );
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description && <div className="text-xs text-muted-foreground mt-0.5">{description}</div>}
      </div>
      <button
        id={id}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 mt-0.5 ${
          checked ? "bg-foreground" : "bg-gray-300"
        }`}
        role="switch"
        aria-checked={checked}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ml-1 ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}
