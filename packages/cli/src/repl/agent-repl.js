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
import os from "os";
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
  appendTokenUsage,
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
import {
  PromptCompressor,
  getContextWindow,
} from "../harness/prompt-compressor.js";
import { feature } from "../lib/feature-flags.js";
import { recordCompressionMetric } from "../lib/compression-telemetry.js";
import {
  fireSessionHook,
  fireUserPromptSubmit,
  fireAssistantResponse,
} from "../lib/session-hooks.js";
import { HookEvents } from "../lib/hook-manager.js";
import { IterationBudget } from "../lib/iteration-budget.js";
import { resolveAgentMcp } from "../runtime/mcp-config.js";
import {
  AGENT_TOOLS,
  buildSystemPrompt,
  executeTool as coreExecuteTool,
  agentLoop as coreAgentLoop,
  formatToolArgs,
  killAllBackgroundShellTasks,
} from "../runtime/agent-core.js";
import { expandFileRefs } from "../runtime/file-ref-expander.js";
import { composeSystemPrompt } from "../runtime/system-prompt.js";
import { makeFallbackChatFn } from "../runtime/fallback-model.js";
import { resolveSlashMacro } from "./slash-macro.js";
import { expandMcpPrompt, renderMcpSurface } from "./mcp-prompt.js";

/**
 * Reference to the runtime DB for hook execution (set during startAgentRepl)
 */
let _hookDb = null;
let _compressor = null;
let _approvalGate = null;
// .claude/settings.json permission rules (deny > ask > allow) + an interactive
// confirmer for `ask` matches. Loaded once at REPL startup; null = no file.
let _permissionRules = null;
let _permissionConfirm = null;
// .claude/settings.json `hooks` block (decision-capable PreToolUse/PostToolUse).
let _settingsHooks = null;

/**
 * Fire settings.json Notification hooks (observe-only) — the agent needs the
 * user's attention (e.g. waiting on a permission/risk confirmation). A hook can
 * ring a bell / send a desktop notification. Best-effort, never blocks.
 */
async function _fireNotification(message) {
  if (!_settingsHooks) return;
  try {
    const { runObserveHooks } = await import("../lib/settings-hook-events.cjs");
    runObserveHooks(
      _settingsHooks,
      "Notification",
      { message, cwd: process.cwd(), session_id: null },
      { cwd: process.cwd() },
    );
  } catch (_err) {
    // observe-only — never affect the prompt
  }
}

/**
 * "Always allow" persistence: derive a sensible allow rule for a tool call,
 * append it to .claude/settings.local.json (personal, gitignored), and reflect
 * it in the in-memory ruleset so the rest of the session stops prompting. A
 * persisted `allow` short-circuits the ApprovalGate via agent-core's
 * `ruleAllowed` path (see permission-rules wiring). Returns {rule,file} or null.
 */
async function _persistAlwaysAllow(tool, args) {
  try {
    const rulesMod = await import("../lib/permission-rules.cjs");
    const { suggestAllowRule } = rulesMod.default || rulesMod;
    const rule = suggestAllowRule(tool || "run_shell", args || {});
    if (!rule) return null;
    const { addRule } = await import("../lib/settings-loader.cjs");
    const { file } = addRule({
      cwd: process.cwd(),
      kind: "allow",
      rule,
      scope: "local",
    });
    if (!_permissionRules) _permissionRules = { allow: [], ask: [], deny: [] };
    if (!_permissionRules.allow.includes(rule))
      _permissionRules.allow.push(rule);
    return { rule, file };
  } catch (err) {
    process.stderr.write(`  always-allow persist failed: ${err.message}\n`);
    return null;
  }
}

/**
 * Execute a tool call — delegates to agent-core with REPL's hookDb and cwd.
 */
async function executeTool(name, args) {
  return coreExecuteTool(name, args, {
    hookDb: _hookDb,
    cwd: process.cwd(),
    approvalGate: _approvalGate,
    permissionRules: _permissionRules,
    permissionConfirm: _permissionConfirm,
    settingsHooks: _settingsHooks,
  });
}

/**
 * Agentic loop — wraps agent-core's async generator with REPL display output.
 */
async function agentLoop(messages, options) {
  const usageEvents = [];
  // The REPL runs its own auto-compaction (after each turn, with metrics +
  // persisted compact events), so opt out of the agent loop's in-loop
  // compaction to avoid compacting the same history twice.
  for await (const event of coreAgentLoop(messages, {
    autoCompact: false,
    ...options,
  })) {
    if (event.type === "checkpoint") {
      process.stdout.write(
        chalk.gray(`  ⎌ checkpoint ${event.id} (before ${event.tool})\n`),
      );
    } else if (event.type === "tool-executing") {
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
        // Parity with Desktop AIChatPage's `Switch to Trusted` button:
        // when the deny came from ApprovalGate (not shell-policy), surface
        // the exact CLI command the user can run to relax the per-session
        // policy. The structured `approval` outcome is attached by
        // `evaluateShellCommandWithApproval` in agent-core.js.
        const approval = event.result?.approval;
        if (approval?.decision === "deny" && approval?.via !== "shell-policy") {
          const sid = options?.sessionId;
          const policy = approval.policy || "strict";
          if (sid && policy === "strict") {
            process.stdout.write(
              chalk.yellow(
                `  Hint: relax policy with  cc session policy ${sid} --set trusted\n`,
              ),
            );
          } else if (sid) {
            process.stdout.write(
              chalk.yellow(
                `  Hint: per-session policy is "${policy}" — see  cc session policy ${sid}\n`,
              ),
            );
          }
        }
      } else if (event.result?.success) {
        process.stdout.write(chalk.green(`  Done\n`));
      }
    } else if (event.type === "token-usage") {
      usageEvents.push(event);
    } else if (event.type === "iteration-warning") {
      process.stdout.write(chalk.yellow(`\n  ${event.message}\n`));
    } else if (event.type === "iteration-budget-exhausted") {
      process.stdout.write(
        chalk.red(`\n  [Budget Exhausted] ${event.budget}\n`),
      );
    } else if (event.type === "response-complete") {
      return { content: event.content, usageEvents };
    }
  }
  return { content: "", usageEvents };
}

/**
 * Start the agentic REPL
 */
export async function startAgentRepl(options = {}) {
  let model = options.model || "qwen2.5:7b";
  let provider = options.provider || "ollama";
  // Extended thinking (Anthropic; opt-in via --think/--ultrathink). Carried from
  // the runtime policy into the agent-loop options below. thinkingBudget
  // (--thinking-budget) is the companion legacy-model budget_tokens override.
  const thinking = options.thinking || null;
  const thinkingBudget = options.thinkingBudget || null;
  const baseUrl = options.baseUrl || "http://localhost:11434";
  const apiKey = options.apiKey || null;
  // Extra workspace roots (--add-dir): advertised in the system prompt and
  // spanned by search_files.
  const additionalDirectories = Array.isArray(options.additionalDirectories)
    ? options.additionalDirectories
    : [];
  // Snapshot the work tree before each mutating tool (git engine) so the user
  // can `cc checkpoint restore` to just before any tool call.
  const autoCheckpoint = options.autoCheckpoint === true;

  // --fallback-model: retry a turn's LLM call once on a backup model when the
  // primary errors out (overload / network). Built once; passed into every
  // agentLoop call via chatFn. Undefined when no fallback configured.
  const _fallbackChatFn = options.fallbackModel
    ? makeFallbackChatFn({
        fallbackModel: options.fallbackModel,
        onFallback: ({ from, to, error }) =>
          logger.info(
            chalk.yellow(
              `[fallback] model "${from}" failed (${error}); retrying with "${to}"`,
            ),
          ),
      })
    : undefined;

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

  // Wire the persistent ApprovalGate singleton (approval-policies.json) with
  // a readline confirm prompt. agent-core's run_shell branch gates
  // MEDIUM/HIGH-risk commands against the session's policy tier
  // (strict / trusted / autopilot).
  try {
    const { getApprovalGate } =
      await import("../lib/session-core-singletons.js");
    _approvalGate = await getApprovalGate();
    if (typeof _approvalGate.setConfirmer === "function") {
      _approvalGate.setConfirmer(async ({ tool, args, riskLevel }) => {
        await _fireNotification(
          `Permission needed: ${riskLevel || "medium"}-risk ${tool || "run_shell"}${args?.command ? " — " + args.command : ""}`,
        );
        const rlConfirm = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const q = (p) => new Promise((res) => rlConfirm.question(p, res));
        const cmd = args?.command ? ` ${args.command}` : "";
        const ans = (
          await q(
            chalk.yellow(
              `\n[ApprovalGate] ${riskLevel || "medium"} risk command:${cmd}\n` +
                `  Proceed? [y]es once / [a]lways allow / [N]o: `,
            ),
          )
        )
          .trim()
          .toLowerCase();
        rlConfirm.close();
        if (ans === "a" || ans === "always") {
          const saved = await _persistAlwaysAllow(tool || "run_shell", args);
          if (saved) {
            process.stdout.write(
              chalk.green(
                `  ✓ always allow: added ${saved.rule} → ${saved.file}\n`,
              ),
            );
          }
          return true;
        }
        return ans === "y" || ans === "yes";
      });
    }
  } catch (_err) {
    _approvalGate = null;
  }

  // Load .claude/settings.json permission rules + wire an interactive confirmer
  // so `ask` rules prompt (rather than fall closed like headless does).
  try {
    const { loadSettings } = await import("../lib/settings-loader.cjs");
    const loaded = loadSettings({ cwd: process.cwd() });
    const total =
      loaded.rules.allow.length +
      loaded.rules.ask.length +
      loaded.rules.deny.length;
    _permissionRules = total > 0 ? loaded.rules : null;
    // Confirmer is shared by permission `ask` rules AND hook `ask` decisions,
    // so define it unconditionally (a `hook:` rule label flows through too).
    _permissionConfirm = async ({ tool, args, rule }) => {
      await _fireNotification(
        `Permission needed: ${tool}${rule ? " (" + rule + ")" : ""}`,
      );
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const q = (p) => new Promise((res) => rl.question(p, res));
      const detail = args?.command
        ? ` ${args.command}`
        : args?.path
          ? ` ${args.path}`
          : "";
      const ans = (
        await q(
          chalk.yellow(
            `\n[Permission] ${rule} asks before ${tool}:${detail}\n  Proceed? (y/N) `,
          ),
        )
      )
        .trim()
        .toLowerCase();
      rl.close();
      return ans === "y" || ans === "yes";
    };
  } catch (_err) {
    _permissionRules = null;
    _permissionConfirm = null;
  }

  // Load .claude/settings.json `hooks` block (decision-capable PreToolUse/
  // PostToolUse). The interactive _permissionConfirm above doubles as the
  // confirmer for a hook `ask` decision.
  try {
    const { loadHooks } = await import("../lib/settings-hooks.cjs");
    const loaded = loadHooks({ cwd: process.cwd() });
    _settingsHooks =
      loaded.hooks && Object.keys(loaded.hooks).length > 0
        ? loaded.hooks
        : null;
  } catch (_err) {
    _settingsHooks = null;
  }

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

  // Phase H — register this session with session-core SessionManager so
  // `cc session lifecycle / park / unpark / end` can see and control it.
  // Resume a previously parked handle if --session points at one; otherwise
  // create a fresh handle keyed by the JSONL sessionId.
  let _sessionMgr = null;
  let _sessionHandle = null;
  try {
    const { getSessionManager } =
      await import("../lib/session-core-singletons.js");
    _sessionMgr = getSessionManager();
    if (sessionId) {
      if (options.sessionId && !_sessionMgr.has(sessionId)) {
        // Try unparking; no-op if nothing parked with that id
        try {
          await _sessionMgr.resume(sessionId);
        } catch (_e) {
          /* non-critical */
        }
      }
      if (!_sessionMgr.has(sessionId)) {
        _sessionHandle = _sessionMgr.create({
          agentId: options.agentId || "cli-agent",
          sessionId,
          metadata: { provider, model },
        });
      } else {
        _sessionHandle = _sessionMgr.get(sessionId);
      }
    }
  } catch (_err) {
    // Non-critical — SessionManager integration must not block startup
  }

  // --system-prompt replaces the built-in prompt; --append-system-prompt
  // extends it (parity with the headless runners). The base is kept so an
  // output-style persona can be swapped in/out at runtime via /output-style.
  const _replBaseSystem = composeSystemPrompt(
    buildSystemPrompt(process.cwd(), { additionalDirectories }),
    {
      systemPrompt: options.systemPrompt,
      appendSystemPrompt: options.appendSystemPrompt,
    },
  );
  let _activeOutputStyle = null; // { name, body }
  const messages = [{ role: "system", content: _replBaseSystem }];
  // Apply --output-style or the settings.json `outputStyle` default at startup.
  try {
    const { resolveOutputStyle } = await import("../lib/output-styles.js");
    const st = resolveOutputStyle(options.outputStyle, process.cwd());
    if (st && st.body) {
      _activeOutputStyle = { name: st.name, body: st.body };
      messages[0].content = `${_replBaseSystem}\n\n${st.body}`;
    } else if (st && st.name && !st.missing) {
      _activeOutputStyle = { name: st.name, body: "" };
    }
  } catch (_err) {
    // best-effort — no output style
  }

  // settings.json SessionStart hooks → inject session context (observe-only).
  if (_settingsHooks) {
    try {
      const { runSessionStartHooks } =
        await import("../lib/settings-hook-events.cjs");
      const ctx = runSessionStartHooks(_settingsHooks, {
        source: "startup",
        cwd: process.cwd(),
      }).additionalContext;
      if (ctx) messages.push({ role: "system", content: ctx });
    } catch (_err) {
      // best-effort
    }
  }

  // Deep Agents Deploy Phase 1 — load agent bundle if --bundle provided.
  // Injects AGENTS.md as system prompt, seeds USER.md into MemoryStore,
  // and applies bundle manifest metadata (model/provider override, agentId).
  let _bundleResolved = null;
  let _bundleMcpClient = null;
  // --mcp-config (interactive parity with headless): ad-hoc MCP servers loaded
  // for this session via the shared mcp-config engine. Holds {mcpClient,
  // extraToolDefinitions, externalToolExecutors, externalToolDescriptors}.
  let _adhocMcp = null;
  if (options.bundlePath) {
    try {
      const { loadBundle } =
        await import("@chainlesschain/session-core/agent-bundle-loader");
      const { resolveBundle } =
        await import("@chainlesschain/session-core/agent-bundle-resolver");
      const { getMemoryStore } =
        await import("../lib/session-core-singletons.js");
      const bundle = loadBundle(options.bundlePath);

      const memoryStore = getMemoryStore();
      _bundleResolved = resolveBundle(bundle, {
        memoryStore,
        seedOptions: {
          userId: options.agentId || null,
        },
      });

      if (_bundleResolved.systemPrompt) {
        messages.push({
          role: "system",
          content: _bundleResolved.systemPrompt,
        });
      }

      if (_bundleResolved.manifest) {
        if (_bundleResolved.manifest.model && !options.model) {
          model = _bundleResolved.manifest.model;
        }
        if (_bundleResolved.manifest.provider && !options.provider) {
          provider = _bundleResolved.manifest.provider;
        }
      }

      // Connect bundle MCP servers (stdio transport, local mode only).
      const mcpServers = _bundleResolved.mcpConfig?.servers;
      if (mcpServers && typeof mcpServers === "object") {
        const serverEntries = Object.entries(mcpServers).filter(
          ([, cfg]) => cfg && cfg.command,
        );
        if (serverEntries.length > 0) {
          try {
            const { MCPClient } = await import("../harness/mcp-client.js");
            _bundleMcpClient = new MCPClient();
            let connected = 0;
            for (const [name, cfg] of serverEntries) {
              try {
                await _bundleMcpClient.connect(name, cfg);
                connected += 1;
              } catch (mcpErr) {
                logger.log(
                  chalk.yellow(
                    `Bundle MCP: "${name}" connect failed — ${mcpErr.message}`,
                  ),
                );
              }
            }
            if (connected === 0) {
              await _bundleMcpClient.disconnectAll().catch(() => undefined);
              _bundleMcpClient = null;
            }
          } catch (mcpInitErr) {
            logger.log(
              chalk.yellow(`Bundle MCP: init failed — ${mcpInitErr.message}`),
            );
            _bundleMcpClient = null;
          }
        }
      }

      const seedInfo = _bundleResolved.seedResult;
      const seedMsg =
        seedInfo && seedInfo.seeded > 0
          ? `, seeded ${seedInfo.seeded} user memories`
          : "";
      const mcpMsg = _bundleMcpClient
        ? `, ${_bundleMcpClient.servers.size} MCP servers`
        : "";
      const warnMsg =
        _bundleResolved.warnings.length > 0
          ? ` (${_bundleResolved.warnings.length} warnings)`
          : "";
      logger.log(
        chalk.gray(
          `Bundle: loaded ${_bundleResolved.manifest?.id || path.basename(options.bundlePath)}${seedMsg}${mcpMsg}${warnMsg}`,
        ),
      );
    } catch (err) {
      logger.log(chalk.red(`Bundle: failed to load — ${err.message}`));
    }
  }

  // MCP for this interactive session: the ad-hoc --mcp-config file PLUS the
  // servers registered with `cc mcp add --auto-connect`, combined into one
  // client so their tools surface to the LLM as mcp__<server>__<tool>. Reuses
  // the shared engine. Best-effort: a bad --mcp-config is reported but never
  // aborts the REPL; --no-mcp skips the registered set.
  {
    try {
      _adhocMcp = await resolveAgentMcp(
        {
          mcpConfigPath: options.mcpConfig || null,
          db: db?.getDatabase?.() || null,
          includeRegistered: options.useRegisteredMcp !== false,
          // IDE bridge: auto-connect a running editor's MCP server when inside
          // an IDE integrated terminal. --ide forces it, --no-ide disables it
          // (parity with headless; auto-detect already works via process.env).
          ide: options.ide,
          cwd: process.cwd(),
        },
        { writeErr: (s) => process.stderr.write(s) },
      );
      if (_adhocMcp) {
        const toolCount = _adhocMcp.extraToolDefinitions.length;
        logger.log(
          chalk.gray(
            `MCP: ${_adhocMcp.connected.length} server(s), ${toolCount} tool(s) ` +
              `(mcp__<server>__<tool>)`,
          ),
        );
      }
    } catch (mcpErr) {
      logger.log(chalk.yellow(`MCP: --mcp-config failed — ${mcpErr.message}`));
      _adhocMcp = null;
    }
  }

  // Apply bundle approval policy to this session (after both gate and sessionId are ready)
  if (_bundleResolved?.approvalPolicy?.default && _approvalGate && sessionId) {
    try {
      _approvalGate.setSessionPolicy(
        sessionId,
        _bundleResolved.approvalPolicy.default,
      );
    } catch (_err) {
      // Non-critical — invalid policy value is silently ignored
    }
  }

  // Phase G #5 — inject top-K memory recall into system prompt for new sessions
  // Skip on resume (existing context already reflects prior work) and when
  // --no-recall-memory is passed.
  if (!options.sessionId && options.recallMemory !== false) {
    try {
      const { buildMemoryInjection } =
        await import("../lib/memory-injection.js");
      const injection = buildMemoryInjection({
        agentId: options.agentId || null,
        query: options.recallQuery || "",
        limit: Number(options.recallLimit) || undefined,
      });
      if (injection) {
        messages.push({ role: injection.role, content: injection.content });
        logger.log(
          chalk.gray(
            `Context: recalled ${injection.count} memory entries into system prompt`,
          ),
        );
      }
    } catch (_err) {
      // Non-critical — memory recall failure must not block REPL startup
    }
  }

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
    // Resume recap (offline, extractive — no LLM): a quick "where were we"
    // so the user doesn't have to scroll the old transcript.
    try {
      const { buildResumeRecap } = await import("../lib/repl-rewind.js");
      const recap = buildResumeRecap(messages);
      if (recap) {
        logger.log(chalk.bold("Recap:"));
        for (const line of recap) logger.log(chalk.gray(`  ${line}`));
      }
    } catch (_err) {
      /* non-critical */
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

  // `@` tab-completion (Claude-Code @-mention parity): filesystem paths +
  // (when the IDE bridge is connected) the editor's open tabs ranked first.
  const { makeAtCompleter } = await import("../lib/repl-completer.js");
  const atCompleter = makeAtCompleter({
    // cwd left unset on purpose: the completer resolves process.cwd() lazily
    // so it follows `/cd` mid-session.
    // Keep in sync with the rl.on("line") handlers + /help below.
    slashCommands: [
      "/auto",
      "/cd",
      "/clear",
      "/compact",
      "/context",
      "/cowork",
      "/exit",
      "/help",
      "/mcp",
      "/model",
      "/output-style",
      "/plan",
      "/profile",
      "/provider",
      "/quit",
      "/reindex",
      "/reload-skills",
      "/rewind",
      "/search",
      "/session",
      "/stats",
      "/statusline",
      "/sub-agents",
      "/task",
    ],
    getIdeOpenFiles: async () => {
      const exec = _adhocMcp?.externalToolExecutors?.mcp__ide__getOpenEditors;
      if (!exec || exec.kind !== "mcp" || !_adhocMcp?.mcpClient?.callTool) {
        return [];
      }
      const { parseToolResultJson } = await import("../lib/ide-context.js");
      const res = await _adhocMcp.mcpClient.callTool(
        exec.serverName,
        exec.toolName,
        {},
      );
      const data = parseToolResultJson(res);
      return Array.isArray(data?.editors)
        ? data.editors.map((e) => e?.file).filter(Boolean)
        : [];
    },
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: getPrompt(),
    terminal: true,
    completer: atCompleter,
  });

  // Esc interrupt (Claude-Code parity): pressing Esc while a turn is in
  // flight aborts the in-flight agentLoop through its existing AbortSignal
  // seam (throwIfAborted at each iteration); partial conversation is kept.
  // Idle Esc presses (no active turn) are ignored, and escape-prefixed key
  // sequences (arrows etc.) never reach here as bare "escape".
  let _turnAbort = null;
  let _lastIdleEscAt = 0;
  if (process.stdin.isTTY) {
    process.stdin.on("keypress", (_str, key) => {
      if (!key || key.name !== "escape" || key.meta) return;
      if (_turnAbort) {
        process.stdout.write(chalk.yellow("\n⎋ interrupting…\n"));
        try {
          _turnAbort.abort();
        } catch {
          /* already aborted */
        }
        _turnAbort = null;
        return;
      }
      // Double-Esc while idle → rewind picker shortcut (Claude-Code parity);
      // the actual rewind is `/rewind <n>` so stdin stays readline-owned.
      const nowTs = Date.now();
      if (nowTs - _lastIdleEscAt < 600) {
        _lastIdleEscAt = 0;
        import("../lib/repl-rewind.js")
          .then(({ listUserTurns, renderTurnList }) => {
            process.stdout.write(
              chalk.bold("\nRewind — pick a user turn (newest first):\n"),
            );
            process.stdout.write(
              `${renderTurnList(listUserTurns(messages))}\n`,
            );
            process.stdout.write(
              chalk.gray(
                "Run /rewind <n> to rewind the conversation (files: cc checkpoint restore).\n",
              ),
            );
            prompt();
          })
          .catch(() => {});
      } else {
        _lastIdleEscAt = nowTs;
      }
    });
  }

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

  // statusLine (Claude-Code parity): a line above the prompt each turn.
  //  - A user-configured `.claude/settings.json` `statusLine` command wins
  //    (model / branch / cost / … — first stdout line; best-effort, sync).
  //  - Otherwise a BUILT-IN context-usage line is shown: model · ⛁ used/window
  //    (pct%) · cwd · turn N — the "上下文用量显示" half. Default-on.
  //  - Suppressed entirely by `statusLine: false`, env CC_STATUSLINE=0, or
  //    `/statusline off`. Token usage is fed in from each turn's usage events.
  let _statusLineEnabled = process.env.CC_STATUSLINE !== "0";
  let _customStatus = false; // true when a settings.json command is configured
  let _curModel = model; // tracks the per-turn active model for the readout
  let _ctxUsedTokens = 0;
  let _turnCount = 0;
  let _renderStatus = null;
  try {
    const slm = await import("../lib/status-line.cjs");
    const _sl = slm.default || slm;
    const _slCfg = _sl.loadStatusLineConfig({ cwd: process.cwd() });
    _customStatus = !!_slCfg;
    const _slDisabled = _sl.isStatusLineDisabled({ cwd: process.cwd() });
    if (_slDisabled) _statusLineEnabled = false;
    _renderStatus = () => {
      if (!_statusLineEnabled) return null;
      try {
        const context = _sl.buildContext({
          sessionId,
          model: _curModel,
          provider,
          cwd: process.cwd(),
          usedTokens: _ctxUsedTokens,
          contextWindow: getContextWindow(_curModel, provider),
          turn: _turnCount,
        });
        // Custom command wins; otherwise the built-in context-usage render.
        if (_slCfg) {
          return _sl.renderStatusLine(_slCfg, context, { cwd: process.cwd() });
        }
        const line = _sl.renderDefaultStatusLine(context);
        return line && line.trim() ? line : null;
      } catch {
        return null; // never let the status line break the REPL
      }
    };
  } catch {
    _renderStatus = null;
  }

  const prompt = () => {
    if (_statusLineEnabled && _renderStatus) {
      const line = _renderStatus();
      // Built-in line is dimmed; a custom command may carry its own ANSI.
      if (line)
        process.stdout.write((_customStatus ? line : chalk.dim(line)) + "\n");
    }
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

  // Steering (Claude-Code parity): typing while a turn is running QUEUES the
  // line instead of racing a second concurrent turn; the queue drains FIFO
  // when the current turn finishes.
  let _processingLine = false;
  const _pendingLines = [];
  const handleLine = async (input) => {
    const trimmed = input.trim();
    if (!trimmed) {
      prompt();
      return;
    }

    // `!` bash passthrough (Claude-Code parity): run the command right here —
    // no LLM round-trip — and fold the output into the conversation context.
    if (trimmed.startsWith("!") && trimmed.slice(1).trim()) {
      try {
        const { runBangCommand } = await import("../lib/repl-bang-memorize.js");
        const res = runBangCommand(trimmed, { cwd: process.cwd() });
        logger.log(chalk.gray(`$ ${res.cmd}`));
        if (res.stdout) process.stdout.write(res.stdout.endsWith("\n") ? res.stdout : `${res.stdout}\n`);
        if (res.stderr) process.stderr.write(chalk.red(res.stderr.endsWith("\n") ? res.stderr : `${res.stderr}\n`));
        if (res.error) logger.error(`shell error: ${res.error.message}`);
        logger.log(chalk.gray(`(exit ${res.exitCode})`));
        messages.push(res.contextMessage);
      } catch (err) {
        logger.error(`! command failed: ${err.message}`);
      }
      prompt();
      return;
    }

    // `#` quick-memorize (Claude-Code parity): append a note to the project
    // cc.md (auto-loaded next session) and keep it active in this one.
    if (trimmed.startsWith("#") && trimmed.slice(1).trim()) {
      try {
        const { appendMemoryNote } = await import("../lib/repl-bang-memorize.js");
        const res = appendMemoryNote(trimmed, { cwd: process.cwd() });
        messages.push({
          role: "system",
          content: `<memory-note source="${res.target}">${res.note}</memory-note>`,
        });
        logger.log(
          chalk.green(`✔ remembered in ${res.target}${res.created ? " (created)" : ""}`),
        );
      } catch (err) {
        logger.error(`# memorize failed: ${err.message}`);
      }
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
      logger.log(
        `  ${chalk.cyan("! <cmd>")}     Run a shell command directly (output joins context)`,
      );
      logger.log(
        `  ${chalk.cyan("# <note>")}    Remember a note in the project cc.md`,
      );
      logger.log(`  ${chalk.cyan("/exit")}       Exit the agent`);
      logger.log(
        `  ${chalk.cyan("/model")}      Show/change model (/model <name>)`,
      );
      logger.log(`  ${chalk.cyan("/provider")}   Show/change provider`);
      logger.log(`  ${chalk.cyan("/clear")}      Clear conversation`);
      logger.log(
        `  ${chalk.cyan("/statusline")} Context-usage line on/off (/statusline [on|off])`,
      );
      logger.log(
        `  ${chalk.cyan("/context")}    Live context-window usage by role`,
      );
      logger.log(
        `  ${chalk.cyan("/rewind")}     Rewind conversation to an earlier turn (double-Esc lists)`,
      );
      logger.log(
        `  ${chalk.cyan("/cd <dir>")}   Change working directory mid-session (completion/memory follow)`,
      );
      logger.log(
        `  ${chalk.cyan("/reload-skills")} Re-scan skill layers without restarting`,
      );
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
      // User-defined command macros (.claude/commands/*.md) become runnable
      // slash commands here — list whatever is discovered so they're visible.
      try {
        const { discoverCommands } = await import("../lib/slash-commands.js");
        const macros = discoverCommands(process.cwd());
        if (macros.length > 0) {
          logger.log(chalk.bold("Custom commands (.claude/commands):"));
          for (const m of macros) {
            const tag =
              m.scope === "project"
                ? chalk.cyan("[proj]")
                : chalk.gray("[pers]");
            logger.log(
              `  ${chalk.cyan("/" + m.name)} ${tag}` +
                (m.argumentHint ? chalk.dim(` ${m.argumentHint}`) : "") +
                (m.description ? `  ${chalk.gray(m.description)}` : ""),
            );
          }
          logger.log("");
        }
      } catch (_err) {
        // Non-critical — macro discovery failure must not break /help
      }
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
        _curModel = model; // keep the status-line readout in sync
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

    if (trimmed === "/statusline" || trimmed.startsWith("/statusline ")) {
      const arg = trimmed.slice("/statusline".length).trim().toLowerCase();
      if (arg === "off") {
        _statusLineEnabled = false;
        logger.info("Status line: off");
      } else if (arg === "on") {
        _statusLineEnabled = true;
        logger.info("Status line: on");
      } else {
        // bare / "show" → report state + a one-off render
        const line =
          _statusLineEnabled && _renderStatus ? _renderStatus() : null;
        if (line) {
          logger.info(`Status line: ${_customStatus ? line : chalk.dim(line)}`);
        } else {
          logger.info(
            `Status line: ${_statusLineEnabled ? "on (no content yet)" : "off"}` +
              (_statusLineEnabled
                ? ""
                : ` — enable with ${chalk.cyan("/statusline on")}`),
          );
        }
        if (_customStatus) {
          logger.info(chalk.gray("  source: settings.json statusLine command"));
        }
      }
      prompt();
      return;
    }

    if (trimmed === "/output-style" || trimmed.startsWith("/output-style ")) {
      const arg = trimmed.slice("/output-style".length).trim();
      try {
        const { discoverOutputStyles, getOutputStyle } =
          await import("../lib/output-styles.js");
        if (!arg) {
          logger.log(chalk.bold("Output styles:"));
          for (const s of discoverOutputStyles(process.cwd())) {
            const cur =
              _activeOutputStyle?.name === s.name ? chalk.green(" *") : "";
            logger.log(
              `  ${s.name.padEnd(16)}${cur}  ${chalk.gray(s.description || "")}`,
            );
          }
          logger.log(
            chalk.gray(`current: ${_activeOutputStyle?.name || "none"}`),
          );
        } else if (arg === "none" || arg === "default") {
          _activeOutputStyle = null;
          messages[0].content = _replBaseSystem;
          logger.info("output style cleared");
        } else {
          const s = getOutputStyle(arg, process.cwd());
          if (!s) {
            logger.error(chalk.red(`no such output style: ${arg}`));
          } else {
            _activeOutputStyle = { name: s.name, body: s.body || "" };
            messages[0].content = s.body
              ? `${_replBaseSystem}\n\n${s.body}`
              : _replBaseSystem;
            logger.info(chalk.green(`output style → ${s.name}`));
          }
        }
      } catch (err) {
        logger.error(chalk.red(`/output-style failed: ${err.message}`));
      }
      prompt();
      return;
    }

    // `/cd` (Claude-Code 2.1.163 parity): relocate the session's working
    // directory mid-conversation. Everything that reads process.cwd() per
    // call follows automatically (agent cwd, @-completion, project memory).
    if (trimmed === "/cd" || trimmed.startsWith("/cd ")) {
      const target = trimmed.slice(3).trim();
      if (!target) {
        logger.info(`cwd: ${process.cwd()}`);
      } else {
        try {
          const expanded = target.replace(/^~(?=$|[\\/])/, os.homedir());
          process.chdir(path.resolve(process.cwd(), expanded));
          logger.log(chalk.green(`cwd → ${process.cwd()}`));
        } catch (err) {
          logger.error(`/cd failed: ${err.message}`);
        }
      }
      prompt();
      return;
    }

    if (trimmed === "/rewind" || trimmed.startsWith("/rewind ")) {
      try {
        const { listUserTurns, rewindToTurn, renderTurnList } = await import(
          "../lib/repl-rewind.js"
        );
        const arg = trimmed.slice("/rewind".length).trim();
        if (!arg) {
          logger.log(
            chalk.bold("\nRewind — pick a user turn (newest first):"),
          );
          logger.log(renderTurnList(listUserTurns(messages)));
          logger.log(
            chalk.gray(
              "Usage: /rewind <n>  (conversation only — restore files with `cc checkpoint restore`)",
            ),
          );
        } else {
          const res = rewindToTurn(messages, arg);
          if (!res) {
            logger.error(`No such turn: ${arg} — run /rewind to list.`);
          } else {
            logger.log(
              chalk.yellow(
                `⎌ rewound — dropped ${res.removed} message(s); edit and resend below`,
              ),
            );
            prompt();
            if (res.text) rl.write(res.text);
            return;
          }
        }
      } catch (err) {
        logger.error(`/rewind failed: ${err.message}`);
      }
      prompt();
      return;
    }

    if (trimmed === "/context") {
      // Live-session twin of `cc context` (Claude-Code /context parity):
      // bucket the CURRENT in-memory conversation by role against the model
      // window. Reuses the same categorizer + estimator as the archived view.
      try {
        const { categorizeContext } = await import("../commands/context.js");
        const { estimateTokens } = await import(
          "../harness/prompt-compressor.js"
        );
        const { buckets, counts, total } = categorizeContext(
          messages,
          estimateTokens,
        );
        const window = getContextWindow(model, provider) || 0;
        logger.log(chalk.bold("\nContext usage (live session):"));
        const rows = [
          ["system", buckets.system, counts.system],
          ["user", buckets.user, counts.user],
          ["assistant", buckets.assistant, counts.assistant],
          ["tool", buckets.tool, counts.tool],
          ["tool_calls", buckets.toolCalls, null],
        ];
        for (const [label, tok, n] of rows) {
          if (!tok) continue;
          const share = total ? Math.round((tok / total) * 100) : 0;
          logger.log(
            `  ${label.padEnd(11)}${String(tok).padStart(9)} tok ${String(share).padStart(3)}%${
              n != null ? chalk.gray(`  (${n} msgs)`) : ""
            }`,
          );
        }
        const pct = window ? Math.round((total / window) * 100) : null;
        logger.log(
          `  ${"total".padEnd(11)}${String(total).padStart(9)} tok${
            window
              ? `  ${pct}% of ${window} (${Math.max(0, window - total)} left)`
              : ""
          }`,
        );
      } catch (err) {
        logger.error(`/context failed: ${err.message}`);
      }
      prompt();
      return;
    }

    if (trimmed === "/compact") {
      if (_compressor && messages.length > 3) {
        const { messages: compacted, stats } = await _compressor.compress(
          messages,
          { preserveToolPairs: true },
        );
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
    // `/reload-skills` (Claude-Code 2.1.152 parity): re-scan the 6 skill
    // layers (incl. .claude/skills) without restarting the session.
    if (trimmed === "/reload-skills") {
      try {
        const { reloadSkills } = await import("../runtime/agent-core.js");
        const n = reloadSkills();
        logger.log(
          chalk.green(`✔ skills reloaded — ${n} available (6 layers re-scanned)`),
        );
      } catch (err) {
        logger.error(`/reload-skills failed: ${err.message}`);
      }
      prompt();
      return;
    }

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

    // `/mcp` — overview of connected MCP servers' resources + prompts.
    if (trimmed === "/mcp" || trimmed === "/mcp ") {
      const mcpClient = _adhocMcp?.mcpClient || _bundleMcpClient;
      logger.log(renderMcpSurface(mcpClient));
      prompt();
      return;
    }

    // User-defined slash-command macros (.claude/commands/*.md), Claude-Code
    // parity. resolveSlashMacro maps a leading /name to a command macro and
    // expands its template; a non-match returns the line unchanged so a literal
    // prompt like "/etc/hosts" still reaches the LLM. Wire is unit-tested.
    let promptText = trimmed;

    // MCP server-provided prompts (Claude-Code parity): `/mcp__<server>__<name>
    // [json-args]` fetches a rendered prompt template from the connected MCP
    // server and uses its text as this turn's input. Falls through unchanged
    // when the line isn't an MCP prompt command.
    if (promptText.startsWith("/mcp__")) {
      try {
        const expanded = await expandMcpPrompt(
          promptText,
          _adhocMcp?.mcpClient || _bundleMcpClient,
        );
        if (expanded != null) {
          promptText = expanded;
          logger.log(chalk.gray(`[mcp] prompt expanded`));
        }
      } catch (err) {
        logger.info(
          chalk.yellow(`[mcp] prompt expansion failed: ${err.message}`),
        );
        prompt();
        return;
      }
    }
    try {
      const macro = await resolveSlashMacro(trimmed, { cwd: process.cwd() });
      if (macro.matched) {
        for (const w of macro.warnings)
          logger.info(chalk.yellow(`[@ref] ${w}`));
        promptText = macro.promptText;
        logger.log(
          chalk.gray(`[/${macro.name}] macro expanded (${macro.scope})`),
        );
      }
    } catch (err) {
      logger.verbose(`[slash-macro] expansion skipped: ${err.message}`);
    }

    // Fire UserPromptSubmit hook with rewrite/abort support.
    // Hooks may emit {"rewrittenPrompt": "..."} or {"abort": true, "reason": "..."}
    // via stdout JSON. Failures fall through to the original prompt.
    const promptDirective = await fireUserPromptSubmit(_hookDb, promptText, {
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
    if (effectivePrompt !== promptText) {
      logger.verbose(`[hook] prompt rewritten by UserPromptSubmit hook`);
    }

    // Expand @path file references into context blocks (Claude-Code parity),
    // so `review @src/x.js` injects the file contents. Typo'd paths are warned
    // about and left as-is.
    let userContent = effectivePrompt;
    try {
      const fileRefs = expandFileRefs(effectivePrompt, { cwd: process.cwd() });
      userContent = fileRefs.prompt;
      for (const w of fileRefs.warnings) {
        logger.info(chalk.yellow(`[@ref] ${w}`));
      }
      if (fileRefs.refs.length > 0) {
        const summary = fileRefs.refs
          .map((r) => `${r.rel}${r.kind === "dir" ? "/" : ""}`)
          .join(", ");
        logger.verbose(`[@ref] injected: ${summary}`);
      }
    } catch (err) {
      logger.verbose(`[@ref] expansion skipped: ${err.message}`);
    }

    // settings.json UserPromptSubmit hooks (decision-capable; the DB hook above
    // is observe-only). block → abort the turn; context → inject before the turn.
    if (_settingsHooks) {
      try {
        const { runUserPromptSubmitHooks } =
          await import("../lib/settings-hook-events.cjs");
        const ups = runUserPromptSubmitHooks(_settingsHooks, {
          prompt: userContent,
          cwd: process.cwd(),
          sessionId,
        });
        if (ups.blocked) {
          logger.info(
            chalk.yellow(
              `[hook] prompt blocked${ups.reason ? ": " + ups.reason : ""}`,
            ),
          );
          prompt();
          return;
        }
        if (ups.additionalContext) {
          userContent += `\n\n[hook context]\n${ups.additionalContext}`;
        }
      } catch (_err) {
        // settings hook dispatch is best-effort
      }
    }

    // IDE live context (Claude-Code parity): re-shared on every prompt while
    // an IDE bridge is connected — the user's selection moves between turns.
    // Ephemeral: persistence stores effectivePrompt, not this snapshot.
    // Best-effort; CC_IDE_CONTEXT=0 disables.
    try {
      const { buildIdePromptContext } = await import("../lib/ide-context.js");
      const ideCtx = await buildIdePromptContext(_adhocMcp);
      if (ideCtx) userContent += `\n\n${ideCtx}`;
    } catch (_err) {
      // optional polish — never fail the turn over it
    }

    // Add user message
    messages.push({ role: "user", content: userContent });

    // Slot-filling: detect intent and fill missing parameters interactively
    try {
      const { CLISlotFiller } = await import("../lib/slot-filler.js");
      const intent = CLISlotFiller.detectIntent(promptText);
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
    const taskDetection = detectTaskType(promptText);
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
      // Bind a cross-session goal (cc goal) into this run, if one resolves.
      // Composes WITH defaultPrepareCall — never replaces it. Best-effort.
      let prepareCall = defaultPrepareCall;
      try {
        const { resolveActiveGoal } = await import("../lib/goal-store.js");
        const boundGoal = resolveActiveGoal({ sessionId });
        if (boundGoal) {
          const { goalPrepareCall, composePrepareCall } =
            await import("../lib/goal-context.js");
          prepareCall = composePrepareCall([
            defaultPrepareCall,
            goalPrepareCall(boundGoal),
          ]);
        }
      } catch (_e) {
        /* goal binding is best-effort — fall back to defaultPrepareCall */
      }
      _turnAbort = new AbortController();
      const { content: response, usageEvents } = await agentLoop(messages, {
        signal: _turnAbort.signal,
        provider,
        model: activeModel,
        thinking,
        thinkingBudget,
        baseUrl,
        apiKey,
        contextEngine,
        iterationBudget,
        sessionId,
        cwd: process.cwd(),
        additionalDirectories,
        autoCheckpoint,
        checkpointSession: sessionId,
        prepareCall,
        approvalGate: _approvalGate,
        permissionRules: _permissionRules,
        permissionConfirm: _permissionConfirm,
        settingsHooks: _settingsHooks,
        // MCP: --mcp-config (ad-hoc) wins; bundle MCP is the fallback. The 3
        // tool channels expose --mcp-config servers' tools to the LLM directly.
        mcpClient: _adhocMcp?.mcpClient || _bundleMcpClient || undefined,
        extraToolDefinitions: _adhocMcp?.extraToolDefinitions,
        externalToolExecutors: _adhocMcp?.externalToolExecutors,
        externalToolDescriptors: _adhocMcp?.externalToolDescriptors,
        chatFn: _fallbackChatFn,
      });
      _turnAbort = null;

      if (sessionId && usageEvents?.length) {
        for (const ue of usageEvents) {
          try {
            appendTokenUsage(sessionId, {
              provider: ue.provider,
              model: ue.model,
              usage: ue.usage,
            });
          } catch (_e) {
            /* best-effort */
          }
        }
      }

      // Feed the status line: the last usage event's input+output ≈ the tokens
      // now resident in the context window (what the next call resends). Track
      // the active model too, so the built-in readout reflects auto-switches.
      _curModel = activeModel;
      _turnCount += 1;
      if (usageEvents?.length) {
        const last = usageEvents[usageEvents.length - 1]?.usage || {};
        const used = (last.input_tokens || 0) + (last.output_tokens || 0);
        if (used > 0) _ctxUsedTokens = used;
      }

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
        // Phase G #2 — route through StreamRouter so REPL / WS / future
        // streaming providers share one StreamEvent protocol.
        const { streamAgentResponse } = await import("../lib/agent-stream.js");
        process.stdout.write("\n");
        const noStream = options.noStream === true;
        const streamResult = await streamAgentResponse(effectiveResponse, {
          noStream,
          writer: noStream ? null : (chunk) => process.stdout.write(chunk),
        });
        if (noStream) process.stdout.write(streamResult.text);
        process.stdout.write("\n\n");
        messages.push({ role: "assistant", content: streamResult.text });
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
          const { messages: compacted, stats } = await _compressor.compress(
            messages,
            { preserveToolPairs: true },
          );
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
          storeMemory(db, promptText, { importance: 0.3, type: "episodic" });
        } catch (_e) {
          // Non-critical
        }
      }
    } catch (err) {
      _turnAbort = null;
      // Esc interrupt: an aborted turn is normal flow, not an error — the
      // partial conversation stays usable and queued lines still drain.
      if (err?.name === "AbortError" || /abort/i.test(err?.message || "")) {
        logger.log(
          chalk.yellow("⎋ turn interrupted — partial progress kept"),
        );
        prompt();
        return;
      }
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
  };

  rl.on("line", async (input) => {
    if (_processingLine) {
      if (input.trim()) {
        _pendingLines.push(input);
        logger.log(
          chalk.gray(
            `⏸ queued (${_pendingLines.length}) — runs after the current turn`,
          ),
        );
      }
      return;
    }
    _processingLine = true;
    try {
      await handleLine(input);
      while (_pendingLines.length) {
        const next = _pendingLines.shift();
        logger.log(chalk.cyan(`▶ running queued input: ${next}`));
        await handleLine(next);
      }
    } finally {
      _processingLine = false;
    }
  });

  rl.on("close", async () => {
    // settings.json SessionEnd hooks (observe-only) when the REPL exits.
    if (_settingsHooks) {
      try {
        const { runObserveHooks } =
          await import("../lib/settings-hook-events.cjs");
        runObserveHooks(
          _settingsHooks,
          "SessionEnd",
          { reason: "exit", cwd: process.cwd(), session_id: sessionId },
          { cwd: process.cwd() },
        );
      } catch (_err) {
        // observe-only
      }
    }
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

    // Phase H — park the SessionManager handle on clean exit so the session
    // can be resumed later via `cc session unpark <id>`. `--no-park-on-exit`
    // opts out; a SIGINT path (process-level) will force close instead.
    if (_sessionMgr && sessionId) {
      try {
        if (options.parkOnExit === false) {
          await _sessionMgr.close(sessionId);
        } else {
          _sessionMgr.markIdle(sessionId);
          await _sessionMgr.park(sessionId);
          logger.log(
            chalk.gray(
              `Session ${sessionId.slice(0, 12)} parked — resume with: cc session unpark ${sessionId}`,
            ),
          );
        }
      } catch (_e) {
        // Non-critical — parking failure must not block shutdown
      }
    }

    // Disconnect bundle MCP servers
    if (_bundleMcpClient) {
      try {
        await _bundleMcpClient.disconnectAll();
      } catch (_e) {
        // Non-critical
      }
    }

    // Disconnect ad-hoc (--mcp-config) MCP servers
    if (_adhocMcp?.mcpClient) {
      try {
        await _adhocMcp.mcpClient.disconnectAll();
      } catch (_e) {
        // Non-critical
      }
    }

    // Kill any background run_shell tasks so a backgrounded command (e.g. a
    // dev server) doesn't outlive the REPL session.
    try {
      killAllBackgroundShellTasks();
    } catch (_e) {
      // Non-critical
    }

    // Shutdown runtime
    try {
      await shutdown();
    } catch (_e) {
      // Non-critical
    }
    process.exit(0);
  });
}
