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
const {
  createMcpListToolsHandler,
  createMcpCallToolHandler,
  createMcpListResourcesHandler,
  createMcpReadResourceHandler,
} = require("./handlers/mcp-handlers");
const { createLlmChatHandler } = require("./handlers/llm-handlers");
const { createUkeySignHandler } = require("./handlers/ukey-sign-handler");
const { createShellSwitchHandler } = require("./handlers/shell-switch-handler");

/** CLI flag / env var that opts in to the web-shell entry point. */
const WEB_SHELL_FLAG = "--web-shell";
const WEB_SHELL_ENV = "CHAINLESSCHAIN_WEB_SHELL";
/** Dev-friendly opt-out: skip touching settings.json, just pass `--no-web-shell` */
/** or `CHAINLESSCHAIN_WEB_SHELL=0` to land on V5/V6 desktop renderer. */
const NO_WEB_SHELL_FLAG = "--no-web-shell";

/**
 * @typedef {Object} StartWebShellOptions
 * @property {string} [host]                 Bind host. Defaults to 127.0.0.1.
 * @property {number} [httpPort]             HTTP port. 0 = OS-assigned.
 * @property {number} [wsPort]               WS port. 0 = OS-assigned.
 * @property {{ detect?: () => Promise<any> } | null} [ukeyManager]
 *                                            UKey singleton; nullable for early boot.
 * @property {object | null} [mcpManager]    MCPClientManager singleton (or null
 *                                            when MCP is disabled). Surfaced to the
 *                                            embedded SPA via mcp.list_tools /
 *                                            mcp.call_tool topics.
 * @property {object | null} [llmManager]    LLMManager singleton (or null when
 *                                            LLM hasn't initialised yet). Drives
 *                                            the streaming `llm.chat` topic.
 * @property {Electron.BrowserWindow | null} [mainWindow]
 *                                            Parent window for native dialogs. Required
 *                                            for fs.openDialog / fs.saveDialog handlers.
 * @property {(() => any) | null} [getAppConfig]
 *                                            Lazy getter for the AppConfigManager
 *                                            singleton — passed to shell.switch so
 *                                            web-panel's "切回桌面壳" button can
 *                                            persist the opt-out and trigger relaunch
 *                                            without going through electronAPI (the
 *                                            web-shell preload is intentionally empty).
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
    // Phase 2 first batch — surface the desktop MCPClientManager to the
    // embedded web-panel. mcpManager may be null when MCP is disabled in
    // config; the handlers throw `mcp_unavailable` at call time so the
    // SPA shows a clean envelope error instead of a crash.
    "mcp.list_tools": createMcpListToolsHandler({
      mcpManager: options.mcpManager ?? null,
    }),
    "mcp.call_tool": createMcpCallToolHandler({
      mcpManager: options.mcpManager ?? null,
    }),
    "mcp.list_resources": createMcpListResourcesHandler({
      mcpManager: options.mcpManager ?? null,
    }),
    "mcp.read_resource": createMcpReadResourceHandler({
      mcpManager: options.mcpManager ?? null,
    }),
    // Phase 2 streaming first consumer — async-generator handler that
    // bridges LLMManager.chatStream(messages, onChunk, opts) to the
    // streaming envelope (see ws-cli-loader.js). llmManager may be null
    // before LLM init completes; the handler throws `llm_unavailable`
    // at call time so the SPA gets a clean envelope error.
    "llm.chat": createLlmChatHandler({
      llmManager: options.llmManager ?? null,
    }),
    // Phase 2 — routine UKey sign over WS (decision #3 hybrid protocol).
    // High-risk operations (key generation / mnemonic export / factory
    // reset) deliberately stay off this map and only flow through
    // window.electronAPI.ukey.* in preload — security guarantee that
    // a compromised SPA can never trigger destructive UKey ops via WS.
    "ukey.sign": createUkeySignHandler({
      ukeyManager: options.ukeyManager ?? null,
    }),
    // Phase 1.6 — symmetric shell switch from web-panel back to V5/V6.
    // Only registered when getAppConfig is provided (it requires the
    // AppConfigManager singleton to persist the opt-out).
    ...(typeof options.getAppConfig === "function"
      ? {
          "shell.switch": createShellSwitchHandler({
            getAppConfig: options.getAppConfig,
          }),
        }
      : {}),
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
 * Returns true when the launch should land on the web shell. After the
 * Phase 1.6 hard-flip the default is **on** — so the function returns
 * true unless the user explicitly opted out via
 * `settings.ui.useWebShellExperimental === false`. Argv/env opt-in is
 * preserved as a force-on escape hatch (e.g. CI / first-launch dogfood
 * before settings.json exists), but is now redundant in the common case.
 *
 * Pure function — no global state — so it's trivially unit-testable.
 * Mirrors the V6 hard-flip semantics (caaddf530): `raw !== false`.
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
  // Settings is authoritative in both directions — a user who toggled
  // via UI (in either shell's "switch" button) expects the next launch
  // to honour that choice regardless of stale argv flags carried over
  // by `app.relaunch()`. Argv/env signals are dev escape hatches that
  // only apply when settings is unset.
  const persisted = settings?.ui?.useWebShellExperimental;
  if (persisted === false) {
    return false;
  }
  if (persisted === true) {
    return true;
  }
  // Settings unset: argv/env signals decide. Opt-out wins over opt-in
  // when both are present (safer landing on the V5/V6 renderer).
  if (Array.isArray(argv) && argv.includes(NO_WEB_SHELL_FLAG)) {
    return false;
  }
  if (env?.[WEB_SHELL_ENV] === "0" || env?.[WEB_SHELL_ENV] === "false") {
    return false;
  }
  if (Array.isArray(argv) && argv.includes(WEB_SHELL_FLAG)) {
    return true;
  }
  if (env?.[WEB_SHELL_ENV] === "1") {
    return true;
  }
  // Phase 1.6 hard-flip default: unset / true / non-boolean → web shell.
  return true;
}

module.exports = {
  startWebShell,
  shouldRunWebShell,
  WEB_SHELL_FLAG,
  NO_WEB_SHELL_FLAG,
  WEB_SHELL_ENV,
};
