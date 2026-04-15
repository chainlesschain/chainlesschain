/**
 * Persistent memory management commands
 * chainlesschain memory show|add|search|daily|file
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  getMemoryDir,
  addMemory,
  searchMemory,
  listMemory,
  deleteMemory,
  appendDailyNote,
  getDailyNote,
  listDailyNotes,
  getMemoryFile,
  updateMemoryFile,
} from "../lib/memory-manager.js";

export function registerMemoryCommand(program) {
  const memory = program
    .command("memory")
    .description("Persistent memory and daily notes");

  // memory show
  memory
    .command("show", { isDefault: true })
    .description("Show memory entries")
    .option("-n, --limit <n>", "Max entries", "20")
    .option("--category <cat>", "Filter by category")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const entries = listMemory(db, {
          limit: Math.max(1, parseInt(options.limit) || 20),
          category: options.category,
        });

        if (options.json) {
          console.log(JSON.stringify(entries, null, 2));
        } else if (entries.length === 0) {
          logger.info("No memory entries. Use 'memory add' to create one.");
        } else {
          logger.log(chalk.bold(`Memory (${entries.length} entries):\n`));
          for (const e of entries) {
            const stars =
              "★".repeat(e.importance) + "☆".repeat(5 - e.importance);
            logger.log(
              `  ${chalk.gray(e.id.slice(0, 12))}  ${chalk.yellow(stars)}  ${chalk.cyan(e.category)}`,
            );
            logger.log(
              `    ${chalk.white(e.content.substring(0, 120).replace(/\n/g, " "))}`,
            );
            logger.log(`    ${chalk.gray(e.created_at)}`);
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // memory add
  memory
    .command("add")
    .description("Add a memory entry")
    .argument("<text>", "Memory content")
    .option("--category <cat>", "Category", "general")
    .option("--importance <n>", "Importance 1-5", "3")
    .option("--json", "Output as JSON")
    .action(async (text, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const entry = addMemory(db, text, {
          category: options.category,
          importance: Math.max(
            1,
            Math.min(5, parseInt(options.importance) || 3),
          ),
        });

        if (options.json) {
          console.log(JSON.stringify(entry, null, 2));
        } else {
          logger.success(
            `Memory added: ${chalk.gray(entry.id.slice(0, 12))} [${chalk.cyan(entry.category)}]`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // memory search
  memory
    .command("search")
    .description("Search memory entries")
    .argument("<query>", "Search query")
    .option("-n, --limit <n>", "Max results", "20")
    .option("--json", "Output as JSON")
    .action(async (query, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const results = searchMemory(db, query, {
          limit: Math.max(1, parseInt(options.limit) || 20),
        });

        if (options.json) {
          console.log(JSON.stringify(results, null, 2));
        } else if (results.length === 0) {
          logger.info(`No memory entries matching "${query}"`);
        } else {
          logger.log(
            chalk.bold(
              `Memory search "${query}" (${results.length} results):\n`,
            ),
          );
          for (const e of results) {
            logger.log(
              `  ${chalk.gray(e.id.slice(0, 12))}  ${chalk.cyan(e.category)}  ${chalk.gray(e.created_at)}`,
            );
            logger.log(
              `    ${chalk.white(e.content.substring(0, 120).replace(/\n/g, " "))}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // memory delete
  memory
    .command("delete")
    .description("Delete a memory entry")
    .argument("<id>", "Entry ID (or prefix)")
    .action(async (id) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const ok = deleteMemory(db, id);
        if (ok) {
          logger.success("Memory entry deleted");
        } else {
          logger.error(`Memory entry not found: ${id}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // memory daily
  memory
    .command("daily")
    .description("View or append to daily notes")
    .argument("[date]", "Date (YYYY-MM-DD, default: today)")
    .option("-a, --append <text>", "Append text to daily note")
    .option("--list", "List available daily notes")
    .option("--json", "Output as JSON")
    .action(async (date, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const memoryDir = getMemoryDir(ctx.env.dataDir);

        if (options.list) {
          const notes = listDailyNotes(memoryDir);
          if (options.json) {
            console.log(JSON.stringify(notes, null, 2));
          } else if (notes.length === 0) {
            logger.info("No daily notes yet");
          } else {
            logger.log(chalk.bold("Daily Notes:\n"));
            for (const n of notes) {
              logger.log(
                `  ${chalk.cyan(n.date)}  ${chalk.gray(n.size + " bytes")}`,
              );
            }
          }
          await shutdown();
          return;
        }

        if (options.append) {
          const result = appendDailyNote(memoryDir, options.append);
          logger.success(`Added to daily note: ${chalk.cyan(result.date)}`);
          await shutdown();
          return;
        }

        // Show daily note
        const targetDate = date || new Date().toISOString().slice(0, 10);
        const content = getDailyNote(memoryDir, targetDate);

        if (!content) {
          logger.info(`No daily note for ${targetDate}`);
        } else if (options.json) {
          console.log(JSON.stringify({ date: targetDate, content }, null, 2));
        } else {
          logger.log(content);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // memory recall — Managed Agents parity Phase D2 (session-core MemoryStore)
  memory
    .command("recall")
    .description("Recall scoped memory (session-core MemoryStore)")
    .argument("[query]", "Query string")
    .option("--scope <scope>", "session | agent | global")
    .option(
      "--scope-id <id>",
      "Session or agent id (required for session/agent)",
    )
    .option("--category <cat>", "Filter by category")
    .option("--tags <tags>", "Comma-separated tags")
    .option("-n, --limit <n>", "Max results", "10")
    .option("--json", "Output as JSON")
    .action(async (query, options) => {
      try {
        const { getMemoryStore } =
          await import("../lib/session-core-singletons.js");
        const store = getMemoryStore();
        const tags = options.tags
          ? options.tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : null;
        const results = store.recall({
          query: query || "",
          scope: options.scope,
          scopeId: options.scopeId,
          category: options.category,
          tags,
          limit: Math.max(1, parseInt(options.limit) || 10),
        });

        if (options.json) {
          console.log(JSON.stringify(results, null, 2));
        } else if (results.length === 0) {
          logger.info("No scoped memory entries matched.");
        } else {
          logger.log(
            chalk.bold(`Scoped memory (${results.length} results):\n`),
          );
          for (const m of results) {
            logger.log(
              `  ${chalk.gray(m.id.slice(0, 12))}  ${chalk.cyan(m.scope)}${m.scopeId ? ":" + m.scopeId.slice(0, 12) : ""}  ${chalk.yellow(m.category)}  rel=${m.relevance?.toFixed(2) ?? "?"}`,
            );
            logger.log(`    ${chalk.white(m.content.substring(0, 160))}`);
          }
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // memory store — add to session-core MemoryStore (separate from DB-backed memory add)
  memory
    .command("store")
    .description("Write a scoped memory (session-core MemoryStore)")
    .argument("<content>")
    .requiredOption("--scope <scope>", "session | agent | global")
    .option("--scope-id <id>", "Required for session/agent scope")
    .option("--category <cat>", "Category", "general")
    .option("--tags <tags>", "Comma-separated tags")
    .option("--json", "Output as JSON")
    .action(async (content, options) => {
      try {
        const { getMemoryStore } =
          await import("../lib/session-core-singletons.js");
        const store = getMemoryStore();
        const tags = options.tags
          ? options.tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : [];
        const m = store.add({
          scope: options.scope,
          scopeId: options.scopeId || null,
          category: options.category,
          content,
          tags,
        });
        if (options.json) console.log(JSON.stringify(m, null, 2));
        else
          logger.success(
            `Stored ${chalk.gray(m.id.slice(0, 12))} [${chalk.cyan(m.scope)}/${m.category}]`,
          );
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // memory file
  memory
    .command("file")
    .description("View or edit the long-term MEMORY.md file")
    .option("--edit", "Open in $EDITOR")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const memoryDir = getMemoryDir(ctx.env.dataDir);
        const content = getMemoryFile(memoryDir);

        if (options.edit) {
          const { execSync } = await import("child_process");
          const editor = process.env.EDITOR || process.env.VISUAL || "nano";
          const filePath = `${memoryDir}/MEMORY.md`;
          try {
            execSync(`${editor} "${filePath}"`, { stdio: "inherit" });
            logger.success("Memory file updated");
          } catch {
            logger.error(
              `Failed to open editor. Set $EDITOR environment variable.`,
            );
          }
        } else if (options.json) {
          console.log(JSON.stringify({ content }, null, 2));
        } else if (!content) {
          logger.info(
            "MEMORY.md is empty. Use 'memory file --edit' to add content.",
          );
        } else {
          logger.log(content);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
