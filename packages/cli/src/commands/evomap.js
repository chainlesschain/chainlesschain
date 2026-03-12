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
}
