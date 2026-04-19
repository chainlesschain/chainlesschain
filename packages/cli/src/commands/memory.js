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
  ENTRY_MATURITY_V2,
  CONSOLIDATION_LIFECYCLE_V2,
  getMaxActiveEntriesPerCategoryV2,
  setMaxActiveEntriesPerCategoryV2,
  getMaxRunningJobsPerSourceV2,
  setMaxRunningJobsPerSourceV2,
  getEntryIdleMsV2,
  setEntryIdleMsV2,
  getJobStuckMsV2,
  setJobStuckMsV2,
  getActiveEntryCountV2,
  getRunningJobCountV2,
  registerEntryV2,
  getEntryV2,
  listEntriesV2,
  activateEntryV2,
  parkEntryV2,
  archiveEntryV2,
  touchEntryV2,
  createConsolidationJobV2,
  getConsolidationJobV2,
  listConsolidationJobsV2,
  startConsolidationJobV2,
  succeedConsolidationJobV2,
  failConsolidationJobV2,
  cancelConsolidationJobV2,
  autoParkIdleEntriesV2,
  autoFailStuckJobsV2,
  getMemoryManagerStatsV2,
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
    .option("--scope <scope>", "session | agent | user | global")
    .option(
      "--scope-id <id>",
      "Session/agent/user id (required for non-global scopes)",
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
    .requiredOption("--scope <scope>", "session | agent | user | global")
    .option("--scope-id <id>", "Required for session/agent/user scope")
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

  // memory consolidate — Managed Agents parity Phase G
  // Reads a JSONL session and writes extracted facts into session-core MemoryStore
  memory
    .command("consolidate")
    .description("Consolidate a session's trace into scoped memory")
    .requiredOption("--session <id>", "Session ID (JSONL)")
    .option("--scope <scope>", "session | agent | global", "agent")
    .option("--scope-id <id>", "Override scope id (default: agent/session id)")
    .option("--agent-id <id>", "Attach consolidated memories to this agent id")
    .option("--dry-run", "Extract facts without writing to MemoryStore")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const { consolidateJsonlSession, buildTraceStoreFromJsonl } =
          await import("../lib/session-consolidator.js");

        if (options.dryRun) {
          const { readEvents, sessionExists } =
            await import("../harness/jsonl-session-store.js");
          if (!sessionExists(options.session)) {
            logger.error(`Session not found: ${options.session}`);
            process.exit(1);
          }
          const events = readEvents(options.session);
          const trace = buildTraceStoreFromJsonl(options.session, events);
          const traceEvents = trace.query(options.session, {
            limit: Number.MAX_SAFE_INTEGER,
          });
          const { defaultMemoryExtractor } =
            await import("@chainlesschain/session-core");
          const facts = defaultMemoryExtractor(traceEvents);
          if (options.json) {
            console.log(
              JSON.stringify(
                { dryRun: true, factCount: facts.length, facts },
                null,
                2,
              ),
            );
          } else {
            logger.log(
              chalk.bold(
                `Dry run: ${facts.length} facts would be written (no memory modified).\n`,
              ),
            );
            for (const f of facts) {
              logger.log(
                `  ${chalk.cyan(f.category)}  ${chalk.gray((f.tags || []).join(","))}`,
              );
              logger.log(`    ${chalk.white(String(f.content).slice(0, 160))}`);
            }
          }
          return;
        }

        const result = await consolidateJsonlSession(options.session, {
          scope: options.scope,
          scopeId: options.scopeId || null,
          agentId: options.agentId || null,
        });
        await new Promise((r) => setImmediate(r)); // let adapter flush

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success(
            `Consolidated ${chalk.cyan(result.writtenCount)} memory entries ` +
              `(${result.eventCount} trace events, scope=${chalk.yellow(result.scope)}).`,
          );
          for (const m of result.written.slice(0, 10)) {
            logger.log(
              `  ${chalk.gray(m.id.slice(0, 12))}  ${chalk.cyan(m.category)}  ${chalk.white(String(m.content).slice(0, 120))}`,
            );
          }
        }
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

  // ─── V2 governance surface ─────────────────────────────────

  memory
    .command("entry-maturities-v2")
    .description("List V2 entry maturity states")
    .action(() => {
      console.log(JSON.stringify(Object.values(ENTRY_MATURITY_V2), null, 2));
    });

  memory
    .command("consolidation-lifecycles-v2")
    .description("List V2 consolidation job lifecycle states")
    .action(() => {
      console.log(
        JSON.stringify(Object.values(CONSOLIDATION_LIFECYCLE_V2), null, 2),
      );
    });

  memory
    .command("stats-v2")
    .description("Show V2 governance stats")
    .action(() => {
      console.log(JSON.stringify(getMemoryManagerStatsV2(), null, 2));
    });

  memory
    .command("get-max-active-entries-v2")
    .description("Get max active entries per category")
    .action(() => console.log(getMaxActiveEntriesPerCategoryV2()));

  memory
    .command("set-max-active-entries-v2 <n>")
    .description("Set max active entries per category")
    .action((n) => {
      setMaxActiveEntriesPerCategoryV2(Number(n));
      console.log(getMaxActiveEntriesPerCategoryV2());
    });

  memory
    .command("get-max-running-jobs-v2")
    .description("Get max running jobs per source")
    .action(() => console.log(getMaxRunningJobsPerSourceV2()));

  memory
    .command("set-max-running-jobs-v2 <n>")
    .description("Set max running jobs per source")
    .action((n) => {
      setMaxRunningJobsPerSourceV2(Number(n));
      console.log(getMaxRunningJobsPerSourceV2());
    });

  memory
    .command("get-entry-idle-ms-v2")
    .description("Get entry idle threshold (ms)")
    .action(() => console.log(getEntryIdleMsV2()));

  memory
    .command("set-entry-idle-ms-v2 <n>")
    .description("Set entry idle threshold (ms)")
    .action((n) => {
      setEntryIdleMsV2(Number(n));
      console.log(getEntryIdleMsV2());
    });

  memory
    .command("get-job-stuck-ms-v2")
    .description("Get job stuck threshold (ms)")
    .action(() => console.log(getJobStuckMsV2()));

  memory
    .command("set-job-stuck-ms-v2 <n>")
    .description("Set job stuck threshold (ms)")
    .action((n) => {
      setJobStuckMsV2(Number(n));
      console.log(getJobStuckMsV2());
    });

  memory
    .command("active-entry-count-v2 <category>")
    .description("Count active entries for a category")
    .action((category) => console.log(getActiveEntryCountV2(category)));

  memory
    .command("running-job-count-v2 <source>")
    .description("Count running jobs for a source")
    .action((source) => console.log(getRunningJobCountV2(source)));

  memory
    .command("register-entry-v2 <id>")
    .description("Register a V2 entry")
    .requiredOption("-c, --category <category>", "Category")
    .requiredOption("-s, --summary <summary>", "Summary")
    .action((id, opts) => {
      const e = registerEntryV2(id, {
        category: opts.category,
        summary: opts.summary,
      });
      console.log(JSON.stringify(e, null, 2));
    });

  memory
    .command("get-entry-v2 <id>")
    .description("Get a V2 entry")
    .action((id) => {
      const e = getEntryV2(id);
      console.log(e ? JSON.stringify(e, null, 2) : "null");
    });

  memory
    .command("list-entries-v2")
    .description("List V2 entries")
    .option("-c, --category <category>", "Filter by category")
    .option("-s, --status <status>", "Filter by status")
    .action((opts) => {
      console.log(
        JSON.stringify(
          listEntriesV2({ category: opts.category, status: opts.status }),
          null,
          2,
        ),
      );
    });

  memory
    .command("activate-entry-v2 <id>")
    .description("pending|parked → active")
    .action((id) => console.log(JSON.stringify(activateEntryV2(id), null, 2)));

  memory
    .command("park-entry-v2 <id>")
    .description("active → parked")
    .action((id) => console.log(JSON.stringify(parkEntryV2(id), null, 2)));

  memory
    .command("archive-entry-v2 <id>")
    .description("→ archived (terminal)")
    .action((id) => console.log(JSON.stringify(archiveEntryV2(id), null, 2)));

  memory
    .command("touch-entry-v2 <id>")
    .description("Update lastSeenAt")
    .action((id) => console.log(JSON.stringify(touchEntryV2(id), null, 2)));

  memory
    .command("create-job-v2 <id>")
    .description("Create a V2 consolidation job")
    .requiredOption("-s, --source <source>", "Source")
    .requiredOption("-c, --scope <scope>", "Scope")
    .action((id, opts) => {
      const j = createConsolidationJobV2(id, {
        source: opts.source,
        scope: opts.scope,
      });
      console.log(JSON.stringify(j, null, 2));
    });

  memory
    .command("get-job-v2 <id>")
    .description("Get a V2 consolidation job")
    .action((id) => {
      const j = getConsolidationJobV2(id);
      console.log(j ? JSON.stringify(j, null, 2) : "null");
    });

  memory
    .command("list-jobs-v2")
    .description("List V2 consolidation jobs")
    .option("-s, --source <source>", "Filter by source")
    .option("--status <status>", "Filter by status")
    .action((opts) => {
      console.log(
        JSON.stringify(
          listConsolidationJobsV2({ source: opts.source, status: opts.status }),
          null,
          2,
        ),
      );
    });

  memory
    .command("start-job-v2 <id>")
    .description("queued → running")
    .action((id) =>
      console.log(JSON.stringify(startConsolidationJobV2(id), null, 2)),
    );

  memory
    .command("succeed-job-v2 <id>")
    .description("running → succeeded (terminal)")
    .action((id) =>
      console.log(JSON.stringify(succeedConsolidationJobV2(id), null, 2)),
    );

  memory
    .command("fail-job-v2 <id>")
    .description("running → failed (terminal)")
    .action((id) =>
      console.log(JSON.stringify(failConsolidationJobV2(id), null, 2)),
    );

  memory
    .command("cancel-job-v2 <id>")
    .description("queued|running → cancelled (terminal)")
    .action((id) =>
      console.log(JSON.stringify(cancelConsolidationJobV2(id), null, 2)),
    );

  memory
    .command("auto-park-idle-entries-v2")
    .description("Flip idle active entries → parked")
    .action(() =>
      console.log(JSON.stringify(autoParkIdleEntriesV2(), null, 2)),
    );

  memory
    .command("auto-fail-stuck-jobs-v2")
    .description("Flip stuck running jobs → failed")
    .action(() => console.log(JSON.stringify(autoFailStuckJobsV2(), null, 2)));
}

// === Iter21 V2 governance overlay ===
export function registerMemgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "memory");
  if (!parent) return;
  const L = async () => await import("../lib/memory-manager.js");
  parent
    .command("memgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.MEMGOV_PROFILE_MATURITY_V2,
            recallLifecycle: m.MEMGOV_RECALL_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("memgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveMemgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingMemgovRecallsPerProfileV2(),
            idleMs: m.getMemgovProfileIdleMsV2(),
            stuckMs: m.getMemgovRecallStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("memgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveMemgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("memgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingMemgovRecallsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("memgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setMemgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("memgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setMemgovRecallStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("memgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--scope <v>", "scope")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerMemgovProfileV2({ id, owner, scope: o.scope }),
          null,
          2,
        ),
      );
    });
  parent
    .command("memgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateMemgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("memgov-stale-v2 <id>")
    .description("Stale profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).staleMemgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("memgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveMemgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("memgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchMemgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("memgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getMemgovProfileV2(id), null, 2));
    });
  parent
    .command("memgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listMemgovProfilesV2(), null, 2));
    });
  parent
    .command("memgov-create-recall-v2 <id> <profileId>")
    .description("Create recall")
    .option("--key <v>", "key")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createMemgovRecallV2({ id, profileId, key: o.key }),
          null,
          2,
        ),
      );
    });
  parent
    .command("memgov-recalling-recall-v2 <id>")
    .description("Mark recall as recalling")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).recallingMemgovRecallV2(id), null, 2),
      );
    });
  parent
    .command("memgov-complete-recall-v2 <id>")
    .description("Complete recall")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeRecallMemgovV2(id), null, 2),
      );
    });
  parent
    .command("memgov-fail-recall-v2 <id> [reason]")
    .description("Fail recall")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failMemgovRecallV2(id, reason), null, 2),
      );
    });
  parent
    .command("memgov-cancel-recall-v2 <id> [reason]")
    .description("Cancel recall")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelMemgovRecallV2(id, reason), null, 2),
      );
    });
  parent
    .command("memgov-get-recall-v2 <id>")
    .description("Get recall")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getMemgovRecallV2(id), null, 2));
    });
  parent
    .command("memgov-list-recalls-v2")
    .description("List recalls")
    .action(async () => {
      console.log(JSON.stringify((await L()).listMemgovRecallsV2(), null, 2));
    });
  parent
    .command("memgov-auto-stale-idle-v2")
    .description("Auto-stale idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoStaleIdleMemgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("memgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck recalls")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckMemgovRecallsV2(), null, 2),
      );
    });
  parent
    .command("memgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getMemoryManagerGovStatsV2(), null, 2),
      );
    });
}
