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
  PROFILE_MATURITY_V2,
  LEARNING_RUN_V2,
  getMaxActiveProfilesPerOwnerV2,
  setMaxActiveProfilesPerOwnerV2,
  getMaxStudyingRunsPerLearnerV2,
  setMaxStudyingRunsPerLearnerV2,
  getProfileStaleMsV2,
  setProfileStaleMsV2,
  getRunStuckMsV2,
  setRunStuckMsV2,
  getActiveProfileCountV2,
  getStudyingRunCountV2,
  createProfileV2,
  getProfileV2,
  listProfilesV2,
  setProfileMaturityV2,
  activateProfileV2,
  markProfileStaleV2,
  archiveProfileV2,
  touchProfileV2,
  enqueueRunV2,
  getRunV2,
  listRunsV2,
  setRunStatusV2,
  startRunV2,
  completeRunV2,
  abandonRunV2,
  failRunV2,
  autoMarkStaleProfilesV2,
  autoFailStuckRunsV2,
  getTechLearningStatsV2,
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

  /* ═══ V2 Surface ═══ */

  function _parseMeta(s) {
    if (!s) return undefined;
    try {
      return JSON.parse(s);
    } catch {
      throw new Error("--metadata must be valid JSON");
    }
  }

  tech
    .command("profile-maturities-v2")
    .description("List profile maturity states (V2)")
    .action(() => {
      for (const v of Object.values(PROFILE_MATURITY_V2)) logger.log(`  ${v}`);
    });

  tech
    .command("learning-runs-v2")
    .description("List learning run states (V2)")
    .action(() => {
      for (const v of Object.values(LEARNING_RUN_V2)) logger.log(`  ${v}`);
    });

  tech
    .command("stats-v2")
    .description("Tech Learning V2 stats")
    .action(() => {
      console.log(JSON.stringify(getTechLearningStatsV2(), null, 2));
    });

  tech
    .command("max-active-profiles-per-owner")
    .description("Get/set max active profiles per owner (V2)")
    .option("-s, --set <n>", "Set value", (v) => parseInt(v, 10))
    .action((o) => {
      if (typeof o.set === "number")
        console.log(setMaxActiveProfilesPerOwnerV2(o.set));
      else console.log(getMaxActiveProfilesPerOwnerV2());
    });

  tech
    .command("max-studying-runs-per-learner")
    .description("Get/set max studying runs per learner (V2)")
    .option("-s, --set <n>", "Set value", (v) => parseInt(v, 10))
    .action((o) => {
      if (typeof o.set === "number")
        console.log(setMaxStudyingRunsPerLearnerV2(o.set));
      else console.log(getMaxStudyingRunsPerLearnerV2());
    });

  tech
    .command("profile-stale-ms")
    .description("Get/set profile stale threshold ms (V2)")
    .option("-s, --set <n>", "Set value", (v) => parseInt(v, 10))
    .action((o) => {
      if (typeof o.set === "number") console.log(setProfileStaleMsV2(o.set));
      else console.log(getProfileStaleMsV2());
    });

  tech
    .command("run-stuck-ms")
    .description("Get/set run stuck threshold ms (V2)")
    .option("-s, --set <n>", "Set value", (v) => parseInt(v, 10))
    .action((o) => {
      if (typeof o.set === "number") console.log(setRunStuckMsV2(o.set));
      else console.log(getRunStuckMsV2());
    });

  tech
    .command("active-profile-count")
    .description("Count active+stale profiles for owner (V2)")
    .requiredOption("-o, --owner <owner>", "Owner")
    .action((o) => {
      console.log(getActiveProfileCountV2(o.owner));
    });

  tech
    .command("studying-run-count")
    .description("Count studying runs for learner (V2)")
    .requiredOption("-l, --learner <learner>", "Learner")
    .action((o) => {
      console.log(getStudyingRunCountV2(o.learner));
    });

  tech
    .command("create-profile-v2 <id>")
    .description("Create a profile V2 (draft)")
    .requiredOption("-o, --owner <owner>", "Owner")
    .requiredOption("-s, --stack <stack>", "Stack name")
    .option("-m, --metadata <json>", "JSON metadata")
    .action((id, o) => {
      console.log(
        JSON.stringify(
          createProfileV2({
            id,
            owner: o.owner,
            stackName: o.stack,
            metadata: _parseMeta(o.metadata),
          }),
          null,
          2,
        ),
      );
    });

  tech
    .command("profile-v2 <id>")
    .description("Show profile V2")
    .action((id) => {
      const p = getProfileV2(id);
      if (!p) {
        logger.error(`profile ${id} not found`);
        process.exit(1);
      }
      console.log(JSON.stringify(p, null, 2));
    });

  tech
    .command("list-profiles-v2")
    .description("List profiles V2")
    .option("-o, --owner <owner>", "Filter by owner")
    .option("-s, --status <status>", "Filter by status")
    .action((o) => {
      console.log(
        JSON.stringify(
          listProfilesV2({ owner: o.owner, status: o.status }),
          null,
          2,
        ),
      );
    });

  tech
    .command("set-profile-maturity-v2 <id> <status>")
    .description("Transition profile V2 to status")
    .option("-r, --reason <reason>", "Reason")
    .option("-m, --metadata <json>", "JSON metadata patch")
    .action((id, status, o) => {
      console.log(
        JSON.stringify(
          setProfileMaturityV2(id, status, {
            reason: o.reason,
            metadata: _parseMeta(o.metadata),
          }),
          null,
          2,
        ),
      );
    });

  tech
    .command("activate-profile <id>")
    .description("Transition profile → active (V2)")
    .option("-r, --reason <reason>", "Reason")
    .action((id, o) => {
      console.log(
        JSON.stringify(activateProfileV2(id, { reason: o.reason }), null, 2),
      );
    });

  tech
    .command("mark-profile-stale <id>")
    .description("Transition profile → stale (V2)")
    .option("-r, --reason <reason>", "Reason")
    .action((id, o) => {
      console.log(
        JSON.stringify(markProfileStaleV2(id, { reason: o.reason }), null, 2),
      );
    });

  tech
    .command("archive-profile <id>")
    .description("Transition profile → archived (V2)")
    .option("-r, --reason <reason>", "Reason")
    .action((id, o) => {
      console.log(
        JSON.stringify(archiveProfileV2(id, { reason: o.reason }), null, 2),
      );
    });

  tech
    .command("touch-profile <id>")
    .description("Update lastTouchedAt (V2)")
    .action((id) => {
      console.log(JSON.stringify(touchProfileV2(id), null, 2));
    });

  tech
    .command("enqueue-run-v2 <id>")
    .description("Enqueue a learning run (V2)")
    .requiredOption("-l, --learner <learner>", "Learner")
    .requiredOption("-t, --topic <topic>", "Topic")
    .option("-m, --metadata <json>", "JSON metadata")
    .action((id, o) => {
      console.log(
        JSON.stringify(
          enqueueRunV2({
            id,
            learner: o.learner,
            topic: o.topic,
            metadata: _parseMeta(o.metadata),
          }),
          null,
          2,
        ),
      );
    });

  tech
    .command("run-v2 <id>")
    .description("Show learning run V2")
    .action((id) => {
      const r = getRunV2(id);
      if (!r) {
        logger.error(`run ${id} not found`);
        process.exit(1);
      }
      console.log(JSON.stringify(r, null, 2));
    });

  tech
    .command("list-runs-v2")
    .description("List learning runs V2")
    .option("-l, --learner <learner>", "Filter by learner")
    .option("-s, --status <status>", "Filter by status")
    .action((o) => {
      console.log(
        JSON.stringify(
          listRunsV2({ learner: o.learner, status: o.status }),
          null,
          2,
        ),
      );
    });

  tech
    .command("set-run-status-v2 <id> <status>")
    .description("Transition run V2 to status")
    .option("-r, --reason <reason>", "Reason")
    .option("-m, --metadata <json>", "JSON metadata patch")
    .action((id, status, o) => {
      console.log(
        JSON.stringify(
          setRunStatusV2(id, status, {
            reason: o.reason,
            metadata: _parseMeta(o.metadata),
          }),
          null,
          2,
        ),
      );
    });

  tech
    .command("start-run-v2 <id>")
    .description("Transition run → studying (V2)")
    .option("-r, --reason <reason>", "Reason")
    .action((id, o) => {
      console.log(
        JSON.stringify(startRunV2(id, { reason: o.reason }), null, 2),
      );
    });

  tech
    .command("complete-run-v2 <id>")
    .description("Transition run → completed (V2)")
    .option("-r, --reason <reason>", "Reason")
    .action((id, o) => {
      console.log(
        JSON.stringify(completeRunV2(id, { reason: o.reason }), null, 2),
      );
    });

  tech
    .command("fail-run-v2 <id>")
    .description("Transition run → failed (V2)")
    .option("-r, --reason <reason>", "Reason")
    .action((id, o) => {
      console.log(JSON.stringify(failRunV2(id, { reason: o.reason }), null, 2));
    });

  tech
    .command("abandon-run-v2 <id>")
    .description("Transition run → abandoned (V2)")
    .option("-r, --reason <reason>", "Reason")
    .action((id, o) => {
      console.log(
        JSON.stringify(abandonRunV2(id, { reason: o.reason }), null, 2),
      );
    });

  tech
    .command("auto-mark-stale-profiles")
    .description("Bulk auto-flip active→stale past threshold (V2)")
    .action(() => {
      console.log(JSON.stringify(autoMarkStaleProfilesV2(), null, 2));
    });

  tech
    .command("auto-fail-stuck-runs")
    .description("Bulk auto-fail studying runs past threshold (V2)")
    .action(() => {
      console.log(JSON.stringify(autoFailStuckRunsV2(), null, 2));
    });
}
