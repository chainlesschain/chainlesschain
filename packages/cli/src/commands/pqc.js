/**
 * PQC commands
 * chainlesschain pqc keys|generate|migration-status|migrate
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensurePQCTables,
  listKeys,
  generateKey,
  getMigrationStatus,
  migrate,
  listAlgorithms,
} from "../lib/pqc-manager.js";

export function registerPqcCommand(program) {
  const pqc = program
    .command("pqc")
    .description("Post-quantum cryptography — key management and migration");

  // pqc keys
  pqc
    .command("keys")
    .description("List PQC keys")
    .option("-a, --algorithm <algo>", "Filter by algorithm")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensurePQCTables(db);

        const keys = listKeys({ algorithm: options.algorithm });
        if (options.json) {
          console.log(JSON.stringify(keys, null, 2));
        } else if (keys.length === 0) {
          logger.info("No PQC keys. Use `pqc generate` to create one.");
        } else {
          for (const k of keys) {
            logger.log(
              `  ${chalk.cyan(k.id.slice(0, 8))} ${k.algorithm} [${k.purpose}] size=${k.keySize} hybrid=${k.hybridMode}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // pqc generate
  pqc
    .command("generate <algorithm>")
    .description("Generate a PQC key pair")
    .option(
      "-p, --purpose <purpose>",
      "Key purpose: encryption, signing, key_exchange",
      "encryption",
    )
    .action(async (algorithm, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensurePQCTables(db);

        const key = generateKey(db, algorithm, options.purpose);
        logger.success("PQC key generated");
        logger.log(`  ${chalk.bold("ID:")}        ${chalk.cyan(key.id)}`);
        logger.log(`  ${chalk.bold("Algorithm:")} ${key.algorithm}`);
        logger.log(`  ${chalk.bold("Purpose:")}   ${key.purpose}`);
        logger.log(`  ${chalk.bold("Key Size:")}  ${key.keySize}`);
        logger.log(`  ${chalk.bold("Hybrid:")}    ${key.hybridMode}`);
        if (key.classicalAlgorithm) {
          logger.log(`  ${chalk.bold("Classical:")} ${key.classicalAlgorithm}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // pqc migration-status
  pqc
    .command("migration-status")
    .description("Show PQC migration status")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensurePQCTables(db);

        const plans = getMigrationStatus();
        if (options.json) {
          console.log(JSON.stringify(plans, null, 2));
        } else if (plans.length === 0) {
          logger.info("No migration plans.");
        } else {
          for (const p of plans) {
            logger.log(
              `  ${chalk.cyan(p.id.slice(0, 8))} ${p.planName} ${p.sourceAlgorithm}→${p.targetAlgorithm} [${p.status}] ${p.migratedKeys}/${p.totalKeys}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // pqc algorithms
  pqc
    .command("algorithms")
    .description("List supported PQC algorithms (FIPS 203/204/205 + hybrid)")
    .option(
      "-f, --family <family>",
      "Filter by family: ml-kem|ml-dsa|slh-dsa|hybrid",
    )
    .option("--json", "Output as JSON")
    .action((options) => {
      try {
        const algos = listAlgorithms({ family: options.family });
        if (options.json) {
          console.log(JSON.stringify(algos, null, 2));
          return;
        }
        if (algos.length === 0) {
          logger.info("No algorithms match filter.");
          return;
        }
        for (const a of algos) {
          const sig =
            a.signatureBytes != null ? `sig=${a.signatureBytes}B` : "sig=—";
          logger.log(
            `  ${chalk.cyan(a.algorithm.padEnd(26))} ${chalk.dim(a.family.padEnd(8))} lvl=${a.keySize} pk=${a.publicKeyBytes}B ${sig}`,
          );
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // pqc migrate
  pqc
    .command("migrate <plan-name> <target-algorithm>")
    .description("Execute PQC key migration")
    .option("-s, --source <algorithm>", "Source algorithm to migrate from")
    .action(async (planName, targetAlgorithm, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensurePQCTables(db);

        const plan = migrate(db, planName, options.source, targetAlgorithm);
        logger.success("Migration completed");
        logger.log(`  ${chalk.bold("ID:")}       ${chalk.cyan(plan.id)}`);
        logger.log(`  ${chalk.bold("Plan:")}     ${plan.planName}`);
        logger.log(`  ${chalk.bold("Source:")}   ${plan.sourceAlgorithm}`);
        logger.log(`  ${chalk.bold("Target:")}   ${plan.targetAlgorithm}`);
        logger.log(
          `  ${chalk.bold("Migrated:")} ${plan.migratedKeys}/${plan.totalKeys}`,
        );
        logger.log(`  ${chalk.bold("Status:")}   ${plan.status}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
