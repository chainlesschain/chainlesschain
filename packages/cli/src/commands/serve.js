/**
 * serve command — start a WebSocket server for remote CLI access
 * chainlesschain serve [--port] [--host] [--token] [--max-connections] [--timeout] [--allow-remote] [--project]
 */

import { logger } from "../lib/logger.js";
import { createAgentRuntimeFactory } from "../runtime/runtime-factory.js";

export function registerServeCommand(program) {
  program
    .command("serve")
    .description("Start WebSocket server for remote CLI access")
    .option("-p, --port <port>", "Port number", "18800")
    .option("-H, --host <host>", "Bind host", "127.0.0.1")
    .option(
      "--token <token>",
      "Authentication token (required for remote access)",
    )
    .option("--max-connections <n>", "Maximum concurrent connections", "10")
    .option(
      "--timeout <ms>",
      "Command execution timeout in milliseconds",
      "30000",
    )
    .option(
      "--allow-remote",
      "Allow non-localhost connections (requires --token)",
    )
    .option("--project <path>", "Default project root for sessions")
    .option(
      "--http-port <port>",
      "Hosted HTTP port for Phase 5 envelope SSE (disabled if unset)",
    )
    .option(
      "--bundle <path>",
      "Agent bundle directory — applies AGENTS.md, MCP, and approval policy to all sessions",
    )
    .action(async (opts) => {
      try {
        const runtime = createAgentRuntimeFactory().createServerRuntime({
          port: parseInt(opts.port, 10),
          host: opts.host,
          token: opts.token,
          maxConnections: parseInt(opts.maxConnections, 10),
          timeout: parseInt(opts.timeout, 10),
          allowRemote: opts.allowRemote,
          project: opts.project,
          httpPort: opts.httpPort ? parseInt(opts.httpPort, 10) : null,
          bundlePath: opts.bundle || null,
        });
        await runtime.startServer();
      } catch (err) {
        logger.error(`Failed to start server: ${err.message}`);
        process.exit(1);
      }
    });
}
