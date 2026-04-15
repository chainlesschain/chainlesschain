/**
 * Agentic REPL - Claude Code / Codex style
 *
 * User speaks naturally → AI understands intent → picks tools → executes → shows result
 *
 * Built-in tools:
 *  - read_file: Read a file
 *  - write_file: Write/create a file
 *  - edit_file: Edit part of a file
 *  - run_shell: Execute a shell command
 *  - search_files: Search for files by name/content
 *  - list_dir: List directory contents
 *  - run_skill: Run a built-in skill
 *  - list_skills: List available skills
 *  - run_code: Write and execute code (Python/Node.js/Bash)
 *
 * The AI decides which tools to call based on user intent.
 */

import readline from "readline";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import { logger } from "../lib/logger.js";
import { getPlanModeManager, PlanState } from "../lib/plan-mode.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  createSession,
  saveMessages,
  getSession,
} from "../lib/session-manager.js";
import {
  startSession as jsonlStartSession,
  appendUserMessage,
  appendAssistantMessage,
  appendCompactEvent,
  rebuildMessages,
  sessionExists,
} from "../harness/jsonl-session-store.js";
import { storeMemory, consolidateMemory } from "../lib/hierarchical-memory.js";
import { CLIContextEngineering } from "../lib/cli-context-engineering.js";
import { defaultPrepareCall } from "../lib/turn-context.js";
import { createChatFn } from "../lib/cowork-adapter.js";
import {
  detectTaskType,
  selectModelForTask,
} from "../lib/task-model-selector.js";
import { CLIPermanentMemory } from "../lib/permanent-memory.js";
import { CLIAutonomousAgent, GoalStatus } from "../lib/autonomous-agent.js";
import { PromptCompressor } from "../harness/prompt-compressor.js";
import { feature } from "../lib/feature-flags.js";
import { recordCompressionMetric } from "../lib/compression-telemetry.js";
import {
  fireSessionHook,
  fireUserPromptSubmit,
  fireAssistantResponse,
} from "../lib/session-hooks.js";
import { HookEvents } from "../lib/hook-manager.js";
import { IterationBudget } from "../lib/iteration-budget.js";
import {
  AGENT_TOOLS,
  buildSystemPrompt,
  executeTool as coreExecuteTool,
  agentLoop as coreAgentLoop,
  formatToolArgs,
} from "../runtime/agent-core.js";

/**
 * Reference to the runtime DB for hook execution (set during startAgentRepl)
 */
let _hookDb = null;
let _compressor = null;

/**
 * Execute a tool call — delegates to agent-core with REPL's hookDb and cwd.
 */
async function executeTool(name, args) {
  return coreExecuteTool(name, args, { hookDb: _hookDb, cwd: process.cwd() });
}

/**
 * Agentic loop — wraps agent-core's async generator with REPL display output.
 */
async function agentLoop(messages, options) {
  for await (const event of coreAgentLoop(messages, options)) {
    if (event.type === "tool-executing") {
      process.stdout.write(
        chalk.gray(
          `  [${event.tool}] ${formatToolArgs(event.tool, event.args)}\n`,
        ),
      );
    } else if (event.type === "tool-result") {
      if (event.error || event.result?.error) {
        process.stdout.write(
          chalk.red(`  Error: ${event.error || event.result?.error}\n`),
        );
      } else if (event.result?.success) {
        process.stdout.write(chalk.green(`  Done\n`));
      }
    } else if (event.type === "iteration-warning") {
      process.stdout.write(chalk.yellow(`\n  ${event.message}\n`));
    } else if (event.type === "iteration-budget-exhausted") {
      process.stdout.write(
        chalk.red(`\n  [Budget Exhausted] ${event.budget}\n`),
      );
    } else if (event.type === "response-complete") {
      return event.content;
    }
  }
  return "";
}

/**
 * Start the agentic REPL
 */
export async function startAgentRepl(options = {}) {
  let model = options.model || "qwen2.5:7b";
  let provider = options.provider || "ollama";
  const baseUrl = options.baseUrl || "http://localhost:11434";
  const apiKey = options.apiKey || null;

  // Bootstrap runtime (best-effort, DB not required)
  let db = null;
  let contextEngine = null;
  let sessionId = null;

  try {
    const ctx = await bootstrap({ verbose: false });
    db = ctx.db || null;
  } catch (_err) {
    // Continue without DB — static prompt fallback
  }

  // Initialize prompt compressor (adaptive to model's context window)
  if (feature("PROMPT_COMPRESSOR")) {
    _compressor = new PromptCompressor({ model, provider });
  }

  // Initialize permanent memory
  let permanentMemory = null;
  try {
    const dataDir = process.env.CHAINLESSCHAIN_DATA_DIR || process.cwd();
    const memoryDir = path.join(dataDir, "memory");
    permanentMemory = new CLIPermanentMemory({ db, memoryDir });
    permanentMemory.initialize();
  } catch (_err) {
    // Non-critical
  }

  contextEngine = new CLIContextEngineering({ db, permanentMemory });

  // Initialize autonomous agent
  const autonomousAgent = new CLIAutonomousAgent();

  // Set hook DB reference for tool pipeline
  _hookDb = db;

  // Resume existing session or create new one
  const useJsonl = feature("JSONL_SESSION");

  if (useJsonl && options.sessionId) {
    // JSONL resume: check if session file exists
    try {
      if (sessionExists(options.sessionId)) {
        sessionId = options.sessionId;
      }
    } catch (_err) {
      // Non-critical
    }
  } else if (db && options.sessionId) {
    try {
      const existing = getSession(db, options.sessionId);
      if (existing && existing.messages) {
        sessionId = existing.id;
      }
    } catch (_err) {
      // Non-critical — will create new session
    }
  }

  if (!sessionId) {
    const meta = {
      title: `Agent ${new Date().toISOString().slice(0, 10)}`,
      provider,
      model,
    };
    if (useJsonl) {
      try {
        sessionId = jsonlStartSession(null, meta);
      } catch (_err) {
        // Non-critical
      }
    } else if (db) {
      try {
        const session = createSession(db, meta);
        sessionId = session.id;
      } catch (_err) {
        // Non-critical
      }
    }
  }

  const messages = [
    { role: "system", content: buildSystemPrompt(process.cwd()) },
  ];

  // Load resumed session messages
  if (options.sessionId && sessionId) {
    try {
      if (useJsonl) {
        const rebuilt = rebuildMessages(sessionId);
        if (rebuilt.length > 0) {
          messages.push(...rebuilt.filter((m) => m.role !== "system"));
          logger.info(
            `Resumed JSONL session ${sessionId} (${rebuilt.length} messages)`,
          );
        }
      } else if (db) {
        const existing = getSession(db, sessionId);
        if (existing && existing.messages) {
          const parsed =
            typeof existing.messages === "string"
              ? JSON.parse(existing.messages)
              : existing.messages;
          messages.push(...parsed.filter((m) => m.role !== "system"));
          logger.info(
            `Resumed session ${sessionId} (${parsed.length} messages)`,
          );
        }
      }
    } catch (_err) {
      // Non-critical
    }
  }

  const getPrompt = () => {
    const planManager = getPlanModeManager();
    if (planManager.isActive()) {
      const state = planManager.state;
      if (state === PlanState.APPROVED || state === PlanState.EXECUTING) {
        return chalk.green("[plan:exec] > ");
      }
      return chalk.yellow("[plan] > ");
    }
    return chalk.green("> ");
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: getPrompt(),
    terminal: true,
  });

  logger.log(chalk.bold("\nChainlessChain Agent"));
  logger.log(
    chalk.gray(`Model: ${model}  Provider: ${provider}  CWD: ${process.cwd()}`),
  );
  if (sessionId) {
    logger.log(chalk.gray(`Session: ${sessionId}`));
  }
  if (db) {
    logger.log(chalk.gray("Context: instinct + memory + notes (DB connected)"));
  }
  logger.log(
    chalk.gray(
      "Describe what you want to do. I can read/write files, run commands, and more.",
    ),
  );
  logger.log(chalk.gray("Type /exit to quit, /help for commands\n"));

  const prompt = () => {
    rl.setPrompt(getPrompt());
    rl.prompt();
  };

  // Fire SessionStart hook (fire-and-forget; hook failures never break REPL)
  await fireSessionHook(_hookDb, HookEvents.SessionStart, {
    sessionId,
    provider,
    model,
    cwd: process.cwd(),
  });

  prompt();

  rl.on("line", async (input) => {
    const trimmed = input.trim();
    if (!trimmed) {
      prompt();
      return;
    }

    // Slash commands
    if (trimmed === "/exit" || trimmed === "/quit") {
      logger.log(chalk.gray("\nGoodbye!"));
      rl.close();
      return;
    }

    if (trimmed === "/help") {
      logger.log(chalk.bold("\nCommands:"));
      logger.log(`  ${chalk.cyan("/exit")}       Exit the agent`);
      logger.log(
        `  ${chalk.cyan("/model")}      Show/change model (/model <name>)`,
      );
      logger.log(`  ${chalk.cyan("/provider")}   Show/change provider`);
      logger.log(`  ${chalk.cyan("/clear")}      Clear conversation`);
      logger.log(
        `  ${chalk.cyan("/compact")}    Smart compact (importance-based)`,
      );
      logger.log(
        `  ${chalk.cyan("/task")}       Set task objective (/task <objective>)`,
      );
      logger.log(`  ${chalk.cyan("/task clear")} Clear current task`);
      logger.log(`  ${chalk.cyan("/session")}    Show current session info`);
      logger.log(
        `  ${chalk.cyan("/reindex")}    Reindex notes for BM25 search`,
      );
      logger.log(
        `  ${chalk.cyan("/stats")}      Show context engine statistics`,
      );
      logger.log(
        `  ${chalk.cyan("/auto")}       Autonomous goal execution (ReAct loop)`,
      );
      logger.log(
        `  ${chalk.cyan("/cowork")}     Multi-agent collaboration (debate, compare)`,
      );
      logger.log(
        `  ${chalk.cyan("/search")}     Search past sessions (/search <query>)`,
      );
      logger.log(
        `  ${chalk.cyan("/profile")}    Show/edit user profile (USER.md)`,
      );
      logger.log(
        `  ${chalk.cyan("/plan")}       Enter plan mode (read-only analysis first)`,
      );
      logger.log(`  ${chalk.cyan("/plan show")}  Show current plan`);
      logger.log(
        `  ${chalk.cyan("/plan approve")} Approve and execute the plan`,
      );
      logger.log(`  ${chalk.cyan("/plan reject")}  Reject the plan`);
      logger.log(
        `  ${chalk.cyan("/sub-agents")}  Show active/completed sub-agents`,
      );
      logger.log(chalk.bold("\nCapabilities:"));
      logger.log("  Read, write, and edit files");
      logger.log("  Run shell commands (git, npm, etc.)");
      logger.log("  Search codebase by filename or content");
      logger.log("  Run 138 built-in skills (code-review, summarize, etc.)");
      logger.log("  Plan mode: analyze first, execute after approval");
      logger.log(
        "  Context engineering: instinct + memory + notes injection\n",
      );
      prompt();
      return;
    }

    if (trimmed === "/sub-agents" || trimmed === "/subagents") {
      try {
        const { SubAgentRegistry } =
          await import("../lib/sub-agent-registry.js");
        const registry = SubAgentRegistry.getInstance();
        const active = registry.getActive();
        const history = registry.getHistory();
        const stats = registry.getStats();

        logger.log(chalk.bold("\nSub-Agent Registry:"));
        logger.log(
          `  Active: ${chalk.yellow(active.length)}  Completed: ${chalk.green(stats.completed)}  Tokens: ${stats.totalTokens}  Avg Duration: ${stats.avgDurationMs}ms`,
        );

        if (active.length > 0) {
          logger.log(chalk.bold("\n  Active Sub-Agents:"));
          for (const a of active) {
            logger.log(
              `    ${chalk.cyan(a.id)} [${a.role}] ${a.task.substring(0, 50)} (iter: ${a.iterationCount})`,
            );
          }
        }

        if (history.length > 0) {
          logger.log(chalk.bold("\n  Recent History (last 10):"));
          for (const h of history.slice(-10)) {
            const status =
              h.status === "completed" ? chalk.green("✓") : chalk.red("✗");
            logger.log(
              `    ${status} ${chalk.dim(h.id)} [${h.role}] ${(h.summary || "").substring(0, 60)}`,
            );
          }
        }

        logger.log("");
      } catch (_err) {
        logger.log(chalk.dim("Sub-agent registry not available."));
      }
      prompt();
      return;
    }

    if (trimmed.startsWith("/model")) {
      const arg = trimmed.slice(6).trim();
      if (arg) {
        model = arg;
        logger.info(`Model: ${chalk.cyan(model)}`);
      } else {
        logger.info(`Current model: ${chalk.cyan(model)}`);
      }
      prompt();
      return;
    }

    if (trimmed.startsWith("/provider")) {
      const arg = trimmed.slice(9).trim();
      if (arg) {
        const supported = [
          "ollama",
          "anthropic",
          "openai",
          "deepseek",
          "dashscope",
          "mistral",
          "gemini",
          "volcengine",
        ];
        if (supported.includes(arg)) {
          provider = arg;
          logger.info(`Provider: ${chalk.cyan(provider)}`);
        } else {
          logger.info(
            `Unsupported provider. Available: ${supported.join(", ")}`,
          );
        }
      } else {
        logger.info(`Current provider: ${chalk.cyan(provider)}`);
        logger.info(
          chalk.gray(
            "Available: ollama, anthropic, openai, deepseek, dashscope, mistral, gemini, volcengine",
          ),
        );
      }
      prompt();
      return;
    }

    if (trimmed === "/clear") {
      messages.length = 1; // Keep system prompt
      logger.info("Conversation cleared");
      prompt();
      return;
    }

    if (trimmed === "/compact") {
      if (_compressor && messages.length > 3) {
        const { messages: compacted, stats } =
          await _compressor.compress(messages);
        messages.length = 0;
        messages.push(...compacted);
        recordCompressionMetric(stats, {
          source: "manual-compact",
          provider,
          model,
        });
        logger.info(
          `Compacted: ${stats.originalMessages} → ${stats.compressedMessages} messages, saved ${stats.saved} tokens (${stats.strategy})`,
        );
      } else if (contextEngine && messages.length > 5) {
        const compacted = contextEngine.smartCompact(messages);
        messages.length = 0;
        messages.push(...compacted);
        logger.info(
          `Compacted to ${messages.length} messages (importance-based)`,
        );
      } else if (messages.length > 5) {
        const systemMsg = messages[0];
        const recent = messages.slice(-4);
        messages.length = 0;
        messages.push(systemMsg, ...recent);
        logger.info("Compacted to last 4 messages");
      }
      prompt();
      return;
    }

    // Task commands
    if (trimmed.startsWith("/task")) {
      const taskArg = trimmed.slice(5).trim();
      if (taskArg === "clear") {
        contextEngine.clearTask();
        logger.info("Task cleared");
      } else if (taskArg) {
        contextEngine.setTask(taskArg);
        logger.info(`Task set: ${chalk.cyan(taskArg)}`);
      } else {
        if (contextEngine.taskContext) {
          logger.info(
            `Current task: ${chalk.cyan(contextEngine.taskContext.objective)}`,
          );
        } else {
          logger.info("No task set. Usage: /task <objective>");
        }
      }
      prompt();
      return;
    }

    // Session info
    if (trimmed.startsWith("/session")) {
      const sessionArg = trimmed.slice(8).trim();
      if (sessionArg.startsWith("resume ")) {
        const resumeId = sessionArg.slice(7).trim();
        try {
          if (useJsonl && sessionExists(resumeId)) {
            const rebuilt = rebuildMessages(resumeId);
            messages.length = 1; // keep system prompt
            messages.push(...rebuilt.filter((m) => m.role !== "system"));
            sessionId = resumeId;
            logger.info(
              `Resumed JSONL session ${sessionId} (${rebuilt.length} messages)`,
            );
          } else if (db) {
            const existing = getSession(db, resumeId);
            if (existing && existing.messages) {
              const parsed =
                typeof existing.messages === "string"
                  ? JSON.parse(existing.messages)
                  : existing.messages;
              messages.length = 1; // keep system prompt
              messages.push(...parsed.filter((m) => m.role !== "system"));
              sessionId = existing.id;
              logger.info(
                `Resumed session ${sessionId} (${parsed.length} messages)`,
              );
            } else {
              logger.info(`Session not found: ${resumeId}`);
            }
          } else {
            logger.info("No session store available");
          }
        } catch (err) {
          logger.error(`Resume failed: ${err.message}`);
        }
      } else {
        logger.info(`Session ID: ${sessionId || "none"}`);
        logger.info(`Messages: ${messages.length}`);
        logger.info(`DB: ${db ? "connected" : "not available"}`);
      }
      prompt();
      return;
    }

    // Reindex notes
    if (trimmed === "/reindex") {
      if (contextEngine) {
        contextEngine.reindexNotes();
        const stats = contextEngine.getStats();
        logger.info(`Notes reindexed: ${stats.notesIndexed} documents`);
      } else {
        logger.info("Context engine not available");
      }
      prompt();
      return;
    }

    // Stats
    if (trimmed === "/stats") {
      if (contextEngine) {
        const stats = contextEngine.getStats();
        logger.info(`DB connected: ${stats.hasDb}`);
        logger.info(`Notes indexed: ${stats.notesIndexed}`);
        logger.info(`Error history: ${stats.errorCount}`);
        logger.info(`Active task: ${stats.hasTask}`);
      } else {
        logger.info("Context engine not available");
      }
      prompt();
      return;
    }

    // Session search
    if (trimmed.startsWith("/search")) {
      const searchQuery = trimmed.slice(7).trim();
      if (!searchQuery) {
        logger.info("Usage: /search <query>");
        prompt();
        return;
      }
      if (!db) {
        logger.info("Database not available for session search");
        prompt();
        return;
      }
      try {
        const { SessionSearchIndex } = await import("../lib/session-search.js");
        const index = new SessionSearchIndex(db);
        index.ensureTables();
        const results = index.search(searchQuery, { limit: 10 });
        if (results.length === 0) {
          logger.info(
            "No results found. Try /search after a few sessions, or run reindex.",
          );
        } else {
          logger.log(chalk.bold(`\nSearch results for "${searchQuery}":\n`));
          for (const r of results) {
            const snippet = (r.snippet || "").substring(0, 120);
            logger.log(
              `  ${chalk.cyan(r.sessionId.substring(0, 20))} [${chalk.dim(r.role)}] ${snippet}`,
            );
          }
          logger.log("");
        }
      } catch (err) {
        logger.error(`Search failed: ${err.message}`);
      }
      prompt();
      return;
    }

    // User profile commands
    if (trimmed.startsWith("/profile")) {
      const profileArg = trimmed.slice(8).trim();
      try {
        const { readUserProfile, updateUserProfile, getUserProfilePath } =
          await import("../lib/user-profile.js");

        if (!profileArg || profileArg === "show") {
          const content = readUserProfile();
          if (content) {
            logger.log(chalk.bold("\nUser Profile (USER.md):\n"));
            logger.log(content);
            logger.log(chalk.dim(`\nPath: ${getUserProfilePath()}`));
            logger.log("");
          } else {
            logger.info(
              `No user profile yet. Use /profile set <content> or let the agent learn your preferences.`,
            );
          }
        } else if (profileArg.startsWith("set ")) {
          const newContent = profileArg.slice(4).trim();
          if (!newContent) {
            logger.info("Usage: /profile set <content>");
          } else {
            const result = updateUserProfile(newContent);
            if (result.written) {
              logger.info(
                `Profile updated (${result.length} chars${result.truncated ? ", truncated" : ""})`,
              );
            } else {
              logger.error("Failed to write profile");
            }
          }
        } else if (profileArg === "clear") {
          updateUserProfile("");
          logger.info("Profile cleared.");
        } else if (profileArg === "path") {
          logger.info(`Profile path: ${getUserProfilePath()}`);
        } else {
          logger.log(chalk.bold("\nProfile Commands:"));
          logger.log(`  ${chalk.cyan("/profile")}          Show user profile`);
          logger.log(
            `  ${chalk.cyan("/profile set <content>")} Update profile`,
          );
          logger.log(`  ${chalk.cyan("/profile clear")}    Clear profile`);
          logger.log(`  ${chalk.cyan("/profile path")}     Show file path`);
          logger.log("");
        }
      } catch (err) {
        logger.error(`Profile command failed: ${err.message}`);
      }
      prompt();
      return;
    }

    // Cowork commands
    if (trimmed.startsWith("/cowork")) {
      const coworkArgs = trimmed.slice(7).trim();
      const [subCmd, ...rest] = coworkArgs.split(/\s+/);
      const coworkInput = rest.join(" ");

      if (!subCmd || subCmd === "help") {
        logger.log(chalk.bold("\nCowork Commands:"));
        logger.log(
          `  ${chalk.cyan("/cowork debate <file>")}      Multi-perspective code review`,
        );
        logger.log(
          `  ${chalk.cyan("/cowork compare <prompt>")}   A/B solution comparison`,
        );
        logger.log(
          `  ${chalk.cyan("/cowork graph <path>")}       Code knowledge graph (ASCII)`,
        );
        logger.log(
          `  ${chalk.cyan("/cowork decision <topic>")}   Architecture decision tracking`,
        );
        logger.log("");
      } else if (subCmd === "debate" && coworkInput) {
        try {
          const { startDebate } =
            await import("../lib/cowork/debate-review-cli.js");
          let code = coworkInput;
          let targetLabel = coworkInput;
          const resolved = path.resolve(coworkInput);
          if (fs.existsSync(resolved)) {
            code = fs.readFileSync(resolved, "utf-8");
            targetLabel = resolved;
            if (code.length > 15000) {
              code = code.substring(0, 15000) + "\n... (truncated)";
            }
          }
          process.stdout.write(chalk.gray("\n  Running debate review...\n"));
          const result = await startDebate({
            target: targetLabel,
            code,
            llmOptions: { provider, model, baseUrl, apiKey },
          });
          for (const review of result.reviews) {
            const vc =
              review.verdict === "APPROVE"
                ? chalk.green
                : review.verdict === "REJECT"
                  ? chalk.red
                  : chalk.yellow;
            process.stdout.write(
              `  ${chalk.bold(review.role)}: ${vc(review.verdict)}\n`,
            );
          }
          process.stdout.write(
            `\n  ${chalk.bold("Verdict:")} ${result.verdict}  Consensus: ${result.consensusScore}%\n\n`,
          );
          // Add summary to conversation for context
          messages.push({
            role: "assistant",
            content: `[Cowork Debate Result] ${result.verdict} (consensus: ${result.consensusScore}%)\n${result.summary.substring(0, 500)}`,
          });
        } catch (err) {
          logger.error(`Debate failed: ${err.message}`);
        }
      } else if (subCmd === "compare" && coworkInput) {
        try {
          const { compare } =
            await import("../lib/cowork/ab-comparator-cli.js");
          process.stdout.write(chalk.gray("\n  Generating variants...\n"));
          const result = await compare({
            prompt: coworkInput,
            llmOptions: { provider, model, baseUrl, apiKey },
          });
          for (const v of result.variants) {
            process.stdout.write(
              `  ${chalk.cyan(v.name)}: score ${v.totalScore}\n`,
            );
          }
          process.stdout.write(
            `\n  ${chalk.bold("Winner:")} ${chalk.green(result.winner)}\n\n`,
          );
          messages.push({
            role: "assistant",
            content: `[Cowork Compare Result] Winner: ${result.winner}. ${result.reason}`,
          });
        } catch (err) {
          logger.error(`Compare failed: ${err.message}`);
        }
      } else if (subCmd === "graph" && coworkInput) {
        try {
          const { analyzeCodeKnowledgeGraph } =
            await import("../lib/cowork/code-knowledge-graph-cli.js");
          process.stdout.write(chalk.gray("\n  Analyzing code graph...\n"));
          const result = await analyzeCodeKnowledgeGraph({
            target: coworkInput,
            llmOptions: { provider, model, baseUrl, apiKey },
          });
          // ASCII dependency graph
          if (result.entities && result.entities.length > 0) {
            process.stdout.write(chalk.bold("  Code Knowledge Graph:\n"));
            for (const entity of result.entities.slice(0, 15)) {
              const deps = (entity.dependencies || []).slice(0, 3).join(", ");
              process.stdout.write(
                `  ${chalk.cyan(entity.name)} [${entity.type}]${deps ? ` → ${deps}` : ""}\n`,
              );
            }
            if (result.relationships && result.relationships.length > 0) {
              process.stdout.write(chalk.bold("\n  Relationships:\n"));
              for (const rel of result.relationships.slice(0, 10)) {
                process.stdout.write(
                  `  ${rel.source} ${chalk.gray(`—${rel.type}→`)} ${rel.target}\n`,
                );
              }
            }
          } else {
            process.stdout.write(
              `  ${JSON.stringify(result).substring(0, 500)}\n`,
            );
          }
          process.stdout.write("\n");
          messages.push({
            role: "assistant",
            content: `[Cowork Graph] Analyzed ${(result.entities || []).length} entities with ${(result.relationships || []).length} relationships.`,
          });
        } catch (err) {
          logger.error(`Graph analysis failed: ${err.message}`);
        }
      } else if (subCmd === "decision" && coworkInput) {
        try {
          const { analyzeDecisions } =
            await import("../lib/cowork/decision-kb-cli.js");
          process.stdout.write(chalk.gray("\n  Analyzing decisions...\n"));
          const result = await analyzeDecisions({
            target: coworkInput,
            llmOptions: { provider, model, baseUrl, apiKey },
          });
          if (result.decisions && result.decisions.length > 0) {
            process.stdout.write(chalk.bold("  Architecture Decisions:\n"));
            for (const d of result.decisions) {
              const statusColor =
                d.status === "accepted"
                  ? chalk.green
                  : d.status === "rejected"
                    ? chalk.red
                    : chalk.yellow;
              process.stdout.write(
                `  ${statusColor(`[${d.status || "proposed"}]`)} ${chalk.cyan(d.title || d.id)}\n`,
              );
              if (d.rationale) {
                process.stdout.write(
                  `    ${chalk.gray(d.rationale.substring(0, 100))}\n`,
                );
              }
            }
          } else {
            process.stdout.write(
              `  ${JSON.stringify(result).substring(0, 500)}\n`,
            );
          }
          process.stdout.write("\n");
          messages.push({
            role: "assistant",
            content: `[Cowork Decision] Found ${(result.decisions || []).length} architecture decisions.`,
          });
        } catch (err) {
          logger.error(`Decision analysis failed: ${err.message}`);
        }
      } else {
        logger.info(
          "Usage: /cowork debate <file> | compare <prompt> | graph <path> | decision <topic>",
        );
      }

      prompt();
      return;
    }

    // Autonomous agent commands
    if (trimmed.startsWith("/auto")) {
      const autoArg = trimmed.slice(5).trim();

      if (!autoArg || autoArg === "help") {
        logger.log(chalk.bold("\nAutonomous Agent Commands:"));
        logger.log(
          `  ${chalk.cyan("/auto <goal>")}      Submit a goal for autonomous execution`,
        );
        logger.log(
          `  ${chalk.cyan("/auto status")}      Show current goal status`,
        );
        logger.log(
          `  ${chalk.cyan("/auto pause")}       Pause the running goal`,
        );
        logger.log(`  ${chalk.cyan("/auto resume")}      Resume a paused goal`);
        logger.log(
          `  ${chalk.cyan("/auto cancel")}      Cancel the running goal`,
        );
        logger.log(`  ${chalk.cyan("/auto list")}        List all goals`);
        logger.log("");
      } else if (autoArg === "status") {
        const goals = autonomousAgent.listGoals();
        const running = goals.find(
          (g) =>
            g.status === GoalStatus.RUNNING || g.status === GoalStatus.PAUSED,
        );
        if (running) {
          const detail = autonomousAgent.getGoalStatus(running.id);
          logger.info(`Goal: ${chalk.cyan(detail.description)}`);
          logger.info(
            `Status: ${detail.status}  Steps: ${detail.steps.length}  Iterations: ${detail.iterations}`,
          );
          for (const step of detail.steps) {
            const icon =
              step.status === "completed"
                ? "✓"
                : step.status === "running"
                  ? "→"
                  : step.status === "failed"
                    ? "✗"
                    : "○";
            logger.log(
              `  ${icon} ${step.description} ${step.error ? chalk.red(`(${step.error})`) : ""}`,
            );
          }
        } else {
          logger.info("No active goal. Use /auto <goal> to submit one.");
        }
      } else if (autoArg === "pause") {
        const goals = autonomousAgent.listGoals();
        const running = goals.find((g) => g.status === GoalStatus.RUNNING);
        if (running) {
          autonomousAgent.pauseGoal(running.id);
          logger.info(`Paused goal: ${running.description}`);
        } else {
          logger.info("No running goal to pause.");
        }
      } else if (autoArg === "resume") {
        const goals = autonomousAgent.listGoals();
        const paused = goals.find((g) => g.status === GoalStatus.PAUSED);
        if (paused) {
          autonomousAgent.resumeGoal(paused.id);
          logger.info(`Resumed goal: ${paused.description}`);
        } else {
          logger.info("No paused goal to resume.");
        }
      } else if (autoArg === "cancel") {
        const goals = autonomousAgent.listGoals();
        const active = goals.find(
          (g) =>
            g.status === GoalStatus.RUNNING || g.status === GoalStatus.PAUSED,
        );
        if (active) {
          autonomousAgent.cancelGoal(active.id);
          logger.info(`Cancelled goal: ${active.description}`);
        } else {
          logger.info("No active goal to cancel.");
        }
      } else if (autoArg === "list") {
        const goals = autonomousAgent.listGoals();
        if (goals.length === 0) {
          logger.info("No goals submitted yet.");
        } else {
          for (const g of goals) {
            logger.log(
              `  [${g.status}] ${g.description} (${g.steps} steps, ${g.iterations} iterations)`,
            );
          }
        }
      } else {
        // Submit new goal
        // Lazy-init autonomous agent with LLM chat function
        if (!autonomousAgent._initialized) {
          const chatFn = createChatFn({ provider, model, baseUrl, apiKey });
          autonomousAgent.initialize({
            llmChat: chatFn,
            toolExecutor: executeTool,
          });
        }

        // Set up event listeners for live output
        const goalListener = (evt) => {
          if (evt.goalId) {
            if (evt.result)
              process.stdout.write(
                chalk.green(`  Goal completed: ${evt.result}\n`),
              );
            if (evt.error)
              process.stdout.write(chalk.red(`  Goal failed: ${evt.error}\n`));
          }
        };
        const stepListener = (evt) => {
          process.stdout.write(chalk.gray(`  [step] ${evt.step}\n`));
        };

        autonomousAgent.on("goal:completed", goalListener);
        autonomousAgent.on("goal:failed", goalListener);
        autonomousAgent.on("step:started", stepListener);
        autonomousAgent.on("step:completed", (evt) => {
          process.stdout.write(chalk.green(`  [done] ${evt.step}\n`));
        });

        logger.info(`Submitting goal: ${chalk.cyan(autoArg)}`);
        try {
          const { goalId } = await autonomousAgent.submitGoal(autoArg);
          logger.info(
            `Goal ${goalId} submitted. Use /auto status to track progress.`,
          );
        } catch (err) {
          logger.error(`Failed to submit goal: ${err.message}`);
        }
      }

      prompt();
      return;
    }

    // Plan mode commands
    if (trimmed.startsWith("/plan")) {
      const planManager = getPlanModeManager();
      const subCmd = trimmed.slice(5).trim();

      if (!subCmd || subCmd === "enter") {
        if (planManager.isActive()) {
          logger.info(
            "Already in plan mode. Use /plan show, /plan approve, or /plan reject.",
          );
        } else {
          planManager.enterPlanMode({ title: "Agent Plan" });
          logger.success(
            "Entered plan mode. Write tools are blocked until you approve the plan.",
          );
          logger.info(
            "The AI can still read files and search. Blocked tools become plan items.",
          );
          logger.info(
            "Use /plan show to see the plan, /plan approve to execute.",
          );
          // Inject plan mode context into system prompt
          messages.push({
            role: "system",
            content:
              "[PLAN MODE ACTIVE] You are now in plan mode. You can read files, search, and analyze — but write/execute tools are blocked. Any blocked tool calls will be recorded as plan items. Analyze the task thoroughly, then the user will approve your plan.",
          });
        }
      } else if (subCmd === "show") {
        if (!planManager.isActive()) {
          logger.info("Not in plan mode. Use /plan to enter.");
        } else {
          logger.log("\n" + planManager.generatePlanSummary() + "\n");
        }
      } else if (subCmd === "approve" || subCmd === "yes") {
        if (!planManager.isActive()) {
          logger.info("No plan to approve.");
        } else if (planManager.currentPlan.items.length === 0) {
          logger.info(
            "Plan has no items yet. Let the AI analyze the task first.",
          );
        } else {
          planManager.approvePlan();
          logger.success(
            `Plan approved! ${planManager.currentPlan.items.length} items ready for execution.`,
          );
          logger.info(
            "Write/execute tools are now unlocked. The AI can proceed.",
          );
          messages.push({
            role: "system",
            content: `[PLAN APPROVED] The user has approved your plan with ${planManager.currentPlan.items.length} items. You can now use all tools including write_file, edit_file, run_shell, and run_skill. Execute the plan items in order.`,
          });
        }
      } else if (subCmd === "reject" || subCmd === "no") {
        if (!planManager.isActive()) {
          logger.info("No plan to reject.");
        } else {
          planManager.rejectPlan("User rejected");
          logger.info("Plan rejected. Exited plan mode.");
        }
      } else if (subCmd === "risk") {
        if (!planManager.isActive() || !planManager.currentPlan) {
          logger.info("No active plan to assess.");
        } else {
          const risk = planManager.getRiskAssessment();
          logger.log(
            `\nRisk Level: ${chalk.bold(risk.level.toUpperCase())} (total: ${risk.totalScore}, max: ${risk.maxScore}, avg: ${risk.averageScore})`,
          );
          for (const item of risk.itemScores) {
            const color =
              item.score >= 6
                ? chalk.red
                : item.score >= 3
                  ? chalk.yellow
                  : chalk.green;
            logger.log(`  ${color(`[${item.score}]`)} ${item.title}`);
          }
          logger.log("");
        }
      } else if (subCmd === "execute") {
        if (!planManager.isActive()) {
          logger.info("No active plan.");
        } else if (planManager.state !== PlanState.APPROVED) {
          logger.info("Plan must be approved first. Use /plan approve.");
        } else {
          logger.info("Executing plan items in DAG order...");
          try {
            const { results, success } = await planManager.executePlan(
              async (item) => {
                if (item.tool && item.params) {
                  process.stdout.write(
                    chalk.gray(`  [${item.tool}] ${item.title}\n`),
                  );
                  return await executeTool(item.tool, item.params);
                }
                return { skipped: true };
              },
            );
            for (const r of results) {
              const icon = r.success ? chalk.green("✓") : chalk.red("✗");
              logger.log(
                `  ${icon} ${r.item.title}${r.error ? ` — ${r.error}` : ""}`,
              );
            }
            logger.info(
              `Plan execution ${success ? "completed" : "finished with errors"}.`,
            );
            planManager.exitPlanMode({ savePlan: true });
          } catch (err) {
            logger.error(`Plan execution failed: ${err.message}`);
          }
        }
      } else if (subCmd === "exit") {
        if (planManager.isActive()) {
          planManager.exitPlanMode({ savePlan: true });
          logger.info("Exited plan mode.");
        } else {
          logger.info("Not in plan mode.");
        }
      } else if (subCmd.startsWith("interactive")) {
        // Interactive planning with LLM-generated plan + skill recommendations
        const planRequest =
          subCmd.slice(11).trim() || "Help me with the current task";
        try {
          const { CLIInteractivePlanner } =
            await import("../lib/interactive-planner.js");
          const { TerminalInteractionAdapter } =
            await import("../lib/interaction-adapter.js");
          const chatFn = createChatFn({ provider, model, baseUrl, apiKey });
          const planner = new CLIInteractivePlanner({
            llmChat: chatFn,
            db,
            interaction: new TerminalInteractionAdapter(),
          });

          logger.info("Generating interactive plan...");
          const result = await planner.startPlanSession(planRequest, {
            cwd: process.cwd(),
          });

          if (result.plan) {
            logger.log(
              chalk.bold(
                `\n  Plan: ${result.plan.overview?.title || "Untitled"}`,
              ),
            );
            logger.log(
              chalk.gray(`  ${result.plan.overview?.description || ""}\n`),
            );
            for (const step of result.plan.steps || []) {
              const toolStr = step.tool ? chalk.cyan(` [${step.tool}]`) : "";
              logger.log(`  ${step.step}. ${step.title}${toolStr}`);
            }
            if (result.plan.recommendations?.skills?.length > 0) {
              logger.log(chalk.bold("\n  Recommended skills:"));
              for (const s of result.plan.recommendations.skills) {
                logger.log(`    - ${chalk.cyan(s.id)}: ${s.description}`);
              }
            }
            logger.log("");
            logger.info(
              "Use /plan interactive:confirm, /plan interactive:cancel, or /plan interactive:regenerate",
            );
          } else {
            logger.info(result.message || "Failed to generate plan");
          }
        } catch (err) {
          logger.error(`Interactive plan failed: ${err.message}`);
        }
      } else {
        logger.info(
          "Unknown /plan subcommand. Try: /plan, /plan show, /plan approve, /plan reject, /plan exit, /plan interactive <request>",
        );
      }

      prompt();
      return;
    }

    // Fire UserPromptSubmit hook with rewrite/abort support.
    // Hooks may emit {"rewrittenPrompt": "..."} or {"abort": true, "reason": "..."}
    // via stdout JSON. Failures fall through to the original prompt.
    const promptDirective = await fireUserPromptSubmit(_hookDb, trimmed, {
      sessionId,
      messageCount: messages.length,
    });
    if (promptDirective.abort) {
      logger.info(
        chalk.yellow(
          `[hook] prompt aborted${promptDirective.reason ? `: ${promptDirective.reason}` : ""}`,
        ),
      );
      prompt();
      return;
    }
    const effectivePrompt = promptDirective.prompt;
    if (effectivePrompt !== trimmed) {
      logger.verbose(`[hook] prompt rewritten by UserPromptSubmit hook`);
    }

    // Add user message
    messages.push({ role: "user", content: effectivePrompt });

    // Slot-filling: detect intent and fill missing parameters interactively
    try {
      const { CLISlotFiller } = await import("../lib/slot-filler.js");
      const intent = CLISlotFiller.detectIntent(trimmed);
      if (intent) {
        const defs = CLISlotFiller.getSlotDefinitions(intent.type);
        const missing = defs.required.filter((s) => !intent.entities[s]);
        if (missing.length > 0) {
          const { TerminalInteractionAdapter } =
            await import("../lib/interaction-adapter.js");
          const interaction = new TerminalInteractionAdapter();
          const filler = new CLISlotFiller({ interaction });
          const result = await filler.fillSlots(intent, {
            cwd: process.cwd(),
          });
          if (result.filledSlots.length > 0) {
            const parts = Object.entries(result.entities)
              .filter(([, v]) => v)
              .map(([k, v]) => `${k}: ${v}`);
            // Append context to the last user message
            const lastMsg = messages[messages.length - 1];
            lastMsg.content += `\n\n[Context — user provided: ${parts.join(", ")}]`;
            logger.info(chalk.gray(`[slot-fill] ${parts.join(", ")}`));
          }
        }
      }
    } catch (_err) {
      // Slot-filling failure is non-critical
    }

    // Auto-select best model based on task type
    let activeModel = model;
    const taskDetection = detectTaskType(trimmed);
    if (taskDetection.confidence > 0.3) {
      const recommended = selectModelForTask(provider, taskDetection.taskType);
      if (recommended && recommended !== activeModel) {
        activeModel = recommended;
        logger.info(
          chalk.gray(`[auto] ${taskDetection.name} → ${activeModel}`),
        );
      }
    }

    try {
      process.stdout.write("\n");
      const iterationBudget = new IterationBudget({ owner: sessionId });
      const response = await agentLoop(messages, {
        provider,
        model: activeModel,
        baseUrl,
        apiKey,
        contextEngine,
        iterationBudget,
        sessionId,
        cwd: process.cwd(),
        prepareCall: defaultPrepareCall,
      });

      // Fire AssistantResponse hook with rewrite/suppress support
      const responseDirective = await fireAssistantResponse(
        _hookDb,
        response || "",
        {
          sessionId,
          messageCount: messages.length,
          provider,
          model: activeModel,
        },
      );

      let effectiveResponse = response;
      if (responseDirective.suppress) {
        process.stdout.write(
          `\n[hook suppress] ${responseDirective.reason || "response suppressed"}\n\n`,
        );
        effectiveResponse = "";
      } else if (responseDirective.response !== (response || "")) {
        effectiveResponse = responseDirective.response;
      }

      if (effectiveResponse) {
        process.stdout.write(`\n${effectiveResponse}\n\n`);
        messages.push({ role: "assistant", content: effectiveResponse });
      } else if (!responseDirective.suppress) {
        process.stdout.write("\n");
      }

      // Auto-save session
      if (sessionId) {
        try {
          if (useJsonl) {
            // Append incremental events (user + assistant)
            appendUserMessage(sessionId, effectivePrompt);
            if (effectiveResponse) {
              appendAssistantMessage(sessionId, effectiveResponse);
            }
          } else if (db) {
            saveMessages(db, sessionId, messages);
          }
        } catch (_e) {
          // Non-critical
        }
      }
      // Auto-compact when context grows too large
      if (
        feature("PROMPT_COMPRESSOR") &&
        _compressor &&
        _compressor.shouldAutoCompact(messages)
      ) {
        try {
          const { messages: compacted, stats } =
            await _compressor.compress(messages);
          messages.length = 0;
          messages.push(...compacted);
          recordCompressionMetric(stats, {
            source: "auto-compact",
            provider,
            model: activeModel,
          });
          if (stats.saved > 0) {
            logger.verbose(
              `Auto-compacted: ${stats.strategy} (saved ${stats.saved} tokens)`,
            );
            // Write compact checkpoint to JSONL for crash recovery
            if (useJsonl && sessionId) {
              appendCompactEvent(sessionId, {
                ...stats,
                messages: compacted,
              });
            }
          }
        } catch (_e) {
          // Non-critical — continue with uncompacted messages
        }
      }

      // Store as episodic memory
      if (db) {
        try {
          storeMemory(db, trimmed, { importance: 0.3, type: "episodic" });
        } catch (_e) {
          // Non-critical
        }
      }
    } catch (err) {
      logger.error(`Error: ${err.message}`);

      // Record error for context injection
      if (contextEngine) {
        contextEngine.recordError({
          step: "agent-loop",
          message: err.message,
        });
      }

      // If connection error, provide helpful message
      if (
        err.message.includes("ECONNREFUSED") ||
        err.message.includes("fetch failed")
      ) {
        logger.info(`Make sure ${provider} is running at ${baseUrl}`);
        if (provider === "ollama") {
          logger.info("Start Ollama: ollama serve");
        }
      }
    }

    prompt();
  });

  rl.on("close", async () => {
    // Save session on exit
    if (sessionId) {
      try {
        if (useJsonl) {
          // JSONL: write final compact snapshot for fast rebuild
          appendCompactEvent(sessionId, {
            strategy: "session-end",
            messages,
          });
        } else if (db) {
          saveMessages(db, sessionId, messages);
        }
      } catch (_e) {
        // Non-critical
      }
    }
    // Auto-summarize session into permanent memory
    if (permanentMemory && messages.length > 4) {
      try {
        permanentMemory.autoSummarize(messages);
      } catch (_e) {
        // Non-critical
      }
    }
    // Consolidate memory
    if (db) {
      try {
        consolidateMemory(db);
      } catch (_e) {
        // Non-critical
      }
    }
    // Fire SessionEnd hook before shutdown (fire-and-forget)
    await fireSessionHook(_hookDb, HookEvents.SessionEnd, {
      sessionId,
      messageCount: messages.length,
    });

    // Shutdown runtime
    try {
      await shutdown();
    } catch (_e) {
      // Non-critical
    }
    process.exit(0);
  });
}
