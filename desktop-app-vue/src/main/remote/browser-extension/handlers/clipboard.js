/**
 * Clipboard command handlers for the ChainlessChain Browser Bridge.
 *
 * Covers the basic clipboard (read/write plain text via the active tab) and the
 * Phase 19 "Advanced Clipboard" methods (rich read/write, format enumeration,
 * image write) which operate on an explicit tabId.
 *
 * Extracted verbatim from background.js (Phase 1 of the split). These handlers
 * inline `chrome.scripting.executeScript` with their own page-context functions,
 * so they have no dependency on the shared inject layer.
 *
 * ESM only. chrome.* is referenced lazily inside the handler bodies.
 */

/* eslint-disable no-undef */
/* global chrome */

export async function readClipboard() {
  // Use content script to read clipboard
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    return { text: null, error: "No active tab" };
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async () => {
      try {
        return await navigator.clipboard.readText();
      } catch {
        return null;
      }
    },
  });

  return { text: results[0]?.result };
}

export async function writeClipboard(text) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    return { success: false, error: "No active tab" };
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async (t) => {
      await navigator.clipboard.writeText(t);
    },
    args: [text],
  });

  return { success: true };
}

export async function readRichClipboard(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        try {
          const items = await navigator.clipboard.read();
          const contents = [];

          for (const item of items) {
            for (const type of item.types) {
              const blob = await item.getType(type);
              if (type.startsWith("text/")) {
                const text = await blob.text();
                contents.push({ type, content: text.substring(0, 10000) });
              } else if (type.startsWith("image/")) {
                const arrayBuffer = await blob.arrayBuffer();
                const base64 = btoa(
                  String.fromCharCode(...new Uint8Array(arrayBuffer)),
                );
                contents.push({
                  type,
                  content: base64.substring(0, 1000) + "...",
                  size: blob.size,
                });
              } else {
                contents.push({ type, size: blob.size });
              }
            }
          }

          return { contents };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || { error: "Failed to read clipboard" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function writeRichClipboard(tabId, data) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (clipData) => {
        try {
          const items = {};

          if (clipData.text) {
            items["text/plain"] = new Blob([clipData.text], {
              type: "text/plain",
            });
          }
          if (clipData.html) {
            items["text/html"] = new Blob([clipData.html], {
              type: "text/html",
            });
          }

          const clipboardItem = new ClipboardItem(items);
          await navigator.clipboard.write([clipboardItem]);
          return { success: true };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [data],
    });
    return result[0]?.result || { error: "Failed to write clipboard" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getClipboardFormats(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        try {
          const items = await navigator.clipboard.read();
          const formats = [];
          for (const item of items) {
            formats.push(...item.types);
          }
          return { formats };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || { formats: [] };
  } catch (error) {
    return { error: error.message };
  }
}

export async function writeImageToClipboard(tabId, imageData) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (imgData) => {
        try {
          // Convert base64 to blob
          const response = await fetch(`data:image/png;base64,${imgData}`);
          const blob = await response.blob();
          const clipboardItem = new ClipboardItem({ "image/png": blob });
          await navigator.clipboard.write([clipboardItem]);
          return { success: true };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [imageData],
    });
    return result[0]?.result || { error: "Failed to write image" };
  } catch (error) {
    return { error: error.message };
  }
}

export const clipboardHandlers = {
  "clipboard.read": () => readClipboard(),
  "clipboard.write": ({ text }) => writeClipboard(text),
  "clipboard.readRich": ({ tabId }) => readRichClipboard(tabId),
  "clipboard.writeRich": ({ tabId, data }) => writeRichClipboard(tabId, data),
  "clipboard.getFormats": ({ tabId }) => getClipboardFormats(tabId),
  "clipboard.writeImage": ({ tabId, imageData }) =>
    writeImageToClipboard(tabId, imageData),
};
