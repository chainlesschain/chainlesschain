/**
 * Community Governance commands (Phase 54)
 * chainlesschain governance types|statuses|impact-levels|create|list|show|
 *                              activate|close|expire|vote|votes|tally|
 *                              analyze|predict|stats
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureGovernanceTables,
  listProposalTypes,
  listProposalStatuses,
  listImpactLevels,
  createProposal,
  getProposal,
  listProposals,
  activateProposal,
  closeProposal,
  expireProposal,
  castVote,
  listVotes,
  tallyVotes,
  analyzeImpact,
  predictVote,
  getGovernanceStats,
} from "../lib/community-governance.js";

function _dbFromCtx(ctx) {
  if (!ctx.db) {
    logger.error("Database not available");
    process.exit(1);
  }
  const db = ctx.db.getDatabase();
  ensureGovernanceTables(db);
  return db;
}

function _printProposal(p) {
  logger.log(`  ${chalk.bold("ID:")}          ${chalk.cyan(p.id)}`);
  logger.log(`  ${chalk.bold("Title:")}       ${p.title}`);
  logger.log(`  ${chalk.bold("Type:")}        ${chalk.yellow(p.type)}`);
  logger.log(`  ${chalk.bold("Status:")}      ${_statusColor(p.status)}`);
  if (p.proposerDid) {
    logger.log(`  ${chalk.bold("Proposer:")}    ${p.proposerDid}`);
  }
  if (p.description) {
    logger.log(`  ${chalk.bold("Description:")} ${p.description}`);
  }
  if (p.impactLevel) {
    logger.log(`  ${chalk.bold("Impact:")}      ${p.impactLevel}`);
  }
  logger.log(
    `  ${chalk.bold("Votes:")}       ${chalk.green("yes:" + p.voteYes)} ${chalk.red("no:" + p.voteNo)} ${chalk.gray("abstain:" + p.voteAbstain)}`,
  );
  if (p.votingStartsAt) {
    logger.log(
      `  ${chalk.bold("Voting:")}      ${new Date(p.votingStartsAt).toISOString()} → ${new Date(p.votingEndsAt).toISOString()}`,
    );
  }
}

function _statusColor(status) {
  switch (status) {
    case "active":
      return chalk.blue(status);
    case "passed":
      return chalk.green(status);
    case "rejected":
      return chalk.red(status);
    case "expired":
      return chalk.gray(status);
    default:
      return chalk.yellow(status);
  }
}

export function registerGovernanceCommand(program) {
  const gov = program
    .command("governance")
    .description(
      "Community governance — proposals, voting, impact analysis, prediction",
    );

  gov
    .command("types")
    .description("List proposal types")
    .option("--json", "Output as JSON")
    .action((options) => {
      const types = listProposalTypes();
      if (options.json) {
        console.log(JSON.stringify(types, null, 2));
      } else {
        for (const t of types) {
          logger.log(
            `  ${chalk.cyan(t.id.padEnd(20))} ${t.name} — ${t.description}`,
          );
        }
      }
    });

  gov
    .command("statuses")
    .description("List proposal statuses")
    .option("--json", "Output as JSON")
    .action((options) => {
      const statuses = listProposalStatuses();
      if (options.json) {
        console.log(JSON.stringify(statuses, null, 2));
      } else {
        for (const s of statuses) {
          logger.log(`  ${_statusColor(s)}`);
        }
      }
    });

  gov
    .command("impact-levels")
    .description("List impact levels")
    .option("--json", "Output as JSON")
    .action((options) => {
      const levels = listImpactLevels();
      if (options.json) {
        console.log(JSON.stringify(levels, null, 2));
      } else {
        for (const l of levels) {
          logger.log(
            `  ${chalk.cyan(l.id.padEnd(10))} ${l.name} — ${l.description}`,
          );
        }
      }
    });

  gov
    .command("create <title>")
    .description("Create a governance proposal (starts as draft)")
    .option(
      "-t, --type <type>",
      "Proposal type (parameter_change|feature_request|policy_update|budget_allocation)",
      "feature_request",
    )
    .option("-d, --description <text>", "Proposal description")
    .option("-p, --proposer <did>", "Proposer DID")
    .option("--json", "Output as JSON")
    .action(async (title, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const p = createProposal(db, {
          title,
          type: options.type,
          description: options.description,
          proposerDid: options.proposer,
        });
        if (options.json) {
          console.log(JSON.stringify(p, null, 2));
        } else {
          logger.success(`Proposal created (draft)`);
          _printProposal(p);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  gov
    .command("list")
    .description("List proposals")
    .option("-s, --status <status>", "Filter by status")
    .option("-t, --type <type>", "Filter by type")
    .option("--limit <n>", "Maximum entries", parseInt, 50)
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const rows = listProposals({
          status: options.status,
          type: options.type,
          limit: options.limit,
        });
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
        } else if (rows.length === 0) {
          logger.info("No proposals.");
        } else {
          for (const p of rows) {
            logger.log(
              `  ${chalk.cyan(p.id.slice(0, 8))} ${_statusColor(p.status.padEnd(9))} ${chalk.yellow(p.type.padEnd(20))} ${p.title}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  gov
    .command("show <proposal-id>")
    .description("Show proposal details")
    .option("--json", "Output as JSON")
    .action(async (proposalId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const p = getProposal(proposalId);
        if (!p) {
          logger.error(`Proposal not found: ${proposalId}`);
          process.exit(1);
        }
        if (options.json) {
          console.log(JSON.stringify(p, null, 2));
        } else {
          _printProposal(p);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  gov
    .command("activate <proposal-id>")
    .description("Activate a draft proposal for voting")
    .option(
      "-d, --duration-ms <ms>",
      "Voting duration in ms (default 7d)",
      parseInt,
    )
    .option("--json", "Output as JSON")
    .action(async (proposalId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const p = activateProposal(db, proposalId, {
          durationMs: options.durationMs,
        });
        if (options.json) {
          console.log(JSON.stringify(p, null, 2));
        } else {
          logger.success(`Proposal activated for voting`);
          _printProposal(p);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  gov
    .command("close <proposal-id>")
    .description("Close voting — auto-resolves to passed/rejected")
    .option("-q, --quorum <n>", "Quorum threshold (0-1)", parseFloat)
    .option("-t, --threshold <n>", "Pass threshold (0-1)", parseFloat)
    .option(
      "-n, --total-voters <n>",
      "Total eligible voters (for quorum)",
      parseInt,
    )
    .option("--json", "Output as JSON")
    .action(async (proposalId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const { proposal, tally } = closeProposal(db, proposalId, {
          quorum: options.quorum,
          threshold: options.threshold,
          totalVoters: options.totalVoters,
        });
        if (options.json) {
          console.log(JSON.stringify({ proposal, tally }, null, 2));
        } else {
          const color = proposal.status === "passed" ? chalk.green : chalk.red;
          logger.log(color(`Proposal ${proposal.status.toUpperCase()}`));
          logger.log(
            `  yes: ${tally.yesWeight}  no: ${tally.noWeight}  abstain: ${tally.abstainWeight}  ratio: ${tally.yesRatio}`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  gov
    .command("expire <proposal-id>")
    .description("Mark a draft/active proposal as expired")
    .action(async (proposalId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        expireProposal(db, proposalId);
        logger.success(`Proposal expired: ${proposalId}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  gov
    .command("vote <proposal-id> <voter-did> <yes|no|abstain>")
    .description("Cast a vote (replaces any prior vote by same voter)")
    .option("-r, --reason <text>", "Reason for vote")
    .option("-w, --weight <n>", "Vote weight", parseFloat, 1.0)
    .option("--json", "Output as JSON")
    .action(async (proposalId, voterDid, voteValue, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const v = castVote(db, proposalId, voterDid, voteValue, {
          reason: options.reason,
          weight: options.weight,
        });
        if (options.json) {
          console.log(JSON.stringify(v, null, 2));
        } else {
          logger.success(`Vote cast: ${voteValue} by ${voterDid}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  gov
    .command("votes <proposal-id>")
    .description("List votes for a proposal")
    .option("--limit <n>", "Maximum entries", parseInt, 50)
    .option("--json", "Output as JSON")
    .action(async (proposalId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const rows = listVotes(proposalId, { limit: options.limit });
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
        } else if (rows.length === 0) {
          logger.info("No votes.");
        } else {
          for (const v of rows) {
            const vColor =
              v.vote === "yes"
                ? chalk.green
                : v.vote === "no"
                  ? chalk.red
                  : chalk.gray;
            logger.log(
              `  ${chalk.cyan(v.id.slice(0, 8))} ${vColor(v.vote.padEnd(8))} w=${v.weight}  ${v.voterDid}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  gov
    .command("tally <proposal-id>")
    .description("Show vote tally with quorum/threshold check")
    .option("-q, --quorum <n>", "Quorum threshold (0-1)", parseFloat)
    .option("-t, --threshold <n>", "Pass threshold (0-1)", parseFloat)
    .option("-n, --total-voters <n>", "Total eligible voters", parseInt)
    .option("--json", "Output as JSON")
    .action(async (proposalId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const tally = tallyVotes(proposalId, {
          quorum: options.quorum,
          threshold: options.threshold,
          totalVoters: options.totalVoters,
        });
        if (options.json) {
          console.log(JSON.stringify(tally, null, 2));
        } else {
          const color = tally.passed ? chalk.green : chalk.red;
          logger.log(
            `  ${chalk.bold("Result:")}    ${color(tally.passed ? "PASSED" : "NOT PASSED")}`,
          );
          logger.log(
            `  ${chalk.bold("Votes:")}     ${tally.voteCount} (yes=${tally.yesWeight}, no=${tally.noWeight}, abstain=${tally.abstainWeight})`,
          );
          logger.log(
            `  ${chalk.bold("Yes ratio:")} ${tally.yesRatio} (threshold=${tally.threshold})`,
          );
          logger.log(
            `  ${chalk.bold("Quorum:")}    ${tally.quorumMet ? "met" : "NOT met"} (${tally.quorum})`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  gov
    .command("analyze <proposal-id>")
    .description("Run heuristic impact analysis on a proposal")
    .option("--json", "Output as JSON")
    .action(async (proposalId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const analysis = analyzeImpact(proposalId);
        if (options.json) {
          console.log(JSON.stringify(analysis, null, 2));
        } else {
          logger.log(`  ${chalk.bold("Impact:")}      ${analysis.impactLevel}`);
          logger.log(
            `  ${chalk.bold("Risk:")}        ${analysis.riskScore}  ${chalk.bold("Benefit:")} ${analysis.benefitScore}`,
          );
          logger.log(
            `  ${chalk.bold("Effort:")}      ${analysis.estimatedEffort}`,
          );
          logger.log(
            `  ${chalk.bold("Sentiment:")}   ${analysis.communitySentiment}`,
          );
          logger.log(
            `  ${chalk.bold("Components:")}  ${analysis.affectedComponents.join(", ")}`,
          );
          for (const rec of analysis.recommendations) {
            logger.log(`  ${chalk.yellow("→")} ${rec}`);
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  gov
    .command("predict <proposal-id>")
    .description("Predict voting outcome (heuristic or vote-based)")
    .option("--json", "Output as JSON")
    .action(async (proposalId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const pred = predictVote(proposalId);
        if (options.json) {
          console.log(JSON.stringify(pred, null, 2));
        } else {
          const color =
            pred.predictedOutcome === "pass" ? chalk.green : chalk.red;
          logger.log(
            `  ${chalk.bold("Predicted:")}  ${color(pred.predictedOutcome.toUpperCase())}`,
          );
          logger.log(
            `  ${chalk.bold("Confidence:")} ${pred.confidence}  (${pred.basedOn}, n=${pred.sampleSize})`,
          );
          logger.log(
            `  ${chalk.bold("Probs:")}      yes=${pred.yesProb}  no=${pred.noProb}  abstain=${pred.abstainProb}`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  gov
    .command("stats")
    .description("Governance statistics")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const stats = getGovernanceStats();
        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          logger.log(`${chalk.bold("Proposals:")}    ${stats.proposalCount}`);
          logger.log(`${chalk.bold("Votes:")}        ${stats.voteCount}`);
          logger.log(chalk.bold("By status:"));
          for (const [s, n] of Object.entries(stats.byStatus)) {
            logger.log(`  ${_statusColor(s.padEnd(12))} ${n}`);
          }
          logger.log(chalk.bold("By type:"));
          for (const [t, n] of Object.entries(stats.byType)) {
            logger.log(`  ${t.padEnd(20)} ${n}`);
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
