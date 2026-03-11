/**
 * Git integration commands
 * chainlesschain git status|auto-commit|hooks|history-analyze
 */

import chalk from "chalk";
import { resolve } from "path";
import { logger } from "../lib/logger.js";
import {
  gitStatus,
  gitAutoCommit,
  gitLog,
  gitHistoryAnalyze,
  gitInit,
  isGitRepo,
} from "../lib/git-integration.js";

export function registerGitCommand(program) {
  const git = program
    .command("git")
    .description("Git integration for knowledge base versioning");

  // git status
  git
    .command("status")
    .description("Show git status of the knowledge base directory")
    .option("-d, --dir <dir>", "Target directory", ".")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const dir = resolve(options.dir);
        const status = gitStatus(dir);

        if (options.json) {
          console.log(JSON.stringify(status, null, 2));
          return;
        }

        if (!status.isRepo) {
          logger.info(
            `Not a git repository: ${dir}\n  Run ${chalk.cyan("chainlesschain git init")} to initialize.`,
          );
          return;
        }

        logger.log(chalk.bold(`Branch: ${chalk.cyan(status.branch)}`));

        if (status.clean) {
          logger.log(chalk.green("Working tree clean"));
        } else {
          logger.log(`\n${status.files.length} changed file(s):\n`);
          for (const f of status.files) {
            const statusColor =
              f.status === "M"
                ? chalk.yellow
                : f.status === "A" || f.status === "??"
                  ? chalk.green
                  : f.status === "D"
                    ? chalk.red
                    : chalk.white;
            logger.log(`  ${statusColor(f.status.padEnd(3))} ${f.file}`);
          }
        }
      } catch (err) {
        logger.error(`Git status failed: ${err.message}`);
        process.exit(1);
      }
    });

  // git init
  git
    .command("init")
    .description("Initialize a git repository")
    .option("-d, --dir <dir>", "Target directory", ".")
    .action(async (options) => {
      try {
        const dir = resolve(options.dir);
        const result = gitInit(dir);
        if (result.initialized) {
          logger.success(`Initialized git repository in ${chalk.gray(dir)}`);
        } else {
          logger.info(result.message);
        }
      } catch (err) {
        logger.error(`Git init failed: ${err.message}`);
        process.exit(1);
      }
    });

  // git auto-commit
  git
    .command("auto-commit")
    .description("Auto-commit all changes with a generated message")
    .option("-d, --dir <dir>", "Target directory", ".")
    .option("-m, --message <msg>", "Custom commit message")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const dir = resolve(options.dir);
        const result = gitAutoCommit(dir, options.message);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (!result.committed) {
          logger.info(result.message);
        } else {
          logger.success(
            `Committed ${chalk.cyan(result.hash)}: ${result.message}`,
          );
          logger.log(chalk.gray(`  ${result.filesChanged} file(s) changed`));
        }
      } catch (err) {
        logger.error(`Auto-commit failed: ${err.message}`);
        process.exit(1);
      }
    });

  // git hooks
  git
    .command("hooks")
    .description("Install git hooks for the knowledge base")
    .option("-d, --dir <dir>", "Target directory", ".")
    .option("--install", "Install hooks")
    .action(async (options) => {
      try {
        const dir = resolve(options.dir);

        if (!isGitRepo(dir)) {
          logger.error("Not a git repository. Run 'git init' first.");
          process.exit(1);
        }

        if (options.install) {
          const { installHooks } = await import("../lib/git-integration.js");
          const result = installHooks(dir);
          logger.success(
            `Installed ${chalk.cyan(result.hook)} hook at ${chalk.gray(result.path)}`,
          );
        } else {
          logger.info(`Use ${chalk.cyan("--install")} to install git hooks`);
        }
      } catch (err) {
        logger.error(`Hooks failed: ${err.message}`);
        process.exit(1);
      }
    });

  // git history-analyze
  git
    .command("history-analyze")
    .description("Analyze repository history and statistics")
    .option("-d, --dir <dir>", "Target directory", ".")
    .option("-n, --limit <n>", "Recent commits to show", "10")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const dir = resolve(options.dir);

        if (!isGitRepo(dir)) {
          logger.error("Not a git repository");
          process.exit(1);
        }

        const analysis = gitHistoryAnalyze(dir);
        const recentLog = gitLog(dir, parseInt(options.limit));

        if (options.json) {
          console.log(
            JSON.stringify({ ...analysis, recentCommits: recentLog }, null, 2),
          );
          return;
        }

        logger.log(chalk.bold("Repository Analysis\n"));
        logger.log(
          `  ${chalk.gray("Total commits:")} ${analysis.totalCommits}`,
        );
        logger.log(
          `  ${chalk.gray("Tracked files:")} ${analysis.trackedFiles}`,
        );
        if (analysis.firstCommit) {
          logger.log(
            `  ${chalk.gray("First commit:")} ${analysis.firstCommit}`,
          );
        }
        if (analysis.lastCommit) {
          logger.log(`  ${chalk.gray("Last commit:")} ${analysis.lastCommit}`);
        }

        if (analysis.contributors.length > 0) {
          logger.log(chalk.bold("\nContributors:\n"));
          for (const c of analysis.contributors) {
            logger.log(
              `  ${chalk.cyan(c.commits.toString().padStart(4))} ${c.author}`,
            );
          }
        }

        if (recentLog.length > 0) {
          logger.log(chalk.bold("\nRecent Commits:\n"));
          for (const c of recentLog) {
            logger.log(
              `  ${chalk.yellow(c.shortHash)} ${chalk.white(c.subject)} ${chalk.gray(c.date)}`,
            );
          }
        }
      } catch (err) {
        logger.error(`Analysis failed: ${err.message}`);
        process.exit(1);
      }
    });
}
