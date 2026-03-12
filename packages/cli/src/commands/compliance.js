/**
 * Compliance commands
 * chainlesschain compliance evidence|report|classify|scan|policies|check-access
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureComplianceTables,
  collectEvidence,
  generateReport,
  classifyData,
  scanCompliance,
  listPolicies,
  addPolicy,
  checkAccess,
} from "../lib/compliance-manager.js";

export function registerComplianceCommand(program) {
  const compliance = program
    .command("compliance")
    .description(
      "Compliance management — evidence, reports, scanning, policies",
    );

  // compliance evidence
  compliance
    .command("evidence <framework>")
    .description("Collect compliance evidence (gdpr, soc2, hipaa, iso27001)")
    .option("-t, --type <type>", "Evidence type", "general")
    .option("-d, --description <text>", "Evidence description")
    .option("-s, --source <source>", "Evidence source", "cli")
    .action(async (framework, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureComplianceTables(db);

        const result = collectEvidence(
          db,
          framework,
          options.type,
          options.description,
          options.source,
        );
        logger.success("Evidence collected");
        logger.log(`  ${chalk.bold("ID:")}        ${chalk.cyan(result.id)}`);
        logger.log(`  ${chalk.bold("Framework:")} ${result.framework}`);
        logger.log(`  ${chalk.bold("Type:")}      ${result.type}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // compliance report
  compliance
    .command("report <framework>")
    .description("Generate compliance report")
    .option("-t, --title <title>", "Report title")
    .option("--json", "Output as JSON")
    .action(async (framework, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureComplianceTables(db);

        const result = generateReport(db, framework, options.title);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success("Report generated");
          logger.log(`  ${chalk.bold("ID:")}        ${chalk.cyan(result.id)}`);
          logger.log(`  ${chalk.bold("Title:")}     ${result.title}`);
          logger.log(`  ${chalk.bold("Score:")}     ${result.score}`);
          logger.log(`  ${chalk.bold("Summary:")}   ${result.summary}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // compliance classify
  compliance
    .command("classify <content>")
    .description("Classify data sensitivity")
    .option("--json", "Output as JSON")
    .action(async (content, options) => {
      try {
        const result = classifyData(content);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(
            `  ${chalk.bold("Sensitive:")}       ${result.hasClassifiedData ? "Yes" : "No"}`,
          );
          logger.log(
            `  ${chalk.bold("Classifications:")} ${result.classifications.join(", ") || "none"}`,
          );
          logger.log(
            `  ${chalk.bold("Sensitivity:")}     ${result.sensitivity}`,
          );
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // compliance scan
  compliance
    .command("scan <framework>")
    .description("Scan compliance posture against policies")
    .option("--json", "Output as JSON")
    .action(async (framework, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureComplianceTables(db);

        const result = scanCompliance(db, framework);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(`  ${chalk.bold("Framework:")} ${result.framework}`);
          logger.log(`  ${chalk.bold("Score:")}     ${result.score}%`);
          logger.log(
            `  ${chalk.bold("Passed:")}    ${result.passed}/${result.total}`,
          );
          logger.log(
            `  ${chalk.bold("Failed:")}    ${result.failed}/${result.total}`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // compliance policies
  compliance
    .command("policies")
    .description("List compliance policies")
    .option("--framework <fw>", "Filter by framework")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureComplianceTables(db);

        const policies = listPolicies(db, { framework: options.framework });
        if (options.json) {
          console.log(JSON.stringify(policies, null, 2));
        } else if (policies.length === 0) {
          logger.info("No policies configured.");
        } else {
          for (const p of policies) {
            logger.log(
              `  ${chalk.cyan(p.id.slice(0, 8))} ${p.name} [${p.type}] ${p.framework} severity=${p.severity}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // compliance check-access
  compliance
    .command("check-access <resource> <action> <role>")
    .description("Check RBAC access permission")
    .option("--json", "Output as JSON")
    .action(async (resource, action, role, options) => {
      try {
        const result = checkAccess(resource, action, role);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(
            `  ${chalk.bold("Access:")} ${result.granted ? chalk.green("GRANTED") : chalk.red("DENIED")} (${role} → ${action} on ${resource})`,
          );
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
