import chalk from "chalk";
import semver from "semver";
import { checkForUpdates } from "../lib/version-checker.js";
import { downloadRelease } from "../lib/downloader.js";
import { VERSION } from "../constants.js";
import { askConfirm } from "../lib/prompts.js";
import logger from "../lib/logger.js";
import { executionBroker } from "../lib/process-execution-broker/index.js";
import { resolveNpmInvocation } from "../lib/npm-invocation.js";

export const _deps = {
  platform: process.platform,
  execPath: process.execPath,
  cliEntryPath: process.argv[1] || null,
  spawnSync: (...args) => executionBroker.spawnSync(...args),
};

export function updateProcessInvocations(
  platform = _deps.platform,
  execPath = _deps.execPath,
  cliEntryPath = _deps.cliEntryPath,
) {
  return {
    npm: resolveNpmInvocation({ platform, execPath }),
    chainlesschain: cliEntryPath
      ? { command: execPath, prefixArgs: [cliEntryPath] }
      : {
          command:
            platform === "win32" ? "chainlesschain.cmd" : "chainlesschain",
          prefixArgs: [],
        },
  };
}

function runUpdateProcess(command, args, origin) {
  const result = _deps.spawnSync(command, args, {
    encoding: "utf-8",
    stdio: "pipe",
    origin,
    policy: "allow",
    scope: "update",
    shell: false,
  });
  if (result?.error) throw result.error;
  if (result?.status != null && result.status !== 0) {
    const error = new Error(
      `Update process failed (exit ${result.status}): ${command}`,
    );
    error.status = result.status;
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  return String(result?.stdout || "");
}

/**
 * A version that is safe to interpolate into `npm install -g chainlesschain@<v>`.
 * The version reaching selfUpdateCli already comes from version-checker (gated by
 * semver.gt), but it flows UNQUOTED into a shell command, so validate it locally
 * too: a strict semver can only contain [0-9A-Za-z.+-] — never a shell
 * metacharacter — so this makes shell-injection impossible at the point of use
 * rather than relying solely on a check in another module.
 */
export function isInstallableVersion(v) {
  return typeof v === "string" && semver.valid(v) !== null;
}

export async function selfUpdateCli(targetVersion) {
  if (VERSION === targetVersion) {
    return true; // Already at the target version
  }

  if (!isInstallableVersion(targetVersion)) {
    logger.warn(
      `Refusing to self-update to an invalid version: ${String(targetVersion).slice(0, 60)}`,
    );
    return false;
  }

  try {
    logger.info("Updating CLI package...");
    const invocations = updateProcessInvocations();
    runUpdateProcess(
      invocations.npm.command,
      [
        ...invocations.npm.prefixArgs,
        "install",
        "-g",
        `chainlesschain@${targetVersion}`,
      ],
      "update:npm-install",
    );
    // Verify the update actually took effect
    try {
      const newVersion = runUpdateProcess(
        invocations.chainlesschain.command,
        [...invocations.chainlesschain.prefixArgs, "--version"],
        "update:version-check",
      ).trim();
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
        logger.success(`Downloaded v${result.latestVersion}`);

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
