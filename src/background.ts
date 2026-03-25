// Background script for Chrome Extension – Service Worker (MV3)
// Handles risk detection, XP awards, badge notifications, and popup communication

import {
    loadStats,
    saveStats,
    updateStats,
    loadRiskLevel,
    saveRiskLevel,
    type UserStats,
} from "./lib/storage";
import { analyzeUrl, contentRiskFromSignals, type RiskAnalysis } from "./lib/risk-detection";
import {
    awardSafeBrowsingXp,
    awardDangerAvoidedXp,
    onPanicButtonClicked,
    onRecoveryCompleted,
    getLevelTitle,
    getXpToNextLevel,
    XP_REWARDS,
} from "./lib/gamification";
import { showBrowserNotification } from "./lib/notifications";

// --- ML Model Integration (FastAPI Backend) ---
// The AI phishing detection now runs locally on the native machine to leverage
// the AMD Ryzen AI NPU/CPU hardware via the local Python FastAPI server.

interface BackendMLResult {
    level: "safe" | "warning" | "danger";
    score: number;
    provider: string;
}

async function analyzeUrlWithBackend(url: string): Promise<BackendMLResult | null> {
    try {
        const response = await fetch("http://127.0.0.1:8000/api/analyze", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ url: url })
        });

        if (!response.ok) throw new Error("Backend offline");

        const data = await response.json();
        console.log("[AI Hygiene] Backend Result:", data);

        // Map the numerical score to a risk level for the UI
        const score = data.phishing_score;
        let level: "safe" | "warning" | "danger" = "safe";

        if (score >= 0.7) {
            level = "danger";
        } else if (score >= 0.3) {
            level = "warning";
        }

        return {
            level,
            score,
            provider: data.provider
        };

    } catch (error) {
        console.warn("[AI Hygiene] Failed to reach local backend. Falling back to heuristics:", error);
        return null;
    }
}


// --- Risk detection state ---
let currentRiskLevel: "safe" | "warning" | "danger" = "safe";
let lastAnalyzedUrl = "";

// Track whether we've already awarded XP for this URL
const visitedUrls = new Set<string>();


// --- Set risk level and notify popup ---
function setRiskLevel(level: "safe" | "warning" | "danger") {
    currentRiskLevel = level;
    saveRiskLevel(level);
    chrome.runtime.sendMessage({ type: "riskUpdate", level }).catch(() => {
        // No active popup to receive — that's ok
    });
}


// --- XP notification ---
async function notifyXpGain(stats: UserStats, xpAmount: number, reason: string) {
    const { current: currentInLevel, needed: neededForLevel } = getXpToNextLevel(stats.xp, stats.level);
    const levelTitle = getLevelTitle(stats.level);
    const levelUp = `Level ${stats.level} ${levelTitle}`;

    try {
        chrome.runtime.sendMessage({
            type: "xpGain",
            xpAmount,
            reason,
            totalXp: stats.xp,
            level: stats.level,
            levelTitle,
            xpProgress: { current: currentInLevel, max: neededForLevel },
        });
    } catch {
        // no active popup
    }

    if (xpAmount > 0) {
        await showBrowserNotification(
            `+${xpAmount} XP — ${reason}`,
            `${levelUp} | ${currentInLevel}/${neededForLevel} XP to next level`,
        );
    }
}


// --- Combined heuristic + ML analysis ---
// UPDATED: Now accepts an optional tabId so we know where to inject the warning banner
async function analyzeAndAward(url: string, tabId?: number): Promise<void> {
    if (!url || !url.startsWith("http")) return;
    if (visitedUrls.has(url)) return;
    visitedUrls.add(url);

    // Run both analyses in parallel — ML is authoritative, heuristic is fallback
    const [heuristicResult, mlResult] = await Promise.all([
        Promise.resolve(analyzeUrl(url)),             // Heuristic (always available)
        analyzeUrlWithBackend(url).catch(() => null), // Local API Backend
    ]);

    // Determine final risk level: ML wins if available
    let finalLevel: "safe" | "warning" | "danger" = heuristicResult.level;
    if (mlResult) {
        // ML overrides heuristic if it detects danger, otherwise combine
        if (mlResult.level === "danger") {
            finalLevel = "danger";
        } else if (mlResult.level === "warning" && finalLevel !== "danger") {
            finalLevel = "warning";
        }
        console.info(`[AI Hygiene] ML risk: ${mlResult.level} (${mlResult.score.toFixed(3)}), Heuristic: ${heuristicResult.level} [Hardware: ${mlResult.provider}]`);
    }

    // Send ML result to popup for display
    chrome.runtime.sendMessage({
        type: "mlRiskResult",
        level: finalLevel,
        mlScore: mlResult?.score ?? null,
        modelVersion: mlResult?.provider ?? "Local CPU/Heuristic", // Show the hardware provider in the UI!
    }).catch(() => { });

    // --- NEW: INJECT BANNER IF DANGEROUS OR WARNING ---
    if ((finalLevel === "danger" || finalLevel === "warning") && tabId) {
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: (level) => {
                // This code runs INSIDE the dangerous webpage!
                // Prevent duplicate banners from stacking up
                if (document.getElementById('ai-hygiene-warning-banner')) return;

                const banner = document.createElement('div');
                banner.id = 'ai-hygiene-warning-banner';
                banner.style.position = 'fixed';
                banner.style.top = '0';
                banner.style.left = '0';
                banner.style.width = '100%';
                banner.style.backgroundColor = level === 'danger' ? '#ef4444' : '#f59e0b';
                banner.style.color = 'white';
                banner.style.padding = '16px';
                banner.style.textAlign = 'center';
                banner.style.fontFamily = 'monospace';
                banner.style.fontSize = '18px';
                banner.style.fontWeight = 'bold';
                banner.style.zIndex = '9999999';
                banner.style.boxShadow = '0 4px 6px rgba(0,0,0,0.3)';

                const message = level === 'danger'
                    ? '🚨 AI HYGIENE ALERT: This site has been flagged as a severe phishing risk! 🚨'
                    : '⚠️ AI HYGIENE WARNING: Proceed with caution. Do not share sensitive info here. ⚠️';

                banner.innerText = message;
                document.body.prepend(banner);
            },
            args: [finalLevel]
        }).catch(err => console.error("[AI Hygiene] Could not inject banner:", err));
    }


    if (finalLevel === "danger" && currentRiskLevel !== "danger") {
        setRiskLevel("danger");
        return;
    }

    try {
        const stats = await loadStats();
        let updated: UserStats;

        if (finalLevel === "danger") {
            setRiskLevel("danger");
            return;
        } else if (finalLevel === "warning") {
            updated = await awardSafeBrowsingXp(stats);
            if (updated.safeBrowsingStreak > 1) {
                await notifyXpGain(updated, XP_REWARDS.WARNING_IGNORED, "Proceeded carefully on a risky page");
            }
        } else {
            updated = await awardSafeBrowsingXp(stats);
            await notifyXpGain(updated, XP_REWARDS.SAFE_BROWSE, "Safe browsing session recorded");
        }

        const newBadges = updated.badges.filter(
            (b, i) => b.earned && (!stats.badges[i] || !stats.badges[i].earned)
        );
        for (const badge of newBadges) {
            await showBrowserNotification(
                `Badge Earned: ${badge.name}`,
                `${badge.description}\n+${XP_REWARDS.BADGE_EARNED} XP bonus!`,
            );
        }

        setRiskLevel(finalLevel);
    } catch (e) {
        console.error("[AI Hygiene] Error analyzing page:", e);
        setRiskLevel("safe");
    }
}


// --- Tab event handlers ---
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // UPDATED: Now passing tabId to analyzeAndAward
    if (changeInfo.url && tab?.active) {
        const url = changeInfo.url;
        lastAnalyzedUrl = url;
        analyzeAndAward(url, tabId);
    } else if (changeInfo.status === "complete" && tab?.active && tab.url) {
        const url = tab.url;
        if (url !== lastAnalyzedUrl) {
            lastAnalyzedUrl = url;
            analyzeAndAward(url, tabId);
        }
    }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (tab?.url) {
            lastAnalyzedUrl = tab.url;
            const savedLevel = await loadRiskLevel();
            setRiskLevel(savedLevel);
        }
    } catch {
        setRiskLevel("safe");
    }
});


// --- Message handlers ---
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "getRiskLevel") {
        loadRiskLevel().then(level => sendResponse({ level }));
        return true;
    }

    if (message.type === "getStats") {
        loadStats().then(stats => sendResponse({ stats }));
        return true;
    }

    if (message.type === "getDashboardData") {
        loadStats().then(async (stats) => {
            const riskLevel = await loadRiskLevel();
            sendResponse({
                stats,
                riskLevel,
                levelTitle: getLevelTitle(stats.level),
                xpProgress: getXpToNextLevel(stats.xp, stats.level),
            });
        });
        return true;
    }

    if (message.type === "pageScanResult") {
        const { url, signals } = message;
        const urlAnalysis = analyzeUrl(url);
        const { level } = contentRiskFromSignals(signals, urlAnalysis);

        if (level === "danger") {
            setRiskLevel("danger");
        } else if (level === "warning") {
            setRiskLevel("warning");
        }
        sendResponse({ received: true });
        return true;
    }

    if (message.type === "panicInitiated") {
        updateStats(onPanicButtonClicked).then(updated => {
            sendResponse({ stats: updated });
        });
        return true;
    }

    if (message.type === "recoveryCompleted") {
        updateStats(onRecoveryCompleted).then(updated => {
            notifyXpGain(updated, XP_REWARDS.PANIC_RECOVERY_COMPLETE, "Recovery steps completed!");
            sendResponse({ stats: updated });
        });
        return true;
    }

    if (message.type === "dismissWarning") {
        updateStats(async (stats) => {
            let updated = await awardSafeBrowsingXp(stats);
            await notifyXpGain(updated, XP_REWARDS.WARNING_IGNORED, "Continued with caution on a warning page");
            return updated;
        }).then(updated => {
            sendResponse({ stats: updated });
        });
        return true;
    }

    return false;
});


// --- Extension install/update ---
chrome.runtime.onInstalled.addListener(async () => {
    const stats = await loadStats();
    if (!stats.createdAt) {
        await saveStats({
            ...(await import("./lib/storage")).getDefaultStats(),
            createdAt: Date.now(),
            lastUpdated: Date.now(),
        });
    }
    setRiskLevel("safe");
    visitedUrls.clear();

    await showBrowserNotification(
        "AI Hygiene Companion Activated",
        "Stay safe online! We'll help you browse securely and earn XP.",
    );
});