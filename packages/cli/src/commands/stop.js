import { stopApp, isAppRunning } from "../lib/process-manager.js";
import {
  servicesDown,
  findComposeFile,
  isDockerAvailable,
} from "../lib/service-manager.js";
import logger from "../lib/logger.js";

export function registerStopCommand(program) {
  program
    .command("stop")
    .description("Stop ChainlessChain")
    .option("--services", "Stop Docker services only")
    .option("--all", "Stop both app and Docker services")
    .action(async (options) => {
      try {
        if (options.services || options.all) {
          if (isDockerAvailable()) {
            const composePath = findComposeFile([
              process.cwd(),
              "backend/docker",
            ]);
            if (composePath) {
              logger.info("Stopping Docker services...");
              servicesDown(composePath);
              logger.success("Docker services stopped");
            } else {
              logger.warn("docker-compose.yml not found");
            }
          } else {
            logger.warn("Docker not available");
          }
        }

        if (!options.services) {
          if (isAppRunning()) {
            logger.info("Stopping ChainlessChain...");
            stopApp();
            logger.success("ChainlessChain stopped");
          } else {
            logger.info("ChainlessChain is not running");
          }
        }
      } catch (err) {
        logger.error(`Failed to stop: ${err.message}`);
        process.exit(1);
      }
    });
}
