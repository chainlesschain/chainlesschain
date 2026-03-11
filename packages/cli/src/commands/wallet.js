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
}
