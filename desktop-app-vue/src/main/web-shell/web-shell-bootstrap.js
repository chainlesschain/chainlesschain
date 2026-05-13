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
  createFsOpenDirectoryHandler,
  createFsSaveDialogHandler,
} = require("./handlers/fs-handlers");
const {
  createMcpListToolsHandler,
  createMcpCallToolHandler,
  createMcpListResourcesHandler,
  createMcpReadResourceHandler,
  createMcpListServersHandler,
} = require("./handlers/mcp-handlers");
const { createLlmChatHandler } = require("./handlers/llm-handlers");
const { createUkeySignHandler } = require("./handlers/ukey-sign-handler");
const { createShellSwitchHandler } = require("./handlers/shell-switch-handler");
const { createSyncWebDAVHandlers } = require("./handlers/sync-webdav-handlers");
const { createSyncStatusHandlers } = require("./handlers/sync-status-handlers");
const { createMtcStatusHandlers } = require("./handlers/mtc-status-handlers");
const { createGitConfigHandlers } = require("./handlers/git-config-handlers");
const {
  createNotificationHandlers,
} = require("./handlers/notification-handlers");
const { createKnowledgeHandlers } = require("./handlers/knowledge-handlers");
const { createScreenshotHandlers } = require("./handlers/screenshot-handlers");
const {
  createNotificationSettingsHandlers,
} = require("./handlers/notification-settings-handlers");
const {
  createCommunityMtcHandlers,
} = require("./handlers/community-mtc-handlers");
const {
  createMobilePairConfirmationHandler,
} = require("./handlers/mobile-pair-handlers");
const {
  createDesktopPairGenerateHandler,
  createDesktopPairPollAckHandler,
  createDesktopPairResetHandler,
} = require("./handlers/desktop-pair-handlers");
const { createMultisigHandlers } = require("./handlers/multisig-handlers");
const { createProjectHandlers } = require("./handlers/project-handlers");

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
 * @property {object | null} [database]      DatabaseManager singleton. Drives
 *                                            sync.* / sync.webdav.* /
 *                                            notification.* / knowledge.*
 *                                            topics.
 * @property {object | null} [ragManager]    RAG manager singleton. When non-null,
 *                                            knowledge.add-item also indexes the
 *                                            new row (best-effort, mirrors the
 *                                            V5/V6 db:add-knowledge-item IPC
 *                                            handler).
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
    "fs.openDirectory": createFsOpenDirectoryHandler({
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
    "mcp.list_servers": createMcpListServersHandler({
      mcpConfigLoader: options.mcpConfigLoader ?? null,
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
    // Phase 3c.4 — WebDAV sync topics for web-panel parity. database may be
    // null pre-bootstrap; the handlers throw / return error envelope instead
    // of crashing the dispatcher.
    ...createSyncWebDAVHandlers({ database: options.database ?? null }),
    // Phase 3b — sync.status / push / pull / conflicts / resolve. 复用 main 已开
    // 的 db handle，避免 ws.execute('sync ...') spawn 子进程抢同一 SQLite 文件。
    ...createSyncStatusHandlers({ database: options.database ?? null }),
    // 2026-05-07 — mtc.audit-status / mtc.bridge-status / mtc.bridge-sla.
    // v5.0.3.39 (asar:true) 后 ws.execute('audit mtc status') 子进程冷启动
    // 6-10s，Mtc.vue onMounted 三发并发必爆原 8s timeout。in-process 直查
    // ~/.chainlesschain/audit-mtc & cross-chain-mtc 文件，零 spawn。
    ...createMtcStatusHandlers(),
    // 2026-05-12 — multisig.* + marketplace.consume 同模式（#21 B.6）。Multisig.vue
    // 原 7 处 ws.executeJson('multisig …') / ws.executeJson('marketplace consume …')
    // 走 _executeCommand 子进程，asar:true 同样 6-10s 冷启。改 in-process 调
    // @chainlesschain/core-multisig v0.1.0，每次 open 一个 SQLite handle（~20ms）。
    ...createMultisigHandlers(),
    // 2026-05-13 — project.* in-process WS handlers（#21 P3）。Projects.vue
    // 走这条避免 ws.execute('cc project …') 子进程冷启 6-10s。复用 P1 已落地
    // 的 ProjectManagementHandler（mobile L3 REMOTE 也用同一份），同份 handler
    // 同时服务 web-shell + mobile, "丝滑" 双端一致基础。
    ...createProjectHandlers({ database: options.database ?? null }),
    // Phase 3c.5 — git.config-* topics. 复用 git-config.json 单例（getGitConfig），
    // web-panel 用户也能配 Git 仓库，不必切回 V5/V6 桌面 shell。
    ...createGitConfigHandlers(),
    // Phase 3c.6 — notification.* + knowledge.* WS topics. V5/V6 通过
    // ipcMain.handle('notification:*' / 'db:add-knowledge-item') 落主进程
    // SQLite，web-panel 之前没有对等入口（默认壳用户看不见 / 用不上）。
    // database 可能为 null（pre-bootstrap）— handlers 内部各自做 null 检查。
    ...createNotificationHandlers({ database: options.database ?? null }),
    ...createKnowledgeHandlers({
      database: options.database ?? null,
      ragManager: options.ragManager ?? null,
    }),
    // Phase 3c.7 — screenshot.* topics 复用 ../screenshot/screenshot-ipc 的
    // _internal exports (captureScreenshot / recognize / isInsideTmpDir),
    // 不依赖 ipcMain。OCR worker 在 web-shell 进程内跑 (与 V5/V6 同址)。
    // 2026-05-08 — engine='auto'/'llm' 路径要 app.llmManager；与 V5/V6
    // IPC 同款晚绑定（LLM init 晚于 web-shell bootstrap）。
    ...createScreenshotHandlers({
      llmManager: options.llmManager ?? null,
      app: options.app ?? null,
    }),
    // Phase 3c.7 — notification-settings.* topics 桥接 appConfig。getAppConfig
    // 仅在调用方传入时才注册 (与 shell.switch 一致),避免 ws.execute 旧路径
    // 还活着时 SPA 误打开本不该可写的设置面。
    ...(typeof options.getAppConfig === "function"
      ? createNotificationSettingsHandlers({
          getAppConfig: options.getAppConfig,
        })
      : {}),
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
    // B4-webshell v1 — full B4 MTC suite over WS topics so the default
    // web-shell user can verify Merkle envelopes (mtc.envelope.get),
    // archive batches to filesystem/WebDAV (mtc.archive.*), drive M-of-N
    // governance (mtc.governance-mofn.*), and manage cross-fed trust
    // anchors (mtc.cross-fed-trust.*). Each handler tolerates null
    // managers (returns clean error envelope) — pre-init / disabled-by-
    // config setups don't crash the dispatcher.
    ...createCommunityMtcHandlers({
      channelEventBatcher: options.channelEventBatcher ?? null,
      channelEnvelopeDistribution: options.channelEnvelopeDistribution ?? null,
      channelEnvelopeArchiver: options.channelEnvelopeArchiver ?? null,
      archiveProviderFactory: options.archiveProviderFactory ?? null,
      governanceMultiSig: options.governanceMultiSig ?? null,
      crossFedTrust: options.crossFedTrust ?? null,
      // B4-mofn-sign v2: didManager so sign-as-self can resolve current
      // identity in main without renderer ever shipping private keys.
      didManager: options.didManager ?? null,
      // B4-cred-persist v1: syncCredentials lets archive UI check whether
      // a WebDAV credential is already saved (without exposing it) so the
      // "use stored credentials" toggle can render correctly.
      syncCredentials: options.syncCredentials ?? null,
      // B4-auto-archive v1: periodic archival cron (config-get / config-set /
      // run-now). Optional; missing manager yields error envelope.
      autoArchiveScheduler: options.autoArchiveScheduler ?? null,
      p2pManager: options.p2pManager ?? null,
    }),
    // v1.1 W3.6 (issue #19): pairing:confirmation 信令 round-trip。web-panel
    // MobileBridge.vue 扫码 + cc p2p pair-from-qr 写 DB 后调本 topic 让 desktop
    // 通过 mobileBridge.send 把 confirmation 经信令服务器发到 mobile。mobileBridge
    // 未就绪时 handler 自身返 error envelope，不会撞 dispatcher。
    "mobile.pair.send-confirmation": createMobilePairConfirmationHandler({
      // Lazy getters because this.mobileBridge / this.p2pManager 在 main/index.js
      // startWebShell 之后才赋值（initializeMobileBridge 是 async tail）。
      getMobileBridge:
        typeof options.getMobileBridge === "function"
          ? options.getMobileBridge
          : () => options.mobileBridge ?? null,
      getP2pManager:
        typeof options.getP2pManager === "function"
          ? options.getP2pManager
          : () => options.p2pManager ?? null,
    }),
    // v1.1 W3.7 Flow B (desktop QR / phone scans). 三个 topic 形成
    // 完整 round-trip：generate-qr 产生 payload → Vue 渲染 → phone 扫
    // 经信令发 pair-ack → mobile-bridge incoming router recordPairAck →
    // Vue poll-ack 看到状态变 acked → 刷新设备列表。
    "desktop.pair.generate-qr": createDesktopPairGenerateHandler({
      getMobileBridge:
        typeof options.getMobileBridge === "function"
          ? options.getMobileBridge
          : () => options.mobileBridge ?? null,
      getDeviceManager:
        typeof options.getDeviceManager === "function"
          ? options.getDeviceManager
          : () => options.deviceManager ?? null,
    }),
    "desktop.pair.poll-ack": createDesktopPairPollAckHandler(),
    "desktop.pair.reset": createDesktopPairResetHandler(),
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
    // Server → all-clients fan-out, used by enhanced-tray-manager for
    // tray:action push to the embedded web-panel (no IPC listener exists in
    // web-shell mode because the renderer is web-panel HTML, not the V5/V6
    // Vue SPA). See dispatchTrayAction call site.
    broadcast: ws.broadcast,
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
