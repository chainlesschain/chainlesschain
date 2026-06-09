/**
 * cc output-style — list / show output-style personas (Claude-Code parity).
 *
 *   cc output-style list [--json]      list built-ins + .claude/output-styles/*.md
 *   cc output-style show <name>        show a style's metadata + body
 *   cc output-style new <name>         scaffold a new style file
 *
 * Apply one with `cc agent --output-style <name>` or the REPL `/output-style`,
 * or set a default via `outputStyle` in .claude/settings.json.
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";

export function registerOutputStyleCommand(program) {
  const cmd = program
    .command("output-style")
    .alias("output-styles")
    .description("List / show agent output-style personas");

  cmd
    .command("list", { isDefault: true })
    .alias("ls")
    .description("List built-in + .claude/output-styles/*.md personas")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const { discoverOutputStyles, settingsDefaultOutputStyle } =
          await import("../lib/output-styles.js");
        const all = discoverOutputStyles(process.cwd());
        const dflt = settingsDefaultOutputStyle(process.cwd());
        if (options.json) {
          console.log(JSON.stringify({ default: dflt, styles: all }, null, 2));
          return;
        }
        for (const s of all) {
          const tag = s.builtin
            ? chalk.gray("[builtin]")
            : s.scope === "project"
              ? chalk.cyan("[proj]")
              : chalk.gray("[pers]");
          const star = s.name === dflt ? chalk.green(" *") : "";
          logger.log(
            `${chalk.bold(s.name.padEnd(16))} ${tag}${star}  ${chalk.gray(s.description || "")}`,
          );
        }
        if (dflt) logger.log(chalk.dim(`\ndefault (settings.json): ${dflt}`));
      } catch (err) {
        logger.error(chalk.red(`output-style list failed: ${err.message}`));
        process.exitCode = 1;
      }
    });

  cmd
    .command("show <name>")
    .description("Show a style's metadata and body")
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      try {
        const { getOutputStyle } = await import("../lib/output-styles.js");
        const s = getOutputStyle(name, process.cwd());
        if (!s) {
          logger.error(chalk.red(`no such output style: ${name}`));
          process.exitCode = 1;
          return;
        }
        if (options.json) {
          console.log(JSON.stringify(s, null, 2));
          return;
        }
        logger.log(
          chalk.bold(s.name) +
            (s.builtin ? chalk.gray("  [builtin]") : chalk.gray(`  [${s.scope}]`)),
        );
        if (s.description) logger.log(chalk.gray(`  ${s.description}`));
        if (s.file) logger.log(chalk.gray(`  file: ${s.file}`));
        logger.log(chalk.dim("  ───"));
        logger.log(s.body || chalk.gray("(empty — no persona overlay)"));
      } catch (err) {
        logger.error(chalk.red(`output-style show failed: ${err.message}`));
        process.exitCode = 1;
      }
    });

  cmd
    .command("new <name>")
    .description("Scaffold a new style under .claude/output-styles/")
    .option("--description <d>", "Frontmatter description")
    .option("--personal", "Create under ~/.claude/output-styles instead of project")
    .action(async (name, options) => {
      try {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const { homedir } = await import("node:os");
        const safe = String(name).replace(/[^\w.-]/g, "-");
        const root = options.personal
          ? path.join(homedir(), ".claude", "output-styles")
          : path.join(process.cwd(), ".claude", "output-styles");
        const file = path.join(root, `${safe}.md`);
        if (fs.existsSync(file)) {
          logger.error(chalk.red(`already exists: ${file}`));
          process.exitCode = 1;
          return;
        }
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tpl = `---
name: ${safe}
description: ${options.description || name}
---

## Output style: ${safe}

Describe how the agent should behave in this style. This text is appended to
the system prompt (after the base coding instructions), so keep it focused on
*behaviour / tone*, not tool mechanics.
`;
        fs.writeFileSync(file, tpl, "utf-8");
        logger.log(chalk.green(`✓ created ${file}`));
        logger.log(
          chalk.gray(`  use it: cc agent --output-style ${safe} -p "..."`),
        );
      } catch (err) {
        logger.error(chalk.red(`output-style new failed: ${err.message}`));
        process.exitCode = 1;
      }
    });
}
