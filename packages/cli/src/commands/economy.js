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
  // Phase 85 V2
  PAYMENT_TYPE,
  CHANNEL_STATUS,
  RESOURCE_TYPE,
  NFT_STATUS,
  priceServiceV2,
  getPriceModel,
  payV2,
  openChannelV2,
  activateChannel,
  initiateSettlement,
  closeChannelV2,
  disputeChannel,
  listChannelsV2,
  listResourceV2,
  mintNFTV2,
  listNFT,
  buyNFT,
  burnNFT,
  getNFTStatus,
  recordTaskContribution,
  getTaskContributions,
  distributeRevenueV2,
  listDistributions,
  getEconomyStatsV2,
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

  // ═════════════════════════════════════════════════════════════════
  // Phase 85 — Agent Economy 2.0 subcommands
  // ═════════════════════════════════════════════════════════════════

  economy
    .command("payment-types")
    .description("List PAYMENT_TYPE enum values (Phase 85)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const v = Object.values(PAYMENT_TYPE);
      if (options.json) console.log(JSON.stringify(v, null, 2));
      else v.forEach((x) => logger.log(`  ${chalk.cyan(x)}`));
    });

  economy
    .command("channel-statuses")
    .description("List CHANNEL_STATUS enum values (Phase 85)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const v = Object.values(CHANNEL_STATUS);
      if (options.json) console.log(JSON.stringify(v, null, 2));
      else v.forEach((x) => logger.log(`  ${chalk.cyan(x)}`));
    });

  economy
    .command("resource-types")
    .description("List RESOURCE_TYPE enum values (Phase 85)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const v = Object.values(RESOURCE_TYPE);
      if (options.json) console.log(JSON.stringify(v, null, 2));
      else v.forEach((x) => logger.log(`  ${chalk.cyan(x)}`));
    });

  economy
    .command("nft-statuses")
    .description("List NFT_STATUS enum values (Phase 85)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const v = Object.values(NFT_STATUS);
      if (options.json) console.log(JSON.stringify(v, null, 2));
      else v.forEach((x) => logger.log(`  ${chalk.cyan(x)}`));
    });

  economy
    .command("price-v2")
    .description("Set a service price with payment-type model (Phase 85)")
    .argument("<service-id>", "Service ID")
    .argument("<payment-type>", "per_call|per_token|per_minute|flat_rate")
    .argument("<rate>", "Unit rate")
    .option("--json", "Output as JSON")
    .action(async (serviceId, paymentType, rate, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const m = priceServiceV2(db, {
          serviceId,
          paymentType,
          rate: parseFloat(rate),
        });
        if (options.json) console.log(JSON.stringify(m, null, 2));
        else
          logger.log(
            `${chalk.green("✓")} priced ${chalk.cyan(serviceId)} as ${paymentType}@${rate}`,
          );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  economy
    .command("price-get")
    .description("Get a service's price model (Phase 85)")
    .argument("<service-id>", "Service ID")
    .option("--json", "Output as JSON")
    .action(async (serviceId, options) => {
      try {
        await bootstrap({ verbose: program.opts().verbose });
        const m = getPriceModel(serviceId);
        if (options.json) console.log(JSON.stringify(m, null, 2));
        else if (!m) logger.info("No price model.");
        else
          logger.log(
            `${chalk.cyan(m.serviceId)} ${m.paymentType}@${chalk.yellow(m.rate)}`,
          );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  economy
    .command("pay-v2")
    .description(
      "Pay for a priced service (computes amount from usage) (Phase 85)",
    )
    .argument("<from>", "From agent ID")
    .argument("<to>", "To agent ID")
    .argument("<service-id>", "Service ID")
    .option("--tokens <n>", "Token count (for per_token)", parseInt)
    .option("--minutes <n>", "Minute count (for per_minute)", parseFloat)
    .option("--calls <n>", "Call count (for per_call)", parseInt)
    .option("--json", "Output as JSON")
    .action(async (from, to, serviceId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const r = payV2(db, {
          fromAgentId: from,
          toAgentId: to,
          serviceId,
          tokens: options.tokens,
          minutes: options.minutes,
          calls: options.calls,
        });
        if (options.json) console.log(JSON.stringify(r, null, 2));
        else
          logger.log(
            `${chalk.green("✓")} paid ${chalk.yellow(r.amount)} via ${r.paymentType}`,
          );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  economy
    .command("channel-open-v2")
    .description("Open a two-sided channel (Phase 85)")
    .argument("<party-a>", "Party A ID")
    .argument("<party-b>", "Party B ID")
    .option("--deposit-a <n>", "Deposit from party A", parseFloat)
    .option("--deposit-b <n>", "Deposit from party B", parseFloat)
    .option("--json", "Output as JSON")
    .action(async (a, b, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const ch = openChannelV2(db, {
          partyA: a,
          partyB: b,
          depositA: options.depositA || 0,
          depositB: options.depositB || 0,
        });
        if (options.json) console.log(JSON.stringify(ch, null, 2));
        else
          logger.log(
            `${chalk.green("✓")} channel ${chalk.cyan(ch.id)} opened (${ch.balanceA}↔${ch.balanceB})`,
          );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  economy
    .command("channel-activate")
    .description("OPEN → ACTIVE (Phase 85)")
    .argument("<id>", "Channel ID")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const r = activateChannel(db, id);
        if (options.json) console.log(JSON.stringify(r, null, 2));
        else logger.log(`${chalk.green("✓ Active")} ${chalk.cyan(id)}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  economy
    .command("channel-settle")
    .description("ACTIVE → SETTLING with final balances (Phase 85)")
    .argument("<id>", "Channel ID")
    .requiredOption("--final-a <n>", "Final balance A", parseFloat)
    .requiredOption("--final-b <n>", "Final balance B", parseFloat)
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const r = initiateSettlement(db, id, {
          finalBalanceA: options.finalA,
          finalBalanceB: options.finalB,
        });
        if (options.json) console.log(JSON.stringify(r, null, 2));
        else
          logger.log(
            `${chalk.green("✓ Settling")} ${chalk.cyan(id)} a=${r.balanceA} b=${r.balanceB}`,
          );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  economy
    .command("channel-close-v2")
    .description("Close channel and release locked funds (Phase 85)")
    .argument("<id>", "Channel ID")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const r = closeChannelV2(db, id);
        if (options.json) console.log(JSON.stringify(r, null, 2));
        else logger.log(`${chalk.green("✓ Closed")} ${chalk.cyan(id)}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  economy
    .command("channel-dispute")
    .description("Mark channel DISPUTED (Phase 85)")
    .argument("<id>", "Channel ID")
    .option("--reason <r>", "Dispute reason", "dispute")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const r = disputeChannel(db, id, options.reason);
        if (options.json) console.log(JSON.stringify(r, null, 2));
        else
          logger.log(
            `${chalk.red("⚠ Disputed")} ${chalk.cyan(id)} reason=${options.reason}`,
          );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  economy
    .command("channels-v2")
    .description("List channels with optional status/party filter (Phase 85)")
    .option("-s, --status <s>", "Filter by status")
    .option("-p, --party <id>", "Filter by party")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        await bootstrap({ verbose: program.opts().verbose });
        const r = listChannelsV2({
          status: options.status,
          party: options.party,
        });
        if (options.json) console.log(JSON.stringify(r, null, 2));
        else if (r.length === 0) logger.info("No channels.");
        else
          r.forEach((c) =>
            logger.log(
              `  ${chalk.cyan(c.id)}  ${c.partyA}↔${c.partyB}  ${chalk.yellow(c.status)}`,
            ),
          );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  economy
    .command("market-list-v2")
    .description("List a resource with validated RESOURCE_TYPE (Phase 85)")
    .argument("<seller>", "Seller ID")
    .argument("<resource-type>", "compute|storage|model|data|skill")
    .argument("<price>", "Price per unit")
    .option("--name <n>", "Display name")
    .option("--available <n>", "Available quantity", parseInt, 1)
    .option("--json", "Output as JSON")
    .action(async (seller, resourceType, price, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const r = listResourceV2(db, {
          sellerId: seller,
          resourceType,
          price: parseFloat(price),
          name: options.name,
          available: options.available,
        });
        if (options.json) console.log(JSON.stringify(r, null, 2));
        else
          logger.log(
            `${chalk.green("✓")} listing ${chalk.cyan(r.id)} ${resourceType}@${price}`,
          );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  economy
    .command("nft-mint-v2")
    .description("Mint NFT with royalty tracking (Phase 85)")
    .argument("<owner>", "Owner ID")
    .argument("<asset-type>", "Asset type")
    .option("--royalty <pct>", "Royalty percent (0-50)", parseFloat, 0)
    .option("--metadata <json>", "Metadata JSON")
    .option("--json", "Output as JSON")
    .action(async (owner, assetType, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const n = mintNFTV2(db, {
          owner,
          assetType,
          royaltyPercent: options.royalty,
          metadata: options.metadata ? JSON.parse(options.metadata) : {},
        });
        if (options.json) console.log(JSON.stringify(n, null, 2));
        else
          logger.log(
            `${chalk.green("✓ Minted")} ${chalk.cyan(n.id)} ${assetType} royalty=${n.royaltyPercent}%`,
          );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  economy
    .command("nft-list")
    .description("List NFT for sale at a price (Phase 85)")
    .argument("<id>", "NFT ID")
    .argument("<price>", "Listing price")
    .option("--json", "Output as JSON")
    .action(async (id, price, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const r = listNFT(db, id, parseFloat(price));
        if (options.json) console.log(JSON.stringify(r, null, 2));
        else
          logger.log(`${chalk.green("✓ Listed")} ${chalk.cyan(id)}@${price}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  economy
    .command("nft-buy")
    .description("Buy a listed NFT (Phase 85)")
    .argument("<id>", "NFT ID")
    .argument("<buyer>", "Buyer ID")
    .option("--json", "Output as JSON")
    .action(async (id, buyer, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const r = buyNFT(db, id, buyer);
        if (options.json) console.log(JSON.stringify(r, null, 2));
        else
          logger.log(
            `${chalk.green("✓ Sold")} ${chalk.cyan(id)} → ${buyer} for ${r.price} (royalty ${r.royalty})`,
          );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  economy
    .command("nft-burn")
    .description("Burn an NFT (Phase 85)")
    .argument("<id>", "NFT ID")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const r = burnNFT(db, id);
        if (options.json) console.log(JSON.stringify(r, null, 2));
        else logger.log(`${chalk.red("🔥 Burned")} ${chalk.cyan(id)}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  economy
    .command("nft-status")
    .description("Get NFT status (Phase 85)")
    .argument("<id>", "NFT ID")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        await bootstrap({ verbose: program.opts().verbose });
        const s = getNFTStatus(id);
        if (options.json) console.log(JSON.stringify(s, null, 2));
        else if (!s) logger.info("No NFT found.");
        else
          logger.log(
            `${chalk.cyan(id)} ${chalk.yellow(s.status)} royalty=${s.royaltyPercent}%`,
          );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  economy
    .command("contribute-task")
    .description("Record a weighted task contribution (Phase 85)")
    .argument("<task-id>", "Task ID")
    .argument("<agent-id>", "Agent ID")
    .option("--weight <w>", "Weight", parseFloat, 1)
    .option("--json", "Output as JSON")
    .action(async (taskId, agentId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const r = recordTaskContribution(db, {
          taskId,
          agentId,
          weight: options.weight,
        });
        if (options.json) console.log(JSON.stringify(r, null, 2));
        else
          logger.log(
            `${chalk.green("✓")} ${chalk.cyan(agentId)} → ${taskId} weight=${options.weight}`,
          );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  economy
    .command("contributions-task")
    .description("List contributions for a task (Phase 85)")
    .argument("<task-id>", "Task ID")
    .option("--json", "Output as JSON")
    .action(async (taskId, options) => {
      try {
        await bootstrap({ verbose: program.opts().verbose });
        const r = getTaskContributions(taskId);
        if (options.json) console.log(JSON.stringify(r, null, 2));
        else if (r.length === 0) logger.info("No contributions.");
        else
          r.forEach((c) =>
            logger.log(`  ${chalk.cyan(c.agentId)}  weight=${c.weight}`),
          );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  economy
    .command("distribute-v2")
    .description("Distribute revenue across task contributors (Phase 85)")
    .argument("<task-id>", "Task ID")
    .argument("<total>", "Total amount to distribute")
    .option("--json", "Output as JSON")
    .action(async (taskId, total, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const r = distributeRevenueV2(db, { taskId, total: parseFloat(total) });
        if (options.json) console.log(JSON.stringify(r, null, 2));
        else {
          logger.log(chalk.bold(`Distributed ${total} for task ${taskId}:`));
          r.shares.forEach((s) =>
            logger.log(
              `  ${chalk.cyan(s.agentId)}  share=${chalk.yellow(s.share.toFixed(2))}  balance=${s.newBalance.toFixed(2)}`,
            ),
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  economy
    .command("distributions")
    .description("List distribution records (Phase 85)")
    .option("-t, --task <id>", "Filter by task ID")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        await bootstrap({ verbose: program.opts().verbose });
        const r = listDistributions({ taskId: options.task });
        if (options.json) console.log(JSON.stringify(r, null, 2));
        else if (r.length === 0) logger.info("No distributions.");
        else
          r.forEach((d) =>
            logger.log(
              `  ${chalk.cyan(d.id.slice(0, 8))}  task=${d.taskId}  total=${chalk.yellow(d.total)}  shares=${d.shares.length}`,
            ),
          );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  economy
    .command("stats-v2")
    .description("Extended economy stats (Phase 85)")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        await bootstrap({ verbose: program.opts().verbose });
        const s = getEconomyStatsV2();
        if (options.json) console.log(JSON.stringify(s, null, 2));
        else {
          logger.log(chalk.bold("Economy stats (Phase 85):"));
          logger.log(`  accounts: ${chalk.cyan(s.totalAccounts)}`);
          logger.log(`  channels: ${chalk.cyan(s.totalChannels)}`);
          for (const [k, v] of Object.entries(s.channelsByStatus))
            logger.log(`    ${k}: ${v}`);
          logger.log(`  listings: ${chalk.cyan(s.totalListings)}`);
          logger.log(`  NFTs: ${chalk.cyan(s.totalNFTs)}`);
          for (const [k, v] of Object.entries(s.nftByStatus))
            logger.log(`    ${k}: ${v}`);
          logger.log(`  price models: ${chalk.cyan(s.priceModels)}`);
          logger.log(`  distributions: ${chalk.cyan(s.distributions)}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  _registerEconomyV2Commands(economy);
}
function _registerEconomyV2Commands(parent) {
  const L = async () => await import("../lib/agent-economy.js");

  parent.command("enums-v2").description("Show V2 enums (account maturity + tx lifecycle)")
    .action(async () => { const m = await L(); console.log(JSON.stringify({ accountMaturity: m.ECONOMY_ACCOUNT_MATURITY_V2, txLifecycle: m.ECONOMY_TX_LIFECYCLE_V2 }, null, 2)); });
  parent.command("config-v2").description("Show V2 config thresholds")
    .action(async () => { const m = await L(); console.log(JSON.stringify({ maxActiveEconomyAccountsPerHolder: m.getMaxActiveEconomyAccountsPerHolderV2(), maxPendingEconomyTxsPerAccount: m.getMaxPendingEconomyTxsPerAccountV2(), economyAccountIdleMs: m.getEconomyAccountIdleMsV2(), economyTxStuckMs: m.getEconomyTxStuckMsV2() }, null, 2)); });
  parent.command("set-max-active-accounts-v2 <n>").description("Set max active accounts per holder")
    .action(async (n) => { const m = await L(); m.setMaxActiveEconomyAccountsPerHolderV2(Number(n)); console.log("ok"); });
  parent.command("set-max-pending-txs-v2 <n>").description("Set max pending txs per account")
    .action(async (n) => { const m = await L(); m.setMaxPendingEconomyTxsPerAccountV2(Number(n)); console.log("ok"); });
  parent.command("set-account-idle-ms-v2 <n>").description("Set account idle threshold (ms)")
    .action(async (n) => { const m = await L(); m.setEconomyAccountIdleMsV2(Number(n)); console.log("ok"); });
  parent.command("set-tx-stuck-ms-v2 <n>").description("Set tx stuck threshold (ms)")
    .action(async (n) => { const m = await L(); m.setEconomyTxStuckMsV2(Number(n)); console.log("ok"); });

  parent.command("register-account-v2 <id> <holder>").description("Register V2 economy account")
    .option("--currency <c>", "Currency", "CLC").action(async (id, holder, o) => { const m = await L(); console.log(JSON.stringify(m.registerEconomyAccountV2({ id, holder, currency: o.currency }), null, 2)); });
  parent.command("activate-account-v2 <id>").description("Activate account (pending→active or frozen→active)")
    .action(async (id) => { const m = await L(); console.log(JSON.stringify(m.activateEconomyAccountV2(id), null, 2)); });
  parent.command("freeze-account-v2 <id>").description("Freeze account")
    .action(async (id) => { const m = await L(); console.log(JSON.stringify(m.freezeEconomyAccountV2(id), null, 2)); });
  parent.command("close-account-v2 <id>").description("Close account (terminal)")
    .action(async (id) => { const m = await L(); console.log(JSON.stringify(m.closeEconomyAccountV2(id), null, 2)); });
  parent.command("touch-account-v2 <id>").description("Touch account lastTouchedAt")
    .action(async (id) => { const m = await L(); console.log(JSON.stringify(m.touchEconomyAccountV2(id), null, 2)); });
  parent.command("get-account-v2 <id>").description("Get V2 account")
    .action(async (id) => { const m = await L(); console.log(JSON.stringify(m.getEconomyAccountV2(id), null, 2)); });
  parent.command("list-accounts-v2").description("List all V2 accounts")
    .action(async () => { const m = await L(); console.log(JSON.stringify(m.listEconomyAccountsV2(), null, 2)); });

  parent.command("create-tx-v2 <id> <accountId>").description("Create V2 tx (queued)")
    .option("--amount <a>", "Amount", "0").action(async (id, accountId, o) => { const m = await L(); console.log(JSON.stringify(m.createEconomyTxV2({ id, accountId, amount: o.amount }), null, 2)); });
  parent.command("start-tx-v2 <id>").description("Start tx (queued→processing)")
    .action(async (id) => { const m = await L(); console.log(JSON.stringify(m.startEconomyTxV2(id), null, 2)); });
  parent.command("settle-tx-v2 <id>").description("Settle tx (processing→settled)")
    .action(async (id) => { const m = await L(); console.log(JSON.stringify(m.settleEconomyTxV2(id), null, 2)); });
  parent.command("fail-tx-v2 <id> [reason]").description("Fail tx")
    .action(async (id, reason) => { const m = await L(); console.log(JSON.stringify(m.failEconomyTxV2(id, reason), null, 2)); });
  parent.command("cancel-tx-v2 <id> [reason]").description("Cancel tx")
    .action(async (id, reason) => { const m = await L(); console.log(JSON.stringify(m.cancelEconomyTxV2(id, reason), null, 2)); });
  parent.command("get-tx-v2 <id>").description("Get V2 tx")
    .action(async (id) => { const m = await L(); console.log(JSON.stringify(m.getEconomyTxV2(id), null, 2)); });
  parent.command("list-txs-v2").description("List all V2 txs")
    .action(async () => { const m = await L(); console.log(JSON.stringify(m.listEconomyTxsV2(), null, 2)); });

  parent.command("auto-freeze-idle-v2").description("Auto-freeze idle active accounts")
    .action(async () => { const m = await L(); console.log(JSON.stringify(m.autoFreezeIdleEconomyAccountsV2(), null, 2)); });
  parent.command("auto-fail-stuck-v2").description("Auto-fail stuck processing txs")
    .action(async () => { const m = await L(); console.log(JSON.stringify(m.autoFailStuckEconomyTxsV2(), null, 2)); });

  parent.command("gov-stats-v2").description("V2 governance aggregate stats")
    .action(async () => { const m = await L(); console.log(JSON.stringify(m.getAgentEconomyGovStatsV2(), null, 2)); });
}
