import { useEffect, useState, useCallback } from "react";
import { RiskStatus } from "./components/ui/RiskStatus";
import { XPProgressBar } from "./components/XPBar";
import { BadgeGrid, Badge } from "./components/Badges";
import { QuickTips } from "./components/QuickTips";
import { PanicButton } from "./components/PanicButton";
import type { UserStats } from "../lib/storage";
import { getLevelTitle, getXpToNextLevel } from "../lib/gamification";

interface XpGainEvent {
    xpAmount: number;
    reason: string;
    totalXp: number;
    level: number;
    levelTitle: string;
    xpProgress: { current: number; max: number };
}

export default function Popup() {
    const [stats, setStats] = useState<UserStats | null>(null);
    const [riskLevel, setRiskLevel] = useState<"safe" | "warning" | "danger">("safe");
    const [recoveryOpen, setRecoveryOpen] = useState(false);
    const [xpToast, setXpToast] = useState<XpGainEvent | null>(null);
    const [loading, setLoading] = useState(true);

    // Load initial data
    const loadData = useCallback(async () => {
        try {
            const response = await chrome.runtime.sendMessage({ type: "getDashboardData" });
            if (response) {
                setStats(response.stats);
                setRiskLevel(response.riskLevel);
            }
        } catch (e) {
            console.error("Failed to load stats:", e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();

        // Listen for messages from background
        const messageListener = (message: { type: string; level?: string; xpGain?: XpGainEvent }) => {
            if (message.type === "riskUpdate" && message.level) {
                setRiskLevel(message.level as "safe" | "warning" | "danger");
            }
            if (message.type === "xpGain" && message.xpGain) {
                setXpToast(message.xpGain);
                loadData();
                setTimeout(() => setXpToast(null), 3000);
            }
            if (message.type === "stats") {
                setStats(message.stats);
            }
        };

        chrome.runtime.onMessage.addListener(messageListener);
        return () => chrome.runtime.onMessage.removeListener(messageListener);
    }, [loadData]);

    const handlePanic = async () => {
        setRecoveryOpen(true);
        try {
            await chrome.runtime.sendMessage({ type: "panicInitiated" });
        } catch (e) {
            console.error("Failed to notify panic:", e);
        }
    };

    const handleRecoveryComplete = async () => {
        setRecoveryOpen(false);
        try {
            await chrome.runtime.sendMessage({ type: "recoveryCompleted" });
            loadData();
        } catch (e) {
            console.error("Failed to notify recovery complete:", e);
        }
    };

    // Loading state
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

    const xpProgress = getXpToNextLevel(stats.xp, stats.level);
    const levelTitle = getLevelTitle(stats.level);

    return (
        <div className="w-[380px] h-[600px] bg-background border-4 border-border relative overflow-hidden flex flex-col font-mono text-foreground font-medium">

            {/* Header */}
            <div className="bg-background border-b-2 border-border p-4 flex-shrink-0 flex items-start justify-between">
                <div>
                    <h1 className="text-xl font-bold font-['Syne']">
                        AI Hygiene Companion
                    </h1>
                    <p className="text-[10px] text-muted-foreground mt-1">
                        Level {stats.level} — {levelTitle}
                    </p>
                </div>

                <div className="size-8 border-2 border-border flex items-center justify-center text-muted-foreground cursor-pointer hover:bg-accent transition-colors">
                    ⚙
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-4 bg-[#f8f9fa]">
                <RiskStatus />

                <XPProgressBar
                    currentXP={stats.xp}
                    maxXP={stats.maxXp}
                    level={stats.level}
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
                    <span>🔌</span> Browser Extension Popup
                </button>
            </div>

            {/* XP Toast */}
            {xpToast && (
                <div className="absolute top-16 right-4 left-4 bg-foreground text-background border-2 border-border p-3 animate-in slide-in-from-top-2 fade-in duration-200 z-50">
                    <p className="text-xs font-bold">+{xpToast.xpAmount} XP</p>
                    <p className="text-[10px] opacity-80">{xpToast.reason}</p>
                </div>
            )}

            {/* Recovery Modal */}
            {recoveryOpen && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-background border-2 border-border rounded-lg p-4 m-4 max-h-[85%] overflow-y-auto">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="size-10 bg-destructive text-destructive-foreground border-2 border-border flex items-center justify-center flex-shrink-0">
                                ⚠
                            </div>
                            <div>
                                <h2 className="text-base font-bold font-['Syne'] leading-tight">
                                    It's Okay — Let's Work Through This Together
                                </h2>
                                <p className="text-[10px] text-muted-foreground mt-0.5">
                                    Follow these steps in order. You've got this.
                                </p>
                            </div>
                        </div>

                        <ol className="space-y-3 text-sm">
                            <li className="flex gap-3">
                                <span className="flex-shrink-0 size-6 bg-foreground text-background border-2 border-border flex items-center justify-center text-xs font-bold">1</span>
                                <div>
                                    <p className="font-bold">Stop and breathe.</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        Close the suspicious tab or email. Don't click anything else.
                                    </p>
                                </div>
                            </li>
                            <li className="flex gap-3">
                                <span className="flex-shrink-0 size-6 bg-foreground text-background border-2 border-border flex items-center justify-center text-xs font-bold">2</span>
                                <div>
                                    <p className="font-bold">Don't enter any information.</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        If you entered a password, change it from a trusted device immediately.
                                    </p>
                                </div>
                            </li>
                            <li className="flex gap-3">
                                <span className="flex-shrink-0 size-6 bg-foreground text-background border-2 border-border flex items-center justify-center text-xs font-bold">3</span>
                                <div>
                                    <p className="font-bold">Run a malware scan.</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        Use Windows Security or your antivirus to scan for threats.
                                    </p>
                                </div>
                            </li>
                            <li className="flex gap-3">
                                <span className="flex-shrink-0 size-6 bg-foreground text-background border-2 border-border flex items-center justify-center text-xs font-bold">4</span>
                                <div>
                                    <p className="font-bold">Enable two-factor authentication.</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        On any account where you entered credentials, add 2FA now.
                                    </p>
                                </div>
                            </li>
                            <li className="flex gap-3">
                                <span className="flex-shrink-0 size-6 bg-foreground text-background border-2 border-border flex items-center justify-center text-xs font-bold">5</span>
                                <div>
                                    <p className="font-bold">Report the attempt.</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        Report phishing emails to your email provider and scam sites to Google Safe Browsing.
                                    </p>
                                </div>
                            </li>
                        </ol>

                        <div className="mt-4 p-3 bg-muted border-2 border-border">
                            <p className="text-xs font-bold mb-1">Remember:</p>
                            <p className="text-xs text-muted-foreground">
                                Everyone makes mistakes online. The fact that you're going through these steps means you're already practicing good digital hygiene. +30 XP for completing recovery!
                            </p>
                        </div>

                        <button
                            onClick={handleRecoveryComplete}
                            className="mt-4 w-full bg-foreground text-background border-2 border-border px-4 py-3 text-sm font-bold font-['Syne'] hover:opacity-80 transition-opacity"
                        >
                            I'm Ready to Continue Safely
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
