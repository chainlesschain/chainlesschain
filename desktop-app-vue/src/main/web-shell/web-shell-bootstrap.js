/**
 * web-shell-bootstrap — Phase 0 spike step 3 (2026-04-29) +
 * Phase 1.1 protocol merge (2026-04-29).
 *
 * Composes `web-ui-loader` (HTTP/SPA) and `ws-cli-loader` (full CLI WS with
 * topic-handler extension) into a single lifecycle so an Electron
 * BrowserWindow can `loadURL(handle.httpUrl)` and the SPA's
 * `window.__CC_CONFIG__.wsPort` automatically points at a server that
 * speaks both web-panel's existing CLI protocol (`auth`, `ping`,
 * `session-*`, …) and our desktop-only topics (`ukey.status`, future
 * `fs.*` / `ollama.*` / `mcp.*`) on the same connection.
 *
 * Phase 0 used `ws-bridge.js` (minimal topic-only protocol) which left
 * web-panel showing "no_handler" for every native call. Phase 1.1 swapped
 * to `ws-cli-loader.js` so web-panel's calls land on the real dispatcher
 * while custom topics still ride the same wire. The external API of
 * `startWebShell` is unchanged so callers don't move.
 *
 * Usage from Electron main:
 *
 *     if (shouldRunWebShell(process.argv)) {
 *       this.webShell = await startWebShell({ ukeyManager: this.ukeyManager });
 *       this.mainWindow.loadURL(this.webShell.httpUrl);
 *     }
 *
 * Closing is idempotent — safe to call from `app.on("before-quit")`.
 */

const { startWebUIServer } = require("./web-ui-loader");
const { startWsCliBackend } = require("./ws-cli-loader");
const { createUKeyStatusHandler } = require("./handlers/ukey-status-handler");
const { createSkillListHandler } = require("./handlers/skill-list-handler");
const {
  createFsOpenDialogHandler,
  createFsSaveDialogHandler,
} = require("./handlers/fs-handlers");

/** CLI flag / env var that opts in to the web-shell entry point. */
const WEB_SHELL_FLAG = "--web-shell";
const WEB_SHELL_ENV = "CHAINLESSCHAIN_WEB_SHELL";

/**
 * @typedef {Object} StartWebShellOptions
 * @property {string} [host]                 Bind host. Defaults to 127.0.0.1.
 * @property {number} [httpPort]             HTTP port. 0 = OS-assigned.
 * @property {number} [wsPort]               WS port. 0 = OS-assigned.
 * @property {{ detect?: () => Promise<any> } | null} [ukeyManager]
 *                                            UKey singleton; nullable for early boot.
 * @property {Electron.BrowserWindow | null} [mainWindow]
 *                                            Parent window for native dialogs. Required
 *                                            for fs.openDialog / fs.saveDialog handlers.
 * @property {string|null} [projectRoot]     Active project root, or null.
 * @property {string|null} [projectName]     Human-readable project name.
 * @property {"project"|"global"} [mode]     Defaults to "global".
 * @property {string} [staticDir]            Override for web-panel dist dir.
 * @property {Record<string, Function>} [extraHandlers]
 *                                            Extra WS topics to register up-front.
 */

/**
 * Start both halves of the web shell. Failures in either half tear the other
 * one down so we never leave a half-open server behind.
 *
 * @param {StartWebShellOptions} [options]
 * @returns {Promise<{
 *   httpUrl: string,
 *   wsUrl: string,
 *   host: string,
 *   httpPort: number,
 *   wsPort: number,
 *   register: (topic: string, handler: Function) => void,
 *   close: () => Promise<void>,
 * }>}
 */
async function startWebShell(options = {}) {
  const host = options.host || "127.0.0.1";

  const wsHandlers = {
    "ukey.status": createUKeyStatusHandler({
      ukeyManager: options.ukeyManager ?? null,
    }),
    "skill.list": createSkillListHandler(),
    // Phase 1.2 fs first batch — dialog-based, no arbitrary path access.
    // Handlers throw "main_window_unavailable" when called pre-window or
    // post-destroy, so registering with null is harmless until a window
    // exists.
    "fs.openDialog": createFsOpenDialogHandler({
      mainWindow: options.mainWindow ?? null,
    }),
    "fs.saveDialog": createFsSaveDialogHandler({
      mainWindow: options.mainWindow ?? null,
    }),
    ...(options.extraHandlers || {}),
  };

  const ws = await startWsCliBackend({
    host,
    port: typeof options.wsPort === "number" ? options.wsPort : 0,
    token: options.wsToken ?? null,
    handlers: wsHandlers,
    sessionManager: options.sessionManager,
  });

  let http;
  try {
    http = await startWebUIServer({
      host,
      port: typeof options.httpPort === "number" ? options.httpPort : 0,
      wsHost: host,
      wsPort: ws.port,
      projectRoot: options.projectRoot ?? null,
      projectName: options.projectName ?? null,
      mode: options.mode || "global",
      uiMode: "full",
      staticDir: options.staticDir,
      // Tells the SPA it is loaded inside the Electron web-shell. The
      // web-panel skills store branches on this to call `skill.list`
      // (in-process custom topic) instead of `ws.execute('skill list')`
      // (which fails: Electron can't spawn itself as the cc CLI).
      embeddedShell: true,
    });
  } catch (err) {
    await ws.close().catch(() => {});
    throw err;
  }

  let closed = false;
  async function close() {
    if (closed) {
      return;
    }
    closed = true;
    await Promise.allSettled([ws.close(), http.close()]);
  }

  return {
    httpUrl: http.url,
    wsUrl: ws.url,
    host,
    httpPort: http.port,
    wsPort: ws.port,
    register: ws.register,
    close,
  };
}

/**
 * Returns true when the user opted into the web shell via any of:
 *   - argv flag (`--web-shell`)
 *   - env var (`CHAINLESSCHAIN_WEB_SHELL=1`)
 *   - persistent setting (`settings.ui.useWebShellExperimental === true`)
 *
 * Pure function — no global state — so it's trivially unit-testable. The
 * `settings` argument is optional (Phase 0 callers passed only argv/env);
 * Phase 1.3 added it so the SystemSettings toggle drives shell choice on
 * next launch. Mirrors the V6 hard-flip pattern (`ui.useV6ShellByDefault`).
 *
 * @param {string[]} [argv]
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ ui?: { useWebShellExperimental?: boolean } } | null} [settings]
 * @returns {boolean}
 */
function shouldRunWebShell(
  argv = process.argv,
  env = process.env,
  settings = null,
) {
  if (Array.isArray(argv) && argv.includes(WEB_SHELL_FLAG)) {
    return true;
  }
  if (env?.[WEB_SHELL_ENV] === "1") {
    return true;
  }
  if (settings?.ui?.useWebShellExperimental === true) {
    return true;
  }
  return false;
}

module.exports = {
  startWebShell,
  shouldRunWebShell,
  WEB_SHELL_FLAG,
  WEB_SHELL_ENV,
};
