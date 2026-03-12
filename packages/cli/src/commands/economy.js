/**
 * Economy commands
 * chainlesschain economy price|pay|balance|channel|market|trade|nft|revenue|contribute
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureEconomyTables,
  priceService,
  getServicePrice,
  pay,
  getBalance,
  openChannel,
  closeChannel,
  listResource,
  getMarketListings,
  tradeResource,
  mintNFT,
  recordContribution,
  getContributions,
  distributeRevenue,
} from "../lib/agent-economy.js";

export function registerEconomyCommand(program) {
  const economy = program
    .command("economy")
    .description("Agent economy — payments, channels, marketplace, NFTs");

  // economy price
  economy
    .command("price <service-id> <price>")
    .description("Set a service price")
    .action(async (serviceId, price) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEconomyTables(db);

        const result = priceService(db, serviceId, parseFloat(price), {});
        logger.success(
          `Price set for ${chalk.cyan(serviceId)}: ${chalk.bold(result.price)}`,
        );

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // economy pay
  economy
    .command("pay <from> <to> <amount>")
    .description("Make a payment between agents")
    .option("--description <text>", "Payment description")
    .action(async (from, to, amount, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEconomyTables(db);

        const result = pay(
          db,
          from,
          to,
          parseFloat(amount),
          options.description,
        );
        logger.success("Payment complete");
        logger.log(`  ${chalk.bold("Tx ID:")}   ${chalk.cyan(result.txId)}`);
        logger.log(`  ${chalk.bold("From:")}    ${result.from}`);
        logger.log(`  ${chalk.bold("To:")}      ${result.to}`);
        logger.log(`  ${chalk.bold("Amount:")}  ${result.amount}`);
        logger.log(`  ${chalk.bold("Balance:")} ${result.balance}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // economy balance
  economy
    .command("balance <agent-id>")
    .description("Show agent balance")
    .option("--json", "Output as JSON")
    .action(async (agentId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEconomyTables(db);

        const bal = getBalance(agentId);
        if (options.json) {
          console.log(JSON.stringify({ agentId, ...bal }, null, 2));
        } else {
          logger.log(`  ${chalk.bold("Agent:")}   ${chalk.cyan(agentId)}`);
          logger.log(`  ${chalk.bold("Balance:")} ${bal.balance}`);
          logger.log(`  ${chalk.bold("Locked:")}  ${bal.locked}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // economy channel open / close
  const channel = economy
    .command("channel")
    .description("State channel management");

  channel
    .command("open <party-a> <party-b>")
    .description("Open a state channel")
    .option("--deposit <amount>", "Initial deposit from party A", "0")
    .action(async (partyA, partyB, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEconomyTables(db);

        const ch = openChannel(db, partyA, partyB, parseFloat(options.deposit));
        logger.success("Channel opened");
        logger.log(`  ${chalk.bold("ID:")}      ${chalk.cyan(ch.id)}`);
        logger.log(`  ${chalk.bold("Party A:")} ${ch.partyA} (${ch.balanceA})`);
        logger.log(`  ${chalk.bold("Party B:")} ${ch.partyB} (${ch.balanceB})`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  channel
    .command("close <channel-id>")
    .description("Close and settle a state channel")
    .action(async (channelId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEconomyTables(db);

        const ch = closeChannel(db, channelId);
        logger.success("Channel closed and settled");
        logger.log(`  ${chalk.bold("ID:")}      ${chalk.cyan(ch.id)}`);
        logger.log(`  ${chalk.bold("Status:")}  ${ch.status}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // economy market list / browse
  const market = economy.command("market").description("Resource marketplace");

  market
    .command("list <type> <provider> <price> <amount>")
    .description("List a resource on the marketplace")
    .action(async (type, provider, price, amount) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEconomyTables(db);

        const listing = listResource(
          db,
          type,
          provider,
          parseFloat(price),
          parseFloat(amount),
          "unit",
        );
        logger.success("Resource listed");
        logger.log(`  ${chalk.bold("ID:")}       ${chalk.cyan(listing.id)}`);
        logger.log(`  ${chalk.bold("Type:")}     ${listing.resourceType}`);
        logger.log(`  ${chalk.bold("Provider:")} ${listing.provider}`);
        logger.log(`  ${chalk.bold("Price:")}    ${listing.price}`);
        logger.log(`  ${chalk.bold("Available:")} ${listing.available}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  market
    .command("browse")
    .description("Browse marketplace listings")
    .option("--type <filter>", "Filter by resource type")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEconomyTables(db);

        const filter = options.type ? { type: options.type } : undefined;
        const listings = getMarketListings(filter);

        if (options.json) {
          console.log(JSON.stringify(listings, null, 2));
        } else {
          if (listings.length === 0) {
            logger.log("No active listings");
          } else {
            for (const l of listings) {
              logger.log(
                `  ${chalk.cyan(l.id.slice(0, 8))} ${l.resourceType} by ${l.provider} — ${l.price}/${l.unit} (${l.available} avail)`,
              );
            }
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // economy trade
  economy
    .command("trade <listing-id> <buyer> <quantity>")
    .description("Buy a resource from the marketplace")
    .action(async (listingId, buyer, quantity) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEconomyTables(db);

        const result = tradeResource(listingId, buyer, parseFloat(quantity));
        logger.success("Trade complete");
        logger.log(`  ${chalk.bold("Cost:")}      ${result.cost}`);
        logger.log(`  ${chalk.bold("Quantity:")}  ${result.quantity}`);
        logger.log(`  ${chalk.bold("Remaining:")} ${result.remaining}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // economy nft mint
  const nft = economy.command("nft").description("NFT management");

  nft
    .command("mint <owner> <type>")
    .description("Mint a new NFT")
    .option("--metadata <json>", "NFT metadata as JSON")
    .action(async (owner, type, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEconomyTables(db);

        const metadata = options.metadata ? JSON.parse(options.metadata) : {};
        const nftObj = mintNFT(db, owner, type, metadata);
        logger.success("NFT minted");
        logger.log(`  ${chalk.bold("ID:")}    ${chalk.cyan(nftObj.id)}`);
        logger.log(`  ${chalk.bold("Owner:")} ${nftObj.owner}`);
        logger.log(`  ${chalk.bold("Type:")}  ${nftObj.type}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // economy revenue
  economy
    .command("revenue <pool> <agent-ids>")
    .description("Distribute revenue pool (comma-separated agent IDs)")
    .action(async (pool, agentIds) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEconomyTables(db);

        const ids = agentIds.split(",").map((s) => s.trim());
        const results = distributeRevenue(db, parseFloat(pool), ids);
        logger.success(
          `Revenue distributed: ${pool} among ${ids.length} agents`,
        );
        for (const r of results) {
          logger.log(
            `  ${chalk.cyan(r.agentId)}: +${r.share} → ${r.newBalance}`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // economy contribute
  economy
    .command("contribute <agent-id> <type> <value>")
    .description("Record agent contribution")
    .action(async (agentId, type, value) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEconomyTables(db);

        const c = recordContribution(db, agentId, type, parseFloat(value), "");
        logger.success("Contribution recorded");
        logger.log(`  ${chalk.bold("ID:")}    ${chalk.cyan(c.id)}`);
        logger.log(`  ${chalk.bold("Agent:")} ${c.agentId}`);
        logger.log(`  ${chalk.bold("Type:")}  ${c.type}`);
        logger.log(`  ${chalk.bold("Value:")} ${c.value}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
