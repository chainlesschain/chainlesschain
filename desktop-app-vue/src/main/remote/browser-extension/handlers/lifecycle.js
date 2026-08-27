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

export const MAX_LIFECYCLE_LOG_ENTRIES = 256;

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
      func: (maxEntries) => {
        if (window.__chainlessLifecycleHandlers) {
          window.__chainlessLifecycleHandlers.forEach(
            ({ target, type, handler }) => {
              target.removeEventListener(type, handler);
            },
          );
        }

        window.__chainlessLifecycleLog = [];
        window.__chainlessLifecycleDropped = 0;
        window.__chainlessLifecycleHandlers = [];

        const logChange = (type, data) => {
          if (window.__chainlessLifecycleLog.length >= maxEntries) {
            window.__chainlessLifecycleLog.shift();
            window.__chainlessLifecycleDropped += 1;
          }
          window.__chainlessLifecycleLog.push({
            type,
            timestamp: Date.now(),
            ...data,
          });
        };

        const subscribe = (target, type, handler) => {
          target.addEventListener(type, handler);
          window.__chainlessLifecycleHandlers.push({ target, type, handler });
        };

        subscribe(document, "visibilitychange", () => {
          logChange("visibilitychange", {
            visibilityState: document.visibilityState,
          });
        });

        subscribe(window, "focus", () => logChange("focus", {}));
        subscribe(window, "blur", () => logChange("blur", {}));
        subscribe(window, "freeze", () => logChange("freeze", {}));
        subscribe(window, "resume", () => logChange("resume", {}));
        subscribe(window, "pageshow", (e) =>
          logChange("pageshow", { persisted: e.persisted }),
        );
        subscribe(window, "pagehide", (e) =>
          logChange("pagehide", { persisted: e.persisted }),
        );

        return { success: true, maxEntries };
      },
      args: [MAX_LIFECYCLE_LOG_ENTRIES],
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
