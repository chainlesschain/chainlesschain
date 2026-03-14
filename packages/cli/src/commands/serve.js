/**
 * serve command — start a WebSocket server for remote CLI access
 * chainlesschain serve [--port] [--host] [--token] [--max-connections] [--timeout] [--allow-remote]
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { ChainlessChainWSServer } from "../lib/ws-server.js";

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
    .action(async (opts) => {
      const port = parseInt(opts.port, 10);
      const maxConnections = parseInt(opts.maxConnections, 10);
      const timeout = parseInt(opts.timeout, 10);
      let host = opts.host;

      // Validation
      if (isNaN(port) || port < 1 || port > 65535) {
        logger.error("Invalid port number. Must be between 1 and 65535.");
        process.exit(1);
      }

      if (opts.allowRemote) {
        if (!opts.token) {
          logger.error("--allow-remote requires --token for security.");
          process.exit(1);
        }
        host = "0.0.0.0";
      }

      const server = new ChainlessChainWSServer({
        port,
        host,
        token: opts.token || null,
        maxConnections,
        timeout,
      });

      // Event logging
      server.on("connection", ({ clientId, ip }) => {
        logger.log(chalk.green(`  + Client connected: ${clientId} (${ip})`));
      });

      server.on("disconnection", ({ clientId, reason }) => {
        const extra = reason ? ` (${reason})` : "";
        logger.log(
          chalk.yellow(`  - Client disconnected: ${clientId}${extra}`),
        );
      });

      server.on("command:start", ({ id, command }) => {
        logger.log(chalk.cyan(`  > [${id}] ${command}`));
      });

      server.on("command:end", ({ id, exitCode }) => {
        const color = exitCode === 0 ? chalk.green : chalk.red;
        logger.log(color(`  < [${id}] exit ${exitCode}`));
      });

      // Graceful shutdown
      const shutdown = async () => {
        logger.log("\n" + chalk.yellow("Shutting down WebSocket server..."));
        await server.stop();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      try {
        await server.start();

        logger.log("");
        logger.log(chalk.bold("  ChainlessChain WebSocket Server"));
        logger.log("");
        logger.log(`  Address:  ${chalk.cyan(`ws://${host}:${port}`)}`);
        logger.log(
          `  Auth:     ${opts.token ? chalk.green("enabled") : chalk.yellow("disabled")}`,
        );
        logger.log(`  Max conn: ${maxConnections}`);
        logger.log(`  Timeout:  ${timeout}ms`);
        logger.log("");
        logger.log(chalk.dim("  Press Ctrl+C to stop"));
        logger.log("");
      } catch (err) {
        logger.error(`Failed to start server: ${err.message}`);
        process.exit(1);
      }
    });
}
