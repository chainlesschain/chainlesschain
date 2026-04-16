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
}
