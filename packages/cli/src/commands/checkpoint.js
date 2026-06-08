/**
 * cc checkpoint — manual file-state snapshot / rewind (Claude-Code rewind parity).
 *
 *   cc checkpoint create <paths...> [--label <l>]   snapshot files/dirs
 *   cc checkpoint list                              list checkpoints
 *   cc checkpoint show <id> [--diff]                manifest, or diff vs current
 *   cc checkpoint restore <id> [--dry-run] [--force]  roll files back
 *   cc checkpoint delete <id> [--force]             remove a checkpoint
 *
 * Restore takes an automatic safety snapshot of the current contents first, so
 * a rewind is itself reversible. Distinct from `cc workflow checkpoint`
 * (workflow execution state, not files).
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";

export function registerCheckpointCommand(program) {
  const cp = program
    .command("checkpoint")
    .description("Snapshot / rewind file state (manual checkpoints)");

  cp.command("create <paths...>")
    .description("Snapshot the given files/directories")
    .option("--label <label>", "Human label for this checkpoint")
    .option("--json", "Output as JSON")
    .action(async (paths, options) => {
      try {
        const { createCheckpoint } = await import("../lib/file-checkpoint.js");
        const m = createCheckpoint(paths, { label: options.label });
        if (options.json) {
          console.log(JSON.stringify(m, null, 2));
          return;
        }
        logger.log(
          chalk.green(`✓ checkpoint ${chalk.bold(m.id)}`) +
            (m.label ? chalk.gray(`  "${m.label}"`) : ""),
        );
        logger.log(chalk.gray(`  ${m.fileCount} file(s) snapshotted`));
      } catch (err) {
        logger.error(chalk.red(`checkpoint create failed: ${err.message}`));
        process.exitCode = 1;
      }
    });

  cp.command("list")
    .alias("ls")
    .description("List checkpoints (newest first)")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const { listCheckpoints } = await import("../lib/file-checkpoint.js");
        const all = listCheckpoints();
        if (options.json) {
          console.log(JSON.stringify(all, null, 2));
          return;
        }
        if (all.length === 0) {
          logger.log(
            chalk.gray(
              "No checkpoints. Create one: cc checkpoint create <paths...>",
            ),
          );
          return;
        }
        for (const c of all) {
          logger.log(
            `${chalk.cyan(c.id.padEnd(22))} ${chalk.gray(c.createdAt)}  ` +
              `${String(c.fileCount).padStart(4)} files` +
              (c.label ? chalk.gray(`  "${c.label}"`) : ""),
          );
        }
      } catch (err) {
        logger.error(chalk.red(`checkpoint list failed: ${err.message}`));
        process.exitCode = 1;
      }
    });

  cp.command("show <id>")
    .description("Show a checkpoint's files, or its diff vs current state")
    .option("--diff", "Compare snapshot against current on-disk files")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const { getCheckpoint, diffCheckpoint } =
          await import("../lib/file-checkpoint.js");
        if (options.diff) {
          const d = diffCheckpoint(id);
          if (options.json) {
            console.log(JSON.stringify(d, null, 2));
            return;
          }
          logger.log(chalk.bold(`Diff vs current — ${id}`));
          logger.log(`  ${chalk.yellow("modified")}: ${d.modified.length}`);
          d.modified.forEach((f) => logger.log(chalk.yellow(`    M ${f}`)));
          logger.log(`  ${chalk.red("deleted")}:  ${d.deleted.length}`);
          d.deleted.forEach((f) => logger.log(chalk.red(`    D ${f}`)));
          logger.log(chalk.gray(`  unchanged: ${d.unchanged.length}`));
          return;
        }
        const m = getCheckpoint(id);
        if (!m) {
          logger.error(chalk.red(`no such checkpoint: ${id}`));
          process.exitCode = 1;
          return;
        }
        if (options.json) {
          console.log(JSON.stringify(m, null, 2));
          return;
        }
        logger.log(chalk.bold(`Checkpoint ${m.id}`));
        if (m.label) logger.log(chalk.gray(`  label: ${m.label}`));
        logger.log(
          chalk.gray(`  created: ${m.createdAt}  files: ${m.fileCount}`),
        );
        for (const f of m.files) {
          logger.log(`  ${chalk.gray(String(f.bytes).padStart(8))}  ${f.rel}`);
        }
      } catch (err) {
        logger.error(chalk.red(`checkpoint show failed: ${err.message}`));
        process.exitCode = 1;
      }
    });

  cp.command("restore <id>")
    .description(
      "Restore files from a checkpoint (auto-snapshots current state first)",
    )
    .option("--dry-run", "Show what would change without writing")
    .option("--force", "Restore without the interactive confirm prompt")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const { restoreCheckpoint, diffCheckpoint } =
          await import("../lib/file-checkpoint.js");

        if (options.dryRun) {
          const r = restoreCheckpoint(id, { dryRun: true });
          if (options.json) {
            console.log(JSON.stringify(r, null, 2));
            return;
          }
          logger.log(chalk.bold(`Dry-run restore — ${id}`));
          logger.log(`  would restore: ${r.restored.length} file(s)`);
          r.restored.forEach((f) => logger.log(chalk.yellow(`    ~ ${f}`)));
          logger.log(chalk.gray(`  already matching: ${r.unchanged.length}`));
          if (r.missingBlob.length) {
            logger.log(
              chalk.red(`  missing blobs: ${r.missingBlob.join(", ")}`),
            );
          }
          return;
        }

        // Destructive: overwrites current files. Require --force when not a TTY;
        // prompt when interactive.
        if (!options.force) {
          const d = diffCheckpoint(id);
          const willChange = d.modified.length + d.deleted.length;
          if (process.stdin.isTTY) {
            const { confirm } = await import("@inquirer/prompts");
            const ok = await confirm({
              message: `Restore ${id}? ${willChange} file(s) will be overwritten (a safety checkpoint is taken first).`,
              default: false,
            }).catch(() => false);
            if (!ok) {
              logger.log(chalk.gray("Aborted."));
              return;
            }
          } else {
            logger.error(
              chalk.red(
                `Refusing to restore without --force (non-interactive). ${willChange} file(s) would change. Re-run with --dry-run to preview or --force to proceed.`,
              ),
            );
            process.exitCode = 1;
            return;
          }
        }

        const r = restoreCheckpoint(id);
        if (options.json) {
          console.log(JSON.stringify(r, null, 2));
          return;
        }
        logger.log(
          chalk.green(`✓ restored ${r.restored.length} file(s) from ${id}`),
        );
        r.restored.forEach((f) => logger.log(chalk.gray(`    ~ ${f}`)));
        if (r.safetyId) {
          logger.log(
            chalk.gray(
              `  safety checkpoint of prior state: ${r.safetyId} (undo with: cc checkpoint restore ${r.safetyId})`,
            ),
          );
        }
        if (r.missingBlob.length) {
          logger.log(
            chalk.red(`  missing blobs (skipped): ${r.missingBlob.join(", ")}`),
          );
        }
      } catch (err) {
        logger.error(chalk.red(`checkpoint restore failed: ${err.message}`));
        process.exitCode = 1;
      }
    });

  cp.command("delete <id>")
    .alias("rm")
    .description("Delete a checkpoint")
    .option("--force", "Skip confirmation")
    .action(async (id, options) => {
      try {
        const { deleteCheckpoint, getCheckpoint } =
          await import("../lib/file-checkpoint.js");
        if (!getCheckpoint(id)) {
          logger.error(chalk.red(`no such checkpoint: ${id}`));
          process.exitCode = 1;
          return;
        }
        if (!options.force && process.stdin.isTTY) {
          const { confirm } = await import("@inquirer/prompts");
          const ok = await confirm({
            message: `Delete checkpoint ${id}?`,
            default: false,
          }).catch(() => false);
          if (!ok) {
            logger.log(chalk.gray("Aborted."));
            return;
          }
        }
        deleteCheckpoint(id);
        logger.log(chalk.green(`✓ deleted ${id}`));
      } catch (err) {
        logger.error(chalk.red(`checkpoint delete failed: ${err.message}`));
        process.exitCode = 1;
      }
    });
}
