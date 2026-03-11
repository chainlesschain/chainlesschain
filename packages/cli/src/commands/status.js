import chalk from "chalk";
import { createConnection } from "node:net";
import { isAppRunning, getAppPid } from "../lib/process-manager.js";
import {
  isDockerAvailable,
  getServiceStatus,
  findComposeFile,
} from "../lib/service-manager.js";
import { loadConfig } from "../lib/config-manager.js";
import { DEFAULT_PORTS } from "../constants.js";
import logger from "../lib/logger.js";

export function registerStatusCommand(program) {
  program
    .command("status")
    .description("Show status of ChainlessChain app and services")
    .action(async () => {
      try {
        const config = loadConfig();

        // App status
        logger.log(chalk.bold("\n  App Status\n"));
        if (isAppRunning()) {
          const pid = getAppPid();
          logger.log(`  ${chalk.green("●")} Desktop app running (PID: ${pid})`);
        } else {
          logger.log(`  ${chalk.gray("○")} Desktop app not running`);
        }

        // Setup status
        if (config.setupCompleted) {
          logger.log(
            `  ${chalk.green("●")} Setup completed (${config.completedAt || "unknown"})`,
          );
          logger.log(`    Edition: ${config.edition}`);
          logger.log(`    LLM: ${config.llm.provider} (${config.llm.model})`);
        } else {
          logger.log(`  ${chalk.yellow("●")} Setup not completed`);
        }

        // Docker services
        logger.log(chalk.bold("\n  Docker Services\n"));
        if (isDockerAvailable()) {
          const composePath = findComposeFile([
            process.cwd(),
            "backend/docker",
          ]);
          if (composePath) {
            const status = getServiceStatus(composePath);
            if (status && Array.isArray(status)) {
              for (const svc of status) {
                const running = svc.State === "running";
                const icon = running ? chalk.green("●") : chalk.red("●");
                logger.log(
                  `  ${icon} ${svc.Service || svc.Name}: ${svc.State}`,
                );
              }
            } else if (status) {
              logger.log(`  ${status}`);
            } else {
              logger.log(`  ${chalk.gray("○")} No services running`);
            }
          } else {
            logger.log(`  ${chalk.gray("○")} docker-compose.yml not found`);
          }
        } else {
          logger.log(`  ${chalk.gray("○")} Docker not available`);
        }

        // Port checks
        logger.log(chalk.bold("\n  Ports\n"));
        const portChecks = Object.entries(DEFAULT_PORTS).map(
          async ([name, port]) => {
            const open = await checkPort(port);
            const icon = open ? chalk.green("●") : chalk.gray("○");
            return `  ${icon} ${name}: ${port}`;
          },
        );
        const results = await Promise.all(portChecks);
        for (const line of results) {
          logger.log(line);
        }

        logger.newline();
      } catch (err) {
        logger.error(`Status check failed: ${err.message}`);
        process.exit(1);
      }
    });
}

function checkPort(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host, timeout: 1000 });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}
