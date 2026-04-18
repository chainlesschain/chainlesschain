/**
 * Instinct learning commands
 * chainlesschain instinct show|reset|categories
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  getInstincts,
  getStrongInstincts,
  resetInstincts,
  deleteInstinct,
  decayInstincts,
  generateInstinctPrompt,
  INSTINCT_CATEGORIES,
  PROFILE_MATURITY_V2,
  OBSERVATION_LIFECYCLE_V2,
  getMaxActiveProfilesPerUserV2,
  setMaxActiveProfilesPerUserV2,
  getMaxPendingObsPerProfileV2,
  setMaxPendingObsPerProfileV2,
  getProfileIdleMsV2,
  setProfileIdleMsV2,
  getObsStuckMsV2,
  setObsStuckMsV2,
  getActiveProfileCountV2,
  getPendingObsCountV2,
  registerProfileV2,
  getProfileV2,
  listProfilesV2,
  activateProfileV2,
  dormantProfileV2,
  archiveProfileV2,
  touchProfileV2,
  createObservationV2,
  getObservationV2,
  listObservationsV2,
  reviewObservationV2,
  reinforceObservationV2,
  promoteObservationV2,
  discardObservationV2,
  autoDormantIdleProfilesV2,
  autoDiscardStaleObservationsV2,
  getInstinctManagerStatsV2,
} from "../lib/instinct-manager.js";

export function registerInstinctCommand(program) {
  const instinct = program
    .command("instinct")
    .description("Instinct learning — learned user preferences");

  // instinct show
  instinct
    .command("show", { isDefault: true })
    .description("Show learned instincts")
    .option("--category <cat>", "Filter by category")
    .option("-n, --limit <n>", "Max entries", "30")
    .option("--strong", "Show only high-confidence instincts (>= 70%)")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();

        const instincts = options.strong
          ? getStrongInstincts(db)
          : getInstincts(db, {
              category: options.category,
              limit: parseInt(options.limit) || 30,
            });

        if (options.json) {
          console.log(JSON.stringify(instincts, null, 2));
        } else if (instincts.length === 0) {
          logger.info(
            "No instincts learned yet. Use the agent to build up preferences.",
          );
        } else {
          logger.log(chalk.bold(`Learned Instincts (${instincts.length}):\n`));
          for (const inst of instincts) {
            const pct = (inst.confidence * 100).toFixed(0);
            const bar =
              "█".repeat(Math.round(inst.confidence * 10)) +
              "░".repeat(10 - Math.round(inst.confidence * 10));
            logger.log(
              `  ${chalk.gray(inst.id.slice(0, 8))}  ${chalk.cyan(inst.category.padEnd(18))} ${bar} ${pct}%`,
            );
            logger.log(`    ${chalk.white(inst.pattern)}`);
            logger.log(
              `    ${chalk.gray(`seen ${inst.occurrences}x | last: ${inst.last_seen || "unknown"}`)}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // instinct categories
  instinct
    .command("categories")
    .description("List instinct categories")
    .action(async () => {
      logger.log(chalk.bold("Instinct Categories:\n"));
      for (const [key, value] of Object.entries(INSTINCT_CATEGORIES)) {
        logger.log(`  ${chalk.cyan(value.padEnd(20))} ${chalk.gray(key)}`);
      }
    });

  // instinct prompt
  instinct
    .command("prompt")
    .description("Generate a system prompt from learned instincts")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const prompt = generateInstinctPrompt(db);

        if (options.json) {
          console.log(JSON.stringify({ prompt }, null, 2));
        } else if (!prompt) {
          logger.info("No strong instincts yet. Keep using the agent!");
        } else {
          logger.log(prompt);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // instinct delete
  instinct
    .command("delete")
    .description("Delete an instinct by ID")
    .argument("<id>", "Instinct ID (or prefix)")
    .action(async (id) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const ok = deleteInstinct(db, id);
        if (ok) {
          logger.success("Instinct deleted");
        } else {
          logger.error(`Instinct not found: ${id}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // instinct reset
  instinct
    .command("reset")
    .description("Reset all learned instincts")
    .option("--force", "Skip confirmation")
    .action(async (options) => {
      try {
        if (!options.force) {
          const { confirm } = await import("@inquirer/prompts");
          const ok = await confirm({
            message: "Reset all learned instincts? This cannot be undone.",
          });
          if (!ok) {
            logger.info("Cancelled");
            return;
          }
        }

        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const count = resetInstincts(db);
        logger.success(`Reset ${count} instincts`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // instinct decay
  instinct
    .command("decay")
    .description("Decay old instincts (reduce confidence of unused patterns)")
    .option("--days <n>", "Days threshold", "30")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const decayed = decayInstincts(db, parseInt(options.days) || 30);
        logger.success(`Decayed ${decayed} old instincts`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ─── V2 governance surface ─────────────────────────────────

  instinct
    .command("profile-maturities-v2")
    .description("List V2 profile maturity states")
    .action(() => {
      console.log(JSON.stringify(Object.values(PROFILE_MATURITY_V2), null, 2));
    });

  instinct
    .command("observation-lifecycles-v2")
    .description("List V2 observation lifecycle states")
    .action(() => {
      console.log(
        JSON.stringify(Object.values(OBSERVATION_LIFECYCLE_V2), null, 2),
      );
    });

  instinct
    .command("stats-v2")
    .description("Show V2 governance stats")
    .action(() => {
      console.log(JSON.stringify(getInstinctManagerStatsV2(), null, 2));
    });

  instinct
    .command("get-max-active-profiles-v2")
    .description("Get max active profiles per user")
    .action(() => console.log(getMaxActiveProfilesPerUserV2()));

  instinct
    .command("set-max-active-profiles-v2 <n>")
    .description("Set max active profiles per user")
    .action((n) => {
      setMaxActiveProfilesPerUserV2(Number(n));
      console.log(getMaxActiveProfilesPerUserV2());
    });

  instinct
    .command("get-max-pending-obs-v2")
    .description("Get max pending observations per profile")
    .action(() => console.log(getMaxPendingObsPerProfileV2()));

  instinct
    .command("set-max-pending-obs-v2 <n>")
    .description("Set max pending observations per profile")
    .action((n) => {
      setMaxPendingObsPerProfileV2(Number(n));
      console.log(getMaxPendingObsPerProfileV2());
    });

  instinct
    .command("get-profile-idle-ms-v2")
    .description("Get profile idle threshold (ms)")
    .action(() => console.log(getProfileIdleMsV2()));

  instinct
    .command("set-profile-idle-ms-v2 <n>")
    .description("Set profile idle threshold (ms)")
    .action((n) => {
      setProfileIdleMsV2(Number(n));
      console.log(getProfileIdleMsV2());
    });

  instinct
    .command("get-obs-stuck-ms-v2")
    .description("Get observation stuck threshold (ms)")
    .action(() => console.log(getObsStuckMsV2()));

  instinct
    .command("set-obs-stuck-ms-v2 <n>")
    .description("Set observation stuck threshold (ms)")
    .action((n) => {
      setObsStuckMsV2(Number(n));
      console.log(getObsStuckMsV2());
    });

  instinct
    .command("active-profile-count-v2 <userId>")
    .description("Count active profiles for a user")
    .action((userId) => console.log(getActiveProfileCountV2(userId)));

  instinct
    .command("pending-obs-count-v2 <profileId>")
    .description("Count pending observations for a profile")
    .action((profileId) => console.log(getPendingObsCountV2(profileId)));

  instinct
    .command("register-profile-v2 <id>")
    .description("Register a V2 profile")
    .requiredOption("-u, --user <userId>", "User id")
    .requiredOption("-c, --category <category>", "Category")
    .action((id, opts) => {
      const p = registerProfileV2(id, {
        userId: opts.user,
        category: opts.category,
      });
      console.log(JSON.stringify(p, null, 2));
    });

  instinct
    .command("get-profile-v2 <id>")
    .description("Get a V2 profile")
    .action((id) => {
      const p = getProfileV2(id);
      console.log(p ? JSON.stringify(p, null, 2) : "null");
    });

  instinct
    .command("list-profiles-v2")
    .description("List V2 profiles")
    .option("-u, --user <userId>", "Filter by user")
    .option("-c, --category <category>", "Filter by category")
    .option("-s, --status <status>", "Filter by status")
    .action((opts) => {
      console.log(
        JSON.stringify(
          listProfilesV2({
            userId: opts.user,
            category: opts.category,
            status: opts.status,
          }),
          null,
          2,
        ),
      );
    });

  instinct
    .command("activate-profile-v2 <id>")
    .description("pending|dormant → active")
    .action((id) =>
      console.log(JSON.stringify(activateProfileV2(id), null, 2)),
    );

  instinct
    .command("dormant-profile-v2 <id>")
    .description("active → dormant")
    .action((id) => console.log(JSON.stringify(dormantProfileV2(id), null, 2)));

  instinct
    .command("archive-profile-v2 <id>")
    .description("→ archived (terminal)")
    .action((id) => console.log(JSON.stringify(archiveProfileV2(id), null, 2)));

  instinct
    .command("touch-profile-v2 <id>")
    .description("Update lastSeenAt")
    .action((id) => console.log(JSON.stringify(touchProfileV2(id), null, 2)));

  instinct
    .command("create-observation-v2 <id>")
    .description("Create a V2 observation")
    .requiredOption("-p, --profile <profileId>", "Profile id")
    .requiredOption("-s, --signal <signal>", "Signal text")
    .action((id, opts) => {
      const o = createObservationV2(id, {
        profileId: opts.profile,
        signal: opts.signal,
      });
      console.log(JSON.stringify(o, null, 2));
    });

  instinct
    .command("get-observation-v2 <id>")
    .description("Get a V2 observation")
    .action((id) => {
      const o = getObservationV2(id);
      console.log(o ? JSON.stringify(o, null, 2) : "null");
    });

  instinct
    .command("list-observations-v2")
    .description("List V2 observations")
    .option("-p, --profile <profileId>", "Filter by profile")
    .option("-s, --status <status>", "Filter by status")
    .action((opts) => {
      console.log(
        JSON.stringify(
          listObservationsV2({
            profileId: opts.profile,
            status: opts.status,
          }),
          null,
          2,
        ),
      );
    });

  instinct
    .command("review-observation-v2 <id>")
    .description("captured → reviewed")
    .action((id) =>
      console.log(JSON.stringify(reviewObservationV2(id), null, 2)),
    );

  instinct
    .command("reinforce-observation-v2 <id>")
    .description("reviewed → reinforced")
    .action((id) =>
      console.log(JSON.stringify(reinforceObservationV2(id), null, 2)),
    );

  instinct
    .command("promote-observation-v2 <id>")
    .description("reviewed|reinforced → promoted (terminal)")
    .action((id) =>
      console.log(JSON.stringify(promoteObservationV2(id), null, 2)),
    );

  instinct
    .command("discard-observation-v2 <id>")
    .description("→ discarded (terminal)")
    .action((id) =>
      console.log(JSON.stringify(discardObservationV2(id), null, 2)),
    );

  instinct
    .command("auto-dormant-idle-profiles-v2")
    .description("Flip idle active profiles → dormant")
    .action(() =>
      console.log(JSON.stringify(autoDormantIdleProfilesV2(), null, 2)),
    );

  instinct
    .command("auto-discard-stale-observations-v2")
    .description("Flip stale captured/reviewed → discarded")
    .action(() =>
      console.log(JSON.stringify(autoDiscardStaleObservationsV2(), null, 2)),
    );
}
