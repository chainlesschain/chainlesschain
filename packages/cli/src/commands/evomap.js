/**
 * EvoMap commands — gene exchange protocol client
 * chainlesschain evomap search|publish|download|list|hubs
 */

import chalk from "chalk";
import path from "path";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import { EvoMapClient } from "../lib/evomap-client.js";
import { EvoMapManager } from "../lib/evomap-manager.js";
import {
  ensureEvoMapFederationTables,
  listFederatedHubs,
  addFederatedHub,
  syncGenes,
  getPressureReport,
  recombineGenes,
  getLineage,
} from "../lib/evomap-federation.js";
import {
  ensureEvoMapGovernanceTables,
  registerOwnership,
  traceOwnership,
  createGovernanceProposal,
  voteOnGovernanceProposal,
  getGovernanceDashboard,
} from "../lib/evomap-governance.js";

export function registerEvoMapCommand(program) {
  const evomap = program
    .command("evomap")
    .description("EvoMap — gene exchange protocol for agent capabilities");

  // evomap search
  evomap
    .command("search <query>")
    .description("Search for genes on the hub")
    .option("-c, --category <cat>", "Filter by category")
    .option("-n, --limit <n>", "Max results", "20")
    .action(async (query, opts) => {
      try {
        const client = new EvoMapClient();
        logger.info(`Searching for "${query}"...`);
        const results = await client.search(query, {
          category: opts.category,
          limit: parseInt(opts.limit) || 20,
        });

        if (results.length === 0) {
          logger.info("No genes found.");
          return;
        }

        for (const gene of results) {
          logger.log(
            `  ${chalk.cyan(gene.name || gene.id)} v${gene.version || "?"} by ${gene.author || "unknown"}`,
          );
          if (gene.description) {
            logger.log(`    ${chalk.gray(gene.description.substring(0, 80))}`);
          }
          logger.log(
            `    ${chalk.gray(`downloads: ${gene.downloads || 0}  rating: ${gene.rating || "N/A"}`)}`,
          );
        }
        logger.log(`\n${results.length} gene(s) found.`);
      } catch (err) {
        logger.error(`Search failed: ${err.message}`);
      }
    });

  // evomap download
  evomap
    .command("download <geneId>")
    .description("Download a gene from the hub")
    .action(async (geneId) => {
      try {
        const client = new EvoMapClient();
        const ctx = await bootstrap({ verbose: false }).catch(() => ({}));
        const dataDir = process.env.CHAINLESSCHAIN_DATA_DIR || process.cwd();
        const manager = new EvoMapManager({
          genesDir: path.join(dataDir, "evomap", "genes"),
          db: ctx.db || null,
        });

        logger.info(`Downloading gene ${geneId}...`);
        const data = await client.download(geneId);
        manager.saveGene(data.gene || data, data.content || "");
        logger.success(`Gene ${geneId} installed.`);

        await shutdown().catch(() => {});
      } catch (err) {
        logger.error(`Download failed: ${err.message}`);
      }
    });

  // evomap publish
  evomap
    .command("publish")
    .description("Publish a gene to the hub")
    .requiredOption("--name <name>", "Gene name")
    .option("--description <desc>", "Gene description")
    .option("--category <cat>", "Gene category")
    .option("--content <content>", "Gene content (or pipe stdin)")
    .option("--author <author>", "Author name")
    .action(async (opts) => {
      try {
        const client = new EvoMapClient();
        const manager = new EvoMapManager({ genesDir: "" });

        const gene = manager.packageGene({
          name: opts.name,
          description: opts.description,
          category: opts.category,
          content: opts.content || "",
          author: opts.author,
        });

        logger.info(`Publishing gene "${opts.name}"...`);
        await client.publish(gene);
        logger.success(`Gene ${gene.id} published.`);
      } catch (err) {
        logger.error(`Publish failed: ${err.message}`);
      }
    });

  // evomap list
  evomap
    .command("list")
    .description("List locally installed genes")
    .action(async () => {
      try {
        const ctx = await bootstrap({ verbose: false }).catch(() => ({}));
        const dataDir = process.env.CHAINLESSCHAIN_DATA_DIR || process.cwd();
        const manager = new EvoMapManager({
          genesDir: path.join(dataDir, "evomap", "genes"),
          db: ctx.db || null,
        });
        manager.initialize();

        const genes = manager.listGenes();
        if (genes.length === 0) {
          logger.info(
            "No genes installed. Use `evomap download <id>` to install.",
          );
          return;
        }

        for (const gene of genes) {
          logger.log(
            `  ${chalk.cyan(gene.name || gene.id)} v${gene.version || "?"} [${gene.category || "general"}]`,
          );
          if (gene.description) {
            logger.log(`    ${chalk.gray(gene.description.substring(0, 80))}`);
          }
        }
        logger.log(`\n${genes.length} gene(s) installed.`);

        await shutdown().catch(() => {});
      } catch (err) {
        logger.error(`List failed: ${err.message}`);
      }
    });

  // evomap hubs
  evomap
    .command("hubs")
    .description("List configured EvoMap hubs")
    .action(async () => {
      try {
        const client = new EvoMapClient();
        const hubs = await client.listHubs();
        for (const hub of hubs) {
          logger.log(
            `  ${chalk.cyan(hub.url)} — ${hub.status || hub.name || "active"}`,
          );
        }
      } catch (err) {
        logger.error(`Hub list failed: ${err.message}`);
      }
    });

  // ── Federation subcommands ──────────────────────────────────

  const federation = evomap
    .command("federation")
    .description("Federated hub management and gene syncing");

  federation
    .command("list-hubs")
    .description("List federated hubs")
    .option("--status <status>", "Filter by status")
    .option("--region <region>", "Filter by region")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEvoMapFederationTables(db);

        const hubs = listFederatedHubs(db, {
          status: options.status,
          region: options.region,
        });
        if (options.json) {
          console.log(JSON.stringify(hubs, null, 2));
        } else if (hubs.length === 0) {
          logger.info(
            "No federated hubs. Use `evomap federation add-hub` to add one.",
          );
        } else {
          for (const h of hubs) {
            logger.log(
              `  ${chalk.cyan(h.id.slice(0, 8))} ${h.hubUrl} [${h.status}] region=${h.region} genes=${h.geneCount} trust=${h.trustScore.toFixed(2)}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  federation
    .command("add-hub <url>")
    .description("Add a federated hub")
    .option("-n, --name <name>", "Hub name")
    .option("-r, --region <region>", "Hub region", "global")
    .action(async (url, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEvoMapFederationTables(db);

        const hub = addFederatedHub(db, url, options.name, options.region);
        logger.success("Hub added");
        logger.log(`  ${chalk.bold("ID:")}     ${chalk.cyan(hub.id)}`);
        logger.log(`  ${chalk.bold("URL:")}    ${hub.hubUrl}`);
        logger.log(`  ${chalk.bold("Region:")} ${hub.region}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  federation
    .command("sync <hub-id>")
    .description("Sync genes with a federated hub")
    .option("--gene-ids <ids>", "Comma-separated gene IDs to sync")
    .action(async (hubId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEvoMapFederationTables(db);

        const geneIds = options.geneIds
          ? options.geneIds.split(",").map((s) => s.trim())
          : [];
        const result = syncGenes(db, hubId, geneIds);
        logger.success(
          `Synced ${result.synced} gene(s) with hub ${chalk.cyan(hubId.slice(0, 8))}`,
        );

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  federation
    .command("pressure")
    .description("Show evolutionary pressure report")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEvoMapFederationTables(db);

        const report = getPressureReport();
        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          logger.log(`  ${chalk.bold("Total Genes:")}    ${report.totalGenes}`);
          logger.log(
            `  ${chalk.bold("Avg Fitness:")}    ${report.avgFitness.toFixed(3)}`,
          );
          logger.log(
            `  ${chalk.bold("Max Generation:")} ${report.maxGeneration}`,
          );
          logger.log(`  ${chalk.bold("Mutations:")}      ${report.mutations}`);
          logger.log(
            `  ${chalk.bold("Recombinations:")} ${report.recombinations}`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  federation
    .command("recombine <gene-id-1> <gene-id-2>")
    .description("Recombine two genes to create offspring")
    .action(async (geneId1, geneId2) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEvoMapFederationTables(db);

        const entry = recombineGenes(db, geneId1, geneId2);
        logger.success("Genes recombined");
        logger.log(
          `  ${chalk.bold("Child Gene:")}  ${chalk.cyan(entry.geneId)}`,
        );
        logger.log(`  ${chalk.bold("Parent 1:")}    ${entry.parentGeneId}`);
        logger.log(
          `  ${chalk.bold("Parent 2:")}    ${entry.recombinationSource}`,
        );
        logger.log(`  ${chalk.bold("Generation:")}  ${entry.generation}`);
        logger.log(
          `  ${chalk.bold("Fitness:")}     ${entry.fitnessScore.toFixed(3)}`,
        );

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  federation
    .command("lineage <gene-id>")
    .description("Show gene lineage and ancestry")
    .option("--json", "Output as JSON")
    .action(async (geneId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEvoMapFederationTables(db);

        const entries = getLineage(geneId);
        if (options.json) {
          console.log(JSON.stringify(entries, null, 2));
        } else if (entries.length === 0) {
          logger.info("No lineage found for this gene.");
        } else {
          for (const e of entries) {
            logger.log(
              `  ${chalk.cyan(e.id.slice(0, 8))} gene=${e.geneId.slice(0, 8)} gen=${e.generation} fitness=${e.fitnessScore.toFixed(2)} type=${e.mutationType}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ── Governance subcommands ──────────────────────────────────

  const gov = evomap
    .command("gov")
    .description("EvoMap governance — ownership, proposals, voting");

  gov
    .command("ownership-register <gene-id> <owner-did>")
    .description("Register gene ownership")
    .action(async (geneId, ownerDid) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEvoMapGovernanceTables(db);

        const result = registerOwnership(db, geneId, ownerDid);
        logger.success("Ownership registered");
        logger.log(`  ${chalk.bold("ID:")}    ${chalk.cyan(result.id)}`);
        logger.log(`  ${chalk.bold("Gene:")}  ${result.geneId}`);
        logger.log(`  ${chalk.bold("Owner:")} ${result.ownerDid}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  gov
    .command("ownership-trace <gene-id>")
    .description("Trace gene ownership and contributions")
    .option("--json", "Output as JSON")
    .action(async (geneId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEvoMapGovernanceTables(db);

        const result = traceOwnership(geneId);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(`  ${chalk.bold("Gene:")}         ${result.geneId}`);
          logger.log(
            `  ${chalk.bold("Owner:")}        ${result.owner || "N/A"}`,
          );
          logger.log(
            `  ${chalk.bold("Contributors:")} ${result.contributors.join(", ") || "N/A"}`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  gov
    .command("propose <title>")
    .description("Create a governance proposal")
    .option("-d, --description <text>", "Proposal description")
    .option("-p, --proposer <did>", "Proposer DID", "cli-user")
    .action(async (title, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEvoMapGovernanceTables(db);

        const result = createGovernanceProposal(
          db,
          title,
          options.description,
          options.proposer,
        );
        logger.success("Proposal created");
        logger.log(`  ${chalk.bold("ID:")}     ${chalk.cyan(result.id)}`);
        logger.log(`  ${chalk.bold("Title:")}  ${result.title}`);
        logger.log(`  ${chalk.bold("Status:")} ${result.status}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  gov
    .command("vote <proposal-id> <direction>")
    .description('Vote on a governance proposal ("for" or "against")')
    .option("-v, --voter <did>", "Voter DID", "cli-user")
    .action(async (proposalId, direction, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEvoMapGovernanceTables(db);

        const result = voteOnGovernanceProposal(
          db,
          proposalId,
          options.voter,
          direction,
        );
        logger.success("Vote recorded");
        logger.log(`  ${chalk.bold("Proposal:")}    ${result.proposalId}`);
        logger.log(`  ${chalk.bold("Direction:")}   ${result.vote}`);
        logger.log(`  ${chalk.bold("Total Votes:")} ${result.totalVotes}`);
        logger.log(`  ${chalk.bold("Status:")}      ${result.status}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  gov
    .command("dashboard")
    .description("Show governance dashboard")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEvoMapGovernanceTables(db);

        const result = getGovernanceDashboard();
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(
            `  ${chalk.bold("Total Proposals:")} ${result.totalProposals}`,
          );
          logger.log(`  ${chalk.bold("Active:")}          ${result.active}`);
          logger.log(`  ${chalk.bold("Passed:")}          ${result.passed}`);
          logger.log(`  ${chalk.bold("Rejected:")}        ${result.rejected}`);
          logger.log(`  ${chalk.bold("Executed:")}        ${result.executed}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
