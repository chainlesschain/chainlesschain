/**
 * Selection & Range + Drag and Drop command handlers (Phase 22) for the
 * ChainlessChain Browser Bridge.
 *
 *  - Drag and Drop (dragdrop.*): simulate drag, simulate file drop, enumerate
 *    drop zones / draggable elements
 *  - Selection & Range (selection.*): get/set/clear text selection, select all,
 *    get selected HTML
 *
 * Extracted verbatim from background.js (Phase 1 of the split). All handlers run
 * in page context via chrome.scripting.executeScript — no CDP, no shared-layer
 * dependency, no module-level state.
 *
 * NB: this dragdrop.* domain is distinct from element.dragDrop (in dom.js).
 *
 * ESM only. chrome.* is referenced lazily inside the handler bodies.
 */

/* eslint-disable no-undef */
/* global chrome, document, window, DataTransfer, DragEvent, File, Math */

// ---------- Drag and Drop ----------

export async function simulateDrag(tabId, sourceSelector, targetSelector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (source, target) => {
        const sourceEl = document.querySelector(source);
        const targetEl = document.querySelector(target);

        if (!sourceEl) return { error: "Source element not found" };
        if (!targetEl) return { error: "Target element not found" };

        const dataTransfer = new DataTransfer();

        // Dispatch drag events
        sourceEl.dispatchEvent(
          new DragEvent("dragstart", { bubbles: true, dataTransfer }),
        );
        targetEl.dispatchEvent(
          new DragEvent("dragenter", { bubbles: true, dataTransfer }),
        );
        targetEl.dispatchEvent(
          new DragEvent("dragover", { bubbles: true, dataTransfer }),
        );
        targetEl.dispatchEvent(
          new DragEvent("drop", { bubbles: true, dataTransfer }),
        );
        sourceEl.dispatchEvent(
          new DragEvent("dragend", { bubbles: true, dataTransfer }),
        );

        return { success: true };
      },
      args: [sourceSelector, targetSelector],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export async function simulateFileDrop(tabId, selector, files) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel, fileData) => {
        const element = document.querySelector(sel);
        if (!element) return { error: "Element not found" };

        const dataTransfer = new DataTransfer();

        // Create mock files
        fileData.forEach((f) => {
          const file = new File([f.content || ""], f.name, {
            type: f.type || "text/plain",
          });
          dataTransfer.items.add(file);
        });

        element.dispatchEvent(
          new DragEvent("dragenter", { bubbles: true, dataTransfer }),
        );
        element.dispatchEvent(
          new DragEvent("dragover", { bubbles: true, dataTransfer }),
        );
        element.dispatchEvent(
          new DragEvent("drop", { bubbles: true, dataTransfer }),
        );

        return { success: true, filesDropped: fileData.length };
      },
      args: [selector, files],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export async function getDropZones(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const elements = document.querySelectorAll("*");
        const dropZones = [];

        elements.forEach((el) => {
          // Check for dragover or drop event handlers
          const events = el.ondragover || el.ondrop;
          const attr = el.getAttribute("dropzone");

          if (events || attr) {
            dropZones.push({
              tagName: el.tagName.toLowerCase(),
              id: el.id || null,
              className: el.className || null,
              dropzoneAttr: attr,
            });
          }
        });

        return dropZones;
      },
    });
    return { dropZones: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getDraggableElements(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const elements = document.querySelectorAll("[draggable='true']");
        return Array.from(elements)
          .slice(0, 100)
          .map((el) => ({
            tagName: el.tagName.toLowerCase(),
            id: el.id || null,
            className: el.className || null,
            textContent: el.textContent?.slice(0, 50),
          }));
      },
    });
    return { elements: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

// ---------- Selection & Range ----------

export async function getTextSelection(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
          return { hasSelection: false };
        }

        const range = selection.getRangeAt(0);
        return {
          hasSelection: true,
          text: selection.toString(),
          rangeCount: selection.rangeCount,
          isCollapsed: selection.isCollapsed,
          startContainer: range.startContainer.nodeName,
          startOffset: range.startOffset,
          endContainer: range.endContainer.nodeName,
          endOffset: range.endOffset,
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export async function setTextSelection(tabId, selector, start, end) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel, s, e) => {
        const element = document.querySelector(sel);
        if (!element) return { error: "Element not found" };

        if (element.setSelectionRange) {
          // Input/textarea
          element.focus();
          element.setSelectionRange(s, e);
          return { success: true };
        } else {
          // Regular element
          const range = document.createRange();
          const textNode = element.firstChild;
          if (!textNode) return { error: "No text content" };

          range.setStart(textNode, Math.min(s, textNode.length));
          range.setEnd(textNode, Math.min(e, textNode.length));

          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          return { success: true };
        }
      },
      args: [selector, start, end],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export async function selectAllText(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const element = sel ? document.querySelector(sel) : document.body;
        if (!element) return { error: "Element not found" };

        const range = document.createRange();
        range.selectNodeContents(element);

        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        return {
          success: true,
          selectedText: selection.toString().slice(0, 100),
        };
      },
      args: [selector],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export async function clearSelection(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        window.getSelection().removeAllRanges();
        return { success: true };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export async function getSelectedHTML(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
          return { html: "" };
        }

        const range = selection.getRangeAt(0);
        const div = document.createElement("div");
        div.appendChild(range.cloneContents());
        return { html: div.innerHTML };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export const selectionDragdropHandlers = {
  // Drag and Drop
  "dragdrop.simulateDrag": ({ tabId, sourceSelector, targetSelector }) =>
    simulateDrag(tabId, sourceSelector, targetSelector),
  "dragdrop.simulateFileDrop": ({ tabId, selector, files }) =>
    simulateFileDrop(tabId, selector, files),
  "dragdrop.getDropZones": ({ tabId }) => getDropZones(tabId),
  "dragdrop.getDraggableElements": ({ tabId }) => getDraggableElements(tabId),
  // Selection & Range
  "selection.getSelection": ({ tabId }) => getTextSelection(tabId),
  "selection.setSelection": ({ tabId, selector, start, end }) =>
    setTextSelection(tabId, selector, start, end),
  "selection.selectAll": ({ tabId, selector }) =>
    selectAllText(tabId, selector),
  "selection.clearSelection": ({ tabId }) => clearSelection(tabId),
  "selection.getSelectedHTML": ({ tabId }) => getSelectedHTML(tabId),
};
