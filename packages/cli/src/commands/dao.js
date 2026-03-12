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
}
