// src/popup/Popup.tsx — Phase 2C
// Main extension popup with dashboard, settings, and onboarding

import { useEffect, useState, useCallback } from "react";
import { RiskStatus } from "./components/ui/RiskStatus";
import { XPProgressBar } from "./components/XPBar";
import { BadgeGrid } from "./components/Badges";
import { QuickTips } from "./components/QuickTips";
import { PanicButton } from "./components/PanicButton";
import { SettingsPage } from "./pages/Settings";
import { OnboardingPage } from "./pages/Onboarding";
import type { UserStats } from "../lib/storage";
import { getLevelTitle, getXpToNextLevel } from "../lib/gamification";
import { TIMINGS } from "../lib/constants";

interface XpToastData {
  xpAmount: number;
  reason: string;
  isLoss: boolean;
}

interface LevelUpToastData {
  level: number;
  levelTitle: string;
}

export default function Popup() {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [xpToast, setXpToast] = useState<XpToastData | null>(null);
  const [levelUpToast, setLevelUpToast] = useState<LevelUpToastData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: "getDashboardData" });
      if (response) {
        setStats(response.stats);
      }
    } catch (e) {
      console.error("Failed to load stats:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();

    // Check if onboarding needs to be shown
    chrome.storage.local.get(["onboardingCompleted"]).then((result) => {
      if (!result.onboardingCompleted) {
        setShowOnboarding(true);
      }
    });

    const handleMessage = (message: Record<string, unknown>) => {
      if (message.type === "xpGain") {
        setXpToast({ xpAmount: message.xpAmount as number, reason: message.reason as string, isLoss: false });
        loadData();
        setTimeout(() => setXpToast(null), TIMINGS.TOAST_DURATION_MS);
      }
      if (message.type === "xpLoss") {
        setXpToast({ xpAmount: message.xpAmount as number, reason: message.reason as string, isLoss: true });
        loadData();
        setTimeout(() => setXpToast(null), TIMINGS.TOAST_DURATION_MS + 500);
      }
      // NEW: level-up celebration — separate from xp toast
      if (message.type === "levelUp") {
        setLevelUpToast({ level: message.level as number, levelTitle: message.levelTitle as string });
        loadData();
        setTimeout(() => setLevelUpToast(null), TIMINGS.LEVEL_UP_DURATION_MS);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [loadData]);

  const handlePanic = async () => {
    setRecoveryOpen(true);
    try {
      await chrome.runtime.sendMessage({ type: "panicInitiated" });
    } catch (e) {
      console.warn("Failed to initiate panic:", e);
    }
  };

  const handleRecoveryComplete = async () => {
    setRecoveryOpen(false);
    try {
      await chrome.runtime.sendMessage({ type: "recoveryCompleted" });
      loadData();
    } catch (e) {
      console.warn("Failed to complete recovery:", e);
    }
  };

  if (loading || !stats) {
    return (
      <div className="w-[380px] h-[600px] bg-background border-4 border-border flex items-center justify-center font-mono">
        <div className="text-center">
          <div className="size-8 border-2 border-border border-t-foreground animate-spin rounded-full mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (showOnboarding) {
    return <OnboardingPage onComplete={() => setShowOnboarding(false)} />;
  }

  if (showSettings) {
    return <SettingsPage onBack={() => setShowSettings(false)} />;
  }

  const xpProgress = getXpToNextLevel(stats.xp, stats.level);
  const levelTitle = getLevelTitle(stats.level);

  return (
    <div className="w-[380px] h-[600px] bg-background border-4 border-border relative overflow-hidden flex flex-col font-mono text-foreground font-medium">
      {/* Header */}
      <div className="bg-background border-b-2 border-border p-4 flex-shrink-0 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold font-['Syne']">AI Hygiene Companion</h1>
          <p className="text-[10px] text-muted-foreground mt-1">
            Level {stats.level} — {levelTitle}
          </p>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="size-8 border-2 border-border flex items-center justify-center text-muted-foreground cursor-pointer hover:bg-accent transition-colors"
        >
          ⚙
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-4 bg-[#f8f9fa]">
        <RiskStatus />
        <XPProgressBar
          currentXP={xpProgress.current}
          maxXP={xpProgress.needed}
          level={stats.level}
          levelTitle={levelTitle}
        />
        <BadgeGrid badges={stats.badges} />
        <QuickTips tips={stats.tips} />
        <div className="pt-2">
          <PanicButton onClick={handlePanic} />
        </div>
      </div>

      {/* Footer */}
      <div className="bg-background border-t-2 border-border p-2">
        <button className="w-full flex justify-center items-center gap-2 hover:bg-accent transition-colors py-2 text-xs font-mono">
          <span> </span> Browser Extension Popup 🔌
        </button>
      </div>

      {/* XP gain / loss toast */}
      {xpToast && (
        <div className={`absolute top-16 right-4 left-4 border-2 border-border p-3 z-40
          animate-in slide-in-from-top-2 fade-in duration-200
          ${xpToast.isLoss ? "bg-destructive text-white" : "bg-foreground text-background"}`}>
          <p className="text-xs font-bold">
            {xpToast.isLoss ? `-${xpToast.xpAmount} XP` : `+${xpToast.xpAmount} XP`}
          </p>
          <p className="text-[10px] opacity-80">{xpToast.reason}</p>
        </div>
      )}

      {/* NEW: Level-up celebration toast — distinct styling, sits above xp toast */}
      {levelUpToast && (
        <div className="absolute top-4 right-4 left-4 border-4 border-border bg-background p-4 z-50
          animate-in slide-in-from-top-4 fade-in duration-300">
          <div className="flex items-center gap-3">
            <div className="text-2xl">⬆</div>
            <div>
              <p className="text-sm font-bold font-['Syne']">Level Up!</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                You are now Level {levelUpToast.level} — {levelUpToast.levelTitle}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Recovery modal */}
      {recoveryOpen && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background border-2 border-border rounded-lg p-4 m-4 max-h-[85%] overflow-y-auto">
            <div className="flex items-center gap-3 mb-3">
              <div className="size-10 bg-destructive text-destructive-foreground border-2 border-border flex items-center justify-center flex-shrink-0">
                ⚠️
              </div>
              <div>
                <h2 className="text-base font-bold font-['Syne'] leading-tight">
                  It&apos;s Okay — Let&apos;s Work Through This Together
                </h2>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Follow these steps in order. You&apos;ve got this.
                </p>
              </div>
            </div>
            <ol className="space-y-3 text-sm">
              {[
                { title: "Stop and breathe.", detail: "Close the suspicious tab or email. Don&apos;t click anything else." },
                { title: "Don&apos;t enter any information.", detail: "If you entered a password, change it from a trusted device immediately." },
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
