/**
 * Session management commands
 * chainlesschain session list|show|resume|export|delete
 */

import fs from "fs";
import path from "path";
import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  listSessions,
  getSession,
  deleteSession,
  exportSessionMarkdown,
  CONVERSATION_MATURITY_V2,
  TURN_LIFECYCLE_V2,
  getMaxActiveConvPerUserV2,
  setMaxActiveConvPerUserV2,
  getMaxPendingTurnsPerConvV2,
  setMaxPendingTurnsPerConvV2,
  getConvIdleMsV2,
  setConvIdleMsV2,
  getTurnStuckMsV2,
  setTurnStuckMsV2,
  getActiveConvCountV2,
  getPendingTurnCountV2,
  registerConversationV2,
  getConversationV2,
  listConversationsV2,
  activateConversationV2,
  pauseConversationV2,
  archiveConversationV2,
  touchConversationV2,
  createTurnV2,
  getTurnV2,
  listTurnsV2,
  streamTurnV2,
  completeTurnV2,
  failTurnV2,
  cancelTurnV2,
  autoArchiveIdleConversationsV2,
  autoFailStuckTurnsV2,
  getSessionManagerStatsV2,
} from "../lib/session-manager.js";
import {
  listJsonlSessions,
  rebuildMessages,
  sessionExists,
  readEvents,
  migrateLegacySessions,
  migrateLegacySessionsBatch,
  validateJsonlSession,
  validateAllJsonlSessions,
} from "../harness/jsonl-session-store.js";
import { feature } from "../lib/feature-flags.js";
import {
  listWorkflowSessions,
  readWorkflowSession,
} from "../lib/workflow-state-reader.js";

export function registerSessionCommand(program) {
  const session = program
    .command("session")
    .description("Conversation session management");

  // session list
  session
    .command("list", { isDefault: true })
    .description("List saved sessions")
    .option("-n, --limit <n>", "Max sessions", "20")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const limit = Math.max(1, parseInt(options.limit) || 20);
        let sessions = [];

        // Merge DB sessions + JSONL sessions
        if (ctx.db) {
          const db = ctx.db.getDatabase();
          sessions.push(
            ...listSessions(db, { limit }).map((s) => ({
              ...s,
              _store: "db",
            })),
          );
        }

        if (feature("JSONL_SESSION")) {
          sessions.push(
            ...listJsonlSessions({ limit }).map((s) => ({
              ...s,
              _store: "jsonl",
            })),
          );
        }

        // Deduplicate by id (JSONL takes precedence), sort by updated_at
        const seen = new Set();
        sessions = sessions
          .sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1))
          .filter((s) => {
            if (seen.has(s.id)) return false;
            seen.add(s.id);
            return true;
          })
          .slice(0, limit);

        if (options.json) {
          console.log(JSON.stringify(sessions, null, 2));
        } else if (sessions.length === 0) {
          logger.info(
            "No saved sessions. Use 'chat' or 'agent' to create one.",
          );
        } else {
          logger.log(chalk.bold(`Sessions (${sessions.length}):\n`));
          for (const s of sessions) {
            const storeTag =
              s._store === "jsonl" ? chalk.yellow("[JSONL]") : "";
            logger.log(
              `  ${chalk.gray(s.id.slice(0, 16))}  ${chalk.white(s.title)}  ${chalk.cyan(s.message_count + " msgs")}  ${chalk.gray(s.updated_at)} ${storeTag}`,
            );
            if (s.summary) {
              logger.log(`    ${chalk.gray(s.summary.substring(0, 100))}`);
            }
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // session show
  session
    .command("show")
    .description("Show a session's messages")
    .argument("<id>", "Session ID (or prefix)")
    .option("-n, --limit <n>", "Max messages to show")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        let sess = null;

        // Try JSONL first if enabled
        if (feature("JSONL_SESSION") && sessionExists(id)) {
          const events = readEvents(id);
          const startEvent = events.find((e) => e.type === "session_start");
          const msgs = rebuildMessages(id);
          sess = {
            id,
            title: startEvent?.data?.title || "Untitled",
            provider: startEvent?.data?.provider || "",
            model: startEvent?.data?.model || "",
            message_count: msgs.length,
            messages: msgs,
            _store: "jsonl",
          };
        }

        // Fallback to DB
        if (!sess && ctx.db) {
          const db = ctx.db.getDatabase();
          sess = getSession(db, id);
        }

        if (!sess) {
          logger.error(`Session not found: ${id}`);
          process.exit(1);
        }

        if (options.json) {
          console.log(JSON.stringify(sess, null, 2));
        } else {
          logger.log(chalk.bold(sess.title));
          logger.log(
            chalk.gray(
              `ID: ${sess.id}  Provider: ${sess.provider}  Model: ${sess.model}  Messages: ${sess.message_count}`,
            ),
          );
          logger.log("");

          let messages = sess.messages;
          if (options.limit) {
            messages = messages.slice(-parseInt(options.limit));
          }

          for (const msg of messages) {
            if (msg.role === "system") continue;
            const label =
              msg.role === "user" ? chalk.green("you> ") : chalk.blue("ai> ");
            const content = (msg.content || "").substring(0, 500);
            logger.log(`${label}${content}`);
            logger.log("");
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // session resume
  session
    .command("resume")
    .description("Resume a session in chat mode")
    .argument("<id>", "Session ID (or prefix)")
    .option("--model <model>", "Model name")
    .option("--provider <provider>", "LLM provider")
    .action(async (id, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        let sess = null;

        // Try JSONL first
        if (feature("JSONL_SESSION") && sessionExists(id)) {
          const events = readEvents(id);
          const startEvent = events.find((e) => e.type === "session_start");
          sess = {
            id,
            title: startEvent?.data?.title || "Untitled",
            provider: startEvent?.data?.provider || "",
            model: startEvent?.data?.model || "",
            messages: rebuildMessages(id),
          };
          sess.message_count = sess.messages.length;
        }

        // Fallback to DB
        if (!sess && ctx.db) {
          const db = ctx.db.getDatabase();
          sess = getSession(db, id);
        }

        if (!sess) {
          logger.error(`Session not found: ${id}`);
          process.exit(1);
        }

        logger.info(
          `Resuming session: ${chalk.cyan(sess.title)} (${sess.message_count} messages)`,
        );

        // Import and start chat REPL with restored messages
        const { startChatRepl } = await import("../repl/chat-repl.js");
        await startChatRepl({
          model: options.model || sess.model || "qwen2:7b",
          provider: options.provider || sess.provider || "ollama",
          baseUrl: options.baseUrl || "http://localhost:11434",
          resumeMessages: sess.messages,
          sessionId: sess.id,
        });
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // session export
  session
    .command("export")
    .description("Export a session as Markdown")
    .argument("<id>", "Session ID (or prefix)")
    .option("-o, --output <file>", "Output file path")
    .action(async (id, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const sess = getSession(db, id);

        if (!sess) {
          logger.error(`Session not found: ${id}`);
          process.exit(1);
        }

        const markdown = exportSessionMarkdown(sess);

        if (options.output) {
          fs.writeFileSync(options.output, markdown, "utf8");
          logger.success(`Exported to ${chalk.cyan(options.output)}`);
        } else {
          console.log(markdown);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // session delete
  session
    .command("delete")
    .description("Delete a session")
    .argument("<id>", "Session ID")
    .option("--force", "Skip confirmation")
    .action(async (id, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();

        if (!options.force) {
          const { confirm } = await import("@inquirer/prompts");
          const ok = await confirm({
            message: `Delete session "${id}"?`,
          });
          if (!ok) {
            logger.info("Cancelled");
            await shutdown();
            return;
          }
        }

        const ok = deleteSession(db, id);
        if (ok) {
          logger.success("Session deleted");
        } else {
          logger.error(`Session not found: ${id}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  session
    .command("migrate")
    .description("Migrate legacy JSON session files to JSONL")
    .argument("[source]", "Directory containing legacy .json session files")
    .option("--dry-run", "Show what would migrate without writing files")
    .option("--force", "Overwrite existing JSONL sessions")
    .option("--no-archive", "Do not keep .migrated.json backups")
    .option(
      "--sample-size <n>",
      "Validate N migrated sessions after migration",
      "3",
    )
    .option("--retry-failures", "Retry failed migrations once")
    .option("--json", "Output as JSON")
    .action(async (source, options) => {
      try {
        const report = migrateLegacySessionsBatch(source, {
          dryRun: options.dryRun,
          force: options.force,
          archive: options.archive,
          sampleSize: parseInt(options.sampleSize, 10) || 3,
          retryFailures: options.retryFailures,
        });
        const results =
          report.results || migrateLegacySessions(source, options);

        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
          return;
        }

        if (results.length === 0) {
          logger.info("No legacy JSON session files found.");
          return;
        }

        for (const result of results) {
          if (result.skipped) {
            logger.log(
              `${chalk.yellow("skip")} ${result.file} -> ${result.sessionId} (${result.reason})`,
            );
            continue;
          }
          logger.log(
            `${chalk.green(options.dryRun ? "plan" : "migrated")} ${result.file} -> ${result.sessionId} (${result.messageCount} messages)`,
          );
        }

        logger.log(
          chalk.gray(
            `summary: scanned ${report.summary.scanned}, migrated ${report.summary.migrated}, skipped ${report.summary.skipped}, failed ${report.summary.failed}, retries ${report.summary.retries}`,
          ),
        );

        if (report.sampledValidation?.length) {
          for (const item of report.sampledValidation) {
            const label =
              item.valid && item.matchesExpectedMessages
                ? chalk.green("sample-ok")
                : chalk.red("sample-fail");
            logger.log(
              `${label} ${item.sessionId} (${item.messageCount}/${item.expectedMessageCount} messages)`,
            );
          }
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  session
    .command("validate")
    .description("Validate JSONL session files")
    .argument("[id]", "Session ID to validate")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const result = id
          ? validateJsonlSession(id)
          : validateAllJsonlSessions();

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const results = Array.isArray(result) ? result : [result];
        for (const item of results) {
          const label = item.valid
            ? chalk.green("valid")
            : chalk.red("invalid");
          logger.log(
            `${label} ${item.sessionId} (${item.eventCount} events, ${item.messageCount || 0} messages, malformed: ${item.malformedLines})`,
          );
          if (!item.valid && item.reason) {
            logger.log(`  ${chalk.gray(item.reason)}`);
          }
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // session policy — Managed Agents parity Phase E1 approval policy
  session
    .command("policy")
    .description("Show or set per-session approval policy")
    .argument("<id>", "Session ID")
    .option("--set <policy>", "strict | trusted | autopilot")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const { getApprovalGate } =
          await import("../lib/session-core-singletons.js");
        const gate = await getApprovalGate();
        if (options.set) {
          gate.setSessionPolicy(id, options.set);
          // give persistence a tick before the CLI process exits
          await new Promise((r) => setImmediate(r));
          logger.success(
            `Session ${chalk.gray(id.slice(0, 12))} policy → ${chalk.cyan(options.set)}`,
          );
        }
        const current = gate.getSessionPolicy(id);
        if (options.json) {
          console.log(JSON.stringify({ sessionId: id, policy: current }));
        } else if (!options.set) {
          logger.log(
            `Session ${chalk.gray(id.slice(0, 12))} policy: ${chalk.cyan(current)}`,
          );
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------
  // session-core SessionManager lifecycle (Phase H — CLI parity)
  // Parked sessions persist to ~/.chainlesschain/parked-sessions.json
  // ---------------------------------------------------------------
  session
    .command("lifecycle")
    .description("List session-core handles (running/idle/parked)")
    .option("--status <s>", "Filter by status: running | idle | parked")
    .option("--agent <id>", "Filter by agent id")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const { getSessionManager } =
          await import("../lib/session-core-singletons.js");
        const mgr = getSessionManager();
        const live = mgr.list({
          agentId: options.agent,
          status: options.status,
        });
        let parked = [];
        if (mgr._parkedStore) {
          const all = await mgr._parkedStore.list();
          parked = all
            .filter((s) => !options.agent || s.agentId === options.agent)
            .filter((s) => !options.status || s.status === options.status);
        }
        const merged = [
          ...live.map((h) => h.toJSON()),
          ...parked.filter(
            (p) => !live.some((h) => h.sessionId === p.sessionId),
          ),
        ];
        if (options.json) {
          console.log(JSON.stringify(merged, null, 2));
          return;
        }
        if (merged.length === 0) {
          logger.info("No session-core handles");
          return;
        }
        for (const h of merged) {
          logger.log(
            `${chalk.gray(h.sessionId.slice(0, 12))}  ${chalk.cyan(h.status.padEnd(7))}  agent=${h.agentId || "-"}`,
          );
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  session
    .command("park")
    .description("Park a session (persist to disk, free process memory)")
    .argument("<id>", "Session ID")
    .action(async (id) => {
      try {
        const { getSessionManager } =
          await import("../lib/session-core-singletons.js");
        const mgr = getSessionManager();
        if (!mgr.has(id)) {
          logger.error(`Session ${id} is not active in this process`);
          process.exit(1);
        }
        mgr.markIdle(id);
        const ok = await mgr.park(id);
        if (!ok) {
          logger.error(`Failed to park ${id}`);
          process.exit(1);
        }
        logger.success(`Session ${chalk.gray(id.slice(0, 12))} parked`);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  session
    .command("unpark")
    .description("Resume a parked session")
    .argument("<id>", "Session ID")
    .action(async (id) => {
      try {
        const { getSessionManager } =
          await import("../lib/session-core-singletons.js");
        const mgr = getSessionManager();
        const ok = await mgr.resume(id);
        if (!ok) {
          logger.error(`No parked session ${id}`);
          process.exit(1);
        }
        logger.success(`Session ${chalk.gray(id.slice(0, 12))} resumed`);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  session
    .command("end")
    .description(
      "Close a session (optionally consolidate trace into MemoryStore)",
    )
    .argument("<id>", "Session ID")
    .option(
      "--consolidate",
      "Consolidate JSONL trace into MemoryStore before closing",
    )
    .option("--scope <s>", "Memory scope for consolidation", "session")
    .option("--scope-id <id>", "Scope id (defaults to session id)")
    .option("--agent-id <id>", "Agent id for scope=agent")
    .action(async (id, options) => {
      try {
        const { getSessionManager } =
          await import("../lib/session-core-singletons.js");
        if (options.consolidate) {
          try {
            const { consolidateJsonlSession } =
              await import("../lib/session-consolidator.js");
            const res = await consolidateJsonlSession(id, {
              scope: options.scope,
              scopeId: options.scopeId || null,
              agentId: options.agentId || null,
            });
            await new Promise((r) => setImmediate(r));
            logger.info(
              `Consolidated ${res.writtenCount} memory entries from session trace`,
            );
          } catch (e) {
            logger.warn(`Consolidation skipped: ${e.message}`);
          }
        }
        const mgr = getSessionManager();
        const ok = await mgr.close(id);
        if (!ok && mgr._parkedStore) {
          await mgr._parkedStore.remove(id);
        }
        logger.success(`Session ${chalk.gray(id.slice(0, 12))} closed`);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------
  // session tail <id> — Phase I: follow JSONL events as NDJSON
  // ---------------------------------------------------------------
  session
    .command("tail")
    .description("Follow a JSONL session's events (NDJSON on stdout)")
    .argument("<id>", "Session ID")
    .option("--from-start", "Start from the first event (default: EOF)")
    .option("--from-offset <n>", "Start from explicit byte offset")
    .option("-t, --type <types>", "Comma-separated event types to include")
    .option("--since <ms>", "Only events with timestamp >= ms")
    .option("--once", "Drain current tail and exit (no follow)")
    .option("--poll <ms>", "Poll interval", "200")
    .action(async (id, options) => {
      try {
        const { followSession } = await import("../lib/session-tail.js");
        const controller = new AbortController();
        const onSig = () => controller.abort();
        process.once("SIGINT", onSig);
        process.once("SIGTERM", onSig);
        const types = options.type
          ? options.type
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : null;
        const iter = followSession(id, {
          signal: controller.signal,
          pollMs: parseInt(options.poll, 10) || 200,
          fromStart: Boolean(options.fromStart),
          fromOffset:
            options.fromOffset !== undefined
              ? parseInt(options.fromOffset, 10)
              : undefined,
          types,
          sinceMs: options.since ? parseInt(options.since, 10) : null,
          once: Boolean(options.once),
        });
        for await (const { event } of iter) {
          process.stdout.write(JSON.stringify(event) + "\n");
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------
  // session usage [id] — Phase I: aggregate token usage
  // ---------------------------------------------------------------
  session
    .command("usage")
    .description("Aggregate token usage (per-session or global)")
    .argument("[id]", "Session ID (omit for global rollup)")
    .option("--json", "Output as JSON")
    .option("--limit <n>", "Max sessions for global rollup", "1000")
    .action(async (id, options) => {
      try {
        const { sessionUsage, allSessionsUsage } =
          await import("../lib/session-usage.js");
        const result = id
          ? sessionUsage(id)
          : allSessionsUsage({ limit: parseInt(options.limit, 10) || 1000 });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (id) {
          logger.log(chalk.bold(`Session ${chalk.gray(id.slice(0, 16))}`));
          const t = result.total;
          logger.log(
            `  total: ${chalk.cyan(t.totalTokens.toLocaleString())} tokens  in=${t.inputTokens}  out=${t.outputTokens}  calls=${t.calls}`,
          );
          if (result.byModel.length === 0) {
            logger.log(chalk.gray("  (no token_usage events recorded)"));
            return;
          }
          for (const row of result.byModel) {
            logger.log(
              `  ${chalk.gray((row.provider || "?").padEnd(10))} ${chalk.white((row.model || "?").padEnd(24))} in=${row.inputTokens}  out=${row.outputTokens}  calls=${row.calls}`,
            );
          }
        } else {
          const t = result.total;
          logger.log(chalk.bold("Global usage"));
          logger.log(
            `  total: ${chalk.cyan(t.totalTokens.toLocaleString())} tokens  in=${t.inputTokens}  out=${t.outputTokens}  calls=${t.calls}  sessions=${result.sessions.length}`,
          );
          if (result.byModel.length === 0) {
            logger.log(chalk.gray("  (no token_usage events recorded)"));
            return;
          }
          for (const row of result.byModel) {
            logger.log(
              `  ${chalk.gray((row.provider || "?").padEnd(10))} ${chalk.white((row.model || "?").padEnd(24))} in=${row.inputTokens}  out=${row.outputTokens}  calls=${row.calls}`,
            );
          }
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // session workflow — inspect canonical coding workflow state
  // Reads .chainlesschain/sessions/<id>/{intent.md,plan.md,progress.log,mode.json}
  // written by the 4 workflow skills ($deep-interview/$ralplan/$ralph/$team).
  session
    .command("workflow")
    .description("Inspect coding workflow state (.chainlesschain/sessions/)")
    .argument("[id]", "Workflow session ID (omit to list all)")
    .option("--json", "Output as JSON")
    .option("--cwd <path>", "Project root (defaults to process.cwd())")
    .action((id, options) => {
      try {
        const projectRoot = path.resolve(options.cwd || process.cwd());

        if (!id) {
          const items = listWorkflowSessions(projectRoot);
          if (options.json) {
            console.log(JSON.stringify(items, null, 2));
            return;
          }
          if (items.length === 0) {
            logger.info("No workflow sessions under .chainlesschain/sessions/");
            logger.info(
              'Start one with: $deep-interview "<your goal>" in the coding agent',
            );
            return;
          }
          logger.log(chalk.bold(`Workflow sessions (${items.length}):\n`));
          for (const s of items) {
            const approvedTag = s.approved
              ? chalk.green("approved")
              : s.hasPlan
                ? chalk.yellow("unapproved")
                : chalk.gray("no-plan");
            logger.log(
              `  ${chalk.cyan(s.sessionId)}  ${chalk.white(s.stage || "?")}  ${approvedTag}  ${chalk.gray(s.updatedAt || "")}`,
            );
          }
          return;
        }

        const data = readWorkflowSession(projectRoot, id);
        if (!data) {
          logger.error(`Workflow session "${id}" not found`);
          process.exit(1);
        }
        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }
        logger.log(chalk.bold(`\nSession: ${data.sessionId}`));
        logger.log(
          `Stage:  ${data.mode?.stage || chalk.gray("(unset)")}    Approved: ${
            data.planApproved ? chalk.green("yes") : chalk.yellow("no")
          }`,
        );
        logger.log(chalk.gray(`Dir:    ${data.dir}\n`));

        if (data.intent) {
          logger.log(chalk.bold("── intent.md ──"));
          logger.log(data.intent.trim());
          logger.log("");
        } else {
          logger.log(chalk.gray("(no intent.md — run $deep-interview first)"));
        }

        if (data.plan) {
          logger.log(chalk.bold("── plan.md ──"));
          logger.log(data.plan.trim());
          logger.log("");
        } else {
          logger.log(chalk.gray("(no plan.md — run $ralplan)"));
        }

        if (data.progress) {
          logger.log(chalk.bold("── progress.log (tail) ──"));
          const lines = data.progress.trim().split("\n");
          for (const line of lines.slice(-20)) {
            logger.log(`  ${line}`);
          }
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ─────────────────────────────────────────────────────────────
  // V2 Surface — conversation + turn lifecycle (in-memory, throwing API)
  // ─────────────────────────────────────────────────────────────

  session
    .command("conversation-maturities-v2")
    .description("List V2 conversation maturity states")
    .option("--json", "Output as JSON")
    .action((options) => {
      const v = Object.values(CONVERSATION_MATURITY_V2);
      if (options.json) console.log(JSON.stringify(v));
      else logger.log(v.join(", "));
    });

  session
    .command("turn-lifecycles-v2")
    .description("List V2 turn lifecycle states")
    .option("--json", "Output as JSON")
    .action((options) => {
      const v = Object.values(TURN_LIFECYCLE_V2);
      if (options.json) console.log(JSON.stringify(v));
      else logger.log(v.join(", "));
    });

  session
    .command("stats-v2")
    .description("Show V2 session stats")
    .option("--json", "Output as JSON")
    .action((options) => {
      const stats = getSessionManagerStatsV2();
      if (options.json) console.log(JSON.stringify(stats, null, 2));
      else logger.log(JSON.stringify(stats, null, 2));
    });

  session
    .command("get-max-active-conv-v2")
    .description("Get max active conversations per user")
    .action(() => logger.log(String(getMaxActiveConvPerUserV2())));
  session
    .command("set-max-active-conv-v2 <n>")
    .description("Set max active conversations per user")
    .action((n) => {
      setMaxActiveConvPerUserV2(Number(n));
      logger.log(String(getMaxActiveConvPerUserV2()));
    });
  session
    .command("get-max-pending-turns-v2")
    .description("Get max pending turns per conversation")
    .action(() => logger.log(String(getMaxPendingTurnsPerConvV2())));
  session
    .command("set-max-pending-turns-v2 <n>")
    .description("Set max pending turns per conversation")
    .action((n) => {
      setMaxPendingTurnsPerConvV2(Number(n));
      logger.log(String(getMaxPendingTurnsPerConvV2()));
    });
  session
    .command("get-conv-idle-ms-v2")
    .description("Get conversation idle ms")
    .action(() => logger.log(String(getConvIdleMsV2())));
  session
    .command("set-conv-idle-ms-v2 <ms>")
    .description("Set conversation idle ms")
    .action((ms) => {
      setConvIdleMsV2(Number(ms));
      logger.log(String(getConvIdleMsV2()));
    });
  session
    .command("get-turn-stuck-ms-v2")
    .description("Get turn stuck ms")
    .action(() => logger.log(String(getTurnStuckMsV2())));
  session
    .command("set-turn-stuck-ms-v2 <ms>")
    .description("Set turn stuck ms")
    .action((ms) => {
      setTurnStuckMsV2(Number(ms));
      logger.log(String(getTurnStuckMsV2()));
    });

  session
    .command("active-conv-count-v2 <userId>")
    .description("Count active conversations for user")
    .action((userId) => logger.log(String(getActiveConvCountV2(userId))));
  session
    .command("pending-turn-count-v2 <conversationId>")
    .description("Count pending+streaming turns for conversation")
    .action((conversationId) =>
      logger.log(String(getPendingTurnCountV2(conversationId))),
    );

  session
    .command("register-conversation-v2 <id>")
    .description("Register V2 conversation (initial=draft)")
    .requiredOption("-u, --user <userId>", "user id")
    .requiredOption("-m, --model <model>", "model")
    .option("--metadata <json>", "metadata JSON", "{}")
    .action((id, opts) => {
      const meta = JSON.parse(opts.metadata);
      const c = registerConversationV2(id, {
        userId: opts.user,
        model: opts.model,
        metadata: meta,
      });
      console.log(JSON.stringify(c, null, 2));
    });

  session
    .command("get-conversation-v2 <id>")
    .description("Get V2 conversation by id")
    .action((id) => {
      const c = getConversationV2(id);
      if (!c) {
        logger.error(`conversation ${id} not found`);
        process.exit(1);
      }
      console.log(JSON.stringify(c, null, 2));
    });

  session
    .command("list-conversations-v2")
    .description("List V2 conversations")
    .option("-u, --user <userId>", "filter by user")
    .option("-s, --status <state>", "filter by status")
    .action((opts) => {
      const out = listConversationsV2({
        userId: opts.user,
        status: opts.status,
      });
      console.log(JSON.stringify(out, null, 2));
    });

  session
    .command("activate-conversation-v2 <id>")
    .description("Transition conversation → active")
    .action((id) =>
      console.log(JSON.stringify(activateConversationV2(id), null, 2)),
    );
  session
    .command("pause-conversation-v2 <id>")
    .description("Transition conversation → paused")
    .action((id) =>
      console.log(JSON.stringify(pauseConversationV2(id), null, 2)),
    );
  session
    .command("archive-conversation-v2 <id>")
    .description("Transition conversation → archived (terminal)")
    .action((id) =>
      console.log(JSON.stringify(archiveConversationV2(id), null, 2)),
    );
  session
    .command("touch-conversation-v2 <id>")
    .description("Update conversation lastSeenAt")
    .action((id) =>
      console.log(JSON.stringify(touchConversationV2(id), null, 2)),
    );

  session
    .command("create-turn-v2 <id>")
    .description("Create V2 turn (initial=pending)")
    .requiredOption("-c, --conversation <id>", "conversation id")
    .option("-r, --role <role>", "role (user/assistant)", "user")
    .option("-m, --metadata <json>", "metadata JSON", "{}")
    .action((id, opts) => {
      const meta = JSON.parse(opts.metadata);
      const t = createTurnV2(id, {
        conversationId: opts.conversation,
        role: opts.role,
        metadata: meta,
      });
      console.log(JSON.stringify(t, null, 2));
    });

  session
    .command("get-turn-v2 <id>")
    .description("Get V2 turn by id")
    .action((id) => {
      const t = getTurnV2(id);
      if (!t) {
        logger.error(`turn ${id} not found`);
        process.exit(1);
      }
      console.log(JSON.stringify(t, null, 2));
    });

  session
    .command("list-turns-v2")
    .description("List V2 turns")
    .option("-c, --conversation <id>", "filter by conversation")
    .option("-s, --status <state>", "filter by status")
    .action((opts) => {
      const out = listTurnsV2({
        conversationId: opts.conversation,
        status: opts.status,
      });
      console.log(JSON.stringify(out, null, 2));
    });

  session
    .command("stream-turn-v2 <id>")
    .description("Transition turn → streaming")
    .action((id) => console.log(JSON.stringify(streamTurnV2(id), null, 2)));
  session
    .command("complete-turn-v2 <id>")
    .description("Transition turn → completed (terminal)")
    .action((id) => console.log(JSON.stringify(completeTurnV2(id), null, 2)));
  session
    .command("fail-turn-v2 <id>")
    .description("Transition turn → failed (terminal)")
    .action((id) => console.log(JSON.stringify(failTurnV2(id), null, 2)));
  session
    .command("cancel-turn-v2 <id>")
    .description("Transition turn → cancelled (terminal)")
    .action((id) => console.log(JSON.stringify(cancelTurnV2(id), null, 2)));

  session
    .command("auto-archive-idle-conv-v2")
    .description("Auto-archive idle conversations; output flipped")
    .action(() => {
      const flipped = autoArchiveIdleConversationsV2();
      console.log(JSON.stringify(flipped, null, 2));
    });
  session
    .command("auto-fail-stuck-turns-v2")
    .description("Auto-fail stuck streaming turns; output flipped")
    .action(() => {
      const flipped = autoFailStuckTurnsV2();
      console.log(JSON.stringify(flipped, null, 2));
    });
}
