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

  _registerGitV2(git);
}


import {
  GIT_REPO_MATURITY_V2, GIT_COMMIT_LIFECYCLE_V2,
  setMaxActiveGitReposPerOwnerV2, setMaxPendingGitCommitsPerRepoV2, setGitRepoIdleMsV2, setGitCommitStuckMsV2,
  registerGitRepoV2, activateGitRepoV2, archiveGitRepoV2, decommissionGitRepoV2, touchGitRepoV2, getGitRepoV2, listGitReposV2,
  createGitCommitV2, startGitCommitV2, commitGitCommitV2, failGitCommitV2, cancelGitCommitV2, getGitCommitV2, listGitCommitsV2,
  autoArchiveIdleGitReposV2, autoFailStuckGitCommitsV2, getGitIntegrationGovStatsV2,
} from "../lib/git-integration.js";

function _registerGitV2(parent) {
  parent.command("enums-v2").description("List Git V2 enums").option("--json", "JSON").action((opts) => {
    const out = { repoMaturity: GIT_REPO_MATURITY_V2, commitLifecycle: GIT_COMMIT_LIFECYCLE_V2 };
    if (opts.json) console.log(JSON.stringify(out, null, 2)); else console.log(out);
  });
  parent.command("config-set-v2").description("Set Git V2 caps/thresholds").option("--max-active <n>", "max active repos per owner").option("--max-pending <n>", "max pending commits per repo").option("--idle-ms <n>", "repo idle ms").option("--stuck-ms <n>", "commit stuck ms").action((opts) => {
    if (opts.maxActive) setMaxActiveGitReposPerOwnerV2(parseInt(opts.maxActive, 10));
    if (opts.maxPending) setMaxPendingGitCommitsPerRepoV2(parseInt(opts.maxPending, 10));
    if (opts.idleMs) setGitRepoIdleMsV2(parseInt(opts.idleMs, 10));
    if (opts.stuckMs) setGitCommitStuckMsV2(parseInt(opts.stuckMs, 10));
    console.log("ok");
  });
  parent.command("register-repo-v2 <id>").description("Register Git V2 repo").requiredOption("--owner <owner>", "owner").option("--branch <branch>", "branch").option("--json", "JSON").action((id, opts) => {
    const r = registerGitRepoV2({ id, owner: opts.owner, branch: opts.branch });
    if (opts.json) console.log(JSON.stringify(r, null, 2)); else console.log(r);
  });
  parent.command("activate-repo-v2 <id>").description("Activate Git V2 repo").action((id) => { console.log(activateGitRepoV2(id)); });
  parent.command("archive-repo-v2 <id>").description("Archive Git V2 repo").action((id) => { console.log(archiveGitRepoV2(id)); });
  parent.command("decommission-repo-v2 <id>").description("Decommission Git V2 repo").action((id) => { console.log(decommissionGitRepoV2(id)); });
  parent.command("touch-repo-v2 <id>").description("Touch Git V2 repo").action((id) => { console.log(touchGitRepoV2(id)); });
  parent.command("get-repo-v2 <id>").description("Get Git V2 repo").option("--json", "JSON").action((id, opts) => { const r = getGitRepoV2(id); if (opts.json) console.log(JSON.stringify(r, null, 2)); else console.log(r); });
  parent.command("list-repos-v2").description("List Git V2 repos").option("--json", "JSON").action((opts) => { const r = listGitReposV2(); if (opts.json) console.log(JSON.stringify(r, null, 2)); else console.log(r); });
  parent.command("create-commit-v2 <id>").description("Create Git V2 commit").requiredOption("--repo-id <repoId>", "repo id").option("--message <msg>", "commit message").action((id, opts) => { console.log(createGitCommitV2({ id, repoId: opts.repoId, message: opts.message })); });
  parent.command("start-commit-v2 <id>").description("Start Git V2 commit").action((id) => { console.log(startGitCommitV2(id)); });
  parent.command("commit-commit-v2 <id>").description("Commit Git V2 commit").action((id) => { console.log(commitGitCommitV2(id)); });
  parent.command("fail-commit-v2 <id>").description("Fail Git V2 commit").option("--reason <r>", "reason").action((id, opts) => { console.log(failGitCommitV2(id, opts.reason)); });
  parent.command("cancel-commit-v2 <id>").description("Cancel Git V2 commit").option("--reason <r>", "reason").action((id, opts) => { console.log(cancelGitCommitV2(id, opts.reason)); });
  parent.command("get-commit-v2 <id>").description("Get Git V2 commit").action((id) => { console.log(getGitCommitV2(id)); });
  parent.command("list-commits-v2").description("List Git V2 commits").action(() => { console.log(listGitCommitsV2()); });
  parent.command("auto-archive-repos-v2").description("Auto-archive idle Git V2 repos").action(() => { console.log(autoArchiveIdleGitReposV2()); });
  parent.command("auto-fail-commits-v2").description("Auto-fail stuck Git V2 commits").action(() => { console.log(autoFailStuckGitCommitsV2()); });
  parent.command("gov-stats-v2").description("Git V2 governance stats").option("--json", "JSON").action((opts) => { const s = getGitIntegrationGovStatsV2(); if (opts.json) console.log(JSON.stringify(s, null, 2)); else console.log(s); });
}
