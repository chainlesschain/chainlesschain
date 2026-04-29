/**
 * web-ui-loader — Phase 0 spike (2026-04-29).
 *
 * Boots the CLI's `web-ui-server.js` inside the Electron main-process node
 * runtime so a desktop BrowserWindow can `loadURL` against it. The CLI module
 * is ESM and this file is CJS, so we go through dynamic `import()`.
 *
 * Risk-1 from the strategy memo (`desktop_web_shell_strategy.md`):
 *   "web-ui-server 在 Electron main 进程能否同进程跑". Answer this loader is
 *   probing: yes — Node ≥18 in Electron 39 supports CJS → ESM dynamic import,
 *   and `web-ui-server.createWebUIServer` only depends on Node built-ins plus
 *   sibling files in `packages/cli/src/lib/` (no top-level side effects).
 *
 * The WebSocket server is intentionally NOT started here. Phase 0 step 1
 * verifies the static SPA + config injection path; the WS bridge is Phase 0
 * step 2 (`ukey.status` round-trip).
 */

const path = require("path");
const { pathToFileURL } = require("url");

const WEB_UI_SERVER_REL = "../../../../packages/cli/src/lib/web-ui-server.js";

/**
 * @typedef {Object} StartWebUIServerOptions
 * @property {number} [port]            HTTP port to listen on. 0 = OS-assigned.
 * @property {string} [host]            HTTP bind host. Defaults to 127.0.0.1.
 * @property {number} wsPort            WebSocket port the SPA will dial.
 * @property {string} [wsHost]          WS host the SPA will dial. Defaults to host.
 * @property {string} [wsToken]         Optional WS auth token.
 * @property {string|null} [projectRoot] Active project root, or null = global.
 * @property {string|null} [projectName] Human-readable project name.
 * @property {"project"|"global"} [mode] Defaults to "global".
 * @property {"auto"|"full"|"minimal"} [uiMode] Defaults to "full" (require SPA dist).
 * @property {string} [staticDir]       Override for web-panel dist directory.
 */

/**
 * Start the web-panel HTTP server in this same Node process.
 * Resolves once the server is listening.
 *
 * @param {StartWebUIServerOptions} options
 * @returns {Promise<{ server: import("http").Server, host: string, port: number, url: string, close: () => Promise<void> }>}
 */
async function startWebUIServer(options) {
  if (!options || typeof options.wsPort !== "number") {
    throw new TypeError(
      "startWebUIServer: options.wsPort (number) is required",
    );
  }

  const host = options.host || "127.0.0.1";
  const port = typeof options.port === "number" ? options.port : 0;

  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, WEB_UI_SERVER_REL),
  ).href;
  const mod = await import(moduleUrl);

  const server = mod.createWebUIServer({
    wsPort: options.wsPort,
    wsToken: options.wsToken ?? null,
    wsHost: options.wsHost || host,
    projectRoot: options.projectRoot ?? null,
    projectName: options.projectName ?? null,
    mode: options.mode || "global",
    uiMode: options.uiMode || "full",
    staticDir: options.staticDir,
  });

  await new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

  const address = server.address();
  const boundPort =
    typeof address === "object" && address ? address.port : port;
  const boundHost =
    typeof address === "object" && address && address.address
      ? address.address
      : host;
  const url = `http://${boundHost}:${boundPort}/`;

  function close() {
    return new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  return { server, host: boundHost, port: boundPort, url, close };
}

module.exports = { startWebUIServer };
