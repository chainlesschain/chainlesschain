/**
 * Event Listener Inspector command handlers (Phase 18) for the ChainlessChain
 * Browser Bridge.
 *
 * events.*: enumerate an element's event listeners (via CDP
 * DOMDebugger.getEventListeners), remove listeners (clone-and-replace), and
 * monitor/log live events in page context with bounded page and service-worker
 * state.
 *
 * Extracted verbatim from background.js (Phase 1 of the split). getEventListeners
 * uses the shared CDP helper; the rest run in page context via executeScript.
 * Monitor admission and page logs are bounded by tabs, count, and UTF-8 bytes.
 *
 * ESM only. chrome.* is referenced lazily inside the handler bodies.
 */

/* eslint-disable no-undef */
/* global chrome, document, window, Date, JSON, TextEncoder, Array */

import { ensureDebuggerAttached } from "./_shared.js";
import {
  ActivePageMonitorRegistry,
  EVENT_MONITOR_LIMITS,
  validateEventMonitorTypes,
  validatePageMonitorSelector,
} from "./page-monitor-boundary.js";

const eventMonitors = new ActivePageMonitorRegistry({ kind: "event" });
let eventMonitorTabRemovalTarget = null;

function ensureEventMonitorTabRemovalListener() {
  const eventTarget = chrome.tabs?.onRemoved;
  if (!eventTarget || eventMonitorTabRemovalTarget === eventTarget) {
    return;
  }
  eventTarget.addListener((tabId) => {
    eventMonitors.clearTab(tabId);
  });
  eventMonitorTabRemovalTarget = eventTarget;
}

export async function getEventListeners(tabId, selector) {
  const selectorValidation = validatePageMonitorSelector(selector);
  if (!selectorValidation.accepted || !selectorValidation.selector) {
    return selectorValidation.accepted
      ? {
          accepted: false,
          error: "Event listener selector must be a non-empty string",
          code: "INVALID_ARGUMENT",
        }
      : selectorValidation;
  }
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "DOM.enable");

    const doc = await chrome.debugger.sendCommand({ tabId }, "DOM.getDocument");
    const nodeResult = await chrome.debugger.sendCommand(
      { tabId },
      "DOM.querySelector",
      {
        nodeId: doc.root.nodeId,
        selector: selectorValidation.selector,
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

    const rawListeners = Array.isArray(listeners.listeners)
      ? listeners.listeners
      : [];
    const retainedListeners = rawListeners.slice(
      0,
      EVENT_MONITOR_LIMITS.maxReturnedListeners,
    );
    return {
      listeners: retainedListeners.map((l) => ({
        type: typeof l.type === "string" ? l.type.slice(0, 64) : "",
        useCapture: l.useCapture,
        passive: l.passive,
        once: l.once,
        handler: l.handler?.description?.substring(0, 200),
        scriptId:
          typeof l.scriptId === "string" ? l.scriptId.slice(0, 256) : "",
        lineNumber: l.lineNumber,
        columnNumber: l.columnNumber,
      })),
      totalListeners: rawListeners.length,
      truncated: rawListeners.length > retainedListeners.length,
      limits: EVENT_MONITOR_LIMITS,
    };
  } catch (error) {
    return { error: error.message };
  }
}

export async function removeEventListener(tabId, selector, eventType) {
  const selectorValidation = validatePageMonitorSelector(selector);
  if (!selectorValidation.accepted || !selectorValidation.selector) {
    return selectorValidation.accepted
      ? {
          accepted: false,
          error: "Event listener selector must be a non-empty string",
          code: "INVALID_ARGUMENT",
        }
      : selectorValidation;
  }
  const typeValidation = validateEventMonitorTypes([eventType]);
  if (!typeValidation.accepted) {
    return typeValidation;
  }
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
      args: [selectorValidation.selector, typeValidation.eventTypes[0]],
    });
    return result[0]?.result || { error: "Failed to remove listener" };
  } catch (error) {
    return { error: error.message };
  }
}

export function installEventMonitorInPage(selector, eventTypes, limits) {
  const target = selector ? document.querySelector(selector) : document;
  if (!target) {
    return { error: "Target element not found" };
  }

  const previous = window.__chainlessEventMonitor;
  if (previous?.target && Array.isArray(previous.handlers)) {
    for (const [type, handler] of previous.handlers) {
      previous.target.removeEventListener(type, handler, true);
    }
    previous.handlers = [];
    previous.target = null;
    previous.active = false;
  }

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
  const typesToMonitor = eventTypes.length > 0 ? eventTypes : defaultTypes;
  const monitor = {
    active: true,
    target,
    handlers: [],
    events: [],
    retainedBytes: 0,
    droppedEvents: 0,
    limits,
  };
  const truncate = (value, maxChars) => {
    if (typeof value === "string") {
      return value.slice(0, maxChars);
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value).slice(0, maxChars);
    }
    return "";
  };

  try {
    for (const type of typesToMonitor) {
      const handler = (event) => {
        const eventTarget = event.target || {};
        const tagName = truncate(
          eventTarget.tagName || eventTarget.nodeName,
          limits.maxTargetChars,
        );
        const id = truncate(eventTarget.id, limits.maxTargetChars);
        const inputType = truncate(eventTarget.type, 32).toLowerCase();
        let value = "";
        try {
          value =
            inputType === "password"
              ? "[REDACTED]"
              : truncate(eventTarget.value, limits.maxValueChars);
        } catch {
          value = "";
        }
        const entry = {
          type: truncate(event.type, limits.maxKeyChars),
          target: `${tagName}${id ? `#${id}` : ""}`.slice(
            0,
            limits.maxTargetChars,
          ),
          timestamp: Date.now(),
          key: truncate(event.key, limits.maxKeyChars),
          code: truncate(event.code, limits.maxKeyChars),
          button: Number.isFinite(Number(event.button))
            ? Number(event.button)
            : undefined,
          clientX: Number.isFinite(Number(event.clientX))
            ? Number(event.clientX)
            : undefined,
          clientY: Number.isFinite(Number(event.clientY))
            ? Number(event.clientY)
            : undefined,
          value,
        };
        let bytes;
        try {
          bytes = new TextEncoder().encode(JSON.stringify(entry)).byteLength;
        } catch {
          monitor.droppedEvents += 1;
          return;
        }
        if (bytes <= 0 || bytes > limits.maxEntryBytes) {
          monitor.droppedEvents += 1;
          return;
        }
        while (
          monitor.events.length >= limits.maxEntries ||
          monitor.retainedBytes + bytes > limits.maxTotalBytes
        ) {
          const oldest = monitor.events.shift();
          if (!oldest) {
            monitor.droppedEvents += 1;
            return;
          }
          monitor.retainedBytes -= oldest.__bytes;
          monitor.droppedEvents += 1;
        }
        monitor.events.push({ ...entry, __bytes: bytes });
        monitor.retainedBytes += bytes;
      };
      monitor.handlers.push([type, handler]);
      target.addEventListener(type, handler, true);
    }
  } catch (error) {
    for (const [type, handler] of monitor.handlers) {
      target.removeEventListener(type, handler, true);
    }
    return { error: error.message };
  }

  window.__chainlessEventMonitor = monitor;
  return { success: true, monitoredTypes: typesToMonitor, limits };
}

export function stopEventMonitorInPage() {
  const monitor = window.__chainlessEventMonitor;
  if (monitor?.target && Array.isArray(monitor.handlers)) {
    for (const [type, handler] of monitor.handlers) {
      monitor.target.removeEventListener(type, handler, true);
    }
    monitor.handlers = [];
    monitor.target = null;
    monitor.active = false;
  }
  return { success: true };
}

export function readEventMonitorInPage() {
  const monitor = window.__chainlessEventMonitor;
  if (!monitor) {
    return {
      events: [],
      count: 0,
      droppedEvents: 0,
      retainedBytes: 0,
      status: "inactive",
    };
  }
  return {
    events: monitor.events.map(({ __bytes: _bytes, ...entry }) => entry),
    count: monitor.events.length,
    droppedEvents: monitor.droppedEvents,
    retainedBytes: monitor.retainedBytes,
    status: monitor.active ? "active" : "inactive",
    limits: monitor.limits,
  };
}

export async function startEventMonitor(tabId, selector, eventTypes = []) {
  const selectorValidation = validatePageMonitorSelector(selector);
  if (!selectorValidation.accepted) {
    return selectorValidation;
  }
  const typeValidation = validateEventMonitorTypes(eventTypes);
  if (!typeValidation.accepted) {
    return typeValidation;
  }

  if (eventMonitors.getControl(tabId)?.status === "active") {
    const stopped = await stopEventMonitor(tabId);
    if (!stopped.success) {
      return stopped;
    }
  }
  const admission = eventMonitors.admit(tabId);
  if (!admission.accepted) {
    return admission;
  }
  ensureEventMonitorTabRemovalListener();

  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: installEventMonitorInPage,
      args: [
        selectorValidation.selector,
        typeValidation.eventTypes,
        EVENT_MONITOR_LIMITS,
      ],
    });
    const pageResult = result[0]?.result || {
      error: "Failed to start monitor",
    };
    if (pageResult.error) {
      eventMonitors.complete(admission.lease);
      return pageResult;
    }
    if (!eventMonitors.markActive(admission.lease)) {
      throw new Error("Event monitor tab closed during startup");
    }
    return {
      ...pageResult,
      admissionLimits: eventMonitors.getStats().limits,
    };
  } catch (error) {
    eventMonitors.complete(admission.lease);
    return { error: error.message };
  }
}

export async function stopEventMonitor(tabId) {
  const stopAdmission = eventMonitors.beginStop(tabId);
  if (
    !stopAdmission.accepted &&
    stopAdmission.code !== "PAGE_MONITOR_NOT_FOUND"
  ) {
    return stopAdmission;
  }
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: stopEventMonitorInPage,
    });
    const pageResult = result[0]?.result || { error: "Failed to stop monitor" };
    if (pageResult.error) {
      if (stopAdmission.accepted) {
        eventMonitors.cancelStop(stopAdmission.lease);
      }
      return pageResult;
    }
    if (stopAdmission.accepted) {
      eventMonitors.complete(stopAdmission.lease);
    }
    return pageResult;
  } catch (error) {
    if (stopAdmission.accepted) {
      eventMonitors.cancelStop(stopAdmission.lease);
    }
    return { error: error.message };
  }
}

export async function getEventLog(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: readEventMonitorInPage,
    });
    return result[0]?.result || { events: [] };
  } catch (error) {
    return { error: error.message };
  }
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
