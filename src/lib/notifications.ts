// src/lib/notifications.ts
// Browser notification helpers.

export async function showBrowserNotification(title: string, body: string): Promise<void> {
  if (typeof chrome !== "undefined" && chrome.notifications) {
    await new Promise<void>((resolve) => {
      chrome.notifications.create({
        type: "basic",
        iconUrl: chrome.runtime.getURL("icon.png"),
        title,
        message: body,
      }, () => resolve());
    });
  } else {
    console.info(`[AI Hygiene] ${title}: ${body}`);
  }
}
