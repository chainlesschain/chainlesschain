/**
 * ws-cli-loader — Phase 1.1 protocol merge.
 *
 * Replaces the Phase-0 `ws-bridge.js` minimal request/response server with
 * the CLI's full `ChainlessChainWSServer`, then layers custom topic handlers
 * (e.g. `ukey.status`, `fs.read`, `ollama.chat`) onto the same dispatcher so
 * web-panel's existing CLI-protocol calls (`auth`, `ping`, `session-*`,
 * `execute`, …) and our desktop-only topics share one connection.
 *
 * Strategy in `memory/desktop_web_shell_strategy.md` decision #1 (A1 same
 * process) and Phase 1.1 ("协议合并") in the planning thread on 2026-04-29.
 *
 * Approach: monkey-patch `server._dispatcher.dispatch` to first match a
 * registered topic handler; fall through to the original dispatcher
 * otherwise. The CLI's id-required and auth-required gates are mirrored so
 * custom topics cannot bypass authentication.
 *
 * The exported handle keeps the same shape as `ws-bridge.startWsBridge`'s
 * return value (`{ host, port, url, register, close }`) so
 * `web-shell-bootstrap.js` swaps backends with a single import change.
 */

const path = require("path");
const { pathToFileURL } = require("url");

const WS_SERVER_REL = "../../../../packages/cli/src/gateways/ws/ws-server.js";
const WS_SESSION_GATEWAY_REL =
  "../../../../packages/cli/src/gateways/ws/ws-session-gateway.js";
const CONFIG_MANAGER_REL = "../../../../packages/cli/src/lib/config-manager.js";

/**
 * @typedef {(frame: any, ctx: { topic: string, id: string, server: any, ws: any, clientId: string }) => Promise<any> | any} TopicHandler
 *
 * @typedef {Object} StartWsCliBackendOptions
 * @property {number} [port]            TCP port. 0 = OS-assigned (default).
 * @property {string} [host]            Bind host. Defaults to 127.0.0.1.
 * @property {string|null} [token]      Optional auth token. Forwarded to CLI WS.
 * @property {number} [maxConnections]  Forwarded to ChainlessChainWSServer.
 * @property {object} [sessionManager]  Optional session manager. Without one,
 *                                      session-* messages reply with envelope
 *                                      errors but never crash the server.
 * @property {Record<string, TopicHandler>} [handlers]
 *                                      Custom topic → handler map.
 */

/**
 * Start the CLI WS server in this same Node process and layer custom topic
 * dispatch on top.
 *
 * @param {StartWsCliBackendOptions} [options]
 * @returns {Promise<{
 *   server: any,
 *   host: string,
 *   port: number,
 *   url: string,
 *   register: (topic: string, handler: TopicHandler) => void,
 *   close: () => Promise<void>,
 * }>}
 */
async function startWsCliBackend(options = {}) {
  const moduleUrl = pathToFileURL(path.resolve(__dirname, WS_SERVER_REL)).href;
  const mod = await import(moduleUrl);

  // The CLI ws-server's session-protocol expects a WSSessionManager (long
  // method names: createSession/listSessions/getSession/...). Desktop's
  // session-core SessionManager has the short ones (create/list/get) and
  // is API-incompatible. If no sessionManager was passed in, instantiate a
  // WSSessionManager here with the minimal deps it needs — db: null is
  // supported (in-memory Map), defaultProjectRoot defaults to cwd. Web-
  // panel can then create chat/agent sessions without "Session support not
  // configured on this server" errors.
  let sessionManager = options.sessionManager;
  if (!sessionManager) {
    const gatewayUrl = pathToFileURL(
      path.resolve(__dirname, WS_SESSION_GATEWAY_REL),
    ).href;
    const gatewayMod = await import(gatewayUrl);
    // Load the same config the CLI uses (~/.chainlesschain/config.json) so
    // `cc config set llm.*` from the web-panel LLM page actually reaches
    // WSSessionManager. Without this the gateway falls back to ollama at
    // localhost:11434 and the user gets "fetch failed" against a provider
    // they never selected.
    let cfg = options.config;
    let cfgMod = null;
    if (!cfg) {
      try {
        const cfgUrl = pathToFileURL(
          path.resolve(__dirname, CONFIG_MANAGER_REL),
        ).href;
        cfgMod = await import(cfgUrl);
        cfg = cfgMod.loadConfig();
      } catch {
        cfg = {};
      }
    }
    sessionManager = new gatewayMod.WSSessionManager({
      db: options.db || null,
      config: cfg,
      defaultProjectRoot: options.defaultProjectRoot || null,
    });

    // The constructor snapshot misses any `cc config set llm.*` the user
    // runs after WSSessionManager is built (e.g. fills in apiKey on the
    // LLM 配置 page, then clicks 新建 Chat). Re-read config on every
    // createSession so fresh LLM credentials always reach the new Session.
    if (cfgMod) {
      const originalCreate = sessionManager.createSession.bind(sessionManager);
      sessionManager.createSession = (opts = {}) => {
        try {
          sessionManager.config = cfgMod.loadConfig() || {};
        } catch {
          // Keep the previous snapshot on read failure.
        }
        return originalCreate(opts);
      };
    }
  }

  const server = new mod.ChainlessChainWSServer({
    port: typeof options.port === "number" ? options.port : 0,
    host: options.host || "127.0.0.1",
    token: options.token ?? null,
    maxConnections: options.maxConnections,
    sessionManager,
  });

  // ChainlessChainWSServer extends EventEmitter and emits "error" on bind
  // failures (in addition to rejecting start()). Without a listener Node's
  // EventEmitter throws "Unhandled 'error' event" and crashes the process.
  // Attach a no-op so callers' .catch on start() / startWebShell() is the
  // single source of failure visibility.
  server.on("error", () => {});

  await server.start();

  /** @type {Map<string, TopicHandler>} */
  const topicHandlers = new Map();
  if (options.handlers) {
    for (const [topic, fn] of Object.entries(options.handlers)) {
      if (typeof fn !== "function") {
        throw new TypeError(
          `ws-cli-loader: handler for "${topic}" must be a function`,
        );
      }
      topicHandlers.set(topic, fn);
    }
  }

  const originalDispatcher = server._dispatcher;
  server._dispatcher = {
    async dispatch(clientId, ws, message) {
      const { id, type } = message || {};

      // Custom topic path. We mirror CLI's id + auth gates so that
      // unauthenticated clients cannot trigger native handlers via a topic.
      if (id && type && topicHandlers.has(type)) {
        const client = server.clients.get(clientId);
        if (server.token && (!client || !client.authenticated)) {
          server._send(ws, {
            id,
            type: "error",
            code: "AUTH_REQUIRED",
            message: "Authentication required. Send an auth message first.",
          });
          return;
        }

        const handler = topicHandlers.get(type);
        try {
          const result = await handler(message, {
            topic: type,
            id,
            server,
            ws,
            clientId,
          });
          server._send(ws, {
            id,
            type: `${type}.result`,
            ok: true,
            result: result ?? null,
          });
        } catch (err) {
          server._send(ws, {
            id,
            type: `${type}.result`,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      // Native CLI message — let the original dispatcher handle id/auth/route.
      return originalDispatcher.dispatch(clientId, ws, message);
    },
  };

  function register(topic, fn) {
    if (typeof topic !== "string" || !topic) {
      throw new TypeError("ws-cli-loader: topic must be a non-empty string");
    }
    if (typeof fn !== "function") {
      throw new TypeError("ws-cli-loader: handler must be a function");
    }
    topicHandlers.set(topic, fn);
  }

  async function close() {
    return server.stop();
  }

  return {
    server,
    host: server.host,
    port: server.port,
    url: `ws://${server.host}:${server.port}/`,
    register,
    close,
  };
}

module.exports = { startWsCliBackend };
