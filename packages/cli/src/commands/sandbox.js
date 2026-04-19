/**
 * Security Sandbox v2 commands
 * chainlesschain sandbox create|exec|destroy|list|audit|quota|monitor
 */

import chalk from "chalk";
import ora from "ora";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  createSandbox,
  acquireSandbox,
  pruneExpired,
  executeSandbox,
  destroySandbox,
  listSandboxes,
  getAuditLog,
  getSandbox,
  setQuota,
  monitorBehavior,
  // Phase 87 V2
  SANDBOX_STATUS,
  PERMISSION_TYPE,
  RISK_LEVEL,
  QUOTA_TYPE,
  pauseSandboxV2,
  resumeSandboxV2,
  terminateSandboxV2,
  setQuotaTyped,
  enforcePermission,
  checkQuotaV2,
  getRiskLevel,
  calculateRiskScore,
  autoIsolate,
  listIsolations,
  filterAuditLog,
  getSandboxStatsV2,
} from "../lib/sandbox-v2.js";

export function registerSandboxCommand(program) {
  const sandbox = program
    .command("sandbox")
    .description("Security sandbox v2 — isolated agent execution environments");

  // sandbox create <agent-id>
  sandbox
    .command("create")
    .description("Create a new sandbox for an agent")
    .argument("<agent-id>", "Agent ID to sandbox")
    .option("--allow-read <paths>", "Comma-separated allowed read paths")
    .option("--allow-write <paths>", "Comma-separated allowed write paths")
    .option("--allowed-hosts <hosts>", "Comma-separated allowed network hosts")
    .option(
      "--bundle <path>",
      "Agent bundle path — applies bundle sandbox policy, enables scope-aware reuse",
    )
    .option("--scope <scope>", "Sandbox scope override (thread|assistant)")
    .option("--json", "Output as JSON")
    .action(async (agentId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const spinner = ora("Creating sandbox...").start();

        const perms = {};
        if (options.allowRead || options.allowWrite) {
          perms.fileSystem = {
            read: options.allowRead
              ? options.allowRead.split(",").map((p) => p.trim())
              : ["/tmp"],
            write: options.allowWrite
              ? options.allowWrite.split(",").map((p) => p.trim())
              : ["/tmp"],
            denied: ["/etc", "/usr", "/sys"],
          };
        }
        if (options.allowedHosts) {
          perms.network = {
            allowed: options.allowedHosts.split(",").map((h) => h.trim()),
            denied: [],
            maxConnections: 10,
          };
        }

        const sandboxOpts =
          Object.keys(perms).length > 0 ? { permissions: perms } : {};

        let bundle = null;
        if (options.bundle) {
          try {
            const { loadAgentBundle } =
              await import("@chainlesschain/session-core/agent-bundle-loader");
            bundle = loadAgentBundle(options.bundle);
          } catch (err) {
            spinner.fail(`Failed to load bundle: ${err.message}`);
            process.exit(1);
          }
        }
        if (options.scope) {
          sandboxOpts.policy = {
            ...(sandboxOpts.policy || {}),
            scope: options.scope,
          };
        }

        const result =
          bundle || options.scope
            ? acquireSandbox(db, agentId, { ...sandboxOpts, bundle })
            : createSandbox(db, agentId, sandboxOpts);
        spinner.succeed(result.reused ? "Sandbox reused" : "Sandbox created");

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(
            chalk.bold(result.reused ? "Sandbox Reused:" : "Sandbox Created:"),
          );
          logger.log(`  ID:     ${chalk.cyan(result.id)}`);
          if (result.scope) {
            logger.log(`  Scope:  ${chalk.cyan(result.scope)}`);
          }
          logger.log(`  Status: ${chalk.green(result.status)}`);
          if (result.quota) {
            logger.log(
              `  Quota:  CPU=${result.quota.cpu}, Memory=${(result.quota.memory / 1024 / 1024).toFixed(0)}MB`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sandbox exec <sandbox-id> <code>
  sandbox
    .command("exec")
    .description("Execute code within a sandbox")
    .argument("<sandbox-id>", "Sandbox ID")
    .argument("<code>", "Code to execute")
    .option("--json", "Output as JSON")
    .action(async (sandboxId, code, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const spinner = ora("Executing in sandbox...").start();

        const result = executeSandbox(db, sandboxId, code);
        spinner.succeed("Execution complete");

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(chalk.bold("Execution Result:"));
          logger.log(`  Output:    ${result.output}`);
          logger.log(
            `  Exit Code: ${result.exitCode === 0 ? chalk.green(0) : chalk.red(result.exitCode)}`,
          );
          logger.log(`  Duration:  ${result.duration}ms`);
          logger.log(`  CPU Used:  ${result.resourceUsage.cpu}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sandbox destroy <sandbox-id>
  sandbox
    .command("destroy")
    .description("Destroy a sandbox")
    .argument("<sandbox-id>", "Sandbox ID to destroy")
    .option("--json", "Output as JSON")
    .action(async (sandboxId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();

        const result = destroySandbox(db, sandboxId);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(chalk.yellow(`Sandbox ${sandboxId} destroyed.`));
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sandbox list
  sandbox
    .command("list")
    .description("List active sandboxes")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const sandboxes = listSandboxes(db);

        if (options.json) {
          console.log(JSON.stringify(sandboxes, null, 2));
        } else if (sandboxes.length === 0) {
          logger.info("No active sandboxes.");
        } else {
          logger.log(chalk.bold(`Active Sandboxes (${sandboxes.length}):\n`));
          for (const s of sandboxes) {
            logger.log(`  ${chalk.cyan(s.id)}`);
            logger.log(
              `    Agent: ${s.agentId}  Status: ${chalk.green(s.status)}`,
            );
            logger.log(
              `    CPU: ${s.resourceUsage.cpu}/${s.quota.cpu}  Memory: ${s.resourceUsage.memory}/${s.quota.memory}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sandbox audit [sandbox-id]
  sandbox
    .command("audit")
    .description("Show audit log for sandboxes")
    .argument("[sandbox-id]", "Optional sandbox ID to filter")
    .option("--action <name>", "Filter by action type")
    .option("--limit <n>", "Limit entries", parseInt)
    .option("--json", "Output as JSON")
    .action(async (sandboxId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();

        const entries = getAuditLog(db, sandboxId || null, {
          action: options.action,
          limit: options.limit,
        });

        if (options.json) {
          console.log(JSON.stringify(entries, null, 2));
        } else if (entries.length === 0) {
          logger.info("No audit entries found.");
        } else {
          logger.log(chalk.bold(`Audit Log (${entries.length} entries):\n`));
          for (const e of entries) {
            const ts = chalk.gray(e.timestamp);
            const action = chalk.yellow(e.action);
            logger.log(`  ${ts}  ${action}  sandbox=${e.sandboxId}`);
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sandbox quota <sandbox-id>
  sandbox
    .command("quota")
    .description("Show or set sandbox quota")
    .argument("<sandbox-id>", "Sandbox ID")
    .option("--cpu <n>", "Set CPU quota", parseInt)
    .option("--memory <n>", "Set memory quota in MB", parseInt)
    .option("--json", "Output as JSON")
    .action(async (sandboxId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();

        if (options.cpu || options.memory) {
          const current = getSandbox(db, sandboxId);
          if (!current) {
            logger.error("Sandbox not found");
            process.exit(1);
          }
          const newQuota = { ...current.quota };
          if (options.cpu) newQuota.cpu = options.cpu;
          if (options.memory) newQuota.memory = options.memory * 1024 * 1024;

          const result = setQuota(db, sandboxId, newQuota);
          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            logger.log(chalk.green("Quota updated."));
            logger.log(
              `  CPU: ${newQuota.cpu}  Memory: ${(newQuota.memory / 1024 / 1024).toFixed(0)}MB`,
            );
          }
        } else {
          const info = getSandbox(db, sandboxId);
          if (!info) {
            logger.error("Sandbox not found");
            process.exit(1);
          }
          if (options.json) {
            console.log(
              JSON.stringify(
                { quota: info.quota, resourceUsage: info.resourceUsage },
                null,
                2,
              ),
            );
          } else {
            logger.log(chalk.bold("Quota:"));
            logger.log(
              `  CPU:     ${info.resourceUsage.cpu} / ${info.quota.cpu}`,
            );
            logger.log(
              `  Memory:  ${info.resourceUsage.memory} / ${info.quota.memory}`,
            );
            logger.log(
              `  Storage: ${info.resourceUsage.storage} / ${info.quota.storage}`,
            );
            logger.log(
              `  Network: ${info.resourceUsage.network} / ${info.quota.network}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sandbox monitor <sandbox-id>
  sandbox
    .command("monitor")
    .description("Monitor sandbox behavior and detect suspicious patterns")
    .argument("<sandbox-id>", "Sandbox ID to monitor")
    .option("--json", "Output as JSON")
    .action(async (sandboxId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const spinner = ora("Analyzing behavior...").start();

        const result = monitorBehavior(db, sandboxId);
        spinner.succeed("Analysis complete");

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(chalk.bold("Behavior Analysis:"));
          logger.log(`  Total Events: ${result.totalEvents}`);
          const riskColor =
            result.riskScore > 50
              ? chalk.red
              : result.riskScore > 20
                ? chalk.yellow
                : chalk.green;
          logger.log(`  Risk Score:   ${riskColor(result.riskScore)}/100`);

          if (result.patterns.length > 0) {
            logger.log(chalk.bold("\n  Detected Patterns:"));
            for (const p of result.patterns) {
              const sev =
                p.severity === "high"
                  ? chalk.red(p.severity)
                  : chalk.yellow(p.severity);
              logger.log(
                `    - ${p.type} (count: ${p.count}, severity: ${sev})`,
              );
            }
          } else {
            logger.log(chalk.green("\n  No suspicious patterns detected."));
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sandbox prune — Phase 4 TTL / idle sweep
  sandbox
    .command("prune")
    .description(
      "Destroy sandboxes whose ttl or idle-ttl has expired (Phase 4)",
    )
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();

        const destroyed = pruneExpired(db);

        if (options.json) {
          console.log(JSON.stringify({ destroyed }, null, 2));
        } else if (destroyed.length === 0) {
          logger.info("No expired sandboxes.");
        } else {
          logger.log(chalk.bold(`Pruned ${destroyed.length} sandbox(es):`));
          for (const d of destroyed) {
            logger.log(
              `  ${chalk.cyan(d.id)}  reason=${chalk.yellow(d.reason)}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ═════════════════════════════════════════════════════════════════
  // Phase 87 — Agent Security Sandbox 2.0 subcommands
  // ═════════════════════════════════════════════════════════════════

  // sandbox statuses
  sandbox
    .command("statuses")
    .description("List sandbox lifecycle status enum values (Phase 87)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const values = Object.values(SANDBOX_STATUS);
      if (options.json) console.log(JSON.stringify(values, null, 2));
      else values.forEach((v) => logger.log(`  ${chalk.cyan(v)}`));
    });

  // sandbox permission-types
  sandbox
    .command("permission-types")
    .description("List permission type enum values (Phase 87)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const values = Object.values(PERMISSION_TYPE);
      if (options.json) console.log(JSON.stringify(values, null, 2));
      else values.forEach((v) => logger.log(`  ${chalk.cyan(v)}`));
    });

  // sandbox risk-levels
  sandbox
    .command("risk-levels")
    .description("List risk level enum values (Phase 87)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const values = Object.values(RISK_LEVEL);
      if (options.json) console.log(JSON.stringify(values, null, 2));
      else values.forEach((v) => logger.log(`  ${chalk.cyan(v)}`));
    });

  // sandbox quota-types
  sandbox
    .command("quota-types")
    .description("List quota type enum values (Phase 87)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const values = Object.values(QUOTA_TYPE);
      if (options.json) console.log(JSON.stringify(values, null, 2));
      else values.forEach((v) => logger.log(`  ${chalk.cyan(v)}`));
    });

  // sandbox pause <id>
  sandbox
    .command("pause")
    .description("Pause a running sandbox (Phase 87)")
    .argument("<id>", "Sandbox ID")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const r = pauseSandboxV2(db, id);
        if (options.json) console.log(JSON.stringify(r, null, 2));
        else
          logger.log(
            `${chalk.green("✓ Paused")} ${chalk.cyan(id)} (was ${chalk.yellow(r.previousStatus)})`,
          );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sandbox resume <id>
  sandbox
    .command("resume")
    .description("Resume a paused sandbox (Phase 87)")
    .argument("<id>", "Sandbox ID")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const r = resumeSandboxV2(db, id);
        if (options.json) console.log(JSON.stringify(r, null, 2));
        else logger.log(`${chalk.green("✓ Resumed")} ${chalk.cyan(id)}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sandbox terminate <id>
  sandbox
    .command("terminate")
    .description(
      "Terminate a sandbox (Phase 87 canonical; more explicit than destroy)",
    )
    .argument("<id>", "Sandbox ID")
    .option("--reason <reason>", "Termination reason", "manual")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const r = terminateSandboxV2(db, id, options.reason);
        if (options.json) console.log(JSON.stringify(r, null, 2));
        else
          logger.log(
            `${chalk.green("✓ Terminated")} ${chalk.cyan(id)} reason=${chalk.yellow(r.reason)}`,
          );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sandbox set-quota-typed <id> <type> <limit>
  sandbox
    .command("set-quota-typed")
    .description("Set a single quota by type (Phase 87)")
    .argument("<id>", "Sandbox ID")
    .argument(
      "<type>",
      "Quota type (cpu_percent|memory_mb|disk_mb|network_kbps|process_count)",
    )
    .argument("<limit>", "Numeric limit")
    .option("--json", "Output as JSON")
    .action(async (id, type, limit, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const r = setQuotaTyped(db, id, type, Number(limit));
        if (options.json) console.log(JSON.stringify(r, null, 2));
        else
          logger.log(
            `${chalk.green("✓ Quota set")} ${chalk.cyan(id)} ${type}=${chalk.yellow(limit)}`,
          );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sandbox check-permission <id> <type> <target>
  sandbox
    .command("check-permission")
    .description(
      "Check whether a sandbox may perform a permission op (Phase 87)",
    )
    .argument("<id>", "Sandbox ID")
    .argument(
      "<type>",
      "Permission type (filesystem|network|syscall|ipc|process)",
    )
    .argument("<target>", "Target (path / host / syscall name)")
    .option("--mode <mode>", "File mode (read|write)", "read")
    .option("--json", "Output as JSON")
    .action(async (id, type, target, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const sandbox = getSandbox(db, id);
        if (!sandbox) {
          logger.error(`Sandbox not found: ${id}`);
          await shutdown();
          process.exit(1);
          return;
        }
        const r = enforcePermission(sandbox, {
          type,
          target,
          mode: options.mode,
        });
        if (options.json) console.log(JSON.stringify(r, null, 2));
        else
          logger.log(
            `${r.allowed ? chalk.green("allowed") : chalk.red("denied")} ${type} ${options.mode} ${target}`,
          );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sandbox check-quota <id> <type> [amount]
  sandbox
    .command("check-quota")
    .description("Check quota availability for a type (Phase 87)")
    .argument("<id>", "Sandbox ID")
    .argument("<type>", "Quota type")
    .argument("[amount]", "Amount to check", "0")
    .option("--json", "Output as JSON")
    .action(async (id, type, amount, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const sandbox = getSandbox(db, id);
        if (!sandbox) {
          logger.error(`Sandbox not found: ${id}`);
          await shutdown();
          process.exit(1);
          return;
        }
        const r = checkQuotaV2(sandbox, type, Number(amount));
        if (options.json) console.log(JSON.stringify(r, null, 2));
        else
          logger.log(
            `${r.ok ? chalk.green("ok") : chalk.red("exceeded")} ${type}: ${r.current}/${r.limit ?? "∞"} (remaining ${r.remaining})`,
          );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sandbox risk-score <id>
  sandbox
    .command("risk-score")
    .description("Compute risk score + risk level for a sandbox (Phase 87)")
    .argument("<id>", "Sandbox ID")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const r = calculateRiskScore(db, id);
        if (options.json) console.log(JSON.stringify(r, null, 2));
        else {
          const color =
            r.riskLevel === RISK_LEVEL.CRITICAL
              ? chalk.red
              : r.riskLevel === RISK_LEVEL.HIGH
                ? chalk.magenta
                : r.riskLevel === RISK_LEVEL.MEDIUM
                  ? chalk.yellow
                  : chalk.green;
          logger.log(
            `risk=${color(r.riskLevel)}  score=${chalk.cyan(r.riskScore)}  patterns=${r.patterns.length}  events=${r.totalEvents}`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sandbox risk-level <score>
  sandbox
    .command("risk-level")
    .description("Map a risk score to a RISK_LEVEL bucket (Phase 87)")
    .argument("<score>", "Numeric score 0-100")
    .option("--json", "Output as JSON")
    .action((score, options) => {
      const level = getRiskLevel(Number(score));
      if (options.json)
        console.log(JSON.stringify({ score: Number(score), level }, null, 2));
      else logger.log(`score=${score} → ${chalk.cyan(level)}`);
    });

  // sandbox auto-isolate <id>
  sandbox
    .command("auto-isolate")
    .description("Auto-isolate a sandbox: record + terminate (Phase 87)")
    .argument("<id>", "Sandbox ID")
    .option("--reason <reason>", "Isolation reason", "high-risk")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const entry = autoIsolate(db, id, options.reason);
        if (options.json) console.log(JSON.stringify(entry, null, 2));
        else
          logger.log(
            `${chalk.red("⊘ Isolated")} ${chalk.cyan(id)} reason=${chalk.yellow(entry.reason)} at ${entry.isolatedAt}`,
          );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sandbox isolations
  sandbox
    .command("isolations")
    .description("List isolation records (Phase 87)")
    .option("-s, --sandbox <id>", "Filter by sandbox ID")
    .option("--reason <reason>", "Filter by reason")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        await bootstrap({ verbose: program.opts().verbose });
        const items = listIsolations({
          sandboxId: options.sandbox,
          reason: options.reason,
        });
        if (options.json) console.log(JSON.stringify(items, null, 2));
        else if (items.length === 0) logger.info("No isolation records.");
        else
          items.forEach((i) =>
            logger.log(
              `  ${chalk.cyan(i.sandboxId)}  reason=${chalk.yellow(i.reason)}  at=${i.isolatedAt}`,
            ),
          );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sandbox audit-filter <id>
  sandbox
    .command("audit-filter")
    .description("Filter audit log by event types / time range (Phase 87)")
    .argument("[id]", "Sandbox ID (omit for all)")
    .option("-e, --events <types>", "Comma-separated event types")
    .option("--from <iso>", "ISO timestamp lower bound")
    .option("--to <iso>", "ISO timestamp upper bound")
    .option("-l, --limit <n>", "Max entries to return", parseInt)
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = ctx.db.getDatabase();
        const filter = {};
        if (options.events)
          filter.eventTypes = options.events.split(",").map((s) => s.trim());
        if (options.from || options.to)
          filter.timeRange = { from: options.from, to: options.to };
        if (options.limit) filter.limit = options.limit;
        const entries = filterAuditLog(db, id, filter);
        if (options.json) console.log(JSON.stringify(entries, null, 2));
        else if (entries.length === 0)
          logger.info("No matching audit entries.");
        else
          entries.forEach((e) =>
            logger.log(
              `  ${chalk.gray(e.timestamp)}  ${chalk.cyan(e.sandboxId)}  ${chalk.yellow(e.action)}`,
            ),
          );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sandbox stats-v2
  sandbox
    .command("stats-v2")
    .description(
      "Extended V2 stats (byStatus / auditByAction / isolations) (Phase 87)",
    )
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        await bootstrap({ verbose: program.opts().verbose });
        const stats = getSandboxStatsV2();
        if (options.json) console.log(JSON.stringify(stats, null, 2));
        else {
          logger.log(chalk.bold("Sandbox stats (Phase 87):"));
          logger.log(`  total: ${chalk.cyan(stats.totalSandboxes)}`);
          logger.log(`  by status:`);
          for (const [k, v] of Object.entries(stats.byStatus))
            logger.log(`    ${k}: ${chalk.cyan(v)}`);
          logger.log(`  audit events: ${chalk.cyan(stats.auditEventCount)}`);
          logger.log(
            `  isolations: total=${chalk.cyan(stats.isolations.total)}`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}

// === Iter16 V2 governance overlay ===
export function registerSboxGovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "sandbox");
  if (!parent) return;
  const L = async () => await import("../lib/sandbox-v2.js");
  parent
    .command("sbox-gov-enums-v2")
    .description("Show V2 enums (sbox maturity + exec lifecycle)")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.SBOX_PROFILE_MATURITY_V2,
            execLifecycle: m.SBOX_EXEC_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("sbox-gov-config-v2")
    .description("Show V2 config thresholds")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveSboxProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingSboxExecsPerProfileV2(),
            idleMs: m.getSboxProfileIdleMsV2(),
            stuckMs: m.getSboxExecStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("sbox-gov-set-max-active-v2 <n>")
    .description("Set max active profiles per owner")
    .action(async (n) => {
      const m = await L();
      m.setMaxActiveSboxProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("sbox-gov-set-max-pending-v2 <n>")
    .description("Set max pending execs per profile")
    .action(async (n) => {
      const m = await L();
      m.setMaxPendingSboxExecsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("sbox-gov-set-idle-ms-v2 <n>")
    .description("Set profile idle threshold (ms)")
    .action(async (n) => {
      const m = await L();
      m.setSboxProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("sbox-gov-set-stuck-ms-v2 <n>")
    .description("Set exec stuck threshold (ms)")
    .action(async (n) => {
      const m = await L();
      m.setSboxExecStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("sbox-gov-register-v2 <id> <owner>")
    .description("Register V2 sbox profile")
    .option("--template <v>", "template")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerSboxProfileV2({ id, owner, template: o.template }),
          null,
          2,
        ),
      );
    });
  parent
    .command("sbox-gov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.activateSboxProfileV2(id), null, 2));
    });
  parent
    .command("sbox-gov-pause-v2 <id>")
    .description("Pause profile")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.pauseSboxProfileV2(id), null, 2));
    });
  parent
    .command("sbox-gov-archive-v2 <id>")
    .description("Archive profile (terminal)")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.archiveSboxProfileV2(id), null, 2));
    });
  parent
    .command("sbox-gov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.touchSboxProfileV2(id), null, 2));
    });
  parent
    .command("sbox-gov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.getSboxProfileV2(id), null, 2));
    });
  parent
    .command("sbox-gov-list-v2")
    .description("List profiles")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.listSboxProfilesV2(), null, 2));
    });
  parent
    .command("sbox-gov-create-exec-v2 <id> <profileId>")
    .description("Create exec (queued)")
    .option("--command <v>", "command")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createSboxExecV2({ id, profileId, command: o.command }),
          null,
          2,
        ),
      );
    });
  parent
    .command("sbox-gov-running-exec-v2 <id>")
    .description("Mark exec as running")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.runningSboxExecV2(id), null, 2));
    });
  parent
    .command("sbox-gov-complete-exec-v2 <id>")
    .description("Complete exec")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.completeExecSboxV2(id), null, 2));
    });
  parent
    .command("sbox-gov-fail-exec-v2 <id> [reason]")
    .description("Fail exec")
    .action(async (id, reason) => {
      const m = await L();
      console.log(JSON.stringify(m.failSboxExecV2(id, reason), null, 2));
    });
  parent
    .command("sbox-gov-cancel-exec-v2 <id> [reason]")
    .description("Cancel exec")
    .action(async (id, reason) => {
      const m = await L();
      console.log(JSON.stringify(m.cancelSboxExecV2(id, reason), null, 2));
    });
  parent
    .command("sbox-gov-get-exec-v2 <id>")
    .description("Get exec")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.getSboxExecV2(id), null, 2));
    });
  parent
    .command("sbox-gov-list-execs-v2")
    .description("List execs")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.listSboxExecsV2(), null, 2));
    });
  parent
    .command("sbox-gov-auto-pause-idle-v2")
    .description("Auto-pause idle profiles")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.autoPauseIdleSboxProfilesV2(), null, 2));
    });
  parent
    .command("sbox-gov-auto-fail-stuck-v2")
    .description("Auto-fail stuck execs")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.autoFailStuckSboxExecsV2(), null, 2));
    });
  parent
    .command("sbox-gov-gov-stats-v2")
    .description("V2 gov aggregate stats")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.getSandboxGovStatsV2(), null, 2));
    });
}
