/**
 * ipc-sender-guard — sender-frame trust validation for every ipcMain.handle.
 *
 * Problem (see memory `desktop_main_ipc_security_findings_2026_06_20`): the app
 * registers ~278 privilege-sensitive IPC channels with raw `ipcMain.handle` and
 * never checks WHICH frame sent the request. Renderer identity (DID etc.) is
 * passed in params and trusted blindly, and there is no sender-frame/origin
 * check anywhere — so any frame that can reach the bridge (a sub-frame loading
 * untrusted content, a frame navigated to a foreign origin) could drive
 * privileged channels.
 *
 * Fix: monkey-patch `ipcMain.handle`/`handleOnce` ONCE, before handlers
 * register, so every handler first runs `validateSender(event)`:
 *   - reject SUB-FRAMES (iframes) — only the top frame of a window is trusted;
 *   - reject UNTRUSTED ORIGINS — only `file:` within the app bundle and
 *     localhost/127.0.0.1 (dev server + local web-shell) are our own content.
 * All legit windows (prod file://, dev localhost, web-shell httpUrl, the
 * multi-window role windows, splash) share one of those trust anchors and only
 * differ by hash fragment, so this does not break secondary windows.
 *
 * Rollout (gated, like the repo's other security features): modes are
 *   off | report | enforce, via `CC_IPC_SENDER_GUARD`:
 *     - unset / "enforce" / "1" → DEFAULT: block untrusted senders (the actual
 *                           hardening). Static verification confirmed every
 *                           IPC-capable window (main + multi-window role windows
 *                           + splash; they carry the preload bridge) loads from
 *                           file:(bundle) or loopback, and the external-content
 *                           windows (sign-bridge BrowserView, pdf render, the
 *                           loopback PDH window) have NO preload so they cannot
 *                           invoke ipcMain.handle at all → no false-positive.
 *     - "report" / "audit" → compute the verdict and LOG would-blocks, but do
 *                           NOT block (use to re-verify after window changes);
 *     - "0" / "off"       → disabled entirely (kill-switch).
 * Internal guard errors FAIL OPEN (allow + log): a bug in the guard must never
 * brick legitimate IPC. A clean "untrusted" verdict FAILS CLOSED in enforce mode.
 *
 * @module ipc/ipc-sender-guard
 */
const path = require("path");
const { logger } = require("../utils/logger.js");

/** Resolve the trust mode from the environment (re-read per call so a relaunch
 * or test can flip it without reinstalling the patch). */
function resolveMode() {
  const v = String(process.env.CC_IPC_SENDER_GUARD || "").toLowerCase();
  if (v === "0" || v === "off" || v === "false" || v === "disable") {
    return "off";
  }
  if (v === "report" || v === "audit" || v === "warn") {
    return "report";
  }
  // Default (unset) + explicit enforce values → enforce (block untrusted).
  return "enforce";
}

/** App bundle root that legit `file:` frames load from (contains renderer/).
 * ipc-sender-guard.js lives at <root>/main/ipc, so root = ../.. . Computed once. */
let _appFileRoot;
function appFileRoot() {
  if (_appFileRoot === undefined) {
    try {
      _appFileRoot = path.resolve(__dirname, "..", "..");
    } catch {
      _appFileRoot = "";
    }
  }
  return _appFileRoot;
}

function isLoopbackHost(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

/**
 * Is this frame URL one of our own trusted origins?
 * - file:  → path must resolve inside the app bundle root (prod + splash).
 * - http(s) on loopback → dev server + local web-shell (any port).
 * - anything else (remote http(s), data:, blob:, about:) → untrusted.
 */
function originIsTrusted(url) {
  if (!url) {
    return false;
  }
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === "file:") {
    const root = appFileRoot();
    if (!root) {
      return true;
    } // root undeterminable → lenient (can't tighten safely)
    let p;
    try {
      p = decodeURIComponent(u.pathname);
    } catch {
      p = u.pathname;
    }
    // file:///C:/a/b → pathname "/C:/a/b"; drop the leading slash before a drive.
    if (/^\/[A-Za-z]:[/\\]/.test(p)) {
      p = p.slice(1);
    }
    let norm;
    try {
      norm = path.resolve(p);
    } catch {
      return false;
    }
    // Case-insensitive prefix match (Windows paths are case-insensitive).
    return norm.toLowerCase().startsWith(root.toLowerCase());
  }
  if (u.protocol === "http:" || u.protocol === "https:") {
    return isLoopbackHost(u.hostname);
  }
  return false;
}

/** Best-effort read of a frame's url without throwing on a disposed frame. */
function frameUrl(frame) {
  try {
    return frame && typeof frame.url === "string" ? frame.url : "";
  } catch {
    return "";
  }
}

/**
 * Decide whether an ipcMain event came from a trusted sender frame.
 * @returns {{trusted: boolean, reason?: string, url?: string}}
 */
function validateSender(event) {
  let frame;
  try {
    frame = event && event.senderFrame;
  } catch {
    frame = null;
  }
  if (!frame) {
    return { trusted: false, reason: "no-sender-frame" };
  }

  // Only the top frame of a window is trusted; sub-frames (iframes) are not.
  let parent;
  try {
    parent = frame.parent;
  } catch {
    parent = undefined;
  }
  const url = frameUrl(frame);
  if (parent) {
    return { trusted: false, reason: "sub-frame", url };
  }

  if (!originIsTrusted(url)) {
    return { trusted: false, reason: "untrusted-origin", url };
  }
  return { trusted: true };
}

// Track which (channel) we've already warned about in report mode, to avoid
// log spam on a hot channel — one would-block warning per channel is enough.
const _warned = new Set();

/**
 * Core verdict: should this call be BLOCKED? Logs would-block/BLOCKED (deduped
 * per channel+reason in report mode). Fails OPEN on an internal guard error.
 * Shared by the handle wrapper (rejects) and the on/once wrapper (drops).
 * @returns {boolean} true only in enforce mode with an untrusted sender.
 */
function shouldBlock(channel, event, getMode) {
  const mode = getMode();
  if (mode === "off") {
    return false;
  }
  let verdict;
  try {
    verdict = validateSender(event);
  } catch (err) {
    // Guard bug → fail OPEN (never brick legit IPC), but make it loud.
    logger.error(
      `[ipc-sender-guard] internal error validating "${channel}" (allowing): ${err && err.message}`,
    );
    return false;
  }
  if (!verdict || verdict.trusted !== false) {
    return false;
  }
  const blocking = mode === "enforce";
  const key = `${channel}:${verdict.reason}`;
  if (blocking || !_warned.has(key)) {
    _warned.add(key);
    logger.warn(
      `[ipc-sender-guard] ${blocking ? "BLOCKED" : "would-block"} ` +
        `channel="${channel}" reason=${verdict.reason} url=${verdict.url || "?"}`,
    );
  }
  return blocking;
}

/**
 * Wrap an ipcMain.handle handler so it validates the sender first.
 * Async so an enforce-mode rejection surfaces as a rejected promise (uniform
 * with ipcMain.handle's await semantics) rather than a synchronous throw.
 */
function wrapHandler(channel, handler, getMode) {
  return async function guardedHandler(event, ...args) {
    if (shouldBlock(channel, event, getMode)) {
      throw new Error(
        `[ipc-sender-guard] untrusted sender rejected for channel "${channel}"`,
      );
    }
    return handler(event, ...args);
  };
}

/**
 * Wrap an ipcMain.on / once listener. Fire-and-forget has no return to reject,
 * so an untrusted sender in enforce mode is DROPPED (listener never invoked).
 * Kept synchronous to match ipcMain.on listener semantics.
 */
function wrapListener(channel, listener, getMode) {
  return function guardedListener(event, ...args) {
    if (shouldBlock(channel, event, getMode)) {
      return; // drop the untrusted event — do not invoke the listener
    }
    return listener(event, ...args);
  };
}

/**
 * Install the guard by monkey-patching ipcMain.handle / handleOnce so every
 * future registration is wrapped. Idempotent. Call BEFORE handlers register.
 * @param {object} ipcMain - electron ipcMain (injectable for tests)
 * @param {object} [opts]
 * @param {() => string} [opts.getMode] - override mode resolution (tests)
 * @returns {boolean} true if installed, false if already installed / invalid
 */
function installSenderGuard(ipcMain, opts = {}) {
  if (!ipcMain || typeof ipcMain.handle !== "function") {
    return false;
  }
  if (ipcMain.__ccSenderGuardInstalled) {
    return false;
  }
  const getMode = opts.getMode || resolveMode;

  const origHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = function (channel, handler) {
    if (typeof handler !== "function") {
      return origHandle(channel, handler);
    }
    return origHandle(channel, wrapHandler(channel, handler, getMode));
  };

  if (typeof ipcMain.handleOnce === "function") {
    const origHandleOnce = ipcMain.handleOnce.bind(ipcMain);
    ipcMain.handleOnce = function (channel, handler) {
      if (typeof handler !== "function") {
        return origHandleOnce(channel, handler);
      }
      return origHandleOnce(channel, wrapHandler(channel, handler, getMode));
    };
  }

  // Fire-and-forget channels (ipcMain.on / once): untrusted senders are dropped
  // (no response to reject). Safe to wrap — the codebase has no ipcMain
  // removeListener/off by reference, so the wrapper identity never matters.
  for (const method of ["on", "once"]) {
    if (typeof ipcMain[method] !== "function") {
      continue;
    }
    const orig = ipcMain[method].bind(ipcMain);
    ipcMain[method] = function (channel, listener) {
      if (typeof listener !== "function") {
        return orig(channel, listener);
      }
      return orig(channel, wrapListener(channel, listener, getMode));
    };
  }

  ipcMain.__ccSenderGuardInstalled = true;
  logger.info(
    `[ipc-sender-guard] installed (mode=${getMode()}; set CC_IPC_SENDER_GUARD=report for audit-only, =0 to disable)`,
  );
  return true;
}

module.exports = {
  installSenderGuard,
  validateSender,
  originIsTrusted,
  resolveMode,
  // exported for tests
  _wrapHandler: wrapHandler,
  _wrapListener: wrapListener,
  _appFileRoot: appFileRoot,
};
