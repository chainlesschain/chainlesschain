/**
 * Skill management and execution commands
 * chainlesschain skill list|info|run|search|categories
 *
 * Loads built-in skills directly from the desktop app's bundled skill definitions.
 * Most skills (110+/138) are pure JS and run headless without Electron.
 */

import chalk from "chalk";
import ora from "ora";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../lib/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Find the bundled skills directory
 */
function findSkillsDir() {
  // Walk up from CLI package to find desktop-app-vue
  const candidates = [
    path.resolve(
      __dirname,
      "../../../../desktop-app-vue/src/main/ai-engine/cowork/skills/builtin",
    ),
    path.resolve(
      process.cwd(),
      "desktop-app-vue/src/main/ai-engine/cowork/skills/builtin",
    ),
  ];

  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }

  return null;
}

/**
 * Simple YAML frontmatter parser (no dependencies)
 */
function parseSkillMd(content) {
  const lines = content.split("\n");
  if (lines[0].trim() !== "---") return { data: {}, body: content };

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) return { data: {}, body: content };

  const yamlLines = lines.slice(1, endIndex);
  const body = lines
    .slice(endIndex + 1)
    .join("\n")
    .trim();
  const data = {};

  let currentKey = null;
  let currentArray = null;

  for (const line of yamlLines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const trimmed = line.trim();

    if (trimmed.startsWith("- ")) {
      const value = trimmed
        .slice(2)
        .trim()
        .replace(/^['"]|['"]$/g, "");
      if (currentArray) currentArray.push(value);
      continue;
    }

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex > 0) {
      const key = trimmed.slice(0, colonIndex).trim();
      let value = trimmed.slice(colonIndex + 1).trim();

      // Convert kebab-case to camelCase
      const camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

      if (value === "") {
        // Could be start of nested object or array
        currentKey = camelKey;
        currentArray = null;
        continue;
      }

      // Handle inline arrays [a, b, c]
      if (value.startsWith("[") && value.endsWith("]")) {
        data[camelKey] = value
          .slice(1, -1)
          .split(",")
          .map((v) => v.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
        currentArray = null;
        currentKey = null;
        continue;
      }

      // Handle booleans and numbers
      if (value === "true") value = true;
      else if (value === "false") value = false;
      else if (value === "null") value = null;
      else if (/^\d+(\.\d+)?$/.test(value)) value = parseFloat(value);
      else value = value.replace(/^['"]|['"]$/g, "");

      data[camelKey] = value;

      // If next lines might be array items for this key
      if (Array.isArray(data[camelKey])) {
        currentArray = data[camelKey];
      } else {
        currentArray = null;
      }
      currentKey = camelKey;
    }
  }

  return { data, body };
}

/**
 * Load all skill metadata from the bundled directory
 */
function loadSkillMetadata(skillsDir) {
  const skills = [];

  try {
    const dirs = fs.readdirSync(skillsDir, { withFileTypes: true });

    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;

      const skillMd = path.join(skillsDir, dir.name, "SKILL.md");
      if (!fs.existsSync(skillMd)) continue;

      try {
        const content = fs.readFileSync(skillMd, "utf8");
        const { data, body } = parseSkillMd(content);

        skills.push({
          id: data.name || dir.name,
          displayName: data.displayName || dir.name,
          description: data.description || "",
          version: data.version || "1.0.0",
          category: data.category || "uncategorized",
          tags: data.tags || [],
          userInvocable: data.userInvocable !== false,
          handler: data.handler || null,
          capabilities: data.capabilities || [],
          os: data.os || [],
          dirName: dir.name,
          hasHandler: fs.existsSync(
            path.join(skillsDir, dir.name, "handler.js"),
          ),
          body,
        });
      } catch {
        // Skip malformed skill files
      }
    }
  } catch (err) {
    logger.error(`Failed to read skills directory: ${err.message}`);
  }

  return skills;
}

/**
 * Check if a skill can run on current platform
 */
function canRunOnPlatform(skill) {
  if (!skill.os || skill.os.length === 0) return true;
  return skill.os.includes(process.platform);
}

export function registerSkillCommand(program) {
  const skill = program
    .command("skill")
    .description("Manage and run built-in AI skills (138 available)");

  // skill list
  skill
    .command("list")
    .description("List all available skills")
    .option("--category <category>", "Filter by category")
    .option("--tag <tag>", "Filter by tag")
    .option("--runnable", "Only show skills that can run headless")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const skillsDir = findSkillsDir();
      if (!skillsDir) {
        logger.error(
          "Skills directory not found. Make sure you're in the ChainlessChain project root.",
        );
        process.exit(1);
      }

      const spinner = ora("Loading skills...").start();
      let skills = loadSkillMetadata(skillsDir);
      spinner.stop();

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

      if (options.json) {
        console.log(
          JSON.stringify(
            skills.map(({ body, ...rest }) => rest),
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
          const desc = chalk.gray((s.description || "").substring(0, 50));
          logger.log(`    ${handler} ${name} ${desc}`);
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
      const skillsDir = findSkillsDir();
      if (!skillsDir) {
        logger.error("Skills directory not found.");
        process.exit(1);
      }

      const skills = loadSkillMetadata(skillsDir);
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
      const skillsDir = findSkillsDir();
      if (!skillsDir) {
        logger.error("Skills directory not found.");
        process.exit(1);
      }

      const skills = loadSkillMetadata(skillsDir);
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
        const { body, ...rest } = s;
        console.log(JSON.stringify(rest, null, 2));
        return;
      }

      logger.log(chalk.bold(`\n${s.displayName}`));
      logger.log(chalk.gray(`ID: ${s.id}  v${s.version}`));
      logger.log(chalk.gray(`Category: ${s.category}`));
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
      const skillsDir = findSkillsDir();
      if (!skillsDir) {
        logger.error("Skills directory not found.");
        process.exit(1);
      }

      const skills = loadSkillMetadata(skillsDir);
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
        logger.log(
          `  ${handler} ${chalk.cyan(s.id.padEnd(30))} ${chalk.gray(s.description.substring(0, 50))}`,
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
      const skillsDir = findSkillsDir();
      if (!skillsDir) {
        logger.error("Skills directory not found.");
        process.exit(1);
      }

      const skills = loadSkillMetadata(skillsDir);
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
        // Load the handler
        const handlerPath = path.join(skillsDir, s.dirName, "handler.js");
        const imported = await import(
          `file://${handlerPath.replace(/\\/g, "/")}`
        );
        const handler = imported.default || imported;

        // Initialize if needed
        if (handler.init) {
          await handler.init(s);
        }

        // Execute
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
            // Pretty print result
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
}
