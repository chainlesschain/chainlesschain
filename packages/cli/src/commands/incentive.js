/**
 * Token Incentive commands (Phase 66)
 * chainlesschain incentive contribution-types|tx-types|balance|accounts|transfer|
 *                          mint|history|contribute|reward|contributions|leaderboard
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureTokenTables,
  listContributionTypes,
  listTxTypes,
  getBalance,
  listAccounts,
  transfer,
  mint,
  getTransactionHistory,
  recordContribution,
  rewardContribution,
  getContributions,
  getLeaderboard,
} from "../lib/token-incentive.js";

function _dbFromCtx(ctx) {
  if (!ctx.db) {
    logger.error("Database not available");
    process.exit(1);
  }
  const db = ctx.db.getDatabase();
  ensureTokenTables(db);
  return db;
}

function _printAccount(a) {
  logger.log(`  ${chalk.bold("Account:")}       ${chalk.cyan(a.accountId)}`);
  logger.log(`  ${chalk.bold("Balance:")}       ${a.balance}`);
  logger.log(`  ${chalk.bold("Total Earned:")}  ${a.totalEarned}`);
  logger.log(`  ${chalk.bold("Total Spent:")}   ${a.totalSpent}`);
}

export function registerIncentiveCommand(program) {
  const inc = program
    .command("incentive")
    .description(
      "Token incentive — ledger accounts, transfers, contributions, leaderboard",
    );

  inc
    .command("contribution-types")
    .description("List known contribution types and their base rewards")
    .option("--json", "Output as JSON")
    .action((options) => {
      const types = listContributionTypes();
      if (options.json) {
        console.log(JSON.stringify(types, null, 2));
      } else {
        for (const t of types) {
          logger.log(
            `  ${chalk.cyan(t.name.padEnd(22))} base=${String(t.baseReward).padStart(6)}  ${t.description}`,
          );
        }
      }
    });

  inc
    .command("tx-types")
    .description("List known transaction types")
    .option("--json", "Output as JSON")
    .action((options) => {
      const types = listTxTypes();
      if (options.json) {
        console.log(JSON.stringify(types, null, 2));
      } else {
        for (const t of types) logger.log(`  ${chalk.cyan(t)}`);
      }
    });

  inc
    .command("balance <account-id>")
    .description("Query token balance for an account")
    .option("--json", "Output as JSON")
    .action(async (accountId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const account = getBalance(accountId);
        if (!account) {
          logger.info(`No account: ${accountId} (balance 0)`);
        } else if (options.json) {
          console.log(JSON.stringify(account, null, 2));
        } else {
          _printAccount(account);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  inc
    .command("accounts")
    .description("List accounts (sorted by balance DESC)")
    .option("--limit <n>", "Maximum entries", parseInt, 50)
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const rows = listAccounts({ limit: options.limit });
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
        } else if (rows.length === 0) {
          logger.info("No accounts.");
        } else {
          for (const a of rows) {
            logger.log(
              `  ${chalk.cyan(a.accountId.padEnd(24))} balance=${String(a.balance).padStart(10)}  earned=${a.totalEarned}  spent=${a.totalSpent}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  inc
    .command("mint <to> <amount>")
    .description("Mint tokens into an account (admin op)")
    .option("-r, --reason <text>", "Reason (e.g. initial grant)")
    .option("--json", "Output as JSON")
    .action(async (to, amountStr, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const tx = mint(db, {
          to,
          amount: Number(amountStr),
          reason: options.reason,
        });
        if (options.json) {
          console.log(JSON.stringify(tx, null, 2));
        } else {
          logger.success(`Minted ${tx.amount} → ${tx.toAccount}`);
          logger.log(
            `  ${chalk.bold("Tx:")}      ${chalk.cyan(tx.id.slice(0, 8))}`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  inc
    .command("transfer <from> <to> <amount>")
    .description("Transfer tokens between accounts")
    .option("-r, --reason <text>", "Reason for transfer")
    .option("--json", "Output as JSON")
    .action(async (from, to, amountStr, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const tx = transfer(db, {
          from,
          to,
          amount: Number(amountStr),
          reason: options.reason,
        });
        if (options.json) {
          console.log(JSON.stringify(tx, null, 2));
        } else {
          logger.success(`Transferred ${tx.amount} from ${from} → ${to}`);
          logger.log(
            `  ${chalk.bold("Tx:")}      ${chalk.cyan(tx.id.slice(0, 8))}`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  inc
    .command("history")
    .description("Show transaction history")
    .option("-a, --account <id>", "Filter by account (from OR to)")
    .option("-t, --type <t>", "Filter by tx type (transfer|reward|mint|burn)")
    .option("--limit <n>", "Maximum entries", parseInt, 50)
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const rows = getTransactionHistory({
          accountId: options.account,
          type: options.type,
          limit: options.limit,
        });
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
        } else if (rows.length === 0) {
          logger.info("No transactions.");
        } else {
          for (const tx of rows) {
            const from = tx.fromAccount || "(system)";
            const to = tx.toAccount || "(burn)";
            logger.log(
              `  ${chalk.cyan(tx.id.slice(0, 8))} [${tx.type.padEnd(8)}] ${String(tx.amount).padStart(10)} ${from} → ${to}${tx.reason ? `  (${tx.reason})` : ""}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  inc
    .command("contribute <user-id> <type> [value]")
    .description(
      "Record a contribution (type: skill_publication|invocation_provided|skill_review|bug_report|code_contribution|documentation|community_support)",
    )
    .option("-m, --metadata <json>", "Metadata JSON")
    .option("-a, --auto-reward", "Auto-reward this contribution")
    .option(
      "-M, --multiplier <n>",
      "Reward multiplier (requires --auto-reward)",
      parseFloat,
      1.0,
    )
    .option("--json", "Output as JSON")
    .action(async (userId, type, valueStr, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const metadata = options.metadata ? JSON.parse(options.metadata) : null;
        const contribution = recordContribution(db, {
          userId,
          type,
          value: valueStr != null ? Number(valueStr) : 1,
          metadata,
          autoReward: options.autoReward,
          multiplier: options.multiplier,
        });
        if (options.json) {
          console.log(JSON.stringify(contribution, null, 2));
        } else {
          logger.success(
            `Contribution recorded: ${userId} → ${type} (value=${contribution.value})`,
          );
          logger.log(
            `  ${chalk.bold("ID:")}          ${chalk.cyan(contribution.id.slice(0, 8))}`,
          );
          if (contribution.rewarded) {
            logger.log(
              `  ${chalk.bold("Rewarded:")}    ${contribution.rewardAmount} tokens`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  inc
    .command("reward <contribution-id>")
    .description("Reward a previously-recorded contribution")
    .option("-M, --multiplier <n>", "Reward multiplier", parseFloat, 1.0)
    .option("--json", "Output as JSON")
    .action(async (contributionId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const result = rewardContribution(db, contributionId, {
          multiplier: options.multiplier,
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (result.tx) {
          logger.success(
            `Rewarded ${result.tx.amount} tokens → ${result.tx.toAccount}`,
          );
          logger.log(
            `  ${chalk.bold("Tx:")}          ${chalk.cyan(result.tx.id.slice(0, 8))}`,
          );
        } else {
          logger.info("No reward (amount was 0).");
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  inc
    .command("contributions")
    .description("List contributions")
    .option("-u, --user <id>", "Filter by user")
    .option("-t, --type <t>", "Filter by contribution type")
    .option("--rewarded", "Only rewarded contributions")
    .option("--unrewarded", "Only unrewarded contributions")
    .option("--limit <n>", "Maximum entries", parseInt, 50)
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        let rewardedFilter;
        if (options.rewarded) rewardedFilter = true;
        if (options.unrewarded) rewardedFilter = false;
        const rows = getContributions({
          userId: options.user,
          type: options.type,
          rewarded: rewardedFilter,
          limit: options.limit,
        });
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
        } else if (rows.length === 0) {
          logger.info("No contributions.");
        } else {
          for (const c of rows) {
            const flag = c.rewarded ? chalk.green("✓") : chalk.yellow("…");
            logger.log(
              `  ${flag} ${chalk.cyan(c.id.slice(0, 8))} ${c.userId.padEnd(16)} ${c.type.padEnd(22)} value=${c.value} reward=${c.rewardAmount}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  inc
    .command("leaderboard")
    .description("Top contributors by total reward earned")
    .option("--limit <n>", "Maximum entries", parseInt, 10)
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const rows = getLeaderboard({ limit: options.limit });
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
        } else if (rows.length === 0) {
          logger.info("No contributions yet.");
        } else {
          rows.forEach((r, i) => {
            logger.log(
              `  ${chalk.bold(`#${i + 1}`.padStart(3))} ${chalk.cyan(r.userId.padEnd(20))} reward=${String(r.totalReward).padStart(10)}  value=${r.totalValue}  count=${r.contributions}`,
            );
          });
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
