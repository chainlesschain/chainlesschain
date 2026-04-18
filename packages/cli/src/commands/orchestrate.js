/**
 * Orchestrate command — ChainlessChain as orchestration layer,
 * Claude Code / Codex as parallel execution agents.
 *
 * Usage:
 *   cc orchestrate "Fix the auth bug in login.ts"
 *   cc orchestrate "Refactor payment service" --agents 5 --ci "npm run test:unit"
 *   cc orchestrate --status
 *   cc orchestrate --watch --interval 10
 *   cc orchestrate detect        # Check which AI CLI is installed
 */

import chalk from "chalk";
import ora from "ora";
import fs from "fs";
import path from "path";
import { logger } from "../lib/logger.js";

export function registerOrchestrateCommand(program) {
  const cmd = program
    .command("orchestrate [task]")
    .description(
      "Orchestrate AI coding tasks: ChainlessChain → Claude Code/Codex agents → CI/CD → Notify",
    )
    .option("-a, --agents <n>", "Max parallel agents", "3")
    .option(
      "--ci <command>",
      "CI command to run after agents complete",
      "npm test",
    )
    .option("--no-ci", "Skip CI/CD verification step")
    .option(
      "--source <type>",
      "Input source: cli|sentry|github|file|wecom|dingtalk|feishu",
      "cli",
    )
    .option("--file <path>", "Read task from file (use with --source file)")
    .option("--context <text>", "Extra context for the task (e.g. stack trace)")
    .option("--cwd <path>", "Project root directory (default: current dir)")
    .option("--provider <name>", "LLM provider for decomposition")
    .option("--model <name>", "Model for decomposition LLM calls")
    .option("--cli-tool <name>", "Execution CLI: claude|codex (auto-detected)")
    .option(
      "--backends <list>",
      "Agent backends: claude,codex,gemini,openai,ollama (comma-separated)",
    )
    .option(
      "--strategy <name>",
      "Agent routing: round-robin|by-type|parallel-all|primary",
      "round-robin",
    )
    .option("--retries <n>", "Max CI retry cycles", "3")
    .option("--timeout <sec>", "Per-agent timeout in seconds", "300")
    .option("--no-notify", "Disable notifications")
    .option("--status", "Show orchestrator and agent pool status")
    .option("--watch", "Start cron watch mode")
    .option("--interval <min>", "Cron interval in minutes (watch mode)", "10")
    .option("--webhook", "Start HTTP webhook server for IM platform commands")
    .option("--webhook-port <port>", "Webhook server port", "18820")
    .option("--json", "Output as JSON")
    .option("--verbose", "Verbose output");

  cmd.action(async (task, options) => {
    // Special sub-keyword: cc orchestrate detect
    if (task === "detect") {
      const { detectClaudeCode, detectCodex } =
        await import("../lib/claude-code-bridge.js");
      const claude = detectClaudeCode();
      const codex = detectCodex();
      console.log(chalk.bold("\n\uD83D\uDD0D AI CLI Detection\n"));
      console.log(
        claude.found
          ? chalk.green(`  \u2713 claude  ${claude.version}`)
          : chalk.red(
              "  \u2717 claude  not found (install: npm i -g @anthropic-ai/claude-code)",
            ),
      );
      console.log(
        codex.found
          ? chalk.green(`  \u2713 codex   ${codex.version}`)
          : chalk.gray("  \u2717 codex   not found"),
      );
      if (!claude.found && !codex.found) {
        console.log(
          chalk.yellow(
            "\n  \u26A0 No AI CLI found. Install Claude Code:\n    npm install -g @anthropic-ai/claude-code\n",
          ),
        );
      }
      return;
    }

    const { Orchestrator, TASK_SOURCE, TASK_STATUS } =
      await import("../lib/orchestrator.js");

    const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();

    // --status mode
    if (options.status) {
      await _showStatus(cwd, options);
      return;
    }

    // --watch mode
    if (options.watch) {
      await _watchMode(cwd, options);
      return;
    }

    // --webhook mode: start HTTP server to receive commands from IM platforms
    if (options.webhook) {
      await _webhookMode(cwd, options);
      return;
    }

    // Resolve task text
    let taskText = task || "";
    if (options.source === "file" && options.file) {
      try {
        taskText = fs.readFileSync(path.resolve(options.file), "utf-8").trim();
      } catch (err) {
        logger.error(`Cannot read file: ${err.message}`);
        process.exit(1);
      }
    }

    if (!taskText) {
      console.log(
        chalk.yellow('Usage: cc orchestrate "<task description>"') +
          chalk.gray(
            "\n       cc orchestrate --status\n       cc orchestrate --watch\n       cc orchestrate --webhook  # receive commands from WeCom/DingTalk/Feishu\n",
          ),
      );
      process.exit(1);
    }

    // Build agent backends from --backends option
    let agentsConfig;
    if (options.backends) {
      const { BACKEND_TYPE } = await import("../lib/agent-router.js");
      const backendNames = options.backends.split(",").map((s) => s.trim());
      agentsConfig = {
        backends: backendNames.map((type) => ({ type, weight: 1 })),
        strategy: options.strategy || "round-robin",
      };
    } else if (options.strategy && options.strategy !== "round-robin") {
      agentsConfig = { strategy: options.strategy };
    }

    // Build orchestrator
    const orch = new Orchestrator({
      cwd,
      maxParallel: parseInt(options.agents, 10) || 3,
      maxRetries: parseInt(options.retries, 10) || 3,
      ciCommand: options.ci || "npm test",
      agents: agentsConfig,
      model: options.model || undefined,
      llm: options.provider
        ? { provider: options.provider, model: options.model }
        : {},
      verbose: options.verbose,
    });

    if (options.json) {
      _runJson(orch, taskText, options);
      return;
    }

    // Pretty output
    _runPretty(orch, taskText, options, cwd);
  });

  // ===== V2 governance subcommands (agent-router V2) =====
  const router = program
    .command("router")
    .description("Agent router V2 governance");
  router
    .command("maturities-v2")
    .description("List router profile maturity states (V2)")
    .action(async () => {
      const m = await import("../lib/agent-router.js");
      console.log(JSON.stringify(m.ROUTER_PROFILE_MATURITY_V2, null, 2));
    });
  router
    .command("dispatch-lifecycle-v2")
    .description("List router dispatch lifecycle states (V2)")
    .action(async () => {
      const m = await import("../lib/agent-router.js");
      console.log(JSON.stringify(m.ROUTER_DISPATCH_LIFECYCLE_V2, null, 2));
    });
  router
    .command("stats-v2")
    .description("Show agent-router V2 stats")
    .action(async () => {
      const m = await import("../lib/agent-router.js");
      console.log(JSON.stringify(m.getAgentRouterStatsV2(), null, 2));
    });
  router
    .command("config-v2")
    .description("Show agent-router V2 config")
    .action(async () => {
      const m = await import("../lib/agent-router.js");
      console.log(
        JSON.stringify(
          {
            maxActiveProfilesPerOwner: m.getMaxActiveProfilesPerOwnerRouterV2(),
            maxPendingDispatchesPerProfile:
              m.getMaxPendingDispatchesPerProfileV2(),
            profileIdleMs: m.getProfileIdleMsRouterV2(),
            dispatchStuckMs: m.getDispatchStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  router
    .command("register-profile-v2 <id> <owner>")
    .description("Register a router profile (V2)")
    .action(async (id, owner) => {
      const m = await import("../lib/agent-router.js");
      console.log(
        JSON.stringify(m.registerRouterProfileV2({ id, owner }), null, 2),
      );
    });
  router.command("activate-profile-v2 <id>").action(async (id) => {
    const m = await import("../lib/agent-router.js");
    console.log(JSON.stringify(m.activateRouterProfileV2(id), null, 2));
  });
  router.command("degrade-profile-v2 <id>").action(async (id) => {
    const m = await import("../lib/agent-router.js");
    console.log(JSON.stringify(m.degradeRouterProfileV2(id), null, 2));
  });
  router.command("retire-profile-v2 <id>").action(async (id) => {
    const m = await import("../lib/agent-router.js");
    console.log(JSON.stringify(m.retireRouterProfileV2(id), null, 2));
  });
  router.command("touch-profile-v2 <id>").action(async (id) => {
    const m = await import("../lib/agent-router.js");
    console.log(JSON.stringify(m.touchRouterProfileV2(id), null, 2));
  });
  router.command("get-profile-v2 <id>").action(async (id) => {
    const m = await import("../lib/agent-router.js");
    console.log(JSON.stringify(m.getRouterProfileV2(id), null, 2));
  });
  router.command("list-profiles-v2").action(async () => {
    const m = await import("../lib/agent-router.js");
    console.log(JSON.stringify(m.listRouterProfilesV2(), null, 2));
  });
  router
    .command("create-dispatch-v2 <id> <profileId> [task]")
    .action(async (id, profileId, task) => {
      const m = await import("../lib/agent-router.js");
      console.log(
        JSON.stringify(m.createDispatchV2({ id, profileId, task }), null, 2),
      );
    });
  router.command("dispatch-v2 <id>").action(async (id) => {
    const m = await import("../lib/agent-router.js");
    console.log(JSON.stringify(m.dispatchDispatchV2(id), null, 2));
  });
  router.command("complete-dispatch-v2 <id>").action(async (id) => {
    const m = await import("../lib/agent-router.js");
    console.log(JSON.stringify(m.completeDispatchV2(id), null, 2));
  });
  router
    .command("fail-dispatch-v2 <id> [reason]")
    .action(async (id, reason) => {
      const m = await import("../lib/agent-router.js");
      console.log(JSON.stringify(m.failDispatchV2(id, reason), null, 2));
    });
  router
    .command("cancel-dispatch-v2 <id> [reason]")
    .action(async (id, reason) => {
      const m = await import("../lib/agent-router.js");
      console.log(JSON.stringify(m.cancelDispatchV2(id, reason), null, 2));
    });
  router.command("get-dispatch-v2 <id>").action(async (id) => {
    const m = await import("../lib/agent-router.js");
    console.log(JSON.stringify(m.getDispatchV2(id), null, 2));
  });
  router.command("list-dispatches-v2").action(async () => {
    const m = await import("../lib/agent-router.js");
    console.log(JSON.stringify(m.listDispatchesV2(), null, 2));
  });
  router.command("auto-degrade-idle-v2").action(async () => {
    const m = await import("../lib/agent-router.js");
    console.log(JSON.stringify(m.autoDegradeIdleProfilesRouterV2(), null, 2));
  });
  router.command("auto-fail-stuck-v2").action(async () => {
    const m = await import("../lib/agent-router.js");
    console.log(JSON.stringify(m.autoFailStuckDispatchesV2(), null, 2));
  });
  router.command("set-max-active-profiles-v2 <n>").action(async (n) => {
    const m = await import("../lib/agent-router.js");
    m.setMaxActiveProfilesPerOwnerRouterV2(parseInt(n, 10));
    console.log(
      JSON.stringify(
        { maxActiveProfilesPerOwner: m.getMaxActiveProfilesPerOwnerRouterV2() },
        null,
        2,
      ),
    );
  });
  router.command("set-max-pending-dispatches-v2 <n>").action(async (n) => {
    const m = await import("../lib/agent-router.js");
    m.setMaxPendingDispatchesPerProfileV2(parseInt(n, 10));
    console.log(
      JSON.stringify(
        {
          maxPendingDispatchesPerProfile:
            m.getMaxPendingDispatchesPerProfileV2(),
        },
        null,
        2,
      ),
    );
  });
  router.command("set-profile-idle-ms-v2 <n>").action(async (n) => {
    const m = await import("../lib/agent-router.js");
    m.setProfileIdleMsRouterV2(parseInt(n, 10));
    console.log(
      JSON.stringify({ profileIdleMs: m.getProfileIdleMsRouterV2() }, null, 2),
    );
  });
  router.command("set-dispatch-stuck-ms-v2 <n>").action(async (n) => {
    const m = await import("../lib/agent-router.js");
    m.setDispatchStuckMsV2(parseInt(n, 10));
    console.log(
      JSON.stringify({ dispatchStuckMs: m.getDispatchStuckMsV2() }, null, 2),
    );
  });
  router.command("reset-state-v2").action(async () => {
    const m = await import("../lib/agent-router.js");
    m._resetStateAgentRouterV2();
    console.log(JSON.stringify({ ok: true }, null, 2));
  });
}

// ─── Pretty (interactive) run ────────────────────────────────────

async function _runPretty(orch, taskText, options, cwd) {
  const { TASK_STATUS } = await import("../lib/orchestrator.js");

  console.log(chalk.bold.cyan("\n⚡ ChainlessChain Orchestrator\n"));
  console.log(chalk.gray(`  Task:    `) + chalk.white(taskText.slice(0, 120)));
  console.log(chalk.gray(`  CWD:     `) + chalk.white(cwd));
  console.log(
    chalk.gray(`  Agents:  `) +
      chalk.white(`max ${options.agents} × ${orch.cliCommand}`),
  );
  if (options.ci !== false) {
    console.log(chalk.gray(`  CI:      `) + chalk.white(orch.ciCommand));
  }
  console.log();

  const spinner = ora("Decomposing task...").start();

  orch.on("task:decomposed", ({ subtasks }) => {
    spinner.text = `Decomposed into ${subtasks.length} subtask(s)`;
  });

  orch.on("agents:dispatched", ({ count }) => {
    spinner.text = `Dispatching ${count} subtask(s) to ${orch.cliCommand} agents...`;
  });

  orch.on("batch:start", ({ count }) => {
    spinner.text = `Running batch of ${count} agent(s)...`;
  });

  orch.on("agent:complete", ({ taskId, success, duration }) => {
    const icon = success ? chalk.green("✓") : chalk.red("✗");
    spinner.text = `Agent done: ${icon} ${taskId} (${Math.round(duration / 1000)}s)`;
  });

  orch.on("ci:checking", ({ attempt }) => {
    spinner.text = `Running CI check (attempt ${attempt + 1})...`;
  });

  orch.on("ci:fail", ({ errors, attempt }) => {
    spinner.text = `CI failed (attempt ${attempt + 1}) — retrying with agents...`;
  });

  orch.on("task:complete", (task) => {
    spinner.succeed(
      chalk.green(`✅ Task completed`) +
        chalk.gray(` [${task.id}]  status: ${task.status}`),
    );
    _printSummary(task);
  });

  orch.on("task:failed", ({ task, error }) => {
    spinner.fail(chalk.red(`❌ Task failed: ${error}`));
    _printSummary(task);
  });

  orch.on("log", (msg) => {
    if (options.verbose) spinner.text = msg;
  });

  try {
    const { TASK_SOURCE } = await import("../lib/orchestrator.js");
    await orch.addTask(taskText, {
      source:
        options.source === "sentry"
          ? TASK_SOURCE.SENTRY
          : options.source === "github"
            ? TASK_SOURCE.GITHUB
            : options.source === "file"
              ? TASK_SOURCE.FILE
              : TASK_SOURCE.CLI,
      context: options.context || "",
      cwd,
      runCI: options.ci !== false,
      notify: options.notify !== false,
    });
  } catch (err) {
    spinner.fail(chalk.red(`Orchestration error: ${err.message}`));
    if (options.verbose) console.error(err);
    process.exit(1);
  }
}

// ─── JSON run ────────────────────────────────────────────────────

async function _runJson(orch, taskText, options) {
  const { TASK_SOURCE } = await import("../lib/orchestrator.js");
  try {
    const task = await orch.addTask(taskText, {
      source: TASK_SOURCE.CLI,
      context: options.context || "",
      runCI: options.ci !== false,
      notify: false,
    });
    console.log(JSON.stringify(task, null, 2));
  } catch (err) {
    console.log(JSON.stringify({ error: err.message }, null, 2));
    process.exit(1);
  }
}

// ─── Status ──────────────────────────────────────────────────────

async function _showStatus(cwd, options) {
  const { detectClaudeCode, detectCodex } =
    await import("../lib/claude-code-bridge.js");
  const claude = detectClaudeCode();
  const codex = detectCodex();

  const status = {
    cliTools: {
      claude: claude.found ? claude.version : "not found",
      codex: codex.found ? codex.version : "not found",
    },
    activeCliTool: claude.found ? "claude" : codex.found ? "codex" : "none",
  };

  const { AgentRouter } = await import("../lib/agent-router.js");
  const router = AgentRouter.autoDetect();
  const backends = router.summary();

  if (options.json) {
    console.log(JSON.stringify({ ...status, backends }, null, 2));
    return;
  }

  console.log(chalk.bold.cyan("\n⚡ Orchestrator Status\n"));
  console.log(chalk.bold("  CLI Tools"));
  console.log(
    `    ${chalk.gray("claude:")}  ` +
      (claude.found ? chalk.green(claude.version) : chalk.red("not installed")),
  );
  console.log(
    `    ${chalk.gray("codex:")}   ` +
      (codex.found ? chalk.green(codex.version) : chalk.gray("not installed")),
  );
  console.log();
  console.log(chalk.bold("  Auto-detected Backends"));
  for (const b of backends) {
    const icon = b.kind === "cli" ? "🖥" : "🌐";
    console.log(
      `    ${icon} ${chalk.cyan(b.type.padEnd(12))} ${chalk.gray(b.kind)}  weight:${b.weight}`,
    );
  }

  console.log();
  console.log(chalk.bold("  Notification Channels"));
  const { NotificationManager } = await import("../lib/notifiers/index.js");
  const nm = NotificationManager.fromEnv();
  const channels = nm.activeChannels;
  if (channels.length === 0) {
    console.log(
      chalk.gray(
        "    (none configured — set TELEGRAM_BOT_TOKEN, WECOM_WEBHOOK_URL, etc.)",
      ),
    );
  } else {
    for (const ch of channels) {
      console.log(`    ${chalk.green("✓")} ${ch}`);
    }
  }
  console.log();
}

// ─── Webhook mode (receive commands from IM platforms) ─────────────

async function _webhookMode(cwd, options) {
  const { createServer } = await import("http");
  const { parseDingTalkIncoming, parseFeishuIncoming, parseWeComIncoming } =
    await import("../lib/notifiers/index.js");
  const { Orchestrator, TASK_SOURCE } = await import("../lib/orchestrator.js");

  const port = parseInt(options.webhookPort, 10) || 18820;

  const orch = new Orchestrator({ cwd, verbose: options.verbose });

  const server = createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end("Method Not Allowed");
      return;
    }

    let body = "";
    req.on("data", (chunk) => (body += chunk.toString("utf8")));
    req.on("end", async () => {
      let taskText = null;
      let source = TASK_SOURCE.CLI;

      const url = req.url?.split("?")[0] || "/";

      try {
        if (url === "/wecom") {
          taskText = parseWeComIncoming(body);
          source = TASK_SOURCE.CLI;
        } else if (url === "/dingtalk") {
          const parsed = JSON.parse(body);
          taskText = parseDingTalkIncoming(parsed);
          source = TASK_SOURCE.CLI;
        } else if (url === "/feishu") {
          const parsed = JSON.parse(body);
          // Feishu challenge verification
          if (parsed.challenge) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ challenge: parsed.challenge }));
            return;
          }
          taskText = parseFeishuIncoming(parsed);
          source = TASK_SOURCE.CLI;
        } else {
          res.writeHead(404);
          res.end("Not Found");
          return;
        }
      } catch (_err) {
        res.writeHead(400);
        res.end("Bad Request");
        return;
      }

      if (!taskText) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, message: "no task detected" }));
        return;
      }

      // Acknowledge immediately (IM platforms require fast response)
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          message: `task queued: ${taskText.slice(0, 60)}`,
        }),
      );

      // Run orchestration async
      if (!options.json) {
        console.log(
          chalk.cyan(`[webhook] Received task: `) + taskText.slice(0, 80),
        );
      }
      orch
        .addTask(taskText, {
          source,
          cwd,
          runCI: options.ci !== false,
          notify: true,
        })
        .catch((err) =>
          console.error(chalk.red(`[webhook] Error: ${err.message}`)),
        );
    });
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(chalk.bold.cyan("\n⚡ Orchestrator Webhook Server\n"));
    console.log(
      `  ${chalk.gray("WeCom:")}    POST http://localhost:${port}/wecom`,
    );
    console.log(
      `  ${chalk.gray("DingTalk:")} POST http://localhost:${port}/dingtalk`,
    );
    console.log(
      `  ${chalk.gray("Feishu:")}   POST http://localhost:${port}/feishu`,
    );
    console.log(chalk.gray("\n  Press Ctrl+C to stop\n"));
  });

  process.on("SIGINT", () => {
    server.close();
    orch.stopCronWatch();
    console.log(chalk.gray("\nWebhook server stopped."));
    process.exit(0);
  });
}

// ─── Watch mode ──────────────────────────────────────────────────

async function _watchMode(cwd, options) {
  const { Orchestrator } = await import("../lib/orchestrator.js");
  const intervalMs = parseInt(options.interval, 10) * 60_000 || 600_000;

  const orch = new Orchestrator({ cwd, verbose: options.verbose });
  orch.startCronWatch(intervalMs);

  orch.on("cron:tick", ({ at }) => {
    if (!options.json) console.log(chalk.gray(`[cron] tick at ${at}`));
  });

  console.log(
    chalk.cyan(`\n⚡ Orchestrator watch mode started`) +
      chalk.gray(` (interval: ${options.interval}m)`),
  );
  console.log(chalk.gray("  Press Ctrl+C to stop\n"));

  // Keep alive
  process.on("SIGINT", () => {
    orch.stopCronWatch();
    console.log(chalk.gray("\nOrchestrator stopped."));
    process.exit(0);
  });
}

// ─── Summary printer ─────────────────────────────────────────────

function _printSummary(task) {
  console.log();
  console.log(chalk.bold("  Summary"));
  console.log(chalk.gray("  ─────────────────────────────────"));
  console.log(`  ID:       ${chalk.cyan(task.id)}`);
  console.log(`  Source:   ${task.source}`);
  console.log(`  Retries:  ${task.retries}`);
  console.log(`  Status:   ${_statusColor(task.status)}`);

  if (task.subtasks?.length) {
    console.log(`  Subtasks: ${task.subtasks.length}`);
  }

  if (task.agentResults?.length) {
    const passed = task.agentResults.filter((r) => r.success).length;
    console.log(
      `  Agents:   ${chalk.green(passed)} passed / ${chalk.red(task.agentResults.length - passed)} failed`,
    );
  }
  console.log();
}

function _statusColor(status) {
  const colors = {
    completed: chalk.green,
    "ci-passed": chalk.green,
    failed: chalk.red,
    "ci-failed": chalk.red,
    retrying: chalk.yellow,
    dispatched: chalk.cyan,
    "ci-checking": chalk.cyan,
  };
  return (colors[status] || chalk.white)(status);
}
