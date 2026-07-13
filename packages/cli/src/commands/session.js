/**
 * Session management commands
 * chainlesschain session list|show|resume|export|delete
 */

import fs from "fs";
import { numericOption } from "../lib/cli-numeric.js";
import path from "path";
import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { parseJsonOption } from "../lib/parse-json-option.js";
import { scanSecrets, redactSecrets } from "../lib/secret-scan.js";
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

// DB sessions store `updated_at` as SQLite datetime('now') → "YYYY-MM-DD
// HH:MM:SS" (UTC, space at index 10); JSONL sessions store toISOString() →
// "YYYY-MM-DDTHH:MM:SS.sssZ" (UTC, 'T' at index 10). Both are UTC, so normalize
// the space form to ISO-UTC and compare as epochs — a raw string compare
// resolves at index 10 ('T' 0x54 > ' ' 0x20) and would rank every JSONL session
// as newer than any same-date DB session regardless of the actual time.
function _sessionEpoch(ts) {
  if (typeof ts !== "string" || !ts) return 0;
  const iso =
    ts.includes(" ") && !ts.includes("T") ? ts.replace(" ", "T") + "Z" : ts;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Render a PR's automation status (P1-4 "PR/CI Monitor + 受控合并") from a
 * gathered signals object — PURE, so it is testable without gh / the network.
 * `enabled` mirrors the "auto-merge is OFF by default" rule: only an explicit
 * opt-in even considers a merge. Everything else defers to the fail-closed
 * pr-automation-policy decision engine.
 *
 * @param {object} signals  {branch, prNumber, hasOpenPr, headCommitSha,
 *   branchProtectionSatisfied, reviewApproved, pendingApprovals,
 *   requiredChecks, checks}
 * @param {{enabled?:boolean}} [opts]
 * @returns {{statusBar:string, autoMerge:{allow:boolean,reason:string,unmet:string[]}, lines:string[]}}
 */
export async function renderPrStatus(signals = {}, opts = {}) {
  const { autoMergeDecision, describePrStatusBar } =
    await import("../lib/pr-automation-policy.js");
  const autoMerge = autoMergeDecision({
    enabled: opts.enabled === true,
    hasOpenPr: signals.hasOpenPr,
    branchProtectionSatisfied: signals.branchProtectionSatisfied,
    reviewApproved: signals.reviewApproved,
    pendingApprovals: signals.pendingApprovals,
    requiredChecks: signals.requiredChecks,
    checks: signals.checks,
  });
  const statusBar = describePrStatusBar({
    branch: signals.branch,
    prNumber: signals.prNumber,
    checks: signals.checks,
    reviewApproved: signals.reviewApproved,
    mergeable: autoMerge.allow,
  });
  const lines = [statusBar];
  if (autoMerge.allow) {
    lines.push("auto-merge: ✓ eligible");
  } else {
    lines.push(`auto-merge: ✗ blocked (${autoMerge.unmet.join(", ")})`);
  }
  return { statusBar, autoMerge, lines };
}

/**
 * Best-effort map of `gh pr view --json …` output to the pr-automation signals.
 * PURE (json → json); the command supplies the gh JSON (or a --checks-file). A
 * missing field stays undefined so the fail-closed policy denies rather than
 * assuming.
 */
export function mapGhPrToSignals(gh = {}) {
  const rollup = Array.isArray(gh.statusCheckRollup)
    ? gh.statusCheckRollup
    : [];
  return {
    branch: gh.headRefName || undefined,
    prNumber: gh.number,
    hasOpenPr: String(gh.state || "").toUpperCase() === "OPEN",
    headCommitSha: gh.headRefOid || undefined,
    reviewApproved: gh.reviewDecision === "APPROVED",
    // gh doesn't expose branch-protection satisfaction or pending in-app
    // approvals here; leave them undefined → fail-closed unless a --checks-file
    // asserts them.
    checks: rollup.map((c) => ({
      name: c.name || c.context,
      // check runs use `conclusion`; legacy statuses use `state`.
      state: c.conclusion || c.state || c.status,
    })),
  };
}

/**
 * Best-effort live fetch of a PR's signals via `gh pr view --json`. Returns the
 * mapped signals, or throws (caller degrades to a "pass --checks-file" hint).
 * 8s timeout, stderr suppressed — a missing / unauthenticated gh just fails.
 */
async function fetchPrSignalsViaGh(target) {
  const { execFileSync } = await import("node:child_process");
  const args = [
    "pr",
    "view",
    String(target.number),
    "--json",
    "number,state,headRefName,headRefOid,reviewDecision,statusCheckRollup",
  ];
  if (target.repo) args.push("--repo", String(target.repo));
  const out = execFileSync("gh", args, {
    encoding: "utf-8",
    timeout: 8000,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return mapGhPrToSignals(JSON.parse(out));
}

export function rankSessions(sessions, limit) {
  // Dedup by id, preferring the JSONL copy when a session exists in both stores
  // (the original "JSONL takes precedence" intent, previously achieved only as
  // a side effect of the buggy lexicographic sort). Then rank by real time.
  const byId = new Map();
  for (const s of sessions) {
    const prev = byId.get(s.id);
    if (!prev || (s._store === "jsonl" && prev._store !== "jsonl")) {
      byId.set(s.id, s);
    }
  }
  return [...byId.values()]
    .sort((a, b) => _sessionEpoch(b.updated_at) - _sessionEpoch(a.updated_at))
    .slice(0, limit);
}

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

        // Deduplicate by id (JSONL takes precedence) and rank by real time.
        sessions = rankSessions(sessions, limit);

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

        // PR/session linking: surface PRs this session created/touched.
        try {
          const { getPrLinks } = await import("../lib/pr-link-ledger.js");
          const prLinks = getPrLinks(sess.id);
          if (prLinks.length > 0) sess.prLinks = prLinks;
        } catch (_err) {
          // PR decoration is cosmetic
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
          if (sess.prLinks) {
            for (const pr of sess.prLinks) {
              logger.log(
                chalk.magenta(
                  `PR: #${pr.number}${pr.state ? ` ${pr.state}` : ""}${pr.url ? `  ${pr.url}` : ""}`,
                ),
              );
            }
          }
          logger.log("");

          let messages = sess.messages;
          if (options.limit) {
            messages = messages.slice(
              -numericOption(options.limit, {
                name: "--limit",
                integer: true,
                min: 1,
              }),
            );
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

  // session pr-status — PR/CI monitor + controlled auto-merge decision (P1-4)
  // for a session's linked PR. Offline-testable via --checks-file; otherwise a
  // best-effort `gh pr view` fetch for the session's newest linked PR.
  session
    .command("pr-status")
    .description(
      "PR/CI monitor + controlled auto-merge decision for a session's linked PR",
    )
    .argument("[id]", "Session id (default: most recent)")
    .option("--pr <number>", "Which linked PR to assess (default: newest)")
    .option(
      "--checks-file <path>",
      "JSON file of PR signals {branch,prNumber,hasOpenPr,branchProtectionSatisfied,reviewApproved,pendingApprovals,requiredChecks,checks} — bypasses gh",
    )
    .option("--enable", "Consider auto-merge eligibility (default: off)")
    .option("--json", "Output as machine-readable JSON")
    .action(async (id, options) => {
      try {
        let signals = null;
        let source = "";
        if (options.checksFile) {
          // Offline / explicit path: the caller supplies the PR signals.
          signals = JSON.parse(fs.readFileSync(options.checksFile, "utf-8"));
          source = options.checksFile;
        } else {
          // Live path: resolve the session's linked PR and fetch via gh.
          const { getPrLinks } = await import("../lib/pr-link-ledger.js");
          const { getLastSessionId } =
            await import("../harness/jsonl-session-store.js");
          const sid = !id || id === "last" ? getLastSessionId() : id;
          const links = sid ? getPrLinks(sid) : [];
          if (links.length === 0) {
            logger.error(
              "No linked PRs for this session — pass --checks-file to assess a PR directly.",
            );
            process.exit(1);
          }
          let target;
          if (options.pr) {
            target = links.find((l) => String(l.number) === String(options.pr));
            if (!target) {
              logger.error(`Session has no linked PR #${options.pr}.`);
              process.exit(1);
            }
          } else {
            // Newest by updatedAt (epoch-normalized; unknowns sort last).
            target = links
              .slice()
              .sort(
                (a, b) =>
                  (Date.parse(b.updatedAt) || 0) -
                  (Date.parse(a.updatedAt) || 0),
              )[0];
          }
          signals = await fetchPrSignalsViaGh(target).catch(() => null);
          if (!signals) {
            logger.error(
              `Could not fetch PR #${target.number} via gh — authenticate gh or pass --checks-file.`,
            );
            process.exit(1);
          }
          source = `gh:${target.repo || "?"}#${target.number}`;
        }

        const result = await renderPrStatus(signals, {
          enabled: options.enable === true,
        });
        if (options.json) {
          console.log(JSON.stringify({ source, ...result }, null, 2));
        } else {
          logger.log(
            chalk.bold("PR automation status") + chalk.gray(`  (${source})`),
          );
          for (const line of result.lines) logger.log(`  ${line}`);
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // session resume
  session
    .command("resume")
    .description(
      "Resume a session in chat mode (id optional — interactive picker, or most recent when piped)",
    )
    .argument(
      "[id]",
      "Session ID (or prefix); omit to pick / resume the most recent",
    )
    .option("--model <model>", "Model name")
    .option("--provider <provider>", "LLM provider")
    .option(
      "--allow-tampered",
      "Resume even when the transcript hash chain is broken (context is untrusted)",
    )
    .action(async (id, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        let sess = null;

        // No id → shared interactive picker (TTY + >1) or most-recent fallback
        // (single / non-TTY / Ctrl-C). Same helper as `cc agent --resume`.
        if (!id) {
          const { pickRecentSession } =
            await import("../lib/session-picker.js");
          const picked = await pickRecentSession(ctx);
          if (!picked.id) {
            logger.error(
              "No saved sessions to resume. Use 'chat' or 'agent' to create one.",
            );
            process.exit(1);
          }
          id = picked.id;
        }

        // Try JSONL first
        if (feature("JSONL_SESSION") && sessionExists(id)) {
          // Tamper gate: a broken hash chain means the transcript was edited
          // outside the store — never silently rebuild it as trusted context.
          const { verifySession } =
            await import("../harness/jsonl-session-store.js");
          const trust = verifySession(id);
          if (trust.status === "tampered") {
            if (!options.allowTampered) {
              logger.error(
                `Session ${id} transcript failed integrity verification: ${trust.reason}` +
                  (trust.firstInvalidLine
                    ? ` (line ${trust.firstInvalidLine})`
                    : ""),
              );
              logger.error(
                "Refusing to resume tampered context. Inspect it read-only with " +
                  `'cc session show ${id}' / 'cc session verify ${id}', or pass --allow-tampered to override.`,
              );
              process.exit(1);
            }
            logger.warn(
              `⚠ Resuming a TAMPERED transcript (${trust.reason}) — treat restored context as untrusted.`,
            );
          }
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
    .description(
      "Export a session as Markdown (chat-DB session, or JSONL agent session fallback)",
    )
    .argument(
      "<id>",
      "Session ID (or prefix; `last` = most recent agent session)",
    )
    .option("-o, --output <file>", "Output file path")
    .option(
      "--no-redact",
      "Do NOT redact detected secrets from the exported transcript (default: redact)",
    )
    .action(async (id, options) => {
      try {
        let markdown = null;
        let bootstrapped = false;

        // Primary source: chat-DB sessions (legacy behaviour, unchanged).
        if (id !== "last") {
          try {
            const ctx = await bootstrap({ verbose: program.opts().verbose });
            bootstrapped = true;
            if (ctx.db) {
              const sess = getSession(ctx.db.getDatabase(), id);
              if (sess) markdown = exportSessionMarkdown(sess);
            }
          } catch {
            // DB unavailable — fall through to the JSONL agent store.
          }
        }

        // Fallback: JSONL agent sessions (`cc agent --resume` store) —
        // Claude-Code /export parity for agent transcripts.
        if (!markdown) {
          const store = await import("../harness/jsonl-session-store.js");
          const sid = id === "last" ? store.getLastSessionId() : id;
          if (sid && store.sessionExists(sid)) {
            const { renderAgentSessionMarkdown } =
              await import("../lib/agent-session-export.js");
            markdown = renderAgentSessionMarkdown(sid, store.readEvents(sid), {
              exportedAt: new Date().toISOString(),
            });
          }
        }

        if (!markdown) {
          logger.error(`Session not found: ${id}`);
          process.exit(1);
        }

        // §8.1 export gate: a transcript can carry provider tokens, JWTs,
        // connection strings or cookies (in tool commands / results). Redact by
        // default — an export leaves the machine and must fail toward "no leak".
        // `--no-redact` keeps raw values for the user's own trusted backup.
        if (options.redact !== false) {
          const findings = scanSecrets(markdown);
          if (findings.length > 0) {
            markdown = redactSecrets(markdown);
            logger.warn(
              `Redacted ${findings.length} secret${findings.length === 1 ? "" : "s"} from the export (use --no-redact to keep raw values).`,
            );
          }
        }

        if (options.output) {
          fs.writeFileSync(options.output, markdown, "utf8");
          logger.success(`Exported to ${chalk.cyan(options.output)}`);
        } else {
          console.log(markdown);
        }

        if (bootstrapped) await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // session search — full-text search across agent transcripts (JSONL store)
  session
    .command("search")
    .description(
      "Full-text search across agent session transcripts (JSONL --resume store)",
    )
    .argument("<query>", "Text to find (case-insensitive)")
    .option("-n, --limit <n>", "Max matches", "20")
    .option("--sessions <n>", "Max recent sessions to scan", "200")
    .option("--json", "Output as JSON")
    .action(async (query, options) => {
      try {
        const store = await import("../harness/jsonl-session-store.js");
        const q = String(query).toLowerCase();
        const limit = Number(options.limit) || 20;
        const sessions = store.listJsonlSessions({
          limit: Number(options.sessions) || 200,
        });
        const matches = [];
        for (const s of sessions) {
          if (matches.length >= limit) break;
          for (const ev of store.readEvents(s.id)) {
            if (matches.length >= limit) break;
            if (ev.type !== "user_message" && ev.type !== "assistant_message")
              continue;
            const text =
              typeof ev.data?.content === "string"
                ? ev.data.content
                : JSON.stringify(ev.data?.content || "");
            const idx = text.toLowerCase().indexOf(q);
            if (idx === -1) continue;
            const from = Math.max(0, idx - 30);
            matches.push({
              session: s.id,
              title: s.title,
              role: ev.type === "user_message" ? "user" : "assistant",
              // toIsoSafe (not a bare truthy guard): an invalid-but-truthy
              // timestamp on a corrupt event would otherwise throw RangeError
              // and crash the whole search.
              when: store.toIsoSafe(ev.timestamp),
              preview: text
                .slice(from, idx + q.length + 50)
                .replace(/\s+/g, " ")
                .trim(),
            });
          }
        }
        if (options.json) {
          console.log(JSON.stringify({ query, matches }, null, 2));
          return;
        }
        if (!matches.length) {
          logger.log(`No matches for "${query}".`);
          return;
        }
        logger.log(chalk.bold(`Matches for "${query}":`));
        for (const m of matches) {
          logger.log(
            `  ${chalk.cyan(m.session)} ${chalk.gray(`[${m.role}${m.when ? ` ${m.when.slice(0, 16)}` : ""}]`)}`,
          );
          logger.log(`    …${m.preview}…`);
        }
        logger.log(
          chalk.gray(
            `\n${matches.length} match(es) · resume one with: cc agent --resume <session>`,
          ),
        );
      } catch (err) {
        logger.error(`session search failed: ${err.message}`);
        process.exitCode = 1;
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

  // session rename — named sessions (gap-analysis 2026-07-11 快速收益 #5).
  // Appends a session_rename event (hash chain stays intact); last one wins.
  session
    .command("rename")
    .description("Rename a headless (JSONL) session — shows up in session list")
    .argument("<id>", "Session ID")
    .argument("<title...>", "New title")
    .option("--json", "Output as JSON")
    .action(async (id, title, options) => {
      try {
        const { renameSession } =
          await import("../harness/jsonl-session-store.js");
        const result = renameSession(
          id,
          Array.isArray(title) ? title.join(" ") : title,
        );
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        logger.success(`Renamed session ${result.id}`);
        logger.info(`  ${result.title}`);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exitCode = 1;
      }
    });

  // session prune — retention sweep (gap-analysis 2026-07-11 P1 "保留期限").
  session
    .command("prune")
    .description(
      "Delete JSONL sessions whose last activity is older than a cutoff (newest N always kept)",
    )
    .requiredOption(
      "--older-than <days>",
      "Delete sessions idle for more than this many days",
    )
    .option("--keep <n>", "Always keep the newest N sessions (default 10)")
    .option("--dry-run", "List what would be deleted without deleting")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const { pruneJsonlSessions } =
          await import("../harness/jsonl-session-store.js");
        const result = pruneJsonlSessions({
          olderThanDays: Number(options.olderThan),
          keep: options.keep != null ? Number(options.keep) : undefined,
          dryRun: options.dryRun === true,
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        const verb = result.dryRun ? "Would delete" : "Deleted";
        logger.info(
          `${verb} ${result.deleted.length} of ${result.scanned} session(s).`,
        );
        for (const id of result.deleted.slice(0, 50)) {
          logger.info(`  - ${id}`);
        }
        if (result.deleted.length > 50) {
          logger.info(`  … and ${result.deleted.length - 50} more`);
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exitCode = 1;
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

  // session verify — transcript hash-chain integrity (tamper-evidence).
  // Distinct from `validate` (structural: parseable lines + session_start):
  // verify recomputes the per-event hash chain and flags edits / deletions /
  // insertions / reordering of chained records.
  session
    .command("verify")
    .description(
      "Verify transcript hash-chain integrity (tamper-evidence); omit id to verify all",
    )
    .argument("[id]", "Session ID to verify (omit to verify every session)")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const store = await import("../harness/jsonl-session-store.js");
        const result = id ? store.verifySession(id) : store.verifyAllSessions();

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const results = Array.isArray(result) ? result : [result];
          if (results.length === 0) {
            logger.log("No sessions to verify.");
          }
          for (const item of results) {
            const color =
              item.status === "tampered"
                ? chalk.red
                : item.status === "verified"
                  ? chalk.green
                  : chalk.yellow;
            const counts =
              item.chainedEvents != null
                ? ` (${item.chainedEvents} chained, ${item.legacyEvents} legacy${item.truncatedTail ? ", truncated tail" : ""})`
                : "";
            logger.log(`${color(item.status)} ${item.sessionId}${counts}`);
            if (item.reason) {
              const where = item.firstInvalidLine
                ? ` at line ${item.firstInvalidLine}`
                : "";
              logger.log(`  ${chalk.gray(item.reason + where)}`);
            }
          }
        }

        const anyTampered = (Array.isArray(result) ? result : [result]).some(
          (item) => item.status === "tampered",
        );
        if (anyTampered) process.exit(1);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // session index — SQLite index over the JSONL store (gap P2#14). Gives fast
  // list/search without scanning every transcript, and can mirror sessions to a
  // configured off-box target (fs/http). The index is a derived cache: safe to
  // delete and rebuild from the JSONL at any time.
  session
    .command("index")
    .description(
      "Build/refresh the SQLite session index; search it, or mirror sessions off-box",
    )
    .argument("[query]", "Search the index for a term (omit to just sync)")
    .option("--rebuild", "Force a full re-index (ignore mtime cache)")
    .option("--stats", "Show index-wide counters")
    .option("--mirror <ids...>", "Push session id(s) to the configured mirror")
    .option(
      "--limit <n>",
      "Max rows for search/list",
      (v) => parseInt(v, 10),
      20,
    )
    .option("--json", "Output as JSON")
    .action(async (query, options) => {
      let db;
      try {
        const idx = await import("../harness/session-index.js");
        db = idx.openIndex();
        const sync = idx.syncIndex(db, { force: Boolean(options.rebuild) });

        if (options.mirror && options.mirror.length) {
          const result = await mirrorSessions(options.mirror);
          if (options.json) return console.log(JSON.stringify(result, null, 2));
          for (const r of result.pushed)
            logger.log(chalk.green(`  mirrored ${r.id} (${r.bytes} bytes)`));
          for (const r of result.errors) logger.error(`  ${r.id}: ${r.error}`);
          if (!result.target)
            logger.log(
              chalk.yellow(
                "No mirror configured — set session.mirror.kind (fs|http) + target in config.",
              ),
            );
          return;
        }

        if (options.stats) {
          const st = idx.indexStats(db);
          if (options.json) return console.log(JSON.stringify(st, null, 2));
          logger.log(
            `${st.sessions} sessions, ${st.messages} messages, ${st.events} events indexed`,
          );
          return;
        }

        if (query) {
          const hits = idx.searchSessions(db, query, { limit: options.limit });
          if (options.json) return console.log(JSON.stringify(hits, null, 2));
          if (hits.length === 0) {
            logger.log(chalk.gray(`No sessions match "${query}".`));
            return;
          }
          for (const h of hits) {
            logger.log(
              `${chalk.cyan(h.id)}  ${chalk.gray(h.title)}  ${chalk.gray(h.updated_at)}`,
            );
            if (h.snippet) logger.log(`  …${h.snippet}…`);
          }
          return;
        }

        if (options.json) return console.log(JSON.stringify(sync, null, 2));
        logger.success(
          `Index synced: ${sync.updated} updated, ${sync.removed} removed, ${sync.total} total.`,
        );
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      } finally {
        try {
          db?.close();
        } catch {
          /* best-effort */
        }
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
  const USAGE_BY_DIMENSIONS = [
    "origin",
    "skill",
    "subagent",
    "tool",
    "mcp",
    "model",
  ];

  // Shared `--by` renderer for the per-session and global modes (both result
  // shapes carry the same `attribution` section). turnTokens is a turn-level
  // approximation — a turn's tokens count once per distinct tool, so the
  // column must not be summed across rows.
  const printUsageBy = (result, by) => {
    const a = result.attribution || {};
    const tokRow = (label, r) =>
      logger.log(
        `  ${chalk.gray(String(label).padEnd(28))} in=${r.inputTokens}  out=${r.outputTokens}  total=${chalk.cyan(r.totalTokens.toLocaleString())}  calls=${r.calls}`,
      );
    const toolRow = (label, r) =>
      logger.log(
        `  ${chalk.gray(String(label).padEnd(28))} calls=${r.calls}  errors=${r.errors}  turnTokens≈${chalk.cyan((r.turnTokens || 0).toLocaleString())}`,
      );
    const empty = (what) => logger.log(chalk.gray(`  (no ${what} recorded)`));

    switch (by) {
      case "model": {
        const rows = result.byModel || [];
        if (rows.length === 0) return empty("token_usage events");
        for (const r of rows)
          tokRow(`${r.provider || "?"}/${r.model || "?"}`, r);
        return;
      }
      case "origin": {
        const rows = a.byOrigin || [];
        if (rows.length === 0) return empty("token_usage events");
        for (const r of rows) tokRow(r.origin, r);
        return;
      }
      case "skill": {
        const rows = a.bySkill || [];
        if (rows.length === 0)
          return empty("skill-attributed usage (isolated skill runs)");
        for (const r of rows) tokRow(r.skill, r);
        return;
      }
      case "subagent": {
        const rows = a.bySubagent || [];
        if (rows.length === 0) return empty("sub-agent-attributed usage");
        for (const r of rows)
          tokRow(`${r.subagentId}${r.role ? ` [${r.role}]` : ""}`, r);
        return;
      }
      case "tool": {
        const rows = a.tools?.byTool || [];
        if (rows.length === 0) return empty("tool_call events");
        for (const r of rows) toolRow(r.tool, r);
        logger.log(
          chalk.gray(
            "  turnTokens = tokens of turns that used the tool (approximation; do not sum across rows)",
          ),
        );
        return;
      }
      case "mcp": {
        const rows = a.tools?.byMcpServer || [];
        if (rows.length === 0)
          return empty("MCP tool calls (mcp__<server>__*)");
        for (const r of rows) toolRow(r.server, r);
        logger.log(
          chalk.gray(
            "  turnTokens = tokens of turns that used the server (approximation; do not sum across rows)",
          ),
        );
        return;
      }
      default:
        break;
    }
  };

  session
    .command("usage")
    .description("Aggregate token usage (per-session or global)")
    .argument("[id]", "Session ID (omit for global rollup)")
    .option("--json", "Output as JSON")
    .option(
      "--by <dimension>",
      `Breakdown dimension: ${USAGE_BY_DIMENSIONS.join("|")}`,
    )
    .option("--limit <n>", "Max sessions for global rollup", "1000")
    .action(async (id, options) => {
      try {
        const by = options.by ? String(options.by).toLowerCase() : null;
        if (by && !USAGE_BY_DIMENSIONS.includes(by)) {
          logger.error(
            `Invalid --by "${options.by}" — expected one of: ${USAGE_BY_DIMENSIONS.join(", ")}`,
          );
          process.exit(1);
        }
        const { sessionUsage, allSessionsUsage } =
          await import("../lib/session-usage.js");
        const result = id
          ? sessionUsage(id)
          : allSessionsUsage({ limit: parseInt(options.limit, 10) || 1000 });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (by) {
          const t = result.total;
          logger.log(
            chalk.bold(
              id
                ? `Session ${chalk.gray(id.slice(0, 16))} — by ${by}`
                : `Global usage — by ${by}`,
            ),
          );
          logger.log(
            `  total: ${chalk.cyan(t.totalTokens.toLocaleString())} tokens  in=${t.inputTokens}  out=${t.outputTokens}  calls=${t.calls}`,
          );
          printUsageBy(result, by);
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
      const meta = parseJsonOption(opts.metadata, "--metadata", {});
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
      const meta = parseJsonOption(opts.metadata, "--metadata", {});
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

/**
 * Push the given session ids to the configured off-box mirror (gap P2#14).
 * Mirror config: session.mirror = { kind: "fs"|"http", dir|baseUrl, token? }.
 * Returns { target, pushed, errors }; target null when no mirror is configured.
 */
async function mirrorSessions(ids) {
  const { createMirror } = await import("../harness/session-mirror.js");
  const store = await import("../harness/jsonl-session-store.js");
  let cfg = {};
  try {
    cfg =
      (await import("../lib/config-manager.js")).loadConfig()?.session
        ?.mirror || {};
  } catch {
    cfg = {};
  }
  const mirror = createMirror(cfg);
  if (!mirror) return { target: null, pushed: [], errors: [] };

  const pushed = [];
  const errors = [];
  const { readFileSync, existsSync } = await import("node:fs");
  for (const id of ids) {
    try {
      if (store.isUnsafeSessionId(id)) throw new Error("unsafe session id");
      const file = store.sessionPath(id);
      if (!existsSync(file)) throw new Error("session not found");
      const bytes = readFileSync(file, "utf-8");
      pushed.push(await mirror.push(id, bytes));
    } catch (err) {
      errors.push({ id, error: err.message });
    }
  }
  return { target: mirror.target, pushed, errors };
}

// === Iter21 V2 governance overlay ===
export function registerSesgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "session");
  if (!parent) return;
  const L = async () => await import("../lib/session-manager.js");
  parent
    .command("sesgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.SESGOV_PROFILE_MATURITY_V2,
            turnLifecycle: m.SESGOV_TURN_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("sesgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveSesgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingSesgovTurnsPerProfileV2(),
            idleMs: m.getSesgovProfileIdleMsV2(),
            stuckMs: m.getSesgovTurnStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("sesgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveSesgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("sesgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingSesgovTurnsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("sesgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setSesgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("sesgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setSesgovTurnStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("sesgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--channel <v>", "channel")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerSesgovProfileV2({ id, owner, channel: o.channel }),
          null,
          2,
        ),
      );
    });
  parent
    .command("sesgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateSesgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("sesgov-pause-v2 <id>")
    .description("Pause profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).pauseSesgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("sesgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveSesgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("sesgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchSesgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("sesgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getSesgovProfileV2(id), null, 2));
    });
  parent
    .command("sesgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listSesgovProfilesV2(), null, 2));
    });
  parent
    .command("sesgov-create-turn-v2 <id> <profileId>")
    .description("Create turn")
    .option("--topic <v>", "topic")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createSesgovTurnV2({ id, profileId, topic: o.topic }),
          null,
          2,
        ),
      );
    });
  parent
    .command("sesgov-advancing-turn-v2 <id>")
    .description("Mark turn as advancing")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).advancingSesgovTurnV2(id), null, 2),
      );
    });
  parent
    .command("sesgov-complete-turn-v2 <id>")
    .description("Complete turn")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeTurnSesgovV2(id), null, 2),
      );
    });
  parent
    .command("sesgov-fail-turn-v2 <id> [reason]")
    .description("Fail turn")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failSesgovTurnV2(id, reason), null, 2),
      );
    });
  parent
    .command("sesgov-cancel-turn-v2 <id> [reason]")
    .description("Cancel turn")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelSesgovTurnV2(id, reason), null, 2),
      );
    });
  parent
    .command("sesgov-get-turn-v2 <id>")
    .description("Get turn")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getSesgovTurnV2(id), null, 2));
    });
  parent
    .command("sesgov-list-turns-v2")
    .description("List turns")
    .action(async () => {
      console.log(JSON.stringify((await L()).listSesgovTurnsV2(), null, 2));
    });
  parent
    .command("sesgov-auto-pause-idle-v2")
    .description("Auto-pause idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoPauseIdleSesgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("sesgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck turns")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckSesgovTurnsV2(), null, 2),
      );
    });
  parent
    .command("sesgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getSessionManagerGovStatsV2(), null, 2),
      );
    });
}
