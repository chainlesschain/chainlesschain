/**
 * Notification command handlers for the ChainlessChain Browser Bridge.
 *
 * Covers the extension-level notification (`notification.show` via
 * chrome.notifications) and the Phase 20 page-level Web Notification API methods
 * (permission query/request + create, run in page context via executeScript).
 *
 * Extracted verbatim from background.js (Phase 1 of the split). Self-contained:
 * handlers use chrome.notifications / chrome.scripting directly.
 *
 * ESM only. chrome.* is referenced lazily inside the handler bodies.
 */

/* eslint-disable no-undef */
/* global chrome, Notification */

export async function showNotification(params) {
  const id = await chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: params.title || "ChainlessChain",
    message: params.message,
    priority: params.priority || 0,
  });
  return { id };
}

export async function getNotificationPermission(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        permission: Notification.permission,
        supported: typeof Notification !== "undefined",
      }),
    });
    return result[0]?.result || { permission: "unsupported" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function requestNotificationPermission(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        try {
          const permission = await Notification.requestPermission();
          return { permission };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || { error: "Failed to request permission" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function createNotification(tabId, title, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (t, opts) => {
        if (Notification.permission !== "granted") {
          return { error: "Notification permission not granted" };
        }
        try {
          new Notification(t, opts);
          return { success: true, title: t };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [title, options],
    });
    return result[0]?.result || { error: "Failed to create notification" };
  } catch (error) {
    return { error: error.message };
  }
}

export const notificationsHandlers = {
  "notification.show": (params) => showNotification(params),
  "notifications.getPermission": ({ tabId }) =>
    getNotificationPermission(tabId),
  "notifications.requestPermission": ({ tabId }) =>
    requestNotificationPermission(tabId),
  "notifications.create": ({ tabId, title, options }) =>
    createNotification(tabId, title, options),
};
