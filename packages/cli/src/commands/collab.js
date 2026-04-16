/**
 * Collaboration Governance commands (Phase 64)
 * chainlesschain collab decision-types|strategies|metrics|priorities|permissions|
 *                       propose|decisions|show|vote|tally|execute|
 *                       set-level|agent|agents|match|optimize
 */

import fs from "fs";
import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureGovernanceTables,
  listDecisionTypes,
  listConflictStrategies,
  listQualityMetrics,
  listPriorityLevels,
  listPermissionTiers,
  createDecision,
  getDecision,
  listDecisions,
  vote,
  tallyDecision,
  markExecuted,
  setAutonomyLevel,
  getAutonomyLevel,
  listAutonomyAgents,
  calculateSkillMatch,
  optimizeTaskAssignment,
  calculatePriority,
} from "../lib/collaboration-governance.js";

function _dbFromCtx(ctx) {
  if (!ctx.db) {
    logger.error("Database not available");
    process.exit(1);
  }
  const db = ctx.db.getDatabase();
  ensureGovernanceTables(db);
  return db;
}

function _readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

function _printDecision(d) {
  logger.log(
    `  ${chalk.bold("ID:")}        ${chalk.cyan(d.decisionId.slice(0, 8))}`,
  );
  logger.log(`  ${chalk.bold("Type:")}      ${d.type}`);
  logger.log(`  ${chalk.bold("Status:")}    ${d.status}`);
  logger.log(`  ${chalk.bold("Proposal:")}  ${d.proposal}`);
  const voteCount = Object.keys(d.votes || {}).length;
  logger.log(`  ${chalk.bold("Votes:")}     ${voteCount}`);
}

export function registerCollabCommand(program) {
  const collab = program
    .command("collab")
    .description(
      "Collaboration governance — decisions, voting, autonomy levels, task assignment",
    );

  collab
    .command("decision-types")
    .description("List known decision types")
    .option("--json", "Output as JSON")
    .action((options) => {
      const types = listDecisionTypes();
      if (options.json) {
        console.log(JSON.stringify(types, null, 2));
      } else {
        for (const t of types) logger.log(`  ${chalk.cyan(t)}`);
      }
    });

  collab
    .command("strategies")
    .description("List conflict resolution strategies")
    .option("--json", "Output as JSON")
    .action((options) => {
      const strategies = listConflictStrategies();
      if (options.json) {
        console.log(JSON.stringify(strategies, null, 2));
      } else {
        for (const s of strategies) {
          const extra = s.types || s.algorithms || s.rules || [];
          logger.log(`  ${chalk.cyan(s.name.padEnd(14))} ${extra.join(", ")}`);
        }
      }
    });

  collab
    .command("metrics")
    .description("List quality metrics")
    .option("--json", "Output as JSON")
    .action((options) => {
      const metrics = listQualityMetrics();
      if (options.json) {
        console.log(JSON.stringify(metrics, null, 2));
      } else {
        for (const m of metrics) logger.log(`  ${chalk.cyan(m)}`);
      }
    });

  collab
    .command("priorities")
    .description("List priority levels")
    .option("--json", "Output as JSON")
    .action((options) => {
      const levels = listPriorityLevels();
      if (options.json) {
        console.log(JSON.stringify(levels, null, 2));
      } else {
        for (const l of levels) {
          logger.log(`  ${chalk.cyan(`P${l.value}`)} ${chalk.bold(l.name)}`);
        }
      }
    });

  collab
    .command("permissions")
    .description("List permission tiers (L0..L4)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const tiers = listPermissionTiers();
      if (options.json) {
        console.log(JSON.stringify(tiers, null, 2));
      } else {
        for (const t of tiers) {
          logger.log(
            `  ${chalk.cyan(t.tier)} ${chalk.bold(`L${t.level}`)} ${t.permissions.join(", ")}`,
          );
        }
      }
    });

  collab
    .command("propose <type> <proposal>")
    .description(
      "Propose a governance decision (type: task_assignment|resource_allocation|conflict_resolution|policy_update|autonomy_level)",
    )
    .option("--json", "Output as JSON")
    .action(async (type, proposal, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const decision = createDecision(db, { type, proposal });
        if (options.json) {
          console.log(JSON.stringify(decision, null, 2));
        } else {
          logger.success("Decision proposed");
          _printDecision(decision);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  collab
    .command("decisions")
    .description("List governance decisions")
    .option("-t, --type <type>", "Filter by type")
    .option(
      "-s, --status <status>",
      "Filter by status (pending|voting|approved|rejected|executed)",
    )
    .option("--limit <n>", "Maximum entries", parseInt, 50)
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const rows = listDecisions({
          type: options.type,
          status: options.status,
          limit: options.limit,
        });
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
        } else if (rows.length === 0) {
          logger.info("No decisions.");
        } else {
          for (const d of rows) {
            const voteCount = Object.keys(d.votes || {}).length;
            logger.log(
              `  ${chalk.cyan(d.decisionId.slice(0, 8))} [${d.status.padEnd(8)}] ${d.type.padEnd(20)} votes=${voteCount} ${d.proposal}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  collab
    .command("show <decision-id>")
    .description("Show full details of a decision")
    .option("--json", "Output as JSON")
    .action(async (decisionId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const decision = getDecision(decisionId);
        if (!decision) {
          logger.error(`Decision not found: ${decisionId}`);
          process.exit(1);
        }
        if (options.json) {
          console.log(JSON.stringify(decision, null, 2));
        } else {
          _printDecision(decision);
          if (decision.resolution) {
            logger.log(
              `  ${chalk.bold("Outcome:")}   ${decision.resolution.outcome}`,
            );
            logger.log(
              `  ${chalk.bold("Tally:")}     approve=${decision.resolution.tally.approve} reject=${decision.resolution.tally.reject} abstain=${decision.resolution.tally.abstain}`,
            );
          }
          for (const [agent, v] of Object.entries(decision.votes || {})) {
            logger.log(
              `    ${chalk.cyan(agent)} → ${v.vote}${v.reason ? ` (${v.reason})` : ""}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  collab
    .command("vote <decision-id> <agent-id> <vote>")
    .description("Cast a vote (vote: approve|reject|abstain)")
    .option("-r, --reason <text>", "Reason for vote")
    .option("--json", "Output as JSON")
    .action(async (decisionId, agentId, voteValue, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const decision = vote(
          db,
          decisionId,
          agentId,
          voteValue,
          options.reason || "",
        );
        if (options.json) {
          console.log(JSON.stringify(decision, null, 2));
        } else {
          logger.success(
            `Vote recorded: ${agentId} → ${voteValue} on ${decisionId.slice(0, 8)}`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  collab
    .command("tally <decision-id>")
    .description("Tally votes and transition decision status")
    .option(
      "-q, --quorum <n>",
      "Quorum ratio 0..1 (default 0.5)",
      parseFloat,
      0.5,
    )
    .option(
      "-t, --threshold <n>",
      "Approval threshold 0..1 (default 0.6)",
      parseFloat,
      0.6,
    )
    .option(
      "-n, --total-voters <n>",
      "Total eligible voters (defaults to actual voters count)",
      parseInt,
    )
    .option("--json", "Output as JSON")
    .action(async (decisionId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const decision = tallyDecision(db, decisionId, {
          quorum: options.quorum,
          threshold: options.threshold,
          totalVoters: options.totalVoters,
        });
        if (options.json) {
          console.log(JSON.stringify(decision, null, 2));
        } else {
          logger.success(`Tallied → ${decision.status}`);
          logger.log(
            `  ${chalk.bold("Outcome:")} ${decision.resolution.outcome}`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  collab
    .command("execute <decision-id>")
    .description("Mark an approved decision as executed")
    .action(async (decisionId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        markExecuted(db, decisionId);
        logger.success(`Executed ${decisionId.slice(0, 8)}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  collab
    .command("set-level <agent-id> <level>")
    .description("Set an agent's autonomy level (0..4)")
    .option("-r, --reason <text>", "Reason for adjustment")
    .option("--json", "Output as JSON")
    .action(async (agentId, level, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const record = setAutonomyLevel(db, agentId, parseInt(level, 10), {
          reason: options.reason,
        });
        if (options.json) {
          console.log(JSON.stringify(record, null, 2));
        } else {
          logger.success(`Level set: ${agentId} → L${record.currentLevel}`);
          logger.log(
            `  ${chalk.bold("Permissions:")} ${record.permissions.join(", ")}`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  collab
    .command("agent <agent-id>")
    .description("Show agent autonomy level")
    .option("--json", "Output as JSON")
    .action(async (agentId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const record = getAutonomyLevel(agentId);
        if (!record) {
          logger.error(`Agent not found: ${agentId}`);
          process.exit(1);
        }
        if (options.json) {
          console.log(JSON.stringify(record, null, 2));
        } else {
          logger.log(`  ${chalk.bold("Agent:")}       ${record.agentId}`);
          logger.log(`  ${chalk.bold("Level:")}       L${record.currentLevel}`);
          logger.log(
            `  ${chalk.bold("Permissions:")} ${record.permissions.join(", ")}`,
          );
          logger.log(
            `  ${chalk.bold("History:")}     ${record.adjustmentHistory.length} adjustment(s)`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  collab
    .command("agents")
    .description("List agents with autonomy levels")
    .option("-l, --level <n>", "Filter by level 0..4", parseInt)
    .option("--limit <n>", "Maximum entries", parseInt, 50)
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const rows = listAutonomyAgents({
          level: options.level,
          limit: options.limit,
        });
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
        } else if (rows.length === 0) {
          logger.info("No agents.");
        } else {
          for (const r of rows) {
            logger.log(
              `  ${chalk.cyan(r.agentId.padEnd(20))} L${r.currentLevel}  ${r.permissions.join(", ")}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  collab
    .command("match <required-skills-json> <agent-skills-json>")
    .description(
      "Compute skill match score (inputs are JSON file paths; required: [{name,requiredLevel,weight}], agent: {skillName: level})",
    )
    .option("--json", "Output as JSON")
    .action(async (requiredPath, agentPath, options) => {
      try {
        const required = _readJsonFile(requiredPath);
        const agent = _readJsonFile(agentPath);
        const score = calculateSkillMatch(required, agent);
        if (options.json) {
          console.log(
            JSON.stringify({ score: Number(score.toFixed(3)) }, null, 2),
          );
        } else {
          logger.log(`  ${chalk.bold("Skill Match:")} ${score.toFixed(3)}`);
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  collab
    .command("optimize <tasks-json> <agents-json>")
    .description(
      "Optimize task assignment (tasks: [{id,urgency,importance,complexity,dependencies,requiredSkills}], agents: [{id,skills,currentLoad,maxCapacity}])",
    )
    .option("--json", "Output as JSON")
    .action(async (tasksPath, agentsPath, options) => {
      try {
        const tasks = _readJsonFile(tasksPath);
        const agents = _readJsonFile(agentsPath);
        const result = optimizeTaskAssignment(tasks, agents);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success(
            `Assigned ${result.assigned}/${result.totalTasks} tasks (${result.unassignedCount} unassigned)`,
          );
          for (const a of result.assignments) {
            logger.log(
              `  ${chalk.cyan(a.taskId.padEnd(16))} → ${chalk.bold(a.agentId.padEnd(16))} skill=${a.skillScore} priority=${a.priority}`,
            );
          }
          for (const u of result.unassigned) {
            logger.log(
              `  ${chalk.yellow(u.taskId.padEnd(16))} ${chalk.yellow("unassigned")} (${u.reason})`,
            );
          }
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // silence unused-import lint
  void calculatePriority;
}
