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
  PROPOSER_MATURITY_V2,
  DELEGATION_LIFECYCLE_V2,
  getDefaultMaxActiveProposersPerRealmV2,
  getMaxActiveProposersPerRealmV2,
  setMaxActiveProposersPerRealmV2,
  getDefaultMaxActiveDelegationsPerDelegatorV2,
  getMaxActiveDelegationsPerDelegatorV2,
  setMaxActiveDelegationsPerDelegatorV2,
  getDefaultProposerIdleMsV2,
  getProposerIdleMsV2,
  setProposerIdleMsV2,
  getDefaultPendingDelegationMsV2,
  getPendingDelegationMsV2,
  setPendingDelegationMsV2,
  registerProposerV2,
  getProposerV2,
  setProposerMaturityV2,
  activateProposer,
  suspendProposer,
  retireProposer,
  touchProposerActivity,
  createDelegationV2,
  getDelegationV2,
  setDelegationStatusV2,
  activateDelegation,
  revokeDelegation,
  expireDelegation,
  getActiveProposerCount,
  getActiveDelegationCount,
  autoRetireIdleProposers,
  autoExpireStalePendingDelegations,
  getGovernanceStatsV2,
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

  /* ═════════════════════════════════════════════════════════════
   * Phase 54 V2 — Proposer + Delegation V2 subcommands (in-memory,
   * no DB bootstrap needed)
   * ═══════════════════════════════════════════════════════════ */

  gov
    .command("proposer-maturities-v2")
    .description("List proposer V2 maturity states")
    .option("--json", "JSON output")
    .action((opts) => {
      const s = Object.values(PROPOSER_MATURITY_V2);
      if (opts.json) console.log(JSON.stringify(s));
      else s.forEach((v) => console.log(v));
    });

  gov
    .command("delegation-lifecycles-v2")
    .description("List delegation V2 lifecycle states")
    .option("--json", "JSON output")
    .action((opts) => {
      const s = Object.values(DELEGATION_LIFECYCLE_V2);
      if (opts.json) console.log(JSON.stringify(s));
      else s.forEach((v) => console.log(v));
    });

  gov
    .command("default-max-active-proposers-per-realm")
    .description("Default per-realm active proposer cap")
    .action(() => console.log(getDefaultMaxActiveProposersPerRealmV2()));

  gov
    .command("max-active-proposers-per-realm")
    .description("Current per-realm active proposer cap")
    .action(() => console.log(getMaxActiveProposersPerRealmV2()));

  gov
    .command("set-max-active-proposers-per-realm <n>")
    .description("Set per-realm active proposer cap")
    .action((n) => console.log(setMaxActiveProposersPerRealmV2(Number(n))));

  gov
    .command("default-max-active-delegations-per-delegator")
    .description("Default per-delegator active delegation cap")
    .action(() => console.log(getDefaultMaxActiveDelegationsPerDelegatorV2()));

  gov
    .command("max-active-delegations-per-delegator")
    .description("Current per-delegator active delegation cap")
    .action(() => console.log(getMaxActiveDelegationsPerDelegatorV2()));

  gov
    .command("set-max-active-delegations-per-delegator <n>")
    .description("Set per-delegator active delegation cap")
    .action((n) =>
      console.log(setMaxActiveDelegationsPerDelegatorV2(Number(n))),
    );

  gov
    .command("default-proposer-idle-ms")
    .description("Default proposer idle window (ms)")
    .action(() => console.log(getDefaultProposerIdleMsV2()));

  gov
    .command("proposer-idle-ms")
    .description("Current proposer idle window (ms)")
    .action(() => console.log(getProposerIdleMsV2()));

  gov
    .command("set-proposer-idle-ms <ms>")
    .description("Set proposer idle window (ms)")
    .action((ms) => console.log(setProposerIdleMsV2(Number(ms))));

  gov
    .command("default-pending-delegation-ms")
    .description("Default pending delegation window (ms)")
    .action(() => console.log(getDefaultPendingDelegationMsV2()));

  gov
    .command("pending-delegation-ms")
    .description("Current pending delegation window (ms)")
    .action(() => console.log(getPendingDelegationMsV2()));

  gov
    .command("set-pending-delegation-ms <ms>")
    .description("Set pending delegation window (ms)")
    .action((ms) => console.log(setPendingDelegationMsV2(Number(ms))));

  gov
    .command("active-proposer-count")
    .description("Count active V2 proposers (scope by realm)")
    .option("-r, --realm <realm>", "Realm scope")
    .action((opts) => console.log(getActiveProposerCount(opts.realm)));

  gov
    .command("active-delegation-count")
    .description("Count active V2 delegations (scope by delegator)")
    .option("-d, --delegator <id>", "Delegator scope")
    .action((opts) => console.log(getActiveDelegationCount(opts.delegator)));

  gov
    .command("register-proposer-v2 <proposer-id>")
    .description("Register a V2 proposer")
    .requiredOption("-r, --realm <realm>", "Realm")
    .option("-n, --display-name <name>", "Display name")
    .option(
      "-i, --initial-status <status>",
      "Initial status (default onboarding)",
    )
    .option("-m, --metadata <json>", "Metadata JSON")
    .action((proposerId, opts) => {
      const config = { proposerId, realm: opts.realm };
      if (opts.displayName) config.displayName = opts.displayName;
      if (opts.initialStatus) config.initialStatus = opts.initialStatus;
      if (opts.metadata) config.metadata = JSON.parse(opts.metadata);
      console.log(JSON.stringify(registerProposerV2(null, config), null, 2));
    });

  gov
    .command("proposer-v2 <proposer-id>")
    .description("Get V2 proposer record")
    .action((proposerId) => {
      console.log(JSON.stringify(getProposerV2(proposerId), null, 2));
    });

  gov
    .command("set-proposer-maturity-v2 <proposer-id> <status>")
    .description("Set proposer V2 maturity status")
    .option("-r, --reason <reason>", "Reason")
    .option("-m, --metadata <json>", "Metadata JSON patch")
    .action((proposerId, status, opts) => {
      const patch = {};
      if (opts.reason !== undefined) patch.reason = opts.reason;
      if (opts.metadata) patch.metadata = JSON.parse(opts.metadata);
      console.log(
        JSON.stringify(
          setProposerMaturityV2(null, proposerId, status, patch),
          null,
          2,
        ),
      );
    });

  gov
    .command("activate-proposer <proposer-id>")
    .description("Activate V2 proposer")
    .option("-r, --reason <reason>", "Reason")
    .action((proposerId, opts) => {
      console.log(
        JSON.stringify(
          activateProposer(null, proposerId, opts.reason),
          null,
          2,
        ),
      );
    });

  gov
    .command("suspend-proposer <proposer-id>")
    .description("Suspend V2 proposer")
    .option("-r, --reason <reason>", "Reason")
    .action((proposerId, opts) => {
      console.log(
        JSON.stringify(suspendProposer(null, proposerId, opts.reason), null, 2),
      );
    });

  gov
    .command("retire-proposer <proposer-id>")
    .description("Retire V2 proposer (terminal)")
    .option("-r, --reason <reason>", "Reason")
    .action((proposerId, opts) => {
      console.log(
        JSON.stringify(retireProposer(null, proposerId, opts.reason), null, 2),
      );
    });

  gov
    .command("touch-proposer-activity <proposer-id>")
    .description("Touch V2 proposer lastActivityAt")
    .action((proposerId) => {
      console.log(JSON.stringify(touchProposerActivity(proposerId), null, 2));
    });

  gov
    .command("create-delegation-v2 <delegation-id>")
    .description("Create V2 vote delegation")
    .requiredOption("-d, --delegator <id>", "Delegator ID")
    .requiredOption("-t, --delegatee <id>", "Delegatee ID")
    .requiredOption("-s, --scope <scope>", "Scope")
    .option("-e, --expires-at <ms>", "Expires-at epoch ms")
    .option("-m, --metadata <json>", "Metadata JSON")
    .action((delegationId, opts) => {
      const config = {
        delegationId,
        delegatorId: opts.delegator,
        delegateeId: opts.delegatee,
        scope: opts.scope,
      };
      if (opts.expiresAt) config.expiresAt = Number(opts.expiresAt);
      if (opts.metadata) config.metadata = JSON.parse(opts.metadata);
      console.log(JSON.stringify(createDelegationV2(null, config), null, 2));
    });

  gov
    .command("delegation-v2 <delegation-id>")
    .description("Get V2 delegation record")
    .action((delegationId) => {
      console.log(JSON.stringify(getDelegationV2(delegationId), null, 2));
    });

  gov
    .command("set-delegation-status-v2 <delegation-id> <status>")
    .description("Set delegation V2 status")
    .option("-r, --reason <reason>", "Reason")
    .option("-m, --metadata <json>", "Metadata JSON patch")
    .action((delegationId, status, opts) => {
      const patch = {};
      if (opts.reason !== undefined) patch.reason = opts.reason;
      if (opts.metadata) patch.metadata = JSON.parse(opts.metadata);
      console.log(
        JSON.stringify(
          setDelegationStatusV2(null, delegationId, status, patch),
          null,
          2,
        ),
      );
    });

  gov
    .command("activate-delegation <delegation-id>")
    .description("Activate V2 delegation")
    .option("-r, --reason <reason>", "Reason")
    .action((delegationId, opts) => {
      console.log(
        JSON.stringify(
          activateDelegation(null, delegationId, opts.reason),
          null,
          2,
        ),
      );
    });

  gov
    .command("revoke-delegation <delegation-id>")
    .description("Revoke V2 delegation (terminal)")
    .option("-r, --reason <reason>", "Reason")
    .action((delegationId, opts) => {
      console.log(
        JSON.stringify(
          revokeDelegation(null, delegationId, opts.reason),
          null,
          2,
        ),
      );
    });

  gov
    .command("expire-delegation <delegation-id>")
    .description("Expire V2 delegation (terminal)")
    .option("-r, --reason <reason>", "Reason")
    .action((delegationId, opts) => {
      console.log(
        JSON.stringify(
          expireDelegation(null, delegationId, opts.reason),
          null,
          2,
        ),
      );
    });

  gov
    .command("auto-retire-idle-proposers")
    .description("Auto-retire active/suspended proposers past idle window")
    .action(() => {
      console.log(JSON.stringify(autoRetireIdleProposers(null), null, 2));
    });

  gov
    .command("auto-expire-stale-pending-delegations")
    .description("Auto-expire pending delegations past window")
    .action(() => {
      console.log(
        JSON.stringify(autoExpireStalePendingDelegations(null), null, 2),
      );
    });

  gov
    .command("stats-v2")
    .description("V2 governance statistics")
    .action(() => {
      console.log(JSON.stringify(getGovernanceStatsV2(), null, 2));
    });
}

// === Iter19 V2 governance overlay ===
export function registerCommgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "governance");
  if (!parent) return;
  const L = async () => await import("../lib/community-governance.js");
  parent
    .command("commgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.COMMGOV_PROFILE_MATURITY_V2,
            motionLifecycle: m.COMMGOV_MOTION_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("commgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveCommgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingCommgovMotionsPerProfileV2(),
            idleMs: m.getCommgovProfileIdleMsV2(),
            stuckMs: m.getCommgovMotionStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("commgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveCommgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("commgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingCommgovMotionsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("commgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setCommgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("commgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setCommgovMotionStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("commgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--chamber <v>", "chamber")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerCommgovProfileV2({ id, owner, chamber: o.chamber }),
          null,
          2,
        ),
      );
    });
  parent
    .command("commgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateCommgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("commgov-pause-v2 <id>")
    .description("Pause profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).pauseCommgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("commgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveCommgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("commgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchCommgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("commgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getCommgovProfileV2(id), null, 2));
    });
  parent
    .command("commgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listCommgovProfilesV2(), null, 2));
    });
  parent
    .command("commgov-create-motion-v2 <id> <profileId>")
    .description("Create motion")
    .option("--subject <v>", "subject")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createCommgovMotionV2({ id, profileId, subject: o.subject }),
          null,
          2,
        ),
      );
    });
  parent
    .command("commgov-voting-motion-v2 <id>")
    .description("Mark motion as voting")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).votingCommgovMotionV2(id), null, 2),
      );
    });
  parent
    .command("commgov-complete-motion-v2 <id>")
    .description("Complete motion")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeMotionCommgovV2(id), null, 2),
      );
    });
  parent
    .command("commgov-fail-motion-v2 <id> [reason]")
    .description("Fail motion")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failCommgovMotionV2(id, reason), null, 2),
      );
    });
  parent
    .command("commgov-cancel-motion-v2 <id> [reason]")
    .description("Cancel motion")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelCommgovMotionV2(id, reason), null, 2),
      );
    });
  parent
    .command("commgov-get-motion-v2 <id>")
    .description("Get motion")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getCommgovMotionV2(id), null, 2));
    });
  parent
    .command("commgov-list-motions-v2")
    .description("List motions")
    .action(async () => {
      console.log(JSON.stringify((await L()).listCommgovMotionsV2(), null, 2));
    });
  parent
    .command("commgov-auto-pause-idle-v2")
    .description("Auto-pause idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoPauseIdleCommgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("commgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck motions")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckCommgovMotionsV2(), null, 2),
      );
    });
  parent
    .command("commgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getCommunityGovernanceGovStatsV2(), null, 2),
      );
    });
}
