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
import { bootstrap } from "./bootstrap.js";
import { startAgentRepl } from "../gateways/repl/agent-repl.js";
import { startChatRepl } from "../gateways/repl/chat-repl.js";
import { ChainlessChainWSServer } from "../gateways/ws/ws-server.js";
import { WSSessionManager } from "../gateways/ws/ws-session-gateway.js";
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
    const { port, maxConnections, timeout, token, allowRemote, project } =
      this.policy;
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

    const mcpClient = await this._initializeCodingAgentMcpClient(rawDb, {
      logger: runtimeLogger,
    });

    const sessionManager = this.deps.createSessionManager({
      db,
      defaultProjectRoot: project,
      mcpClient,
      allowedMcpServerNames: DEFAULT_ALLOWED_MCP_SERVER_NAMES,
      mcpServerRegistry: this.deps.mcpServerRegistry,
    });

    const server = this.deps.createServer({
      port,
      host,
      token,
      maxConnections,
      timeout,
      sessionManager,
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
      if (mcpClient && typeof mcpClient.disconnectAll === "function") {
        await mcpClient.disconnectAll().catch(() => undefined);
      }
      await server.stop();
      process.exit(0);
    };

    process.on("SIGINT", shutdownHandler);
    process.on("SIGTERM", shutdownHandler);

    await server.start();

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
    runtimeLogger.log(
      `  Auth:     ${token ? chalk.green("enabled") : chalk.yellow("disabled")}`,
    );
    runtimeLogger.log(`  Sessions: ${chalk.green("enabled")}`);
    runtimeLogger.log(`  Project:  ${project}`);
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

    const wsServer = this.deps.createServer({
      port: wsPort,
      host,
      token: this.policy.token,
      maxConnections: 20,
      timeout: 60000,
      sessionManager,
    });
    await wsServer.start();

    const httpServer = this.deps.createWebServer({
      wsPort,
      wsToken: this.policy.token,
      wsHost: host === "0.0.0.0" ? "127.0.0.1" : host,
      projectRoot,
      projectName,
      mode,
      staticDir: this.policy.webPanelDir,
    });

    await new Promise((resolve, reject) => {
      httpServer.listen(httpPort, host, () => resolve());
      httpServer.on("error", reject);
    });

    const uiUrl = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${httpPort}`;

    this.emit(RUNTIME_EVENTS.RUNTIME_START, {
      kind: this.kind,
      policy: this.policy,
    });
    this.emit(RUNTIME_EVENTS.SERVER_START, {
      host,
      port: httpPort,
      wsPort,
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
    runtimeLogger.log(`  WS:       ${chalk.dim(`ws://${host}:${wsPort}`)}`);
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
