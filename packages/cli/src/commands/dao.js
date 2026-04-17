/**
 * DAO Governance v2 commands
 * chainlesschain dao propose|vote|delegate|execute|treasury|allocate|stats|configure
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureDAOv2Tables,
  propose,
  vote,
  delegate,
  execute,
  getTreasury,
  allocate,
  depositToTreasury,
  getStats,
  configure,
  // Phase 92 canonical surface
  PROPOSAL_STATUS,
  VOTE_TYPE,
  DELEGATION_STATUS,
  TREASURY_TX_TYPE,
  createProposalV2,
  activateProposal,
  castVote,
  delegateVotingPower,
  revokeDelegation,
  getActiveDelegations,
  queueProposal,
  executeProposalV2,
  cancelProposal,
  allocateFundsV2,
  getTreasuryState,
  getGovernanceStatsV2,
  configureV2,
  getConfigV2,
  depositToTreasuryV2,
} from "../lib/dao-governance.js";

export function registerDaoCommand(program) {
  const dao = program
    .command("dao")
    .description("DAO Governance v2 — proposals, voting, delegation, treasury");

  // dao propose
  dao
    .command("propose <title>")
    .description("Create a governance proposal")
    .option("-d, --description <text>", "Proposal description")
    .option("-p, --proposer <id>", "Proposer identity", "cli-user")
    .option(
      "--voting-type <type>",
      "Voting type: simple or quadratic",
      "simple",
    )
    .action(async (title, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDAOv2Tables(db);

        const result = propose(
          db,
          title,
          options.description,
          options.proposer,
          {
            votingType: options.votingType,
          },
        );
        logger.success("Proposal created");
        logger.log(`  ${chalk.bold("ID:")}      ${chalk.cyan(result.id)}`);
        logger.log(`  ${chalk.bold("Title:")}   ${result.title}`);
        logger.log(`  ${chalk.bold("Status:")}  ${result.status}`);
        logger.log(`  ${chalk.bold("Type:")}    ${result.votingType}`);
        logger.log(`  ${chalk.bold("Ends:")}    ${result.endsAt}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // dao vote
  dao
    .command("vote <proposal-id> <direction>")
    .description('Vote on a proposal (direction: "for" or "against")')
    .option("-v, --voter <id>", "Voter identity", "cli-user")
    .option("-w, --weight <n>", "Vote weight", "1")
    .action(async (proposalId, direction, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDAOv2Tables(db);

        const result = vote(
          db,
          proposalId,
          options.voter,
          direction,
          parseFloat(options.weight),
        );
        logger.success("Vote recorded");
        logger.log(
          `  ${chalk.bold("Vote ID:")}   ${chalk.cyan(result.voteId)}`,
        );
        logger.log(`  ${chalk.bold("Direction:")} ${result.direction}`);
        logger.log(`  ${chalk.bold("Weight:")}    ${result.weight}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // dao delegate
  dao
    .command("delegate <delegator> <delegate-to>")
    .description("Delegate voting power")
    .option("-w, --weight <n>", "Delegation weight", "1")
    .action(async (delegator, delegateTo, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDAOv2Tables(db);

        const result = delegate(
          db,
          delegator,
          delegateTo,
          parseFloat(options.weight),
        );
        logger.success("Delegation set");
        logger.log(`  ${chalk.bold("From:")}   ${result.delegator}`);
        logger.log(`  ${chalk.bold("To:")}     ${result.delegate}`);
        logger.log(`  ${chalk.bold("Weight:")} ${result.weight}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // dao execute
  dao
    .command("execute <proposal-id>")
    .description("Execute a passed proposal")
    .action(async (proposalId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDAOv2Tables(db);

        const result = execute(db, proposalId);
        logger.success(`Proposal ${chalk.cyan(result.proposalId)} executed`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // dao treasury
  dao
    .command("treasury")
    .description("Show treasury balance and allocations")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDAOv2Tables(db);

        const result = getTreasury();
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(`  ${chalk.bold("Balance:")}     ${result.balance}`);
          logger.log(
            `  ${chalk.bold("Allocations:")} ${result.allocations.length}`,
          );
          for (const a of result.allocations) {
            logger.log(
              `    ${chalk.cyan(a.id.slice(0, 12))} ${a.amount} — ${a.description || "N/A"}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // dao allocate
  dao
    .command("allocate <proposal-id> <amount>")
    .description("Allocate treasury funds to a proposal")
    .option("-d, --description <text>", "Allocation description")
    .action(async (proposalId, amount, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDAOv2Tables(db);

        const result = allocate(
          db,
          proposalId,
          parseFloat(amount),
          options.description,
        );
        logger.success("Funds allocated");
        logger.log(`  ${chalk.bold("ID:")}       ${chalk.cyan(result.id)}`);
        logger.log(`  ${chalk.bold("Amount:")}   ${result.amount}`);
        logger.log(`  ${chalk.bold("Proposal:")} ${result.proposalId}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // dao stats
  dao
    .command("stats")
    .description("Show governance statistics")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDAOv2Tables(db);

        const result = getStats();
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(
            `  ${chalk.bold("Total Proposals:")} ${result.totalProposals}`,
          );
          logger.log(`  ${chalk.bold("Active:")}          ${result.active}`);
          logger.log(`  ${chalk.bold("Executed:")}        ${result.executed}`);
          logger.log(
            `  ${chalk.bold("Delegations:")}     ${result.delegations}`,
          );
          logger.log(`  ${chalk.bold("Treasury:")}        ${result.treasury}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // dao configure
  dao
    .command("configure")
    .description("Update governance configuration")
    .option("--voting-period <ms>", "Voting period in milliseconds")
    .option("--quorum <ratio>", "Quorum ratio (0-1)")
    .option("--execution-delay <ms>", "Execution delay in milliseconds")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDAOv2Tables(db);

        const cfg = {};
        if (options.votingPeriod)
          cfg.votingPeriod = parseInt(options.votingPeriod);
        if (options.quorum) cfg.quorum = parseFloat(options.quorum);
        if (options.executionDelay)
          cfg.executionDelay = parseInt(options.executionDelay);

        const result = configure(cfg);
        logger.success("Configuration updated");
        logger.log(
          `  ${chalk.bold("Voting Period:")}    ${result.votingPeriod}ms`,
        );
        logger.log(`  ${chalk.bold("Quorum:")}           ${result.quorum}`);
        logger.log(
          `  ${chalk.bold("Execution Delay:")}  ${result.executionDelay}ms`,
        );

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ══════════════════════════════════════════════════════════
  // Phase 92 (DAO 2.0) canonical subcommands
  // ══════════════════════════════════════════════════════════

  // dao statuses
  dao
    .command("statuses")
    .description("List Phase 92 enum references")
    .option("--json", "Output as JSON")
    .action((options) => {
      const payload = {
        proposalStatus: { ...PROPOSAL_STATUS },
        voteType: { ...VOTE_TYPE },
        delegationStatus: { ...DELEGATION_STATUS },
        treasuryTxType: { ...TREASURY_TX_TYPE },
      };
      if (options.json) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        for (const [group, enums] of Object.entries(payload)) {
          logger.log(chalk.bold(`${group}:`));
          for (const [key, val] of Object.entries(enums)) {
            logger.log(`  ${chalk.cyan(key)} → ${val}`);
          }
        }
      }
    });

  // dao propose-v2
  dao
    .command("propose-v2 <title>")
    .description("Create a Phase 92 proposal in DRAFT status")
    .option("-d, --description <text>", "Proposal description")
    .option("-p, --proposer-did <did>", "Proposer DID")
    .option("-t, --type <type>", "Proposal type", "standard")
    .option("--actions <json>", "Actions as JSON array", "[]")
    .option("--voting-duration <ms>", "Voting duration in ms")
    .option("--json", "Output as JSON")
    .action(async (title, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDAOv2Tables(db);

        const proposal = createProposalV2(db, {
          title,
          description: options.description,
          proposerDid: options.proposerDid || "did:cli:user",
          type: options.type,
          actions: JSON.parse(options.actions),
          votingDurationMs: options.votingDuration
            ? parseInt(options.votingDuration)
            : undefined,
        });

        if (options.json) {
          console.log(JSON.stringify(proposal, null, 2));
        } else {
          logger.success("Proposal created (DRAFT)");
          logger.log(`  ${chalk.bold("ID:")}     ${chalk.cyan(proposal.id)}`);
          logger.log(`  ${chalk.bold("Status:")} ${proposal.status}`);
          logger.log(`  ${chalk.bold("Type:")}   ${proposal.type}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // dao activate
  dao
    .command("activate <proposal-id>")
    .description("Move proposal DRAFT → ACTIVE and open voting window")
    .action(async (proposalId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDAOv2Tables(db);

        const p = activateProposal(db, proposalId);
        logger.success(`Proposal ${chalk.cyan(proposalId)} → ACTIVE`);
        logger.log(`  ${chalk.bold("Voting ends:")} ${p.votingEnd}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // dao cast-vote
  dao
    .command("cast-vote <proposal-id>")
    .description(
      "Cast a quadratic vote (cost = voteCount²). voteType: for|against|abstain",
    )
    .requiredOption("-v, --voter <did>", "Voter DID")
    .requiredOption("-t, --type <type>", "Vote type: for|against|abstain")
    .option("-c, --count <n>", "Vote count", "1")
    .option("-b, --balance <n>", "Voter token balance (validates cost)")
    .action(async (proposalId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDAOv2Tables(db);

        const record = castVote(db, {
          proposalId,
          voterDid: options.voter,
          voteType: options.type,
          voteCount: parseInt(options.count),
          balance: options.balance ? parseFloat(options.balance) : undefined,
        });

        logger.success("Vote cast");
        logger.log(`  ${chalk.bold("Type:")}         ${record.voteType}`);
        logger.log(`  ${chalk.bold("Count:")}        ${record.voteCount}`);
        logger.log(`  ${chalk.bold("Quad. cost:")}   ${record.quadraticCost}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // dao delegate-v2
  dao
    .command("delegate-v2 <from-did> <to-did>")
    .description("Delegate voting power with cycle + depth safety")
    .option("-w, --weight <n>", "Delegation weight", "1")
    .option("--expires-at <iso>", "ISO timestamp when delegation expires")
    .action(async (fromDid, toDid, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDAOv2Tables(db);

        const d = delegateVotingPower(db, {
          fromDid,
          toDid,
          weight: parseFloat(options.weight),
          expiresAt: options.expiresAt || null,
        });
        logger.success(`Delegated ${fromDid} → ${toDid}`);
        logger.log(`  ${chalk.bold("ID:")}       ${chalk.cyan(d.id)}`);
        logger.log(`  ${chalk.bold("Status:")}   ${d.status}`);
        if (d.expiresAt) {
          logger.log(`  ${chalk.bold("Expires:")}  ${d.expiresAt}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // dao revoke-delegation
  dao
    .command("revoke-delegation <from-did>")
    .description("Revoke an active delegation")
    .action(async (fromDid) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDAOv2Tables(db);

        const r = revokeDelegation(db, fromDid);
        logger.success(`Delegation revoked: ${chalk.cyan(r.id)}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // dao active-delegations
  dao
    .command("active-delegations")
    .description("List ACTIVE delegations (auto-expires past expiresAt)")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDAOv2Tables(db);

        const list = getActiveDelegations();
        if (options.json) {
          console.log(JSON.stringify(list, null, 2));
        } else if (list.length === 0) {
          logger.log("No active delegations");
        } else {
          for (const d of list) {
            logger.log(
              `  ${chalk.cyan(d.id.slice(0, 12))} ${d.fromDid} → ${d.toDid} (w=${d.weight})`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // dao queue
  dao
    .command("queue <proposal-id>")
    .description("Queue proposal (ACTIVE → QUEUE) if majority + quorum met")
    .action(async (proposalId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDAOv2Tables(db);

        const p = queueProposal(db, proposalId);
        logger.success(`Proposal → QUEUE`);
        logger.log(`  ${chalk.bold("Timelock ends:")} ${p.queueEnd}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // dao execute-v2
  dao
    .command("execute-v2 <proposal-id>")
    .description("Execute proposal (QUEUE → EXECUTE) after timelock")
    .action(async (proposalId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDAOv2Tables(db);

        const p = executeProposalV2(db, proposalId);
        logger.success(`Proposal ${chalk.cyan(proposalId)} → EXECUTE`);
        logger.log(`  ${chalk.bold("Executed at:")} ${p.executedAt}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // dao cancel
  dao
    .command("cancel <proposal-id>")
    .description("Cancel a proposal (non-executed)")
    .action(async (proposalId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDAOv2Tables(db);

        const p = cancelProposal(db, proposalId);
        logger.success(`Proposal → ${p.status}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // dao allocate-v2
  dao
    .command("allocate-v2 <proposal-id>")
    .description(
      "Allocate treasury funds to a recipient (proposal must be EXECUTED)",
    )
    .requiredOption("-r, --recipient <did>", "Recipient DID or address")
    .requiredOption("-a, --amount <n>", "Allocation amount")
    .option("--asset <symbol>", "Asset symbol", "native")
    .option("-m, --memo <text>", "Memo / description")
    .option("--json", "Output as JSON")
    .action(async (proposalId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDAOv2Tables(db);

        const tx = allocateFundsV2(db, {
          proposalId,
          recipient: options.recipient,
          amount: parseFloat(options.amount),
          asset: options.asset,
          memo: options.memo,
        });

        if (options.json) {
          console.log(JSON.stringify(tx, null, 2));
        } else {
          logger.success("Allocation recorded");
          logger.log(`  ${chalk.bold("ID:")}            ${chalk.cyan(tx.id)}`);
          logger.log(
            `  ${chalk.bold("Amount:")}        ${tx.amount} ${tx.asset}`,
          );
          logger.log(`  ${chalk.bold("Balance after:")} ${tx.balanceAfter}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // dao deposit-v2
  dao
    .command("deposit-v2")
    .description("Deposit funds into the DAO treasury")
    .requiredOption("-a, --amount <n>", "Deposit amount")
    .option("--asset <symbol>", "Asset symbol", "native")
    .option("--depositor-did <did>", "Depositor DID")
    .option("-m, --memo <text>", "Memo")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDAOv2Tables(db);

        const tx = depositToTreasuryV2(db, {
          amount: parseFloat(options.amount),
          asset: options.asset,
          depositorDid: options.depositorDid,
          memo: options.memo,
        });
        logger.success("Deposit recorded");
        logger.log(`  ${chalk.bold("Balance:")} ${tx.balanceAfter}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // dao treasury-state
  dao
    .command("treasury-state")
    .description("Show Phase 92 treasury state (balance + recent txs)")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDAOv2Tables(db);

        const s = getTreasuryState();
        if (options.json) {
          console.log(JSON.stringify(s, null, 2));
        } else {
          logger.log(`  ${chalk.bold("Balance:")}         ${s.balance}`);
          logger.log(`  ${chalk.bold("Total allocated:")} ${s.totalAllocated}`);
          logger.log(
            `  ${chalk.bold("Transactions:")}    ${s.transactions.length}`,
          );
          for (const t of s.recentTxs.slice(0, 5)) {
            logger.log(
              `    ${chalk.cyan(t.id.slice(0, 12))} ${t.txType} ${t.amount} (bal=${t.balanceAfter})`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // dao stats-v2
  dao
    .command("stats-v2")
    .description(
      "Phase 92 governance stats with participation + delegation coverage",
    )
    .option("-m, --members <n>", "Total member count (for rate calc)", "0")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDAOv2Tables(db);

        const s = getGovernanceStatsV2(parseInt(options.members));
        if (options.json) {
          console.log(JSON.stringify(s, null, 2));
        } else {
          logger.log(
            `  ${chalk.bold("Total proposals:")}     ${s.totalProposals}`,
          );
          logger.log(
            `  ${chalk.bold("Unique voters:")}       ${s.uniqueVoters}`,
          );
          logger.log(
            `  ${chalk.bold("Participation:")}       ${(s.participationRate * 100).toFixed(2)}%`,
          );
          logger.log(
            `  ${chalk.bold("Active delegations:")}  ${s.activeDelegations}`,
          );
          logger.log(
            `  ${chalk.bold("Delegation coverage:")}  ${(s.delegationCoverage * 100).toFixed(2)}%`,
          );
          logger.log(
            `  ${chalk.bold("Treasury balance:")}    ${s.treasuryBalance}`,
          );
          logger.log(chalk.bold("  By status:"));
          for (const [k, v] of Object.entries(s.byStatus)) {
            if (v > 0) logger.log(`    ${k}: ${v}`);
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // dao configure-v2
  dao
    .command("configure-v2")
    .description("Update Phase 92 governance config")
    .option("--voting-duration <ms>", "Voting duration ms")
    .option("--quorum-percentage <n>", "Quorum % (0-100)")
    .option("--timelock-ms <ms>", "Timelock ms")
    .option(
      "--quadratic-enabled <bool>",
      "Enable quadratic voting (true|false)",
    )
    .option("--max-delegation-depth <n>", "Max delegation chain depth")
    .option("--proposal-threshold <n>", "Minimum tokens to propose")
    .option("--max-single-allocation <n>", "Max single allocation")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const updates = {};
        if (options.votingDuration)
          updates.votingDurationMs = parseInt(options.votingDuration);
        if (options.quorumPercentage)
          updates.quorumPercentage = parseFloat(options.quorumPercentage);
        if (options.timelockMs)
          updates.timelockMs = parseInt(options.timelockMs);
        if (options.quadraticEnabled !== undefined)
          updates.quadraticEnabled = options.quadraticEnabled === "true";
        if (options.maxDelegationDepth)
          updates.maxDelegationDepth = parseInt(options.maxDelegationDepth);
        if (options.proposalThreshold)
          updates.proposalThreshold = parseFloat(options.proposalThreshold);
        if (options.maxSingleAllocation)
          updates.maxSingleAllocation = parseFloat(options.maxSingleAllocation);

        const cfg = configureV2(updates);
        if (options.json) {
          console.log(JSON.stringify(cfg, null, 2));
        } else {
          logger.success("Phase 92 config updated");
          for (const [k, v] of Object.entries(cfg)) {
            logger.log(`  ${chalk.bold(k + ":")} ${v}`);
          }
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // dao config-v2 (read-only)
  dao
    .command("config-v2")
    .description("Show Phase 92 governance config")
    .option("--json", "Output as JSON")
    .action((options) => {
      const cfg = getConfigV2();
      if (options.json) {
        console.log(JSON.stringify(cfg, null, 2));
      } else {
        for (const [k, v] of Object.entries(cfg)) {
          logger.log(`  ${chalk.bold(k + ":")} ${v}`);
        }
      }
    });
}
