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
  HUB_STATUS_V2,
  TRUST_TIER,
  MUTATION_TYPE,
  trustTier,
  setHubStatus,
  listHubsV2,
  buildFederationContext,
  getFederationStatsV2,
} from "../lib/evomap-federation.js";
import {
  ensureEvoMapGovernanceTables,
  registerOwnership,
  traceOwnership,
  createGovernanceProposal,
  voteOnGovernanceProposal,
  getGovernanceDashboard,
  PROPOSAL_STATUS_V2,
  PROPOSAL_TYPE,
  VOTE_DIRECTION,
  createGovernanceProposalV2,
  castVoteV2,
  setProposalStatus,
  executeProposal,
  cancelProposal,
  expireProposalsV2,
  listProposalsV2,
  traceContributions,
  getGovernanceStatsV2,
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

  // ═══════════════════════════════════════════════════════════════
  // V2 Canonical Subcommands (Phase 42)
  // ═══════════════════════════════════════════════════════════════

  federation
    .command("hub-statuses")
    .description("List V2 hub status values")
    .action(() => {
      console.log(JSON.stringify(Object.values(HUB_STATUS_V2), null, 2));
    });

  federation
    .command("trust-tiers")
    .description("List V2 trust tier values")
    .action(() => {
      console.log(JSON.stringify(Object.values(TRUST_TIER), null, 2));
    });

  federation
    .command("mutation-types")
    .description("List V2 mutation types")
    .action(() => {
      console.log(JSON.stringify(Object.values(MUTATION_TYPE), null, 2));
    });

  federation
    .command("trust-tier <score>")
    .description("Classify a trust score as low|medium|high")
    .action((score) => {
      try {
        const num = Number(score);
        console.log(JSON.stringify({ score: num, tier: trustTier(num) }));
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  federation
    .command("set-hub-status <hub-id> <status>")
    .description("Transition a hub's status (V2 state machine)")
    .action(async (hubId, status) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEvoMapFederationTables(db);
        console.log(JSON.stringify(setHubStatus(db, hubId, status), null, 2));
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  federation
    .command("list-hubs-v2")
    .description("List hubs with V2 filters (trust tier, minTrust)")
    .option("--status <status>", "Filter by hub status")
    .option("--region <region>", "Filter by region")
    .option("--min-trust <n>", "Minimum trust score (0-1)")
    .option("--trust-tier <tier>", "Filter by trust tier (low|medium|high)")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEvoMapFederationTables(db);
        const hubs = listHubsV2(db, {
          status: options.status,
          region: options.region,
          minTrust: options.minTrust ? Number(options.minTrust) : undefined,
          trustTier: options.trustTier,
        });
        console.log(JSON.stringify(hubs, null, 2));
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  federation
    .command("context")
    .description("Build federation context for LLM consumption")
    .action(async () => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEvoMapFederationTables(db);
        console.log(JSON.stringify(buildFederationContext(), null, 2));
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  federation
    .command("stats-v2")
    .description("Show V2 federation stats (byStatus/byRegion/byTrustTier)")
    .action(async () => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEvoMapFederationTables(db);
        console.log(JSON.stringify(getFederationStatsV2(), null, 2));
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  gov
    .command("proposal-statuses")
    .description("List V2 proposal status values")
    .action(() => {
      console.log(JSON.stringify(Object.values(PROPOSAL_STATUS_V2), null, 2));
    });

  gov
    .command("proposal-types")
    .description("List V2 proposal type values")
    .action(() => {
      console.log(JSON.stringify(Object.values(PROPOSAL_TYPE), null, 2));
    });

  gov
    .command("vote-directions")
    .description("List V2 vote direction values")
    .action(() => {
      console.log(JSON.stringify(Object.values(VOTE_DIRECTION), null, 2));
    });

  gov
    .command("propose-v2")
    .description("Create a V2 governance proposal with type/quorum/threshold")
    .requiredOption("-t, --title <title>", "Proposal title")
    .option("-d, --description <text>", "Proposal description")
    .option("-p, --proposer <did>", "Proposer DID", "cli-user")
    .option(
      "--type <type>",
      "Proposal type (standard|gene_standard|...)",
      "standard",
    )
    .option("--quorum <n>", "Quorum (min votes)", "3")
    .option("--threshold <n>", "Threshold (0-1)", "0.5")
    .option("--voting-duration-ms <n>", "Voting duration in ms")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEvoMapGovernanceTables(db);
        const p = createGovernanceProposalV2(db, {
          title: options.title,
          description: options.description,
          proposerDid: options.proposer,
          type: options.type,
          quorum: Number(options.quorum),
          threshold: Number(options.threshold),
          votingDurationMs: options.votingDurationMs
            ? Number(options.votingDurationMs)
            : undefined,
        });
        console.log(JSON.stringify(p, null, 2));
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  gov
    .command("vote-v2 <proposal-id> <direction>")
    .description("Cast a weighted V2 vote (for|against|abstain)")
    .option("-v, --voter <did>", "Voter DID", "cli-user")
    .option("-w, --weight <n>", "Vote weight", "1")
    .action(async (proposalId, direction, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEvoMapGovernanceTables(db);
        const r = castVoteV2(db, {
          proposalId,
          voterDid: options.voter,
          direction,
          weight: Number(options.weight),
        });
        console.log(JSON.stringify(r, null, 2));
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  gov
    .command("set-status <proposal-id> <status>")
    .description("Transition a proposal's status (V2 state machine)")
    .action(async (proposalId, status) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEvoMapGovernanceTables(db);
        console.log(
          JSON.stringify(setProposalStatus(db, proposalId, status), null, 2),
        );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  gov
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
        ensureEvoMapGovernanceTables(db);
        console.log(JSON.stringify(executeProposal(db, proposalId), null, 2));
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  gov
    .command("cancel <proposal-id>")
    .description("Cancel a proposal")
    .action(async (proposalId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEvoMapGovernanceTables(db);
        console.log(JSON.stringify(cancelProposal(db, proposalId), null, 2));
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  gov
    .command("expire")
    .description("Bulk-expire active proposals past voting deadline (V2)")
    .action(async () => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEvoMapGovernanceTables(db);
        console.log(JSON.stringify(expireProposalsV2(db), null, 2));
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  gov
    .command("list-v2")
    .description("List proposals with V2 filters")
    .option("--status <status>", "Filter by status")
    .option("--type <type>", "Filter by type")
    .option("--proposer <did>", "Filter by proposer DID")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEvoMapGovernanceTables(db);
        console.log(
          JSON.stringify(
            listProposalsV2(db, {
              status: options.status,
              type: options.type,
              proposerDid: options.proposer,
            }),
            null,
            2,
          ),
        );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  gov
    .command("contributions <gene-id>")
    .description("Trace gene contributions (V2 alias of ownership-trace)")
    .action(async (geneId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEvoMapGovernanceTables(db);
        console.log(JSON.stringify(traceContributions(geneId), null, 2));
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  gov
    .command("stats-v2")
    .description("Show V2 governance stats (byStatus/byType, weight totals)")
    .action(async () => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureEvoMapGovernanceTables(db);
        console.log(JSON.stringify(getGovernanceStatsV2(), null, 2));
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
  registerEvoMapV2Command(evomap);
}

import {
  EVOMAP_MAP_MATURITY_V2,
  EVOMAP_EVOLUTION_LIFECYCLE_V2,
  registerEvoMapV2,
  activateEvoMapV2,
  staleEvoMapV2,
  archiveEvoMapV2,
  touchEvoMapV2,
  getEvoMapV2,
  listEvoMapsV2,
  createEvoEvolutionV2,
  startEvoEvolutionV2,
  completeEvoEvolutionV2,
  failEvoEvolutionV2,
  cancelEvoEvolutionV2,
  getEvoEvolutionV2,
  listEvoEvolutionsV2,
  setMaxActiveEvoMapsPerOwnerV2,
  getMaxActiveEvoMapsPerOwnerV2,
  setMaxPendingEvoEvolutionsPerMapV2,
  getMaxPendingEvoEvolutionsPerMapV2,
  setEvoMapIdleMsV2,
  getEvoMapIdleMsV2,
  setEvoEvolutionStuckMsV2,
  getEvoEvolutionStuckMsV2,
  autoStaleIdleEvoMapsV2,
  autoFailStuckEvoEvolutionsV2,
  getEvoMapManagerStatsV2,
} from "../lib/evomap-manager.js";

export function registerEvoMapV2Command(evomap) {
  evomap
    .command("enums-v2")
    .description("Show V2 governance enums")
    .action(() => {
      console.log(
        JSON.stringify(
          { EVOMAP_MAP_MATURITY_V2, EVOMAP_EVOLUTION_LIFECYCLE_V2 },
          null,
          2,
        ),
      );
    });
  evomap
    .command("register-map-v2")
    .description("Register an evomap profile (pending)")
    .requiredOption("--id <id>")
    .requiredOption("--owner <owner>")
    .option("--name <name>")
    .action((o) => {
      console.log(JSON.stringify(registerEvoMapV2(o), null, 2));
    });
  evomap
    .command("activate-map-v2 <id>")
    .description("Activate map")
    .action((id) => {
      console.log(JSON.stringify(activateEvoMapV2(id), null, 2));
    });
  evomap
    .command("stale-map-v2 <id>")
    .description("Mark map stale")
    .action((id) => {
      console.log(JSON.stringify(staleEvoMapV2(id), null, 2));
    });
  evomap
    .command("archive-map-v2 <id>")
    .description("Archive map (terminal)")
    .action((id) => {
      console.log(JSON.stringify(archiveEvoMapV2(id), null, 2));
    });
  evomap
    .command("touch-map-v2 <id>")
    .description("Refresh lastTouchedAt")
    .action((id) => {
      console.log(JSON.stringify(touchEvoMapV2(id), null, 2));
    });
  evomap
    .command("get-map-v2 <id>")
    .description("Get map")
    .action((id) => {
      console.log(JSON.stringify(getEvoMapV2(id), null, 2));
    });
  evomap
    .command("list-maps-v2")
    .description("List maps")
    .action(() => {
      console.log(JSON.stringify(listEvoMapsV2(), null, 2));
    });
  evomap
    .command("create-evolution-v2")
    .description("Create an evolution (queued)")
    .requiredOption("--id <id>")
    .requiredOption("--map-id <mapId>")
    .option("--strategy <strategy>")
    .action((o) => {
      console.log(
        JSON.stringify(
          createEvoEvolutionV2({
            id: o.id,
            mapId: o.mapId,
            strategy: o.strategy,
          }),
          null,
          2,
        ),
      );
    });
  evomap
    .command("start-evolution-v2 <id>")
    .description("Transition evolution to running")
    .action((id) => {
      console.log(JSON.stringify(startEvoEvolutionV2(id), null, 2));
    });
  evomap
    .command("complete-evolution-v2 <id>")
    .description("Transition evolution to completed")
    .action((id) => {
      console.log(JSON.stringify(completeEvoEvolutionV2(id), null, 2));
    });
  evomap
    .command("fail-evolution-v2 <id>")
    .description("Fail evolution")
    .option("--reason <r>")
    .action((id, o) => {
      console.log(JSON.stringify(failEvoEvolutionV2(id, o.reason), null, 2));
    });
  evomap
    .command("cancel-evolution-v2 <id>")
    .description("Cancel evolution")
    .option("--reason <r>")
    .action((id, o) => {
      console.log(JSON.stringify(cancelEvoEvolutionV2(id, o.reason), null, 2));
    });
  evomap
    .command("get-evolution-v2 <id>")
    .description("Get evolution")
    .action((id) => {
      console.log(JSON.stringify(getEvoEvolutionV2(id), null, 2));
    });
  evomap
    .command("list-evolutions-v2")
    .description("List evolutions")
    .action(() => {
      console.log(JSON.stringify(listEvoEvolutionsV2(), null, 2));
    });
  evomap
    .command("set-max-active-maps-v2 <n>")
    .description("Set per-owner active cap")
    .action((n) => {
      setMaxActiveEvoMapsPerOwnerV2(Number(n));
      console.log(
        JSON.stringify(
          { maxActiveEvoMapsPerOwner: getMaxActiveEvoMapsPerOwnerV2() },
          null,
          2,
        ),
      );
    });
  evomap
    .command("set-max-pending-evolutions-v2 <n>")
    .description("Set per-map pending cap")
    .action((n) => {
      setMaxPendingEvoEvolutionsPerMapV2(Number(n));
      console.log(
        JSON.stringify(
          {
            maxPendingEvoEvolutionsPerMap: getMaxPendingEvoEvolutionsPerMapV2(),
          },
          null,
          2,
        ),
      );
    });
  evomap
    .command("set-map-idle-ms-v2 <n>")
    .description("Set idle threshold")
    .action((n) => {
      setEvoMapIdleMsV2(Number(n));
      console.log(
        JSON.stringify({ evoMapIdleMs: getEvoMapIdleMsV2() }, null, 2),
      );
    });
  evomap
    .command("set-evolution-stuck-ms-v2 <n>")
    .description("Set stuck threshold")
    .action((n) => {
      setEvoEvolutionStuckMsV2(Number(n));
      console.log(
        JSON.stringify(
          { evoEvolutionStuckMs: getEvoEvolutionStuckMsV2() },
          null,
          2,
        ),
      );
    });
  evomap
    .command("auto-stale-idle-maps-v2")
    .description("Auto-stale idle maps")
    .action(() => {
      console.log(JSON.stringify(autoStaleIdleEvoMapsV2(), null, 2));
    });
  evomap
    .command("auto-fail-stuck-evolutions-v2")
    .description("Auto-fail stuck running evolutions")
    .action(() => {
      console.log(JSON.stringify(autoFailStuckEvoEvolutionsV2(), null, 2));
    });
  evomap
    .command("gov-stats-v2")
    .description("V2 governance aggregate stats")
    .action(() => {
      console.log(JSON.stringify(getEvoMapManagerStatsV2(), null, 2));
    });
}

// === Iter20 V2 governance overlay ===
export function registerEvgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "evomap");
  if (!parent) return;
  const L = async () => await import("../lib/evomap-governance.js");
  parent
    .command("evgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.EVGOV_PROFILE_MATURITY_V2,
            proposalLifecycle: m.EVGOV_PROPOSAL_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("evgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveEvgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingEvgovProposalsPerProfileV2(),
            idleMs: m.getEvgovProfileIdleMsV2(),
            stuckMs: m.getEvgovProposalStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("evgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveEvgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("evgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingEvgovProposalsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("evgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setEvgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("evgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setEvgovProposalStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("evgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--lane <v>", "lane")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerEvgovProfileV2({ id, owner, lane: o.lane }),
          null,
          2,
        ),
      );
    });
  parent
    .command("evgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateEvgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("evgov-pause-v2 <id>")
    .description("Pause profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).pauseEvgovProfileV2(id), null, 2));
    });
  parent
    .command("evgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveEvgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("evgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).touchEvgovProfileV2(id), null, 2));
    });
  parent
    .command("evgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getEvgovProfileV2(id), null, 2));
    });
  parent
    .command("evgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listEvgovProfilesV2(), null, 2));
    });
  parent
    .command("evgov-create-proposal-v2 <id> <profileId>")
    .description("Create proposal")
    .option("--topic <v>", "topic")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createEvgovProposalV2({ id, profileId, topic: o.topic }),
          null,
          2,
        ),
      );
    });
  parent
    .command("evgov-reviewing-proposal-v2 <id>")
    .description("Mark proposal as reviewing")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).reviewingEvgovProposalV2(id), null, 2),
      );
    });
  parent
    .command("evgov-complete-proposal-v2 <id>")
    .description("Complete proposal")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeProposalEvgovV2(id), null, 2),
      );
    });
  parent
    .command("evgov-fail-proposal-v2 <id> [reason]")
    .description("Fail proposal")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failEvgovProposalV2(id, reason), null, 2),
      );
    });
  parent
    .command("evgov-cancel-proposal-v2 <id> [reason]")
    .description("Cancel proposal")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelEvgovProposalV2(id, reason), null, 2),
      );
    });
  parent
    .command("evgov-get-proposal-v2 <id>")
    .description("Get proposal")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getEvgovProposalV2(id), null, 2));
    });
  parent
    .command("evgov-list-proposals-v2")
    .description("List proposals")
    .action(async () => {
      console.log(JSON.stringify((await L()).listEvgovProposalsV2(), null, 2));
    });
  parent
    .command("evgov-auto-pause-idle-v2")
    .description("Auto-pause idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoPauseIdleEvgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("evgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck proposals")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckEvgovProposalsV2(), null, 2),
      );
    });
  parent
    .command("evgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getEvomapGovernanceGovStatsV2(), null, 2),
      );
    });
}

// === Iter25 V2 governance overlay ===
export function registerEvfedgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "evomap");
  if (!parent) return;
  const L = async () => await import("../lib/evomap-federation.js");
  parent
    .command("evfedgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.EVFEDGOV_PROFILE_MATURITY_V2,
            syncLifecycle: m.EVFEDGOV_SYNC_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("evfedgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveEvfedgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingEvfedgovSyncsPerProfileV2(),
            idleMs: m.getEvfedgovProfileIdleMsV2(),
            stuckMs: m.getEvfedgovSyncStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("evfedgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveEvfedgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("evfedgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingEvfedgovSyncsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("evfedgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setEvfedgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("evfedgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setEvfedgovSyncStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("evfedgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--hub <v>", "hub")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerEvfedgovProfileV2({ id, owner, hub: o.hub }),
          null,
          2,
        ),
      );
    });
  parent
    .command("evfedgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateEvfedgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("evfedgov-stale-v2 <id>")
    .description("Stale profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).staleEvfedgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("evfedgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveEvfedgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("evfedgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchEvfedgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("evfedgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).getEvfedgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("evfedgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).listEvfedgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("evfedgov-create-sync-v2 <id> <profileId>")
    .description("Create sync")
    .option("--geneId <v>", "geneId")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createEvfedgovSyncV2({ id, profileId, geneId: o.geneId }),
          null,
          2,
        ),
      );
    });
  parent
    .command("evfedgov-syncing-sync-v2 <id>")
    .description("Mark sync as syncing")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).syncingEvfedgovSyncV2(id), null, 2),
      );
    });
  parent
    .command("evfedgov-complete-sync-v2 <id>")
    .description("Complete sync")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeSyncEvfedgovV2(id), null, 2),
      );
    });
  parent
    .command("evfedgov-fail-sync-v2 <id> [reason]")
    .description("Fail sync")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failEvfedgovSyncV2(id, reason), null, 2),
      );
    });
  parent
    .command("evfedgov-cancel-sync-v2 <id> [reason]")
    .description("Cancel sync")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelEvfedgovSyncV2(id, reason), null, 2),
      );
    });
  parent
    .command("evfedgov-get-sync-v2 <id>")
    .description("Get sync")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getEvfedgovSyncV2(id), null, 2));
    });
  parent
    .command("evfedgov-list-syncs-v2")
    .description("List syncs")
    .action(async () => {
      console.log(JSON.stringify((await L()).listEvfedgovSyncsV2(), null, 2));
    });
  parent
    .command("evfedgov-auto-stale-idle-v2")
    .description("Auto-stale idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoStaleIdleEvfedgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("evfedgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck syncs")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckEvfedgovSyncsV2(), null, 2),
      );
    });
  parent
    .command("evfedgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getEvomapFederationGovStatsV2(), null, 2),
      );
    });
}

// === Iter27 V2 governance overlay ===
export function registerEvcligovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "evomap");
  if (!parent) return;
  const L = async () => await import("../lib/evomap-client.js");
  parent
    .command("evcligov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.EVCLIGOV_PROFILE_MATURITY_V2,
            rpcLifecycle: m.EVCLIGOV_RPC_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("evcligov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveEvcligovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingEvcligovRpcsPerProfileV2(),
            idleMs: m.getEvcligovProfileIdleMsV2(),
            stuckMs: m.getEvcligovRpcStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("evcligov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveEvcligovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("evcligov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingEvcligovRpcsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("evcligov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setEvcligovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("evcligov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setEvcligovRpcStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("evcligov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--endpoint <v>", "endpoint")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerEvcligovProfileV2({ id, owner, endpoint: o.endpoint }),
          null,
          2,
        ),
      );
    });
  parent
    .command("evcligov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateEvcligovProfileV2(id), null, 2),
      );
    });
  parent
    .command("evcligov-stale-v2 <id>")
    .description("Stale profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).staleEvcligovProfileV2(id), null, 2),
      );
    });
  parent
    .command("evcligov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveEvcligovProfileV2(id), null, 2),
      );
    });
  parent
    .command("evcligov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchEvcligovProfileV2(id), null, 2),
      );
    });
  parent
    .command("evcligov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).getEvcligovProfileV2(id), null, 2),
      );
    });
  parent
    .command("evcligov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).listEvcligovProfilesV2(), null, 2),
      );
    });
  parent
    .command("evcligov-create-rpc-v2 <id> <profileId>")
    .description("Create rpc")
    .option("--method <v>", "method")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createEvcligovRpcV2({ id, profileId, method: o.method }),
          null,
          2,
        ),
      );
    });
  parent
    .command("evcligov-calling-rpc-v2 <id>")
    .description("Mark rpc as calling")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).callingEvcligovRpcV2(id), null, 2),
      );
    });
  parent
    .command("evcligov-complete-rpc-v2 <id>")
    .description("Complete rpc")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeRpcEvcligovV2(id), null, 2),
      );
    });
  parent
    .command("evcligov-fail-rpc-v2 <id> [reason]")
    .description("Fail rpc")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failEvcligovRpcV2(id, reason), null, 2),
      );
    });
  parent
    .command("evcligov-cancel-rpc-v2 <id> [reason]")
    .description("Cancel rpc")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelEvcligovRpcV2(id, reason), null, 2),
      );
    });
  parent
    .command("evcligov-get-rpc-v2 <id>")
    .description("Get rpc")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getEvcligovRpcV2(id), null, 2));
    });
  parent
    .command("evcligov-list-rpcs-v2")
    .description("List rpcs")
    .action(async () => {
      console.log(JSON.stringify((await L()).listEvcligovRpcsV2(), null, 2));
    });
  parent
    .command("evcligov-auto-stale-idle-v2")
    .description("Auto-stale idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoStaleIdleEvcligovProfilesV2(), null, 2),
      );
    });
  parent
    .command("evcligov-auto-fail-stuck-v2")
    .description("Auto-fail stuck rpcs")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckEvcligovRpcsV2(), null, 2),
      );
    });
  parent
    .command("evcligov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getEvomapClientGovStatsV2(), null, 2),
      );
    });
}

// === Iter28 V2 governance overlay: Emgrgov ===
export function registerEmgrV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "evomap");
  if (!parent) return;
  const L = async () => await import("../lib/evomap-manager.js");
  parent
    .command("emgrgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.EMGRGOV_PROFILE_MATURITY_V2,
            opLifecycle: m.EMGRGOV_OP_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("emgrgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveEmgrProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingEmgrOpsPerProfileV2(),
            idleMs: m.getEmgrProfileIdleMsV2(),
            stuckMs: m.getEmgrOpStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("emgrgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveEmgrProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("emgrgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingEmgrOpsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("emgrgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setEmgrProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("emgrgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setEmgrOpStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("emgrgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--map <v>", "map")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerEmgrProfileV2({ id, owner, map: o.map }),
          null,
          2,
        ),
      );
    });
  parent
    .command("emgrgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateEmgrProfileV2(id), null, 2),
      );
    });
  parent
    .command("emgrgov-stale-v2 <id>")
    .description("Stale profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).staleEmgrProfileV2(id), null, 2));
    });
  parent
    .command("emgrgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveEmgrProfileV2(id), null, 2),
      );
    });
  parent
    .command("emgrgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).touchEmgrProfileV2(id), null, 2));
    });
  parent
    .command("emgrgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getEmgrProfileV2(id), null, 2));
    });
  parent
    .command("emgrgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listEmgrProfilesV2(), null, 2));
    });
  parent
    .command("emgrgov-create-op-v2 <id> <profileId>")
    .description("Create op")
    .option("--opId <v>", "opId")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createEmgrOpV2({ id, profileId, opId: o.opId }),
          null,
          2,
        ),
      );
    });
  parent
    .command("emgrgov-operating-op-v2 <id>")
    .description("Mark op as operating")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).operatingEmgrOpV2(id), null, 2));
    });
  parent
    .command("emgrgov-complete-op-v2 <id>")
    .description("Complete op")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).completeOpEmgrV2(id), null, 2));
    });
  parent
    .command("emgrgov-fail-op-v2 <id> [reason]")
    .description("Fail op")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failEmgrOpV2(id, reason), null, 2),
      );
    });
  parent
    .command("emgrgov-cancel-op-v2 <id> [reason]")
    .description("Cancel op")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelEmgrOpV2(id, reason), null, 2),
      );
    });
  parent
    .command("emgrgov-get-op-v2 <id>")
    .description("Get op")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getEmgrOpV2(id), null, 2));
    });
  parent
    .command("emgrgov-list-ops-v2")
    .description("List ops")
    .action(async () => {
      console.log(JSON.stringify((await L()).listEmgrOpsV2(), null, 2));
    });
  parent
    .command("emgrgov-auto-stale-idle-v2")
    .description("Auto-stale idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoStaleIdleEmgrProfilesV2(), null, 2),
      );
    });
  parent
    .command("emgrgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck ops")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckEmgrOpsV2(), null, 2),
      );
    });
  parent
    .command("emgrgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(JSON.stringify((await L()).getEmgrgovStatsV2(), null, 2));
    });
}
