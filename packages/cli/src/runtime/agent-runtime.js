import chalk from "chalk";
import { execSync } from "child_process";
import path from "path";
import {
  RuntimeEventEmitter,
  RUNTIME_EVENTS,
  createRuntimeEvent,
} from "./runtime-events.js";
import { createRuntimeContext } from "./runtime-context.js";
import { createAgentTurnRecord } from "./contracts/agent-turn.js";
import { logger } from "../lib/logger.js";
import { listenWithPortFallback } from "../lib/listen-with-port-fallback.js";
import { bootstrap } from "./bootstrap.js";
import { startAgentRepl } from "../gateways/repl/agent-repl.js";
import { startChatRepl } from "../gateways/repl/chat-repl.js";
import { ChainlessChainWSServer } from "../gateways/ws/ws-server.js";
import { WSSessionManager } from "../gateways/ws/ws-session-gateway.js";
import { attachTopicHandlers } from "../gateways/ws/topic-handler-attachment.js";
import { PtyManager } from "../gateways/terminal/PtyManager.js";
import { createTerminalHandlers } from "../gateways/terminal/terminal-handlers.js";
import { createWebUIServer } from "../gateways/ui/web-ui-server.js";
import { MCPClient, MCPServerConfig } from "../harness/mcp-client.js";
import sharedManagedToolPolicy from "./coding-agent-managed-tool-policy.cjs";
import { findProjectRoot, loadProjectConfig } from "../lib/project-detector.js";
import { loadConfig } from "../lib/config-manager.js";

const {
  DEFAULT_ALLOWED_MCP_SERVER_NAMES,
  createTrustedMcpServerMap,
  resolveMcpServerPolicy,
} = sharedManagedToolPolicy;

const BUILTIN_CODING_AGENT_MCP_REGISTRY = Object.freeze({
  trustedServers: [
    {
      id: "weather",
      securityLevel: "low",
      requiredPermissions: ["network:http"],
      capabilities: ["tools", "resources"],
    },
  ],
});

function openBrowser(url) {
  try {
    const platform = process.platform;
    if (platform === "win32") {
      execSync(`start "" "${url}"`, { stdio: "ignore" });
    } else if (platform === "darwin") {
      execSync(`open "${url}"`, { stdio: "ignore" });
    } else {
      execSync(`xdg-open "${url}"`, { stdio: "ignore" });
    }
  } catch (_err) {
    // Non-critical.
  }
}

export class AgentRuntime {
  constructor({ kind, policy, config = null, deps = {} } = {}) {
    this.kind = kind;
    this.policy = policy;
    this.config = config;
    this.context = createRuntimeContext({ kind, policy, config });
    this.events = deps.events || new RuntimeEventEmitter();
    this.deps = {
      startAgentRepl: deps.startAgentRepl || startAgentRepl,
      startChatRepl: deps.startChatRepl || startChatRepl,
      bootstrap: deps.bootstrap || bootstrap,
      createServer:
        deps.createServer || ((options) => new ChainlessChainWSServer(options)),
      createSessionManager:
        deps.createSessionManager ||
        ((options) => new WSSessionManager(options)),
      createMcpClient: deps.createMcpClient || (() => new MCPClient()),
      createMcpServerConfig:
        deps.createMcpServerConfig || ((db) => new MCPServerConfig(db)),
      mcpServerRegistry:
        deps.mcpServerRegistry || BUILTIN_CODING_AGENT_MCP_REGISTRY,
      createWebServer:
        deps.createWebServer || ((options) => createWebUIServer(options)),
      findProjectRoot: deps.findProjectRoot || findProjectRoot,
      loadProjectConfig: deps.loadProjectConfig || loadProjectConfig,
      loadConfig: deps.loadConfig || loadConfig,
      openBrowser: deps.openBrowser || openBrowser,
      runTurn: deps.runTurn || null,
      logger: deps.logger || logger,
    };
  }

  on(eventName, listener) {
    this.events.on(eventName, listener);
    return this;
  }

  emit(eventName, payload) {
    const event = createRuntimeEvent(eventName, payload, {
      kind: this.kind,
      sessionId: this.policy?.sessionId || null,
    });
    this.events.emit(eventName, event);
  }

  async resumeSession(sessionId) {
    const nextSessionId = sessionId || this.policy.sessionId;
    if (!nextSessionId) {
      throw new Error("resumeSession requires a sessionId.");
    }

    this.policy = {
      ...this.policy,
      sessionId: nextSessionId,
    };
    this.context = createRuntimeContext({
      kind: this.kind,
      policy: this.policy,
      config: this.config,
    });

    this.emit(RUNTIME_EVENTS.SESSION_RESUME, {
      kind: this.kind,
      sessionId: nextSessionId,
    });

    if (this.kind === "chat") {
      return this.startChatSession();
    }
    if (this.kind === "agent") {
      return this.startAgentSession();
    }

    throw new Error(
      `resumeSession is not supported for runtime kind "${this.kind}".`,
    );
  }

  async runTurn(input, meta = {}) {
    if (typeof this.deps.runTurn !== "function") {
      throw new Error(
        `runTurn is not configured for runtime kind "${this.kind}".`,
      );
    }

    const startedAt = Date.now();
    this.emit(
      RUNTIME_EVENTS.TURN_START,
      createAgentTurnRecord({
        kind: this.kind,
        input,
        meta,
        sessionId: this.policy.sessionId || null,
        startedAt,
      }),
    );

    const result = await this.deps.runTurn({
      input,
      meta,
      kind: this.kind,
      policy: this.policy,
      context: this.context,
    });

    this.emit(
      RUNTIME_EVENTS.TURN_END,
      createAgentTurnRecord({
        kind: this.kind,
        input,
        meta,
        result,
        sessionId: this.policy.sessionId || null,
        startedAt,
        endedAt: Date.now(),
      }),
    );

    return result;
  }

  async startAgentSession() {
    this.emit(RUNTIME_EVENTS.RUNTIME_START, {
      kind: this.kind,
      policy: this.policy,
    });
    this.emit(RUNTIME_EVENTS.SESSION_START, {
      kind: this.kind,
      sessionId: this.policy.sessionId || null,
    });
    return this.deps.startAgentRepl(this.policy);
  }

  async startChatSession() {
    this.emit(RUNTIME_EVENTS.RUNTIME_START, {
      kind: this.kind,
      policy: this.policy,
    });
    this.emit(RUNTIME_EVENTS.SESSION_START, {
      kind: this.kind,
      sessionId: this.policy.sessionId || null,
    });
    return this.deps.startChatRepl(this.policy);
  }

  async startServer() {
    const { logger: runtimeLogger } = this.deps;
    const {
      port,
      maxConnections,
      timeout,
      token,
      allowRemote,
      project,
      httpPort,
    } = this.policy;
    let { host } = this.policy;

    if (Number.isNaN(port) || port < 1 || port > 65535) {
      throw new Error("Invalid port number. Must be between 1 and 65535.");
    }

    if (allowRemote) {
      if (!token) {
        throw new Error("--allow-remote requires --token for security.");
      }
      host = "0.0.0.0";
    }

    let db = null;
    let rawDb = null;
    try {
      const ctx = await this.deps.bootstrap({ skipDb: false });
      rawDb = ctx.db?.getDatabase?.() || ctx.db?.getDb?.() || null;
      db = rawDb;
    } catch (_err) {
      runtimeLogger.log(
        chalk.yellow(
          "  Warning: Database not available, sessions will be in-memory only",
        ),
      );
    }

    const appConfig = this.deps.loadConfig();
    const mcpClient = await this._initializeCodingAgentMcpClient(rawDb, {
      logger: runtimeLogger,
    });

    // Deep Agents Deploy: load agent bundle if --bundle provided.
    // Bundle's AGENTS.md becomes defaultSystemPromptExtension for all new sessions.
    // Bundle's MCP servers are connected to the shared mcpClient.
    let bundleResolved = null;
    let bundleMcpClient = mcpClient;
    if (this.policy.bundlePath) {
      try {
        const { loadBundle } =
          await import("@chainlesschain/session-core/agent-bundle-loader");
        const { resolveBundle } =
          await import("@chainlesschain/session-core/agent-bundle-resolver");
        const bundle = loadBundle(this.policy.bundlePath);
        bundleResolved = resolveBundle(bundle);

        // Connect bundle MCP servers
        const bundleServers = bundleResolved.mcpConfig?.servers;
        if (bundleServers && typeof bundleServers === "object") {
          const entries = Object.entries(bundleServers).filter(
            ([, cfg]) => cfg && cfg.command,
          );
          if (entries.length > 0) {
            if (!bundleMcpClient) {
              bundleMcpClient = this.deps.createMcpClient();
            }
            for (const [name, cfg] of entries) {
              try {
                await bundleMcpClient.connect(name, cfg);
              } catch (mcpErr) {
                runtimeLogger.log(
                  chalk.yellow(
                    `  Bundle MCP: "${name}" connect failed — ${mcpErr.message}`,
                  ),
                );
              }
            }
          }
        }

        const bid = bundleResolved.manifest?.id || "unknown";
        runtimeLogger.log(chalk.gray(`  Bundle: loaded ${bid}`));
      } catch (bundleErr) {
        runtimeLogger.log(
          chalk.red(`  Bundle: failed to load — ${bundleErr.message}`),
        );
      }
    }

    const sessionManager = this.deps.createSessionManager({
      db,
      defaultProjectRoot: project,
      config: appConfig,
      mcpClient: bundleMcpClient,
      allowedMcpServerNames: DEFAULT_ALLOWED_MCP_SERVER_NAMES,
      mcpServerRegistry: this.deps.mcpServerRegistry,
      defaultSystemPromptExtension: bundleResolved?.systemPrompt || null,
    });

    let envelopeBus = null;
    let httpServer = null;
    if (httpPort) {
      if (Number.isNaN(httpPort) || httpPort < 1 || httpPort > 65535) {
        throw new Error("Invalid --http-port. Must be between 1 and 65535.");
      }
      const { createEnvelopeBus, createEnvelopeHttpServer } =
        await import("../gateways/http/envelope-http-server.js");
      envelopeBus = createEnvelopeBus();
      httpServer = createEnvelopeHttpServer({
        bus: envelopeBus,
        port: httpPort,
        host,
        token,
      });
    }

    const server = this.deps.createServer({
      port,
      host,
      token,
      maxConnections,
      timeout,
      sessionManager,
      envelopeBus,
    });

    server.on("connection", ({ clientId, ip }) => {
      runtimeLogger.log(
        chalk.green(`  + Client connected: ${clientId} (${ip})`),
      );
    });

    server.on("disconnection", ({ clientId, reason }) => {
      const extra = reason ? ` (${reason})` : "";
      runtimeLogger.log(
        chalk.yellow(`  - Client disconnected: ${clientId}${extra}`),
      );
    });

    server.on("command:start", ({ id, command }) => {
      runtimeLogger.log(chalk.cyan(`  > [${id}] ${command}`));
    });

    server.on("command:end", ({ id, exitCode }) => {
      const color = exitCode === 0 ? chalk.green : chalk.red;
      runtimeLogger.log(color(`  < [${id}] exit ${exitCode}`));
    });

    server.on("session:create", ({ sessionId, type }) => {
      runtimeLogger.log(
        chalk.green(`  + Session created: ${sessionId} (${type})`),
      );
    });

    server.on("session:close", ({ sessionId }) => {
      runtimeLogger.log(chalk.yellow(`  - Session closed: ${sessionId}`));
    });

    const shutdownHandler = async () => {
      runtimeLogger.log(
        "\n" + chalk.yellow("Shutting down WebSocket server..."),
      );
      if (
        bundleMcpClient &&
        bundleMcpClient !== mcpClient &&
        typeof bundleMcpClient.disconnectAll === "function"
      ) {
        await bundleMcpClient.disconnectAll().catch(() => undefined);
      }
      if (mcpClient && typeof mcpClient.disconnectAll === "function") {
        await mcpClient.disconnectAll().catch(() => undefined);
      }
      await server.stop();
      if (httpServer) {
        try {
          await httpServer.stop();
        } catch (_e) {
          // non-critical
        }
      }
      process.exit(0);
    };

    process.on("SIGINT", shutdownHandler);
    process.on("SIGTERM", shutdownHandler);

    await server.start();

    let hostedHttp = null;
    if (httpServer) {
      hostedHttp = await httpServer.start();
    }

    this.emit(RUNTIME_EVENTS.RUNTIME_START, {
      kind: this.kind,
      policy: { ...this.policy, host },
    });
    this.emit(RUNTIME_EVENTS.SERVER_START, {
      host,
      port,
      project,
    });

    runtimeLogger.log("");
    runtimeLogger.log(chalk.bold("  ChainlessChain WebSocket Server"));
    runtimeLogger.log("");
    runtimeLogger.log(`  Address:  ${chalk.cyan(`ws://${host}:${port}`)}`);
    if (hostedHttp) {
      runtimeLogger.log(
        `  HTTP SSE: ${chalk.cyan(`http://${hostedHttp.host}:${hostedHttp.port}/v1/sessions/:id/events`)}`,
      );
    }
    runtimeLogger.log(
      `  Auth:     ${token ? chalk.green("enabled") : chalk.yellow("disabled")}`,
    );
    runtimeLogger.log(`  Sessions: ${chalk.green("enabled")}`);
    runtimeLogger.log(`  Project:  ${project}`);
    if (bundleResolved) {
      runtimeLogger.log(
        `  Bundle:   ${chalk.green(bundleResolved.manifest?.id || "loaded")}`,
      );
    }
    runtimeLogger.log(`  Max conn: ${maxConnections}`);
    runtimeLogger.log(`  Timeout:  ${timeout}ms`);
    runtimeLogger.log("");
    runtimeLogger.log(chalk.dim("  Press Ctrl+C to stop"));
    runtimeLogger.log("");

    return server;
  }

  async startUiServer() {
    const { logger: runtimeLogger } = this.deps;
    const httpPort = this.policy.port;
    const wsPort = this.policy.wsPort;
    const host = this.policy.host;

    if (Number.isNaN(httpPort) || httpPort < 1 || httpPort > 65535) {
      throw new Error("Invalid --port. Must be between 1 and 65535.");
    }
    if (Number.isNaN(wsPort) || wsPort < 1 || wsPort > 65535) {
      throw new Error("Invalid --ws-port. Must be between 1 and 65535.");
    }

    const projectRoot = this.deps.findProjectRoot(process.cwd());
    const projectConfig = projectRoot
      ? this.deps.loadProjectConfig(projectRoot)
      : null;
    const projectName =
      projectConfig?.name || (projectRoot ? path.basename(projectRoot) : null);
    const mode = projectRoot ? "project" : "global";

    let db = null;
    let rawDb = null;
    try {
      const ctx = await this.deps.bootstrap({ skipDb: false });
      rawDb = ctx.db?.getDatabase?.() || ctx.db?.getDb?.() || null;
      db = rawDb;
    } catch (_err) {
      runtimeLogger.log(
        chalk.yellow(
          "  Warning: Database not available, sessions will be in-memory only",
        ),
      );
    }

    const appConfig = this.deps.loadConfig();
    const mcpClient = await this._initializeCodingAgentMcpClient(rawDb, {
      logger: runtimeLogger,
    });
    const sessionManager = this.deps.createSessionManager({
      db,
      defaultProjectRoot: projectRoot || process.cwd(),
      config: appConfig,
      mcpClient,
      allowedMcpServerNames: DEFAULT_ALLOWED_MCP_SERVER_NAMES,
      mcpServerRegistry: this.deps.mcpServerRegistry,
    });

    // Bind the WS server with port-fallback so multiple `cc ui` instances
    // (or a desktop web-shell already running on 18800) don't crash this
    // one. listenWithPortFallback walks preferred → +20 adjacent → OS-
    // assigned. The WS server's listen handler updates `wsServer.port` to
    // the actual bound port; we read that back for the HTTP injection.
    let wsServer = null;
    await listenWithPortFallback(
      async (port) => {
        const candidate = this.deps.createServer({
          port,
          host,
          token: this.policy.token,
          maxConnections: 20,
          timeout: 60000,
          sessionManager,
        });
        // ChainlessChainWSServer extends EventEmitter and emits "error"
        // synchronously on bind failure (in addition to rejecting start()).
        // Without a listener Node throws "Unhandled 'error' event" before
        // our reject can settle — crashing the whole process before
        // listenWithPortFallback can catch EADDRINUSE and try the next port.
        // Attach a no-op so the rejection from start() is the single
        // source of failure visibility.
        candidate.on("error", () => {});
        try {
          await candidate.start();
        } catch (err) {
          // Best-effort cleanup so the failed candidate doesn't leak
          // listeners before we retry on the next port.
          try {
            await candidate.stop();
          } catch {
            /* candidate never bound */
          }
          throw err;
        }
        wsServer = candidate;
        return candidate;
      },
      wsPort,
      {
        onFallback: (msg) => runtimeLogger.log(chalk.yellow(`  [WS] ${msg}`)),
      },
    );

    const actualWsPort = wsServer.port;

    // Plan A remote-terminal mirror (cc ui parity with desktop web-shell):
    // attach terminal.* topic handlers to the freshly-started server. The
    // attachTopicHandlers helper mutates server._dispatcher to route
    // matching topics through `terminalHandlers.handlers`, falling back to
    // the original CLI dispatcher for everything else.
    const wsBroadcastRef = { current: null };
    const ptyManager = new PtyManager();
    const terminal = createTerminalHandlers({
      ptyManager,
      broadcast: (frame) => wsBroadcastRef.current?.(frame),
    });
    const attached = attachTopicHandlers(wsServer, {
      handlers: terminal.handlers,
    });
    wsBroadcastRef.current = attached.broadcast;
    terminal.attachServerEvents();
    // Stash for SIGINT cleanup below (PtyManager.shutdown kills all PTYs;
    // important on Ctrl+C so node-pty children don't outlive cc ui).
    this._terminalCleanup = () => {
      try {
        ptyManager.shutdown();
      } catch {
        /* best effort during teardown */
      }
    };

    const httpServer = this.deps.createWebServer({
      wsPort: actualWsPort,
      wsToken: this.policy.token,
      wsHost: host === "0.0.0.0" ? "127.0.0.1" : host,
      projectRoot,
      projectName,
      mode,
      staticDir: this.policy.webPanelDir,
      uiMode: this.policy.uiMode,
    });

    // Same fallback for HTTP. http.Server.listen takes (port, host, cb)
    // and emits "error" once on bind failure; race them and surface the
    // bound port back to the helper so it can decide whether to retry.
    const actualHttpPort = await listenWithPortFallback(
      (port) =>
        new Promise((resolve, reject) => {
          const onError = (err) => {
            httpServer.removeListener("listening", onListening);
            reject(err);
          };
          const onListening = () => {
            httpServer.removeListener("error", onError);
            const addr = httpServer.address();
            const bound =
              addr && typeof addr === "object" && addr.port ? addr.port : port;
            resolve(bound);
          };
          httpServer.once("error", onError);
          httpServer.once("listening", onListening);
          httpServer.listen(port, host);
        }),
      httpPort,
      {
        onFallback: (msg) => runtimeLogger.log(chalk.yellow(`  [HTTP] ${msg}`)),
      },
    );

    const uiUrl = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${actualHttpPort}`;

    this.emit(RUNTIME_EVENTS.RUNTIME_START, {
      kind: this.kind,
      policy: this.policy,
    });
    this.emit(RUNTIME_EVENTS.SERVER_START, {
      host,
      port: actualHttpPort,
      wsPort: actualWsPort,
      mode,
      projectRoot,
    });

    runtimeLogger.log("");
    runtimeLogger.log(chalk.bold("  ChainlessChain 管理面板"));
    runtimeLogger.log("");
    if (mode === "project") {
      runtimeLogger.log(
        `  Mode:     ${chalk.cyan("project")}  ${chalk.dim(projectRoot)}`,
      );
      if (projectName) {
        runtimeLogger.log(`  Project:  ${chalk.green(projectName)}`);
      }
    } else {
      runtimeLogger.log(`  Mode:     ${chalk.cyan("global")}`);
    }
    runtimeLogger.log(`  UI:       ${chalk.cyan(uiUrl)}`);
    runtimeLogger.log(
      `  WS:       ${chalk.dim(`ws://${host}:${actualWsPort}`)}`,
    );
    runtimeLogger.log(
      `  Auth:     ${this.policy.token ? chalk.green("enabled") : chalk.yellow("disabled")}`,
    );
    runtimeLogger.log("");
    runtimeLogger.log(chalk.dim("  Press Ctrl+C to stop"));
    runtimeLogger.log("");

    if (this.policy.open) {
      this.deps.openBrowser(uiUrl);
    }

    const shutdown = async () => {
      runtimeLogger.log("\n" + chalk.yellow("Shutting down UI server..."));
      if (mcpClient && typeof mcpClient.disconnectAll === "function") {
        await mcpClient.disconnectAll().catch(() => undefined);
      }
      // Kill all PTY sessions before WS so the SPA gets clean terminal.exit
      // frames; without this, node-pty children would outlive cc ui until
      // their OS parent (the cc ui process) actually exits.
      this._terminalCleanup?.();
      await Promise.all([
        new Promise((resolve) => httpServer.close(resolve)),
        wsServer.stop(),
      ]);
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    return {
      wsServer,
      httpServer,
      uiUrl,
      mode,
      projectRoot,
      projectName,
    };
  }

  async _initializeCodingAgentMcpClient(db, options = {}) {
    if (!db) {
      return null;
    }

    const trustedMcpServers = createTrustedMcpServerMap(
      this.deps.mcpServerRegistry,
    );
    const configStore = this.deps.createMcpServerConfig(db);
    const autoConnectServers =
      typeof configStore?.getAutoConnect === "function"
        ? configStore.getAutoConnect()
        : [];
    const eligibleServers = autoConnectServers.filter(
      (server) =>
        resolveMcpServerPolicy(
          server?.name,
          { state: "connected" },
          {
            allowedMcpServerNames: DEFAULT_ALLOWED_MCP_SERVER_NAMES,
            trustedMcpServers,
          },
        ).allowed,
    );

    if (eligibleServers.length === 0) {
      return null;
    }

    const mcpClient = this.deps.createMcpClient();
    let connectedCount = 0;

    for (const server of eligibleServers) {
      try {
        await mcpClient.connect(server.name, server);
        connectedCount += 1;
      } catch (err) {
        options.logger?.log?.(
          chalk.yellow(
            `  Warning: MCP server "${server.name}" auto-connect failed: ${err.message}`,
          ),
        );
      }
    }

    if (connectedCount === 0) {
      if (typeof mcpClient.disconnectAll === "function") {
        await mcpClient.disconnectAll().catch(() => undefined);
      }
      return null;
    }

    return mcpClient;
  }
}
