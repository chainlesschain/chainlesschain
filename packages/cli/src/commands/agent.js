/**
 * Agentic AI assistant - Claude Code style
 * chainlesschain agent [--model] [--provider]
 *
 * User describes what they want in natural language.
 * AI reads files, writes code, runs commands, and explains what it's doing.
 */

import path from "node:path";
import fs from "node:fs";
import { createAgentRuntimeFactory } from "../runtime/runtime-factory.js";
import { resolvePromptText } from "../runtime/system-prompt.js";
import {
  makeFallbackChatFn,
  normalizeFallbackModels,
} from "../runtime/fallback-model.js";
import { resolveImages, resolveVisionLlm } from "../lib/image-input.js";
import { loadConfig } from "../lib/config-manager.js";
import {
  normalizeAgentSandbox,
  assertSandboxAvailable,
} from "../lib/agent-sandbox.js";

/**
 * Resolve + validate `--add-dir` values into absolute, existing, de-duped
 * directories. Invalid entries are skipped with a stderr warning rather than
 * aborting the run. Relative paths resolve against the process cwd.
 *
 * @param {string[]} [rawDirs]
 * @returns {string[]} absolute directory paths
 */
export function resolveAddDirs(rawDirs) {
  const out = [];
  for (const d of rawDirs || []) {
    const abs = path.resolve(process.cwd(), d);
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
        if (!out.includes(abs)) out.push(abs);
      } else {
        process.stderr.write(`--add-dir: skipping non-directory "${d}"\n`);
      }
    } catch {
      process.stderr.write(`--add-dir: skipping unreadable "${d}"\n`);
    }
  }
  return out;
}

/**
 * Parse `--thinking-budget <n>` into a positive integer (Anthropic legacy-model
 * thinking `budget_tokens`), or undefined when unset/invalid. Pure; exported for
 * tests. The companion `thinking` toggle comes from --think/--ultrathink; a
 * budget without that toggle is a no-op (chatWithTools only reads it when
 * thinking is on, and only for legacy models 鈥?adaptive models use effort).
 *
 * @param {string|number} [raw]
 * @returns {number|undefined}
 */
export function resolveThinkingBudget(raw) {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

/**
 * Resolve the ordered fallback-model chain for a run. The `--fallback-model`
 * flag (repeatable / comma-separated → array) takes precedence; otherwise the
 * configured `llm.fallbackModels` (array or comma string) or legacy
 * `llm.fallbackModel` (single) seeds the chain so unattended runs need no flag.
 * Pure; exported for tests. Normalization (trim / dedupe / cap-at-3) is applied.
 *
 * @param {string[]|string|undefined} flagValue  raw --fallback-model value
 * @param {object} [llm]                          config.llm block
 * @returns {string[]}
 */
export function resolveFallbackModels(flagValue, llm = {}) {
  const fromFlag = normalizeFallbackModels(flagValue);
  if (fromFlag.length) return fromFlag;
  const configured =
    llm && llm.fallbackModels != null ? llm.fallbackModels : llm?.fallbackModel;
  return normalizeFallbackModels(configured);
}

/**
 * Read all of stdin as a UTF-8 string. Resolves "" immediately when stdin is a
 * TTY (nothing piped) so we never block an interactive invocation.
 */
function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

export function registerAgentCommand(program) {
  program
    .command("agent")
    .alias("a")
    .description(
      "Start an agentic AI session (reads/writes files, runs commands)",
    )
    .argument(
      "[task...]",
      "Headless task 鈥?when given (or with -p / piped stdin), runs non-interactively",
    )
    .option("--model <model>", "Model name")
    .option(
      "--provider <provider>",
      "LLM provider (ollama, openai, volcengine, deepseek, ...)",
    )
    .option("--base-url <url>", "API base URL")
    .option("--api-key <key>", "API key")
    .option(
      "--think [level]",
      "Enable Anthropic extended thinking (level: think | hard | ultra; Anthropic models only)",
    )
    .option(
      "--ultrathink",
      "Maximum Anthropic extended thinking (= --think ultra)",
    )
    .option(
      "--thinking-budget <n>",
      "Thinking token budget for legacy Claude models (Sonnet 4.5 / Opus 4.0-4.5 / older); clamped below max_tokens. Adaptive-thinking models ignore it (they use --think's effort). Requires --think/--ultrathink.",
    )
    .option(
      "--image <path>",
      "Attach an image (png/jpg/jpeg/gif/webp) to the prompt for a vision-capable model (headless; repeatable)",
      (val, prev) => (prev || []).concat([val]),
    )
    .option(
      "--vision-model <id>",
      "Model to use when an image is attached (default: config llm.visionModel or doubao-seed-2-0-lite-260215)",
    )
    .option("--session <id>", "Resume a previous agent session")
    .option(
      "-c, --continue",
      "Resume the most recent session (no id needed 鈥?claude --continue parity)",
    )
    .option(
      "--resume [id]",
      "Resume a session by id (no id 鈫?most recent 鈥?claude --resume parity)",
    )
    .option(
      "--fork-session",
      "When resuming, branch into a NEW session id and leave the original untouched (claude --fork-session parity)",
    )
    .option(
      "--add-dir <dir>",
      "Extra working directory the agent may read/search/edit (repeatable)",
      (val, prev) => (prev || []).concat([val]),
    )
    .option(
      "--checkpoint",
      "Auto-snapshot the work tree before each mutating tool (DEFAULT inside a git repo; cc checkpoint restore to roll back)",
    )
    .option(
      "--no-checkpoint",
      "Disable auto-checkpointing (it is on by default inside git repos)",
    )
    .option(
      "--safe-mode",
      "Run bare: disable project memory, settings hooks, memory recall, IDE context, status line and update notice (permission rules STAY active)",
    )
    .option(
      "--bare",
      "Everything --safe-mode disables PLUS skills, plugins and MCP/IDE auto-connect — minimal fast surface for scripted calls (explicit --mcp-config still loads; permission rules STAY active)",
    )
    .option(
      "--ephemeral",
      "No session persistence: nothing is written to the session store (headless; a --resume id still replays history read-only)",
    )
    .option(
      "--capabilities",
      "Print a machine-readable capability manifest (JSON: protocol version, tools, permission modes, exit codes) and exit",
    )
    .option(
      "--disable-slash-commands",
      "Interactive REPL: don't dispatch '/' input as slash commands — it reaches the model verbatim (/exit and /quit stay live)",
    )
    .option(
      "--ax-screen-reader",
      "Screen-reader friendly output: no ANSI colors, no in-place status line repaints (also CC_SCREEN_READER=1)",
    )
    .option(
      "--worktree",
      "Run this session in a fresh git worktree (isolated branch; auto-removed when the session changes nothing)",
    )
    .option(
      "--sandbox [image]",
      "Run shell commands in an ephemeral Docker sandbox (network disabled by default)",
    )
    .option("--sandbox-network", "Allow network access inside --sandbox")
    .option(
      "--otlp <file>",
      "Write the agent run's OpenTelemetry spans (model/tool/retry) as OTLP/JSON to <file>",
    )
    .option(
      "--otlp-content",
      "Include prompt/response CONTENT in --otlp spans (off by default; content is redacted unless this is set)",
    )
    .option(
      "--auto-rewake",
      "When an async `asyncRewake` hook (e.g. a background test) fails at turn end, re-engage the agent to fix it (bounded by --max-rewakes)",
    )
    .option(
      "--auto-pin",
      "Force-pin the original task (first user turn) through compaction (ON by default; disable with CC_AUTO_PIN=0 or config context.autoPin=false)",
    )
    .option(
      "--max-rewakes <n>",
      "Max auto-rewake re-drives per run (default 1); implies --auto-rewake",
      (v) => parseInt(v, 10),
    )
    .option(
      "--bg, --background",
      "Start as a detached background agent and return its id immediately",
    )
    .option("--agent-id <id>", "Agent id for scoped memory recall")
    .option("--recall-limit <n>", "Top-K memories to inject into system prompt")
    .option("--recall-query <q>", "Query string for startup memory recall")
    .option("--no-recall-memory", "Disable startup memory recall")
    .option(
      "--vim",
      "Start the interactive REPL in vim-mode line editing (toggle later with /vim; or CC_VIM=1)",
    )
    .option("--no-stream", "Disable streamed response rendering")
    .option(
      "--no-park-on-exit",
      "Close the session-core handle on exit instead of parking it",
    )
    .option(
      "--bundle <path>",
      "Agent bundle directory (chainless-agent.toml + AGENTS.md + skills/ + mcp.json + USER.md)",
    )
    // 鈹€鈹€ Headless / print mode (Claude-Code `claude -p` parity) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    .option(
      "-p, --print [prompt]",
      "Headless: run one non-interactive turn and exit",
    )
    .option(
      "--output-format <fmt>",
      "Headless output: text | json | stream-json",
      "text",
    )
    .option("--max-turns <n>", "Cap agent loop iterations (headless)")
    .option(
      "--json-schema <file>",
      "Headless structured output: final reply must be JSON validating against this schema (invalid replies retried)",
    )
    .option(
      "--allowed-tools <list>",
      "Comma/space-separated tool allow-list (headless)",
    )
    .option(
      "--disallowed-tools <list>",
      "Comma/space-separated tool deny-list (headless)",
    )
    .option(
      "--permission-mode <mode>",
      "manual | auto | dontAsk | default | plan | acceptEdits | bypassPermissions (plan headless-only)",
    )
    .option(
      "--no-file-refs",
      "Disable @path file-reference expansion in the prompt (headless)",
    )
    .option(
      "--no-slash-macros",
      "Disable /name custom-command (.claude/commands) expansion in the prompt (headless)",
    )
    .option(
      "--system-prompt <text>",
      "Replace the built-in system prompt (literal text or @file)",
    )
    .option(
      "--append-system-prompt <text>",
      "Append extra guidance to the system prompt (literal text or @file)",
    )
    .option(
      "--no-project-memory",
      "Skip auto-loaded project memory (cc.md / CLAUDE.md / AGENTS.md hierarchy, .chainlesschain/rules.md, .claude/rules/*.md) — a lean system prompt for token-tight surfaces (e.g. IDE chat). The agent can still read those files with tools when it needs them.",
    )
    .option(
      "--output-style <name>",
      "Apply a named output-style persona (.claude/output-styles/<name>.md or a built-in: explanatory | learning)",
    )
    .option(
      "--input-format <fmt>",
      "Headless input: text | stream-json (NDJSON user events on stdin, multi-turn)",
      "text",
    )
    .option(
      "--trace-id <id>",
      "Correlation id stamped as `trace_id` on every stream-json output line (also read from CC_TRACE_ID). Lets an IDE/bridge trace one run across its own logs, the CLI, transcripts and diagnostics. Auto-generated per run when omitted.",
    )
    .option(
      "--fallback-model <model>",
      "Backup model(s) to try in order when the primary fails (transient error or model-not-found). Repeatable or comma-separated; up to 3. A `provider:model` entry (e.g. openai:gpt-4o) falls back cross-provider, using that provider's API key from its env var (skipped if unset — never reuses the primary key). Defaults to config llm.fallbackModels.",
      (val, prev) => (prev || []).concat([val]),
    )
    .option(
      "--include-partial-messages",
      "Emit live assistant-text deltas as stream_event lines (requires --output-format stream-json)",
    )
    .option(
      "--goal [id]",
      "Bind a cc goal into the run (id, or omit the value to auto-resolve the active goal)",
    )
    .option(
      "--goal-assess",
      "After the run, ask the model to assess goal progress and persist it (opt-in; costs one extra completion; requires --goal)",
    )
    .option(
      "--goal-condition <spec>",
      "Session completion condition; re-drives outer turns until met. Prefix exit-zero:/file-exists:/contains:/regex: (deterministic) or model:<desc> (model-judged)",
    )
    .option(
      "--max-outer-turns <n>",
      "Max outer re-drive turns for --goal-condition (default 10, hard cap 100)",
      (v) => parseInt(v, 10),
    )
    .option(
      "--goal-max-tokens <n>",
      "Token budget across --goal-condition outer turns",
      (v) => parseInt(v, 10),
    )
    .option(
      "--goal-max-cost <usd>",
      "Cost budget (USD) across --goal-condition outer turns",
      (v) => parseFloat(v),
    )
    .option(
      "--goal-max-time <ms>",
      "Wall-clock budget (ms) across --goal-condition outer turns",
      (v) => parseInt(v, 10),
    )
    .option(
      "--mcp-config <file>",
      "Load ad-hoc MCP servers from a JSON file for this run (headless); their tools become callable (mcp__<server>__<tool>)",
    )
    .option(
      "--no-mcp",
      "Don't auto-connect MCP servers registered with `cc mcp add --auto-connect` (--mcp-config still loads)",
    )
    .option(
      "--ide",
      "Force-enable IDE bridge auto-connect: discover a running editor's MCP server via ~/.chainlesschain/ide/*.json (default: auto inside an IDE integrated terminal)",
    )
    .option("--no-ide", "Disable IDE bridge auto-connect")
    .option(
      "--pdh",
      "Force-enable PDH bridge auto-connect: discover the Android app's device-capability MCP server via ~/.chainlesschain/pdh-bridge/*.json (default: auto when CHAINLESSCHAIN_PDH_PORT is set)",
    )
    .option("--no-pdh", "Disable PDH bridge auto-connect")
    .option(
      "--jetbrains",
      "Force-enable IntelliJ IDEA built-in MCP (IDEA >= 2025.2) as server `idea` (default: auto when the ChainlessChain JetBrains plugin injects CHAINLESSCHAIN_JETBRAINS_MCP_URL)",
    )
    .option("--no-jetbrains", "Disable IDEA built-in MCP auto-connect")
    .option(
      "--interactive-approvals",
      "Stream mode: confirm-tier approvals become approval_request/approval stdin-stdout events instead of failing closed (chat-panel UX)",
    )
    .option(
      "--permission-prompt-tool <tool>",
      "Defer tool approvals to an MCP tool (mcp__<server>__<tool>; requires --mcp-config) instead of headless fail-closed",
    )
    .option(
      "--remote-control",
      "Route confirm-tier approvals to paired mobile/web devices — prints a pairing URI/QR. Headless waits for the remote allow/deny (fail-closed on timeout); interactive races the terminal prompt (first answer wins; also /remote-control)",
    )
    .option(
      "--channels <list>",
      "Inbound channels for the interactive session (webhook[:port],telegram) — external events enter as user turns; webhook needs its bearer token, telegram needs channels.telegram.allowFrom",
    )
    .option(
      "--settings <file>",
      "Merge an extra .claude/settings.json-shaped file for this run: permission rules (allow/ask/deny) + native config overrides (model, env)",
    )
    .option(
      "--max-budget-usd <amount>",
      "Hard USD spend cap: stop the run before the next paid LLM call once the estimated cost reaches this (headless; uses the cc cost price table)",
    )
    .option(
      "--strict-mcp-config",
      "Use ONLY --mcp-config servers; ignore registered (cc mcp add) and IDE-bridge MCP for a reproducible tool surface",
    )
    .option(
      "--project-mcp",
      "Opt in to loading a project-scoped .mcp.json (default off; a checked-in .mcp.json can spawn commands)",
    )
    .option(
      "--replay-user-messages",
      "Stream-input mode: echo each accepted stdin user message back as a `user` event (transcript/correlation)",
    )
    .option(
      "--allow-dangerous-bypass",
      "Bypass all permission prompts in headless mode (DANGEROUS: auto-approves all tool calls)",
      false,
    )
    .option("-y, --yolo", "Alias for --allow-dangerous-bypass", false)
    .option(
      "--dangerously-skip-permissions",
      "Alias for --allow-dangerous-bypass",
      false,
    )
    .action(async (task, options, command) => {
      // --capabilities: print the machine-readable manifest and exit — no
      // config, no bootstrap, no network (gap-analysis 2026-07-11 快速收益 #6).
      if (options.capabilities) {
        const { buildAgentCapabilities } =
          await import("../lib/headless-manifest.js");
        console.log(JSON.stringify(buildAgentCapabilities(), null, 2));
        return;
      }
      // CC_API_KEY env fallback for --api-key: lets callers (IDE plugins,
      // scripts) pass the key via the environment instead of argv, where it
      // is visible to every local process (/proc/<pid>/cmdline, Win32_Process).
      // An explicit --api-key still wins.
      if (!options.apiKey && process.env.CC_API_KEY) {
        options.apiKey = process.env.CC_API_KEY;
      } else if (
        options.apiKey &&
        process.argv.includes("--api-key") &&
        !process.env.VITEST &&
        !process.env.VITEST_WORKER_ID
      ) {
        // gap-analysis 2026-07-11: argv keys leak into shell history, process
        // lists and logs — steer callers to the env/helper paths.
        process.stderr.write(
          "⚠️  --api-key on the command line is visible to every local process (shell history, ps). Prefer CC_API_KEY env or config llm.apiKeyHelper.\n",
        );
      }
      const bypassPermissions = !!(
        options.allowDangerousBypass ||
        options.yolo ||
        options.dangerouslySkipPermissions
      );
      if (bypassPermissions) {
        process.env.CC_BYPASS_PERMISSIONS = "1";
        process.stderr.write(
          "⚠️  DANGER MODE: All permissions bypassed, no prompts will be shown.\n",
        );
      }
      // --safe-mode flag OR CC_SAFE_MODE / CLAUDE_CODE_SAFE_MODE env (Claude-Code
      // 2.1.169 parity): flip every customization kill-switch BEFORE anything
      // loads. Permission rules stay active. --bare (CC_BARE) is safe mode
      // PLUS skills, plugins and MCP/IDE/PDH/JetBrains auto-connect off.
      {
        const {
          applySafeMode,
          safeModeRequested,
          applyBareMode,
          bareModeRequested,
        } = await import("../lib/safe-mode.js");
        if (bareModeRequested(options)) {
          const applied = applyBareMode();
          // Ambient auto-connects off; an EXPLICIT --ide/--pdh/--jetbrains
          // (or --mcp-config, handled downstream) still wins — bare kills
          // defaults, not explicit input.
          options.mcp = false;
          if (options.ide === undefined) options.ide = false;
          if (options.pdh === undefined) options.pdh = false;
          if (options.jetbrains === undefined) options.jetbrains = false;
          process.stderr.write(
            `bare mode: hooks/skills/plugins/memory/MCP-auto-connect disabled (${applied.join(", ")}) — permission rules stay active.\n`,
          );
        } else if (safeModeRequested(options)) {
          const applied = applySafeMode();
          process.stderr.write(
            `safe mode: customizations disabled (${applied.join(", ")}) — permission rules stay active.\n`,
          );
        }
      }
      // --ax-screen-reader flag OR CC_SCREEN_READER env: linear output for
      // screen readers (mono theme + no repainting status line). Applied
      // before anything renders.
      {
        const { screenReaderRequested, applyScreenReaderMode } =
          await import("../lib/accessibility.js");
        if (screenReaderRequested(options)) {
          applyScreenReaderMode();
        }
      }
      // --project-mcp: opt IN to project-scoped `.mcp.json` discovery, which is
      // off by default (a checked-in .mcp.json can spawn commands). loadProjectMcp
      // reads CC_PROJECT_MCP; set it here so the opt-in reaches every run mode
      // (headless / stream / REPL) without threading the flag through each
      // resolveAgentMcp call site.
      if (options.projectMcp === true) {
        process.env.CC_PROJECT_MCP = "1";
      }
      // --worktree (Claude-Code 2.1.171 parity): run THIS session in a fresh
      // git worktree — edits land on an isolated branch, the main working
      // tree (and parallel sessions) stay untouched. chdir BEFORE everything
      // else so project memory / checkpoint / completion all follow.
      let _worktree = null;
      let _worktreeFinished = false;
      let _worktreeTransferred = false;
      let _finishAgentWorktreeFn = null;
      // Settings hooks loaded once at worktree setup, reused by both the
      // WorktreeCreate producer and the WorktreeRemove producer in
      // _finishWorktree(). Null unless --worktree is active + hooks loaded.
      let _worktreeSettingsHooks = null;
      let _worktreeAsyncSupervisor = null;
      if (options.worktree) {
        try {
          const { setupAgentWorktree, finishAgentWorktree } =
            await import("../lib/agent-worktree.js");
          _finishAgentWorktreeFn = finishAgentWorktree;
          _worktree = setupAgentWorktree({ cwd: process.cwd() });
          process.chdir(_worktree.path);
          process.stderr.write(
            `worktree: ${_worktree.path} (branch ${_worktree.branch})\n`,
          );
          // WorktreeCreate lifecycle hook (observe-only, best-effort): a fresh
          // isolated worktree just appeared — let automation react (register it
          // with a tracker, seed per-branch tooling). Loaded from the REPO ROOT
          // (its committed/user-level .claude hooks apply). No-op & byte-unchanged
          // without a registered WorktreeCreate hook; never blocks the session.
          try {
            const { loadHooks } = await import("../lib/settings-hooks.cjs");
            _worktreeSettingsHooks =
              loadHooks({ cwd: _worktree.repoRoot }).hooks || null;
            const { runWorktreeCreateHooks, dispatchAsyncHooks } =
              await import("../lib/settings-hook-events.cjs");
            runWorktreeCreateHooks(_worktreeSettingsHooks, {
              worktreePath: _worktree.path,
              branch: _worktree.branch,
              baseSha: _worktree.baseSha,
              cwd: _worktree.path,
            });
            if (!_worktreeAsyncSupervisor) {
              const { AsyncHookSupervisor } =
                await import("../lib/async-hook-supervisor.cjs");
              _worktreeAsyncSupervisor = new AsyncHookSupervisor({
                persistStats: true,
              });
            }
            dispatchAsyncHooks(
              _worktreeSettingsHooks,
              "WorktreeCreate",
              {
                worktree_path: _worktree.path,
                branch: _worktree.branch,
                base_sha: _worktree.baseSha,
              },
              { cwd: _worktree.path, supervisor: _worktreeAsyncSupervisor },
            );
          } catch {
            /* worktree lifecycle hooks are best-effort — never block */
          }
          // The worktree is created BEFORE flag validation, and several
          // `process.exit(1)` guards below (plus any future ones) would skip the
          // normal cleanup and orphan an empty worktree + branch on disk. A sync
          // exit handler guarantees the auto-removable worktree is cleaned up on
          // EVERY exit path (finishAgentWorktree is synchronous). Deduped with
          // the normal async _finishWorktree() via _worktreeFinished.
          process.on("exit", () => {
            if (!_worktree || _worktreeFinished || _worktreeTransferred) {
              return;
            }
            _worktreeFinished = true;
            try {
              process.chdir(_worktree.repoRoot);
              _finishAgentWorktreeFn(_worktree);
            } catch {
              /* never block exit */
            }
          });
        } catch (err) {
          process.stderr.write(`--worktree failed: ${err.message}\n`);
          process.exit(1);
        }
      }
      const _finishWorktree = async () => {
        if (!_worktree || _worktreeFinished || _worktreeTransferred) {
          return;
        }
        _worktreeFinished = true;
        try {
          process.chdir(_worktree.repoRoot); // release the dir before removal
          const fin = _finishAgentWorktreeFn(_worktree);
          process.stderr.write(
            fin.removed
              ? `worktree removed (${fin.reason}).\n`
              : `worktree kept (${fin.reason}): ${_worktree.path}\n${fin.mergeHint ? `  merge: ${fin.mergeHint}\n` : ""}`,
          );
          // WorktreeRemove lifecycle hook (observe-only, best-effort): teardown
          // just resolved — fire with `removed` distinguishing an auto-removed
          // empty worktree from one kept for its changes. Reuses the hooks loaded
          // at setup; no-op & byte-unchanged without a registered hook.
          if (_worktreeSettingsHooks) {
            try {
              const { runWorktreeRemoveHooks, dispatchAsyncHooks } =
                await import("../lib/settings-hook-events.cjs");
              runWorktreeRemoveHooks(_worktreeSettingsHooks, {
                worktreePath: _worktree.path,
                branch: _worktree.branch,
                removed: fin.removed === true,
                reason: fin.reason,
                cwd: _worktree.repoRoot,
              });
              dispatchAsyncHooks(
                _worktreeSettingsHooks,
                "WorktreeRemove",
                {
                  worktree_path: _worktree.path,
                  branch: _worktree.branch,
                  removed: fin.removed === true,
                  reason: fin.reason,
                },
                {
                  cwd: _worktree.repoRoot,
                  supervisor: _worktreeAsyncSupervisor,
                },
              );
            } catch {
              /* WorktreeRemove firing is best-effort */
            }
          }
        } catch {
          /* keep silently — never block exit */
        }
      };
      // Claude-Code parity: auto-checkpoint defaults ON inside a git repo
      // (shadow-commit engine, zero working-tree touch); explicit
      // --checkpoint / --no-checkpoint always wins.
      const { resolveAutoCheckpoint } =
        await import("../lib/auto-checkpoint-default.js");
      const autoCheckpoint = resolveAutoCheckpoint({
        flagValue: options.checkpoint,
        flagSource: command?.getOptionValueSource?.("checkpoint"),
        cwd: process.cwd(),
      });
      // `--continue` / `--resume` resolve a session id so the user need not
      // copy it. Explicit `--session <id>` always wins. `--resume <id>` targets
      // a specific session; `--continue` or a bare `--resume` pick the most
      // recent. All three funnel into `options.session`, which both the headless
      // runner and the interactive runtime use to replay prior history.
      if (typeof options.resume === "string" && !options.session) {
        options.session = options.resume;
      }
      if ((options.continue || options.resume === true) && !options.session) {
        const { bootstrap } = await import("../runtime/bootstrap.js");
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        // Headless intent also means "no interactive picker is possible": -p,
        // a positional task, an explicit --output-format, or a non-TTY stdin.
        const headlessIntent =
          options.print !== undefined ||
          (Array.isArray(task) && task.length > 0) ||
          options.outputFormat !== "text" ||
          !process.stdin.isTTY;
        if (headlessIntent) {
          // Headless replays the JSONL store only, so resolve "most recent"
          // from there 鈥?a DB-only id would resume into an empty transcript.
          const { getLastSessionId } =
            await import("../harness/jsonl-session-store.js");
          options.session = getLastSessionId();
        } else {
          // Interactive: picker across both stores (agent REPL rebuilds either).
          const { pickRecentSession } =
            await import("../lib/session-picker.js");
          const picked = await pickRecentSession(ctx, {
            message: "Resume which agent session?",
          });
          options.session = picked.id;
        }
        if (!options.session) {
          process.stderr.write(
            "No previous session to continue. Start one with `cc agent`.\n",
          );
          process.exit(1);
        }
      }

      // --fork-session: branch the resolved session into a NEW id so the
      // ORIGINAL transcript is preserved (Claude-Code parity). One chokepoint
      // before headless / stream / interactive dispatch 鈥?all read
      // `options.session`. The copy carries the full history, so the branch
      // replays end-to-end on a later --resume. Only meaningful when resuming;
      // a no-op (silent) for a fresh run.
      if (options.forkSession && options.session) {
        const store = await import("../harness/jsonl-session-store.js");
        const { applyForkSession } =
          await import("../runtime/headless-runner.js");
        const fork = applyForkSession(
          { forkSession: true, sessionId: options.session },
          store,
        );
        if (fork.missing) {
          process.stderr.write(
            `--fork-session: no headless transcript for "${options.session}" 鈥?` +
              "nothing to fork; continuing on it.\n",
          );
        } else if (fork.forkedFrom) {
          process.stderr.write(
            `Forked session ${fork.forkedFrom} 鈫?${fork.sessionId} (original preserved)\n`,
          );
          options.session = fork.sessionId;
        }
      }

      // --include-partial-messages only makes sense for NDJSON output: the
      // stream-input mode is always NDJSON, otherwise require stream-json
      // explicitly (fail fast rather than silently dropping the deltas).
      if (
        options.includePartialMessages &&
        options.inputFormat !== "stream-json" &&
        options.outputFormat !== "stream-json"
      ) {
        process.stderr.write(
          "--include-partial-messages requires --output-format stream-json.\n",
        );
        process.exit(1);
      }

      // --permission-prompt-tool names an MCP tool, so it only works when MCP
      // servers are loaded for the run.
      if (options.permissionPromptTool && !options.mcpConfig) {
        process.stderr.write(
          "--permission-prompt-tool requires --mcp-config (the tool must come from a loaded MCP server).\n",
        );
        process.exit(1);
      }

      // The explicit `--model` the user typed, captured BEFORE the --settings
      // block below may default options.model 鈥?so vision input can tell an
      // explicit model from a settings default.
      const explicitCliModel = options.model;

      // --settings native config overrides: a .claude/settings.json-shaped file
      // (and the discovered .claude settings) may set `model` + `env` for this
      // run, without editing .chainlesschain/config.json. `--model` still wins
      // over a settings model. Applied once here so every branch (headless +
      // interactive, which all read options.model) picks it up; env vars are
      // set on the process so the agent loop + child tools inherit them.
      let settingsSandbox = null;
      try {
        const { loadSettingsConfig } =
          await import("../lib/settings-loader.cjs");
        const sc = loadSettingsConfig({
          cwd: process.cwd(),
          settingsFile: options.settings || null,
        });
        for (const [k, v] of Object.entries(sc.env || {})) {
          process.env[k] = v;
        }
        if (!options.model && sc.model) options.model = sc.model;
        settingsSandbox = sc.sandbox || null;
      } catch {
        // settings overrides are best-effort 鈥?never block the run
      }

      // Extra workspace roots (--add-dir) 鈥?shared by headless + interactive.
      const additionalDirectories = resolveAddDirs(options.addDir);

      // --image <path> (repeatable): read into {mediaType, base64} for the
      // headless prompt's vision input. A bad extension fails loudly here
      // rather than sending a broken request.
      let images = [];
      if (Array.isArray(options.image) && options.image.length) {
        try {
          images = resolveImages(options.image);
        } catch (err) {
          process.stderr.write(`Error: ${err.message}\n`);
          process.exit(1);
        }
      }

      // When an image is attached, default the run to the configured vision LLM
      // (config.llm provider/baseUrl/apiKey + llm.visionModel | --vision-model |
      // doubao default) so `cc agent --image foo.png` works without extra flags.
      // Explicit --provider/--model/etc. always win; no image 鈫?unchanged.
      const visionLlm = resolveVisionLlm({
        hasImage: images.length > 0,
        flags: {
          provider: options.provider,
          model: explicitCliModel,
          baseUrl: options.baseUrl,
          apiKey: options.apiKey,
          visionModel: options.visionModel,
        },
        llm: loadConfig().llm || {},
      });

      // Config-default LLM (parity with cc ask/chat): a bare `cc agent` honors
      // config.json `llm` (provider/model/baseUrl/apiKey) instead of silently
      // assuming local ollama 鈥?this is what makes the editor chat panel work
      // against a cloud-configured setup. Explicit --provider wins outright;
      // the vision resolution above still overrides for --image runs. Applied
      // AFTER resolveVisionLlm so config defaults don't masquerade as explicit
      // flags there, and BEFORE every dispatch (headless/stream/REPL) since
      // they all read options.provider/model/baseUrl/apiKey.
      {
        const { applyConfigLlmDefaults, reconcileConfigLlmProvider } =
          await import("../lib/llm-config-defaults.js");

        // Self-repair a MISLABELED config (provider disagrees with the provider
        // its baseUrl actually belongs to — the recurring "anthropic + volces
        // baseUrl + haiku" corruption whose writer was never found). The baseUrl
        // is authoritative, so correct provider/model to match it AND persist:
        // without this the on-disk config stays wrong and runnable-provider
        // relabels on EVERY run, re-emitting "provider 配置与 baseUrl 不一致".
        // Persisting also fixes what `cc config` and the editor plugin read next.
        const fullConfig = loadConfig();
        const { llm: repairedLlm, changed: cfgRepaired } =
          await reconcileConfigLlmProvider(fullConfig.llm || {});
        if (cfgRepaired) {
          try {
            const { saveConfig } = await import("../lib/config-manager.js");
            saveConfig({ ...fullConfig, llm: repairedLlm });
            if (!process.env.VITEST && !process.env.VITEST_WORKER_ID) {
              process.stderr.write(
                `\x1b[33m[config] 已修正 llm.provider → "${repairedLlm.provider}"` +
                  `（原配置 provider 与 baseUrl 不一致；baseUrl 为准）。\x1b[0m\n`,
              );
            }
          } catch {
            /* best-effort: a config repair must never fail the run */
          }
        }

        applyConfigLlmDefaults(options, repairedLlm, {
          explicitModel: explicitCliModel, // settings-file model must not ride
        });

        // Also reconcile the RESOLVED options: the editor panel may have already
        // spawned us with an explicit `--provider anthropic` (read from the
        // pre-repair config), which applyConfigLlmDefaults leaves intact. Correct
        // it here so it agrees with the baseUrl before the call runs — this is
        // exactly what runnable-provider would do, just earlier and without the
        // every-turn "已按 baseUrl 切换" notice (we already surfaced the repair).
        const { llm: fixedOpts, changed: optsFixed } =
          await reconcileConfigLlmProvider(options);
        if (optsFixed) {
          options.provider = fixedOpts.provider;
          if (fixedOpts.model) options.model = fixedOpts.model;
        }
      }

      // Claude-Code 2.1.183 parity: warn up front if the now-resolved model is
      // a provider-retired snapshot, before the run fails with an opaque "model
      // not found". (The "auto-updated to a newer model" half is handled by the
      // fallback-model onFallback notice below.) Suppressed under vitest so it
      // never pollutes spawned-bin test stderr.
      if (!process.env.VITEST && !process.env.VITEST_WORKER_ID) {
        try {
          const { maybeWarnDeprecatedModel } =
            await import("../lib/model-deprecation.js");
          maybeWarnDeprecatedModel({ model: options.model });
        } catch {
          /* fail-open: a deprecation notice must never affect the run */
        }
      }

      // --think / --ultrathink 鈫?options.thinking for the agent loop (Anthropic
      // extended thinking; ignored by other providers). --think with no value 鈫?      // true; --think <level> 鈫?that level; --ultrathink wins as "ultra".
      const thinking = options.ultrathink
        ? "ultra"
        : options.think === true
          ? true
          : options.think || undefined;
      // --thinking-budget <n>: legacy-model thinking budget (no-op without
      // --think/--ultrathink and on adaptive models). undefined 鈫?engine default.
      const thinkingBudget = resolveThinkingBudget(options.thinkingBudget);

      // --fallback-model: an ordered chain of backup models tried in turn when
      // the primary errors out (transient overload / rate-limit / network) or
      // the primary model id is not found. The flag (repeatable / comma-list)
      // wins; otherwise config llm.fallbackModels (or llm.fallbackModel) seeds
      // the chain so unattended runs need no flag. Passed into the headless
      // runners via options.chatFn (the agent loop's seam), so no runner
      // changes are needed. Notice goes to stderr to keep stdout clean.
      const fallbackModels = resolveFallbackModels(
        options.fallbackModel,
        loadConfig().llm || {},
      );
      const fallbackChatFn = fallbackModels.length
        ? makeFallbackChatFn({
            fallbackModels,
            onFallback: ({
              from,
              to,
              error,
              skipped,
              reason,
              crossProvider,
            }) =>
              skipped
                ? process.stderr.write(
                    `Note: fallback "${to}" skipped (${reason}).\n`,
                  )
                : process.stderr.write(
                    `Note: model "${from}" failed (${error}); retrying with ` +
                      `${crossProvider ? "cross-provider " : ""}fallback "${to}".\n`,
                  ),
          })
        : undefined;

      // --max-budget-usd: parse the cap + build the price table (config llm.pricing
      // overrides merged onto the built-in cc cost table) once, so both the
      // single-prompt and stream-input dispatch paths enforce the same cap.
      let maxCostUsd = null;
      let priceTable;
      try {
        const { parseBudgetUsd } = await import("../lib/cost-budget.js");
        maxCostUsd = parseBudgetUsd(options.maxBudgetUsd);
      } catch (err) {
        process.stderr.write(`${err.message}\n`);
        await _finishWorktree();
        process.exit(1);
      }
      if (maxCostUsd) {
        const { mergePricing } = await import("../lib/llm-pricing.js");
        priceTable = mergePricing(loadConfig().llm?.pricing);
      }

      // 鈹€鈹€ Streaming-input mode (--input-format stream-json) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
      // A persistent multi-turn conversation driven by NDJSON user events on
      // stdin; output is always NDJSON. Routed before single-prompt handling
      // so stdin is consumed as events, not as one prompt.
      if (options.inputFormat === "stream-json") {
        const { runAgentHeadlessStream } =
          await import("../runtime/headless-stream.js");
        const { parseToolList } = await import("../runtime/headless-runner.js");
        const cwd = process.cwd();
        let outcome;
        try {
          outcome = await runAgentHeadlessStream({
            model: options.model,
            thinking,
            thinkingBudget,
            provider: options.provider,
            baseUrl: options.baseUrl,
            apiKey: options.apiKey,
            sessionId: options.session,
            // Cross-event correlation id for this run (stamped as `trace_id` on
            // every output line); falls back to CC_TRACE_ID / auto-generated.
            traceId: options.traceId || null,
            // Auto-checkpoint follows the same resolution as the headless/REPL
            // paths (default ON in a git repo) so panel/stream sessions snapshot
            // before mutating tools and can be rewound via `cc checkpoint`.
            autoCheckpoint,
            permissionMode: options.permissionMode,
            allowedTools: parseToolList(options.allowedTools),
            disallowedTools: parseToolList(options.disallowedTools),
            additionalDirectories,
            maxTurns: options.maxTurns
              ? parseInt(options.maxTurns, 10)
              : undefined,
            expandFileRefs: options.fileRefs !== false,
            slashMacros: options.slashMacros !== false,
            systemPrompt: resolvePromptText(options.systemPrompt, { cwd }),
            appendSystemPrompt: resolvePromptText(options.appendSystemPrompt, {
              cwd,
            }),
            // --no-project-memory → options.projectMemory === false. Undefined
            // (flag absent) leaves the default-on path byte-identical.
            projectMemory: options.projectMemory,
            includePartialMessages: options.includePartialMessages === true,
            goal: options.goal,
            mcpConfig: options.mcpConfig || null,
            useRegisteredMcp: options.mcp !== false,
            ide: options.ide,
            pdh: options.pdh,
            jetbrains: options.jetbrains,
            cwd,
            permissionPromptTool: options.permissionPromptTool || null,
            remoteControl: options.remoteControl === true,
            interactiveApprovals: options.interactiveApprovals === true,
            settingsFile: options.settings || null,
            outputStyle: options.outputStyle || null,
            strictMcpConfig: options.strictMcpConfig === true,
            replayUserMessages: options.replayUserMessages === true,
            ephemeral: options.ephemeral === true,
            maxCostUsd,
            priceTable,
            chatFn: fallbackChatFn,
            // --json-schema: structured output for stream-INPUT mode. The schema
            // is resolved + meta-validated up front, its output contract injected
            // into the system prompt, and a per-turn `structured_result` event is
            // appended after each turn (parity with single-prompt --json-schema).
            jsonSchema: options.jsonSchema || null,
          });
        } catch (err) {
          process.stderr.write(`Error: ${err.message}\n`);
          await _finishWorktree();
          process.exit(1);
        }
        await _finishWorktree();
        process.exit(outcome.exitCode);
        return;
      }
      if (options.inputFormat && options.inputFormat !== "text") {
        process.stderr.write(
          `Invalid --input-format "${options.inputFormat}". Expected: text | stream-json.\n`,
        );
        process.exit(1);
      }

      // Resolve the headless prompt from: --print value, positional task, or
      // piped stdin (in that precedence). Any of them 鈫?headless mode.
      const positional =
        Array.isArray(task) && task.length > 0 ? task.join(" ") : "";
      let prompt = "";
      if (typeof options.print === "string" && options.print.trim()) {
        prompt = options.print.trim();
      } else if (positional) {
        prompt = positional;
      }
      // -p with no inline value, or an explicit --output-format, signals
      // headless intent; pull the prompt from piped stdin when one is present.
      const wantsHeadless =
        options.print !== undefined ||
        Boolean(positional) ||
        options.outputFormat !== "text";
      if (!prompt && (wantsHeadless || !process.stdin.isTTY)) {
        const piped = (await readStdin()).trim();
        if (piped) prompt = piped;
      }

      if (options.bg && !prompt) {
        process.stderr.write(
          "--bg requires a task via positional text, -p, or piped stdin.\n",
        );
        process.exitCode = 1;
        return;
      }

      if (prompt) {
        if (options.bg) {
          const { launchBackgroundAgent, buildFollowUpArgv } =
            await import("../lib/background-agent-supervisor.js");
          const childArgv = process.argv.slice(2).filter(
            (arg) =>
              arg !== "--bg" &&
              arg !== "--background" &&
              // The parent already created the isolated checkout. Keeping
              // this flag would make the worker child create a nested second
              // worktree and later clean up the wrong owner.
              arg !== "--worktree",
          );
          const hasSessionArg = childArgv.some(
            (arg) =>
              arg === "--session" ||
              arg === "--resume" ||
              arg === "--continue" ||
              arg === "-c",
          );
          const sessionId =
            options.session ||
            `session-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
          if (!hasSessionArg) childArgv.push("--session", sessionId);
          // Follow-up template for interactive attach: same flags/session,
          // minus the first turn's prompt tokens (built BEFORE any piped
          // prompt is appended below). The worker appends -p <text> per turn.
          const followUpArgv = buildFollowUpArgv(childArgv, {
            positionalTokens: Array.isArray(task) ? task : [],
            printValue:
              typeof options.print === "string" ? options.print : null,
          });
          const promptWasPiped =
            positional.length === 0 &&
            !(typeof options.print === "string" && options.print.trim());
          if (promptWasPiped) childArgv.push(prompt);
          const state = launchBackgroundAgent({
            argv: childArgv,
            cwd: process.cwd(),
            sessionId,
            title: prompt.slice(0, 100),
            followUpArgv,
            worktree: _worktree,
          });
          if (_worktree) {
            // Ownership moves to the persisted background session only after
            // the detached worker launched successfully. The parent exit hook
            // must no longer reap this path; attach/resume keep using it.
            _worktreeTransferred = true;
            _worktreeFinished = true;
            process.chdir(_worktree.repoRoot);
          }
          if (options.outputFormat === "json") {
            console.log(JSON.stringify(state));
          } else {
            console.log(`Background agent started: ${state.id}`);
            if (state.worktreePath) {
              console.log(
                `  worktree: ${state.worktreePath} (branch ${state.branch})`,
              );
            }
            console.log(`  logs: cc agents logs ${state.id}`);
            console.log(`  stop: cc agents stop ${state.id}`);
          }
          return;
        }
        const agentSandbox = normalizeAgentSandbox(options.sandbox, {
          cwd: process.cwd(),
          network: options.sandboxNetwork === true,
          settings: settingsSandbox,
        });
        // Strict sandbox mode: failIfUnavailable refuses to START when the
        // configured engine can't run — no silent per-command degradation.
        try {
          assertSandboxAvailable(agentSandbox);
        } catch (err) {
          process.stderr.write(`Error: ${err.message}\n`);
          await _finishWorktree();
          process.exit(6); // config error (see lib/exit-codes.cjs)
        }
        // Resume requested onto a session with no headless (JSONL) transcript?
        // Warn instead of silently starting empty 鈥?headless resume rebuilds
        // from the JSONL store only (DB-only sessions are not replayable here).
        const resumeRequested =
          Boolean(options.continue) || options.resume !== undefined;
        if (resumeRequested && options.session) {
          const { sessionExists } =
            await import("../harness/jsonl-session-store.js");
          if (!sessionExists(options.session)) {
            process.stderr.write(
              `Note: no headless transcript for session "${options.session}" 鈥?` +
                "starting fresh (headless resume reads JSONL sessions only).\n",
            );
          }
        }
        const { runAgentHeadless, parseToolList } =
          await import("../runtime/headless-runner.js");
        // --goal-condition: validate the spec up front so a bad prefix fails
        // fast (before any model call) with a clear message.
        if (options.goalCondition) {
          try {
            const { parseGoalCondition } =
              await import("../lib/goal-condition-engine.js");
            parseGoalCondition(options.goalCondition);
          } catch (e) {
            process.stderr.write(`--goal-condition: ${e.message}\n`);
            await _finishWorktree();
            process.exit(1);
          }
        }
        const maxTurns = options.maxTurns
          ? parseInt(options.maxTurns, 10)
          : undefined;
        const headlessOptions = {
          prompt,
          images,
          model: visionLlm.model || options.model,
          thinking,
          thinkingBudget,
          provider: visionLlm.provider || options.provider,
          baseUrl: visionLlm.baseUrl || options.baseUrl,
          apiKey: visionLlm.apiKey || options.apiKey,
          sessionId: options.session,
          // A resolved --session/--continue/--resume id means "replay this
          // conversation and persist the new turns"; the runner loads prior
          // history when the id already exists and creates it otherwise.
          resume: options.session,
          outputFormat: options.outputFormat,
          permissionMode: options.permissionMode,
          allowedTools: parseToolList(options.allowedTools),
          disallowedTools: parseToolList(options.disallowedTools),
          additionalDirectories,
          sandbox: agentSandbox,
          autoCheckpoint,
          // --worktree: stamp the isolation worktree (branch name) onto each
          // turn's explicit turn-binding record (advisory; null without it).
          worktreeId: _worktree ? _worktree.branch : null,
          // --otlp <file>: capture + export the run's OTel spans as OTLP/JSON.
          otlp: options.otlp || null,
          // --otlp-content: opt in to emitting prompt/response CONTENT in those
          // spans. Default false → content stays redacted (privacy by default).
          otlpContent: options.otlpContent === true,
          // --auto-rewake / --max-rewakes: bounded re-drive on async-hook failure.
          // --max-rewakes implies --auto-rewake (a positive budget turns it on).
          autoRewake:
            options.autoRewake === true ||
            (Number.isFinite(options.maxRewakes) && options.maxRewakes > 0),
          maxRewakes: Number.isFinite(options.maxRewakes)
            ? options.maxRewakes
            : undefined,
          maxTurns,
          // commander maps --no-file-refs 鈫?options.fileRefs === false
          expandFileRefs: options.fileRefs !== false,
          slashMacros: options.slashMacros !== false,
          // --system-prompt / --append-system-prompt (literal or @file)
          systemPrompt: resolvePromptText(options.systemPrompt, {
            cwd: process.cwd(),
          }),
          appendSystemPrompt: resolvePromptText(options.appendSystemPrompt, {
            cwd: process.cwd(),
          }),
          // --no-project-memory → options.projectMemory === false (default-on
          // path is untouched when the flag is absent, i.e. undefined).
          projectMemory: options.projectMemory,
          // --include-partial-messages: live token deltas as stream_event lines
          includePartialMessages: options.includePartialMessages === true,
          // --goal [id]: bind a cc goal into the run (Phase 1)
          goal: options.goal,
          // --goal-assess: run-end LLM progress assessment (Phase 2)
          goalAssess: options.goalAssess === true,
          // --goal-condition: session-level completion-condition engine — drives
          // outer turns until the condition is met or a budget is exhausted.
          goalCondition: options.goalCondition || null,
          maxOuterTurns: Number.isFinite(options.maxOuterTurns)
            ? options.maxOuterTurns
            : undefined,
          goalMaxTokens: Number.isFinite(options.goalMaxTokens)
            ? options.goalMaxTokens
            : undefined,
          goalMaxCostUsd: Number.isFinite(options.goalMaxCost)
            ? options.goalMaxCost
            : undefined,
          goalMaxTimeMs: Number.isFinite(options.goalMaxTime)
            ? options.goalMaxTime
            : undefined,
          // --mcp-config: connect ad-hoc MCP servers + expose their tools
          mcpConfig: options.mcpConfig || null,
          // --no-mcp: skip registered (cc mcp add) auto-connect servers
          useRegisteredMcp: options.mcp !== false,
          // --ide / --no-ide: auto-connect a running editor's MCP bridge
          ide: options.ide,
          // --pdh / --no-pdh: auto-connect the Android app's PDH bridge
          pdh: options.pdh,
          // --jetbrains / --no-jetbrains: IDEA built-in MCP (server `idea`)
          jetbrains: options.jetbrains,
          cwd: process.cwd(),
          // --permission-prompt-tool: defer approvals to an MCP tool
          permissionPromptTool: options.permissionPromptTool || null,
          // --remote-control: approvals from paired mobile/web devices
          remoteControl: options.remoteControl === true,
          // --strict-mcp-config: only --mcp-config servers (ignore registered + IDE)
          strictMcpConfig: options.strictMcpConfig === true,
          // --settings: extra .claude/settings.json permission rules
          settingsFile: options.settings || null,
          outputStyle: options.outputStyle || null,
          // --ephemeral: no session persistence (resume replay stays read-only)
          ephemeral: options.ephemeral === true,
          // --max-budget-usd: hard spend cap (+ price table from config llm.pricing)
          maxCostUsd,
          priceTable,
          // --fallback-model: retry once on a backup model on transient errors
          chatFn: fallbackChatFn,
        };

        // --json-schema: structured output. Accepts a file path OR inline JSON.
        //  - text/json output: wrap the runner with capture + validate + retry
        //    (json-schema-output.js); prints only the validated JSON.
        //  - stream-json output: stream events normally, then emit a terminal
        //    `structured_result` event (schema_digest + valid + value/errors) as
        //    the last NDJSON line, so the two protocols are now compatible.
        if (options.jsonSchema) {
          const jso = await import("../lib/json-schema-output.js");
          if (options.outputFormat === "stream-json") {
            try {
              const schema = jso.loadSchemaFile(
                jso._deps.fs,
                options.jsonSchema,
              );
              const instruction = jso.buildSchemaInstruction(schema);
              const outcome = await runAgentHeadless({
                ...headlessOptions,
                appendSystemPrompt: [
                  headlessOptions.appendSystemPrompt,
                  instruction,
                ]
                  .filter(Boolean)
                  .join("\n\n"),
              });
              // The normal stream (init … result) has already been written to
              // stdout by the runner. Append the structured verdict as the final
              // NDJSON line, built from the run's final text.
              const parsed = jso.extractJsonPayload(
                String(outcome?.result ?? ""),
              );
              const evt = jso.buildStructuredResult(
                schema,
                parsed.ok ? parsed.value : null,
              );
              process.stdout.write(JSON.stringify(evt) + "\n");
              await _finishWorktree();
              process.exit(evt.valid ? 0 : 1);
            } catch (err) {
              process.stderr.write(`Error: ${err.message}\n`);
              await _finishWorktree();
              process.exit(1);
            }
          }
          try {
            const code = await jso.runJsonSchemaConstrained({
              schemaFile: options.jsonSchema,
              baseOptions: headlessOptions,
              runHeadless: runAgentHeadless,
            });
            await _finishWorktree();
            process.exit(code);
          } catch (err) {
            process.stderr.write(`Error: ${err.message}\n`);
            await _finishWorktree();
            process.exit(1);
          }
          return;
        }

        let outcome;
        try {
          outcome = await runAgentHeadless(headlessOptions);
        } catch (err) {
          process.stderr.write(`Error: ${err.message}\n`);
          await _finishWorktree();
          process.exit(1);
        }
        await _finishWorktree();
        process.exit(outcome.exitCode);
        return;
      }

      // --ephemeral is a headless contract (the interactive REPL owns its own
      // session lifecycle) — warn instead of silently dropping the flag.
      if (options.ephemeral) {
        process.stderr.write(
          "--ephemeral is only used in headless mode (-p / a task / piped stdin); ignoring for the interactive session.\n",
        );
      }
      // Reached only for an interactive session, where --image has no turn to
      // attach to 鈥?warn instead of silently dropping the attachment.
      if (images.length) {
        process.stderr.write(
          "--image is only used in headless mode (-p / a task / piped stdin); ignoring for the interactive session.\n",
        );
      }

      // Strict sandbox mode also guards the interactive session: refuse to
      // start when failIfUnavailable is set and the engine can't run.
      const interactiveSandbox = normalizeAgentSandbox(options.sandbox, {
        cwd: process.cwd(),
        network: options.sandboxNetwork === true,
        settings: settingsSandbox,
      });
      try {
        assertSandboxAvailable(interactiveSandbox);
      } catch (err) {
        process.stderr.write(`Error: ${err.message}\n`);
        process.exit(6); // config error (see lib/exit-codes.cjs)
      }

      const runtime = createAgentRuntimeFactory().createAgentRuntime({
        model: options.model,
        thinking,
        thinkingBudget,
        provider: options.provider,
        baseUrl: options.baseUrl,
        apiKey: options.apiKey,
        sessionId: options.session,
        agentId: options.agentId,
        // --permission-mode also applies interactively: manual → strict,
        // acceptEdits → trusted, bypassPermissions → autopilot, auto → trusted
        // + autoMode.decisions classifier; dontAsk denies instead of asking
        // (plan stays headless-only).
        permissionMode: options.permissionMode,
        recallLimit: options.recallLimit,
        recallQuery: options.recallQuery,
        recallMemory: options.recallMemory, // false when --no-recall-memory
        noStream: options.stream === false, // true when --no-stream
        parkOnExit: options.parkOnExit, // false when --no-park-on-exit
        bundlePath: options.bundle || null,
        additionalDirectories,
        sandbox: interactiveSandbox,
        autoCheckpoint,
        // --vim: start the REPL in vim-mode editing (also CC_VIM=1 or /vim).
        vimMode: options.vim === true,
        // --system-prompt / --append-system-prompt (literal or @file) also
        // apply to interactive sessions, composed in startAgentRepl.
        systemPrompt: resolvePromptText(options.systemPrompt, {
          cwd: process.cwd(),
        }),
        appendSystemPrompt: resolvePromptText(options.appendSystemPrompt, {
          cwd: process.cwd(),
        }),
        // --no-project-memory also applies interactively → options.projectMemory
        // === false suppresses the auto-loaded rules.md + cc.md/CLAUDE.md block
        // in the REPL's composed system prompt. Absent (undefined) = default-on.
        projectMemory: options.projectMemory,
        // --fallback-model also applies interactively (wrapper built in the
        // REPL). Pass the fully resolved chain (flag + config default).
        fallbackModels: fallbackModels.length ? fallbackModels : null,
        // --mcp-config + registered (cc mcp add) servers also apply to the
        // interactive session (the REPL resolves both via the mcp-config engine).
        mcpConfig: options.mcpConfig || null,
        useRegisteredMcp: options.mcp !== false,
        // --ide / --no-ide: IDE bridge auto-connect for the interactive session
        ide: options.ide,
        // --pdh / --no-pdh: PDH bridge auto-connect for the interactive session
        pdh: options.pdh,
        // --jetbrains / --no-jetbrains: IDEA built-in MCP for the interactive session
        jetbrains: options.jetbrains,
        // --disable-slash-commands: REPL sends "/" input to the model verbatim
        disableSlashCommands: options.disableSlashCommands === true,
        // --remote-control: start the paired-device approval bridge for the
        // interactive session too (terminal prompt races the device).
        remoteControl: options.remoteControl === true,
        // --channels: inbound channel listeners (webhook/telegram) whose
        // events become user turns in this session.
        channels: options.channels || null,
      });
      await runtime.startAgentSession();
      // Interactive session ended (REPL closed) — settle the worktree.
      await _finishWorktree();
    });
}

export function registerSubAgentV2Command(program) {
  const sa = program
    .command("subagent")
    .description("Sub-agent registry V2 governance");
  sa.command("maturities-v2").action(async () => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.SUBAGENT_PROFILE_MATURITY_V2, null, 2));
  });
  sa.command("task-lifecycle-v2").action(async () => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.SUBAGENT_TASK_LIFECYCLE_V2, null, 2));
  });
  sa.command("stats-v2").action(async () => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.getSubAgentRegistryStatsV2(), null, 2));
  });
  sa.command("config-v2").action(async () => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(
      JSON.stringify(
        {
          maxActiveSubagentsPerOwner: m.getMaxActiveSubagentsPerOwnerV2(),
          maxPendingTasksPerSubagent: m.getMaxPendingTasksPerSubagentV2(),
          subagentIdleMs: m.getSubagentIdleMsV2(),
          subagentTaskStuckMs: m.getSubagentTaskStuckMsV2(),
        },
        null,
        2,
      ),
    );
  });
  sa.command("register-profile-v2 <id> <owner> [role]").action(
    async (id, owner, role) => {
      const m = await import("../lib/sub-agent-registry.js");
      console.log(
        JSON.stringify(
          m.registerSubagentProfileV2({ id, owner, role }),
          null,
          2,
        ),
      );
    },
  );
  sa.command("activate-profile-v2 <id>").action(async (id) => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.activateSubagentProfileV2(id), null, 2));
  });
  sa.command("pause-profile-v2 <id>").action(async (id) => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.pauseSubagentProfileV2(id), null, 2));
  });
  sa.command("retire-profile-v2 <id>").action(async (id) => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.retireSubagentProfileV2(id), null, 2));
  });
  sa.command("touch-profile-v2 <id>").action(async (id) => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.touchSubagentProfileV2(id), null, 2));
  });
  sa.command("get-profile-v2 <id>").action(async (id) => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.getSubagentProfileV2(id), null, 2));
  });
  sa.command("list-profiles-v2").action(async () => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.listSubagentProfilesV2(), null, 2));
  });
  sa.command("create-task-v2 <id> <profileId> [desc]").action(
    async (id, profileId, desc) => {
      const m = await import("../lib/sub-agent-registry.js");
      console.log(
        JSON.stringify(
          m.createSubagentTaskV2({ id, profileId, description: desc }),
          null,
          2,
        ),
      );
    },
  );
  sa.command("start-task-v2 <id>").action(async (id) => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.startSubagentTaskV2(id), null, 2));
  });
  sa.command("complete-task-v2 <id>").action(async (id) => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.completeSubagentTaskV2(id), null, 2));
  });
  sa.command("fail-task-v2 <id> [reason]").action(async (id, reason) => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.failSubagentTaskV2(id, reason), null, 2));
  });
  sa.command("cancel-task-v2 <id> [reason]").action(async (id, reason) => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.cancelSubagentTaskV2(id, reason), null, 2));
  });
  sa.command("get-task-v2 <id>").action(async (id) => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.getSubagentTaskV2(id), null, 2));
  });
  sa.command("list-tasks-v2").action(async () => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.listSubagentTasksV2(), null, 2));
  });
  sa.command("auto-pause-idle-v2").action(async () => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.autoPauseIdleSubagentsV2(), null, 2));
  });
  sa.command("auto-fail-stuck-v2").action(async () => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.autoFailStuckSubagentTasksV2(), null, 2));
  });
  sa.command("set-max-active-v2 <n>").action(async (n) => {
    const m = await import("../lib/sub-agent-registry.js");
    m.setMaxActiveSubagentsPerOwnerV2(parseInt(n, 10));
    console.log(
      JSON.stringify(
        { maxActiveSubagentsPerOwner: m.getMaxActiveSubagentsPerOwnerV2() },
        null,
        2,
      ),
    );
  });
  sa.command("set-max-pending-v2 <n>").action(async (n) => {
    const m = await import("../lib/sub-agent-registry.js");
    m.setMaxPendingTasksPerSubagentV2(parseInt(n, 10));
    console.log(
      JSON.stringify(
        { maxPendingTasksPerSubagent: m.getMaxPendingTasksPerSubagentV2() },
        null,
        2,
      ),
    );
  });
  sa.command("set-idle-ms-v2 <n>").action(async (n) => {
    const m = await import("../lib/sub-agent-registry.js");
    m.setSubagentIdleMsV2(parseInt(n, 10));
    console.log(
      JSON.stringify({ subagentIdleMs: m.getSubagentIdleMsV2() }, null, 2),
    );
  });
  sa.command("set-stuck-ms-v2 <n>").action(async (n) => {
    const m = await import("../lib/sub-agent-registry.js");
    m.setSubagentTaskStuckMsV2(parseInt(n, 10));
    console.log(
      JSON.stringify(
        { subagentTaskStuckMs: m.getSubagentTaskStuckMsV2() },
        null,
        2,
      ),
    );
  });
  sa.command("reset-state-v2").action(async () => {
    const m = await import("../lib/sub-agent-registry.js");
    m._resetStateSubAgentRegistryV2();
    console.log(JSON.stringify({ ok: true }, null, 2));
  });
}

export function registerExecBackendV2Command(program) {
  const eb = program
    .command("execbe")
    .description("Execution backend V2 governance");
  eb.command("maturities-v2").action(async () => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.EXECBE_BACKEND_MATURITY_V2, null, 2));
  });
  eb.command("job-lifecycle-v2").action(async () => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.EXECBE_JOB_LIFECYCLE_V2, null, 2));
  });
  eb.command("stats-v2").action(async () => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.getExecutionBackendStatsV2(), null, 2));
  });
  eb.command("config-v2").action(async () => {
    const m = await import("../lib/execution-backend.js");
    console.log(
      JSON.stringify(
        {
          maxActiveBackendsPerOwner: m.getMaxActiveBackendsPerOwnerV2(),
          maxPendingJobsPerBackend: m.getMaxPendingJobsPerBackendV2(),
          backendIdleMs: m.getBackendIdleMsV2(),
          execJobStuckMs: m.getExecJobStuckMsV2(),
        },
        null,
        2,
      ),
    );
  });
  eb.command("register-backend-v2 <id> <owner> [kind]").action(
    async (id, owner, kind) => {
      const m = await import("../lib/execution-backend.js");
      console.log(
        JSON.stringify(m.registerBackendV2({ id, owner, kind }), null, 2),
      );
    },
  );
  eb.command("activate-backend-v2 <id>").action(async (id) => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.activateBackendV2(id), null, 2));
  });
  eb.command("degrade-backend-v2 <id>").action(async (id) => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.degradeBackendV2(id), null, 2));
  });
  eb.command("retire-backend-v2 <id>").action(async (id) => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.retireBackendV2(id), null, 2));
  });
  eb.command("touch-backend-v2 <id>").action(async (id) => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.touchBackendV2(id), null, 2));
  });
  eb.command("get-backend-v2 <id>").action(async (id) => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.getBackendV2(id), null, 2));
  });
  eb.command("list-backends-v2").action(async () => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.listBackendsV2(), null, 2));
  });
  eb.command("create-job-v2 <id> <backendId> [cmd]").action(
    async (id, backendId, cmd) => {
      const m = await import("../lib/execution-backend.js");
      console.log(
        JSON.stringify(
          m.createExecJobV2({ id, backendId, command: cmd }),
          null,
          2,
        ),
      );
    },
  );
  eb.command("start-job-v2 <id>").action(async (id) => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.startExecJobV2(id), null, 2));
  });
  eb.command("succeed-job-v2 <id>").action(async (id) => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.succeedExecJobV2(id), null, 2));
  });
  eb.command("fail-job-v2 <id> [reason]").action(async (id, reason) => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.failExecJobV2(id, reason), null, 2));
  });
  eb.command("cancel-job-v2 <id> [reason]").action(async (id, reason) => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.cancelExecJobV2(id, reason), null, 2));
  });
  eb.command("get-job-v2 <id>").action(async (id) => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.getExecJobV2(id), null, 2));
  });
  eb.command("list-jobs-v2").action(async () => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.listExecJobsV2(), null, 2));
  });
  eb.command("auto-degrade-idle-v2").action(async () => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.autoDegradeIdleBackendsV2(), null, 2));
  });
  eb.command("auto-fail-stuck-v2").action(async () => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.autoFailStuckExecJobsV2(), null, 2));
  });
  eb.command("set-max-active-v2 <n>").action(async (n) => {
    const m = await import("../lib/execution-backend.js");
    m.setMaxActiveBackendsPerOwnerV2(parseInt(n, 10));
    console.log(
      JSON.stringify(
        { maxActiveBackendsPerOwner: m.getMaxActiveBackendsPerOwnerV2() },
        null,
        2,
      ),
    );
  });
  eb.command("set-max-pending-v2 <n>").action(async (n) => {
    const m = await import("../lib/execution-backend.js");
    m.setMaxPendingJobsPerBackendV2(parseInt(n, 10));
    console.log(
      JSON.stringify(
        { maxPendingJobsPerBackend: m.getMaxPendingJobsPerBackendV2() },
        null,
        2,
      ),
    );
  });
  eb.command("set-idle-ms-v2 <n>").action(async (n) => {
    const m = await import("../lib/execution-backend.js");
    m.setBackendIdleMsV2(parseInt(n, 10));
    console.log(
      JSON.stringify({ backendIdleMs: m.getBackendIdleMsV2() }, null, 2),
    );
  });
  eb.command("set-stuck-ms-v2 <n>").action(async (n) => {
    const m = await import("../lib/execution-backend.js");
    m.setExecJobStuckMsV2(parseInt(n, 10));
    console.log(
      JSON.stringify({ execJobStuckMs: m.getExecJobStuckMsV2() }, null, 2),
    );
  });
  eb.command("reset-state-v2").action(async () => {
    const m = await import("../lib/execution-backend.js");
    m._resetStateExecutionBackendV2();
    console.log(JSON.stringify({ ok: true }, null, 2));
  });
}

export function registerTodoV2Command(program) {
  const td = program.command("todo").description("Todo manager V2 governance");
  td.command("maturities-v2").action(async () => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.TODO_LIST_MATURITY_V2, null, 2));
  });
  td.command("item-lifecycle-v2").action(async () => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.TODO_ITEM_LIFECYCLE_V2, null, 2));
  });
  td.command("stats-v2").action(async () => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.getTodoManagerStatsV2(), null, 2));
  });
  td.command("config-v2").action(async () => {
    const m = await import("../lib/todo-manager.js");
    console.log(
      JSON.stringify(
        {
          maxActiveTodoListsPerOwner: m.getMaxActiveTodoListsPerOwnerV2(),
          maxPendingItemsPerTodoList: m.getMaxPendingItemsPerTodoListV2(),
          todoListIdleMs: m.getTodoListIdleMsV2(),
          todoItemStuckMs: m.getTodoItemStuckMsV2(),
        },
        null,
        2,
      ),
    );
  });
  td.command("register-list-v2 <id> <owner> [title]").action(
    async (id, owner, title) => {
      const m = await import("../lib/todo-manager.js");
      console.log(
        JSON.stringify(m.registerTodoListV2({ id, owner, title }), null, 2),
      );
    },
  );
  td.command("activate-list-v2 <id>").action(async (id) => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.activateTodoListV2(id), null, 2));
  });
  td.command("pause-list-v2 <id>").action(async (id) => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.pauseTodoListV2(id), null, 2));
  });
  td.command("archive-list-v2 <id>").action(async (id) => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.archiveTodoListV2(id), null, 2));
  });
  td.command("touch-list-v2 <id>").action(async (id) => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.touchTodoListV2(id), null, 2));
  });
  td.command("get-list-v2 <id>").action(async (id) => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.getTodoListV2(id), null, 2));
  });
  td.command("list-lists-v2").action(async () => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.listTodoListsV2(), null, 2));
  });
  td.command("create-item-v2 <id> <listId> [desc]").action(
    async (id, listId, desc) => {
      const m = await import("../lib/todo-manager.js");
      console.log(
        JSON.stringify(
          m.createTodoItemV2({ id, listId, description: desc }),
          null,
          2,
        ),
      );
    },
  );
  td.command("start-item-v2 <id>").action(async (id) => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.startTodoItemV2(id), null, 2));
  });
  td.command("complete-item-v2 <id>").action(async (id) => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.completeTodoItemV2(id), null, 2));
  });
  td.command("fail-item-v2 <id> [reason]").action(async (id, reason) => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.failTodoItemV2(id, reason), null, 2));
  });
  td.command("cancel-item-v2 <id> [reason]").action(async (id, reason) => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.cancelTodoItemV2(id, reason), null, 2));
  });
  td.command("get-item-v2 <id>").action(async (id) => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.getTodoItemV2(id), null, 2));
  });
  td.command("list-items-v2").action(async () => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.listTodoItemsV2(), null, 2));
  });
  td.command("auto-pause-idle-v2").action(async () => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.autoPauseIdleTodoListsV2(), null, 2));
  });
  td.command("auto-fail-stuck-v2").action(async () => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.autoFailStuckTodoItemsV2(), null, 2));
  });
  td.command("set-max-active-v2 <n>").action(async (n) => {
    const m = await import("../lib/todo-manager.js");
    m.setMaxActiveTodoListsPerOwnerV2(parseInt(n, 10));
    console.log(
      JSON.stringify(
        { maxActiveTodoListsPerOwner: m.getMaxActiveTodoListsPerOwnerV2() },
        null,
        2,
      ),
    );
  });
  td.command("set-max-pending-v2 <n>").action(async (n) => {
    const m = await import("../lib/todo-manager.js");
    m.setMaxPendingItemsPerTodoListV2(parseInt(n, 10));
    console.log(
      JSON.stringify(
        { maxPendingItemsPerTodoList: m.getMaxPendingItemsPerTodoListV2() },
        null,
        2,
      ),
    );
  });
  td.command("set-idle-ms-v2 <n>").action(async (n) => {
    const m = await import("../lib/todo-manager.js");
    m.setTodoListIdleMsV2(parseInt(n, 10));
    console.log(
      JSON.stringify({ todoListIdleMs: m.getTodoListIdleMsV2() }, null, 2),
    );
  });
  td.command("set-stuck-ms-v2 <n>").action(async (n) => {
    const m = await import("../lib/todo-manager.js");
    m.setTodoItemStuckMsV2(parseInt(n, 10));
    console.log(
      JSON.stringify({ todoItemStuckMs: m.getTodoItemStuckMsV2() }, null, 2),
    );
  });
  td.command("reset-state-v2").action(async () => {
    const m = await import("../lib/todo-manager.js");
    m._resetStateTodoManagerV2();
    console.log(JSON.stringify({ ok: true }, null, 2));
  });
}

export function registerAutoAgentV2Command(program) {
  const aa = program
    .command("autoagent")
    .description("Autonomous agent V2 governance");
  const L = async () => await import("../lib/autonomous-agent.js");
  aa.command("enums-v2").action(async () => {
    const m = await L();
    console.log(
      JSON.stringify(
        {
          agentMaturity: m.AUTOAGENT_MATURITY_V2,
          runLifecycle: m.AUTOAGENT_RUN_LIFECYCLE_V2,
        },
        null,
        2,
      ),
    );
  });
  aa.command("config-v2").action(async () => {
    const m = await L();
    console.log(
      JSON.stringify(
        {
          maxActiveAutoAgentsPerOwner: m.getMaxActiveAutoAgentsPerOwnerV2(),
          maxPendingAutoAgentRunsPerAgent:
            m.getMaxPendingAutoAgentRunsPerAgentV2(),
          autoAgentIdleMs: m.getAutoAgentIdleMsV2(),
          autoAgentRunStuckMs: m.getAutoAgentRunStuckMsV2(),
        },
        null,
        2,
      ),
    );
  });
  aa.command("set-max-active-v2 <n>").action(async (n) => {
    const m = await L();
    m.setMaxActiveAutoAgentsPerOwnerV2(Number(n));
    console.log("ok");
  });
  aa.command("set-max-pending-v2 <n>").action(async (n) => {
    const m = await L();
    m.setMaxPendingAutoAgentRunsPerAgentV2(Number(n));
    console.log("ok");
  });
  aa.command("set-idle-ms-v2 <n>").action(async (n) => {
    const m = await L();
    m.setAutoAgentIdleMsV2(Number(n));
    console.log("ok");
  });
  aa.command("set-stuck-ms-v2 <n>").action(async (n) => {
    const m = await L();
    m.setAutoAgentRunStuckMsV2(Number(n));
    console.log("ok");
  });
  aa.command("register-agent-v2 <id> <owner>")
    .option("--goal <g>", "Goal")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerAutoAgentV2({ id, owner, goal: o.goal }),
          null,
          2,
        ),
      );
    });
  aa.command("activate-agent-v2 <id>").action(async (id) => {
    const m = await L();
    console.log(JSON.stringify(m.activateAutoAgentV2(id), null, 2));
  });
  aa.command("pause-agent-v2 <id>").action(async (id) => {
    const m = await L();
    console.log(JSON.stringify(m.pauseAutoAgentV2(id), null, 2));
  });
  aa.command("archive-agent-v2 <id>").action(async (id) => {
    const m = await L();
    console.log(JSON.stringify(m.archiveAutoAgentV2(id), null, 2));
  });
  aa.command("touch-agent-v2 <id>").action(async (id) => {
    const m = await L();
    console.log(JSON.stringify(m.touchAutoAgentV2(id), null, 2));
  });
  aa.command("get-agent-v2 <id>").action(async (id) => {
    const m = await L();
    console.log(JSON.stringify(m.getAutoAgentV2(id), null, 2));
  });
  aa.command("list-agents-v2").action(async () => {
    const m = await L();
    console.log(JSON.stringify(m.listAutoAgentsV2(), null, 2));
  });
  aa.command("create-run-v2 <id> <agentId>")
    .option("--prompt <p>", "Prompt")
    .action(async (id, agentId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createAutoAgentRunV2({ id, agentId, prompt: o.prompt }),
          null,
          2,
        ),
      );
    });
  aa.command("start-run-v2 <id>").action(async (id) => {
    const m = await L();
    console.log(JSON.stringify(m.startAutoAgentRunV2(id), null, 2));
  });
  aa.command("complete-run-v2 <id>").action(async (id) => {
    const m = await L();
    console.log(JSON.stringify(m.completeAutoAgentRunV2(id), null, 2));
  });
  aa.command("fail-run-v2 <id> [reason]").action(async (id, reason) => {
    const m = await L();
    console.log(JSON.stringify(m.failAutoAgentRunV2(id, reason), null, 2));
  });
  aa.command("cancel-run-v2 <id> [reason]").action(async (id, reason) => {
    const m = await L();
    console.log(JSON.stringify(m.cancelAutoAgentRunV2(id, reason), null, 2));
  });
  aa.command("get-run-v2 <id>").action(async (id) => {
    const m = await L();
    console.log(JSON.stringify(m.getAutoAgentRunV2(id), null, 2));
  });
  aa.command("list-runs-v2").action(async () => {
    const m = await L();
    console.log(JSON.stringify(m.listAutoAgentRunsV2(), null, 2));
  });
  aa.command("auto-pause-idle-v2").action(async () => {
    const m = await L();
    console.log(JSON.stringify(m.autoPauseIdleAutoAgentsV2(), null, 2));
  });
  aa.command("auto-fail-stuck-v2").action(async () => {
    const m = await L();
    console.log(JSON.stringify(m.autoFailStuckAutoAgentRunsV2(), null, 2));
  });
  aa.command("gov-stats-v2").action(async () => {
    const m = await L();
    console.log(JSON.stringify(m.getAutonomousAgentGovStatsV2(), null, 2));
  });
  aa.command("reset-state-v2").action(async () => {
    const m = await L();
    m._resetStateAutonomousAgentV2();
    console.log(JSON.stringify({ ok: true }, null, 2));
  });
}

// === Iter25 V2 governance overlay ===
export function registerSaregovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "agent");
  if (!parent) return;
  const L = async () => await import("../lib/sub-agent-registry.js");
  parent
    .command("saregov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.SAREGOV_PROFILE_MATURITY_V2,
            spawnLifecycle: m.SAREGOV_SPAWN_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("saregov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveSaregovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingSaregovSpawnsPerProfileV2(),
            idleMs: m.getSaregovProfileIdleMsV2(),
            stuckMs: m.getSaregovSpawnStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("saregov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveSaregovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("saregov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingSaregovSpawnsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("saregov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setSaregovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("saregov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setSaregovSpawnStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("saregov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--kind <v>", "kind")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerSaregovProfileV2({ id, owner, kind: o.kind }),
          null,
          2,
        ),
      );
    });
  parent
    .command("saregov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateSaregovProfileV2(id), null, 2),
      );
    });
  parent
    .command("saregov-suspend-v2 <id>")
    .description("Suspend profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).suspendSaregovProfileV2(id), null, 2),
      );
    });
  parent
    .command("saregov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveSaregovProfileV2(id), null, 2),
      );
    });
  parent
    .command("saregov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchSaregovProfileV2(id), null, 2),
      );
    });
  parent
    .command("saregov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getSaregovProfileV2(id), null, 2));
    });
  parent
    .command("saregov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listSaregovProfilesV2(), null, 2));
    });
  parent
    .command("saregov-create-spawn-v2 <id> <profileId>")
    .description("Create spawn")
    .option("--task <v>", "task")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createSaregovSpawnV2({ id, profileId, task: o.task }),
          null,
          2,
        ),
      );
    });
  parent
    .command("saregov-spawning-spawn-v2 <id>")
    .description("Mark spawn as spawning")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).spawningSaregovSpawnV2(id), null, 2),
      );
    });
  parent
    .command("saregov-complete-spawn-v2 <id>")
    .description("Complete spawn")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeSpawnSaregovV2(id), null, 2),
      );
    });
  parent
    .command("saregov-fail-spawn-v2 <id> [reason]")
    .description("Fail spawn")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failSaregovSpawnV2(id, reason), null, 2),
      );
    });
  parent
    .command("saregov-cancel-spawn-v2 <id> [reason]")
    .description("Cancel spawn")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelSaregovSpawnV2(id, reason), null, 2),
      );
    });
  parent
    .command("saregov-get-spawn-v2 <id>")
    .description("Get spawn")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getSaregovSpawnV2(id), null, 2));
    });
  parent
    .command("saregov-list-spawns-v2")
    .description("List spawns")
    .action(async () => {
      console.log(JSON.stringify((await L()).listSaregovSpawnsV2(), null, 2));
    });
  parent
    .command("saregov-auto-suspend-idle-v2")
    .description("Auto-suspend idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoSuspendIdleSaregovProfilesV2(), null, 2),
      );
    });
  parent
    .command("saregov-auto-fail-stuck-v2")
    .description("Auto-fail stuck spawns")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckSaregovSpawnsV2(), null, 2),
      );
    });
  parent
    .command("saregov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getSubAgentRegistryGovStatsV2(), null, 2),
      );
    });
}

// === Iter25 V2 governance overlay ===
export function registerTodogovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "agent");
  if (!parent) return;
  const L = async () => await import("../lib/todo-manager.js");
  parent
    .command("todogov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.TODOGOV_PROFILE_MATURITY_V2,
            stepLifecycle: m.TODOGOV_STEP_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("todogov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveTodogovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingTodogovStepsPerProfileV2(),
            idleMs: m.getTodogovProfileIdleMsV2(),
            stuckMs: m.getTodogovStepStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("todogov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveTodogovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("todogov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingTodogovStepsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("todogov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setTodogovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("todogov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setTodogovStepStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("todogov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--list <v>", "list")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerTodogovProfileV2({ id, owner, list: o.list }),
          null,
          2,
        ),
      );
    });
  parent
    .command("todogov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateTodogovProfileV2(id), null, 2),
      );
    });
  parent
    .command("todogov-pause-v2 <id>")
    .description("Pause profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).pauseTodogovProfileV2(id), null, 2),
      );
    });
  parent
    .command("todogov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveTodogovProfileV2(id), null, 2),
      );
    });
  parent
    .command("todogov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchTodogovProfileV2(id), null, 2),
      );
    });
  parent
    .command("todogov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getTodogovProfileV2(id), null, 2));
    });
  parent
    .command("todogov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listTodogovProfilesV2(), null, 2));
    });
  parent
    .command("todogov-create-step-v2 <id> <profileId>")
    .description("Create step")
    .option("--title <v>", "title")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createTodogovStepV2({ id, profileId, title: o.title }),
          null,
          2,
        ),
      );
    });
  parent
    .command("todogov-doing-step-v2 <id>")
    .description("Mark step as doing")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).doingTodogovStepV2(id), null, 2));
    });
  parent
    .command("todogov-complete-step-v2 <id>")
    .description("Complete step")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeStepTodogovV2(id), null, 2),
      );
    });
  parent
    .command("todogov-fail-step-v2 <id> [reason]")
    .description("Fail step")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failTodogovStepV2(id, reason), null, 2),
      );
    });
  parent
    .command("todogov-cancel-step-v2 <id> [reason]")
    .description("Cancel step")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelTodogovStepV2(id, reason), null, 2),
      );
    });
  parent
    .command("todogov-get-step-v2 <id>")
    .description("Get step")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getTodogovStepV2(id), null, 2));
    });
  parent
    .command("todogov-list-steps-v2")
    .description("List steps")
    .action(async () => {
      console.log(JSON.stringify((await L()).listTodogovStepsV2(), null, 2));
    });
  parent
    .command("todogov-auto-pause-idle-v2")
    .description("Auto-pause idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoPauseIdleTodogovProfilesV2(), null, 2),
      );
    });
  parent
    .command("todogov-auto-fail-stuck-v2")
    .description("Auto-fail stuck steps")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckTodogovStepsV2(), null, 2),
      );
    });
  parent
    .command("todogov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getTodoManagerGovStatsV2(), null, 2),
      );
    });
}

// === Iter25 V2 governance overlay ===
export function registerEbgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "agent");
  if (!parent) return;
  const L = async () => await import("../lib/execution-backend.js");
  parent
    .command("ebgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.EBGOV_PROFILE_MATURITY_V2,
            jobLifecycle: m.EBGOV_JOB_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("ebgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveEbgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingEbgovJobsPerProfileV2(),
            idleMs: m.getEbgovProfileIdleMsV2(),
            stuckMs: m.getEbgovJobStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("ebgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveEbgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("ebgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingEbgovJobsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("ebgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setEbgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("ebgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setEbgovJobStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("ebgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--backend <v>", "backend")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerEbgovProfileV2({ id, owner, backend: o.backend }),
          null,
          2,
        ),
      );
    });
  parent
    .command("ebgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateEbgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("ebgov-degrade-v2 <id>")
    .description("Degrade profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).degradeEbgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("ebgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveEbgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("ebgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).touchEbgovProfileV2(id), null, 2));
    });
  parent
    .command("ebgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getEbgovProfileV2(id), null, 2));
    });
  parent
    .command("ebgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listEbgovProfilesV2(), null, 2));
    });
  parent
    .command("ebgov-create-job-v2 <id> <profileId>")
    .description("Create job")
    .option("--task <v>", "task")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createEbgovJobV2({ id, profileId, task: o.task }),
          null,
          2,
        ),
      );
    });
  parent
    .command("ebgov-executing-job-v2 <id>")
    .description("Mark job as executing")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).executingEbgovJobV2(id), null, 2));
    });
  parent
    .command("ebgov-complete-job-v2 <id>")
    .description("Complete job")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).completeJobEbgovV2(id), null, 2));
    });
  parent
    .command("ebgov-fail-job-v2 <id> [reason]")
    .description("Fail job")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failEbgovJobV2(id, reason), null, 2),
      );
    });
  parent
    .command("ebgov-cancel-job-v2 <id> [reason]")
    .description("Cancel job")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelEbgovJobV2(id, reason), null, 2),
      );
    });
  parent
    .command("ebgov-get-job-v2 <id>")
    .description("Get job")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getEbgovJobV2(id), null, 2));
    });
  parent
    .command("ebgov-list-jobs-v2")
    .description("List jobs")
    .action(async () => {
      console.log(JSON.stringify((await L()).listEbgovJobsV2(), null, 2));
    });
  parent
    .command("ebgov-auto-degrade-idle-v2")
    .description("Auto-degrade idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoDegradeIdleEbgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("ebgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck jobs")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckEbgovJobsV2(), null, 2),
      );
    });
  parent
    .command("ebgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getExecutionBackendGovStatsV2(), null, 2),
      );
    });
}

// === Iter26 V2 governance overlay ===
export function registerSactxgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "agent");
  if (!parent) return;
  const L = async () => await import("../lib/sub-agent-context.js");
  parent
    .command("sactxgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.SACTXGOV_PROFILE_MATURITY_V2,
            handoffLifecycle: m.SACTXGOV_HANDOFF_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("sactxgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveSactxgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingSactxgovHandoffsPerProfileV2(),
            idleMs: m.getSactxgovProfileIdleMsV2(),
            stuckMs: m.getSactxgovHandoffStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("sactxgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveSactxgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("sactxgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingSactxgovHandoffsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("sactxgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setSactxgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("sactxgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setSactxgovHandoffStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("sactxgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--scope <v>", "scope")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerSactxgovProfileV2({ id, owner, scope: o.scope }),
          null,
          2,
        ),
      );
    });
  parent
    .command("sactxgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateSactxgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("sactxgov-stale-v2 <id>")
    .description("Stale profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).staleSactxgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("sactxgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveSactxgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("sactxgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchSactxgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("sactxgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).getSactxgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("sactxgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).listSactxgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("sactxgov-create-handoff-v2 <id> <profileId>")
    .description("Create handoff")
    .option("--subAgent <v>", "subAgent")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createSactxgovHandoffV2({ id, profileId, subAgent: o.subAgent }),
          null,
          2,
        ),
      );
    });
  parent
    .command("sactxgov-transferring-handoff-v2 <id>")
    .description("Mark handoff as transferring")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).transferringSactxgovHandoffV2(id), null, 2),
      );
    });
  parent
    .command("sactxgov-complete-handoff-v2 <id>")
    .description("Complete handoff")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeHandoffSactxgovV2(id), null, 2),
      );
    });
  parent
    .command("sactxgov-fail-handoff-v2 <id> [reason]")
    .description("Fail handoff")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failSactxgovHandoffV2(id, reason), null, 2),
      );
    });
  parent
    .command("sactxgov-cancel-handoff-v2 <id> [reason]")
    .description("Cancel handoff")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify(
          (await L()).cancelSactxgovHandoffV2(id, reason),
          null,
          2,
        ),
      );
    });
  parent
    .command("sactxgov-get-handoff-v2 <id>")
    .description("Get handoff")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).getSactxgovHandoffV2(id), null, 2),
      );
    });
  parent
    .command("sactxgov-list-handoffs-v2")
    .description("List handoffs")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).listSactxgovHandoffsV2(), null, 2),
      );
    });
  parent
    .command("sactxgov-auto-stale-idle-v2")
    .description("Auto-stale idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoStaleIdleSactxgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("sactxgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck handoffs")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckSactxgovHandoffsV2(), null, 2),
      );
    });
  parent
    .command("sactxgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getSubAgentContextGovStatsV2(), null, 2),
      );
    });
}

// === Iter27 V2 governance overlay ===
export function registerSapgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "agent");
  if (!parent) return;
  const L = async () => await import("../lib/sub-agent-profiles.js");
  parent
    .command("sapgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.SAPGOV_PROFILE_MATURITY_V2,
            applyLifecycle: m.SAPGOV_APPLY_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("sapgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveSapgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingSapgovApplysPerProfileV2(),
            idleMs: m.getSapgovProfileIdleMsV2(),
            stuckMs: m.getSapgovApplyStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("sapgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveSapgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("sapgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingSapgovApplysPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("sapgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setSapgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("sapgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setSapgovApplyStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("sapgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--role <v>", "role")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerSapgovProfileV2({ id, owner, role: o.role }),
          null,
          2,
        ),
      );
    });
  parent
    .command("sapgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateSapgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("sapgov-suspend-v2 <id>")
    .description("Suspend profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).suspendSapgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("sapgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveSapgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("sapgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchSapgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("sapgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getSapgovProfileV2(id), null, 2));
    });
  parent
    .command("sapgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listSapgovProfilesV2(), null, 2));
    });
  parent
    .command("sapgov-create-apply-v2 <id> <profileId>")
    .description("Create apply")
    .option("--agentId <v>", "agentId")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createSapgovApplyV2({ id, profileId, agentId: o.agentId }),
          null,
          2,
        ),
      );
    });
  parent
    .command("sapgov-applying-apply-v2 <id>")
    .description("Mark apply as applying")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).applyingSapgovApplyV2(id), null, 2),
      );
    });
  parent
    .command("sapgov-complete-apply-v2 <id>")
    .description("Complete apply")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeApplySapgovV2(id), null, 2),
      );
    });
  parent
    .command("sapgov-fail-apply-v2 <id> [reason]")
    .description("Fail apply")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failSapgovApplyV2(id, reason), null, 2),
      );
    });
  parent
    .command("sapgov-cancel-apply-v2 <id> [reason]")
    .description("Cancel apply")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelSapgovApplyV2(id, reason), null, 2),
      );
    });
  parent
    .command("sapgov-get-apply-v2 <id>")
    .description("Get apply")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getSapgovApplyV2(id), null, 2));
    });
  parent
    .command("sapgov-list-applys-v2")
    .description("List applys")
    .action(async () => {
      console.log(JSON.stringify((await L()).listSapgovApplysV2(), null, 2));
    });
  parent
    .command("sapgov-auto-suspend-idle-v2")
    .description("Auto-suspend idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoSuspendIdleSapgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("sapgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck applys")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckSapgovApplysV2(), null, 2),
      );
    });
  parent
    .command("sapgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getSubAgentProfilesGovStatsV2(), null, 2),
      );
    });
}

// === Iter28 V2 governance overlay: Autagov ===
export function registerAutagV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "agent");
  if (!parent) return;
  const L = async () => await import("../lib/autonomous-agent.js");
  parent
    .command("autagov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.AUTAGOV_PROFILE_MATURITY_V2,
            runLifecycle: m.AUTAGOV_RUN_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("autagov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveAutagProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingAutagRunsPerProfileV2(),
            idleMs: m.getAutagProfileIdleMsV2(),
            stuckMs: m.getAutagRunStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("autagov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveAutagProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("autagov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingAutagRunsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("autagov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setAutagProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("autagov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setAutagRunStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("autagov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--tier <v>", "tier")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerAutagProfileV2({ id, owner, tier: o.tier }),
          null,
          2,
        ),
      );
    });
  parent
    .command("autagov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateAutagProfileV2(id), null, 2),
      );
    });
  parent
    .command("autagov-paused-v2 <id>")
    .description("Paused profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).pausedAutagProfileV2(id), null, 2),
      );
    });
  parent
    .command("autagov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveAutagProfileV2(id), null, 2),
      );
    });
  parent
    .command("autagov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).touchAutagProfileV2(id), null, 2));
    });
  parent
    .command("autagov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getAutagProfileV2(id), null, 2));
    });
  parent
    .command("autagov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listAutagProfilesV2(), null, 2));
    });
  parent
    .command("autagov-create-run-v2 <id> <profileId>")
    .description("Create run")
    .option("--runId <v>", "runId")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createAutagRunV2({ id, profileId, runId: o.runId }),
          null,
          2,
        ),
      );
    });
  parent
    .command("autagov-running-run-v2 <id>")
    .description("Mark run as running")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).runningAutagRunV2(id), null, 2));
    });
  parent
    .command("autagov-complete-run-v2 <id>")
    .description("Complete run")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).completeRunAutagV2(id), null, 2));
    });
  parent
    .command("autagov-fail-run-v2 <id> [reason]")
    .description("Fail run")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failAutagRunV2(id, reason), null, 2),
      );
    });
  parent
    .command("autagov-cancel-run-v2 <id> [reason]")
    .description("Cancel run")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelAutagRunV2(id, reason), null, 2),
      );
    });
  parent
    .command("autagov-get-run-v2 <id>")
    .description("Get run")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getAutagRunV2(id), null, 2));
    });
  parent
    .command("autagov-list-runs-v2")
    .description("List runs")
    .action(async () => {
      console.log(JSON.stringify((await L()).listAutagRunsV2(), null, 2));
    });
  parent
    .command("autagov-auto-paused-idle-v2")
    .description("Auto-paused idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoPausedIdleAutagProfilesV2(), null, 2),
      );
    });
  parent
    .command("autagov-auto-fail-stuck-v2")
    .description("Auto-fail stuck runs")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckAutagRunsV2(), null, 2),
      );
    });
  parent
    .command("autagov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(JSON.stringify((await L()).getAutagovStatsV2(), null, 2));
    });
}
