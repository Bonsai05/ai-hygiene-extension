// src/popup/pages/Settings.tsx
// Settings page with backend configuration, NPU toggle, and notification preferences

import { useState, useEffect, useCallback } from "react";
import { DEFAULT_BACKEND_URL } from "../../lib/constants";

interface BackendSettings {
  enabled: boolean;
  useLocalBackend: boolean;
  backendUrl: string;
  useAmdNpu: boolean;
  autoStartBackend: boolean;
  mlModelLazyLoad: boolean;
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
    useAmdNpu: false,
    autoStartBackend: true,
    mlModelLazyLoad: true,
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

  const isValidBackendUrl = (url: string): boolean => {
    if (!url) return true;
    try {
      const parsed = new URL(url);
      return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    } catch {
      return false;
    }
  };

  const loadSettings = useCallback(async () => {
    try {
      const result = await chrome.runtime.sendMessage({ type: "getSettings" });
      if (result?.backend) setBackend(result.backend);
      if (result?.notifications) setNotifications(result.notifications);
    } catch (e) {
      console.warn("Failed to load settings:", e);
    }
  }, []);

  const checkBackendStatus = useCallback(async () => {
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
    checkBackendStatus();
  }, [loadSettings, checkBackendStatus]);

  async function handleTestConnection() {
    try {
      const res = await fetch(`${backend.backendUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });
      alert(res.ok ? "✅ Connection successful!" : "❌ Backend responded with error");
    } catch (e) {
      alert(`❌ Cannot connect to backend. Ensure it's running on ${backend.backendUrl}. Error: ${e}`);
    }
  }

  async function handleStartBackend() {
    try {
      await chrome.runtime.sendMessage({
        type: "startBackend",
        url: backend.backendUrl,
      });
      setTimeout(checkBackendStatus, 2000);
    } catch (err) {
      alert("Failed to start backend: " + err);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await chrome.runtime.sendMessage({
        type: "saveSettings",
        backend,
        notifications,
      });
      alert("Settings saved!");
      onBack();
    } catch (err) {
      alert("Failed to save settings: " + err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-[380px] min-h-[600px] bg-background border-4 border-border flex flex-col font-mono text-foreground">
      {/* Header */}
      <div className="bg-background border-b-2 border-border p-4 flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-lg hover:bg-accent transition-colors px-2 py-1 rounded"
        >
          ←
        </button>
        <h2 className="text-lg font-bold font-['Syne']">Settings</h2>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-[#f8f9fa]">
        {/* Built-in ML Settings */}
        <Section title="Lightweight Built-In Models (Transformers.js)">
          <ToggleRow
            label="Enable In-Browser URL Lexical Analysis"
            description="Uses pirocheto/phishing-url-detection WebAssembly completely natively. Zero config."
            checked={backend.enabled}
            onChange={(v) => setBackend((s) => ({ ...s, enabled: v }))}
          />

          <ToggleRow
            label="In-Browser Text Classification"
            description="Downloads ONNX Community DistilBERT to check DOM text locally."
            checked={backend.mlModelLazyLoad}
            onChange={(v) => setBackend((s) => ({ ...s, mlModelLazyLoad: v }))}
          />
        </Section>

        {/* Heavyweight Server Configuration */}
        <Section title="Heavyweight Local NPU Daemon">
          <div className="space-y-3">
            <ToggleRow
              label="Enable Heavyweight AMD Ryzen AI Models"
              description="Routes deep inspection to an external local API (Lemonade Server / Host Daemon) for Llama 3.2 or DeepSeek R1."
              checked={backend.useLocalBackend}
              onChange={(v) => setBackend((s) => ({ ...s, useLocalBackend: v }))}
            />

            <div>
              <label className="text-sm font-medium text-foreground">Local Host API URL (Lemonade / Companion App)</label>
              <input
                type="text"
                value={backend.backendUrl}
                onChange={(e) => {
                  const newUrl = e.target.value;
                  if (isValidBackendUrl(newUrl)) {
                    setUrlError(null);
                    setBackend((s) => ({ ...s, backendUrl: newUrl }));
                  } else {
                    setUrlError("Only 127.0.0.1 or localhost allowed for external daemons.");
                  }
                }}
                className={`mt-1 w-full px-3 py-2 border rounded-md text-sm bg-background ${
                  urlError ? "border-destructive" : "border-input"
                }`}
                placeholder={DEFAULT_BACKEND_URL}
              />
              {urlError && <p className="text-xs text-destructive mt-1">{urlError}</p>}
            </div>

            <div className="flex gap-2">
              <Button onClick={handleTestConnection} variant="secondary" size="sm">
                Test Connection to Local Daemon
              </Button>
            </div>
            
            <div className="mt-3 flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Local Daemon Status:</span>
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded ${
                  backendStatus === "running"
                    ? "bg-green-100 text-green-800"
                    : backendStatus === "offline"
                    ? "bg-red-100 text-red-800"
                    : "bg-gray-100 text-gray-800"
                }`}
              >
                {backendStatus === "running"
                  ? "● Connected to NPU Daemon"
                  : backendStatus === "offline"
                  ? "● Daemon Offline"
                  : "● Checking..."}
              </span>
            </div>

            {backend.useLocalBackend && (
              <InfoBox variant="info" className="mt-2 text-xs">
                <p className="font-semibold">Hardware Acceleration Activated:</p>
                <ul className="list-disc ml-4 mt-1 space-y-0.5">
                  <li>Leveraging AMD Ryzen 7000+ Series NPU</li>
                  <li>DirectML execution provider enabled</li>
                  <li>Inference decoupled from Chrome Sandbox</li>
                </ul>
              </InfoBox>
            )}
          </div>
        </Section>

        {/* Notifications */}
        <Section title="Notifications">
          <ToggleRow
            label="XP Gain Notifications"
            checked={notifications.xpGainEnabled}
            onChange={(v) => setNotifications((s) => ({ ...s, xpGainEnabled: v }))}
          />
          <ToggleRow
            label="Badge Earned Notifications"
            checked={notifications.badgeEarnedEnabled}
            onChange={(v) => setNotifications((s) => ({ ...s, badgeEarnedEnabled: v }))}
          />
          <ToggleRow
            label="Level Up Notifications"
            checked={notifications.levelUpEnabled}
            onChange={(v) => setNotifications((s) => ({ ...s, levelUpEnabled: v }))}
          />
          <ToggleRow
            label="Danger Alert Notifications"
            checked={notifications.dangerAlertEnabled}
            onChange={(v) => setNotifications((s) => ({ ...s, dangerAlertEnabled: v }))}
          />
        </Section>
      </div>

      {/* Save Button */}
      <div className="bg-background border-t-2 border-border p-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-foreground text-background border-2 border-border px-4 py-3 text-sm font-bold font-['Syne'] hover:opacity-80 transition-opacity disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </div>
  );
}

// Helper Components

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        disabled={disabled}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          checked ? "bg-primary" : "bg-input"
        } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
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

function InfoBox({
  variant = "info",
  children,
}: {
  variant?: "info" | "warning" | "error";
  children: React.ReactNode;
}) {
  const colors = {
    info: "bg-blue-50 border-blue-200 text-blue-800",
    warning: "bg-yellow-50 border-yellow-200 text-yellow-800",
    error: "bg-red-50 border-red-200 text-red-800",
  };

  return (
    <div className={`p-3 border rounded-md text-xs ${colors[variant]}`}>{children}</div>
  );
}

function Button({
  children,
  onClick,
  variant = "default",
  size = "md",
  disabled = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "default" | "secondary";
  size?: "sm" | "md";
  disabled?: boolean;
}) {
  const variants = {
    default: "bg-foreground text-background hover:opacity-80",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  };
  const sizes = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center font-medium rounded-md transition-colors ${variants[variant]} ${sizes[size]} ${
        disabled ? "opacity-50 cursor-not-allowed" : ""
      }`}
    >
      {children}
    </button>
  );
}
