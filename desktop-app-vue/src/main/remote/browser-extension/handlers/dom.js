/**
 * DOM command handlers for the ChainlessChain Browser Bridge.
 *
 * Two related areas:
 *  - Element Interactions (page context): hover/focus/blur, text selection,
 *    get/set attribute, bounding rect, visibility, wait-for-selector, drag&drop
 *  - DOM Mutation Observer (Phase 18, page context + per-tab mutationState):
 *    start/stop observing, get/clear the mutation log
 *
 * Extracted verbatim from background.js (Phase 1 of the split). All handlers run
 * in page context via chrome.scripting.executeScript — no CDP, no shared-layer
 * dependency. mutationState moves with the observer handlers (verified no
 * external refs).
 *
 * ESM only. chrome.* is referenced lazily inside the handler bodies.
 */

/* eslint-disable no-undef */
/* global chrome, document, window, MouseEvent, DragEvent, DataTransfer, MutationObserver, Date, setTimeout, Promise */

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

const mutationState = new Map();

export async function startMutationObserver(tabId, selector, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel, opts) => {
        // Clean up existing observer
        if (window.__chainlessMutationObserver) {
          window.__chainlessMutationObserver.disconnect();
        }
        window.__chainlessMutationLog = [];

        const target = sel ? document.querySelector(sel) : document.body;
        if (!target) return { error: "Target element not found" };

        const config = {
          attributes: opts.attributes !== false,
          childList: opts.childList !== false,
          subtree: opts.subtree !== false,
          characterData: opts.characterData || false,
          attributeOldValue: opts.attributeOldValue || false,
          characterDataOldValue: opts.characterDataOldValue || false,
        };

        window.__chainlessMutationObserver = new MutationObserver(
          (mutations) => {
            mutations.forEach((mutation) => {
              window.__chainlessMutationLog.push({
                type: mutation.type,
                target:
                  mutation.target.tagName +
                  (mutation.target.id ? `#${mutation.target.id}` : ""),
                attributeName: mutation.attributeName,
                oldValue: mutation.oldValue,
                addedNodes: mutation.addedNodes.length,
                removedNodes: mutation.removedNodes.length,
                timestamp: Date.now(),
              });
              // Keep log size manageable
              if (window.__chainlessMutationLog.length > 1000) {
                window.__chainlessMutationLog.shift();
              }
            });
          },
        );

        window.__chainlessMutationObserver.observe(target, config);
        return { success: true, targetSelector: sel || "body" };
      },
      args: [selector, options],
    });

    mutationState.set(tabId, { started: Date.now(), selector });
    return result[0]?.result || { error: "Failed to start observer" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function stopMutationObserver(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (window.__chainlessMutationObserver) {
          window.__chainlessMutationObserver.disconnect();
          window.__chainlessMutationObserver = null;
        }
      },
    });
    mutationState.delete(tabId);
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

export function getMutationLog(tabId) {
  return chrome.scripting
    .executeScript({
      target: { tabId },
      func: () => {
        return {
          mutations: window.__chainlessMutationLog || [],
          count: window.__chainlessMutationLog?.length || 0,
        };
      },
    })
    .then((result) => result[0]?.result || { mutations: [] });
}

export function clearMutationLog(tabId) {
  return chrome.scripting
    .executeScript({
      target: { tabId },
      func: () => {
        window.__chainlessMutationLog = [];
        return { success: true };
      },
    })
    .then((result) => result[0]?.result || { success: false });
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
