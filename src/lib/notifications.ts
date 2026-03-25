// Badge notification system using Chrome's offscreen document API
// Creates a small notification overlay shown to the user

const OFFSCREEN_DOC_PATH = "offscreen.html";

export async function showBadgeNotification(badgeName: string, badgeDescription: string, xpEarned: number): Promise<void> {
    // Check if offscreen doc exists, create if needed
    const hasOffscreen = await chrome.offscreen.hasDocument?.();
    if (!hasOffscreen) {
        await chrome.offscreen.createDocument({
            url: OFFSCREEN_DOC_PATH,
            reasons: ["NOTIFICATION"],
            justification: "Show badge earned notifications",
        }).catch(() => {
            // May fail if already exists, that's ok
        });
    }

    // Send notification data to the offscreen doc
    try {
        chrome.runtime.sendMessage({
            type: "showBadgeNotification",
            badgeName,
            badgeDescription,
            xpEarned,
        });
    } catch {
        // Fallback: just use a browser notification
        await showBrowserNotification(
            `Badge Earned: ${badgeName}`,
            `${badgeDescription}\n+${xpEarned} XP`,
        );
    }
}

export async function showBrowserNotification(title: string, body: string): Promise<void> {
    // Use chrome.notifications API (available in service worker / background context)
    if (typeof chrome !== "undefined" && chrome.notifications) {
        await new Promise<void>((resolve) => {
            chrome.notifications.create(
                {
                    type: "basic",
                    iconUrl: chrome.runtime.getURL("icon.png"),
                    title,
                    message: body,
                },
                () => resolve()
            );
        });
    } else {
        console.info(`[AI Hygiene] ${title}: ${body}`);
    }
}

export async function requestNotificationPermission(): Promise<boolean> {
    if ("Notification" in window && Notification.permission === "default") {
        const permission = await Notification.requestPermission();
        return permission === "granted";
    }
    return Notification.permission === "granted";
}
