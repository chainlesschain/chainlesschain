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
  // V2
  ACCOUNT_STATUS_V2,
  CLAIM_STATUS_V2,
  TOKEN_DEFAULT_MAX_PENDING_CLAIMS_PER_USER,
  TOKEN_DEFAULT_CLAIM_EXPIRY_MS,
  TOKEN_DEFAULT_MAX_CLAIM_AMOUNT,
  setMaxPendingClaimsPerUser,
  setClaimExpiryMs,
  setMaxClaimAmount,
  getMaxPendingClaimsPerUser,
  getClaimExpiryMs,
  getMaxClaimAmount,
  getPendingClaimCount,
  registerAccountV2,
  getAccountStatusV2,
  setAccountStatusV2,
  freezeAccount,
  unfreezeAccount,
  closeAccount,
  submitClaimV2,
  getClaimStatusV2,
  setClaimStatusV2,
  approveClaim,
  rejectClaim,
  payClaim,
  autoExpireUnclaimedClaims,
  getTokenStatsV2,
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

  // ─────────────────────────────────────────────────────────────
  // Phase 66 V2 — Account + Claim lifecycle
  // ─────────────────────────────────────────────────────────────

  inc
    .command("account-statuses-v2")
    .description("List V2 account states")
    .action(() => {
      for (const v of Object.values(ACCOUNT_STATUS_V2)) logger.log(v);
    });

  inc
    .command("claim-statuses-v2")
    .description("List V2 claim states")
    .action(() => {
      for (const v of Object.values(CLAIM_STATUS_V2)) logger.log(v);
    });

  inc
    .command("default-max-pending-claims-per-user")
    .description("Show default per-user pending claim cap")
    .action(() =>
      logger.log(String(TOKEN_DEFAULT_MAX_PENDING_CLAIMS_PER_USER)),
    );

  inc
    .command("max-pending-claims-per-user")
    .description("Show current per-user pending claim cap")
    .action(() => logger.log(String(getMaxPendingClaimsPerUser())));

  inc
    .command("set-max-pending-claims-per-user <n>")
    .description("Update per-user pending claim cap")
    .action((n) => {
      logger.log(String(setMaxPendingClaimsPerUser(n)));
    });

  inc
    .command("default-claim-expiry-ms")
    .description("Show default claim expiry (ms)")
    .action(() => logger.log(String(TOKEN_DEFAULT_CLAIM_EXPIRY_MS)));

  inc
    .command("claim-expiry-ms")
    .description("Show current claim expiry (ms)")
    .action(() => logger.log(String(getClaimExpiryMs())));

  inc
    .command("set-claim-expiry-ms <ms>")
    .description("Update claim expiry (ms)")
    .action((ms) => {
      logger.log(String(setClaimExpiryMs(ms)));
    });

  inc
    .command("default-max-claim-amount")
    .description("Show default max claim amount")
    .action(() => logger.log(String(TOKEN_DEFAULT_MAX_CLAIM_AMOUNT)));

  inc
    .command("max-claim-amount")
    .description("Show current max claim amount")
    .action(() => logger.log(String(getMaxClaimAmount())));

  inc
    .command("set-max-claim-amount <n>")
    .description("Update max claim amount")
    .action((n) => {
      logger.log(String(setMaxClaimAmount(n)));
    });

  inc
    .command("pending-claim-count")
    .description("Count PENDING claims (optionally scoped to user)")
    .option("-u, --user <user>", "Scope to user")
    .action((opts) => {
      logger.log(String(getPendingClaimCount(opts.user)));
    });

  inc
    .command("register-account-v2 <account-id>")
    .description("V2: register a tracked account (tags ACTIVE)")
    .option("-m, --metadata <meta>", "Metadata (JSON)")
    .action((accountId, opts) => {
      const ctx = bootstrap();
      try {
        const db = _dbFromCtx(ctx);
        const metadata = opts.metadata ? JSON.parse(opts.metadata) : undefined;
        const entry = registerAccountV2(db, { accountId, metadata });
        logger.log(JSON.stringify(entry, null, 2));
      } finally {
        shutdown();
      }
    });

  inc
    .command("account-status-v2 <account-id>")
    .description("V2: show account status")
    .action((accountId) => {
      const entry = getAccountStatusV2(accountId);
      if (!entry) {
        logger.log(chalk.yellow("(not found)"));
        return;
      }
      logger.log(JSON.stringify(entry, null, 2));
    });

  inc
    .command("set-account-status-v2 <account-id> <status>")
    .description("V2: transition account status (active|frozen|closed)")
    .option("-r, --reason <reason>", "Reason")
    .option("-m, --metadata <meta>", "Metadata (JSON)")
    .action((accountId, status, opts) => {
      const ctx = bootstrap();
      try {
        const db = _dbFromCtx(ctx);
        const metadata = opts.metadata ? JSON.parse(opts.metadata) : undefined;
        const entry = setAccountStatusV2(db, accountId, status, {
          reason: opts.reason,
          metadata,
        });
        logger.log(JSON.stringify(entry, null, 2));
      } finally {
        shutdown();
      }
    });

  inc
    .command("freeze-account <account-id>")
    .description("V2: shortcut → frozen")
    .option("-r, --reason <reason>", "Reason")
    .action((accountId, opts) => {
      const ctx = bootstrap();
      try {
        const db = _dbFromCtx(ctx);
        const entry = freezeAccount(db, accountId, opts.reason);
        logger.log(JSON.stringify(entry, null, 2));
      } finally {
        shutdown();
      }
    });

  inc
    .command("unfreeze-account <account-id>")
    .description("V2: shortcut → active (from frozen)")
    .option("-r, --reason <reason>", "Reason")
    .action((accountId, opts) => {
      const ctx = bootstrap();
      try {
        const db = _dbFromCtx(ctx);
        const entry = unfreezeAccount(db, accountId, opts.reason);
        logger.log(JSON.stringify(entry, null, 2));
      } finally {
        shutdown();
      }
    });

  inc
    .command("close-account <account-id>")
    .description("V2: shortcut → closed")
    .option("-r, --reason <reason>", "Reason")
    .action((accountId, opts) => {
      const ctx = bootstrap();
      try {
        const db = _dbFromCtx(ctx);
        const entry = closeAccount(db, accountId, opts.reason);
        logger.log(JSON.stringify(entry, null, 2));
      } finally {
        shutdown();
      }
    });

  inc
    .command("submit-claim-v2 <claim-id>")
    .description("V2: submit a claim (tags PENDING)")
    .requiredOption("-u, --user <user>", "User ID")
    .requiredOption("-a, --amount <amount>", "Amount")
    .option("-c, --contribution <id>", "Contribution ID")
    .option("-m, --metadata <meta>", "Metadata (JSON)")
    .action((claimId, opts) => {
      const ctx = bootstrap();
      try {
        const db = _dbFromCtx(ctx);
        const metadata = opts.metadata ? JSON.parse(opts.metadata) : undefined;
        const entry = submitClaimV2(db, {
          claimId,
          userId: opts.user,
          amount: Number(opts.amount),
          contributionId: opts.contribution,
          metadata,
        });
        logger.log(JSON.stringify(entry, null, 2));
      } finally {
        shutdown();
      }
    });

  inc
    .command("claim-status-v2 <claim-id>")
    .description("V2: show claim status")
    .action((claimId) => {
      const entry = getClaimStatusV2(claimId);
      if (!entry) {
        logger.log(chalk.yellow("(not found)"));
        return;
      }
      logger.log(JSON.stringify(entry, null, 2));
    });

  inc
    .command("set-claim-status-v2 <claim-id> <status>")
    .description("V2: transition claim (pending|approved|paid|rejected)")
    .option("-r, --reason <reason>", "Reason")
    .option("-m, --metadata <meta>", "Metadata (JSON)")
    .action((claimId, status, opts) => {
      const ctx = bootstrap();
      try {
        const db = _dbFromCtx(ctx);
        const metadata = opts.metadata ? JSON.parse(opts.metadata) : undefined;
        const entry = setClaimStatusV2(db, claimId, status, {
          reason: opts.reason,
          metadata,
        });
        logger.log(JSON.stringify(entry, null, 2));
      } finally {
        shutdown();
      }
    });

  inc
    .command("approve-claim <claim-id>")
    .description("V2: shortcut → approved")
    .option("-r, --reason <reason>", "Reason")
    .action((claimId, opts) => {
      const ctx = bootstrap();
      try {
        const db = _dbFromCtx(ctx);
        const entry = approveClaim(db, claimId, opts.reason);
        logger.log(JSON.stringify(entry, null, 2));
      } finally {
        shutdown();
      }
    });

  inc
    .command("reject-claim <claim-id>")
    .description("V2: shortcut → rejected")
    .option("-r, --reason <reason>", "Reason")
    .action((claimId, opts) => {
      const ctx = bootstrap();
      try {
        const db = _dbFromCtx(ctx);
        const entry = rejectClaim(db, claimId, opts.reason);
        logger.log(JSON.stringify(entry, null, 2));
      } finally {
        shutdown();
      }
    });

  inc
    .command("pay-claim <claim-id>")
    .description("V2: shortcut → paid (stamps paidAt)")
    .option("-r, --reason <reason>", "Reason")
    .action((claimId, opts) => {
      const ctx = bootstrap();
      try {
        const db = _dbFromCtx(ctx);
        const entry = payClaim(db, claimId, opts.reason);
        logger.log(JSON.stringify(entry, null, 2));
      } finally {
        shutdown();
      }
    });

  inc
    .command("auto-expire-unclaimed-claims")
    .description("V2: bulk-reject stale PENDING claims")
    .action(() => {
      const ctx = bootstrap();
      try {
        const db = _dbFromCtx(ctx);
        const expired = autoExpireUnclaimedClaims(db);
        logger.log(`Expired ${expired.length} claim(s)`);
      } finally {
        shutdown();
      }
    });

  inc
    .command("stats-v2")
    .description("V2: all-enum-key stats snapshot")
    .action(() => {
      logger.log(JSON.stringify(getTokenStatsV2(), null, 2));
    });
}

// === Iter17 V2 governance overlay ===
export function registerIncgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "incentive");
  if (!parent) return;
  const L = async () => await import("../lib/token-incentive.js");
  parent
    .command("incgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.INCGOV_PROFILE_MATURITY_V2,
            payoutLifecycle: m.INCGOV_PAYOUT_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("incgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveIncgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingIncgovPayoutsPerProfileV2(),
            idleMs: m.getIncgovProfileIdleMsV2(),
            stuckMs: m.getIncgovPayoutStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("incgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveIncgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("incgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingIncgovPayoutsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("incgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setIncgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("incgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setIncgovPayoutStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("incgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--token <v>", "token")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerIncgovProfileV2({ id, owner, token: o.token }),
          null,
          2,
        ),
      );
    });
  parent
    .command("incgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateIncgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("incgov-pause-v2 <id>")
    .description("Pause profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).pauseIncgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("incgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveIncgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("incgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchIncgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("incgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getIncgovProfileV2(id), null, 2));
    });
  parent
    .command("incgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listIncgovProfilesV2(), null, 2));
    });
  parent
    .command("incgov-create-payout-v2 <id> <profileId>")
    .description("Create payout")
    .option("--recipient <v>", "recipient")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createIncgovPayoutV2({ id, profileId, recipient: o.recipient }),
          null,
          2,
        ),
      );
    });
  parent
    .command("incgov-processing-payout-v2 <id>")
    .description("Mark payout as processing")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).processingIncgovPayoutV2(id), null, 2),
      );
    });
  parent
    .command("incgov-complete-payout-v2 <id>")
    .description("Complete payout")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completePayoutIncgovV2(id), null, 2),
      );
    });
  parent
    .command("incgov-fail-payout-v2 <id> [reason]")
    .description("Fail payout")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failIncgovPayoutV2(id, reason), null, 2),
      );
    });
  parent
    .command("incgov-cancel-payout-v2 <id> [reason]")
    .description("Cancel payout")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelIncgovPayoutV2(id, reason), null, 2),
      );
    });
  parent
    .command("incgov-get-payout-v2 <id>")
    .description("Get payout")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getIncgovPayoutV2(id), null, 2));
    });
  parent
    .command("incgov-list-payouts-v2")
    .description("List payouts")
    .action(async () => {
      console.log(JSON.stringify((await L()).listIncgovPayoutsV2(), null, 2));
    });
  parent
    .command("incgov-auto-pause-idle-v2")
    .description("Auto-pause idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoPauseIdleIncgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("incgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck payouts")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckIncgovPayoutsV2(), null, 2),
      );
    });
  parent
    .command("incgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getTokenIncentiveGovStatsV2(), null, 2),
      );
    });
}
