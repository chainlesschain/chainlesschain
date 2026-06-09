/**
 * cc checkpoint — file-state snapshot / rewind (Claude-Code rewind parity).
 *
 *   cc checkpoint create [paths...] [--label <l>]   snapshot the work tree (git)
 *                                                   or the given paths (fallback)
 *   cc checkpoint list                              list checkpoints
 *   cc checkpoint show <id> [--diff]                manifest, or diff vs current
 *   cc checkpoint restore <id> [--dry-run] [--force]  roll back (alias: rewind)
 *   cc checkpoint delete <id> [--force]             remove a checkpoint
 *   cc checkpoint clear                             remove all (a session)
 *
 * Engine: inside a git work tree it uses git-plumbing shadow commits
 * (whole-tree, content-addressed, .gitignore-aware, accurate add/modify/delete
 * rewind — refs/cc-checkpoints/*). Outside git it falls back to the copy-based
 * store (file-checkpoint.js) which snapshots the explicit paths you name.
 *
 * Restore takes an automatic safety snapshot of the current state first, so a
 * rewind is itself reversible. Distinct from `cc workflow checkpoint`
 * (workflow execution state, not files).
 */

import chalk from "chalk";
import { resolve } from "path";
import { logger } from "../lib/logger.js";

/** git-plumbing engine adapter (normalized interface). */
function gitEngine(gs, dir, session) {
  return {
    kind: "git",
    create: ({ label }) => {
      const r = gs.createCheckpoint(dir, { session, label });
      return {
        id: r.id,
        label: r.label,
        createdAt: r.createdAt,
        fileCount: r.files ?? r.fileCount,
      };
    },
    list: () =>
      gs.listCheckpoints(dir, { session }).map((r) => ({
        id: r.id,
        label: r.label,
        createdAt: r.createdAt,
        fileCount: null,
      })),
    show: (id) => gs.showCheckpoint(dir, id, { session }),
    status: (id) => gs.statusAgainst(dir, id, { session }),
    diffText: (id, o) => gs.diffCheckpoint(dir, id, { session, stat: o?.stat }),
    restore: (id, o) => {
      const r = gs.rewindTo(dir, id, { session, dryRun: o?.dryRun });
      return {
        dryRun: !!r.dryRun,
        restoredCount: r.modified + r.recreated,
        modified: r.modified,
        recreated: r.recreated,
        deleted: r.deleted,
        safetyId: r.safetyId,
      };
    },
    remove: (id) => gs.deleteCheckpoint(dir, id, { session }),
    clear: () => gs.clearCheckpoints(dir, { session }),
  };
}

/** copy-based engine adapter (normalized interface). */
function copyEngine(cs, dir) {
  return {
    kind: "copy",
    create: ({ paths, label }) => {
      const m = cs.createCheckpoint(paths, { cwd: dir, label });
      return {
        id: m.id,
        label: m.label,
        createdAt: m.createdAt,
        fileCount: m.fileCount,
      };
    },
    list: () =>
      cs.listCheckpoints().map((c) => ({
        id: c.id,
        label: c.label,
        createdAt: c.createdAt,
        fileCount: c.fileCount,
      })),
    show: (id) => {
      const m = cs.getCheckpoint(id);
      if (!m) throw new Error(`no such checkpoint: ${id}`);
      return {
        id: m.id,
        label: m.label,
        createdAt: m.createdAt,
        fileCount: m.fileCount,
        files: m.files.map((f) => ({ rel: f.rel, bytes: f.bytes })),
      };
    },
    status: (id) => {
      const d = cs.diffCheckpoint(id);
      return { modified: d.modified, added: [], deleted: d.deleted };
    },
    diffText: () => null, // copy engine has no raw patch — caller uses status()
    restore: (id, o) => {
      const r = cs.restoreCheckpoint(id, { cwd: dir, dryRun: o?.dryRun });
      return {
        dryRun: !!r.dryRun,
        restoredCount: r.restored.length,
        restored: r.restored,
        missingBlob: r.missingBlob,
        safetyId: r.safetyId,
      };
    },
    remove: (id) => cs.deleteCheckpoint(id),
    clear: () => {
      const all = cs.listCheckpoints();
      for (const c of all) cs.deleteCheckpoint(c.id);
      return all.length;
    },
  };
}

/** Choose the engine for `dir`: git-plumbing when available, else copy-based. */
async function pickEngine(dir, session) {
  const gs = await import("../lib/checkpoint-store.js");
  if (gs.isCheckpointAvailable(dir)) return gitEngine(gs, dir, session);
  const cs = await import("../lib/file-checkpoint.js");
  return copyEngine(cs, dir);
}

const tag = (engine) => chalk.dim(engine.kind === "git" ? "[git]" : "[copy]");

export function registerCheckpointCommand(program) {
  const cp = program
    .command("checkpoint")
    .description("Snapshot / rewind file state (git-plumbing, copy fallback)");

  cp.command("create [paths...]")
    .description(
      "Snapshot the work tree (git) or the given files/dirs (fallback)",
    )
    .option("-d, --dir <dir>", "Target directory", ".")
    .option("-s, --session <id>", "Checkpoint session (git engine)", "default")
    .option("--label <label>", "Human label for this checkpoint")
    .option("--json", "Output as JSON")
    .action(async (paths, options) => {
      try {
        const dir = resolve(options.dir);
        const engine = await pickEngine(dir, options.session);
        if (engine.kind === "copy" && (!paths || paths.length === 0)) {
          logger.error(
            chalk.red(
              "Not a git repo here — specify paths to snapshot: cc checkpoint create <paths...>",
            ),
          );
          process.exitCode = 1;
          return;
        }
        if (engine.kind === "git" && paths && paths.length > 0) {
          logger.log(
            chalk.gray(
              "  (git engine snapshots the whole work tree; paths ignored)",
            ),
          );
        }
        const m = engine.create({ paths, label: options.label });
        if (options.json) {
          console.log(JSON.stringify({ ...m, engine: engine.kind }, null, 2));
          return;
        }
        logger.log(
          chalk.green(`✓ checkpoint ${chalk.bold(m.id)}`) +
            ` ${tag(engine)}` +
            (m.label ? chalk.gray(`  "${m.label}"`) : ""),
        );
        logger.log(chalk.gray(`  ${m.fileCount} file(s) snapshotted`));
        logger.log(
          chalk.gray(
            `  rewind with: cc checkpoint restore ${m.id}` +
              (options.session !== "default" ? ` -s ${options.session}` : ""),
          ),
        );
      } catch (err) {
        logger.error(chalk.red(`checkpoint create failed: ${err.message}`));
        process.exitCode = 1;
      }
    });

  cp.command("list")
    .alias("ls")
    .description("List checkpoints (newest first)")
    .option("-d, --dir <dir>", "Target directory", ".")
    .option("-s, --session <id>", "Checkpoint session (git engine)", "default")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const dir = resolve(options.dir);
        const engine = await pickEngine(dir, options.session);
        const all = engine.list();
        if (options.json) {
          console.log(JSON.stringify(all, null, 2));
          return;
        }
        if (all.length === 0) {
          logger.log(
            chalk.gray(
              "No checkpoints. Create one: cc checkpoint create" +
                (engine.kind === "copy" ? " <paths...>" : ""),
            ),
          );
          return;
        }
        for (const c of all) {
          const count =
            c.fileCount == null
              ? ""
              : `${String(c.fileCount).padStart(4)} files`;
          logger.log(
            `${chalk.cyan(c.id.padEnd(22))} ${chalk.gray(c.createdAt)}  ${count}` +
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
    .option("-d, --dir <dir>", "Target directory", ".")
    .option("-s, --session <id>", "Checkpoint session (git engine)", "default")
    .option("--diff", "Compare snapshot against current on-disk files")
    .option("--stat", "With --diff: summary (diffstat) instead of full patch")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const dir = resolve(options.dir);
        const engine = await pickEngine(dir, options.session);

        if (options.diff) {
          const text = engine.diffText(id, { stat: options.stat });
          if (text != null) {
            if (options.json) {
              console.log(JSON.stringify({ id, diff: text }, null, 2));
              return;
            }
            if (!text.trim()) logger.info(`No changes since checkpoint ${id}.`);
            else logger.log(text);
            return;
          }
          const d = engine.status(id);
          if (options.json) {
            console.log(JSON.stringify({ id, ...d }, null, 2));
            return;
          }
          logger.log(chalk.bold(`Diff vs current — ${id}`));
          logger.log(`  ${chalk.yellow("modified")}: ${d.modified.length}`);
          d.modified.forEach((f) => logger.log(chalk.yellow(`    M ${f}`)));
          logger.log(`  ${chalk.red("deleted")}:  ${d.deleted.length}`);
          d.deleted.forEach((f) => logger.log(chalk.red(`    D ${f}`)));
          return;
        }

        const m = engine.show(id);
        if (options.json) {
          console.log(JSON.stringify(m, null, 2));
          return;
        }
        logger.log(chalk.bold(`Checkpoint ${m.id}`) + ` ${tag(engine)}`);
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
    .alias("rewind")
    .description(
      "Restore files from a checkpoint (auto-snapshots current state first)",
    )
    .option("-d, --dir <dir>", "Target directory", ".")
    .option("-s, --session <id>", "Checkpoint session (git engine)", "default")
    .option("--dry-run", "Show what would change without writing")
    .option("--force", "Restore without the interactive confirm prompt")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const dir = resolve(options.dir);
        const engine = await pickEngine(dir, options.session);

        if (options.dryRun) {
          const r = engine.restore(id, { dryRun: true });
          if (options.json) {
            console.log(JSON.stringify(r, null, 2));
            return;
          }
          logger.log(chalk.bold(`Dry-run restore — ${id}`));
          logger.log(`  would restore: ${r.restoredCount} file(s)`);
          if (typeof r.deleted === "number") {
            logger.log(`  would remove:  ${r.deleted} file(s) created since`);
          }
          return;
        }

        // Destructive: overwrites current files. Require --force when not a TTY;
        // prompt when interactive.
        if (!options.force) {
          const d = engine.status(id);
          const willChange =
            d.modified.length + d.deleted.length + (d.added?.length || 0);
          if (process.stdin.isTTY) {
            const { confirm } = await import("@inquirer/prompts");
            const ok = await confirm({
              message: `Restore ${id}? ${willChange} file(s) affected (a safety checkpoint is taken first).`,
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

        const r = engine.restore(id);
        if (options.json) {
          console.log(JSON.stringify(r, null, 2));
          return;
        }
        logger.log(
          chalk.green(`✓ restored ${r.restoredCount} file(s) from ${id}`) +
            (typeof r.deleted === "number" && r.deleted > 0
              ? chalk.gray(`  (${r.deleted} removed)`)
              : ""),
        );
        if (r.safetyId) {
          logger.log(
            chalk.gray(
              `  safety checkpoint of prior state: ${r.safetyId}` +
                ` (undo with: cc checkpoint restore ${r.safetyId}` +
                (options.session !== "default"
                  ? ` -s ${options.session}`
                  : "") +
                `)`,
            ),
          );
        }
        if (r.missingBlob && r.missingBlob.length) {
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
    .option("-d, --dir <dir>", "Target directory", ".")
    .option("-s, --session <id>", "Checkpoint session (git engine)", "default")
    .option("--force", "Skip confirmation")
    .action(async (id, options) => {
      try {
        const dir = resolve(options.dir);
        const engine = await pickEngine(dir, options.session);
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
        const existed = engine.remove(id);
        if (!existed) {
          logger.error(chalk.red(`no such checkpoint: ${id}`));
          process.exitCode = 1;
          return;
        }
        logger.log(chalk.green(`✓ deleted ${id}`));
      } catch (err) {
        logger.error(chalk.red(`checkpoint delete failed: ${err.message}`));
        process.exitCode = 1;
      }
    });

  cp.command("clear")
    .description("Delete all checkpoints (in a session, for the git engine)")
    .option("-d, --dir <dir>", "Target directory", ".")
    .option("-s, --session <id>", "Checkpoint session (git engine)", "default")
    .option("--force", "Skip confirmation")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const dir = resolve(options.dir);
        const engine = await pickEngine(dir, options.session);
        if (!options.force && process.stdin.isTTY) {
          const { confirm } = await import("@inquirer/prompts");
          const ok = await confirm({
            message: `Delete ALL checkpoints${engine.kind === "git" ? ` in session "${options.session}"` : ""}?`,
            default: false,
          }).catch(() => false);
          if (!ok) {
            logger.log(chalk.gray("Aborted."));
            return;
          }
        }
        const removed = engine.clear();
        if (options.json) {
          console.log(
            JSON.stringify({ removed, engine: engine.kind }, null, 2),
          );
          return;
        }
        logger.log(chalk.green(`✓ removed ${removed} checkpoint(s)`));
      } catch (err) {
        logger.error(chalk.red(`checkpoint clear failed: ${err.message}`));
        process.exitCode = 1;
      }
    });
}
