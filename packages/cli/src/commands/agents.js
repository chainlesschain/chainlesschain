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

  cmd
    .command("background")
    .alias("bg")
    .description("List background agent sessions")
    .option("--all", "Include completed, failed, stopped and lost sessions")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const { listBackgroundAgents } =
        await import("../lib/background-agent-supervisor.js");
      const sessions = listBackgroundAgents({ all: options.all === true });
      if (options.json) {
        console.log(JSON.stringify(sessions, null, 2));
        return;
      }
      if (sessions.length === 0) {
        logger.log(chalk.gray("No background agents."));
        return;
      }
      for (const session of sessions) {
        const elapsed = session.endedAt
          ? session.endedAt - session.startedAt
          : Date.now() - session.startedAt;
        logger.log(
          `${chalk.cyan(session.id)}  ${session.status.padEnd(9)} ${Math.max(0, Math.round(elapsed / 1000))}s  ${session.title || ""}`,
        );
        logger.log(chalk.gray(`  pid ${session.pid}  ${session.cwd}`));
      }
    });

  cmd
    .command("logs <id>")
    .description("Print recent output from a background agent")
    .option("-n, --lines <n>", "Number of lines", "100")
    .action(async (id, options) => {
      try {
        const { readBackgroundAgentState, readBackgroundAgentLog } =
          await import("../lib/background-agent-supervisor.js");
        if (!readBackgroundAgentState(id)) {
          throw new Error(`Background agent not found: ${id}`);
        }
        process.stdout.write(
          readBackgroundAgentLog(id, { lines: Number(options.lines) }),
        );
      } catch (error) {
        logger.error(chalk.red(error.message));
        process.exitCode = 1;
      }
    });

  cmd
    .command("stop <id>")
    .description("Stop a running background agent")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const { stopBackgroundAgent } =
          await import("../lib/background-agent-supervisor.js");
        const state = stopBackgroundAgent(id);
        if (options.json) console.log(JSON.stringify(state, null, 2));
        else if (state.stopped)
          logger.log(chalk.green(`Stopped background agent ${id}`));
        else logger.log(chalk.gray(`${id} is already ${state.status}`));
      } catch (error) {
        logger.error(chalk.red(error.message));
        process.exitCode = 1;
      }
    });

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
            chalk.red(
              `agents run requires a task, e.g. cc agents run ${name} "review @src/x.js"`,
            ),
          );
          process.exitCode = 1;
          return;
        }
        // Resolve the effective LLM. Model precedence: --model > frontmatter
        // `model:` > config.llm.model. provider/baseUrl/apiKey come from
        // config.llm (cc agents run has no provider flag) — mirrors `cc agent`
        // so a cloud-configured setup runs without flags instead of silently
        // falling back to ollama (localhost:11434) and failing with "fetch
        // failed". (This path was never exercised while cc agents was unwired.)
        const { loadConfig } = await import("../lib/config-manager.js");
        const { applyConfigLlmDefaults } =
          await import("../lib/llm-config-defaults.js");
        const llmOpts = { model: options.model || a.model || undefined };
        applyConfigLlmDefaults(llmOpts, loadConfig().llm || {}, {
          explicitModel: options.model || a.model,
        });
        const resolvedModel = llmOpts.model || undefined;
        // Claude-Code 2.1.183 parity: warn on stderr if the resolved model
        // (--model / frontmatter / config) is a deprecated/retired snapshot.
        if (resolvedModel) {
          const { maybeWarnDeprecatedModel } =
            await import("../lib/model-deprecation.js");
          maybeWarnDeprecatedModel({ model: resolvedModel });
        }
        const { runAgentHeadless } =
          await import("../runtime/headless-runner.js");
        const outcome = await runAgentHeadless({
          prompt,
          // The agent file's body becomes the system prompt (its persona).
          systemPrompt: a.systemPrompt || undefined,
          // Frontmatter `tools` scopes the run; null = inherit all.
          allowedTools: a.tools || undefined,
          model: resolvedModel,
          provider: llmOpts.provider,
          baseUrl: llmOpts.baseUrl,
          apiKey: llmOpts.apiKey,
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
    .description(
      "Scaffold a new agent file (project-native .chainlesschain/agents/)",
    )
    .option("--description <d>", "Frontmatter description")
    .option("--tools <list>", "Comma-separated tool allow-list")
    .option("--claude", "Create under .claude/agents (Claude-Code-portable)")
    .option("--personal", "Create under ~/.claude/agents instead of project")
    .action(async (name, options) => {
      try {
        // New project agents go to the native `.chainlesschain/agents/`; use
        // --claude for the Claude-Code-portable `.claude/agents/`, or --personal
        // for `~/.claude/agents/`. All three are read back by discoverAgents.
        const { scaffoldAgent } = await import("../lib/agents.js");
        const location = options.personal
          ? "personal"
          : options.claude
            ? "claude"
            : "project";
        const res = scaffoldAgent({
          name,
          description: options.description,
          tools: options.tools,
          location,
        });
        if (!res.ok) {
          logger.error(chalk.red(res.reason));
          process.exitCode = 1;
          return;
        }
        logger.log(chalk.green(`✓ created ${res.file}`));
        logger.log(
          chalk.gray(`  run it with: cc agents run ${res.name} "<task>"`),
        );
      } catch (err) {
        logger.error(chalk.red(`agents new failed: ${err.message}`));
        process.exitCode = 1;
      }
    });
}
