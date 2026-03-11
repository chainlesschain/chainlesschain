import chalk from "chalk";
import { startApp, isAppRunning } from "../lib/process-manager.js";
import {
  servicesUp,
  findComposeFile,
  isDockerAvailable,
} from "../lib/service-manager.js";
import { loadConfig } from "../lib/config-manager.js";
import logger from "../lib/logger.js";

export function registerStartCommand(program) {
  program
    .command("start")
    .description("Launch ChainlessChain desktop application")
    .option("--headless", "Start backend services only (no GUI)")
    .option("--services", "Also start Docker services")
    .action(async (options) => {
      try {
        const config = loadConfig();

        if (!config.setupCompleted) {
          logger.warn('Setup not completed. Run "chainlesschain setup" first.');
          process.exit(1);
        }

        if (options.services || options.headless) {
          if (!isDockerAvailable()) {
            logger.error(
              "Docker is required for --headless and --services modes",
            );
            process.exit(1);
          }
          const composePath = findComposeFile([
            process.cwd(),
            "backend/docker",
          ]);
          if (composePath) {
            logger.info("Starting Docker services...");
            servicesUp(composePath);
            logger.success("Docker services started");
          } else {
            logger.warn("docker-compose.yml not found");
          }
        }

        if (!options.headless) {
          if (isAppRunning()) {
            logger.info("ChainlessChain is already running");
            return;
          }

          logger.info("Starting ChainlessChain...");
          const pid = startApp({ headless: false });

          if (pid) {
            logger.success(`ChainlessChain started (PID: ${pid})`);
          } else {
            logger.warn("App was already running");
          }
        } else {
          logger.success("Backend services running in headless mode");
        }
      } catch (err) {
        logger.error(`Failed to start: ${err.message}`);
        process.exit(1);
      }
    });
}
