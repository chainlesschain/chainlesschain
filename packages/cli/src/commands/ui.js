/**
 * ui command — start a local web management UI
 * chainlesschain ui [--port] [--ws-port] [--host] [--no-open] [--token]
 *
 * Project mode  (run from a dir with .chainlesschain/): project-scoped chat UI
 * Global mode   (run from any other dir):               global management panel
 */

import { execSync } from "child_process";
import path from "path";
import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { ChainlessChainWSServer } from "../lib/ws-server.js";
import { WSSessionManager } from "../lib/ws-session-manager.js";
import { createWebUIServer } from "../lib/web-ui-server.js";
import { bootstrap } from "../runtime/bootstrap.js";
import { findProjectRoot, loadProjectConfig } from "../lib/project-detector.js";
import { loadConfig } from "../lib/config-manager.js";

/**
 * Open a URL in the system default browser (cross-platform).
 */
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
    // Non-critical — user can open manually
  }
}

export function registerUiCommand(program) {
  program
    .command("ui")
    .description("Start a local web management UI (project or global mode)")
    .option("-p, --port <port>", "HTTP server port", "18810")
    .option("--ws-port <port>", "WebSocket server port", "18800")
    .option("-H, --host <host>", "Bind host", "127.0.0.1")
    .option("--no-open", "Do not open browser automatically")
    .option(
      "--token <token>",
      "Authentication token for WebSocket (recommended for security)",
    )
    .option(
      "--web-panel-dir <dir>",
      "Path to built web-panel dist/ directory (auto-detected by default)",
    )
    .action(async (opts) => {
      const httpPort = parseInt(opts.port, 10);
      const wsPort = parseInt(opts.wsPort, 10);
      const host = opts.host;

      if (isNaN(httpPort) || httpPort < 1 || httpPort > 65535) {
        logger.error("Invalid --port. Must be between 1 and 65535.");
        process.exit(1);
      }
      if (isNaN(wsPort) || wsPort < 1 || wsPort > 65535) {
        logger.error("Invalid --ws-port. Must be between 1 and 65535.");
        process.exit(1);
      }

      // ── Detect project context ────────────────────────────────────────────
      const projectRoot = findProjectRoot(process.cwd());
      const projectConfig = projectRoot ? loadProjectConfig(projectRoot) : null;
      const projectName =
        projectConfig?.name ||
        (projectRoot ? path.basename(projectRoot) : null);
      const mode = projectRoot ? "project" : "global";

      // ── Bootstrap headless runtime ────────────────────────────────────────
      let db = null;
      try {
        const ctx = await bootstrap({ skipDb: false });
        db = ctx.db?.getDb?.() || null;
      } catch (_err) {
        logger.log(
          chalk.yellow(
            "  Warning: Database not available, sessions will be in-memory only",
          ),
        );
      }

      // ── Start WebSocket server ────────────────────────────────────────────
      const appConfig = loadConfig();
      const sessionManager = new WSSessionManager({
        db,
        defaultProjectRoot: projectRoot || process.cwd(),
        config: appConfig,
      });

      const wsServer = new ChainlessChainWSServer({
        port: wsPort,
        host,
        token: opts.token || null,
        maxConnections: 20,
        timeout: 60000,
        sessionManager,
      });

      try {
        await wsServer.start();
      } catch (err) {
        logger.error(`Failed to start WebSocket server: ${err.message}`);
        process.exit(1);
      }

      // ── Start HTTP server ─────────────────────────────────────────────────
      const httpServer = createWebUIServer({
        wsPort,
        wsToken: opts.token || null,
        wsHost: host === "0.0.0.0" ? "127.0.0.1" : host,
        projectRoot,
        projectName,
        mode,
        staticDir: opts.webPanelDir || null,
      });

      try {
        await new Promise((resolve, reject) => {
          httpServer.listen(httpPort, host, () => resolve());
          httpServer.on("error", reject);
        });
      } catch (err) {
        logger.error(`Failed to start HTTP server: ${err.message}`);
        process.exit(1);
      }

      // ── Print startup info ────────────────────────────────────────────────
      const uiUrl = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${httpPort}`;

      logger.log("");
      logger.log(chalk.bold("  ChainlessChain 管理面板"));
      logger.log("");
      if (mode === "project") {
        logger.log(
          `  Mode:     ${chalk.cyan("project")}  ${chalk.dim(projectRoot)}`,
        );
        if (projectName) {
          logger.log(`  Project:  ${chalk.green(projectName)}`);
        }
      } else {
        logger.log(`  Mode:     ${chalk.cyan("global")}`);
      }
      logger.log(`  UI:       ${chalk.cyan(uiUrl)}`);
      logger.log(`  WS:       ${chalk.dim(`ws://${host}:${wsPort}`)}`);
      logger.log(
        `  Auth:     ${opts.token ? chalk.green("enabled") : chalk.yellow("disabled")}`,
      );
      logger.log("");
      logger.log(chalk.dim("  Press Ctrl+C to stop"));
      logger.log("");

      // ── Open browser ──────────────────────────────────────────────────────
      if (opts.open !== false) {
        openBrowser(uiUrl);
      }

      // ── Graceful shutdown ─────────────────────────────────────────────────
      const shutdown = async () => {
        logger.log("\n" + chalk.yellow("Shutting down UI server..."));
        await Promise.all([
          new Promise((resolve) => httpServer.close(resolve)),
          wsServer.stop(),
        ]);
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });
}
