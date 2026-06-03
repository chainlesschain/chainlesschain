/**
 * Event Listener Inspector command handlers (Phase 18) for the ChainlessChain
 * Browser Bridge.
 *
 * events.*: enumerate an element's event listeners (via CDP
 * DOMDebugger.getEventListeners), remove listeners (clone-and-replace), and
 * monitor/log live events in page context. Keeps per-tab eventMonitorState.
 *
 * Extracted verbatim from background.js (Phase 1 of the split). getEventListeners
 * uses the shared CDP helper; the rest run in page context via executeScript.
 * eventMonitorState moves with the handlers (verified no external refs).
 *
 * ESM only. chrome.* is referenced lazily inside the handler bodies.
 */

/* eslint-disable no-undef */
/* global chrome, document, window, Date, Object */

import { ensureDebuggerAttached } from "./_shared.js";

const eventMonitorState = new Map();

export async function getEventListeners(tabId, selector) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "DOM.enable");

    const doc = await chrome.debugger.sendCommand({ tabId }, "DOM.getDocument");
    const nodeResult = await chrome.debugger.sendCommand(
      { tabId },
      "DOM.querySelector",
      {
        nodeId: doc.root.nodeId,
        selector: selector,
      },
    );

    if (!nodeResult.nodeId) {
      return { error: "Element not found" };
    }

    await chrome.debugger.sendCommand({ tabId }, "DOMDebugger.enable");
    const listeners = await chrome.debugger.sendCommand(
      { tabId },
      "DOMDebugger.getEventListeners",
      {
        objectId: (
          await chrome.debugger.sendCommand({ tabId }, "DOM.resolveNode", {
            nodeId: nodeResult.nodeId,
          })
        ).object.objectId,
      },
    );

    return {
      listeners: listeners.listeners.map((l) => ({
        type: l.type,
        useCapture: l.useCapture,
        passive: l.passive,
        once: l.once,
        handler: l.handler?.description?.substring(0, 200),
        scriptId: l.scriptId,
        lineNumber: l.lineNumber,
        columnNumber: l.columnNumber,
      })),
    };
  } catch (error) {
    return { error: error.message };
  }
}

export async function removeEventListener(tabId, selector, eventType) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel, type) => {
        const el = document.querySelector(sel);
        if (!el) return { error: "Element not found" };

        // Clone and replace to remove all listeners
        const clone = el.cloneNode(true);
        el.parentNode.replaceChild(clone, el);
        return { success: true, eventType: type };
      },
      args: [selector, eventType],
    });
    return result[0]?.result || { error: "Failed to remove listener" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function startEventMonitor(tabId, selector, eventTypes = []) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel, types) => {
        window.__chainlessEventLog = [];

        const target = sel ? document.querySelector(sel) : document;
        if (sel && !target) return { error: "Target element not found" };

        const defaultTypes = [
          "click",
          "keydown",
          "keyup",
          "input",
          "change",
          "focus",
          "blur",
          "submit",
        ];
        const typesToMonitor = types.length > 0 ? types : defaultTypes;

        window.__chainlessEventHandlers = {};
        typesToMonitor.forEach((type) => {
          const handler = (event) => {
            window.__chainlessEventLog.push({
              type: event.type,
              target:
                event.target.tagName +
                (event.target.id ? `#${event.target.id}` : ""),
              timestamp: Date.now(),
              key: event.key,
              code: event.code,
              button: event.button,
              clientX: event.clientX,
              clientY: event.clientY,
              value: event.target.value?.substring?.(0, 100),
            });
            if (window.__chainlessEventLog.length > 500) {
              window.__chainlessEventLog.shift();
            }
          };
          window.__chainlessEventHandlers[type] = handler;
          target.addEventListener(type, handler, true);
        });

        return { success: true, monitoredTypes: typesToMonitor };
      },
      args: [selector, eventTypes],
    });

    eventMonitorState.set(tabId, { started: Date.now() });
    return result[0]?.result || { error: "Failed to start monitor" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function stopEventMonitor(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (window.__chainlessEventHandlers) {
          Object.entries(window.__chainlessEventHandlers).forEach(
            ([type, handler]) => {
              document.removeEventListener(type, handler, true);
            },
          );
          window.__chainlessEventHandlers = null;
        }
      },
    });
    eventMonitorState.delete(tabId);
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

export function getEventLog(tabId) {
  return chrome.scripting
    .executeScript({
      target: { tabId },
      func: () => ({
        events: window.__chainlessEventLog || [],
        count: window.__chainlessEventLog?.length || 0,
      }),
    })
    .then((result) => result[0]?.result || { events: [] });
}

export const eventsHandlers = {
  "events.getListeners": ({ tabId, selector }) =>
    getEventListeners(tabId, selector),
  "events.removeListener": ({ tabId, selector, eventType }) =>
    removeEventListener(tabId, selector, eventType),
  "events.monitorEvents": ({ tabId, selector, eventTypes }) =>
    startEventMonitor(tabId, selector, eventTypes),
  "events.stopMonitoring": ({ tabId }) => stopEventMonitor(tabId),
  "events.getLog": ({ tabId }) => getEventLog(tabId),
};
