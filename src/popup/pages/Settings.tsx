// src/popup/pages/Settings.tsx
// Settings page — backend configuration and notification preferences.

import { useState, useEffect, useCallback } from "react";
import { DEFAULT_BACKEND_URL } from "../../lib/constants";

interface BackendSettings {
  enabled: boolean;
  useLocalBackend: boolean;
  backendUrl: string;
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

export function SettingsPage({ onBack }: SettingsPageProps) {
  const [backend, setBackend] = useState<BackendSettings>({
    enabled: true,
    useLocalBackend: false,
    backendUrl: DEFAULT_BACKEND_URL,
  });

  const [notifications, setNotifications] = useState<NotificationSettings>({
    xpGainEnabled: true,
    badgeEarnedEnabled: true,
    levelUpEnabled: true,
    dangerAlertEnabled: true,
  });

  const [backendStatus, setBackendStatus] = useState<"unknown" | "running" | "offline">("unknown");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const isValidUrl = (url: string): boolean => {
    if (!url) return true;
    try {
      const p = new URL(url);
      return p.hostname === "127.0.0.1" || p.hostname === "localhost";
    } catch { return false; }
  };

  const loadSettings = useCallback(async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: "getSettings" });
      if (res?.backend) setBackend(res.backend);
      if (res?.notifications) setNotifications(res.notifications);
    } catch {}
  }, []);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch(`${backend.backendUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(2000),
      });
      setBackendStatus(res.ok ? "running" : "offline");
    } catch {
      setBackendStatus("offline");
    }
  }, [backend.backendUrl]);

  useEffect(() => {
    loadSettings();
    checkStatus();
  }, [loadSettings, checkStatus]);

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

  async function handleTestConnection() {
    try {
      const res = await fetch(`${backend.backendUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });
      alert(res.ok ? "✅ Connected to local daemon!" : "❌ Backend responded with an error.");
    } catch {
      alert(`❌ Cannot reach ${backend.backendUrl}. Make sure the backend is running.`);
    }
  }

  const statusColors = {
    running: "bg-green-100 text-green-800",
    offline: "bg-red-100 text-red-800",
    unknown: "bg-gray-100 text-gray-600",
  };
  const statusText = {
    running: "● Connected",
    offline: "● Offline",
    unknown: "● Checking…",
  };

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

        {/* ── Built-in ML ─────────────────────────────────────────────────── */}
        <Section title="Built-In Browser ML (Transformers.js)">
          <ToggleRow
            id="toggle-browser-ml"
            label="Enable In-Browser URL Analysis"
            description="Uses pirocheto/phishing-url-detection ONNX model locally. Zero config, fully private."
            checked={backend.enabled}
            onChange={(v) => setBackend(s => ({ ...s, enabled: v }))}
          />
          <p className="text-xs text-muted-foreground mt-1 font-mono">
            ℹ️ Only flags sites when phishing confidence ≥ 55%. Everyday sites like Google, YouTube, etc. are never flagged.
          </p>
        </Section>

        {/* ── Local NPU Daemon ────────────────────────────────────────────── */}
        <Section title="Local NPU Daemon (Advanced)">
          <ToggleRow
            id="toggle-npu-backend"
            label="Enable Local FastAPI Backend"
            description="Routes analysis to a locally-running backend (e.g. Lemonade Server with AMD NPU)."
            checked={backend.useLocalBackend}
            onChange={(v) => setBackend(s => ({ ...s, useLocalBackend: v }))}
          />

          <div>
            <label className="text-xs font-medium text-foreground">API URL</label>
            <input
              type="text"
              value={backend.backendUrl}
              onChange={(e) => {
                const v = e.target.value;
                setUrlError(isValidUrl(v) ? null : "Only 127.0.0.1 or localhost allowed.");
                setBackend(s => ({ ...s, backendUrl: v }));
              }}
              className={`mt-1 w-full px-3 py-2 border-2 text-xs bg-white font-mono ${urlError ? "border-red-500" : "border-border"}`}
              placeholder={DEFAULT_BACKEND_URL}
            />
            {urlError && <p className="text-xs text-red-600 mt-1">{urlError}</p>}
          </div>

          <div className="flex items-center gap-3 mt-1">
            <button
              id="settings-test-connection-btn"
              onClick={handleTestConnection}
              className="text-xs px-3 py-1.5 border-2 border-border bg-white hover:bg-accent transition-colors font-mono"
            >
              Test Connection
            </button>
            <span className={`text-xs font-medium px-2 py-0.5 rounded ${statusColors[backendStatus]}`}>
              {statusText[backendStatus]}
            </span>
          </div>
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
          disabled={saving || !!urlError}
          className="w-full bg-foreground text-background border-2 border-border px-4 py-3 text-sm font-bold font-['Syne'] hover:opacity-80 transition-opacity disabled:opacity-50"
        >
          {saving ? "Saving…" : saved ? "✅ Saved!" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}

// ── Helper components ────────────────────────────────────────────────────────

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
