/**
 * Note/knowledge base management commands
 * chainlesschain note add|list|show|search|delete|export
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";

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
}
