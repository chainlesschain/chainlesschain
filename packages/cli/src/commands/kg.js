/**
 * Knowledge Graph commands (Phase 94)
 * chainlesschain kg entity-types|add|list|show|remove|add-relation|relations|
 *                    query|reason|stats|export|import
 */

import fs from "fs";
import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureKnowledgeGraphTables,
  listEntityTypes,
  addEntity,
  getEntity,
  listEntities,
  removeEntity,
  addRelation,
  listRelations,
  reason,
  getStats,
  exportGraph,
  importGraph,
  // V2 surface
  ENTITY_STATUS_V2,
  RELATION_STATUS_V2,
  KG_DEFAULT_MAX_ACTIVE_ENTITIES_PER_OWNER,
  KG_DEFAULT_MAX_RELATIONS_PER_ENTITY,
  KG_DEFAULT_ENTITY_STALE_MS,
  KG_DEFAULT_RELATION_STALE_MS,
  getMaxActiveEntitiesPerOwnerV2,
  setMaxActiveEntitiesPerOwnerV2,
  getMaxRelationsPerEntityV2,
  setMaxRelationsPerEntityV2,
  getEntityStaleMsV2,
  setEntityStaleMsV2,
  getRelationStaleMsV2,
  setRelationStaleMsV2,
  registerEntityV2,
  getEntityV2,
  setEntityStatusV2,
  deprecateEntity,
  archiveEntityV2,
  removeEntityV2,
  reviveEntity,
  touchEntityActivity,
  registerRelationV2,
  getRelationV2,
  setRelationStatusV2,
  deprecateRelation,
  removeRelationV2,
  reviveRelation,
  getActiveEntityCount,
  getActiveRelationCount,
  autoArchiveStaleEntities,
  autoRemoveStaleRelations,
  getKnowledgeGraphStatsV2,
} from "../lib/knowledge-graph.js";

function _dbFromCtx(ctx) {
  if (!ctx.db) {
    logger.error("Database not available");
    process.exit(1);
  }
  const db = ctx.db.getDatabase();
  ensureKnowledgeGraphTables(db);
  return db;
}

function _printEntity(e) {
  logger.log(`  ${chalk.bold("ID:")}         ${chalk.cyan(e.id)}`);
  logger.log(`  ${chalk.bold("Name:")}       ${e.name}`);
  logger.log(`  ${chalk.bold("Type:")}       ${chalk.yellow(e.type)}`);
  if (e.tags && e.tags.length > 0) {
    logger.log(`  ${chalk.bold("Tags:")}       ${e.tags.join(", ")}`);
  }
  if (e.properties) {
    logger.log(
      `  ${chalk.bold("Properties:")} ${JSON.stringify(e.properties)}`,
    );
  }
}

export function registerKgCommand(program) {
  const kg = program
    .command("kg")
    .description(
      "Knowledge graph — entities, relations, multi-hop reasoning, stats",
    );

  kg.command("entity-types")
    .description("List recommended entity types")
    .option("--json", "Output as JSON")
    .action((options) => {
      const types = listEntityTypes();
      if (options.json) {
        console.log(JSON.stringify(types, null, 2));
      } else {
        for (const t of types) {
          logger.log(`  ${chalk.cyan(t.name.padEnd(14))} ${t.description}`);
        }
      }
    });

  kg.command("add <name> <type>")
    .description("Add an entity")
    .option("-p, --properties <json>", "Properties JSON")
    .option("-g, --tags <csv>", "Comma-separated tags")
    .option("--json", "Output as JSON")
    .action(async (name, type, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const properties = options.properties
          ? JSON.parse(options.properties)
          : null;
        const tags = options.tags
          ? options.tags
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : null;
        const entity = addEntity(db, { name, type, properties, tags });
        if (options.json) {
          console.log(JSON.stringify(entity, null, 2));
        } else {
          logger.success(`Entity added: ${name} [${type}]`);
          _printEntity(entity);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  kg.command("list")
    .description("List entities")
    .option("-t, --type <t>", "Filter by type")
    .option("-n, --name <substr>", "Filter by name substring")
    .option("-g, --tag <tag>", "Filter by tag")
    .option("--limit <n>", "Maximum entries", parseInt, 50)
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const rows = listEntities({
          type: options.type,
          name: options.name,
          tag: options.tag,
          limit: options.limit,
        });
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
        } else if (rows.length === 0) {
          logger.info("No entities.");
        } else {
          for (const e of rows) {
            logger.log(
              `  ${chalk.cyan(e.id.slice(0, 8))} ${chalk.yellow(e.type.padEnd(14))} ${e.name}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  kg.command("show <entity-id>")
    .description("Show entity details")
    .option("--json", "Output as JSON")
    .action(async (entityId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const entity = getEntity(entityId);
        if (!entity) {
          logger.error(`Entity not found: ${entityId}`);
          process.exit(1);
        }
        if (options.json) {
          console.log(JSON.stringify(entity, null, 2));
        } else {
          _printEntity(entity);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  kg.command("remove <entity-id>")
    .description("Remove entity (cascades to relations)")
    .action(async (entityId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const ok = removeEntity(db, entityId);
        if (ok) {
          logger.success(`Entity removed: ${entityId}`);
        } else {
          logger.info(`No such entity: ${entityId}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  kg.command("add-relation <source-id> <target-id> <relation-type>")
    .description("Add a directed relation between two entities")
    .option("-w, --weight <n>", "Relation weight", parseFloat, 1.0)
    .option("-p, --properties <json>", "Properties JSON")
    .option("--json", "Output as JSON")
    .action(async (sourceId, targetId, relationType, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const properties = options.properties
          ? JSON.parse(options.properties)
          : null;
        const relation = addRelation(db, {
          sourceId,
          targetId,
          relationType,
          weight: options.weight,
          properties,
        });
        if (options.json) {
          console.log(JSON.stringify(relation, null, 2));
        } else {
          logger.success(
            `Relation added: ${sourceId.slice(0, 8)} ─[${relationType}]─> ${targetId.slice(0, 8)}`,
          );
          logger.log(
            `  ${chalk.bold("ID:")}     ${chalk.cyan(relation.id.slice(0, 8))}`,
          );
          logger.log(`  ${chalk.bold("Weight:")} ${relation.weight}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  kg.command("relations")
    .description("List relations")
    .option("-s, --source <id>", "Filter by source entity")
    .option("-t, --target <id>", "Filter by target entity")
    .option("-r, --type <type>", "Filter by relation type")
    .option("--limit <n>", "Maximum entries", parseInt, 50)
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const rows = listRelations({
          sourceId: options.source,
          targetId: options.target,
          relationType: options.type,
          limit: options.limit,
        });
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
        } else if (rows.length === 0) {
          logger.info("No relations.");
        } else {
          for (const r of rows) {
            logger.log(
              `  ${chalk.cyan(r.id.slice(0, 8))} ${r.sourceId.slice(0, 8)} ─[${chalk.yellow(r.relationType)}:${r.weight}]─> ${r.targetId.slice(0, 8)}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  kg.command("reason <start-id>")
    .description("BFS multi-hop reasoning from a start entity")
    .option("-d, --max-depth <n>", "Maximum hops", parseInt, 3)
    .option("--direction <d>", "out | in | both", "out")
    .option("-r, --relation-type <t>", "Filter edges by relation type")
    .option("--include-start", "Include the start entity in result")
    .option("--json", "Output as JSON")
    .action(async (startId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const results = reason(startId, {
          maxDepth: options.maxDepth,
          direction: options.direction,
          relationType: options.relationType,
          includeStart: options.includeStart,
        });
        if (options.json) {
          console.log(JSON.stringify(results, null, 2));
        } else if (results.length === 0) {
          logger.info("No reachable entities.");
        } else {
          for (const r of results) {
            logger.log(
              `  [depth=${r.depth}] ${chalk.cyan(r.entity.id.slice(0, 8))} ${chalk.yellow(r.entity.type.padEnd(14))} ${r.entity.name}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  kg.command("stats")
    .description("Graph statistics — counts, type distribution, density")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const stats = getStats();
        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          logger.log(`  ${chalk.bold("Entities:")}    ${stats.entityCount}`);
          logger.log(`  ${chalk.bold("Relations:")}   ${stats.relationCount}`);
          logger.log(`  ${chalk.bold("Avg Degree:")}  ${stats.avgDegree}`);
          logger.log(`  ${chalk.bold("Density:")}     ${stats.density}`);
          if (Object.keys(stats.typeDistribution).length > 0) {
            logger.log(chalk.bold("  Entity types:"));
            for (const [t, n] of Object.entries(stats.typeDistribution)) {
              logger.log(`    ${chalk.yellow(t.padEnd(14))} ${n}`);
            }
          }
          if (Object.keys(stats.relationTypeDistribution).length > 0) {
            logger.log(chalk.bold("  Relation types:"));
            for (const [t, n] of Object.entries(
              stats.relationTypeDistribution,
            )) {
              logger.log(`    ${chalk.yellow(t.padEnd(14))} ${n}`);
            }
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  kg.command("export [output-file]")
    .description("Export entire graph as JSON (stdout if no file)")
    .action(async (outputFile) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const data = exportGraph();
        const json = JSON.stringify(data, null, 2);
        if (outputFile) {
          fs.writeFileSync(outputFile, json, "utf-8");
          logger.success(
            `Exported ${data.entities.length} entities + ${data.relations.length} relations → ${outputFile}`,
          );
        } else {
          console.log(json);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  kg.command("import <input-file>")
    .description("Import graph from JSON file ({entities[], relations[]})")
    .option("--json", "Output result as JSON")
    .action(async (inputFile, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const raw = fs.readFileSync(inputFile, "utf-8");
        const data = JSON.parse(raw);
        const result = importGraph(db, data);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success(
            `Imported ${result.importedEntities} entities + ${result.importedRelations} relations (skipped ${result.skippedRelations})`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  /* ── V2 subcommands (Phase 94) ───────────────────────────────── */

  kg.command("entity-statuses-v2")
    .description("List V2 entity maturity statuses")
    .option("--json", "Output as JSON")
    .action((options) => {
      const statuses = Object.values(ENTITY_STATUS_V2);
      if (options.json) {
        console.log(JSON.stringify(statuses, null, 2));
      } else {
        for (const s of statuses) logger.log(`  ${chalk.yellow(s)}`);
      }
    });

  kg.command("relation-statuses-v2")
    .description("List V2 relation statuses")
    .option("--json", "Output as JSON")
    .action((options) => {
      const statuses = Object.values(RELATION_STATUS_V2);
      if (options.json) {
        console.log(JSON.stringify(statuses, null, 2));
      } else {
        for (const s of statuses) logger.log(`  ${chalk.yellow(s)}`);
      }
    });

  kg.command("default-max-active-entities-per-owner")
    .description("Show default V2 per-owner active-entity cap")
    .action(() => logger.log(String(KG_DEFAULT_MAX_ACTIVE_ENTITIES_PER_OWNER)));
  kg.command("max-active-entities-per-owner")
    .description("Show current V2 per-owner active-entity cap")
    .action(() => logger.log(String(getMaxActiveEntitiesPerOwnerV2())));
  kg.command("set-max-active-entities-per-owner <n>")
    .description("Set V2 per-owner active-entity cap")
    .action((n) =>
      logger.log(String(setMaxActiveEntitiesPerOwnerV2(parseInt(n, 10)))),
    );

  kg.command("default-max-relations-per-entity")
    .description("Show default V2 per-entity active-relation cap")
    .action(() => logger.log(String(KG_DEFAULT_MAX_RELATIONS_PER_ENTITY)));
  kg.command("max-relations-per-entity")
    .description("Show current V2 per-entity active-relation cap")
    .action(() => logger.log(String(getMaxRelationsPerEntityV2())));
  kg.command("set-max-relations-per-entity <n>")
    .description("Set V2 per-entity active-relation cap")
    .action((n) =>
      logger.log(String(setMaxRelationsPerEntityV2(parseInt(n, 10)))),
    );

  kg.command("default-entity-stale-ms")
    .description("Show default V2 entity staleness threshold (ms)")
    .action(() => logger.log(String(KG_DEFAULT_ENTITY_STALE_MS)));
  kg.command("entity-stale-ms")
    .description("Show current V2 entity staleness threshold (ms)")
    .action(() => logger.log(String(getEntityStaleMsV2())));
  kg.command("set-entity-stale-ms <ms>")
    .description("Set V2 entity staleness threshold (ms)")
    .action((ms) => logger.log(String(setEntityStaleMsV2(parseInt(ms, 10)))));

  kg.command("default-relation-stale-ms")
    .description("Show default V2 relation staleness threshold (ms)")
    .action(() => logger.log(String(KG_DEFAULT_RELATION_STALE_MS)));
  kg.command("relation-stale-ms")
    .description("Show current V2 relation staleness threshold (ms)")
    .action(() => logger.log(String(getRelationStaleMsV2())));
  kg.command("set-relation-stale-ms <ms>")
    .description("Set V2 relation staleness threshold (ms)")
    .action((ms) => logger.log(String(setRelationStaleMsV2(parseInt(ms, 10)))));

  kg.command("active-entity-count")
    .description("Active V2 entity count (scoped by owner)")
    .option("-o, --owner <id>", "Scope by owner ID")
    .action((opts) => logger.log(String(getActiveEntityCount(opts.owner))));

  kg.command("active-relation-count")
    .description("Active V2 relation count (scoped by source entity)")
    .option("-s, --source <id>", "Scope by source entity ID")
    .action((opts) => logger.log(String(getActiveRelationCount(opts.source))));

  kg.command("register-entity-v2 <entity-id>")
    .description("Register a V2 entity")
    .requiredOption("-o, --owner <id>", "Owner ID")
    .option("-n, --name <name>", "Entity name")
    .option("-t, --type <type>", "Entity type")
    .option("-m, --metadata <json>", "JSON metadata")
    .option("--json", "Output as JSON")
    .action((entityId, opts) => {
      try {
        const metadata = opts.metadata ? JSON.parse(opts.metadata) : undefined;
        const rec = registerEntityV2(null, {
          entityId,
          ownerId: opts.owner,
          name: opts.name,
          type: opts.type,
          metadata,
        });
        if (opts.json) console.log(JSON.stringify(rec, null, 2));
        else logger.success(`Entity registered: ${entityId} (${rec.status})`);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  kg.command("entity-v2 <entity-id>")
    .description("Show V2 entity lifecycle state")
    .option("--json", "Output as JSON")
    .action((entityId, opts) => {
      const rec = getEntityV2(entityId);
      if (!rec) {
        logger.error(`Entity not registered in V2: ${entityId}`);
        process.exit(1);
      }
      if (opts.json) console.log(JSON.stringify(rec, null, 2));
      else {
        logger.log(`  ${chalk.bold("Entity:")} ${rec.entityId}`);
        logger.log(`  ${chalk.bold("Status:")} ${chalk.yellow(rec.status)}`);
        logger.log(`  ${chalk.bold("Owner:")}  ${rec.ownerId}`);
      }
    });

  kg.command("set-entity-status-v2 <entity-id> <status>")
    .description("Transition a V2 entity status")
    .option("-r, --reason <text>", "Reason")
    .option("-m, --metadata <json>", "JSON metadata to merge")
    .action((entityId, status, opts) => {
      try {
        const patch = {};
        if (opts.reason) patch.reason = opts.reason;
        if (opts.metadata) patch.metadata = JSON.parse(opts.metadata);
        const rec = setEntityStatusV2(null, entityId, status, patch);
        logger.success(`Entity ${entityId} → ${rec.status}`);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  kg.command("deprecate-entity <entity-id>")
    .description("Deprecate a V2 entity (grace period)")
    .option("-r, --reason <text>", "Reason")
    .action((entityId, opts) => {
      try {
        deprecateEntity(null, entityId, opts.reason);
        logger.success(`Entity ${entityId} deprecated`);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  kg.command("archive-entity-v2 <entity-id>")
    .description("Archive a V2 entity")
    .option("-r, --reason <text>", "Reason")
    .action((entityId, opts) => {
      try {
        archiveEntityV2(null, entityId, opts.reason);
        logger.success(`Entity ${entityId} archived`);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  kg.command("remove-entity-v2 <entity-id>")
    .description("Remove a V2 entity (terminal)")
    .option("-r, --reason <text>", "Reason")
    .action((entityId, opts) => {
      try {
        removeEntityV2(null, entityId, opts.reason);
        logger.success(`Entity ${entityId} removed`);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  kg.command("revive-entity <entity-id>")
    .description("Restore a V2 entity to active")
    .option("-r, --reason <text>", "Reason")
    .action((entityId, opts) => {
      try {
        reviveEntity(null, entityId, opts.reason);
        logger.success(`Entity ${entityId} revived`);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  kg.command("touch-entity-activity <entity-id>")
    .description("Bump lastActivityAt on a V2 entity")
    .action((entityId) => {
      try {
        touchEntityActivity(entityId);
        logger.success(`Entity ${entityId} activity bumped`);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  kg.command("register-relation-v2 <relation-id>")
    .description("Register a V2 relation")
    .requiredOption("-s, --source <id>", "Source entity ID")
    .requiredOption("-t, --target <id>", "Target entity ID")
    .requiredOption("-r, --relation-type <type>", "Relation type")
    .option("-m, --metadata <json>", "JSON metadata")
    .option("--json", "Output as JSON")
    .action((relationId, opts) => {
      try {
        const metadata = opts.metadata ? JSON.parse(opts.metadata) : undefined;
        const rec = registerRelationV2(null, {
          relationId,
          sourceEntityId: opts.source,
          targetEntityId: opts.target,
          relationType: opts.relationType,
          metadata,
        });
        if (opts.json) console.log(JSON.stringify(rec, null, 2));
        else
          logger.success(`Relation registered: ${relationId} (${rec.status})`);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  kg.command("relation-v2 <relation-id>")
    .description("Show V2 relation lifecycle state")
    .option("--json", "Output as JSON")
    .action((relationId, opts) => {
      const rec = getRelationV2(relationId);
      if (!rec) {
        logger.error(`Relation not registered in V2: ${relationId}`);
        process.exit(1);
      }
      if (opts.json) console.log(JSON.stringify(rec, null, 2));
      else {
        logger.log(`  ${chalk.bold("Relation:")} ${rec.relationId}`);
        logger.log(`  ${chalk.bold("Status:")}   ${chalk.yellow(rec.status)}`);
        logger.log(
          `  ${chalk.bold("Edge:")}     ${rec.sourceEntityId} ─[${rec.relationType}]→ ${rec.targetEntityId}`,
        );
      }
    });

  kg.command("set-relation-status-v2 <relation-id> <status>")
    .description("Transition a V2 relation status")
    .option("-r, --reason <text>", "Reason")
    .option("-m, --metadata <json>", "JSON metadata to merge")
    .action((relationId, status, opts) => {
      try {
        const patch = {};
        if (opts.reason) patch.reason = opts.reason;
        if (opts.metadata) patch.metadata = JSON.parse(opts.metadata);
        const rec = setRelationStatusV2(null, relationId, status, patch);
        logger.success(`Relation ${relationId} → ${rec.status}`);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  kg.command("deprecate-relation <relation-id>")
    .description("Deprecate a V2 relation")
    .option("-r, --reason <text>", "Reason")
    .action((relationId, opts) => {
      try {
        deprecateRelation(null, relationId, opts.reason);
        logger.success(`Relation ${relationId} deprecated`);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  kg.command("remove-relation-v2 <relation-id>")
    .description("Remove a V2 relation (terminal)")
    .option("-r, --reason <text>", "Reason")
    .action((relationId, opts) => {
      try {
        removeRelationV2(null, relationId, opts.reason);
        logger.success(`Relation ${relationId} removed`);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  kg.command("revive-relation <relation-id>")
    .description("Restore a V2 relation to active")
    .option("-r, --reason <text>", "Reason")
    .action((relationId, opts) => {
      try {
        reviveRelation(null, relationId, opts.reason);
        logger.success(`Relation ${relationId} revived`);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  kg.command("auto-archive-stale-entities")
    .description("Bulk-flip stale V2 entities → archived")
    .option("--json", "Output as JSON")
    .action((opts) => {
      const flipped = autoArchiveStaleEntities(null);
      if (opts.json) console.log(JSON.stringify(flipped, null, 2));
      else logger.success(`Archived ${flipped.length} stale entities`);
    });

  kg.command("auto-remove-stale-relations")
    .description("Bulk-flip stale V2 relations → removed")
    .option("--json", "Output as JSON")
    .action((opts) => {
      const flipped = autoRemoveStaleRelations(null);
      if (opts.json) console.log(JSON.stringify(flipped, null, 2));
      else logger.success(`Removed ${flipped.length} stale relations`);
    });

  kg.command("stats-v2")
    .description("V2 knowledge graph stats (all-enum-key zero-init)")
    .option("--json", "Output as JSON")
    .action((opts) => {
      const stats = getKnowledgeGraphStatsV2();
      if (opts.json) {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        logger.log(
          `  ${chalk.bold("Total entities:")}  ${stats.totalEntitiesV2}`,
        );
        logger.log(
          `  ${chalk.bold("Total relations:")} ${stats.totalRelationsV2}`,
        );
        logger.log(
          `  ${chalk.bold("Caps:")}            per-owner=${stats.maxActiveEntitiesPerOwner}, per-entity=${stats.maxRelationsPerEntity}`,
        );
        logger.log(
          `  ${chalk.bold("Stale thresholds:")} entity=${stats.entityStaleMs}ms, relation=${stats.relationStaleMs}ms`,
        );
        logger.log(chalk.bold("  Entities by status:"));
        for (const [k, v] of Object.entries(stats.entitiesByStatus)) {
          logger.log(`    ${chalk.yellow(k.padEnd(12))} ${v}`);
        }
        logger.log(chalk.bold("  Relations by status:"));
        for (const [k, v] of Object.entries(stats.relationsByStatus)) {
          logger.log(`    ${chalk.yellow(k.padEnd(12))} ${v}`);
        }
      }
    });
}
