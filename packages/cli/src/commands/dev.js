/**
 * Autonomous Developer commands (Phase 63)
 * chainlesschain dev levels|phases|refactor-types|start|list|show|phase|
 *                    pause|resume|complete|fail|review|adr|adrs
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureAutonomousDevTables,
  listAutonomyLevels,
  listPhases,
  listRefactoringTypes,
  startDevSession,
  getSession,
  listSessions,
  advancePhase,
  pauseSession,
  resumeSession,
  completeSession,
  failSession,
  reviewCode,
  recordADR,
  listADRs,
  renderADR,
  AUTONOMY_LEVELS,
  ADR_MATURITY_V2,
  DEV_SESSION_V2,
  getMaxActiveAdrsPerAuthor,
  setMaxActiveAdrsPerAuthor,
  getMaxRunningSessionsPerDeveloper,
  setMaxRunningSessionsPerDeveloper,
  getAdrStaleMs,
  setAdrStaleMs,
  getSessionStuckMs,
  setSessionStuckMs,
  getActiveAdrCount,
  getRunningSessionCount,
  createAdrV2,
  getAdrV2,
  listAdrsV2,
  setAdrMaturityV2,
  acceptAdr,
  deprecateAdr,
  supersedeAdr,
  enqueueSessionV2,
  getSessionV2,
  listSessionsV2,
  setSessionStatusV2,
  startSessionV2,
  completeSessionV2,
  failSessionV2,
  cancelSessionV2,
  autoSupersedeStaleDrafts,
  autoFailStuckSessions,
  getAutonomousDeveloperStatsV2,
} from "../lib/autonomous-developer.js";

function _parseJsonV2(s) {
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    throw new Error(`invalid JSON: ${s}`);
  }
}

function _dbFromCtx(ctx) {
  if (!ctx.db) {
    logger.error("Database not available");
    process.exit(1);
  }
  const db = ctx.db.getDatabase();
  ensureAutonomousDevTables(db);
  return db;
}

function _printSession(s) {
  logger.log(
    `  ${chalk.bold("ID:")}        ${chalk.cyan(s.sessionId.slice(0, 8))}`,
  );
  logger.log(`  ${chalk.bold("Req:")}       ${s.requirement}`);
  logger.log(`  ${chalk.bold("Phase:")}     ${s.currentPhase}`);
  logger.log(`  ${chalk.bold("Status:")}    ${s.status}`);
  logger.log(`  ${chalk.bold("Autonomy:")}  L${s.autonomyLevel}`);
}

export function registerDevCommand(program) {
  const dev = program
    .command("dev")
    .description(
      "Autonomous developer — dev sessions, ADRs, code review, refactor catalog",
    );

  dev
    .command("levels")
    .description("List autonomy levels (L0-L4)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const levels = listAutonomyLevels();
      if (options.json) {
        console.log(JSON.stringify(levels, null, 2));
      } else {
        for (const l of levels) {
          logger.log(
            `  ${chalk.cyan(`L${l.level}`)} ${chalk.bold(l.name.padEnd(18))} ${l.description}`,
          );
        }
      }
    });

  dev
    .command("phases")
    .description("List development phases in order")
    .option("--json", "Output as JSON")
    .action((options) => {
      const phases = listPhases();
      if (options.json) {
        console.log(JSON.stringify(phases, null, 2));
      } else {
        for (let i = 0; i < phases.length; i++) {
          logger.log(`  ${chalk.cyan(`${i + 1}.`)} ${phases[i]}`);
        }
      }
    });

  dev
    .command("refactor-types")
    .description("List known refactoring types")
    .option("--json", "Output as JSON")
    .action((options) => {
      const types = listRefactoringTypes();
      if (options.json) {
        console.log(JSON.stringify(types, null, 2));
      } else {
        for (const t of types) logger.log(`  ${chalk.cyan(t)}`);
      }
    });

  dev
    .command("start <requirement>")
    .description("Start a new dev session")
    .option("-l, --level <n>", "Autonomy level 0..4", parseInt, 2)
    .option("-b, --by <author>", "createdBy tag")
    .option("--json", "Output as JSON")
    .action(async (requirement, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const session = startDevSession(db, {
          requirement,
          autonomyLevel: options.level,
          createdBy: options.by,
        });
        if (options.json) {
          console.log(JSON.stringify(session, null, 2));
        } else {
          logger.success("Dev session started");
          _printSession(session);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  dev
    .command("list")
    .description("List dev sessions")
    .option(
      "-s, --status <s>",
      "Filter by status (active|paused|completed|failed)",
    )
    .option("-p, --phase <p>", "Filter by phase")
    .option("--limit <n>", "Maximum entries", parseInt, 50)
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const rows = listSessions({
          status: options.status,
          phase: options.phase,
          limit: options.limit,
        });
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
        } else if (rows.length === 0) {
          logger.info("No dev sessions.");
        } else {
          for (const s of rows) {
            logger.log(
              `  ${chalk.cyan(s.sessionId.slice(0, 8))} L${s.autonomyLevel} [${s.status.padEnd(9)}] ${s.currentPhase.padEnd(22)} ${s.requirement}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  dev
    .command("show <session-id>")
    .description("Show full details of a dev session")
    .option("--json", "Output as JSON")
    .action(async (sessionId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const session = getSession(sessionId);
        if (!session) {
          logger.error(`Session not found: ${sessionId}`);
          process.exit(1);
        }
        if (options.json) {
          console.log(JSON.stringify(session, null, 2));
        } else {
          _printSession(session);
          if (session.reviewFeedback) {
            logger.log(
              `  ${chalk.bold("Feedback:")}  ${JSON.stringify(session.reviewFeedback).slice(0, 120)}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  dev
    .command("phase <session-id> <phase>")
    .description("Advance a session to a new phase")
    .option("--json", "Output as JSON")
    .action(async (sessionId, phase, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const session = advancePhase(db, sessionId, phase);
        if (options.json) {
          console.log(JSON.stringify(session, null, 2));
        } else {
          logger.success(`Phase advanced → ${session.currentPhase}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  dev
    .command("pause <session-id>")
    .description("Pause an active session")
    .action(async (sessionId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        pauseSession(db, sessionId);
        logger.success(`Paused ${sessionId.slice(0, 8)}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  dev
    .command("resume <session-id>")
    .description("Resume a paused session")
    .action(async (sessionId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        resumeSession(db, sessionId);
        logger.success(`Resumed ${sessionId.slice(0, 8)}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  dev
    .command("complete <session-id>")
    .description("Mark a session completed")
    .action(async (sessionId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        completeSession(db, sessionId);
        logger.success(`Completed ${sessionId.slice(0, 8)}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  dev
    .command("fail <session-id>")
    .description("Mark a session failed")
    .option("-r, --reason <text>", "Failure reason")
    .action(async (sessionId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        failSession(db, sessionId, options.reason);
        logger.success(`Failed ${sessionId.slice(0, 8)}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  dev
    .command("review <file>")
    .description(
      "Review a file using heuristics (delegates to detectAntiPatterns)",
    )
    .option("-s, --session <id>", "Attach review to a session")
    .option("--min-score <n>", "Minimum passing score 0..1", parseFloat, 0.7)
    .option("--json", "Output as JSON")
    .action(async (file, options) => {
      try {
        let db = null;
        if (options.session) {
          const ctx = await bootstrap({ verbose: program.opts().verbose });
          db = _dbFromCtx(ctx);
        }
        const result = reviewCode(file, {
          sessionId: options.session,
          db,
          minScore: options.minScore,
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const color = result.passed ? chalk.green : chalk.yellow;
          logger.log(
            `  ${color(`Grade ${result.grade}`)} score=${result.score} findings=${result.totalFindings}`,
          );
          for (const f of result.findings) {
            logger.log(
              `    ${chalk.yellow(f.type.padEnd(22))} [${f.severity}] ${f.detail}`,
            );
          }
        }
        if (options.session) await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  dev
    .command("adr <session-id> <title> <decision>")
    .description("Record an Architecture Decision Record for a session")
    .option("-c, --context <text>", "Decision context", "")
    .option("-q, --consequences <text>", "Consequences", "")
    .option("-a, --alternatives <csv>", "Comma-separated alternatives", "")
    .option(
      "-s, --status <s>",
      "proposed|accepted|deprecated|superseded",
      "accepted",
    )
    .option("--render", "Render ADR markdown")
    .option("--json", "Output as JSON")
    .action(async (sessionId, title, decision, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const alternatives = options.alternatives
          ? options.alternatives
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
        const context = options.context || `Session ${sessionId.slice(0, 8)}`;
        const adr = recordADR(db, {
          sessionId,
          title,
          decision,
          context,
          consequences: options.consequences,
          alternatives,
          status: options.status,
        });
        if (options.json) {
          console.log(JSON.stringify(adr, null, 2));
        } else if (options.render) {
          console.log(renderADR(adr));
        } else {
          logger.success("ADR recorded");
          logger.log(
            `  ${chalk.bold("ID:")}     ${chalk.cyan(adr.adrId.slice(0, 8))}`,
          );
          logger.log(`  ${chalk.bold("Title:")}  ${adr.title}`);
          logger.log(`  ${chalk.bold("Status:")} ${adr.status}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  dev
    .command("adrs")
    .description("List ADRs (optionally filter by session or status)")
    .option("-s, --session <id>", "Filter by session")
    .option("-S, --status <s>", "Filter by status")
    .option("--limit <n>", "Maximum entries", parseInt, 50)
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const rows = listADRs({
          sessionId: options.session,
          status: options.status,
          limit: options.limit,
        });
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
        } else if (rows.length === 0) {
          logger.info("No ADRs.");
        } else {
          for (const a of rows) {
            logger.log(
              `  ${chalk.cyan(a.adrId.slice(0, 8))} [${a.status.padEnd(11)}] ${chalk.bold(a.title)}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // silence unused import lints (AUTONOMY_LEVELS re-exported for consumers)
  void AUTONOMY_LEVELS;

  /* ── V2 Surface (Autonomous Developer) ─────────────────── */

  dev
    .command("adr-maturities-v2")
    .description("List ADR_MATURITY_V2 enum")
    .action(() => {
      for (const v of Object.values(ADR_MATURITY_V2)) console.log(`  ${v}`);
    });

  dev
    .command("dev-sessions-v2")
    .description("List DEV_SESSION_V2 enum")
    .action(() => {
      for (const v of Object.values(DEV_SESSION_V2)) console.log(`  ${v}`);
    });

  dev
    .command("max-active-adrs-per-author")
    .description("Get max-active-adrs-per-author cap")
    .action(() => console.log(getMaxActiveAdrsPerAuthor()));
  dev
    .command("set-max-active-adrs-per-author <n>")
    .action((n) => console.log(setMaxActiveAdrsPerAuthor(Number(n))));

  dev
    .command("max-running-sessions-per-developer")
    .description("Get max-running-sessions-per-developer cap")
    .action(() => console.log(getMaxRunningSessionsPerDeveloper()));
  dev
    .command("set-max-running-sessions-per-developer <n>")
    .action((n) => console.log(setMaxRunningSessionsPerDeveloper(Number(n))));

  dev
    .command("adr-stale-ms")
    .description("Get adr-stale-ms threshold")
    .action(() => console.log(getAdrStaleMs()));
  dev
    .command("set-adr-stale-ms <n>")
    .action((n) => console.log(setAdrStaleMs(Number(n))));

  dev
    .command("session-stuck-ms")
    .description("Get session-stuck-ms threshold")
    .action(() => console.log(getSessionStuckMs()));
  dev
    .command("set-session-stuck-ms <n>")
    .action((n) => console.log(setSessionStuckMs(Number(n))));

  dev
    .command("active-adr-count")
    .description("Count non-superseded ADRs (optionally by author)")
    .option("-a, --author <author>")
    .action((opts) => console.log(getActiveAdrCount(opts.author)));

  dev
    .command("running-session-count")
    .description("Count RUNNING sessions (optionally by developer)")
    .option("-d, --developer <developer>")
    .action((opts) => console.log(getRunningSessionCount(opts.developer)));

  dev
    .command("create-adr-v2 <adr-id>")
    .description("Create V2 ADR")
    .requiredOption("-a, --author <author>", "author")
    .requiredOption("-t, --title <title>", "title")
    .option("-i, --initial <status>", "initial status", ADR_MATURITY_V2.DRAFT)
    .option("--metadata <json>", "metadata JSON")
    .action((id, opts) => {
      const a = createAdrV2({
        id,
        author: opts.author,
        title: opts.title,
        initialStatus: opts.initial,
        metadata: _parseJsonV2(opts.metadata),
      });
      console.log(JSON.stringify(a, null, 2));
    });

  dev
    .command("adr-v2 <adr-id>")
    .description("Show V2 ADR")
    .action((id) => {
      const a = getAdrV2(id);
      if (!a) return console.error(`ADR ${id} not found`);
      console.log(JSON.stringify(a, null, 2));
    });

  dev
    .command("list-adrs-v2")
    .description("List V2 ADRs")
    .option("-a, --author <author>")
    .option("-s, --status <status>")
    .action((opts) => console.log(JSON.stringify(listAdrsV2(opts), null, 2)));

  dev
    .command("set-adr-maturity-v2 <adr-id> <status>")
    .description("Transition V2 ADR maturity")
    .option("-r, --reason <reason>")
    .option("--metadata <json>")
    .action((id, status, opts) => {
      const a = setAdrMaturityV2(id, status, {
        reason: opts.reason,
        metadata: _parseJsonV2(opts.metadata),
      });
      console.log(JSON.stringify(a, null, 2));
    });

  for (const [name, fn] of [
    ["accept-adr", acceptAdr],
    ["deprecate-adr", deprecateAdr],
    ["supersede-adr", supersedeAdr],
  ]) {
    dev
      .command(`${name} <adr-id>`)
      .description(`Shortcut for ${name.replace("-adr", "")} transition`)
      .option("-r, --reason <reason>")
      .action((id, opts) => {
        const a = fn(id, { reason: opts.reason });
        console.log(JSON.stringify(a, null, 2));
      });
  }

  dev
    .command("enqueue-session-v2 <session-id>")
    .description("Enqueue V2 dev session")
    .requiredOption("-d, --developer <developer>")
    .requiredOption("-g, --goal <goal>")
    .option("--metadata <json>")
    .action((id, opts) => {
      const s = enqueueSessionV2({
        id,
        developer: opts.developer,
        goal: opts.goal,
        metadata: _parseJsonV2(opts.metadata),
      });
      console.log(JSON.stringify(s, null, 2));
    });

  dev
    .command("session-v2 <session-id>")
    .description("Show V2 session")
    .action((id) => {
      const s = getSessionV2(id);
      if (!s) return console.error(`session ${id} not found`);
      console.log(JSON.stringify(s, null, 2));
    });

  dev
    .command("list-sessions-v2")
    .description("List V2 sessions")
    .option("-d, --developer <developer>")
    .option("-s, --status <status>")
    .action((opts) =>
      console.log(JSON.stringify(listSessionsV2(opts), null, 2)),
    );

  dev
    .command("set-session-status-v2 <session-id> <status>")
    .option("-r, --reason <reason>")
    .option("--metadata <json>")
    .action((id, status, opts) => {
      const s = setSessionStatusV2(id, status, {
        reason: opts.reason,
        metadata: _parseJsonV2(opts.metadata),
      });
      console.log(JSON.stringify(s, null, 2));
    });

  for (const [name, fn] of [
    ["start-session-v2", startSessionV2],
    ["complete-session-v2", completeSessionV2],
    ["fail-session-v2", failSessionV2],
    ["cancel-session-v2", cancelSessionV2],
  ]) {
    dev
      .command(`${name} <session-id>`)
      .description(`Shortcut for ${name.replace("-session-v2", "")} transition`)
      .option("-r, --reason <reason>")
      .action((id, opts) => {
        const s = fn(id, { reason: opts.reason });
        console.log(JSON.stringify(s, null, 2));
      });
  }

  dev
    .command("auto-supersede-stale-drafts")
    .description(
      "Bulk-supersede DRAFT ADRs whose updatedAt is older than adrStaleMs",
    )
    .action(() =>
      console.log(
        JSON.stringify({ flipped: autoSupersedeStaleDrafts() }, null, 2),
      ),
    );

  dev
    .command("auto-fail-stuck-sessions")
    .description(
      "Bulk-fail RUNNING sessions whose startedAt is older than sessionStuckMs",
    )
    .action(() =>
      console.log(
        JSON.stringify({ flipped: autoFailStuckSessions() }, null, 2),
      ),
    );

  dev
    .command("stats-v2")
    .description("Show V2 autonomous-developer stats")
    .action(() =>
      console.log(JSON.stringify(getAutonomousDeveloperStatsV2(), null, 2)),
    );
}

// === Iter24 V2 governance overlay ===
export function registerDevgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "dev");
  if (!parent) return;
  const L = async () => await import("../lib/autonomous-developer.js");
  parent
    .command("devgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.DEVGOV_PROFILE_MATURITY_V2,
            runLifecycle: m.DEVGOV_RUN_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("devgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveDevgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingDevgovRunsPerProfileV2(),
            idleMs: m.getDevgovProfileIdleMsV2(),
            stuckMs: m.getDevgovRunStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("devgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveDevgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("devgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingDevgovRunsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("devgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setDevgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("devgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setDevgovRunStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("devgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--level <v>", "level")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerDevgovProfileV2({ id, owner, level: o.level }),
          null,
          2,
        ),
      );
    });
  parent
    .command("devgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateDevgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("devgov-pause-v2 <id>")
    .description("Pause profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).pauseDevgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("devgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveDevgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("devgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchDevgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("devgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getDevgovProfileV2(id), null, 2));
    });
  parent
    .command("devgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listDevgovProfilesV2(), null, 2));
    });
  parent
    .command("devgov-create-run-v2 <id> <profileId>")
    .description("Create run")
    .option("--goal <v>", "goal")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createDevgovRunV2({ id, profileId, goal: o.goal }),
          null,
          2,
        ),
      );
    });
  parent
    .command("devgov-developing-run-v2 <id>")
    .description("Mark run as developing")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).developingDevgovRunV2(id), null, 2),
      );
    });
  parent
    .command("devgov-complete-run-v2 <id>")
    .description("Complete run")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).completeRunDevgovV2(id), null, 2));
    });
  parent
    .command("devgov-fail-run-v2 <id> [reason]")
    .description("Fail run")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failDevgovRunV2(id, reason), null, 2),
      );
    });
  parent
    .command("devgov-cancel-run-v2 <id> [reason]")
    .description("Cancel run")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelDevgovRunV2(id, reason), null, 2),
      );
    });
  parent
    .command("devgov-get-run-v2 <id>")
    .description("Get run")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getDevgovRunV2(id), null, 2));
    });
  parent
    .command("devgov-list-runs-v2")
    .description("List runs")
    .action(async () => {
      console.log(JSON.stringify((await L()).listDevgovRunsV2(), null, 2));
    });
  parent
    .command("devgov-auto-pause-idle-v2")
    .description("Auto-pause idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoPauseIdleDevgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("devgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck runs")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckDevgovRunsV2(), null, 2),
      );
    });
  parent
    .command("devgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getAutonomousDeveloperGovStatsV2(), null, 2),
      );
    });
}
