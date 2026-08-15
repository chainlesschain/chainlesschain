/**
 * cc permissions — inspect, dry-run, and edit the `.claude/settings.json`
 * permission ruleset (Claude-Code `permissions.{allow,ask,deny}` parity).
 *
 *   cc permissions list [--json]                merged ruleset + source file
 *   cc permissions test <tool> <args...>        dry-run: which rule decides?
 *   cc permissions add <allow|ask|deny> <rule>  append a rule to a settings file
 *   cc permissions allow|ask|deny <rule>        convenience aliases for add
 *   cc permissions scoped <decision> <rule>     add a workspace-bound TTL rule
 *   cc permissions revoke <id> --revision <n>  CAS-revoke a scoped rule
 *       [--local | --user]                      (default target: project)
 *
 * The ruleset is loaded by the shared permission authority resolver and
 * evaluated by permission-rules (deny > ask > allow). Scoped mutations are
 * CLI-owned and live outside the repository; IDE clients call this surface
 * instead of editing authority files directly.
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";

const KIND_COLOR = {
  allow: chalk.green,
  ask: chalk.yellow,
  deny: chalk.red,
};

const RUNTIME_ADVISORY =
  "permission rules are enforced by Agent Core; scoped rules are refreshed before every tool call, while managed host policy and ApprovalGate still apply.";

const DURATION_UNITS = Object.freeze({
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
});

function parseDurationMs(value) {
  const match = String(value || "")
    .trim()
    .toLowerCase()
    .match(/^(\d+)(s|m|h|d)$/);
  if (!match) {
    throw new Error("duration must be an integer followed by s, m, h, or d");
  }
  const duration = Number(match[1]) * DURATION_UNITS[match[2]];
  if (!Number.isSafeInteger(duration) || duration < 1000) {
    throw new Error("duration must be at least 1s and within the safe range");
  }
  return duration;
}

function parseNonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return number;
}

function printRuntimeAdvisory() {
  logger.log(chalk.yellow(RUNTIME_ADVISORY));
}

/** Resolve an umbrella token (Bash) to a concrete tool name for dry-run. */
function resolveConcreteTool(token, groups) {
  const t = String(token || "");
  const lower = t.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(groups, lower)) {
    return groups[lower][0];
  }
  return t;
}

/** Build the tool args object a dry-run target needs from positional args. */
function buildArgs(tool, positional, rulesMod) {
  const joined = positional.join(" ").trim();
  if (rulesMod.COMMAND_TOOLS.has(tool)) return { command: joined };
  if (rulesMod.PATH_TOOLS.has(tool)) return { path: positional[0] || "" };
  if (rulesMod.URL_TOOLS.has(tool)) return { url: positional[0] || "" };
  return {};
}

async function persistPermissionRule(
  decision,
  rule,
  options,
  operation = "add",
) {
  try {
    const kind = String(decision || "").toLowerCase();
    if (!["allow", "ask", "deny"].includes(kind)) {
      logger.error(
        chalk.red(`decision must be allow | ask | deny (got "${decision}")`),
      );
      process.exitCode = 1;
      return;
    }
    const rulesMod = await import("../lib/permission-rules.cjs");
    const mod = rulesMod.default || rulesMod;
    if (!mod.parseRule(rule)) {
      logger.error(
        chalk.red(
          `not a valid rule: "${rule}" (expected Tool or Tool(pattern), e.g. Bash(rm:*))`,
        ),
      );
      process.exitCode = 1;
      return;
    }
    const scope = options.user ? "user" : options.local ? "local" : "project";
    const { addRule } = await import("../lib/settings-loader.cjs");
    const { file, added } = addRule({
      cwd: process.cwd(),
      kind,
      rule,
      scope,
    });
    if (!added) {
      logger.log(chalk.gray(`already present in ${file}: ${kind} ${rule}`));
      return;
    }
    logger.log(
      `${KIND_COLOR[kind].bold("✓ " + kind)} ${rule} ${chalk.gray("→ " + file)}`,
    );
  } catch (err) {
    logger.error(chalk.red(`permissions ${operation} failed: ${err.message}`));
    process.exitCode = 1;
  }
}

export function registerPermissionsCommand(program) {
  const cmd = program
    .command("permissions")
    .alias("perms")
    .description(
      "Inspect / dry-run / edit .claude/settings.json permission rules",
    );

  // ── list ──────────────────────────────────────────────────────────────
  cmd
    .command("list")
    .alias("ls")
    .description(
      "Show the merged permission ruleset and where each rule came from",
    )
    .option("--json", "Output as JSON")
    .option("--settings <file>", "Also merge an explicit settings file")
    .action(async (options) => {
      try {
        const { loadPermissionAuthority } =
          await import("../lib/permission-authority.js");
        const { rules, sources, files, managed, managedFile, scoped } =
          loadPermissionAuthority({
            cwd: process.cwd(),
            settingsFile: options.settings,
          });
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                rules,
                sources,
                files,
                managed,
                managedFile,
                scoped,
                enforcement: {
                  status: "enforced",
                  note: RUNTIME_ADVISORY,
                },
              },
              null,
              2,
            ),
          );
          return;
        }
        printRuntimeAdvisory();
        const total = rules.allow.length + rules.ask.length + rules.deny.length;
        if (total === 0) {
          logger.log(
            chalk.gray(
              'No permission rules. Add one: cc permissions add deny "Bash(rm:*)"\n' +
                "(or create .claude/settings.json with a permissions block)",
            ),
          );
          if (!scoped?.rules?.length) return;
        }
        for (const kind of ["deny", "ask", "allow"]) {
          if (rules[kind].length === 0) continue;
          logger.log(KIND_COLOR[kind].bold(`${kind} (${rules[kind].length})`));
          for (const rule of rules[kind]) {
            const src = sources[`${kind}:${rule}`] || "?";
            logger.log(`  ${rule.padEnd(34)} ${chalk.gray(src)}`);
          }
        }
        if (files.length) {
          logger.log(chalk.dim(`\nsources: ${files.join(", ")}`));
        }
        if (managedFile) {
          logger.log(chalk.yellow(`managed policy: ${managedFile}`));
          if (managed?.allowManagedPermissionRulesOnly) {
            logger.log(
              chalk.yellow("  user/project permission rules disabled"),
            );
          }
          if (
            managed?.disableBypassPermissionsMode === true ||
            managed?.disableBypassPermissionsMode === "disable"
          ) {
            logger.log(chalk.yellow("  bypassPermissions disabled"));
          }
          if (managed?.allowManagedHooksOnly) {
            logger.log(chalk.yellow("  only managed hooks may run"));
          }
          if (managed?.allowManagedMcpServersOnly) {
            logger.log(
              chalk.yellow("  only managed-allowed MCP servers may connect"),
            );
          }
          if (managed?.requireSignedPlugins) {
            logger.log(chalk.yellow("  signed plugin manifests required"));
          }
          if (
            Array.isArray(managed?.allowedPlugins) ||
            Array.isArray(managed?.deniedPlugins) ||
            Array.isArray(managed?.blockedMarketplaces)
          ) {
            logger.log(
              chalk.yellow("  managed plugin supply-chain policy active"),
            );
          }
        }
        if (scoped?.rules?.length) {
          logger.log(chalk.bold("\nworkspace-scoped rules"));
          for (const record of scoped.rules) {
            const status = record.effectiveStatus || record.status;
            const color = status === "active" ? chalk.green : chalk.gray;
            logger.log(
              `  ${color(status.padEnd(28))} ${record.id} r${record.revision} ${record.decision} ${record.rule}`,
            );
          }
          logger.log(chalk.dim(`  authority: ${scoped.file}`));
        }
      } catch (err) {
        logger.error(chalk.red(`permissions list failed: ${err.message}`));
        process.exitCode = 1;
      }
    });

  // ── recent ────────────────────────────────────────────────────────────
  cmd
    .command("recent")
    .alias("denials")
    .description("Show recent policy denials recorded by agent runs")
    .option("-n, --limit <n>", "Number of denials to show", "20")
    .option("--json", "Output as JSON")
    .option("--clear", "Clear the recent denial log")
    .action(async (options) => {
      try {
        const {
          clearRecentDenials,
          formatRecentDenials,
          readRecentDenials,
          recentDenialsPath,
        } = await import("../lib/permission-denial-store.js");
        if (options.clear) {
          const result = clearRecentDenials();
          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            logger.log(chalk.green(`Cleared ${result.file}`));
          }
          return;
        }
        const limit = Math.max(1, Number(options.limit) || 20);
        const denials = readRecentDenials({ limit });
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                file: recentDenialsPath(),
                count: denials.length,
                denials,
              },
              null,
              2,
            ),
          );
          return;
        }
        logger.log(formatRecentDenials(denials));
        logger.log(chalk.gray(`  source: ${recentDenialsPath()}`));
      } catch (err) {
        logger.error(chalk.red(`permissions recent failed: ${err.message}`));
        process.exitCode = 1;
      }
    });

  // ── test (dry-run) ─────────────────────────────────────────────────────
  cmd
    .command("test <tool> [args...]")
    .description(
      'Dry-run a tool call against the ruleset, e.g. permissions test run_shell "git push"',
    )
    .option("--json", "Output as JSON")
    .option("--settings <file>", "Also merge an explicit settings file")
    .action(async (tool, args, options) => {
      try {
        const { ruleSource } = await import("../lib/settings-loader.cjs");
        const { loadPermissionAuthority } =
          await import("../lib/permission-authority.js");
        // .cjs default-export interop: module.exports surfaces as `.default`.
        const rulesMod = await import("../lib/permission-rules.cjs");
        const mod = rulesMod.default || rulesMod;

        const { rules, sources } = loadPermissionAuthority({
          cwd: process.cwd(),
          settingsFile: options.settings,
        });
        const concrete = resolveConcreteTool(tool, mod.TOOL_GROUPS);
        const toolArgs = buildArgs(concrete, args || [], mod);
        const result = mod.evaluatePermissionRules({
          tool: concrete,
          args: toolArgs,
          cwd: process.cwd(),
          rules,
        });
        const decision = result.decision || "fallthrough";
        const source = result.rule
          ? ruleSource(sources, result.decision, result.rule)
          : null;

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                tool: concrete,
                args: toolArgs,
                decision,
                rule: result.rule,
                source,
                enforcement: {
                  status: "dry-run only",
                  note: RUNTIME_ADVISORY,
                },
              },
              null,
              2,
            ),
          );
          return;
        }

        printRuntimeAdvisory();
        const color = KIND_COLOR[result.decision] || chalk.gray;
        logger.log(
          `${chalk.bold(concrete)} ${chalk.gray(JSON.stringify(toolArgs))}`,
        );
        logger.log(`  decision: ${color.bold(decision)}`);
        if (result.rule) {
          logger.log(`  rule:     ${result.rule}`);
          if (source) logger.log(`  source:   ${chalk.gray(source)}`);
        } else {
          logger.log(
            chalk.gray(
              "  no rule matched → falls back to risk-tier / --permission-mode logic",
            ),
          );
        }
      } catch (err) {
        logger.error(chalk.red(`permissions test failed: ${err.message}`));
        process.exitCode = 1;
      }
    });

  // ── add ────────────────────────────────────────────────────────────────
  cmd
    .command("add <decision> <rule>")
    .description("Append a rule (allow|ask|deny) to a settings file")
    .option(
      "--local",
      "Write to .claude/settings.local.json (personal, gitignored)",
    )
    .option("--user", "Write to ~/.claude/settings.json (all projects)")
    .action(async (decision, rule, options) => {
      try {
        const kind = String(decision || "").toLowerCase();
        if (!["allow", "ask", "deny"].includes(kind)) {
          logger.error(
            chalk.red(
              `decision must be allow | ask | deny (got "${decision}")`,
            ),
          );
          process.exitCode = 1;
          return;
        }
        const rulesMod = await import("../lib/permission-rules.cjs");
        const mod = rulesMod.default || rulesMod;
        if (!mod.parseRule(rule)) {
          logger.error(
            chalk.red(
              `not a valid rule: "${rule}" (expected Tool or Tool(pattern), e.g. Bash(rm:*))`,
            ),
          );
          process.exitCode = 1;
          return;
        }

        const scope = options.user
          ? "user"
          : options.local
            ? "local"
            : "project";
        const { addRule } = await import("../lib/settings-loader.cjs");
        const { file, added } = addRule({
          cwd: process.cwd(),
          kind,
          rule,
          scope,
        });
        if (!added) {
          logger.log(chalk.gray(`already present in ${file}: ${kind} ${rule}`));
          return;
        }
        logger.log(
          `${KIND_COLOR[kind].bold("✓ " + kind)} ${rule} ${chalk.gray("→ " + file)}`,
        );
      } catch (err) {
        logger.error(chalk.red(`permissions add failed: ${err.message}`));
        process.exitCode = 1;
      }
    });

  // Explicit decision commands make the management surface easier to script
  // and match the common `allow <rule>` / `deny <rule>` workflow.
  for (const decision of ["allow", "ask", "deny"]) {
    cmd
      .command(`${decision} <rule>`)
      .description(`Append an ${decision} permission rule`)
      .option("--local", "Write to .claude/settings.local.json")
      .option("--user", "Write to ~/.claude/settings.json")
      .action(async (rule, options) => {
        await persistPermissionRule(decision, rule, options, decision);
      });
  }

  cmd
    .command("scoped <decision> <rule>")
    .description(
      "Create a workspace-bound, expiring rule in the CLI security store",
    )
    .requiredOption(
      "--expires-in <duration>",
      "TTL such as 30s, 15m, 2h, or 1d",
    )
    .option("--reason <text>", "Human-readable reason for the grant")
    .option(
      "--expected-generation <n>",
      "Create only if the store generation still matches",
    )
    .option("--json", "Output as JSON")
    .action(async (decision, rule, options) => {
      try {
        const ttlMs = parseDurationMs(options.expiresIn);
        const expectedGeneration =
          options.expectedGeneration === undefined
            ? null
            : parseNonNegativeInteger(
                options.expectedGeneration,
                "expected generation",
              );
        const { ScopedPermissionStore } =
          await import("../lib/scoped-permission-store.js");
        const store = new ScopedPermissionStore({ cwd: process.cwd() });
        const record = store.add({
          decision,
          rule,
          expiresAt: Date.now() + ttlMs,
          reason: options.reason || "",
          expectedGeneration,
        });
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                record,
                authority: {
                  file: store.filePath,
                  workspace: store.workspace,
                },
              },
              null,
              2,
            ),
          );
          return;
        }
        logger.log(
          `${KIND_COLOR[record.decision].bold("✓ scoped " + record.decision)} ${record.rule}`,
        );
        logger.log(
          chalk.gray(
            `  ${record.id} r${record.revision}; expires ${new Date(record.expiresAt).toISOString()}`,
          ),
        );
      } catch (err) {
        logger.error(chalk.red(`permissions scoped failed: ${err.message}`));
        process.exitCode = 1;
      }
    });

  cmd
    .command("revoke <id>")
    .description("Revoke a workspace-scoped rule with revision CAS")
    .requiredOption("--revision <n>", "Expected record revision")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const expectedRevision = parseNonNegativeInteger(
          options.revision,
          "revision",
        );
        const { ScopedPermissionStore } =
          await import("../lib/scoped-permission-store.js");
        const store = new ScopedPermissionStore({ cwd: process.cwd() });
        const record = store.revoke({ id, expectedRevision });
        if (options.json) {
          console.log(JSON.stringify({ record }, null, 2));
          return;
        }
        logger.log(
          chalk.green(
            `Revoked ${record.id} at revision ${record.revision} (${record.rule})`,
          ),
        );
      } catch (err) {
        logger.error(chalk.red(`permissions revoke failed: ${err.message}`));
        process.exitCode = 1;
      }
    });
}
