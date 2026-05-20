/**
 * Persona management command
 * chainlesschain persona [show|set|reset]
 *
 * Manage project-level AI persona configuration.
 */

import chalk from "chalk";
import fs from "fs";
import path from "path";
import { logger } from "../lib/logger.js";
import { findProjectRoot, loadProjectConfig } from "../lib/project-detector.js";

export function registerPersonaCommand(program) {
  const persona = program
    .command("persona")
    .description("Manage project AI persona configuration");

  // persona show
  persona
    .command("show")
    .description("Show the current project persona")
    .action(() => {
      const projectRoot = findProjectRoot(process.cwd());
      if (!projectRoot) {
        logger.error(
          "Not inside a ChainlessChain project. Run `chainlesschain init` first.",
        );
        process.exit(1);
      }

      const config = loadProjectConfig(projectRoot);
      if (!config?.persona) {
        logger.log("No persona configured. Using default coding assistant.");
        logger.log(
          `\nSet one with: ${chalk.cyan('chainlesschain persona set --name "My Assistant" --role "Your role description"')}`,
        );
        return;
      }

      const p = config.persona;
      logger.log(chalk.bold("Current Persona:"));
      logger.log(`  Name: ${chalk.cyan(p.name || "(unnamed)")}`);
      logger.log(`  Role: ${p.role || "(no role defined)"}`);
      if (p.behaviors?.length > 0) {
        logger.log("  Behaviors:");
        for (const b of p.behaviors) {
          logger.log(`    - ${b}`);
        }
      }
      if (p.toolsPriority?.length > 0) {
        logger.log(
          `  Preferred tools: ${chalk.gray(p.toolsPriority.join(", "))}`,
        );
      }
      if (p.toolsDisabled?.length > 0) {
        logger.log(
          `  Disabled tools: ${chalk.red(p.toolsDisabled.join(", "))}`,
        );
      }
    });

  // persona set
  persona
    .command("set")
    .description("Set or update the project persona")
    .option("-n, --name <name>", "Persona display name")
    .option("-r, --role <role>", "Role description (system prompt override)")
    .option(
      "-b, --behavior <behavior>",
      "Add a behavior guideline (repeatable)",
      collectValues,
      [],
    )
    .option(
      "--tools-priority <tools>",
      "Comma-separated list of preferred tools",
    )
    .option(
      "--tools-disabled <tools>",
      "Comma-separated list of disabled tools",
    )
    .action((options) => {
      const projectRoot = findProjectRoot(process.cwd());
      if (!projectRoot) {
        logger.error(
          "Not inside a ChainlessChain project. Run `chainlesschain init` first.",
        );
        process.exit(1);
      }

      const configPath = path.join(
        projectRoot,
        ".chainlesschain",
        "config.json",
      );
      let config;
      try {
        config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      } catch {
        logger.error("Failed to read config.json");
        process.exit(1);
      }

      const existing = config.persona || {};
      const updated = { ...existing };

      if (options.name) updated.name = options.name;
      if (options.role) updated.role = options.role;
      if (options.behavior?.length > 0) {
        updated.behaviors = [
          ...(existing.behaviors || []),
          ...options.behavior,
        ];
      }
      if (options.toolsPriority) {
        updated.toolsPriority = options.toolsPriority
          .split(",")
          .map((s) => s.trim());
      }
      if (options.toolsDisabled) {
        updated.toolsDisabled = options.toolsDisabled
          .split(",")
          .map((s) => s.trim());
      }

      config.persona = updated;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

      logger.success("Persona updated.");
      logger.log(`  Name: ${chalk.cyan(updated.name || "(unnamed)")}`);
      logger.log(`  Role: ${updated.role || "(no role defined)"}`);
    });

  // persona list (Phase 3d)
  persona
    .command("list")
    .description(
      "List named personas registered in config.personas (Phase 3d registry)",
    )
    .option("--json", "Emit JSON instead of human-readable", false)
    .action((options) => {
      const projectRoot = findProjectRoot(process.cwd());
      if (!projectRoot) {
        if (options.json) {
          logger.log(
            JSON.stringify({ error: "not in project", code: "NO_PROJECT" }),
          );
        } else {
          logger.error(
            "Not inside a ChainlessChain project. Run `chainlesschain init` first.",
          );
        }
        process.exit(1);
      }

      const config = loadProjectConfig(projectRoot);
      const personas =
        config?.personas && typeof config.personas === "object"
          ? config.personas
          : {};
      const active = config?.activePersonaName || null;
      const envName = process.env.CC_PACK_AUTO_PERSONA || null;

      if (options.json) {
        logger.log(
          JSON.stringify(
            {
              activePersonaName: active,
              envPersona: envName,
              personas: Object.fromEntries(
                Object.entries(personas).map(([k, v]) => [
                  k,
                  { name: v?.name || null, role: v?.role || null },
                ]),
              ),
              hasLegacyInlinePersona: Boolean(config?.persona),
            },
            null,
            2,
          ),
        );
        return;
      }

      if (Object.keys(personas).length === 0) {
        logger.log("No named personas registered.");
        if (config?.persona) {
          logger.log(
            chalk.dim(
              "  (Legacy inline `config.persona` is set; it activates as the default.)",
            ),
          );
        }
        logger.log(
          `\nAdd one via \`config.personas.<name>\` or by re-running \`cc init -t <template>\` (medical-triage / agriculture-expert / etc.).`,
        );
        return;
      }

      logger.log(chalk.bold("Registered personas:"));
      for (const [k, v] of Object.entries(personas)) {
        const marker =
          k === envName
            ? chalk.green(" ← CC_PACK_AUTO_PERSONA")
            : k === active
              ? chalk.cyan(" ← active")
              : "";
        logger.log(`  ${chalk.cyan(k)}${marker}`);
        if (v?.name) logger.log(`    name: ${v.name}`);
        if (v?.role) {
          const oneLine = String(v.role).split("\n")[0].slice(0, 80);
          logger.log(chalk.dim(`    role: ${oneLine}`));
        }
      }
      if (envName && !personas[envName]) {
        logger.log(
          chalk.yellow(
            `\n  Warning: CC_PACK_AUTO_PERSONA="${envName}" does not match any registered persona.`,
          ),
        );
      }
    });

  // persona activate (Phase 3d)
  persona
    .command("activate <name>")
    .description(
      "Activate a named persona from config.personas (Phase 3d; equivalent to `cc skill enable` for persona-category skills)",
    )
    .action((name) => {
      const projectRoot = findProjectRoot(process.cwd());
      if (!projectRoot) {
        logger.error(
          "Not inside a ChainlessChain project. Run `chainlesschain init` first.",
        );
        process.exit(1);
      }

      const configPath = path.join(
        projectRoot,
        ".chainlesschain",
        "config.json",
      );
      let config;
      try {
        config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      } catch {
        logger.error("Failed to read config.json");
        process.exit(1);
      }

      const personas =
        config.personas && typeof config.personas === "object"
          ? config.personas
          : {};
      const target = personas[name];
      if (!target) {
        const available = Object.keys(personas);
        logger.error(`No persona named "${name}" in config.personas.`);
        if (available.length > 0) {
          logger.log(`Available: ${chalk.cyan(available.join(", "))}`);
        } else {
          logger.log(
            chalk.dim(
              "  (No named personas registered. See `cc persona list` for details.)",
            ),
          );
        }
        process.exit(1);
      }

      config.activePersonaName = name;
      // Denormalize so `_loadProjectPersona`'s legacy `config.persona` read
      // path also sees the activation. Single source of truth is
      // `activePersonaName`, but the inline copy keeps the resolver
      // backward-compatible without forcing a config-version bump.
      config.persona = target;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

      logger.success(`Activated persona "${chalk.cyan(name)}".`);
      logger.log(`  Display name: ${target.name || "(unnamed)"}`);
      if (target.role) {
        const oneLine = String(target.role).split("\n")[0].slice(0, 80);
        logger.log(chalk.dim(`  Role: ${oneLine}`));
      }
    });

  // persona reset
  persona
    .command("reset")
    .description(
      "Remove the project persona, restoring the default coding assistant",
    )
    .action(() => {
      const projectRoot = findProjectRoot(process.cwd());
      if (!projectRoot) {
        logger.error(
          "Not inside a ChainlessChain project. Run `chainlesschain init` first.",
        );
        process.exit(1);
      }

      const configPath = path.join(
        projectRoot,
        ".chainlesschain",
        "config.json",
      );
      let config;
      try {
        config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      } catch {
        logger.error("Failed to read config.json");
        process.exit(1);
      }

      if (!config.persona && !config.activePersonaName) {
        logger.log("No persona configured. Nothing to reset.");
        return;
      }

      delete config.persona;
      // Phase 3d: also clear the active-name pointer so _loadProjectPersona
      // doesn't re-resolve through config.personas[activeName]. The personas
      // registry itself is preserved — user can re-activate with `cc persona
      // activate <name>`.
      delete config.activePersonaName;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
      logger.success(
        "Persona removed. The default coding assistant will be used.",
      );
    });
}

function collectValues(value, previous) {
  return previous.concat([value]);
}
