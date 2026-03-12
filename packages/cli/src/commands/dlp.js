/**
 * DLP commands
 * chainlesschain dlp scan|incidents|resolve|stats|policy
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureDLPTables,
  scanContent,
  listIncidents,
  resolveIncident,
  getDLPStats,
  createPolicy,
  updatePolicy,
  deletePolicy,
  listDLPPolicies,
} from "../lib/dlp-engine.js";

export function registerDlpCommand(program) {
  const dlp = program
    .command("dlp")
    .description("Data Loss Prevention — scanning, incidents, policies");

  // dlp scan
  dlp
    .command("scan <content>")
    .description("Scan content for DLP violations")
    .option("-c, --channel <channel>", "Content channel", "cli")
    .option("-u, --user <id>", "User ID", "cli-user")
    .option("--json", "Output as JSON")
    .action(async (content, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDLPTables(db);

        const result = scanContent(db, content, options.channel, options.user);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(
            `  ${chalk.bold("Allowed:")}  ${result.allowed ? chalk.green("Yes") : chalk.red("No")}`,
          );
          logger.log(`  ${chalk.bold("Action:")}   ${result.action}`);
          logger.log(
            `  ${chalk.bold("Matched:")}  ${result.matchedPolicies} policy(ies)`,
          );
          logger.log(
            `  ${chalk.bold("Incidents:")} ${result.incidents.length}`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // dlp incidents
  dlp
    .command("incidents")
    .description("List DLP incidents")
    .option("-c, --channel <channel>", "Filter by channel")
    .option("-s, --severity <level>", "Filter by severity")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDLPTables(db);

        const incidents = listIncidents({
          channel: options.channel,
          severity: options.severity,
        });
        if (options.json) {
          console.log(JSON.stringify(incidents, null, 2));
        } else if (incidents.length === 0) {
          logger.info("No incidents found.");
        } else {
          for (const i of incidents) {
            const resolved = i.resolvedAt
              ? chalk.green("resolved")
              : chalk.yellow("open");
            logger.log(
              `  ${chalk.cyan(i.id.slice(0, 8))} [${i.severity}] ${i.channel} — ${i.actionTaken} ${resolved}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // dlp resolve
  dlp
    .command("resolve <incident-id>")
    .description("Resolve a DLP incident")
    .option("-r, --resolution <text>", "Resolution details", "resolved")
    .action(async (incidentId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDLPTables(db);

        const result = resolveIncident(db, incidentId, options.resolution);
        logger.success(
          `Incident ${chalk.cyan(incidentId.slice(0, 8))} resolved`,
        );

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // dlp stats
  dlp
    .command("stats")
    .description("Show DLP statistics")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDLPTables(db);

        const stats = getDLPStats();
        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          logger.log(`  ${chalk.bold("Scanned:")}    ${stats.scanned}`);
          logger.log(`  ${chalk.bold("Blocked:")}    ${stats.blocked}`);
          logger.log(`  ${chalk.bold("Alerted:")}    ${stats.alerted}`);
          logger.log(`  ${chalk.bold("Incidents:")}  ${stats.totalIncidents}`);
          logger.log(
            `  ${chalk.bold("Unresolved:")} ${stats.unresolvedIncidents}`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // dlp policy
  const policy = dlp.command("policy").description("DLP policy management");

  policy
    .command("create <name>")
    .description("Create a DLP policy")
    .option("-p, --patterns <patterns>", "Regex patterns (comma-separated)")
    .option("-k, --keywords <keywords>", "Keywords (comma-separated)")
    .option(
      "-a, --action <action>",
      "Action: allow, alert, block, quarantine",
      "alert",
    )
    .option("-s, --severity <level>", "Severity: low, medium, high", "medium")
    .action(async (name, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDLPTables(db);

        const patterns = options.patterns
          ? options.patterns.split(",").map((s) => s.trim())
          : [];
        const keywords = options.keywords
          ? options.keywords.split(",").map((s) => s.trim())
          : [];
        const result = createPolicy(
          db,
          name,
          patterns,
          keywords,
          options.action,
          options.severity,
        );
        logger.success("Policy created");
        logger.log(`  ${chalk.bold("ID:")}       ${chalk.cyan(result.id)}`);
        logger.log(`  ${chalk.bold("Name:")}     ${result.name}`);
        logger.log(`  ${chalk.bold("Action:")}   ${result.action}`);
        logger.log(`  ${chalk.bold("Severity:")} ${result.severity}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  policy
    .command("list")
    .description("List DLP policies")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDLPTables(db);

        const policies = listDLPPolicies();
        if (options.json) {
          console.log(JSON.stringify(policies, null, 2));
        } else if (policies.length === 0) {
          logger.info("No DLP policies configured.");
        } else {
          for (const p of policies) {
            logger.log(
              `  ${chalk.cyan(p.id.slice(0, 8))} ${p.name} [${p.action}] severity=${p.severity} enabled=${p.enabled}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  policy
    .command("delete <policy-id>")
    .description("Delete a DLP policy")
    .action(async (policyId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDLPTables(db);

        deletePolicy(db, policyId);
        logger.success(`Policy ${chalk.cyan(policyId.slice(0, 8))} deleted`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
