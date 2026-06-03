/**
 * Page Lifecycle command handlers (Phase 18) for the ChainlessChain Browser
 * Bridge.
 *
 * lifecycle.*: read the page's lifecycle/visibility state, subscribe to
 * lifecycle change events (page context), and freeze/resume the page via CDP
 * Page.setWebLifecycleState.
 *
 * Extracted verbatim from background.js (Phase 1 of the split). freeze/resume
 * use the shared CDP helper; getState/onStateChange run in page context. No
 * module-level state.
 *
 * ESM only. chrome.* is referenced lazily inside the handler bodies.
 */

/* eslint-disable no-undef */
/* global chrome, document, window, Date */

import { ensureDebuggerAttached } from "./_shared.js";

export async function getPageLifecycleState(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        visibilityState: document.visibilityState,
        hidden: document.hidden,
        hasFocus: document.hasFocus(),
        readyState: document.readyState,
        wasDiscarded: document.wasDiscarded || false,
      }),
    });
    return result[0]?.result || { error: "Failed to get lifecycle state" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function subscribeLifecycleChanges(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        window.__chainlessLifecycleLog = [];

        const logChange = (type, data) => {
          window.__chainlessLifecycleLog.push({
            type,
            timestamp: Date.now(),
            ...data,
          });
        };

        document.addEventListener("visibilitychange", () => {
          logChange("visibilitychange", {
            visibilityState: document.visibilityState,
          });
        });

        window.addEventListener("focus", () => logChange("focus", {}));
        window.addEventListener("blur", () => logChange("blur", {}));
        window.addEventListener("freeze", () => logChange("freeze", {}));
        window.addEventListener("resume", () => logChange("resume", {}));
        window.addEventListener("pageshow", (e) =>
          logChange("pageshow", { persisted: e.persisted }),
        );
        window.addEventListener("pagehide", (e) =>
          logChange("pagehide", { persisted: e.persisted }),
        );

        return { success: true };
      },
    });
    return result[0]?.result || { error: "Failed to subscribe" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function freezePage(tabId) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Page.setWebLifecycleState", {
      state: "frozen",
    });
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

export async function resumePage(tabId) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Page.setWebLifecycleState", {
      state: "active",
    });
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

export const lifecycleHandlers = {
  "lifecycle.getState": ({ tabId }) => getPageLifecycleState(tabId),
  "lifecycle.onStateChange": ({ tabId }) => subscribeLifecycleChanges(tabId),
  "lifecycle.freeze": ({ tabId }) => freezePage(tabId),
  "lifecycle.resume": ({ tabId }) => resumePage(tabId),
};
