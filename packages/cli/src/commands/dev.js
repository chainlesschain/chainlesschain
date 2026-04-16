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
} from "../lib/autonomous-developer.js";

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
}
