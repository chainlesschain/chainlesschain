/**
 * Shared low-level primitives for the ChainlessChain Browser Bridge background
 * service worker.
 *
 * These helpers are the foundation that almost every command handler depends on:
 *  - `executeScript` is invoked from ~390 call sites across background.js
 *  - `ensureDebuggerAttached` backs every Chrome DevTools Protocol (CDP) handler
 *
 * They were extracted out of the 15k-line background.js (Phase 0 of the split)
 * so that per-domain handler modules can `import` them instead of relying on
 * function-hoisting within one giant file. The bodies are moved verbatim — this
 * is a pure mechanical extraction with no behavior change, EXCEPT that the two
 * previously-shadowed `captureScreenshot` definitions are collapsed into the one
 * that actually executed (the CDP-based variant, which hoisting let win).
 *
 * ESM only (manifest `"type": "module"`). chrome.* is referenced lazily inside
 * the function bodies, so importing this file in a non-extension context (e.g. a
 * vitest smoke test) does not require a `chrome` global.
 */

/* eslint-disable no-undef */
/* global chrome */

/**
 * Execute an arbitrary script string in the page context of a tab.
 *
 * SECURITY-EXCEPTION: Dynamic code execution is INTENTIONAL here.
 * This is a browser automation feature that executes scripts from the trusted
 * ChainlessChain Desktop app only. Security is enforced by:
 * 1. WebSocket connection is localhost-only (127.0.0.1:18790)
 * 2. No external network access to this endpoint
 * 3. User must explicitly install and enable the extension
 * 4. All commands are logged and auditable
 */
export async function executeScript(tabId, script) {
  // security-scanner-ignore: new-function
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (code) => {
      // eslint-disable-next-line no-new-func
      const fn = new Function(code); // NOSONAR SECURITY-EXCEPTION
      return fn();
    },
    args: [script],
  });
  return { result: results[0]?.result };
}

/**
 * Same as `executeScript`, but scoped to a specific frame within the tab.
 */
export async function executeScriptInFrame(tabId, frameId, script) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: (code) => {
        // eslint-disable-next-line no-new-func
        const fn = new Function(code); // NOSONAR - intentional for automation
        return fn();
      },
      args: [script],
    });
    return { result: results[0]?.result };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Ensure the DevTools Protocol debugger is attached to a tab. Idempotent:
 * an "already attached" error is treated as success. Every CDP-based handler
 * calls this first.
 */
export async function ensureDebuggerAttached(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (error) {
    // Already attached is ok
    if (!error.message.includes("already attached")) {
      throw error;
    }
  }
}

/**
 * Capture a screenshot of a tab via CDP `Page.captureScreenshot`.
 *
 * NOTE: background.js historically contained two `captureScreenshot`
 * definitions with identical signatures; JS function hoisting meant this
 * CDP-based one (formerly the second definition) was the one that actually ran,
 * silently shadowing an earlier `chrome.tabs.captureVisibleTab` variant. This
 * extraction keeps the variant that was effectively in use.
 */
export async function captureScreenshot(tabId, options = {}) {
  try {
    await ensureDebuggerAttached(tabId);
    const result = await chrome.debugger.sendCommand(
      { tabId },
      "Page.captureScreenshot",
      {
        format: options.format || "png",
        quality: options.quality || 100,
        fromSurface: true,
      },
    );
    return {
      success: true,
      data: result.data,
      format: options.format || "png",
    };
  } catch (error) {
    return { error: error.message };
  }
}
