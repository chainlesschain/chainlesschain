/**
 * Tech Learning Engine commands (Phase 62)
 * chainlesschain tech analyze|profile|detect|practice|practices|recommend|types
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureTechLearningTables,
  analyzeTechStack,
  getProfile,
  detectAntiPatterns,
  recordPractice,
  listPractices,
  getRecommendations,
  TECH_TYPES,
  PRACTICE_LEVELS,
  ANTI_PATTERNS,
} from "../lib/tech-learning-engine.js";

function _dbFromCtx(ctx) {
  if (!ctx.db) {
    logger.error("Database not available");
    process.exit(1);
  }
  const db = ctx.db.getDatabase();
  ensureTechLearningTables(db);
  return db;
}

export function registerTechCommand(program) {
  const tech = program
    .command("tech")
    .description(
      "Tech Learning Engine — stack analysis, anti-pattern detection, practice store",
    );

  tech
    .command("types")
    .description("List known tech types, practice levels, anti-patterns")
    .option("--json", "Output as JSON")
    .action((options) => {
      const payload = {
        techTypes: Object.values(TECH_TYPES),
        practiceLevels: Object.values(PRACTICE_LEVELS),
        antiPatterns: Object.values(ANTI_PATTERNS),
      };
      if (options.json) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        logger.log(
          `  ${chalk.bold("Tech types:")}      ${payload.techTypes.join(", ")}`,
        );
        logger.log(
          `  ${chalk.bold("Practice levels:")} ${payload.practiceLevels.join(", ")}`,
        );
        logger.log(
          `  ${chalk.bold("Anti-patterns:")}   ${payload.antiPatterns.join(", ")}`,
        );
      }
    });

  tech
    .command("analyze [path]")
    .description("Analyze tech stack of a project directory")
    .option("--json", "Output as JSON")
    .action(async (projectPath, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const profile = analyzeTechStack(db, projectPath || process.cwd());
        if (options.json) {
          console.log(JSON.stringify(profile, null, 2));
        } else {
          logger.success("Tech stack analyzed");
          logger.log(`  ${chalk.bold("Path:")}         ${profile.projectPath}`);
          logger.log(
            `  ${chalk.bold("Languages:")}    ${profile.languages.join(", ") || "(none)"}`,
          );
          logger.log(
            `  ${chalk.bold("Frameworks:")}   ${profile.frameworks.join(", ") || "(none)"}`,
          );
          logger.log(
            `  ${chalk.bold("Databases:")}    ${profile.databases.join(", ") || "(none)"}`,
          );
          logger.log(
            `  ${chalk.bold("Tools:")}        ${profile.tools.join(", ") || "(none)"}`,
          );
          logger.log(
            `  ${chalk.bold("Total deps:")}   ${profile.totalDependencies}`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  tech
    .command("profile [path]")
    .description("Show the last analyzed profile for a path")
    .option("--json", "Output as JSON")
    .action(async (projectPath, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const profile = getProfile(projectPath || process.cwd());
        if (!profile) {
          logger.info("No profile cached. Run `tech analyze` first.");
        } else if (options.json) {
          console.log(JSON.stringify(profile, null, 2));
        } else {
          logger.log(
            `  ${chalk.bold("Languages:")}  ${profile.languages.join(", ")}`,
          );
          logger.log(
            `  ${chalk.bold("Frameworks:")} ${profile.frameworks.join(", ") || "(none)"}`,
          );
          logger.log(
            `  ${chalk.bold("Libraries:")}  ${profile.libraries.length}`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  tech
    .command("detect <file>")
    .description("Detect anti-patterns in a single file")
    .option("--json", "Output as JSON")
    .action(async (file, options) => {
      try {
        const r = detectAntiPatterns(file);
        if (options.json) {
          console.log(JSON.stringify(r, null, 2));
        } else if (r.totalFindings === 0) {
          logger.success(
            `No anti-patterns detected (${r.lines} lines, ${r.functionCount} funcs)`,
          );
        } else {
          logger.warn(`${r.totalFindings} anti-pattern finding(s):`);
          for (const f of r.findings) {
            logger.log(
              `  ${chalk.yellow(f.type.padEnd(22))} [${f.severity}] ${f.detail}`,
            );
          }
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  tech
    .command("practice <tech-type> <tech-name> <pattern> <level>")
    .description(
      "Record a learned practice (tech-type: language|framework|library|database|tool|pattern)",
    )
    .option("-d, --description <text>", "Description", "")
    .option("-s, --score <n>", "Score 0..1", parseFloat, 0)
    .option("--source <tag>", "Source tag", "manual")
    .option("--json", "Output as JSON")
    .action(async (techType, techName, patternName, level, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const p = recordPractice(db, {
          techType,
          techName,
          patternName,
          level,
          description: options.description,
          score: options.score,
          source: options.source,
        });
        if (options.json) {
          console.log(JSON.stringify(p, null, 2));
        } else {
          logger.success("Practice recorded");
          logger.log(
            `  ${chalk.bold("ID:")}      ${chalk.cyan(p.practiceId.slice(0, 8))}`,
          );
          logger.log(`  ${chalk.bold("Tech:")}    ${p.techType}/${p.techName}`);
          logger.log(`  ${chalk.bold("Pattern:")} ${p.patternName}`);
          logger.log(`  ${chalk.bold("Level:")}   ${p.level}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  tech
    .command("practices")
    .description("List recorded practices")
    .option("-t, --type <type>", "Filter by tech type")
    .option("-n, --name <name>", "Filter by tech name")
    .option("-l, --level <level>", "Filter by level")
    .option("--limit <n>", "Maximum entries", parseInt, 50)
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const rows = listPractices({
          techType: options.type,
          techName: options.name,
          level: options.level,
          limit: options.limit,
        });
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
        } else if (rows.length === 0) {
          logger.info("No practices recorded.");
        } else {
          for (const p of rows) {
            logger.log(
              `  ${chalk.cyan(p.practiceId.slice(0, 8))} ${p.techType.padEnd(10)} ${p.techName.padEnd(14)} [${p.level.padEnd(12)}] ${p.patternName}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  tech
    .command("recommend")
    .description("Recommend practices based on the analyzed stack")
    .option("--limit <n>", "Maximum entries", parseInt, 20)
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const r = getRecommendations({ limit: options.limit });
        if (options.json) {
          console.log(JSON.stringify(r, null, 2));
        } else if (r.recommendations.length === 0) {
          logger.info(
            r.message ||
              `${r.totalPractices} practice(s) stored; 0 match the analyzed stack.`,
          );
        } else {
          logger.log(
            `  ${chalk.bold("Matches:")} ${r.totalMatches}/${r.totalPractices}`,
          );
          for (const p of r.recommendations) {
            logger.log(
              `  ${chalk.cyan(p.techName.padEnd(14))} [${p.level.padEnd(12)}] ${p.patternName}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
