/**
 * cc command — user-defined slash-command macros (Claude-Code parity).
 *
 *   cc command list [--json]                     list discovered commands
 *   cc command show <name>                       show metadata + template body
 *   cc command run <name> [args...] [opts]       expand the template and run it
 *                                                headlessly (or --print-prompt)
 *   cc command new <name> [--description <d>]    scaffold a command file
 *
 * Commands live in `.claude/commands/` (project, recursive) or
 * `~/.claude/commands/` (personal). A file `git/commit.md` → command
 * `git:commit`. Template body
 * supports $ARGUMENTS / $1..$9, !`bash` bang execution, and @path file refs.
 * Distinct from skills (AI-invoked); these are macros you run explicitly.
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";

export function registerCommandCommand(program) {
  const cmd = program
    .command("command")
    .alias("cmd")
    .description("User-defined slash-command macros (.claude/commands/*.md)");

  // ── list ──────────────────────────────────────────────────────────────
  cmd
    .command("list")
    .alias("ls")
    .description("List discovered command macros (project + personal)")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const { discoverCommands } = await import("../lib/slash-commands.js");
        const all = discoverCommands(process.cwd());
        if (options.json) {
          console.log(JSON.stringify(all, null, 2));
          return;
        }
        if (all.length === 0) {
          logger.log(
            chalk.gray(
              "No command macros. Create one: cc command new <name>  " +
                "(or add .claude/commands/<name>.md)",
            ),
          );
          return;
        }
        for (const c of all) {
          const tag =
            c.scope === "project" ? chalk.cyan("[proj]") : chalk.gray("[pers]");
          logger.log(
            `${chalk.bold("/" + c.name.padEnd(22))} ${tag} ${chalk.gray(c.description || "")}` +
              (c.argumentHint ? chalk.dim(`  ${c.argumentHint}`) : ""),
          );
        }
      } catch (err) {
        logger.error(chalk.red(`command list failed: ${err.message}`));
        process.exitCode = 1;
      }
    });

  // ── show ──────────────────────────────────────────────────────────────
  cmd
    .command("show <name>")
    .description("Show a command's metadata and template body")
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      try {
        const { getCommand } = await import("../lib/slash-commands.js");
        const c = getCommand(name, process.cwd());
        if (!c) {
          logger.error(chalk.red(`no such command: ${name}`));
          process.exitCode = 1;
          return;
        }
        if (options.json) {
          console.log(JSON.stringify(c, null, 2));
          return;
        }
        logger.log(
          chalk.bold(`/${c.name}`) + `  ${chalk.gray(`[${c.scope}]`)}`,
        );
        if (c.description) logger.log(chalk.gray(`  ${c.description}`));
        if (c.argumentHint) logger.log(chalk.gray(`  args: ${c.argumentHint}`));
        if (c.model) logger.log(chalk.gray(`  model: ${c.model}`));
        if (c.allowedTools)
          logger.log(chalk.gray(`  allowed-tools: ${c.allowedTools}`));
        logger.log(chalk.gray(`  file: ${c.file}`));
        logger.log(chalk.dim("  ───"));
        logger.log(c.body);
      } catch (err) {
        logger.error(chalk.red(`command show failed: ${err.message}`));
        process.exitCode = 1;
      }
    });

  // ── run ───────────────────────────────────────────────────────────────
  cmd
    .command("run <name> [args...]")
    .description("Expand a command template and run it headlessly")
    .option("--print-prompt", "Print the expanded prompt without running it")
    .option("--no-bang", "Do not execute !`cmd` bang segments")
    .option("--output-format <fmt>", "text | json | stream-json", "text")
    .option("--model <model>", "Override the model")
    .option("--permission-mode <mode>", "ApprovalGate tier (see cc agent)")
    .action(async (name, args, options) => {
      try {
        const { getCommand, expandCommand } =
          await import("../lib/slash-commands.js");
        const c = getCommand(name, process.cwd());
        if (!c) {
          logger.error(chalk.red(`no such command: ${name}`));
          process.exitCode = 1;
          return;
        }
        const { prompt, warnings } = expandCommand(c, args, {
          cwd: process.cwd(),
          allowBang: options.bang !== false, // commander maps --no-bang → bang:false
        });
        for (const w of warnings) process.stderr.write(`  @ref: ${w}\n`);

        if (options.printPrompt) {
          console.log(prompt);
          return;
        }

        // Resolve the effective LLM. Model precedence: --model > frontmatter
        // `model:` > config.llm.model. provider/baseUrl/apiKey come from
        // config.llm (cc command run has no provider flag) — mirrors `cc agent`
        // so a cloud-configured setup runs without flags instead of silently
        // falling back to ollama (localhost:11434) and failing with "fetch
        // failed".
        const { loadConfig } = await import("../lib/config-manager.js");
        const { applyConfigLlmDefaults } =
          await import("../lib/llm-config-defaults.js");
        const llmOpts = { model: options.model || c.model || undefined };
        applyConfigLlmDefaults(llmOpts, loadConfig().llm || {}, {
          explicitModel: options.model || c.model,
        });
        const resolvedModel = llmOpts.model || undefined;
        // Claude-Code 2.1.183 parity: surface model-deprecation notices for the
        // resolved model (--model / frontmatter / config), same as print mode.
        if (resolvedModel) {
          const { maybeWarnDeprecatedModel } =
            await import("../lib/model-deprecation.js");
          maybeWarnDeprecatedModel({ model: resolvedModel });
        }
        const { runAgentHeadless, parseToolList } =
          await import("../runtime/headless-runner.js");
        const outcome = await runAgentHeadless({
          prompt,
          outputFormat: options.outputFormat,
          model: resolvedModel,
          provider: llmOpts.provider,
          baseUrl: llmOpts.baseUrl,
          apiKey: llmOpts.apiKey,
          permissionMode: options.permissionMode,
          // A command's frontmatter allowed-tools scopes the run.
          allowedTools: parseToolList(c.allowedTools),
        });
        process.exit(outcome.exitCode);
      } catch (err) {
        logger.error(chalk.red(`command run failed: ${err.message}`));
        process.exitCode = 1;
      }
    });

  // ── new (scaffold) ────────────────────────────────────────────────────
  cmd
    .command("new <name>")
    .description(
      "Scaffold a new command file (project-native .chainlesschain/commands/)",
    )
    .option("--description <d>", "Frontmatter description")
    .option("--claude", "Create under .claude/commands (Claude-Code-portable)")
    .option("--personal", "Create under ~/.claude/commands instead of project")
    .action(async (name, options) => {
      try {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const { homedir } = await import("node:os");
        const safe = String(name).replace(/^\//, "").replace(/:/g, "/");
        // Project commands go to the native `.chainlesschain/commands/`; use
        // --claude for the portable `.claude/commands/`, --personal for home.
        const root = options.personal
          ? path.join(homedir(), ".claude", "commands")
          : options.claude
            ? path.join(process.cwd(), ".claude", "commands")
            : path.join(process.cwd(), ".chainlesschain", "commands");
        const file = path.join(root, `${safe}.md`);
        if (fs.existsSync(file)) {
          logger.error(chalk.red(`already exists: ${file}`));
          process.exitCode = 1;
          return;
        }
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tpl = `---
description: ${options.description || name}
argument-hint: "[args]"
---

Describe the task here. Use $ARGUMENTS for all args, $1/$2 for positional,
@path to inline file contents, and !\`git status\` to splice in command output.
`;
        fs.writeFileSync(file, tpl, "utf-8");
        logger.log(chalk.green(`✓ created ${file}`));
        logger.log(
          chalk.gray(
            `  run it with: cc command run ${safe.replace(/\//g, ":")} <args>`,
          ),
        );
      } catch (err) {
        logger.error(chalk.red(`command new failed: ${err.message}`));
        process.exitCode = 1;
      }
    });
}
