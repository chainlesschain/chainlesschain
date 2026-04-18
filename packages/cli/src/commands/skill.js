/**
 * Skill management and execution commands
 * chainlesschain skill list|info|run|search|categories|add|remove|sources
 *
 * Uses multi-layer skill loader:
 *   bundled < marketplace < managed (global) < workspace (project)
 */

import chalk from "chalk";
import ora from "ora";
import fs from "fs";
import path from "path";
import { logger } from "../lib/logger.js";
import {
  CLISkillLoader,
  LAYER_NAMES,
  SKILL_MATURITY_V2,
  EXECUTION_LIFECYCLE_V2,
  getMaxActiveSkillsPerOwnerV2,
  setMaxActiveSkillsPerOwnerV2,
  getMaxPendingExecutionsPerSkillV2,
  setMaxPendingExecutionsPerSkillV2,
  getSkillIdleMsV2,
  setSkillIdleMsV2,
  getExecStuckMsV2,
  setExecStuckMsV2,
  registerSkillV2,
  getSkillV2,
  listSkillsV2,
  setSkillStatusV2,
  activateSkillV2,
  deprecateSkillV2,
  archiveSkillV2,
  touchSkillV2,
  getActiveSkillCountV2,
  createExecutionV2,
  getExecutionV2,
  listExecutionsV2,
  setExecutionStatusV2,
  startExecutionV2,
  succeedExecutionV2,
  failExecutionV2,
  cancelExecutionV2,
  getPendingExecutionCountV2,
  autoDeprecateIdleSkillsV2,
  autoFailStuckExecutionsV2,
  getSkillLoaderStatsV2,
} from "../lib/skill-loader.js";
import { getElectronUserDataDir } from "../lib/paths.js";
import { findProjectRoot } from "../lib/project-detector.js";
import {
  generateCliPacks,
  checkForUpdates,
  removeCliPacks,
} from "../lib/skill-packs/generator.js";
import { CLI_PACK_DOMAINS } from "../lib/skill-packs/schema.js";

const LAYER_LABELS = {
  bundled: chalk.blue("[bundled]"),
  marketplace: chalk.magenta("[marketplace]"),
  managed: chalk.yellow("[global]"),
  workspace: chalk.green("[project]"),
};

/**
 * Check if a skill can run on current platform
 */
function canRunOnPlatform(skill) {
  if (!skill.os || skill.os.length === 0) return true;
  return skill.os.includes(process.platform);
}

const SKILL_TEMPLATE_MD = (name) => `---
name: ${name}
display-name: ${name}
description: Custom skill — edit this description
version: 1.0.0
category: custom
tags: [custom]
user-invocable: true
handler: handler.js
---

# ${name}

Describe what this skill does and how to use it.

## Usage

\`\`\`
chainlesschain skill run ${name} "your input"
\`\`\`
`;

const SKILL_TEMPLATE_HANDLER = (name) => `/**
 * Handler for ${name} skill
 */

const handler = {
  async init(skill) {
    // Optional initialization
  },

  async execute(task, context, skill) {
    const input = task.input || task.params?.input || "";

    // TODO: Implement skill logic
    return {
      success: true,
      message: \`${name} executed successfully\`,
      result: { input },
    };
  },
};

export default handler;
`;

export function registerSkillCommand(program) {
  const skill = program
    .command("skill")
    .description(
      "Manage and run AI skills (multi-layer: bundled + global + project)",
    );

  const loader = new CLISkillLoader();

  // skill list
  skill
    .command("list")
    .description("List all available skills")
    .option("--category <category>", "Filter by category")
    .option("--tag <tag>", "Filter by tag")
    .option("--runnable", "Only show skills that can run headless")
    .option(
      "--source <layer>",
      "Filter by source layer (bundled, marketplace, managed, workspace)",
    )
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const spinner = ora("Loading skills...").start();
      let skills = loader.loadAll();
      spinner.stop();

      if (skills.length === 0) {
        logger.error(
          "No skills found. Make sure you're in the ChainlessChain project root or have skills installed.",
        );
        process.exit(1);
      }

      // Filter
      if (options.category) {
        skills = skills.filter(
          (s) => s.category.toLowerCase() === options.category.toLowerCase(),
        );
      }
      if (options.tag) {
        skills = skills.filter((s) =>
          s.tags.some((t) =>
            t.toLowerCase().includes(options.tag.toLowerCase()),
          ),
        );
      }
      if (options.runnable) {
        skills = skills.filter((s) => s.hasHandler && canRunOnPlatform(s));
      }
      if (options.source) {
        skills = skills.filter((s) => s.source === options.source);
      }

      if (options.json) {
        console.log(
          JSON.stringify(
            skills.map(({ body, skillDir, ...rest }) => rest),
            null,
            2,
          ),
        );
        return;
      }

      // Group by category
      const byCategory = {};
      for (const s of skills) {
        const cat = s.category || "uncategorized";
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(s);
      }

      logger.log(chalk.bold(`\nSkills (${skills.length}):\n`));

      for (const [cat, catSkills] of Object.entries(byCategory).sort()) {
        logger.log(chalk.yellow(`  ${cat} (${catSkills.length})`));
        for (const s of catSkills) {
          const handler = s.hasHandler ? chalk.green("●") : chalk.gray("○");
          const name = chalk.cyan(s.id.padEnd(30));
          const desc = chalk.gray((s.description || "").substring(0, 40));
          const label = LAYER_LABELS[s.source] || chalk.gray(`[${s.source}]`);
          logger.log(`    ${handler} ${name} ${desc} ${label}`);
        }
        logger.log("");
      }

      logger.log(
        chalk.gray("● = has handler (runnable)  ○ = documentation only\n"),
      );
    });

  // skill categories
  skill
    .command("categories")
    .description("List skill categories")
    .action(async () => {
      const skills = loader.loadAll();
      if (skills.length === 0) {
        logger.error("No skills found.");
        process.exit(1);
      }

      const cats = {};
      for (const s of skills) {
        const cat = s.category || "uncategorized";
        cats[cat] = (cats[cat] || 0) + 1;
      }

      logger.log(chalk.bold("\nSkill Categories:\n"));
      for (const [cat, count] of Object.entries(cats).sort()) {
        logger.log(`  ${chalk.cyan(cat.padEnd(25))} ${count} skills`);
      }
      logger.log("");
    });

  // skill info
  skill
    .command("info")
    .description("Show detailed info about a skill")
    .argument("<name>", "Skill name")
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      const skills = loader.loadAll();
      const s = skills.find(
        (s) => s.id === name || s.dirName === name || s.id.includes(name),
      );

      if (!s) {
        logger.error(`Skill not found: ${name}`);
        const close = skills
          .filter((s) => s.id.includes(name) || s.dirName.includes(name))
          .slice(0, 5);
        if (close.length > 0) {
          logger.info(`Did you mean: ${close.map((s) => s.id).join(", ")}?`);
        }
        process.exit(1);
      }

      if (options.json) {
        const { body, skillDir, ...rest } = s;
        console.log(JSON.stringify(rest, null, 2));
        return;
      }

      logger.log(chalk.bold(`\n${s.displayName}`));
      logger.log(chalk.gray(`ID: ${s.id}  v${s.version}`));
      logger.log(chalk.gray(`Category: ${s.category}`));
      logger.log(chalk.gray(`Source: ${s.source}`));
      if (s.tags.length > 0) {
        logger.log(chalk.gray(`Tags: ${s.tags.join(", ")}`));
      }
      logger.log("");
      logger.log(s.description || "No description");
      logger.log("");
      logger.log(
        `Handler: ${s.hasHandler ? chalk.green("Available") : chalk.gray("None")}`,
      );
      logger.log(
        `Platform: ${canRunOnPlatform(s) ? chalk.green("Compatible") : chalk.red("Not supported")}`,
      );

      if (s.body) {
        logger.log(chalk.bold("\n--- Documentation ---\n"));
        logger.log(s.body.substring(0, 2000));
      }
    });

  // skill search
  skill
    .command("search")
    .description("Search skills by keyword")
    .argument("<query>", "Search query")
    .action(async (query) => {
      const skills = loader.loadAll();
      const q = query.toLowerCase();
      const matches = skills.filter(
        (s) =>
          s.id.includes(q) ||
          s.displayName.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q)),
      );

      if (matches.length === 0) {
        logger.info(`No skills matching "${query}"`);
        return;
      }

      logger.log(
        chalk.bold(`\nSearch results for "${query}" (${matches.length}):\n`),
      );
      for (const s of matches) {
        const handler = s.hasHandler ? chalk.green("●") : chalk.gray("○");
        const label = LAYER_LABELS[s.source] || "";
        logger.log(
          `  ${handler} ${chalk.cyan(s.id.padEnd(30))} ${chalk.gray(s.description.substring(0, 40))} ${label}`,
        );
      }
      logger.log("");
    });

  // skill run
  skill
    .command("run")
    .description("Execute a skill")
    .argument("<name>", "Skill name")
    .argument("[input...]", "Input for the skill")
    .option("--json", "Output as JSON")
    .action(async (name, inputParts, options) => {
      const skills = loader.loadAll();
      const s = skills.find((sk) => sk.id === name || sk.dirName === name);

      if (!s) {
        logger.error(`Skill not found: ${name}`);
        process.exit(1);
      }

      if (!s.hasHandler) {
        logger.error(
          `Skill "${s.id}" has no handler (documentation only). Cannot execute.`,
        );
        process.exit(1);
      }

      if (!canRunOnPlatform(s)) {
        logger.error(`Skill "${s.id}" is not supported on ${process.platform}`);
        process.exit(1);
      }

      const spinner = ora(`Running ${s.displayName}...`).start();
      const input = inputParts.join(" ");

      try {
        const handlerPath = path.join(s.skillDir, "handler.js");
        const imported = await import(
          `file://${handlerPath.replace(/\\/g, "/")}`
        );
        const handler = imported.default || imported;

        if (handler.init) {
          await handler.init(s);
        }

        const task = {
          params: { input },
          input,
          action: input,
        };
        const context = {
          projectRoot: process.cwd(),
          workspacePath: process.cwd(),
          workspaceRoot: process.cwd(),
        };

        const result = await handler.execute(task, context, s);
        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (result.success) {
          logger.success(result.message || "Done");
          if (result.result && typeof result.result === "object") {
            for (const [key, val] of Object.entries(result.result)) {
              if (typeof val === "string" && val.length > 200) {
                logger.log(`  ${chalk.cyan(key)}: ${val.substring(0, 200)}...`);
              } else {
                logger.log(`  ${chalk.cyan(key)}: ${JSON.stringify(val)}`);
              }
            }
          }
        } else {
          logger.error(
            result.message || result.error || "Skill execution failed",
          );
        }
      } catch (err) {
        spinner.fail(`Skill execution failed: ${err.message}`);
        if (program.opts().verbose) {
          console.error(err.stack);
        }
        process.exit(1);
      }
    });

  // skill add — create a custom skill scaffold
  skill
    .command("add")
    .description("Create a custom skill")
    .argument("<name>", "Skill name")
    .option(
      "--global",
      "Create as a global (managed) skill instead of project-level",
    )
    .action(async (name, options) => {
      let targetDir;

      if (options.global) {
        const userData = getElectronUserDataDir();
        targetDir = path.join(userData, "skills", name);
      } else {
        const projectRoot = findProjectRoot();
        if (!projectRoot) {
          logger.error(
            'Not inside a ChainlessChain project. Run "chainlesschain init" first, or use --global.',
          );
          process.exit(1);
        }
        targetDir = path.join(projectRoot, ".chainlesschain", "skills", name);
      }

      if (fs.existsSync(targetDir)) {
        logger.error(`Skill already exists: ${targetDir}`);
        process.exit(1);
      }

      try {
        fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(
          path.join(targetDir, "SKILL.md"),
          SKILL_TEMPLATE_MD(name),
          "utf-8",
        );
        fs.writeFileSync(
          path.join(targetDir, "handler.js"),
          SKILL_TEMPLATE_HANDLER(name),
          "utf-8",
        );

        const scope = options.global ? "global" : "project";
        logger.success(`Created ${scope} skill: ${chalk.cyan(name)}`);
        logger.log(`  ${chalk.gray(targetDir)}`);
        logger.log("");
        logger.log(chalk.bold("Files created:"));
        logger.log(
          `  ${chalk.gray("SKILL.md")}    — Skill metadata and documentation`,
        );
        logger.log(`  ${chalk.gray("handler.js")}  — Skill execution logic`);
        logger.log("");
        logger.log(
          `Edit these files, then run: ${chalk.cyan(`chainlesschain skill run ${name} "test input"`)}`,
        );
      } catch (err) {
        logger.error(`Failed to create skill: ${err.message}`);
        process.exit(1);
      }
    });

  // skill remove — delete a custom skill
  skill
    .command("remove")
    .description("Remove a custom skill (project or global)")
    .argument("<name>", "Skill name")
    .option("--global", "Remove from global (managed) skills")
    .option("--force", "Skip confirmation")
    .action(async (name, options) => {
      let targetDir;

      if (options.global) {
        const userData = getElectronUserDataDir();
        targetDir = path.join(userData, "skills", name);
      } else {
        const projectRoot = findProjectRoot();
        if (!projectRoot) {
          logger.error("Not inside a ChainlessChain project.");
          process.exit(1);
        }
        targetDir = path.join(projectRoot, ".chainlesschain", "skills", name);
      }

      if (!fs.existsSync(targetDir)) {
        logger.error(`Skill not found: ${name}`);
        process.exit(1);
      }

      if (!options.force) {
        try {
          const { confirm } = await import("@inquirer/prompts");
          const ok = await confirm({
            message: `Remove skill "${name}" from ${targetDir}?`,
          });
          if (!ok) {
            logger.info("Cancelled");
            return;
          }
        } catch {
          return;
        }
      }

      try {
        fs.rmSync(targetDir, { recursive: true, force: true });
        logger.success(`Removed skill: ${name}`);
      } catch (err) {
        logger.error(`Failed to remove skill: ${err.message}`);
        process.exit(1);
      }
    });

  // skill sync-cli — generate / update CLI command skill packs
  skill
    .command("sync-cli")
    .description(
      "Generate or update CLI command skill packs (9 domain packs wrapping all 62 CLI commands)",
    )
    .option("--force", "Force regenerate all packs even if unchanged")
    .option("--dry-run", "Preview changes without writing files")
    .option("--remove", "Remove all generated CLI packs")
    .option(
      "--output <dir>",
      "Custom output directory (default: managed skills layer)",
    )
    .option("--json", "Output result as JSON")
    .action(async (options) => {
      // Remove mode
      if (options.remove) {
        const spinner = ora("Removing CLI pack skills...").start();
        try {
          const removed = removeCliPacks(options.output);
          spinner.stop();
          if (removed.length === 0) {
            logger.info("No CLI packs found to remove.");
          } else {
            logger.success(`Removed ${removed.length} CLI pack(s):`);
            for (const d of removed) {
              logger.log(`  ${chalk.gray("✗")} ${d}`);
            }
          }
          loader.clearCache();
        } catch (err) {
          spinner.fail(`Failed to remove packs: ${err.message}`);
          process.exit(1);
        }
        return;
      }

      // Dry-run: preview what would change
      if (options.dryRun) {
        const updates = checkForUpdates(options.output);
        const totalDomains = Object.keys(CLI_PACK_DOMAINS).length;
        const upToDate = totalDomains - updates.length;

        logger.log(chalk.bold("\nCLI Pack Sync Preview (dry-run):\n"));
        logger.log(
          chalk.gray(
            `  Total domains: ${totalDomains}  |  Up-to-date: ${upToDate}  |  Need update: ${updates.length}\n`,
          ),
        );

        if (updates.length === 0) {
          logger.success("All CLI packs are up-to-date. Nothing to generate.");
          return;
        }

        for (const u of updates) {
          const icon = u.exists ? chalk.yellow("↻") : chalk.green("+");
          const reason = u.changeReason === "new" ? "new" : "hash changed";
          logger.log(
            `  ${icon} ${chalk.cyan(u.domain.padEnd(28))} ${chalk.gray(reason)} — ${u.displayName}`,
          );
        }
        logger.log(
          chalk.gray(
            `\nRun without --dry-run to generate ${updates.length} pack(s).\n`,
          ),
        );
        return;
      }

      // Generate packs
      const spinner = ora(
        options.force
          ? "Regenerating all CLI packs (--force)..."
          : "Syncing CLI command skill packs...",
      ).start();

      try {
        const result = await generateCliPacks({
          force: options.force || false,
          dryRun: false,
          outputDir: options.output,
        });

        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const totalDomains = Object.keys(CLI_PACK_DOMAINS).length;

        logger.log(chalk.bold("\nCLI Pack Sync Result:\n"));
        logger.log(
          chalk.gray(
            `  CLI version: ${result.cliVersion}  |  Output: ${result.outputDir}\n`,
          ),
        );

        if (result.generated.length > 0) {
          logger.log(
            chalk.green(`  Generated / Updated (${result.generated.length}):`),
          );
          for (const g of result.generated) {
            const icon =
              g.changeReason === "new" ? chalk.green("+") : chalk.yellow("↻");
            const mode = chalk.gray(`[${g.executionMode || "direct"}]`);
            const cmds = chalk.gray(`${g.commandCount || 0} commands`);
            logger.log(
              `    ${icon} ${chalk.cyan((g.domain || g).padEnd(28))} ${mode} ${cmds}`,
            );
          }
          logger.log("");
        }

        if (result.skipped.length > 0) {
          logger.log(chalk.gray(`  Skipped (${result.skipped.length}):`));
          for (const s of result.skipped) {
            logger.log(
              `    ${chalk.gray("–")} ${chalk.gray((s.domain || s).padEnd(28))} up-to-date`,
            );
          }
          logger.log("");
        }

        if (result.errors.length > 0) {
          logger.log(chalk.red(`  Errors (${result.errors.length}):`));
          for (const e of result.errors) {
            logger.log(`    ${chalk.red("✗")} ${e.domain}: ${e.error}`);
          }
          logger.log("");
          process.exit(1);
        }

        const summary =
          result.generated.length > 0
            ? `${result.generated.length} pack(s) generated, ${result.skipped.length} skipped`
            : "All packs up-to-date";

        logger.success(
          `${summary} (${totalDomains} total domains, outputDir: ${result.outputDir})`,
        );
        logger.log(
          chalk.gray(
            `\nRun ${chalk.cyan("chainlesschain skill list --category cli-direct")} to see the packs.\n`,
          ),
        );

        // Invalidate loader cache so new packs are visible immediately
        loader.clearCache();
      } catch (err) {
        spinner.fail(`Sync failed: ${err.message}`);
        if (program.opts().verbose) {
          console.error(err.stack);
        }
        process.exit(1);
      }
    });

  // skill sources — show layer paths and counts
  skill
    .command("sources")
    .description("Show skill source layers, paths, and counts")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const layers = loader.getLayerPaths();

      // Count skills per layer
      const layerCounts = {};
      const allSkills = loader.loadAll();
      for (const s of allSkills) {
        layerCounts[s.source] = (layerCounts[s.source] || 0) + 1;
      }

      if (options.json) {
        console.log(
          JSON.stringify(
            layers.map((l) => ({
              ...l,
              count: layerCounts[l.layer] || 0,
            })),
            null,
            2,
          ),
        );
        return;
      }

      logger.log(chalk.bold("\nSkill Source Layers:\n"));
      logger.log(
        chalk.gray(
          "  Priority: workspace (highest) > managed > marketplace > bundled (lowest)\n",
        ),
      );

      for (let i = layers.length - 1; i >= 0; i--) {
        const l = layers[i];
        const count = layerCounts[l.layer] || 0;
        const status = l.exists
          ? chalk.green("active")
          : chalk.gray("not found");
        const label = LAYER_LABELS[l.layer] || l.layer;
        const priority = `(priority ${LAYER_NAMES.indexOf(l.layer)})`;

        logger.log(`  ${label} ${chalk.gray(priority)}`);
        logger.log(`    Path:   ${chalk.gray(l.path || "(none)")}`);
        logger.log(`    Status: ${status}  Skills: ${count}`);
        logger.log("");
      }

      logger.log(
        `  ${chalk.bold("Total:")} ${allSkills.length} skills resolved\n`,
      );
    });

  // ─── V2 Governance Layer ──────────────────────────────────────────
  const out = (obj) => console.log(JSON.stringify(obj, null, 2));
  const tryRun = (fn) => {
    try {
      fn();
    } catch (err) {
      logger.error(err.message);
      process.exit(1);
    }
  };

  skill
    .command("skill-maturities-v2")
    .description("List V2 skill maturity states")
    .action(() => out(Object.values(SKILL_MATURITY_V2)));

  skill
    .command("execution-lifecycles-v2")
    .description("List V2 execution lifecycle states")
    .action(() => out(Object.values(EXECUTION_LIFECYCLE_V2)));

  skill
    .command("stats-v2")
    .description("V2 skill-loader stats")
    .action(() => out(getSkillLoaderStatsV2()));

  skill
    .command("get-max-active-skills-v2")
    .description("Get max active skills per owner (V2)")
    .action(() =>
      out({ maxActiveSkillsPerOwner: getMaxActiveSkillsPerOwnerV2() }),
    );

  skill
    .command("set-max-active-skills-v2 <n>")
    .description("Set max active skills per owner (V2)")
    .action((n) =>
      tryRun(() => {
        setMaxActiveSkillsPerOwnerV2(Number(n));
        out({ maxActiveSkillsPerOwner: getMaxActiveSkillsPerOwnerV2() });
      }),
    );

  skill
    .command("get-max-pending-executions-v2")
    .description("Get max pending executions per skill (V2)")
    .action(() =>
      out({
        maxPendingExecutionsPerSkill: getMaxPendingExecutionsPerSkillV2(),
      }),
    );

  skill
    .command("set-max-pending-executions-v2 <n>")
    .description("Set max pending executions per skill (V2)")
    .action((n) =>
      tryRun(() => {
        setMaxPendingExecutionsPerSkillV2(Number(n));
        out({
          maxPendingExecutionsPerSkill: getMaxPendingExecutionsPerSkillV2(),
        });
      }),
    );

  skill
    .command("get-skill-idle-ms-v2")
    .description("Get skill idle threshold (V2)")
    .action(() => out({ skillIdleMs: getSkillIdleMsV2() }));

  skill
    .command("set-skill-idle-ms-v2 <ms>")
    .description("Set skill idle threshold (V2)")
    .action((ms) =>
      tryRun(() => {
        setSkillIdleMsV2(Number(ms));
        out({ skillIdleMs: getSkillIdleMsV2() });
      }),
    );

  skill
    .command("get-exec-stuck-ms-v2")
    .description("Get execution stuck threshold (V2)")
    .action(() => out({ execStuckMs: getExecStuckMsV2() }));

  skill
    .command("set-exec-stuck-ms-v2 <ms>")
    .description("Set execution stuck threshold (V2)")
    .action((ms) =>
      tryRun(() => {
        setExecStuckMsV2(Number(ms));
        out({ execStuckMs: getExecStuckMsV2() });
      }),
    );

  skill
    .command("active-skill-count-v2 <ownerId>")
    .description("Active skill count for owner (V2)")
    .action((ownerId) =>
      out({ ownerId, count: getActiveSkillCountV2(ownerId) }),
    );

  skill
    .command("pending-execution-count-v2 <skillId>")
    .description("Pending execution count for skill (V2)")
    .action((skillId) =>
      out({ skillId, count: getPendingExecutionCountV2(skillId) }),
    );

  skill
    .command("register-skill-v2 <id>")
    .description("Register a V2 skill")
    .requiredOption("-o, --owner <id>", "owner id")
    .requiredOption("-n, --name <name>", "skill name")
    .option("-l, --layer <layer>", "skill layer", "workspace")
    .action((id, opts) =>
      tryRun(() =>
        out(
          registerSkillV2(id, {
            ownerId: opts.owner,
            name: opts.name,
            layer: opts.layer,
          }),
        ),
      ),
    );

  skill
    .command("get-skill-v2 <id>")
    .description("Get a V2 skill")
    .action((id) => out(getSkillV2(id)));

  skill
    .command("list-skills-v2")
    .description("List V2 skills")
    .option("-o, --owner <id>", "filter by owner")
    .option("-s, --status <status>", "filter by status")
    .option("-l, --layer <layer>", "filter by layer")
    .action((opts) =>
      out(
        listSkillsV2({
          ownerId: opts.owner,
          status: opts.status,
          layer: opts.layer,
        }),
      ),
    );

  skill
    .command("set-skill-status-v2 <id> <next>")
    .description("Set V2 skill status")
    .action((id, next) => tryRun(() => out(setSkillStatusV2(id, next))));

  skill
    .command("activate-skill-v2 <id>")
    .description("Activate a V2 skill")
    .action((id) => tryRun(() => out(activateSkillV2(id))));

  skill
    .command("deprecate-skill-v2 <id>")
    .description("Deprecate a V2 skill")
    .action((id) => tryRun(() => out(deprecateSkillV2(id))));

  skill
    .command("archive-skill-v2 <id>")
    .description("Archive a V2 skill")
    .action((id) => tryRun(() => out(archiveSkillV2(id))));

  skill
    .command("touch-skill-v2 <id>")
    .description("Touch a V2 skill")
    .action((id) => tryRun(() => out(touchSkillV2(id))));

  skill
    .command("create-execution-v2 <id>")
    .description("Create a V2 execution")
    .requiredOption("-s, --skill <id>", "skill id")
    .option("-k, --kind <kind>", "execution kind", "invoke")
    .action((id, opts) =>
      tryRun(() =>
        out(createExecutionV2(id, { skillId: opts.skill, kind: opts.kind })),
      ),
    );

  skill
    .command("get-execution-v2 <id>")
    .description("Get a V2 execution")
    .action((id) => out(getExecutionV2(id)));

  skill
    .command("list-executions-v2")
    .description("List V2 executions")
    .option("-s, --skill <id>", "filter by skill")
    .option("-t, --status <status>", "filter by status")
    .action((opts) =>
      out(listExecutionsV2({ skillId: opts.skill, status: opts.status })),
    );

  skill
    .command("set-execution-status-v2 <id> <next>")
    .description("Set V2 execution status")
    .action((id, next) => tryRun(() => out(setExecutionStatusV2(id, next))));

  skill
    .command("start-execution-v2 <id>")
    .description("Start a V2 execution")
    .action((id) => tryRun(() => out(startExecutionV2(id))));

  skill
    .command("succeed-execution-v2 <id>")
    .description("Succeed a V2 execution")
    .action((id) => tryRun(() => out(succeedExecutionV2(id))));

  skill
    .command("fail-execution-v2 <id>")
    .description("Fail a V2 execution")
    .action((id) => tryRun(() => out(failExecutionV2(id))));

  skill
    .command("cancel-execution-v2 <id>")
    .description("Cancel a V2 execution")
    .action((id) => tryRun(() => out(cancelExecutionV2(id))));

  skill
    .command("auto-deprecate-idle-skills-v2")
    .description("Auto-deprecate idle V2 skills")
    .action(() => out(autoDeprecateIdleSkillsV2()));

  skill
    .command("auto-fail-stuck-executions-v2")
    .description("Auto-fail stuck V2 executions")
    .action(() => out(autoFailStuckExecutionsV2()));
}
