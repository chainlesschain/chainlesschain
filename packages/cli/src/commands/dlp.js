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
  DLP_ACTION,
  DLP_CHANNEL,
  DLP_SEVERITY,
  DLP_DEFAULT_MAX_CONTENT_SIZE,
  createPolicyV2,
  getPolicyV2,
  listActivePoliciesForChannel,
  scanContentV2,
  listIncidentsV2,
  getIncidentV2,
  listBuiltinPolicyTemplates,
  installBuiltinPolicies,
  getDLPStatsV2,
  getHighestUnresolvedSeverity,
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

  // ═══════════════════════════════════════════════════════════════
  // V2 Canonical Subcommands (Phase 50)
  // ═══════════════════════════════════════════════════════════════

  dlp
    .command("actions")
    .description("List DLP actions (V2)")
    .action(() => {
      console.log(JSON.stringify(Object.values(DLP_ACTION), null, 2));
    });

  dlp
    .command("channels")
    .description("List DLP channels (V2)")
    .action(() => {
      console.log(JSON.stringify(Object.values(DLP_CHANNEL), null, 2));
    });

  dlp
    .command("severities")
    .description("List DLP severity levels (V2)")
    .action(() => {
      console.log(JSON.stringify(Object.values(DLP_SEVERITY), null, 2));
    });

  dlp
    .command("default-max-size")
    .description("Show default DLP scan size limit in bytes (V2)")
    .action(() => {
      console.log(JSON.stringify({ bytes: DLP_DEFAULT_MAX_CONTENT_SIZE }));
    });

  // policy-v2 create — channel-aware + description
  policy
    .command("create-v2 <name>")
    .description("Create a V2 policy with channel filter + description")
    .option("-d, --description <text>", "Description", "")
    .option(
      "-c, --channels <list>",
      "Comma-separated channels (empty = all)",
      "",
    )
    .option("-p, --patterns <list>", "Comma-separated regex patterns", "")
    .option("-k, --keywords <list>", "Comma-separated keywords", "")
    .option("-a, --action <action>", "Action", "alert")
    .option("-s, --severity <level>", "Severity", "medium")
    .action(async (name, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDLPTables(db);

        const result = createPolicyV2(db, {
          name,
          description: options.description,
          channels: options.channels
            ? options.channels
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
          patterns: options.patterns
            ? options.patterns
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
          keywords: options.keywords
            ? options.keywords
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
          action: options.action,
          severity: options.severity,
        });
        console.log(JSON.stringify(result, null, 2));

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  policy
    .command("show-v2 <policy-id>")
    .description("Show V2 policy with description + channels")
    .action(async (policyId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDLPTables(db);

        console.log(JSON.stringify(getPolicyV2(policyId), null, 2));

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  policy
    .command("active-for <channel>")
    .description("List active V2 policies applicable to a channel")
    .action(async (channel) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDLPTables(db);

        console.log(
          JSON.stringify(listActivePoliciesForChannel(channel), null, 2),
        );

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // Built-in templates
  const templates = dlp
    .command("templates")
    .description("Built-in policy templates");

  templates
    .command("list")
    .description("List built-in policy templates")
    .action(() => {
      console.log(JSON.stringify(listBuiltinPolicyTemplates(), null, 2));
    });

  templates
    .command("install [names...]")
    .description("Install built-in policy templates (all if no names given)")
    .action(async (names) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDLPTables(db);

        const installed = installBuiltinPolicies(
          db,
          names && names.length > 0 ? names : undefined,
        );
        console.log(JSON.stringify(installed, null, 2));

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // scan-v2 — channel filter + size gate + metadata
  dlp
    .command("scan-v2 <content>")
    .description("Scan content with V2 channel filter + metadata")
    .option("-c, --channel <channel>", "Channel")
    .option("-u, --user <id>", "User ID")
    .option("-m, --metadata <json>", "Metadata JSON", "{}")
    .option("--max-size <bytes>", "Override max content size")
    .action(async (content, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDLPTables(db);

        let metadata = {};
        try {
          metadata = JSON.parse(options.metadata);
        } catch (_err) {
          logger.error("Invalid --metadata JSON");
          process.exit(1);
        }
        const result = scanContentV2(db, {
          content,
          channel: options.channel,
          userId: options.user,
          metadata,
          maxContentSize: options.maxSize ? Number(options.maxSize) : undefined,
        });
        console.log(JSON.stringify(result, null, 2));

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // incidents-v2 — rich filter
  dlp
    .command("incidents-v2")
    .description(
      "List V2 incidents (channel/severity/resolved/user/policy/date)",
    )
    .option("-c, --channel <channel>", "Filter by channel")
    .option("-s, --severity <level>", "Filter by severity")
    .option("-r, --resolved <bool>", "Filter by resolved (true/false)")
    .option("-u, --user <id>", "Filter by userId")
    .option("-p, --policy <id>", "Filter by policyId")
    .option("--from <iso>", "fromDate ISO string")
    .option("--to <iso>", "toDate ISO string")
    .option("-l, --limit <n>", "Limit", "50")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDLPTables(db);

        const filter = {};
        if (options.channel) filter.channel = options.channel;
        if (options.severity) filter.severity = options.severity;
        if (options.resolved === "true") filter.resolved = true;
        else if (options.resolved === "false") filter.resolved = false;
        if (options.user) filter.userId = options.user;
        if (options.policy) filter.policyId = options.policy;
        if (options.from) filter.fromDate = options.from;
        if (options.to) filter.toDate = options.to;
        filter.limit = Number(options.limit);
        console.log(JSON.stringify(listIncidentsV2(filter), null, 2));

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  dlp
    .command("incident-v2 <incident-id>")
    .description("Show V2 incident with metadata")
    .action(async (incidentId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDLPTables(db);

        console.log(JSON.stringify(getIncidentV2(incidentId), null, 2));

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  dlp
    .command("stats-v2")
    .description(
      "Show V2 DLP stats (byAction/bySeverity/byChannel/topPolicies)",
    )
    .action(async () => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDLPTables(db);

        console.log(JSON.stringify(getDLPStatsV2(), null, 2));

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  dlp
    .command("highest-severity")
    .description("Show highest unresolved incident severity (V2)")
    .action(async () => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureDLPTables(db);

        console.log(
          JSON.stringify({ highestSeverity: getHighestUnresolvedSeverity() }),
        );

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
