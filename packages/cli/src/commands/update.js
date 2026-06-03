import chalk from "chalk";
import { execSync } from "node:child_process";
import { checkForUpdates } from "../lib/version-checker.js";
import { downloadRelease } from "../lib/downloader.js";
import { VERSION } from "../constants.js";
import { askConfirm } from "../lib/prompts.js";
import logger from "../lib/logger.js";

async function selfUpdateCli(targetVersion) {
  if (VERSION === targetVersion) {
    return true; // Already at the target version
  }

  try {
    logger.info("Updating CLI package...");
    execSync(`npm install -g chainlesschain@${targetVersion}`, {
      encoding: "utf-8",
      stdio: "pipe",
    });
    // Verify the update actually took effect
    try {
      const newVersion = execSync("chainlesschain --version", {
        encoding: "utf-8",
        stdio: "pipe",
      }).trim();
      if (newVersion === targetVersion) {
        logger.success(`CLI updated to v${targetVersion}`);
        return true;
      }
      logger.warn(
        `CLI update ran but version is still ${newVersion}. Please run manually:\n  npm install -g chainlesschain@${targetVersion}`,
      );
      return false;
    } catch (_verifyErr) {
      // Cannot verify, assume success
      logger.success(`CLI updated to v${targetVersion}`);
      return true;
    }
  } catch (_err) {
    // npm global install may fail due to permissions; guide the user
    logger.warn(
      `CLI self-update failed. Please run manually:\n  npm install -g chainlesschain@${targetVersion}`,
    );
    return false;
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

        // When update source is npm-only (GitHub Release CI still building),
        // skip desktop app download and only update the CLI package
        if (result.source === "npm") {
          logger.info(
            `GitHub Release for v${result.latestVersion} is not yet available (CI may still be building).`,
          );
          logger.info(`Updating CLI package from npm...`);

          const doUpdate = await askConfirm(
            `Update CLI to v${result.latestVersion} via npm?`,
            true,
          );
          if (!doUpdate) {
            logger.info("Update cancelled");
            return;
          }

          const cliUpdated = await selfUpdateCli(result.latestVersion);
          if (cliUpdated) {
            logger.success(`CLI updated to v${result.latestVersion}`);
            logger.info(
              `Desktop app update will be available once GitHub Release CI completes.`,
            );
          } else {
            logger.warn(
              `CLI self-update failed. Please run manually:\n  npm install -g chainlesschain@${result.latestVersion}`,
            );
          }
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
        logger.success("Application already installed");

        // Self-update the CLI npm package
        const cliUpdated = await selfUpdateCli(result.latestVersion);

        if (cliUpdated) {
          logger.success(`Updated to v${result.latestVersion}`);
        } else {
          logger.warn(
            `Application binary updated, but CLI version remains at ${VERSION}.`,
          );
          logger.info(
            `To complete the update, run:\n  npm install -g chainlesschain@${result.latestVersion}`,
          );
        }
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
