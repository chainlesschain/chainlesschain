/**
 * Note/knowledge base management commands
 * chainlesschain note add|list|show|search|delete|export
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureVersionsTable,
  saveVersion,
  getHistory,
  getVersion,
  simpleDiff,
  formatDiff,
  revertToVersion,
  NOTE_MATURITY_V2,
  REVISION_LIFECYCLE_V2,
  getMaxActiveNotesPerAuthorV2,
  setMaxActiveNotesPerAuthorV2,
  getMaxOpenRevsPerNoteV2,
  setMaxOpenRevsPerNoteV2,
  getNoteIdleMsV2,
  setNoteIdleMsV2,
  getRevStuckMsV2,
  setRevStuckMsV2,
  getActiveNoteCountV2,
  getOpenRevCountV2,
  registerNoteV2,
  getNoteV2,
  listNotesV2,
  activateNoteV2,
  lockNoteV2,
  archiveNoteV2,
  touchNoteV2,
  createRevisionV2,
  getRevisionV2,
  listRevisionsV2,
  reviewRevisionV2,
  applyRevisionV2,
  supersedeRevisionV2,
  discardRevisionV2,
  autoLockIdleNotesV2,
  autoDiscardStaleRevisionsV2,
  getNoteVersioningStatsV2,
} from "../lib/note-versioning.js";

/**
 * Ensure the notes table exists in the database
 */
function ensureNotesTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      category TEXT DEFAULT 'general',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      deleted_at TEXT DEFAULT NULL
    )
  `);
}

export function registerNoteCommand(program) {
  const note = program
    .command("note")
    .description("Note and knowledge base management");

  // note add
  note
    .command("add")
    .description("Add a new note")
    .argument("<title>", "Note title")
    .option("-c, --content <content>", "Note content")
    .option("-t, --tags <tags>", "Comma-separated tags")
    .option("--category <category>", "Note category", "general")
    .option("--json", "Output as JSON")
    .action(async (title, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }

        const rawDb = ctx.db.getDatabase();
        ensureNotesTable(rawDb);

        const { randomUUID } = await import("crypto");
        const id = randomUUID();
        const tags = options.tags
          ? JSON.stringify(options.tags.split(",").map((t) => t.trim()))
          : "[]";

        rawDb
          .prepare(
            "INSERT INTO notes (id, title, content, tags, category) VALUES (?, ?, ?, ?, ?)",
          )
          .run(id, title, options.content || "", tags, options.category);

        if (options.json) {
          console.log(
            JSON.stringify({
              id,
              title,
              tags: JSON.parse(tags),
              category: options.category,
            }),
          );
        } else {
          logger.success(
            `Note created: ${chalk.cyan(title)} (${chalk.gray(id.slice(0, 8))})`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed to add note: ${err.message}`);
        process.exit(1);
      }
    });

  // note list
  note
    .command("list")
    .description("List notes")
    .option("-n, --limit <n>", "Max notes to show", "20")
    .option("--category <category>", "Filter by category")
    .option("--tag <tag>", "Filter by tag")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }

        const rawDb = ctx.db.getDatabase();
        ensureNotesTable(rawDb);

        let sql =
          "SELECT id, title, tags, category, created_at FROM notes WHERE deleted_at IS NULL";
        const params = [];

        if (options.category) {
          sql += " AND category = ?";
          params.push(options.category);
        }

        sql += " ORDER BY created_at DESC LIMIT ?";
        params.push(parseInt(options.limit));

        let notes = rawDb.prepare(sql).all(...params);

        // Filter by tag in-memory (tags stored as JSON array)
        if (options.tag) {
          notes = notes.filter((n) => {
            try {
              const tags = JSON.parse(n.tags || "[]");
              return tags.includes(options.tag);
            } catch {
              return false;
            }
          });
        }

        if (options.json) {
          console.log(JSON.stringify(notes, null, 2));
        } else if (notes.length === 0) {
          logger.info("No notes found");
        } else {
          logger.log(chalk.bold(`Notes (${notes.length}):\n`));
          for (const n of notes) {
            const tags = JSON.parse(n.tags || "[]");
            const tagStr =
              tags.length > 0 ? chalk.gray(` [${tags.join(", ")}]`) : "";
            logger.log(
              `  ${chalk.gray(n.id.slice(0, 8))}  ${chalk.white(n.title)}${tagStr}  ${chalk.gray(n.created_at)}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed to list notes: ${err.message}`);
        process.exit(1);
      }
    });

  // note show
  note
    .command("show")
    .description("Show note content")
    .argument("<id>", "Note ID (or prefix)")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }

        const rawDb = ctx.db.getDatabase();
        ensureNotesTable(rawDb);

        const note = rawDb
          .prepare("SELECT * FROM notes WHERE id LIKE ? AND deleted_at IS NULL")
          .get(`${id}%`);

        if (!note) {
          logger.error(`Note not found: ${id}`);
          process.exit(1);
        }

        if (options.json) {
          console.log(JSON.stringify(note, null, 2));
        } else {
          logger.log(chalk.bold(note.title));
          logger.log(chalk.gray(`ID: ${note.id}`));
          logger.log(
            chalk.gray(
              `Category: ${note.category}  Created: ${note.created_at}`,
            ),
          );
          const tags = JSON.parse(note.tags || "[]");
          if (tags.length > 0) {
            logger.log(chalk.gray(`Tags: ${tags.join(", ")}`));
          }
          logger.log("");
          logger.log(note.content || chalk.gray("(empty)"));
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed to show note: ${err.message}`);
        process.exit(1);
      }
    });

  // note search
  note
    .command("search")
    .description("Search notes")
    .argument("<query>", "Search query")
    .option("--json", "Output as JSON")
    .action(async (query, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }

        const rawDb = ctx.db.getDatabase();
        ensureNotesTable(rawDb);

        const pattern = `%${query}%`;
        const notes = rawDb
          .prepare(
            "SELECT id, title, category, created_at FROM notes WHERE deleted_at IS NULL AND (title LIKE ? OR content LIKE ?) ORDER BY created_at DESC LIMIT 50",
          )
          .all(pattern, pattern);

        if (options.json) {
          console.log(JSON.stringify(notes, null, 2));
        } else if (notes.length === 0) {
          logger.info(`No notes matching "${query}"`);
        } else {
          logger.log(
            chalk.bold(`Search results for "${query}" (${notes.length}):\n`),
          );
          for (const n of notes) {
            logger.log(
              `  ${chalk.gray(n.id.slice(0, 8))}  ${chalk.white(n.title)}  ${chalk.gray(n.created_at)}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Search failed: ${err.message}`);
        process.exit(1);
      }
    });

  // note delete
  note
    .command("delete")
    .description("Delete a note (soft delete)")
    .argument("<id>", "Note ID (or prefix)")
    .option("--force", "Skip confirmation")
    .action(async (id, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }

        const rawDb = ctx.db.getDatabase();
        ensureNotesTable(rawDb);

        const note = rawDb
          .prepare(
            "SELECT id, title FROM notes WHERE id LIKE ? AND deleted_at IS NULL",
          )
          .get(`${id}%`);

        if (!note) {
          logger.error(`Note not found: ${id}`);
          process.exit(1);
        }

        if (!options.force) {
          const { confirm } = await import("@inquirer/prompts");
          const ok = await confirm({
            message: `Delete note "${note.title}"?`,
          });
          if (!ok) {
            logger.info("Cancelled");
            return;
          }
        }

        rawDb
          .prepare("UPDATE notes SET deleted_at = datetime('now') WHERE id = ?")
          .run(note.id);

        logger.success(`Note deleted: ${chalk.cyan(note.title)}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed to delete note: ${err.message}`);
        process.exit(1);
      }
    });

  // note history
  note
    .command("history")
    .description("Show version history for a note")
    .argument("<id>", "Note ID (or prefix)")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }

        const rawDb = ctx.db.getDatabase();
        ensureNotesTable(rawDb);
        ensureVersionsTable(rawDb);

        // Find the note
        const noteRow = rawDb
          .prepare(
            "SELECT id FROM notes WHERE id LIKE ? AND deleted_at IS NULL",
          )
          .get(`${id}%`);

        if (!noteRow) {
          logger.error(`Note not found: ${id}`);
          process.exit(1);
        }

        const history = getHistory(rawDb, noteRow.id);

        if (options.json) {
          console.log(JSON.stringify(history, null, 2));
        } else if (history.length === 0) {
          logger.info("No version history found");
        } else {
          logger.log(
            chalk.bold(`Version history (${history.length} versions):\n`),
          );
          for (const v of history) {
            logger.log(
              `  ${chalk.cyan(`v${v.version}`)}  ${chalk.white(v.title)}  ${chalk.gray(v.change_type)}  ${chalk.gray(v.created_at || "")}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed to get history: ${err.message}`);
        process.exit(1);
      }
    });

  // note diff
  note
    .command("diff")
    .description("Show diff between two versions of a note")
    .argument("<id>", "Note ID (or prefix)")
    .argument("<v1>", "First version number")
    .argument("<v2>", "Second version number")
    .option("--json", "Output as JSON")
    .action(async (id, v1, v2, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }

        const rawDb = ctx.db.getDatabase();
        ensureNotesTable(rawDb);
        ensureVersionsTable(rawDb);

        const noteRow = rawDb
          .prepare(
            "SELECT id FROM notes WHERE id LIKE ? AND deleted_at IS NULL",
          )
          .get(`${id}%`);

        if (!noteRow) {
          logger.error(`Note not found: ${id}`);
          process.exit(1);
        }

        const ver1 = getVersion(rawDb, noteRow.id, parseInt(v1));
        const ver2 = getVersion(rawDb, noteRow.id, parseInt(v2));

        if (!ver1) {
          logger.error(`Version ${v1} not found`);
          process.exit(1);
        }
        if (!ver2) {
          logger.error(`Version ${v2} not found`);
          process.exit(1);
        }

        const diff = simpleDiff(ver1.content, ver2.content);

        if (options.json) {
          console.log(
            JSON.stringify(
              { v1: parseInt(v1), v2: parseInt(v2), diff },
              null,
              2,
            ),
          );
        } else {
          logger.log(chalk.bold(`Diff: v${v1} → v${v2}\n`));
          logger.log(formatDiff(diff));
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed to compute diff: ${err.message}`);
        process.exit(1);
      }
    });

  // note revert
  note
    .command("revert")
    .description("Revert a note to a specific version")
    .argument("<id>", "Note ID (or prefix)")
    .argument("<version>", "Version number to revert to")
    .option("--force", "Skip confirmation")
    .action(async (id, version, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }

        const rawDb = ctx.db.getDatabase();
        ensureNotesTable(rawDb);
        ensureVersionsTable(rawDb);

        const noteRow = rawDb
          .prepare(
            "SELECT id, title FROM notes WHERE id LIKE ? AND deleted_at IS NULL",
          )
          .get(`${id}%`);

        if (!noteRow) {
          logger.error(`Note not found: ${id}`);
          process.exit(1);
        }

        if (!options.force) {
          const { confirm } = await import("@inquirer/prompts");
          const ok = await confirm({
            message: `Revert note "${noteRow.title}" to version ${version}?`,
          });
          if (!ok) {
            logger.info("Cancelled");
            return;
          }
        }

        const result = revertToVersion(rawDb, noteRow.id, parseInt(version));

        if (!result) {
          logger.error(`Version ${version} not found or note unavailable`);
          process.exit(1);
        }

        logger.success(
          `Note reverted to v${result.reverted_to} → new version v${result.new_version}`,
        );

        await shutdown();
      } catch (err) {
        logger.error(`Failed to revert: ${err.message}`);
        process.exit(1);
      }
    });

  // ─── V2 governance surface ─────────────────────────────────

  note
    .command("note-maturities-v2")
    .description("List V2 note maturity states")
    .action(() => {
      console.log(JSON.stringify(Object.values(NOTE_MATURITY_V2), null, 2));
    });

  note
    .command("revision-lifecycles-v2")
    .description("List V2 revision lifecycle states")
    .action(() => {
      console.log(
        JSON.stringify(Object.values(REVISION_LIFECYCLE_V2), null, 2),
      );
    });

  note
    .command("stats-v2")
    .description("Show V2 governance stats")
    .action(() => {
      console.log(JSON.stringify(getNoteVersioningStatsV2(), null, 2));
    });

  note
    .command("get-max-active-notes-v2")
    .description("Get max active notes per author")
    .action(() => console.log(getMaxActiveNotesPerAuthorV2()));

  note
    .command("set-max-active-notes-v2 <n>")
    .description("Set max active notes per author")
    .action((n) => {
      setMaxActiveNotesPerAuthorV2(Number(n));
      console.log(getMaxActiveNotesPerAuthorV2());
    });

  note
    .command("get-max-open-revs-v2")
    .description("Get max open revisions per note")
    .action(() => console.log(getMaxOpenRevsPerNoteV2()));

  note
    .command("set-max-open-revs-v2 <n>")
    .description("Set max open revisions per note")
    .action((n) => {
      setMaxOpenRevsPerNoteV2(Number(n));
      console.log(getMaxOpenRevsPerNoteV2());
    });

  note
    .command("get-note-idle-ms-v2")
    .description("Get note idle threshold (ms)")
    .action(() => console.log(getNoteIdleMsV2()));

  note
    .command("set-note-idle-ms-v2 <n>")
    .description("Set note idle threshold (ms)")
    .action((n) => {
      setNoteIdleMsV2(Number(n));
      console.log(getNoteIdleMsV2());
    });

  note
    .command("get-rev-stuck-ms-v2")
    .description("Get revision stuck threshold (ms)")
    .action(() => console.log(getRevStuckMsV2()));

  note
    .command("set-rev-stuck-ms-v2 <n>")
    .description("Set revision stuck threshold (ms)")
    .action((n) => {
      setRevStuckMsV2(Number(n));
      console.log(getRevStuckMsV2());
    });

  note
    .command("active-note-count-v2 <authorId>")
    .description("Count active notes for an author")
    .action((authorId) => console.log(getActiveNoteCountV2(authorId)));

  note
    .command("open-rev-count-v2 <noteId>")
    .description("Count open revisions for a note")
    .action((noteId) => console.log(getOpenRevCountV2(noteId)));

  note
    .command("register-note-v2 <id>")
    .description("Register a V2 note")
    .requiredOption("-a, --author <authorId>", "Author id")
    .requiredOption("-t, --title <title>", "Title")
    .action((id, opts) => {
      const n = registerNoteV2(id, {
        authorId: opts.author,
        title: opts.title,
      });
      console.log(JSON.stringify(n, null, 2));
    });

  note
    .command("get-note-v2 <id>")
    .description("Get a V2 note")
    .action((id) => {
      const n = getNoteV2(id);
      console.log(n ? JSON.stringify(n, null, 2) : "null");
    });

  note
    .command("list-notes-v2")
    .description("List V2 notes")
    .option("-a, --author <authorId>", "Filter by author")
    .option("-s, --status <status>", "Filter by status")
    .action((opts) => {
      console.log(
        JSON.stringify(
          listNotesV2({ authorId: opts.author, status: opts.status }),
          null,
          2,
        ),
      );
    });

  note
    .command("activate-note-v2 <id>")
    .description("draft|locked → active")
    .action((id) => console.log(JSON.stringify(activateNoteV2(id), null, 2)));

  note
    .command("lock-note-v2 <id>")
    .description("active → locked")
    .action((id) => console.log(JSON.stringify(lockNoteV2(id), null, 2)));

  note
    .command("archive-note-v2 <id>")
    .description("→ archived (terminal)")
    .action((id) => console.log(JSON.stringify(archiveNoteV2(id), null, 2)));

  note
    .command("touch-note-v2 <id>")
    .description("Update lastSeenAt")
    .action((id) => console.log(JSON.stringify(touchNoteV2(id), null, 2)));

  note
    .command("create-revision-v2 <id>")
    .description("Create a V2 revision")
    .requiredOption("-n, --note <noteId>", "Note id")
    .requiredOption("-s, --summary <summary>", "Summary")
    .action((id, opts) => {
      const r = createRevisionV2(id, {
        noteId: opts.note,
        summary: opts.summary,
      });
      console.log(JSON.stringify(r, null, 2));
    });

  note
    .command("get-revision-v2 <id>")
    .description("Get a V2 revision")
    .action((id) => {
      const r = getRevisionV2(id);
      console.log(r ? JSON.stringify(r, null, 2) : "null");
    });

  note
    .command("list-revisions-v2")
    .description("List V2 revisions")
    .option("-n, --note <noteId>", "Filter by note")
    .option("-s, --status <status>", "Filter by status")
    .action((opts) => {
      console.log(
        JSON.stringify(
          listRevisionsV2({ noteId: opts.note, status: opts.status }),
          null,
          2,
        ),
      );
    });

  note
    .command("review-revision-v2 <id>")
    .description("proposed → reviewed")
    .action((id) => console.log(JSON.stringify(reviewRevisionV2(id), null, 2)));

  note
    .command("apply-revision-v2 <id>")
    .description("reviewed → applied (non-terminal)")
    .action((id) => console.log(JSON.stringify(applyRevisionV2(id), null, 2)));

  note
    .command("supersede-revision-v2 <id>")
    .description("reviewed|applied → superseded (terminal)")
    .action((id) =>
      console.log(JSON.stringify(supersedeRevisionV2(id), null, 2)),
    );

  note
    .command("discard-revision-v2 <id>")
    .description("→ discarded (terminal)")
    .action((id) =>
      console.log(JSON.stringify(discardRevisionV2(id), null, 2)),
    );

  note
    .command("auto-lock-idle-notes-v2")
    .description("Flip idle active notes → locked")
    .action(() => console.log(JSON.stringify(autoLockIdleNotesV2(), null, 2)));

  note
    .command("auto-discard-stale-revisions-v2")
    .description("Flip stale proposed/reviewed → discarded")
    .action(() =>
      console.log(JSON.stringify(autoDiscardStaleRevisionsV2(), null, 2)),
    );
}

// === Iter23 V2 governance overlay ===
export function registerNtgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "note");
  if (!parent) return;
  const L = async () => await import("../lib/note-versioning.js");
  parent
    .command("ntgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.NTGOV_PROFILE_MATURITY_V2,
            revisionLifecycle: m.NTGOV_REVISION_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("ntgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveNtgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingNtgovRevisionsPerProfileV2(),
            idleMs: m.getNtgovProfileIdleMsV2(),
            stuckMs: m.getNtgovRevisionStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("ntgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveNtgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("ntgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingNtgovRevisionsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("ntgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setNtgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("ntgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setNtgovRevisionStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("ntgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--series <v>", "series")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerNtgovProfileV2({ id, owner, series: o.series }),
          null,
          2,
        ),
      );
    });
  parent
    .command("ntgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateNtgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("ntgov-stale-v2 <id>")
    .description("Stale profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).staleNtgovProfileV2(id), null, 2));
    });
  parent
    .command("ntgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveNtgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("ntgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).touchNtgovProfileV2(id), null, 2));
    });
  parent
    .command("ntgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getNtgovProfileV2(id), null, 2));
    });
  parent
    .command("ntgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listNtgovProfilesV2(), null, 2));
    });
  parent
    .command("ntgov-create-revision-v2 <id> <profileId>")
    .description("Create revision")
    .option("--author <v>", "author")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createNtgovRevisionV2({ id, profileId, author: o.author }),
          null,
          2,
        ),
      );
    });
  parent
    .command("ntgov-reviewing-revision-v2 <id>")
    .description("Mark revision as reviewing")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).reviewingNtgovRevisionV2(id), null, 2),
      );
    });
  parent
    .command("ntgov-complete-revision-v2 <id>")
    .description("Merge revision")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeRevisionNtgovV2(id), null, 2),
      );
    });
  parent
    .command("ntgov-fail-revision-v2 <id> [reason]")
    .description("Fail revision")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failNtgovRevisionV2(id, reason), null, 2),
      );
    });
  parent
    .command("ntgov-cancel-revision-v2 <id> [reason]")
    .description("Cancel revision")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelNtgovRevisionV2(id, reason), null, 2),
      );
    });
  parent
    .command("ntgov-get-revision-v2 <id>")
    .description("Get revision")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getNtgovRevisionV2(id), null, 2));
    });
  parent
    .command("ntgov-list-revisions-v2")
    .description("List revisions")
    .action(async () => {
      console.log(JSON.stringify((await L()).listNtgovRevisionsV2(), null, 2));
    });
  parent
    .command("ntgov-auto-stale-idle-v2")
    .description("Auto-stale idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoStaleIdleNtgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("ntgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck revisions")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckNtgovRevisionsV2(), null, 2),
      );
    });
  parent
    .command("ntgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getNoteVersioningGovStatsV2(), null, 2),
      );
    });
}
