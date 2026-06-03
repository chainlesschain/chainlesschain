/**
 * Font command handlers for the ChainlessChain Browser Bridge.
 *
 * Covers the full fonts.* namespace across two source sections:
 *  - Font Inspector (Phase 18): used fonts, computed font of an element,
 *    font availability check (document.fonts.check)
 *  - Local Font Access API (Phase 24): query local fonts, postscript names,
 *    support check (window.queryLocalFonts)
 *
 * Extracted verbatim from background.js (Phase 1 of the split). All handlers run
 * in page context via chrome.scripting.executeScript — no CDP, no shared-layer
 * dependency, no module-level state.
 *
 * ESM only. chrome.* is referenced lazily inside the handler bodies.
 */

/* eslint-disable no-undef */
/* global chrome, document, getComputedStyle, window, Set */

// ---------- Font Inspector (Phase 18) ----------

export async function getUsedFonts(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const fonts = new Set();
        const elements = document.querySelectorAll("*");

        elements.forEach((el) => {
          const style = getComputedStyle(el);
          const fontFamily = style.fontFamily;
          if (fontFamily) {
            fontFamily.split(",").forEach((font) => {
              fonts.add(font.trim().replace(/['"]/g, ""));
            });
          }
        });

        return {
          fonts: Array.from(fonts),
          count: fonts.size,
        };
      },
    });
    return result[0]?.result || { fonts: [] };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getComputedFonts(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const el = document.querySelector(sel);
        if (!el) return { error: "Element not found" };

        const style = getComputedStyle(el);
        return {
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          fontStyle: style.fontStyle,
          fontVariant: style.fontVariant,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          textTransform: style.textTransform,
          fontFeatureSettings: style.fontFeatureSettings,
        };
      },
      args: [selector],
    });
    return result[0]?.result || { error: "Failed to get fonts" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function checkFontAvailability(tabId, fontFamily) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (family) => {
        try {
          const available = await document.fonts.check(`16px "${family}"`);
          const loaded = document.fonts.check(`16px "${family}"`);
          return { fontFamily: family, available, loaded };
        } catch {
          return {
            fontFamily: family,
            available: false,
            error: "Font check failed",
          };
        }
      },
      args: [fontFamily],
    });
    return result[0]?.result || { error: "Failed to check font" };
  } catch (error) {
    return { error: error.message };
  }
}

// ---------- Local Font Access API (Phase 24) ----------

export async function queryLocalFonts(tabId, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (opts) => {
        if (!window.queryLocalFonts) {
          return { error: "Local Font Access API not supported" };
        }
        try {
          const fonts = await window.queryLocalFonts(opts);
          return {
            fonts: fonts.slice(0, 100).map((f) => ({
              family: f.family,
              fullName: f.fullName,
              postscriptName: f.postscriptName,
              style: f.style,
            })),
            total: fonts.length,
          };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [options],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export async function getFontPostscriptNames(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (!window.queryLocalFonts) {
          return { error: "Local Font Access API not supported" };
        }
        try {
          const fonts = await window.queryLocalFonts();
          const names = [...new Set(fonts.map((f) => f.postscriptName))];
          return { names: names.slice(0, 200), total: names.length };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export async function isLocalFontsSupported(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return { supported: !!window.queryLocalFonts };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export const fontsHandlers = {
  // Font Inspector
  "fonts.getUsed": ({ tabId }) => getUsedFonts(tabId),
  "fonts.getComputed": ({ tabId, selector }) =>
    getComputedFonts(tabId, selector),
  "fonts.checkAvailability": ({ tabId, fontFamily }) =>
    checkFontAvailability(tabId, fontFamily),
  // Local Font Access API
  "fonts.query": ({ tabId, options }) => queryLocalFonts(tabId, options),
  "fonts.getPostscriptNames": ({ tabId }) => getFontPostscriptNames(tabId),
  "fonts.isSupported": ({ tabId }) => isLocalFontsSupported(tabId),
};
