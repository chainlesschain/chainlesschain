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
}
