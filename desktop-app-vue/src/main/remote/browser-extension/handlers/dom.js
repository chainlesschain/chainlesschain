/**
 * DOM command handlers for the ChainlessChain Browser Bridge.
 *
 * Two related areas:
 *  - Element Interactions (page context): hover/focus/blur, text selection,
 *    get/set attribute, bounding rect, visibility, wait-for-selector, drag&drop
 *  - DOM Mutation Observer (Phase 18): bounded page/service-worker state,
 *    start/stop observing, and get/clear mutation logs
 *
 * Extracted verbatim from background.js (Phase 1 of the split). All handlers run
 * in page context via chrome.scripting.executeScript — no CDP, no shared-layer
 * dependency. Mutation records are bounded by count and UTF-8 bytes.
 *
 * ESM only. chrome.* is referenced lazily inside the handler bodies.
 */

/* eslint-disable no-undef */
/* global chrome, document, window, MouseEvent, DragEvent, DataTransfer, MutationObserver, Date, JSON, TextEncoder, setTimeout, Promise */

import {
  ActivePageMonitorRegistry,
  MUTATION_MONITOR_LIMITS,
  validateMutationMonitorOptions,
  validatePageMonitorSelector,
} from "./page-monitor-boundary.js";

// ---------- Element Interactions ----------

export async function hoverElement(tabId, selector) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel) => {
      const element = document.querySelector(sel);
      if (!element) {
        return { error: `Element not found: ${sel}` };
      }
      const event = new MouseEvent("mouseover", {
        view: window,
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(event);
      const enterEvent = new MouseEvent("mouseenter", {
        view: window,
        bubbles: false,
        cancelable: true,
      });
      element.dispatchEvent(enterEvent);
      return { success: true };
    },
    args: [selector],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

export async function focusElement(tabId, selector) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel) => {
      const element = document.querySelector(sel);
      if (!element) {
        return { error: `Element not found: ${sel}` };
      }
      element.focus();
      return { success: true };
    },
    args: [selector],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

export async function blurElement(tabId, selector) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel) => {
      const element = document.querySelector(sel);
      if (!element) {
        return { error: `Element not found: ${sel}` };
      }
      element.blur();
      return { success: true };
    },
    args: [selector],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

export async function selectText(tabId, selector, start, end) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel, s, e) => {
      const element = document.querySelector(sel);
      if (!element) {
        return { error: `Element not found: ${sel}` };
      }
      if (element.setSelectionRange) {
        element.focus();
        const textLength = element.value ? element.value.length : 0;
        element.setSelectionRange(s || 0, e !== undefined ? e : textLength);
        return { success: true };
      }
      // For non-input elements
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return { success: true };
    },
    args: [selector, start, end],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

export async function getElementAttribute(tabId, selector, attribute) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel, attr) => {
      const element = document.querySelector(sel);
      if (!element) {
        return { error: `Element not found: ${sel}` };
      }
      return { value: element.getAttribute(attr) };
    },
    args: [selector, attribute],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

export async function setElementAttribute(tabId, selector, attribute, value) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel, attr, val) => {
      const element = document.querySelector(sel);
      if (!element) {
        return { error: `Element not found: ${sel}` };
      }
      element.setAttribute(attr, val);
      return { success: true };
    },
    args: [selector, attribute, value],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

export async function getElementBoundingRect(tabId, selector) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel) => {
      const element = document.querySelector(sel);
      if (!element) {
        return { error: `Element not found: ${sel}` };
      }
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
      };
    },
    args: [selector],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

export async function isElementVisible(tabId, selector) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel) => {
      const element = document.querySelector(sel);
      if (!element) {
        return { visible: false, reason: "not found" };
      }
      const style = window.getComputedStyle(element);
      if (style.display === "none") {
        return { visible: false, reason: "display:none" };
      }
      if (style.visibility === "hidden") {
        return { visible: false, reason: "visibility:hidden" };
      }
      if (style.opacity === "0") {
        return { visible: false, reason: "opacity:0" };
      }
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return { visible: false, reason: "zero size" };
      }
      return { visible: true };
    },
    args: [selector],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

export async function waitForSelector(tabId, selector, options = {}) {
  const timeout = options.timeout || 10000;
  const interval = options.interval || 100;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel, opts) => {
        const element = document.querySelector(sel);
        if (!element) {
          return { found: false };
        }
        if (opts.visible) {
          const style = window.getComputedStyle(element);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.opacity === "0"
          ) {
            return { found: false };
          }
        }
        return { found: true };
      },
      args: [selector, options],
    });

    if (results[0]?.result?.found) {
      return { success: true, elapsed: Date.now() - startTime };
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  return { error: `Timeout waiting for selector: ${selector}` };
}

export async function dragAndDrop(tabId, sourceSelector, targetSelector) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sourceSel, targetSel) => {
      const source = document.querySelector(sourceSel);
      const target = document.querySelector(targetSel);

      if (!source) {
        return { error: `Source element not found: ${sourceSel}` };
      }
      if (!target) {
        return { error: `Target element not found: ${targetSel}` };
      }

      const sourceRect = source.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();

      const dataTransfer = new DataTransfer();

      // Dispatch drag events
      source.dispatchEvent(
        new DragEvent("dragstart", {
          bubbles: true,
          cancelable: true,
          dataTransfer,
        }),
      );

      source.dispatchEvent(
        new DragEvent("drag", {
          bubbles: true,
          cancelable: true,
          dataTransfer,
        }),
      );

      target.dispatchEvent(
        new DragEvent("dragenter", {
          bubbles: true,
          cancelable: true,
          dataTransfer,
          clientX: targetRect.x + targetRect.width / 2,
          clientY: targetRect.y + targetRect.height / 2,
        }),
      );

      target.dispatchEvent(
        new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          dataTransfer,
          clientX: targetRect.x + targetRect.width / 2,
          clientY: targetRect.y + targetRect.height / 2,
        }),
      );

      target.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer,
          clientX: targetRect.x + targetRect.width / 2,
          clientY: targetRect.y + targetRect.height / 2,
        }),
      );

      source.dispatchEvent(
        new DragEvent("dragend", {
          bubbles: true,
          cancelable: true,
          dataTransfer,
        }),
      );

      return { success: true };
    },
    args: [sourceSelector, targetSelector],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

// ---------- DOM Mutation Observer (Phase 18) ----------

const mutationMonitors = new ActivePageMonitorRegistry({ kind: "mutation" });
let mutationMonitorTabRemovalTarget = null;

function ensureMutationMonitorTabRemovalListener() {
  const eventTarget = chrome.tabs?.onRemoved;
  if (!eventTarget || mutationMonitorTabRemovalTarget === eventTarget) {
    return;
  }
  eventTarget.addListener((tabId) => {
    mutationMonitors.clearTab(tabId);
  });
  mutationMonitorTabRemovalTarget = eventTarget;
}

export function installMutationMonitorInPage(selector, options, limits) {
  const target = selector ? document.querySelector(selector) : document.body;
  if (!target) {
    return { error: "Target element not found" };
  }
  const previous = window.__chainlessMutationMonitor;
  if (previous?.observer) {
    previous.observer.disconnect();
    previous.observer = null;
    previous.active = false;
  }

  const truncate = (value, maxChars) =>
    typeof value === "string" ? value.slice(0, maxChars) : "";
  const monitor = {
    active: true,
    observer: null,
    mutations: [],
    retainedBytes: 0,
    droppedMutations: 0,
    limits,
  };

  try {
    monitor.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const mutationTarget = mutation.target || {};
        const tagName = truncate(
          mutationTarget.tagName || mutationTarget.nodeName,
          limits.maxTargetChars,
        );
        const id = truncate(mutationTarget.id, limits.maxTargetChars);
        const entry = {
          type: truncate(mutation.type, 64),
          target: `${tagName}${id ? `#${id}` : ""}`.slice(
            0,
            limits.maxTargetChars,
          ),
          attributeName: truncate(
            mutation.attributeName,
            limits.maxAttributeChars,
          ),
          oldValue: truncate(mutation.oldValue, limits.maxOldValueChars),
          addedNodes: Number.isFinite(Number(mutation.addedNodes?.length))
            ? Number(mutation.addedNodes.length)
            : 0,
          removedNodes: Number.isFinite(Number(mutation.removedNodes?.length))
            ? Number(mutation.removedNodes.length)
            : 0,
          timestamp: Date.now(),
        };
        let bytes;
        try {
          bytes = new TextEncoder().encode(JSON.stringify(entry)).byteLength;
        } catch {
          monitor.droppedMutations += 1;
          continue;
        }
        if (bytes <= 0 || bytes > limits.maxEntryBytes) {
          monitor.droppedMutations += 1;
          continue;
        }
        while (
          monitor.mutations.length >= limits.maxEntries ||
          monitor.retainedBytes + bytes > limits.maxTotalBytes
        ) {
          const oldest = monitor.mutations.shift();
          if (!oldest) {
            monitor.droppedMutations += 1;
            break;
          }
          monitor.retainedBytes -= oldest.__bytes;
          monitor.droppedMutations += 1;
        }
        if (monitor.retainedBytes + bytes <= limits.maxTotalBytes) {
          monitor.mutations.push({ ...entry, __bytes: bytes });
          monitor.retainedBytes += bytes;
        }
      }
    });
    monitor.observer.observe(target, options);
  } catch (error) {
    monitor.observer?.disconnect();
    return { error: error.message };
  }

  window.__chainlessMutationMonitor = monitor;
  return {
    success: true,
    targetSelector: selector || "body",
    limits,
  };
}

export function stopMutationMonitorInPage() {
  const monitor = window.__chainlessMutationMonitor;
  if (monitor?.observer) {
    monitor.observer.disconnect();
    monitor.observer = null;
    monitor.active = false;
  }
  return { success: true };
}

export function readMutationMonitorInPage() {
  const monitor = window.__chainlessMutationMonitor;
  if (!monitor) {
    return {
      mutations: [],
      count: 0,
      droppedMutations: 0,
      retainedBytes: 0,
      status: "inactive",
    };
  }
  return {
    mutations: monitor.mutations.map(({ __bytes: _bytes, ...entry }) => entry),
    count: monitor.mutations.length,
    droppedMutations: monitor.droppedMutations,
    retainedBytes: monitor.retainedBytes,
    status: monitor.active ? "active" : "inactive",
    limits: monitor.limits,
  };
}

export function clearMutationMonitorInPage() {
  const monitor = window.__chainlessMutationMonitor;
  if (monitor) {
    monitor.mutations.length = 0;
    monitor.retainedBytes = 0;
    monitor.droppedMutations = 0;
  }
  return { success: true };
}

export async function startMutationObserver(tabId, selector, options = {}) {
  const selectorValidation = validatePageMonitorSelector(selector);
  if (!selectorValidation.accepted) {
    return selectorValidation;
  }
  const optionsValidation = validateMutationMonitorOptions(options);
  if (!optionsValidation.accepted) {
    return optionsValidation;
  }

  if (mutationMonitors.getControl(tabId)?.status === "active") {
    const stopped = await stopMutationObserver(tabId);
    if (!stopped.success) {
      return stopped;
    }
  }
  const admission = mutationMonitors.admit(tabId);
  if (!admission.accepted) {
    return admission;
  }
  ensureMutationMonitorTabRemovalListener();

  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: installMutationMonitorInPage,
      args: [
        selectorValidation.selector,
        optionsValidation.options,
        MUTATION_MONITOR_LIMITS,
      ],
    });
    const pageResult = result[0]?.result || {
      error: "Failed to start observer",
    };
    if (pageResult.error) {
      mutationMonitors.complete(admission.lease);
      return pageResult;
    }
    if (!mutationMonitors.markActive(admission.lease)) {
      throw new Error("Mutation monitor tab closed during startup");
    }
    return {
      ...pageResult,
      admissionLimits: mutationMonitors.getStats().limits,
    };
  } catch (error) {
    mutationMonitors.complete(admission.lease);
    return { error: error.message };
  }
}

export async function stopMutationObserver(tabId) {
  const stopAdmission = mutationMonitors.beginStop(tabId);
  if (
    !stopAdmission.accepted &&
    stopAdmission.code !== "PAGE_MONITOR_NOT_FOUND"
  ) {
    return stopAdmission;
  }
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: stopMutationMonitorInPage,
    });
    const pageResult = result[0]?.result || {
      error: "Failed to stop observer",
    };
    if (pageResult.error) {
      if (stopAdmission.accepted) {
        mutationMonitors.cancelStop(stopAdmission.lease);
      }
      return pageResult;
    }
    if (stopAdmission.accepted) {
      mutationMonitors.complete(stopAdmission.lease);
    }
    return pageResult;
  } catch (error) {
    if (stopAdmission.accepted) {
      mutationMonitors.cancelStop(stopAdmission.lease);
    }
    return { error: error.message };
  }
}

export async function getMutationLog(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: readMutationMonitorInPage,
    });
    return result[0]?.result || { mutations: [] };
  } catch (error) {
    return { error: error.message };
  }
}

export async function clearMutationLog(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: clearMutationMonitorInPage,
    });
    return result[0]?.result || { success: false };
  } catch (error) {
    return { error: error.message };
  }
}

export const domHandlers = {
  // Element Interactions
  "element.hover": ({ tabId, selector }) => hoverElement(tabId, selector),
  "element.focus": ({ tabId, selector }) => focusElement(tabId, selector),
  "element.blur": ({ tabId, selector }) => blurElement(tabId, selector),
  "element.select": ({ tabId, selector, start, end }) =>
    selectText(tabId, selector, start, end),
  "element.getAttribute": ({ tabId, selector, attribute }) =>
    getElementAttribute(tabId, selector, attribute),
  "element.setAttribute": ({ tabId, selector, attribute, value }) =>
    setElementAttribute(tabId, selector, attribute, value),
  "element.getBoundingRect": ({ tabId, selector }) =>
    getElementBoundingRect(tabId, selector),
  "element.isVisible": ({ tabId, selector }) =>
    isElementVisible(tabId, selector),
  "element.waitForSelector": ({ tabId, selector, options }) =>
    waitForSelector(tabId, selector, options),
  "element.dragDrop": ({ tabId, sourceSelector, targetSelector }) =>
    dragAndDrop(tabId, sourceSelector, targetSelector),
  // DOM Mutation Observer
  "dom.observeMutations": ({ tabId, selector, options }) =>
    startMutationObserver(tabId, selector, options),
  "dom.stopObserving": ({ tabId }) => stopMutationObserver(tabId),
  "dom.getMutations": ({ tabId }) => getMutationLog(tabId),
  "dom.clearMutations": ({ tabId }) => clearMutationLog(tabId),
};
