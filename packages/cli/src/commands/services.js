import {
  isDockerAvailable,
  isDockerComposeAvailable,
  servicesUp,
  servicesDown,
  servicesLogs,
  servicesPull,
  findComposeFile,
} from "../lib/service-manager.js";
import logger from "../lib/logger.js";

export function registerServicesCommand(program) {
  const cmd = program
    .command("services")
    .description("Manage Docker backend services");

  cmd
    .command("up")
    .description("Start Docker services")
    .argument("[services...]", "Specific services to start")
    .action(async (services) => {
      await withCompose((composePath) => {
        logger.info("Starting services...");
        servicesUp(composePath, {
          services: services.length ? services : undefined,
        });
        logger.success("Services started");
      });
    });

  cmd
    .command("down")
    .description("Stop Docker services")
    .action(async () => {
      await withCompose((composePath) => {
        logger.info("Stopping services...");
        servicesDown(composePath);
        logger.success("Services stopped");
      });
    });

  cmd
    .command("logs")
    .description("View service logs")
    .option("-f, --follow", "Follow log output")
    .option("--tail <lines>", "Number of lines to show", "100")
    .argument("[services...]", "Specific services")
    .action(async (services, options) => {
      await withCompose(async (composePath) => {
        await servicesLogs(composePath, {
          follow: options.follow,
          tail: options.tail,
          services: services.length ? services : undefined,
        });
      });
    });

  cmd
    .command("pull")
    .description("Pull latest service images")
    .action(async () => {
      await withCompose((composePath) => {
        logger.info("Pulling images...");
        servicesPull(composePath);
        logger.success("Images updated");
      });
    });
}

async function withCompose(fn) {
  try {
    if (!isDockerAvailable()) {
      logger.error("Docker is not installed or not running");
      process.exit(1);
    }
    if (!isDockerComposeAvailable()) {
      logger.error("Docker Compose is not available");
      process.exit(1);
    }

    const composePath = findComposeFile([process.cwd(), "backend/docker"]);
    if (!composePath) {
      logger.error(
        "docker-compose.yml not found. Run from the project root directory.",
      );
      process.exit(1);
    }

    await fn(composePath);
  } catch (err) {
    logger.error(`Service operation failed: ${err.message}`);
    process.exit(1);
  }
}
