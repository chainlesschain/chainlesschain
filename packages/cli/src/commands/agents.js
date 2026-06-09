/**
 * cc agents — user-defined subagents (Claude-Code parity, `.claude/agents/*.md`).
 *
 *   cc agents list [--json]                  list discovered agents
 *   cc agents show <name>                    show metadata + system prompt
 *   cc agents run <name> <task...> [opts]    run the task as this agent (headless)
 *   cc agents new <name> [--description <d>]  scaffold an agent file
 *
 * Each `.claude/agents/<name>.md` (project, recursive) or `~/.claude/agents/`
 * (personal) defines a subagent: the body is its system prompt; frontmatter
 * declares `description`, `tools` (allow-list), `model`. `run` maps the agent
 * onto a one-shot headless run (system prompt + tool scope + model), so a
 * portable Claude-Code agent definition is runnable as-is. Distinct from `cc
 * command` (prompt macros) and `cc skill` (AI-invoked capabilities).
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";

export function registerAgentsCommand(program) {
  const cmd = program
    .command("agents")
    .description("User-defined subagents (.claude/agents/*.md)");

  // ── list ──────────────────────────────────────────────────────────────
  cmd
    .command("list")
    .alias("ls")
    .description("List discovered subagents (project + personal)")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const { discoverAgents } = await import("../lib/agents.js");
        const all = discoverAgents(process.cwd());
        if (options.json) {
          console.log(JSON.stringify(all, null, 2));
          return;
        }
        if (all.length === 0) {
          logger.log(
            chalk.gray(
              "No subagents found. Create one with: cc agents new <name>",
            ),
          );
          return;
        }
        logger.log(chalk.bold(`Subagents (${all.length})`));
        for (const a of all) {
          const tools = a.tools ? a.tools.join(",") : "(all)";
          logger.log(
            `  ${chalk.cyan(a.name.padEnd(22))} ${chalk.gray(`[${a.scope}]`)} ` +
              `${a.description || ""}`,
          );
          logger.log(
            chalk.gray(
              `    tools: ${tools}${a.model ? ` · model: ${a.model}` : ""}`,
            ),
          );
        }
      } catch (err) {
        logger.error(chalk.red(`agents list failed: ${err.message}`));
        process.exitCode = 1;
      }
    });

  // ── show ──────────────────────────────────────────────────────────────
  cmd
    .command("show <name>")
    .description("Show an agent's metadata + system prompt")
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      try {
        const { getAgent } = await import("../lib/agents.js");
        const a = getAgent(name, process.cwd());
        if (!a) {
          logger.error(chalk.red(`no such agent: ${name}`));
          process.exitCode = 1;
          return;
        }
        if (options.json) {
          console.log(JSON.stringify(a, null, 2));
          return;
        }
        logger.log(chalk.bold(a.name) + chalk.gray(`  [${a.scope}]`));
        if (a.description) logger.log(chalk.gray(`  ${a.description}`));
        logger.log(
          chalk.gray(
            `  tools: ${a.tools ? a.tools.join(",") : "(all)"}` +
              `${a.model ? ` · model: ${a.model}` : ""}`,
          ),
        );
        logger.log(chalk.gray(`  file: ${a.file}`));
        logger.log("");
        logger.log(a.systemPrompt || chalk.gray("(empty system prompt)"));
      } catch (err) {
        logger.error(chalk.red(`agents show failed: ${err.message}`));
        process.exitCode = 1;
      }
    });

  // ── run ───────────────────────────────────────────────────────────────
  cmd
    .command("run <name> [task...]")
    .description("Run a task headlessly as the named subagent")
    .option("--output-format <fmt>", "text | json | stream-json", "text")
    .option("--model <model>", "Override the agent's model")
    .option("--permission-mode <mode>", "ApprovalGate tier (see cc agent)")
    .option("--add-dir <dir...>", "Extra workspace roots")
    .action(async (name, task, options) => {
      try {
        const { getAgent } = await import("../lib/agents.js");
        const a = getAgent(name, process.cwd());
        if (!a) {
          logger.error(chalk.red(`no such agent: ${name}`));
          process.exitCode = 1;
          return;
        }
        const prompt = Array.isArray(task) ? task.join(" ").trim() : "";
        if (!prompt) {
          logger.error(
            chalk.red(`agents run requires a task, e.g. cc agents run ${name} "review @src/x.js"`),
          );
          process.exitCode = 1;
          return;
        }
        const { runAgentHeadless } = await import("../runtime/headless-runner.js");
        const outcome = await runAgentHeadless({
          prompt,
          // The agent file's body becomes the system prompt (its persona).
          systemPrompt: a.systemPrompt || undefined,
          // Frontmatter `tools` scopes the run; null = inherit all.
          allowedTools: a.tools || undefined,
          model: options.model || a.model || undefined,
          outputFormat: options.outputFormat,
          permissionMode: options.permissionMode,
          additionalDirectories: Array.isArray(options.addDir)
            ? options.addDir
            : [],
        });
        process.exit(outcome.exitCode);
      } catch (err) {
        logger.error(chalk.red(`agents run failed: ${err.message}`));
        process.exitCode = 1;
      }
    });

  // ── new (scaffold) ────────────────────────────────────────────────────
  cmd
    .command("new <name>")
    .description("Scaffold a new agent file (project-native .chainlesschain/agents/)")
    .option("--description <d>", "Frontmatter description")
    .option("--tools <list>", "Comma-separated tool allow-list")
    .option("--claude", "Create under .claude/agents (Claude-Code-portable)")
    .option("--personal", "Create under ~/.claude/agents instead of project")
    .action(async (name, options) => {
      try {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const { homedir } = await import("node:os");
        const safe = String(name).replace(/^\//, "").replace(/:/g, "/");
        // New project agents go to the native `.chainlesschain/agents/`; use
        // --claude for the Claude-Code-portable `.claude/agents/`, or --personal
        // for `~/.claude/agents/`. All three are read back by discoverAgents.
        const root = options.personal
          ? path.join(homedir(), ".claude", "agents")
          : options.claude
            ? path.join(process.cwd(), ".claude", "agents")
            : path.join(process.cwd(), ".chainlesschain", "agents");
        const file = path.join(root, `${safe}.md`);
        if (fs.existsSync(file)) {
          logger.error(chalk.red(`already exists: ${file}`));
          process.exitCode = 1;
          return;
        }
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const toolsLine = options.tools
          ? `tools: ${options.tools}\n`
          : "# tools: read_file, search_files   # omit to inherit all tools\n";
        const tpl = `---
name: ${safe.replace(/\//g, ":")}
description: ${options.description || name}
${toolsLine}---

You are a focused subagent. Describe its role, constraints, and output format
here — this whole body becomes the system prompt for \`cc agents run ${safe.replace(/\//g, ":")}\`.
`;
        fs.writeFileSync(file, tpl, "utf-8");
        logger.log(chalk.green(`✓ created ${file}`));
        logger.log(
          chalk.gray(
            `  run it with: cc agents run ${safe.replace(/\//g, ":")} "<task>"`,
          ),
        );
      } catch (err) {
        logger.error(chalk.red(`agents new failed: ${err.message}`));
        process.exitCode = 1;
      }
    });
}
