/**
 * Media Emulation command handlers (Phase 18) for the ChainlessChain Browser
 * Bridge.
 *
 * Emulate CSS media features via CDP Emulation.setEmulatedMedia /
 * setEmulatedVisionDeficiency: color scheme, reduced motion, forced colors,
 * vision deficiency, and clear-all.
 *
 * Extracted verbatim from background.js (Phase 1 of the split). All handlers use
 * the shared CDP helper; no module-level state.
 *
 * NB: this is the media.* EMULATION subset. The separate Phase 20 Media Devices
 * commands (media.enumerateDevices / getSupportedConstraints / getDisplayMedia)
 * are a distinct group and remain elsewhere.
 *
 * ESM only. chrome.* is referenced lazily inside the handler bodies.
 */

/* eslint-disable no-undef */
/* global chrome */

import { ensureDebuggerAttached } from "./_shared.js";

export async function emulateColorScheme(tabId, scheme) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: scheme }],
    });
    return { success: true, colorScheme: scheme };
  } catch (error) {
    return { error: error.message };
  }
}

export async function emulateReducedMotion(tabId, reduce) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Emulation.setEmulatedMedia", {
      features: [
        {
          name: "prefers-reduced-motion",
          value: reduce ? "reduce" : "no-preference",
        },
      ],
    });
    return { success: true, reducedMotion: reduce };
  } catch (error) {
    return { error: error.message };
  }
}

export async function emulateForcedColors(tabId, forced) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Emulation.setEmulatedMedia", {
      features: [{ name: "forced-colors", value: forced ? "active" : "none" }],
    });
    return { success: true, forcedColors: forced };
  } catch (error) {
    return { error: error.message };
  }
}

export async function emulateVisionDeficiency(tabId, type) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand(
      { tabId },
      "Emulation.setEmulatedVisionDeficiency",
      {
        type: type || "none", // none, achromatopsia, blurredVision, deuteranopia, protanopia, tritanopia
      },
    );
    return { success: true, visionDeficiency: type };
  } catch (error) {
    return { error: error.message };
  }
}

export async function clearMediaEmulation(tabId) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Emulation.setEmulatedMedia", {
      media: "",
      features: [],
    });
    await chrome.debugger.sendCommand(
      { tabId },
      "Emulation.setEmulatedVisionDeficiency",
      {
        type: "none",
      },
    );
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

export const mediaEmulationHandlers = {
  "media.emulateColorScheme": ({ tabId, scheme }) =>
    emulateColorScheme(tabId, scheme),
  "media.emulateReducedMotion": ({ tabId, reduce }) =>
    emulateReducedMotion(tabId, reduce),
  "media.emulateForcedColors": ({ tabId, forced }) =>
    emulateForcedColors(tabId, forced),
  "media.emulateVisionDeficiency": ({ tabId, type }) =>
    emulateVisionDeficiency(tabId, type),
  "media.clearEmulation": ({ tabId }) => clearMediaEmulation(tabId),
};
