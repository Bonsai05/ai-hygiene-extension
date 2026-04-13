// src/popup/Popup.tsx
// Main extension popup with dashboard, settings, and onboarding.

import { useEffect, useState, useCallback } from "react";
import { RiskStatus } from "./components/RiskStatus";
import { XPProgressBar } from "./components/XPBar";
import { BadgeGrid } from "./components/Badges";
import { QuickTips } from "./components/QuickTips";
import { PanicButton } from "./components/PanicButton";
import { ThreatList } from "./components/ThreatList";
import { SettingsPage } from "./pages/Settings";
import { OnboardingPage } from "./pages/Onboarding";
import type { UserStats } from "../lib/storage";
import { getLevelTitle, xpInLevel } from "../lib/storage";
import { XP_PER_LEVEL } from "../lib/constants";

interface XpToast {
  xpAmount: number;
  reason: string;
  isLoss: boolean;
}

interface LevelUpToast {
  level: number;
  levelTitle: string;
}

export default function Popup() {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [xpToast, setXpToast] = useState<XpToast | null>(null);
  const [levelUpToast, setLevelUpToast] = useState<LevelUpToast | null>(null);
  const [threats, setThreats] = useState<string[]>([]);

  const loadData = useCallback(async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: "getDashboardData" });
      if (res?.stats) setStats(res.stats);
    } catch {}
    finally { setLoading(false); }
  }, []);

  // Show XP toast for N ms (auto-dismiss, also dismissible manually)
  const showXpToast = useCallback((toast: XpToast, duration = 3500) => {
    setXpToast(toast);
    setTimeout(() => setXpToast(null), duration);
  }, []);

  useEffect(() => {
    loadData();

    // Check onboarding
    chrome.storage.local.get(["onboardingCompleted"]).then((r) => {
      if (!r.onboardingCompleted) setShowOnboarding(true);
    });

    const handler = (msg: Record<string, unknown>) => {
      if (msg.type === "xpGain") {
        showXpToast({ xpAmount: msg.xpAmount as number, reason: msg.reason as string, isLoss: false });
        loadData();
      }
      if (msg.type === "xpLoss") {
        showXpToast({ xpAmount: msg.xpAmount as number, reason: msg.reason as string, isLoss: true }, 4000);
        loadData();
      }
      if (msg.type === "levelUp") {
        setLevelUpToast({ level: msg.level as number, levelTitle: msg.levelTitle as string });
        loadData();
        setTimeout(() => setLevelUpToast(null), 4500);
      }
      if (msg.type === "threatUpdate" && Array.isArray(msg.threats)) {
        setThreats(msg.threats as string[]);
      }
      if (msg.type === "mlRiskResult" && Array.isArray(msg.threats)) {
        setThreats(msg.threats as string[]);
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, [loadData, showXpToast]);

  const handlePanic = async () => {
    setRecoveryOpen(true);
    try { await chrome.runtime.sendMessage({ type: "panicInitiated" }); } catch {}
  };

  const handleRecoveryComplete = async () => {
    setRecoveryOpen(false);
    try {
      await chrome.runtime.sendMessage({ type: "recoveryCompleted" });
      await loadData();
    } catch {}
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading || !stats) {
    return (
      <div className="w-[380px] h-[600px] bg-background flex items-center justify-center font-mono">
        <div className="text-center">
          <div className="size-8 border-2 border-border border-t-foreground animate-spin rounded-full mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (showOnboarding) return <OnboardingPage onComplete={() => setShowOnboarding(false)} />;
  if (showSettings) return <SettingsPage onBack={() => setShowSettings(false)} />;

  const xpCurrent = xpInLevel(stats.xp);
  const levelTitle = getLevelTitle(stats.level);

  return (
    <div className="w-[380px] h-[600px] bg-background border-4 border-border relative overflow-hidden flex flex-col font-mono text-foreground font-medium">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="bg-background border-b-2 border-border p-4 flex-shrink-0 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold font-['Syne']">AI Hygiene Companion</h1>
          <p className="text-[10px] text-muted-foreground mt-1">
            Level {stats.level} &mdash; {levelTitle}
          </p>
        </div>
        <button
          id="popup-settings-btn"
          onClick={() => setShowSettings(true)}
          className="size-8 border-2 border-border flex items-center justify-center text-muted-foreground hover:bg-accent transition-colors cursor-pointer"
          title="Settings"
        >
          &#9881;
        </button>
      </div>

      {/* ── Scrollable content ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-4 bg-[#f8f9fa]">
        <RiskStatus />
        <XPProgressBar
          currentXP={xpCurrent}
          maxXP={XP_PER_LEVEL}
          level={stats.level}
          levelTitle={levelTitle}
        />
        <ThreatList initialThreats={threats} />
        <BadgeGrid badges={stats.badges} />
        <QuickTips tips={stats.tips} />
        <div className="pt-2">
          <PanicButton onClick={handlePanic} />
        </div>
      </div>

      {/* ── XP Toast (auto-dismiss + manual dismiss button) ────────────────── */}
      {xpToast && (
        <div
          className={`absolute top-16 right-4 left-4 border-2 border-border p-3 z-40
            animate-in slide-in-from-top-2 fade-in duration-200
            ${xpToast.isLoss ? "bg-red-600 text-white" : "bg-foreground text-background"}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold">
                {xpToast.isLoss ? `-${xpToast.xpAmount} XP` : `+${xpToast.xpAmount} XP`}
              </p>
              <p className="text-[10px] opacity-80 mt-0.5">{xpToast.reason}</p>
            </div>
            <button
              id="popup-xp-toast-dismiss-btn"
              onClick={() => setXpToast(null)}
              className="flex-shrink-0 w-5 h-5 flex items-center justify-center opacity-70 hover:opacity-100 transition-opacity text-base leading-none"
              aria-label="Dismiss notification"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      {/* ── Level-up toast (auto-dismiss + manual dismiss button) ─────────── */}
      {levelUpToast && (
        <div className="absolute top-4 right-4 left-4 border-4 border-border bg-background p-4 z-50 animate-in slide-in-from-top-4 fade-in duration-300">
          <div className="flex items-start gap-3">
            <div className="text-2xl flex-shrink-0">&#11014;</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold font-['Syne']">Level Up!</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                You are now Level {levelUpToast.level} &mdash; {levelUpToast.levelTitle}
              </p>
            </div>
            <button
              id="popup-levelup-toast-dismiss-btn"
              onClick={() => setLevelUpToast(null)}
              className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors text-lg leading-none border border-border"
              aria-label="Dismiss level up notification"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      {/* ── Recovery modal ────────────────────────────────────────────────── */}
      {recoveryOpen && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background border-2 border-border rounded-lg p-4 m-4 max-h-[85%] overflow-y-auto">
            <div className="flex items-center gap-3 mb-3">
              <div className="size-10 bg-red-600 text-white border-2 border-border flex items-center justify-center flex-shrink-0 text-lg">
                &#9888;&#65039;
              </div>
              <div>
                <h2 className="text-base font-bold font-['Syne'] leading-tight">
                  It&apos;s Okay &mdash; Let&apos;s Work Through This Together
                </h2>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Follow these steps in order. You&apos;ve got this.
                </p>
              </div>
            </div>

            <ol className="space-y-3 text-sm">
              {[
                { title: "Stop and breathe.", detail: "Close the suspicious tab or email. Don't click anything else." },
                { title: "Don't enter any information.", detail: "If you entered a password, change it from a trusted device immediately." },
                { title: "Run a malware scan.", detail: "Use Windows Security or your antivirus to scan for threats." },
                { title: "Enable two-factor authentication.", detail: "On any account where you entered credentials, add 2FA now." },
                { title: "Report the attempt.", detail: "Report phishing emails to your email provider and scam sites to Google Safe Browsing." },
              ].map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex-shrink-0 size-6 bg-foreground text-background border-2 border-border flex items-center justify-center text-xs font-bold">
                    {i + 1}
                  </span>
                  <div>
                    <p className="font-bold">{step.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{step.detail}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-4 p-3 bg-muted border-2 border-border">
              <p className="text-xs font-bold mb-1">Remember:</p>
              <p className="text-xs text-muted-foreground">
                Everyone makes mistakes online. Going through these steps means you&apos;re already
                practising good digital hygiene. +30 XP for completing recovery!
              </p>
            </div>

            <button
              id="popup-recovery-done-btn"
              onClick={handleRecoveryComplete}
              className="mt-4 w-full bg-foreground text-background border-2 border-border px-4 py-3 text-sm font-bold font-['Syne'] hover:opacity-80 transition-opacity"
            >
              I&apos;m Ready to Continue Safely
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
