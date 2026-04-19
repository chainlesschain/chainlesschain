/**
 * Hierarchical Memory 2.0 commands
 * chainlesschain hmemory store|recall|consolidate|search|stats|share|prune
 */

import chalk from "chalk";
import ora from "ora";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  storeMemory,
  recallMemory,
  consolidateMemory,
  searchEpisodic,
  searchSemantic,
  getMemoryStats,
  shareMemory,
  pruneMemory,
  // Phase 83 V2
  MEMORY_LAYER,
  MEMORY_TYPE,
  CONSOLIDATION_STATUS,
  SHARE_PERMISSION,
  attachMetadata,
  promoteMemoryV2,
  demoteMemoryV2,
  shareMemoryV2,
  revokeShare,
  listShares,
  searchEpisodicV2,
  searchSemanticV2,
  consolidateV2,
  listConsolidations,
  pruneV2,
  getStatsV2,
} from "../lib/hierarchical-memory.js";

export function registerHmemoryCommand(program) {
  const hmemory = program
    .command("hmemory")
    .description("Hierarchical Memory 2.0 — four-layer memory system");

  // hmemory store <content>
  hmemory
    .command("store")
    .description("Store a memory at the appropriate layer")
    .argument("<content>", "Memory content")
    .option("--importance <n>", "Importance 0.0-1.0", "0.5")
    .option("--type <type>", "Memory type (episodic|semantic)", "episodic")
    .option("--core", "Force store as core memory (importance=1.0)")
    .option("--json", "Output as JSON")
    .action(async (content, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const importance = options.core
          ? 1.0
          : parseFloat(options.importance) || 0.5;
        const entry = storeMemory(db, content, {
          importance,
          type: options.type,
        });

        if (options.json) {
          console.log(JSON.stringify(entry, null, 2));
        } else {
          logger.success(
            `Memory stored: ${chalk.gray(entry.id.slice(0, 16))} → ${chalk.cyan(entry.layer)}`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hmemory recall <query>
  hmemory
    .command("recall")
    .description("Recall memories with forgetting curve")
    .argument("<query>", "Search query")
    .option("-n, --limit <n>", "Max results", "20")
    .option("--json", "Output as JSON")
    .action(async (query, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const results = recallMemory(db, query, {
          limit: parseInt(options.limit) || 20,
        });

        if (options.json) {
          console.log(JSON.stringify(results, null, 2));
        } else if (results.length === 0) {
          logger.info(`No memories matching "${query}" above recall threshold`);
        } else {
          logger.log(chalk.bold(`Recalled ${results.length} memories:\n`));
          for (const r of results) {
            const retention = (r.retention * 100).toFixed(0);
            logger.log(
              `  ${chalk.gray(r.id.slice(0, 16))} [${chalk.cyan(r.layer)}] retention=${chalk.yellow(retention + "%")}`,
            );
            logger.log(
              `    ${chalk.white(r.content.substring(0, 120).replace(/\n/g, " "))}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hmemory consolidate
  hmemory
    .command("consolidate")
    .description("Promote and forget memories across layers")
    .action(async () => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const spinner = ora("Consolidating memories...").start();
        const result = consolidateMemory(db);
        spinner.succeed(
          `Consolidation complete: ${chalk.green(result.promoted)} promoted, ${chalk.red(result.forgotten)} forgotten`,
        );

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hmemory search <query>
  hmemory
    .command("search")
    .description("Search memories by type")
    .argument("<query>", "Search query")
    .option("--type <type>", "Memory type (episodic|semantic)", "episodic")
    .option("-n, --limit <n>", "Max results", "20")
    .option("--json", "Output as JSON")
    .action(async (query, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const searchFn =
          options.type === "semantic" ? searchSemantic : searchEpisodic;
        const results = searchFn(db, query, {
          limit: parseInt(options.limit) || 20,
        });

        if (options.json) {
          console.log(JSON.stringify(results, null, 2));
        } else if (results.length === 0) {
          logger.info(`No ${options.type} memories matching "${query}"`);
        } else {
          logger.log(
            chalk.bold(`${options.type} search (${results.length} results):\n`),
          );
          for (const r of results) {
            logger.log(
              `  ${chalk.gray(r.id.slice(0, 16))} [${chalk.cyan(r.layer)}] importance=${chalk.yellow(r.importance)}`,
            );
            logger.log(
              `    ${chalk.white(r.content.substring(0, 120).replace(/\n/g, " "))}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hmemory stats
  hmemory
    .command("stats")
    .description("Show memory statistics")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const stats = getMemoryStats(db);

        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          logger.log(chalk.bold("Hierarchical Memory Stats:\n"));
          logger.log(`  Working:    ${chalk.yellow(stats.working)}`);
          logger.log(`  Short-term: ${chalk.yellow(stats.shortTerm)}`);
          logger.log(`  Long-term:  ${chalk.yellow(stats.longTerm)}`);
          logger.log(`  Core:       ${chalk.yellow(stats.core)}`);
          logger.log(`  Shared:     ${chalk.yellow(stats.shared)}`);
          logger.log(
            `  ${chalk.bold("Total:")}      ${chalk.green(stats.total)}`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hmemory share <id> <agent-id>
  hmemory
    .command("share")
    .description("Share a memory with another agent")
    .argument("<id>", "Memory ID")
    .argument("<agent-id>", "Target agent ID")
    .option("--privacy <level>", "Privacy level (full|filtered)", "filtered")
    .option("--json", "Output as JSON")
    .action(async (id, agentId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const result = shareMemory(db, id, agentId, options.privacy);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success(
            `Memory ${chalk.gray(id.slice(0, 16))} shared with ${chalk.cyan(agentId)} [${options.privacy}]`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hmemory prune
  hmemory
    .command("prune")
    .description("Remove weak old memories")
    .option("--max-age <hours>", "Maximum age in hours", "720")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const spinner = ora("Pruning stale memories...").start();
        const result = pruneMemory(db, { maxAge: options.maxAge });
        spinner.succeed(`Pruned ${chalk.red(result.pruned)} stale memories`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ═════════════════════════════════════════════════════════════
  // Phase 83 — Hierarchical Memory 2.0 subcommands
  // ═════════════════════════════════════════════════════════════

  // hmemory layers
  hmemory
    .command("layers")
    .description("List MEMORY_LAYER enum values")
    .option("--json", "Output as JSON")
    .action((options) => {
      const layers = Object.values(MEMORY_LAYER);
      if (options.json) console.log(JSON.stringify(layers, null, 2));
      else for (const l of layers) logger.log(`  ${chalk.cyan(l)}`);
    });

  // hmemory types
  hmemory
    .command("types")
    .description("List MEMORY_TYPE enum values")
    .option("--json", "Output as JSON")
    .action((options) => {
      const types = Object.values(MEMORY_TYPE);
      if (options.json) console.log(JSON.stringify(types, null, 2));
      else for (const t of types) logger.log(`  ${chalk.cyan(t)}`);
    });

  // hmemory statuses
  hmemory
    .command("statuses")
    .description("List CONSOLIDATION_STATUS enum values")
    .option("--json", "Output as JSON")
    .action((options) => {
      const sts = Object.values(CONSOLIDATION_STATUS);
      if (options.json) console.log(JSON.stringify(sts, null, 2));
      else for (const s of sts) logger.log(`  ${chalk.cyan(s)}`);
    });

  // hmemory permissions
  hmemory
    .command("permissions")
    .description("List SHARE_PERMISSION enum values")
    .option("--json", "Output as JSON")
    .action((options) => {
      const ps = Object.values(SHARE_PERMISSION);
      if (options.json) console.log(JSON.stringify(ps, null, 2));
      else for (const p of ps) logger.log(`  ${chalk.cyan(p)}`);
    });

  // hmemory attach-metadata <id>
  hmemory
    .command("attach-metadata <id>")
    .description("Attach V2 metadata (scene/context/concepts) to a memory")
    .option("--scene <s>", "Scene tag")
    .option("--context <c>", "Context description")
    .option("--concepts <c1,c2>", "Comma-separated concept tags")
    .option("--agent-id <id>", "Associated agent ID")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        await bootstrap({ verbose: program.opts().verbose });
        const meta = {};
        if (options.scene) meta.scene = options.scene;
        if (options.context) meta.context = options.context;
        if (options.concepts)
          meta.concepts = options.concepts
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        if (options.agentId) meta.agentId = options.agentId;

        const result = attachMetadata(id, meta);
        if (options.json) console.log(JSON.stringify(result, null, 2));
        else
          logger.success(
            `Metadata attached to ${chalk.gray(id.slice(0, 16))}: ${chalk.cyan(Object.keys(meta).join(","))}`,
          );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hmemory promote-v2 <id>
  hmemory
    .command("promote-v2 <id>")
    .description("Promote memory one layer up (working→short-term→long-term)")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const result = promoteMemoryV2(db, id);
        if (options.json) console.log(JSON.stringify(result, null, 2));
        else
          logger.success(
            `Promoted: ${chalk.gray(id.slice(0, 16))} ${chalk.yellow(result.from)} → ${chalk.cyan(result.to)}`,
          );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hmemory demote-v2 <id>
  hmemory
    .command("demote-v2 <id>")
    .description("Demote memory one layer down (short-term → working)")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        await bootstrap({ verbose: program.opts().verbose });
        const result = demoteMemoryV2(id);
        if (options.json) console.log(JSON.stringify(result, null, 2));
        else
          logger.success(
            `Demoted: ${chalk.gray(id.slice(0, 16))} ${chalk.yellow(result.from)} → ${chalk.cyan(result.to)}`,
          );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hmemory share-v2 <id> <target>
  hmemory
    .command("share-v2 <id> <target>")
    .description("Share a memory with permissions (read,copy,modify)")
    .option("--source <agent>", "Source agent ID", "local")
    .option("--permissions <p1,p2>", "Comma-separated perms", "read")
    .option("--json", "Output as JSON")
    .action(async (id, target, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const perms = options.permissions
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const record = shareMemoryV2(db, {
          memoryId: id,
          sourceAgent: options.source,
          targetAgent: target,
          permissions: perms,
        });
        if (options.json) console.log(JSON.stringify(record, null, 2));
        else
          logger.success(
            `Shared ${chalk.gray(id.slice(0, 16))} → ${chalk.cyan(target)} [${perms.join(",")}]`,
          );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hmemory revoke-share <shareId>
  hmemory
    .command("revoke-share <shareId>")
    .description("Revoke a sharing record")
    .option("--json", "Output as JSON")
    .action(async (shareId, options) => {
      try {
        await bootstrap({ verbose: program.opts().verbose });
        const record = revokeShare(shareId);
        if (options.json) console.log(JSON.stringify(record, null, 2));
        else
          logger.success(
            `Revoked ${chalk.gray(shareId.slice(0, 20))} at ${record.revokedAt}`,
          );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hmemory shares
  hmemory
    .command("shares")
    .description("List V2 sharing records")
    .option("--memory-id <id>", "Filter by memoryId")
    .option("--target <agent>", "Filter by targetAgent")
    .option("--active-only", "Only active (non-revoked) shares")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        await bootstrap({ verbose: program.opts().verbose });
        const shares = listShares({
          memoryId: options.memoryId,
          targetAgent: options.target,
          activeOnly: options.activeOnly,
        });
        if (options.json) console.log(JSON.stringify(shares, null, 2));
        else if (shares.length === 0) logger.info("No shares matching filters");
        else {
          for (const s of shares) {
            const status = s.revokedAt
              ? chalk.red("revoked")
              : chalk.green("active");
            logger.log(
              `  ${chalk.gray(s.id.slice(0, 16))} ${chalk.cyan(s.memoryId)} → ${s.targetAgent} [${s.permissions.join(",")}] (${status})`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hmemory search-episodic-v2
  hmemory
    .command("search-episodic-v2 [query]")
    .description("Search episodic memories with time/scene/context filters")
    .option("--from <iso>", "Time range start (ISO)")
    .option("--to <iso>", "Time range end (ISO)")
    .option("--scene <s>", "Filter by scene metadata")
    .option("--context <c>", "Filter by context substring")
    .option("-n, --limit <n>", "Max results", "20")
    .option("--json", "Output as JSON")
    .action(async (query, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const timeRange =
          options.from || options.to
            ? { from: options.from, to: options.to }
            : null;
        const results = searchEpisodicV2(db, {
          query,
          timeRange,
          scene: options.scene,
          context: options.context,
          limit: parseInt(options.limit) || 20,
        });
        if (options.json) console.log(JSON.stringify(results, null, 2));
        else if (results.length === 0) logger.info("No episodic matches");
        else {
          logger.log(chalk.bold(`Episodic V2 results (${results.length}):\n`));
          for (const r of results) {
            const meta = r.metadata
              ? ` {scene=${r.metadata.scene || "-"}}`
              : "";
            logger.log(
              `  ${chalk.gray(r.id.slice(0, 16))} [${chalk.cyan(r.layer)}]${meta}`,
            );
            logger.log(`    ${chalk.white(r.content.slice(0, 100))}`);
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hmemory search-semantic-v2
  hmemory
    .command("search-semantic-v2 [query]")
    .description("Search semantic memories with concept similarity")
    .option("--concepts <c1,c2>", "Comma-separated concept tags")
    .option("--similarity <n>", "Similarity threshold 0..1", "0")
    .option("-n, --limit <n>", "Max results", "20")
    .option("--json", "Output as JSON")
    .action(async (query, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const concepts = options.concepts
          ? options.concepts
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
        const results = searchSemanticV2(db, {
          query,
          concepts,
          similarityThreshold: parseFloat(options.similarity) || 0,
          limit: parseInt(options.limit) || 20,
        });
        if (options.json) console.log(JSON.stringify(results, null, 2));
        else if (results.length === 0) logger.info("No semantic matches");
        else {
          logger.log(chalk.bold(`Semantic V2 results (${results.length}):\n`));
          for (const r of results) {
            const sim = (r.similarity * 100).toFixed(0);
            logger.log(
              `  ${chalk.gray(r.id.slice(0, 16))} [${chalk.cyan(r.layer)}] sim=${chalk.yellow(sim + "%")}`,
            );
            logger.log(`    ${chalk.white(r.content.slice(0, 100))}`);
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hmemory consolidate-v2
  hmemory
    .command("consolidate-v2")
    .description("Run V2 consolidation with status tracking")
    .option("--extract-patterns", "Snapshot patterns from short-term")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const record = consolidateV2(db, {
          extractPatterns: options.extractPatterns,
        });
        if (options.json) console.log(JSON.stringify(record, null, 2));
        else {
          const color = record.status === "completed" ? chalk.green : chalk.red;
          logger.log(
            `${color(record.status)} — promoted=${record.promoted} forgotten=${record.forgotten} patterns=${record.patterns.length}`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hmemory consolidations
  hmemory
    .command("consolidations")
    .description("List V2 consolidation run history")
    .option("--status <s>", "Filter by status")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        await bootstrap({ verbose: program.opts().verbose });
        const records = listConsolidations({ status: options.status });
        if (options.json) console.log(JSON.stringify(records, null, 2));
        else if (records.length === 0) logger.info("No consolidation history");
        else
          for (const r of records) {
            logger.log(
              `  ${chalk.gray(r.id.slice(0, 20))} [${chalk.cyan(r.status)}] promoted=${r.promoted} forgotten=${r.forgotten}`,
            );
          }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hmemory prune-v2
  hmemory
    .command("prune-v2")
    .description("Layer-scoped prune with custom threshold")
    .option("--layer <l>", "working | short-term | long-term")
    .option("--max-age <hours>", "Max age hours for long-term", "720")
    .option("--threshold <n>", "Retention threshold override 0..1")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const result = pruneV2(db, {
          layer: options.layer,
          maxAge: parseFloat(options.maxAge) || 720,
          threshold:
            options.threshold !== undefined
              ? parseFloat(options.threshold)
              : undefined,
        });
        if (options.json) console.log(JSON.stringify(result, null, 2));
        else
          logger.success(
            `Pruned ${chalk.red(result.pruned)} from layer=${chalk.cyan(result.layer)}`,
          );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hmemory stats-v2
  hmemory
    .command("stats-v2")
    .description("Extended V2 stats with per-layer + consolidation + shares")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const stats = getStatsV2(db);
        if (options.json) console.log(JSON.stringify(stats, null, 2));
        else {
          logger.log(chalk.bold("Hierarchical Memory 2.0 Stats:\n"));
          logger.log(`  Per-layer:`);
          for (const [l, n] of Object.entries(stats.perLayer)) {
            logger.log(`    ${chalk.cyan(l.padEnd(12))} ${chalk.yellow(n)}`);
          }
          logger.log(`  Consolidations: total=${stats.consolidation.total}`);
          for (const [k, v] of Object.entries(
            stats.consolidation.byStatus || {},
          )) {
            logger.log(`    ${chalk.cyan(k.padEnd(12))} ${chalk.yellow(v)}`);
          }
          logger.log(
            `  Shares: total=${stats.shares.total} active=${chalk.green(stats.shares.active)} revoked=${chalk.red(stats.shares.revoked)}`,
          );
          logger.log(
            `  Metadata entries: ${chalk.yellow(stats.metadataEntries)}`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  _registerHmemoryV2Commands(hmemory);
}
function _registerHmemoryV2Commands(parent) {
  const L = async () => await import("../lib/hierarchical-memory.js");

  parent.command("enums-v2").description("Show V2 enums (tier maturity + promotion lifecycle)")
    .action(async () => { const m = await L(); console.log(JSON.stringify({ tierMaturity: m.HMEM_TIER_MATURITY_V2, promotionLifecycle: m.HMEM_PROMOTION_LIFECYCLE_V2 }, null, 2)); });
  parent.command("config-v2").description("Show V2 config thresholds")
    .action(async () => { const m = await L(); console.log(JSON.stringify({ maxActiveHmemTiersPerOwner: m.getMaxActiveHmemTiersPerOwnerV2(), maxPendingHmemPromotionsPerTier: m.getMaxPendingHmemPromotionsPerTierV2(), hmemTierIdleMs: m.getHmemTierIdleMsV2(), hmemPromotionStuckMs: m.getHmemPromotionStuckMsV2() }, null, 2)); });
  parent.command("set-max-active-tiers-v2 <n>").description("Set max active tiers per owner")
    .action(async (n) => { const m = await L(); m.setMaxActiveHmemTiersPerOwnerV2(Number(n)); console.log("ok"); });
  parent.command("set-max-pending-promotions-v2 <n>").description("Set max pending promotions per tier")
    .action(async (n) => { const m = await L(); m.setMaxPendingHmemPromotionsPerTierV2(Number(n)); console.log("ok"); });
  parent.command("set-tier-idle-ms-v2 <n>").description("Set tier idle threshold (ms)")
    .action(async (n) => { const m = await L(); m.setHmemTierIdleMsV2(Number(n)); console.log("ok"); });
  parent.command("set-promotion-stuck-ms-v2 <n>").description("Set promotion stuck threshold (ms)")
    .action(async (n) => { const m = await L(); m.setHmemPromotionStuckMsV2(Number(n)); console.log("ok"); });

  parent.command("register-tier-v2 <id> <owner>").description("Register V2 memory tier")
    .option("--level <l>", "Tier level", "short-term").action(async (id, owner, o) => { const m = await L(); console.log(JSON.stringify(m.registerHmemTierV2({ id, owner, level: o.level }), null, 2)); });
  parent.command("activate-tier-v2 <id>").description("Activate tier")
    .action(async (id) => { const m = await L(); console.log(JSON.stringify(m.activateHmemTierV2(id), null, 2)); });
  parent.command("dormant-tier-v2 <id>").description("Mark tier dormant")
    .action(async (id) => { const m = await L(); console.log(JSON.stringify(m.dormantHmemTierV2(id), null, 2)); });
  parent.command("retire-tier-v2 <id>").description("Retire tier (terminal)")
    .action(async (id) => { const m = await L(); console.log(JSON.stringify(m.retireHmemTierV2(id), null, 2)); });
  parent.command("touch-tier-v2 <id>").description("Touch tier lastTouchedAt")
    .action(async (id) => { const m = await L(); console.log(JSON.stringify(m.touchHmemTierV2(id), null, 2)); });
  parent.command("get-tier-v2 <id>").description("Get V2 tier")
    .action(async (id) => { const m = await L(); console.log(JSON.stringify(m.getHmemTierV2(id), null, 2)); });
  parent.command("list-tiers-v2").description("List all V2 tiers")
    .action(async () => { const m = await L(); console.log(JSON.stringify(m.listHmemTiersV2(), null, 2)); });

  parent.command("create-promotion-v2 <id> <tierId>").description("Create V2 promotion (queued)")
    .option("--item-key <k>", "Item key", "").action(async (id, tierId, o) => { const m = await L(); console.log(JSON.stringify(m.createHmemPromotionV2({ id, tierId, itemKey: o.itemKey }), null, 2)); });
  parent.command("start-promotion-v2 <id>").description("Start promotion (queued→promoting)")
    .action(async (id) => { const m = await L(); console.log(JSON.stringify(m.startHmemPromotionV2(id), null, 2)); });
  parent.command("complete-promotion-v2 <id>").description("Complete promotion (promoting→promoted)")
    .action(async (id) => { const m = await L(); console.log(JSON.stringify(m.completeHmemPromotionV2(id), null, 2)); });
  parent.command("fail-promotion-v2 <id> [reason]").description("Fail promotion")
    .action(async (id, reason) => { const m = await L(); console.log(JSON.stringify(m.failHmemPromotionV2(id, reason), null, 2)); });
  parent.command("cancel-promotion-v2 <id> [reason]").description("Cancel promotion")
    .action(async (id, reason) => { const m = await L(); console.log(JSON.stringify(m.cancelHmemPromotionV2(id, reason), null, 2)); });
  parent.command("get-promotion-v2 <id>").description("Get V2 promotion")
    .action(async (id) => { const m = await L(); console.log(JSON.stringify(m.getHmemPromotionV2(id), null, 2)); });
  parent.command("list-promotions-v2").description("List all V2 promotions")
    .action(async () => { const m = await L(); console.log(JSON.stringify(m.listHmemPromotionsV2(), null, 2)); });

  parent.command("auto-dormant-idle-v2").description("Auto-dormant idle active tiers")
    .action(async () => { const m = await L(); console.log(JSON.stringify(m.autoDormantIdleHmemTiersV2(), null, 2)); });
  parent.command("auto-fail-stuck-v2").description("Auto-fail stuck promoting promotions")
    .action(async () => { const m = await L(); console.log(JSON.stringify(m.autoFailStuckHmemPromotionsV2(), null, 2)); });

  parent.command("gov-stats-v2").description("V2 governance aggregate stats")
    .action(async () => { const m = await L(); console.log(JSON.stringify(m.getHierarchicalMemoryGovStatsV2(), null, 2)); });
}
