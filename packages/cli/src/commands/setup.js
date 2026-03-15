import chalk from "chalk";
import ora from "ora";
import semver from "semver";
import {
  MIN_NODE_VERSION,
  LLM_PROVIDERS,
  EDITIONS,
  VERSION,
} from "../constants.js";
import { ensureHomeDir, getConfigPath } from "../lib/paths.js";
import { loadConfig, saveConfig } from "../lib/config-manager.js";
import {
  isDockerAvailable,
  isDockerComposeAvailable,
  servicesUp,
  findComposeFile,
} from "../lib/service-manager.js";
import { downloadRelease } from "../lib/downloader.js";
import {
  askConfirm,
  askSelect,
  askInput,
  askPassword,
} from "../lib/prompts.js";
import logger from "../lib/logger.js";

export function registerSetupCommand(program) {
  program
    .command("setup")
    .description("Interactive setup wizard for ChainlessChain")
    .option("--skip-download", "Skip binary download")
    .option("--skip-services", "Skip Docker service setup")
    .action(async (options) => {
      try {
        await runSetup(options);
      } catch (err) {
        if (err.name === "ExitPromptError") {
          logger.log("\nSetup cancelled.");
          process.exit(0);
        }
        logger.error(`Setup failed: ${err.message}`);
        process.exit(1);
      }
    });
}

async function runSetup(options) {
  logger.log(chalk.bold("\n  ChainlessChain Setup Wizard\n"));
  logger.log(`  Version: ${VERSION}`);
  logger.log(`  Config: ${getConfigPath()}\n`);

  // Step 1: Check Node version
  const nodeVersion = process.versions.node;
  if (!semver.gte(nodeVersion, MIN_NODE_VERSION)) {
    logger.error(
      `Node.js ${MIN_NODE_VERSION}+ required (current: ${nodeVersion})`,
    );
    process.exit(1);
  }
  logger.success(`Node.js ${nodeVersion}`);

  // Step 2: Check Docker
  const dockerOk = isDockerAvailable();
  const composeOk = isDockerComposeAvailable();
  if (dockerOk) {
    logger.success("Docker available");
  } else {
    logger.warn("Docker not found (optional - needed for backend services)");
  }
  if (composeOk) {
    logger.success("Docker Compose available");
  }

  // Step 3: Ensure home directory
  ensureHomeDir();
  logger.success("Configuration directory ready");
  logger.newline();

  // Step 4: Select edition
  const edition = await askSelect("Select edition:", [
    {
      name: `${EDITIONS.personal.name} - ${EDITIONS.personal.description}`,
      value: "personal",
    },
    {
      name: `${EDITIONS.enterprise.name} - ${EDITIONS.enterprise.description}`,
      value: "enterprise",
    },
  ]);

  // Step 5: Configure LLM
  const providerChoices = Object.entries(LLM_PROVIDERS).map(([key, info]) => ({
    name: info.name,
    value: key,
  }));
  const provider = await askSelect("Select LLM provider:", providerChoices);
  const providerInfo = LLM_PROVIDERS[provider];

  let apiKey = null;
  let baseUrl = providerInfo.defaultBaseUrl;
  let model = providerInfo.defaultModel;

  if (providerInfo.requiresApiKey) {
    apiKey = await askPassword(`Enter ${providerInfo.name} API key:`);
  }

  if (provider === "custom" || providerInfo.isProxy) {
    baseUrl = await askInput(
      "Enter API base URL:",
      providerInfo.defaultBaseUrl || "",
    );
    model = await askInput(
      "Enter model name:",
      providerInfo.defaultModel || "",
    );
  } else {
    const customizeModel = await askConfirm(
      `Use default model (${model})?`,
      true,
    );
    if (!customizeModel) {
      model = await askInput("Enter model name:");
    }
  }

  // Step 6: Download binary
  if (!options.skipDownload) {
    logger.newline();
    const doDownload = await askConfirm(
      "Download ChainlessChain desktop application?",
      true,
    );
    if (doDownload) {
      try {
        await downloadRelease(VERSION);
      } catch (err) {
        logger.warn(`Download failed: ${err.message}`);
        logger.info(
          "You can download manually later with: chainlesschain update",
        );
      }
    }
  }

  // Step 7: Save config
  const config = loadConfig();
  config.setupCompleted = true;
  config.completedAt = new Date().toISOString();
  config.edition = edition;
  config.llm.provider = provider;
  config.llm.apiKey = apiKey;
  config.llm.baseUrl = baseUrl;
  config.llm.model = model;
  saveConfig(config);
  logger.success("Configuration saved");

  // Step 8: Docker services
  if (!options.skipServices && dockerOk && composeOk) {
    logger.newline();
    const startServices = await askConfirm(
      "Start Docker backend services?",
      false,
    );
    if (startServices) {
      const composePath = findComposeFile([process.cwd(), "backend/docker"]);
      if (composePath) {
        const spinner = ora("Starting services...").start();
        try {
          servicesUp(composePath);
          spinner.succeed("Docker services started");
        } catch (err) {
          spinner.fail(`Failed to start services: ${err.message}`);
        }
      } else {
        logger.warn(
          'docker-compose.yml not found. Run from the project root or use "chainlesschain services up".',
        );
      }
    }
  }

  // Done
  logger.newline();
  logger.log(chalk.bold.green("  Setup complete!\n"));
  logger.log("  Next steps:");
  logger.log(
    `    ${chalk.cyan("chainlesschain start")}      Launch the desktop app`,
  );
  logger.log(
    `    ${chalk.cyan("chainlesschain services up")} Start backend services`,
  );
  logger.log(
    `    ${chalk.cyan("chainlesschain status")}     Check system status`,
  );
  logger.log(
    `    ${chalk.cyan("chainlesschain doctor")}     Diagnose environment`,
  );
  logger.newline();
}
