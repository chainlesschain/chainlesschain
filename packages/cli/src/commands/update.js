import chalk from "chalk";
import { execSync } from "node:child_process";
import { checkForUpdates } from "../lib/version-checker.js";
import { downloadRelease } from "../lib/downloader.js";
import { VERSION } from "../constants.js";
import { askConfirm } from "../lib/prompts.js";
import logger from "../lib/logger.js";

async function selfUpdateCli(targetVersion) {
  if (VERSION === targetVersion) {
    return; // Already at the target version
  }

  try {
    logger.info("Updating CLI package...");
    execSync(`npm install -g chainlesschain@${targetVersion}`, {
      encoding: "utf-8",
      stdio: "pipe",
    });
    logger.success(`CLI updated to v${targetVersion}`);
  } catch (_err) {
    // npm global install may fail due to permissions; guide the user
    logger.warn(
      `CLI self-update failed. Please run manually:\n  npm install -g chainlesschain@${targetVersion}`,
    );
  }
}

export function registerUpdateCommand(program) {
  program
    .command("update")
    .description("Check for and install updates")
    .option("--check", "Only check for updates (do not download)")
    .option(
      "--channel <channel>",
      "Release channel: stable, beta, dev",
      "stable",
    )
    .option("--force", "Re-download even if binary exists")
    .action(async (options) => {
      try {
        logger.info(`Current version: ${VERSION}`);
        logger.info(`Channel: ${options.channel}`);
        logger.newline();

        const result = await checkForUpdates({ channel: options.channel });

        if (result.error) {
          logger.warn(`Update check failed: ${result.error}`);
          return;
        }

        if (!result.updateAvailable) {
          logger.success("You are on the latest version");
          return;
        }

        logger.log(
          chalk.bold(
            `\n  Update available: ${result.currentVersion} → ${chalk.green(result.latestVersion)}\n`,
          ),
        );

        if (result.publishedAt) {
          logger.log(
            `  Published: ${new Date(result.publishedAt).toLocaleDateString()}`,
          );
        }
        if (result.releaseUrl) {
          logger.log(`  Release: ${result.releaseUrl}`);
        }
        logger.newline();

        if (options.check) {
          return;
        }

        const doUpdate = await askConfirm(
          `Download v${result.latestVersion}?`,
          true,
        );
        if (!doUpdate) {
          logger.info("Update cancelled");
          return;
        }

        await downloadRelease(result.latestVersion, { force: options.force });

        // Self-update the CLI npm package
        await selfUpdateCli(result.latestVersion);

        logger.success(`Updated to v${result.latestVersion}`);
        logger.info("Restart ChainlessChain to use the new version.");
      } catch (err) {
        if (err.name === "ExitPromptError") {
          logger.log("\nUpdate cancelled.");
          process.exit(0);
        }
        logger.error(`Update failed: ${err.message}`);
        process.exit(1);
      }
    });
}
