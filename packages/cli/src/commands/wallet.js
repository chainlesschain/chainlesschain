/**
 * Wallet & asset commands
 * chainlesschain wallet create|list|balance|set-default|delete|asset|transfer|history|summary
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  createWallet,
  getAllWallets,
  getBalance,
  setDefaultWallet,
  deleteWallet,
  createAsset,
  getAllAssets,
  getAssets,
  transferAsset,
  getTransactions,
  getWalletSummary,
  WALLET_MATURITY_V2,
  TX_LIFECYCLE_V2,
  getMaxActiveWalletsPerOwnerV2,
  setMaxActiveWalletsPerOwnerV2,
  getMaxPendingTxPerWalletV2,
  setMaxPendingTxPerWalletV2,
  getWalletIdleMsV2,
  setWalletIdleMsV2,
  getTxStuckMsV2,
  setTxStuckMsV2,
  getActiveWalletCountV2,
  getPendingTxCountV2,
  registerWalletV2,
  getWalletV2,
  listWalletsV2,
  setWalletMaturityV2,
  activateWalletV2,
  freezeWalletV2,
  retireWalletV2,
  touchWalletV2,
  createTxV2,
  getTxV2,
  listTxsV2,
  setTxStatusV2,
  submitTxV2,
  confirmTxV2,
  failTxV2,
  rejectTxV2,
  autoRetireIdleWalletsV2,
  autoFailStuckTxV2,
  getWalletManagerStatsV2,
} from "../lib/wallet-manager.js";

export function registerWalletCommand(program) {
  const wallet = program
    .command("wallet")
    .description("Digital wallet and asset management");

  // wallet create
  wallet
    .command("create")
    .description("Create a new wallet")
    .option("--name <name>", "Wallet name")
    .option("--password <password>", "Encryption password")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const w = createWallet(db, options.name, options.password);

        if (options.json) {
          console.log(JSON.stringify(w, null, 2));
        } else {
          logger.success("Wallet created");
          logger.log(`  ${chalk.bold("Address:")} ${chalk.cyan(w.address)}`);
          if (w.name) logger.log(`  ${chalk.bold("Name:")}    ${w.name}`);
          logger.log(
            `  ${chalk.bold("Default:")} ${w.isDefault ? chalk.green("yes") : "no"}`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // wallet list
  wallet
    .command("list", { isDefault: true })
    .description("List all wallets")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const wallets = getAllWallets(db);

        if (options.json) {
          console.log(
            JSON.stringify(
              wallets.map((w) => ({
                address: w.address,
                name: w.name,
                balance: w.balance,
                isDefault: w.is_default === 1,
              })),
              null,
              2,
            ),
          );
        } else if (wallets.length === 0) {
          logger.info(
            'No wallets. Create one with "chainlesschain wallet create"',
          );
        } else {
          logger.log(chalk.bold(`Wallets (${wallets.length}):\n`));
          for (const w of wallets) {
            const def = w.is_default ? chalk.green(" [default]") : "";
            const name = w.name ? ` (${w.name})` : "";
            logger.log(`  ${chalk.cyan(w.address)}${name}${def}`);
            logger.log(`    ${chalk.gray(`balance: ${w.balance}`)}`);
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // wallet balance
  wallet
    .command("balance")
    .description("Show wallet balance")
    .argument("<address>", "Wallet address")
    .option("--json", "Output as JSON")
    .action(async (address, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const result = getBalance(db, address);

        if (!result) {
          logger.error(`Wallet not found: ${address}`);
          process.exit(1);
        }

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(
            `  ${chalk.bold("Address:")} ${chalk.cyan(result.address)}`,
          );
          logger.log(
            `  ${chalk.bold("Balance:")} ${chalk.green(result.balance)}`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // wallet set-default
  wallet
    .command("set-default")
    .description("Set a wallet as default")
    .argument("<address>", "Wallet address")
    .action(async (address) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const ok = setDefaultWallet(db, address);

        if (ok) {
          logger.success("Default wallet updated");
        } else {
          logger.error(`Wallet not found: ${address}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // wallet delete
  wallet
    .command("delete")
    .description("Delete a wallet")
    .argument("<address>", "Wallet address")
    .option("--force", "Skip confirmation")
    .action(async (address, options) => {
      try {
        if (!options.force) {
          const { confirm } = await import("@inquirer/prompts");
          const ok = await confirm({
            message: "Delete this wallet? The encrypted key will be lost.",
          });
          if (!ok) {
            logger.info("Cancelled");
            return;
          }
        }

        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const ok = deleteWallet(db, address);

        if (ok) {
          logger.success("Wallet deleted");
        } else {
          logger.error(`Wallet not found: ${address}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // wallet asset
  wallet
    .command("asset")
    .description("Create a digital asset")
    .argument("<name>", "Asset name")
    .option("--address <address>", "Wallet address (default wallet if omitted)")
    .option("--type <type>", "Asset type (token/nft/document)", "token")
    .option("--description <desc>", "Asset description")
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();

        let address = options.address;
        if (!address) {
          const wallets = getAllWallets(db);
          const def = wallets.find((w) => w.is_default === 1);
          if (!def) {
            logger.error("No wallets found. Create one first.");
            process.exit(1);
          }
          address = def.address;
        }

        const asset = createAsset(
          db,
          address,
          options.type,
          name,
          options.description,
        );

        if (options.json) {
          console.log(JSON.stringify(asset, null, 2));
        } else {
          logger.success("Asset created");
          logger.log(`  ${chalk.bold("ID:")}      ${chalk.cyan(asset.id)}`);
          logger.log(`  ${chalk.bold("Name:")}    ${asset.name}`);
          logger.log(`  ${chalk.bold("Type:")}    ${asset.assetType}`);
          logger.log(
            `  ${chalk.bold("Wallet:")}  ${chalk.gray(asset.walletAddress)}`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // wallet assets
  wallet
    .command("assets")
    .description("List digital assets")
    .option("--address <address>", "Filter by wallet address")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const assets = options.address
          ? getAssets(db, options.address)
          : getAllAssets(db);

        if (options.json) {
          console.log(JSON.stringify(assets, null, 2));
        } else if (assets.length === 0) {
          logger.info("No assets found");
        } else {
          logger.log(chalk.bold(`Assets (${assets.length}):\n`));
          for (const a of assets) {
            logger.log(`  ${chalk.cyan(a.id)} - ${a.name} (${a.asset_type})`);
            logger.log(`    ${chalk.gray(`wallet: ${a.wallet_address}`)}`);
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // wallet transfer
  wallet
    .command("transfer")
    .description("Transfer an asset")
    .argument("<asset-id>", "Asset ID to transfer")
    .argument("<to-address>", "Destination wallet address")
    .option("--amount <amount>", "Amount to transfer")
    .action(async (assetId, toAddress, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const tx = transferAsset(db, assetId, toAddress, options.amount);

        logger.success("Transfer complete");
        logger.log(`  ${chalk.bold("TX ID:")} ${chalk.cyan(tx.txId)}`);
        logger.log(`  ${chalk.bold("From:")}  ${chalk.gray(tx.from)}`);
        logger.log(`  ${chalk.bold("To:")}    ${chalk.gray(tx.to)}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // wallet history
  wallet
    .command("history")
    .description("Show transaction history")
    .option("--address <address>", "Filter by wallet address")
    .option("--limit <n>", "Number of transactions", "20")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const txns = getTransactions(db, {
          address: options.address,
          limit: parseInt(options.limit),
        });

        if (options.json) {
          console.log(JSON.stringify(txns, null, 2));
        } else if (txns.length === 0) {
          logger.info("No transactions");
        } else {
          logger.log(chalk.bold(`Transactions (${txns.length}):\n`));
          for (const tx of txns) {
            logger.log(
              `  ${chalk.cyan(tx.id)} ${chalk.bold(tx.tx_type)} ${chalk.gray(tx.created_at)}`,
            );
            logger.log(
              `    ${chalk.gray(`${tx.from_address} → ${tx.to_address}`)}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // wallet summary
  wallet
    .command("summary")
    .description("Show wallet summary statistics")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const summary = getWalletSummary(db);

        if (options.json) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          logger.log(chalk.bold("Wallet Summary:\n"));
          logger.log(`  ${chalk.bold("Wallets:")}      ${summary.walletCount}`);
          logger.log(`  ${chalk.bold("Assets:")}       ${summary.assetCount}`);
          logger.log(
            `  ${chalk.bold("Transactions:")} ${summary.transactionCount}`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  /* ═══ Wallet V2 — in-memory maturity + tx lifecycle ═══ */

  wallet
    .command("maturities-v2")
    .description("List wallet maturity states (V2)")
    .action(() => {
      for (const v of Object.values(WALLET_MATURITY_V2)) console.log(`  ${v}`);
    });

  wallet
    .command("tx-lifecycles-v2")
    .description("List tx lifecycle states (V2)")
    .action(() => {
      for (const v of Object.values(TX_LIFECYCLE_V2)) console.log(`  ${v}`);
    });

  wallet
    .command("stats-v2")
    .description("Show V2 wallet/tx stats")
    .action(() => {
      console.log(JSON.stringify(getWalletManagerStatsV2(), null, 2));
    });

  wallet
    .command("max-active-wallets-per-owner")
    .argument("[n]", "New cap")
    .description("Get/set max active wallets per owner (V2)")
    .action((n) => {
      if (n !== undefined) setMaxActiveWalletsPerOwnerV2(n);
      console.log(getMaxActiveWalletsPerOwnerV2());
    });

  wallet
    .command("max-pending-tx-per-wallet")
    .argument("[n]", "New cap")
    .description("Get/set max pending+submitted tx per wallet (V2)")
    .action((n) => {
      if (n !== undefined) setMaxPendingTxPerWalletV2(n);
      console.log(getMaxPendingTxPerWalletV2());
    });

  wallet
    .command("wallet-idle-ms")
    .argument("[ms]", "New idle window")
    .description("Get/set wallet idle window ms (V2)")
    .action((ms) => {
      if (ms !== undefined) setWalletIdleMsV2(ms);
      console.log(getWalletIdleMsV2());
    });

  wallet
    .command("tx-stuck-ms")
    .argument("[ms]", "New stuck window")
    .description("Get/set tx stuck window ms (V2)")
    .action((ms) => {
      if (ms !== undefined) setTxStuckMsV2(ms);
      console.log(getTxStuckMsV2());
    });

  wallet
    .command("active-wallet-count-v2 <owner>")
    .description("Count active wallets for owner (V2)")
    .action((owner) => {
      console.log(getActiveWalletCountV2(owner));
    });

  wallet
    .command("pending-tx-count-v2 <walletId>")
    .description("Count pending+submitted tx for wallet (V2)")
    .action((walletId) => {
      console.log(getPendingTxCountV2(walletId));
    });

  wallet
    .command("register-wallet-v2 <id>")
    .requiredOption("-o, --owner <owner>", "Owner")
    .requiredOption("-a, --address <address>", "Wallet address")
    .description("Register a new provisional wallet (V2)")
    .action((id, opts) => {
      console.log(
        JSON.stringify(
          registerWalletV2(id, { owner: opts.owner, address: opts.address }),
          null,
          2,
        ),
      );
    });

  wallet
    .command("wallet-v2 <id>")
    .description("Show wallet by id (V2)")
    .action((id) => {
      const w = getWalletV2(id);
      if (!w) {
        console.error(`wallet ${id} not found`);
        process.exit(1);
      }
      console.log(JSON.stringify(w, null, 2));
    });

  wallet
    .command("list-wallets-v2")
    .option("-o, --owner <owner>", "Filter by owner")
    .option("-m, --maturity <m>", "Filter by maturity")
    .description("List wallets (V2)")
    .action((opts) => {
      console.log(
        JSON.stringify(
          listWalletsV2({ owner: opts.owner, maturity: opts.maturity }),
          null,
          2,
        ),
      );
    });

  wallet
    .command("set-wallet-maturity-v2 <id> <next>")
    .description("Transition wallet maturity (V2)")
    .action((id, next) => {
      console.log(JSON.stringify(setWalletMaturityV2(id, next), null, 2));
    });

  wallet
    .command("activate-wallet-v2 <id>")
    .description("Activate wallet (V2)")
    .action((id) => {
      console.log(JSON.stringify(activateWalletV2(id), null, 2));
    });

  wallet
    .command("freeze-wallet-v2 <id>")
    .description("Freeze wallet (V2)")
    .action((id) => {
      console.log(JSON.stringify(freezeWalletV2(id), null, 2));
    });

  wallet
    .command("retire-wallet-v2 <id>")
    .description("Retire wallet terminally (V2)")
    .action((id) => {
      console.log(JSON.stringify(retireWalletV2(id), null, 2));
    });

  wallet
    .command("touch-wallet-v2 <id>")
    .description("Update wallet lastSeenAt (V2)")
    .action((id) => {
      console.log(JSON.stringify(touchWalletV2(id), null, 2));
    });

  wallet
    .command("create-tx-v2 <id>")
    .requiredOption("-w, --wallet <walletId>", "Wallet id")
    .requiredOption("-k, --kind <kind>", "Tx kind")
    .option("-a, --amount <n>", "Amount")
    .description("Create a pending tx (V2)")
    .action((id, opts) => {
      console.log(
        JSON.stringify(
          createTxV2(id, {
            walletId: opts.wallet,
            kind: opts.kind,
            amount: opts.amount,
          }),
          null,
          2,
        ),
      );
    });

  wallet
    .command("tx-v2 <id>")
    .description("Show tx by id (V2)")
    .action((id) => {
      const t = getTxV2(id);
      if (!t) {
        console.error(`tx ${id} not found`);
        process.exit(1);
      }
      console.log(JSON.stringify(t, null, 2));
    });

  wallet
    .command("list-txs-v2")
    .option("-w, --wallet <walletId>", "Filter by walletId")
    .option("-s, --status <s>", "Filter by status")
    .description("List txs (V2)")
    .action((opts) => {
      console.log(
        JSON.stringify(
          listTxsV2({ walletId: opts.wallet, status: opts.status }),
          null,
          2,
        ),
      );
    });

  wallet
    .command("set-tx-status-v2 <id> <next>")
    .description("Transition tx status (V2)")
    .action((id, next) => {
      console.log(JSON.stringify(setTxStatusV2(id, next), null, 2));
    });

  wallet
    .command("submit-tx-v2 <id>")
    .description("Submit tx (V2)")
    .action((id) => {
      console.log(JSON.stringify(submitTxV2(id), null, 2));
    });

  wallet
    .command("confirm-tx-v2 <id>")
    .description("Confirm tx terminally (V2)")
    .action((id) => {
      console.log(JSON.stringify(confirmTxV2(id), null, 2));
    });

  wallet
    .command("fail-tx-v2 <id>")
    .description("Fail tx terminally (V2)")
    .action((id) => {
      console.log(JSON.stringify(failTxV2(id), null, 2));
    });

  wallet
    .command("reject-tx-v2 <id>")
    .description("Reject tx terminally (V2)")
    .action((id) => {
      console.log(JSON.stringify(rejectTxV2(id), null, 2));
    });

  wallet
    .command("auto-retire-idle-wallets")
    .description("Auto-retire non-provisional wallets idle past window (V2)")
    .action(() => {
      console.log(JSON.stringify(autoRetireIdleWalletsV2(), null, 2));
    });

  wallet
    .command("auto-fail-stuck-tx")
    .description("Auto-fail submitted tx stuck past window (V2)")
    .action(() => {
      console.log(JSON.stringify(autoFailStuckTxV2(), null, 2));
    });
}
