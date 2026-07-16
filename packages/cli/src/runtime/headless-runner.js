/**
 * Headless agent runner — Claude-Code `claude -p` parity for `cc agent`.
 *
 * Runs ONE non-interactive agentic turn (the agent may still take many internal
 * tool-loop iterations) and emits the result in a machine-consumable format.
 * Unlike startAgentRepl, there is no readline loop — input arrives via the
 * `prompt` option (flag / positional / piped stdin) and the process exits when
 * the loop completes.
 *
 * Output formats (mirrors `claude -p --output-format`):
 *  - text         : final assistant text only → stdout; tool trace → stderr
 *  - json         : a single result envelope (one JSON object) → stdout
 *  - stream-json   : one JSON event per line (NDJSON) → stdout, as they happen
 *
 * Permission model: headless cannot show an interactive approval prompt, so the
 * default is fail-closed (deny MEDIUM/HIGH-risk shell). --permission-mode opts
 * into a looser tier:
 *  - (default) / manual / dontAsk / plan → STRICT + deny-confirmer
 *    (plan also restricts tools)
 *  - auto / acceptEdits                  → TRUSTED + deny-confirmer
 *    (HIGH-risk shell still denied)
 *  - bypassPermissions                   → AUTOPILOT (everything allowed)
 */

import { bootstrap } from "./bootstrap.js";
import {
  buildSystemPrompt,
  agentLoop as coreAgentLoop,
  formatToolArgs,
  killAllBackgroundShellTasks,
  killAllBackgroundShellTasksSync,
} from "./agent-core.js";
import {
  resolveAgentMcp,
  resolvePermissionPromptTool,
  makePermissionPromptConfirmer,
} from "./mcp-config.js";
import { maybeApplyToolSearch } from "./mcp-tool-search.js";
import { IterationBudget } from "../lib/iteration-budget.js";
import {
  startSession as jsonlStartSession,
  appendUserMessage as jsonlAppendUserMessage,
  appendAssistantMessage as jsonlAppendAssistantMessage,
  appendTokenUsage as jsonlAppendTokenUsage,
  appendToolCallCompact as jsonlAppendToolCallCompact,
  appendCompactEvent as jsonlAppendCompactEvent,
  appendEvent as jsonlAppendEvent,
  readEvents as jsonlReadEvents,
  rebuildMessages as jsonlRebuildMessages,
  sessionExists as jsonlSessionExists,
  getLastSessionId as jsonlGetLastSessionId,
  verifySession as jsonlVerifySession,
} from "../harness/jsonl-session-store.js";
import {
  SideEffectLedger,
  reconcileSideEffects,
  classifyToolSideEffect,
} from "../lib/side-effect-ledger.js";
import { SIDE_EFFECT_LEDGER_EVENT } from "../lib/side-effect-ledger-store.js";
import { operationIdempotencyKey } from "../lib/idempotency.js";
import { expandFileRefsAsync } from "./file-ref-expander.js";
import { composeSystemPrompt } from "./system-prompt.js";
import { buildUserContent } from "../lib/image-input.js";
import { mergeConsecutiveMessages } from "./message-roles.js";
import { isHeadlessConfigCommand } from "../lib/headless-config-command.js";
import {
  STREAM_PROTOCOL_VERSION,
  computePolicyDigest,
  computeToolsHash,
  buildLoadedSources,
} from "../lib/headless-manifest.js";
import {
  HEADLESS_EXIT_CODES,
  classifyLoopError,
  exitCodeForEndReason,
} from "../lib/exit-codes.cjs";
import { isolationLevel } from "../lib/agent-sandbox.js";
import { withQuietStdout } from "./quiet-stdout.js";
import { CostBudget } from "../lib/cost-budget.js";
import {
  classifyDenial,
  recordDenial,
  formatDenials,
} from "../lib/repl-denials.js";

/** Tools that cannot mutate the filesystem or run commands. */
export const READ_ONLY_TOOLS = Object.freeze([
  "read_file",
  "search_files",
  "list_dir",
  "list_skills",
  "search_sessions",
]);

const VALID_PERMISSION_MODES = Object.freeze([
  "default",
  "manual",
  "auto",
  "dontAsk",
  "plan",
  "acceptEdits",
  "bypassPermissions",
]);

const VALID_OUTPUT_FORMATS = Object.freeze(["text", "json", "stream-json"]);

// EPIPE guard for `cc agent -p … | head`. Lives in pipe-safety.js (shared with
// the stream-json driver + REPL); re-exported here for existing importers.
export { installPipeSafety } from "./pipe-safety.js";
import { installPipeSafety } from "./pipe-safety.js";

/**
 * Normalize a public --permission-mode spelling to the canonical internal mode.
 *
 * @param {string} [mode]
 * @returns {string}
 */
export function normalizePermissionMode(mode = "default") {
  const m = mode || "default";
  if (!VALID_PERMISSION_MODES.includes(m)) {
    throw new Error(
      `Invalid --permission-mode "${m}". Expected one of: ${VALID_PERMISSION_MODES.join(", ")}`,
    );
  }
  return m;
}

/**
 * Resolve a --permission-mode string into the session-policy tier + a
 * non-interactive confirmer + whether to clamp tools to the read-only set.
 *
 * @param {string} mode
 * @returns {{ sessionPolicy: string, confirmer: (ctx:any)=>Promise<boolean>, readOnly: boolean, allowInteractiveApprovals: boolean }}
 */
export function resolvePermissionMode(mode = "default") {
  const m = normalizePermissionMode(mode);
  // Headless can't ask a human — deny when a confirm would be required.
  const denyConfirmer = async () => false;
  const allowConfirmer = async () => true;
  switch (m) {
    case "bypassPermissions":
      return {
        sessionPolicy: "autopilot",
        confirmer: allowConfirmer,
        readOnly: false,
        allowInteractiveApprovals: false,
      };
    case "auto":
    case "acceptEdits":
      return {
        sessionPolicy: "trusted",
        confirmer: denyConfirmer,
        readOnly: false,
        allowInteractiveApprovals: true,
      };
    case "plan":
      return {
        sessionPolicy: "strict",
        confirmer: denyConfirmer,
        readOnly: true,
        allowInteractiveApprovals: true,
      };
    case "dontAsk":
      return {
        sessionPolicy: "strict",
        confirmer: denyConfirmer,
        readOnly: false,
        allowInteractiveApprovals: false,
      };
    case "manual":
    case "default":
    default:
      return {
        sessionPolicy: "strict",
        confirmer: denyConfirmer,
        readOnly: false,
        allowInteractiveApprovals: true,
      };
  }
}

/**
 * Compute the effective tool allow-list. --allowed-tools wins; when plan mode
 * forces read-only we intersect with READ_ONLY_TOOLS so a user can't widen it.
 *
 * @returns {string[]|null} null = all tools (subject to disabledTools)
 */
export function resolveEnabledTools({ allowedTools, readOnly } = {}) {
  let names =
    Array.isArray(allowedTools) && allowedTools.length > 0
      ? [...allowedTools]
      : null;
  if (readOnly) {
    names = names
      ? names.filter((n) => READ_ONLY_TOOLS.includes(n))
      : [...READ_ONLY_TOOLS];
  }
  return names;
}

/** Normalize a comma/space separated CLI list into a string[] (or null). */
export function parseToolList(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value.flatMap((v) => parseToolList(v) || []);
  const out = String(value)
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return out.length > 0 ? out : null;
}

/**
 * Resolve the working session id, the id to resume history from, and whether to
 * persist this turn — mirroring `claude -p --resume <id>` / `--continue`.
 *
 *  - continueSession (or --resume with no id) → resume the most-recent session
 *  - resume "<id>"                            → resume that specific session
 *      (the id need not exist yet — it then doubles as "create + persist here",
 *       so a later `--resume <id>` picks the conversation back up)
 *
 * Persistence is intentionally OFF unless a resume/continue/persist intent is
 * present, so a plain one-shot `cc agent -p "..."` writes nothing to disk.
 *
 * `--ephemeral` forces persistence OFF regardless of the above: a resume id
 * still REPLAYS prior history into context, but nothing new is written — the
 * deterministic-CI shape ("read context, leave no trace").
 *
 * @param {object} options { resume, continueSession, sessionId, persistSession, ephemeral }
 * @param {object} store   { getLastSessionId }  (injection seam)
 * @param {string} fallbackId  used when nothing is being resumed
 * @returns {{ sessionId:string, resumeId:string|null, persist:boolean, wantLatest:boolean }}
 */
export function resolveHeadlessSession(options = {}, store = {}, fallbackId) {
  const { resume, continueSession, sessionId, persistSession, ephemeral } =
    options;
  const wantLatest = continueSession === true || resume === true;
  let resumeId = null;
  if (wantLatest) {
    resumeId =
      (typeof store.getLastSessionId === "function" &&
        store.getLastSessionId()) ||
      null;
  } else if (typeof resume === "string" && resume.trim()) {
    resumeId = resume.trim();
  }
  const persist =
    ephemeral === true
      ? false
      : persistSession === true || resumeId != null || wantLatest;
  const id = resumeId || sessionId || fallbackId;
  return { sessionId: id, resumeId, persist, wantLatest };
}

/**
 * Apply `--fork-session`: when a session has been resolved (resume/continue) and
 * a fork is requested, branch its JSONL transcript into a NEW id so the original
 * stays untouched (Claude-Code `--fork-session` parity). The copy carries the
 * full prior history, so a later `--resume <newId>` replays the whole branch.
 *
 * Returns the id to use downstream + the source (`forkedFrom`), or the original
 * id unchanged with `missing:true` when there is no transcript to fork. Pure
 * apart from the injected store's side effect; both `sessionExists`/`forkSession`
 * are injection seams so this is unit-testable without disk.
 *
 * @param {{forkSession?:boolean, sessionId?:string|null}} opts
 * @param {{sessionExists?:Function, forkSession?:Function}} store
 * @returns {{ sessionId:string|null, forkedFrom:string|null, missing:boolean }}
 */
export function applyForkSession(opts = {}, store = {}) {
  const want = opts.forkSession === true;
  const id = opts.sessionId || null;
  if (!want || !id) return { sessionId: id, forkedFrom: null, missing: false };
  if (typeof store.sessionExists === "function" && !store.sessionExists(id)) {
    return { sessionId: id, forkedFrom: null, missing: true };
  }
  const newId =
    typeof store.forkSession === "function" ? store.forkSession(id) : null;
  if (!newId) return { sessionId: id, forkedFrom: null, missing: false };
  return { sessionId: newId, forkedFrom: id, missing: false };
}

/**
 * Run a single headless agentic turn.
 *
 * @param {object} options
 * @param {string} options.prompt              The task/prompt (required).
 * @param {string} [options.model]
 * @param {string} [options.provider]
 * @param {string} [options.baseUrl]
 * @param {string} [options.apiKey]
 * @param {string} [options.outputFormat="text"]
 * @param {string} [options.permissionMode="default"]
 * @param {string[]} [options.allowedTools]
 * @param {string[]} [options.disallowedTools]
 * @param {number} [options.maxTurns]          Cap on agent loop iterations.
 * @param {string} [options.cwd]
 * @param {string[]} [options.additionalDirectories] Extra workspace roots
 *                                             (--add-dir): absolute dirs the
 *                                             agent may read/search/edit.
 * @param {string|boolean} [options.resume]    Resume a session: "<id>", or true
 *                                             (no id) → most-recent session.
 * @param {boolean} [options.continueSession]  Resume the most-recent session.
 * @param {boolean} [options.persistSession]   Force persistence without resume.
 * @param {boolean} [options.autoCheckpoint]   Snapshot the work tree before each
 *                                             mutating tool (git engine only).
 * @param {boolean} [options.expandFileRefs=true] Expand `@path` file references
 *                                             in the prompt into context blocks.
 * @param {object} [deps]                       Injection seam for tests.
 * @returns {Promise<{ exitCode:number, result:string, isError:boolean }>}
 */
export async function runAgentHeadless(options = {}, deps = {}) {
  const prompt = (options.prompt || "").trim();
  if (!prompt) {
    throw new Error(
      "runAgentHeadless requires a non-empty prompt (use -p, a positional arg, or pipe stdin).",
    );
  }

  const outputFormat = options.outputFormat || "text";
  if (!VALID_OUTPUT_FORMATS.includes(outputFormat)) {
    throw new Error(
      `Invalid --output-format "${outputFormat}". Expected one of: ${VALID_OUTPUT_FORMATS.join(", ")}`,
    );
  }

  // `let` (not const): a custom-command macro's `model:` frontmatter may
  // override it below (when the user passed no explicit --model), mirroring
  // `cc command run`.
  let model = options.model || "qwen2.5:7b";
  const provider = options.provider || "ollama";
  const baseUrl = options.baseUrl || "http://localhost:11434";
  const apiKey = options.apiKey || null;
  const cwd = options.cwd || process.cwd();
  // Extra workspace roots (--add-dir). Resolved/validated by the caller; we
  // just normalize to a clean string[] here.
  const additionalDirectories = Array.isArray(options.additionalDirectories)
    ? options.additionalDirectories.filter(Boolean)
    : [];

  // .claude/settings.json permission rules (deny > ask > allow). A `deny` hard-
  // blocks, an `allow` pre-authorizes (so a safe op isn't fail-closed headless),
  // an `ask` falls closed (no human to confirm in headless). No file → null →
  // every existing risk-tier / shell-policy layer runs unchanged.
  let permissionRules = options.permissionRules || null;
  let managedSettings = null;
  try {
    const { loadSettings, applyManagedPermissionPolicy } =
      await import("../lib/settings-loader.cjs");
    const loaded = loadSettings({
      cwd,
      settingsFile: options.settingsFile,
      managedSettingsFile: options.managedSettingsFile,
    });
    managedSettings = loaded.managed;
    if (!permissionRules) {
      const total =
        loaded.rules.allow.length +
        loaded.rules.ask.length +
        loaded.rules.deny.length;
      permissionRules = total > 0 ? loaded.rules : null;
    } else if (managedSettings) {
      permissionRules = applyManagedPermissionPolicy(
        permissionRules,
        managedSettings,
      );
    }
  } catch (error) {
    if (error?.code === "CC_MANAGED_SETTINGS_INVALID") throw error;
    // Preserve caller-provided rules; absent settings keep legacy behavior.
  }

  // .claude/settings.json `hooks` block — decision-capable PreToolUse/
  // PostToolUse hooks (see settings-hooks/hook-runner). null = no hooks.
  let settingsHooks = options.settingsHooks || null;
  if (!settingsHooks) {
    try {
      const { loadHooks, projectHookTrustNotice } =
        await import("../lib/settings-hooks.cjs");
      const loaded = loadHooks({ cwd, settingsFile: options.settingsFile });
      // Fold in installed plugins' hooks/hooks.json (Phase 3.3c) — plugins ADD
      // to the user's settings hooks, never replace them.
      const { mergePluginHooks } =
        await import("../lib/plugin-runtime/hooks.js");
      const effectiveHooks = mergePluginHooks(loaded.hooks, { cwd });
      settingsHooks =
        effectiveHooks && Object.keys(effectiveHooks).length > 0
          ? effectiveHooks
          : null;
      // First-run trust notice for an untrusted/cloned repo's shell-running
      // hooks (Claude-Code 2.1.195 parity). Best-effort, stderr-only.
      try {
        const notice = projectHookTrustNotice({
          cwd,
          settingsFile: options.settingsFile,
        });
        if (notice) process.stderr.write(notice + "\n");
      } catch {
        /* trust notice is best-effort */
      }
    } catch {
      settingsHooks = null; // fail-open
    }
  }

  // Put trusted plugins' bin/ executables on PATH for this headless run (Phase
  // 3.3n) so run_shell can invoke them by name. Trust-gated. The process exits
  // at the end of the run, so no explicit restore is needed.
  try {
    const { applyPluginBinPath } = await import("../lib/plugin-runtime/bin.js");
    applyPluginBinPath({ cwd });
  } catch {
    /* best-effort — plugin bin PATH never blocks a headless run */
  }

  // Apply trusted plugins' default env vars for this run (Phase 3.3o) — only for
  // keys not already set; the process exits at the end so no restore is needed.
  try {
    const { applyPluginSettingsEnv } =
      await import("../lib/plugin-runtime/settings.js");
    applyPluginSettingsEnv({ cwd });
  } catch {
    /* best-effort — plugin settings never block a headless run */
  }

  // autoMode.classifyAllShell (Claude-Code 2.1.193): route the built-in
  // verification allowlist through the shell-policy classifier instead of
  // fast-pathing it. Explicit option wins; otherwise read settings.json.
  let classifyAllShell = options.classifyAllShell || false;
  if (!classifyAllShell) {
    try {
      const { readBooleanSetting } = await import("../lib/settings-loader.cjs");
      classifyAllShell =
        readBooleanSetting("autoMode.classifyAllShell", {
          cwd,
          settingsFile: options.settingsFile,
        }) === true;
    } catch {
      classifyAllShell = false; // fail-open
    }
  }

  const runLoop = deps.agentLoop || coreAgentLoop;
  const doBootstrap = deps.bootstrap || bootstrap;
  const getApprovalGate =
    deps.getApprovalGate ||
    (async () => {
      const m = await import("../lib/session-core-singletons.js");
      return m.getApprovalGate();
    });
  // stdout carries the machine-consumable payload; stderr carries the human
  // trace so `cc agent -p ... > out.txt` keeps `out.txt` clean.
  const writeOut = deps.writeOut || ((s) => process.stdout.write(s));
  const writeErr = deps.writeErr || ((s) => process.stderr.write(s));
  // Only when we own the real stdout/stderr (no injected seams = production,
  // not tests): guard against a downstream `| head` closing the pipe, which
  // would otherwise crash with an unhandled EPIPE. Idempotent across calls.
  if (!deps.writeOut && !deps.writeErr) {
    installPipeSafety();
  }
  // Session persistence seam (file-based JSONL; DB-free, like the rest of
  // headless). Defaults to the real store; tests inject fakes.
  const store = {
    sessionExists: deps.sessionExists || jsonlSessionExists,
    rebuildMessages: deps.rebuildMessages || jsonlRebuildMessages,
    startSession: deps.startSession || jsonlStartSession,
    appendUserMessage: deps.appendUserMessage || jsonlAppendUserMessage,
    appendAssistantMessage:
      deps.appendAssistantMessage || jsonlAppendAssistantMessage,
    appendTokenUsage: deps.appendTokenUsage || jsonlAppendTokenUsage,
    appendToolCallCompact:
      deps.appendToolCallCompact || jsonlAppendToolCallCompact,
    appendCompactEvent: deps.appendCompactEvent || jsonlAppendCompactEvent,
    appendEvent: deps.appendEvent || jsonlAppendEvent,
    readEvents: deps.readEvents || jsonlReadEvents,
    getLastSessionId: deps.getLastSessionId || jsonlGetLastSessionId,
    verifySession: deps.verifySession || jsonlVerifySession,
  };
  const isStream = outputFormat === "stream-json";
  const isJson = outputFormat === "json";
  const isText = outputFormat === "text";

  // ── Headless `/config` directive (Claude-Code 2.1.181: /config in -p mode) ──
  // A leading `/config …` prompt is a one-shot config get/set/show, not a task
  // for the LLM — handled before bootstrap/session/model so it never spends a
  // turn or touches a provider. Mirrors the REPL `/config`; secrets stay masked.
  if (isHeadlessConfigCommand(prompt)) {
    const cm = await import("../lib/config-manager.js");
    const { getConfigPath } = await import("../lib/paths.js");
    const { runConfigDirective } =
      await import("../lib/headless-config-command.js");
    const { text, isError } = runConfigDirective(prompt, {
      configManager: cm,
      getConfigPath,
    });
    const subtype = isError ? "error" : "success";
    if (isStream) {
      writeOut(
        JSON.stringify({
          type: "result",
          subtype,
          is_error: isError,
          result: text,
        }) + "\n",
      );
    } else if (isJson) {
      writeOut(
        JSON.stringify(
          buildResultEnvelope({
            subtype,
            isError,
            result: text,
            sessionId: null,
            toolCalls: [],
            usage: null,
            numTurns: 0,
            durationMs: 0,
          }),
        ) + "\n",
      );
    } else {
      writeOut(text + (text.endsWith("\n") ? "" : "\n"));
    }
    return { exitCode: isError ? 1 : 0, result: text, isError };
  }

  // ── Custom slash-command macros (Claude-Code parity: a .claude/commands/*
  // command runs in `-p` mode too, not just the interactive REPL). A leading
  // `/name …` that resolves to a user/project command is expanded into its
  // prompt template ($ARGUMENTS / $1.. + !`bang` + @file) before the turn; an
  // unknown `/...` (or plain text) is left untouched so it reaches the LLM
  // verbatim. expandCommand already runs @file expansion, so the @-ref pass
  // below is skipped when a macro matched. Opt out with options.slashMacros:false.
  let userContent = prompt;
  let slashExpanded = false;
  // A matched command's `allowed-tools:` frontmatter scopes the run (parsed
  // below into enabledToolNames) the same way `cc command run` does.
  let macroAllowedTools = null;
  if (options.slashMacros !== false && prompt.startsWith("/")) {
    try {
      const doMacro =
        deps.resolveSlashMacro ||
        (await import("../repl/slash-macro.js")).resolveSlashMacro;
      const macro = await doMacro(prompt, { cwd });
      if (macro && macro.matched) {
        userContent = macro.promptText;
        slashExpanded = true;
        for (const w of macro.warnings || []) {
          writeErr(`  /${macro.name}: ${w}\n`);
        }
        writeErr(`  command: /${macro.name} [${macro.scope}]\n`);
        // Frontmatter `model:` / `allowed-tools:` scope the run exactly like
        // `cc command run` — but an explicit --model / --allowed-tools still
        // wins (those arrive as a set options.model / options.allowedTools).
        if (macro.model && !options.model) {
          model = macro.model;
          writeErr(`  command: model → ${model}\n`);
          try {
            const { maybeWarnDeprecatedModel } =
              await import("../lib/model-deprecation.js");
            maybeWarnDeprecatedModel({ model });
          } catch {
            // deprecation notice is best-effort
          }
        }
        if (macro.allowedTools && !options.allowedTools) {
          macroAllowedTools = parseToolList(macro.allowedTools);
        }
      }
    } catch {
      // macro resolution is best-effort — fall back to the literal prompt
    }
  }

  // ── Expand @file references in the prompt (Claude-Code parity) ─────────
  // `@path/to/file` tokens are augmented with the referenced file contents (or
  // a dir listing) so `cc agent -p "review @src/x.js"` works without a manual
  // cat-pipe. Opt out with `--no-file-refs` (options.expandFileRefs === false).
  // Skipped when a slash macro already expanded (expandCommand ran @refs).
  if (!slashExpanded && options.expandFileRefs !== false) {
    const doExpand = deps.expandFileRefs || expandFileRefsAsync;
    const expanded = await doExpand(prompt, { cwd });
    userContent = expanded.prompt;
    // Warnings (typo'd paths, unreadable files) go to stderr in every output
    // format so stdout stays a clean machine payload.
    for (const w of expanded.warnings) {
      writeErr(`  @ref: ${w}\n`);
    }
  }

  // ── Permission + tool resolution ──────────────────────────────────────
  if (managedSettings) {
    const { assertManagedPermissionMode } =
      await import("../lib/settings-loader.cjs");
    assertManagedPermissionMode(options.permissionMode, managedSettings);
  }
  const perm = resolvePermissionMode(options.permissionMode);
  const enabledToolNames = resolveEnabledTools({
    // An explicit --allowed-tools wins; otherwise a matched command's
    // `allowed-tools:` frontmatter scopes the run (null when neither applies).
    allowedTools: options.allowedTools || macroAllowedTools,
    readOnly: perm.readOnly,
  });
  const disabledTools = options.disallowedTools || [];

  // ── Best-effort runtime bootstrap (DB optional, like startAgentRepl) ───
  let db = null;
  try {
    // Bootstrap logs db/config diagnostics via console.info (→ stdout); divert
    // to stderr so text/JSON/NDJSON stdout payloads stay clean.
    const ctx = await withQuietStdout(() => doBootstrap({ verbose: false }));
    db = ctx.db || null;
  } catch {
    // Continue without DB — static-prompt fallback.
  }

  // ── Resolve session continuity (--resume / --continue) ─────────────────
  const { sessionId, resumeId, persist } = resolveHeadlessSession(
    options,
    store,
    `headless-${Date.now()}-${process.pid}`,
  );
  if (options.continueSession === true && !resumeId && isText) {
    writeErr("No previous session to continue; starting a new one.\n");
  }

  // Machine-readable modes (`--output-format json` / `stream-json`) must ALWAYS
  // end with a terminal result envelope — a consumer parsing stdout otherwise
  // gets nothing and can't tell success from failure. Several setup-phase error
  // paths below early-return BEFORE the main loop's try/catch envelope (and
  // before `system/init`), so route them through this so stdout is never empty.
  // No-op in text mode (those paths already writeErr a human message).
  const emitHeadlessError = (resultMsg) => {
    if (isStream) {
      writeOut(
        JSON.stringify({
          type: "result",
          subtype: "error",
          is_error: true,
          error: resultMsg,
        }) + "\n",
      );
    } else if (isJson) {
      writeOut(
        JSON.stringify(
          buildResultEnvelope({
            subtype: "error",
            isError: true,
            result: resultMsg,
            sessionId,
            toolCalls: [],
            usage: {},
            numTurns: 0,
            durationMs: 0,
          }),
        ) + "\n",
      );
    }
  };

  // Load prior conversation when resuming an existing session. The fresh
  // system prompt always leads; we drop any persisted system turns so it is
  // never duplicated.
  let history = [];
  if (resumeId && store.sessionExists(resumeId)) {
    // Tamper gate: a broken transcript hash chain means the file was edited
    // outside the store. Headless runs fail closed — a tampered transcript is
    // never silently rebuilt into trusted model context. Escape hatch:
    // CC_ALLOW_TAMPERED_RESUME=1 resumes with a stderr warning.
    let trust = null;
    try {
      trust = store.verifySession(resumeId);
    } catch {
      trust = null; // verification unavailable → keep legacy behaviour
    }
    if (trust && trust.status === "tampered") {
      if (process.env.CC_ALLOW_TAMPERED_RESUME !== "1") {
        const msg =
          `Session ${resumeId} transcript failed integrity verification (${trust.reason}` +
          (trust.firstInvalidLine ? ` at line ${trust.firstInvalidLine}` : "") +
          `). Refusing to resume tampered context; run 'cc session verify ${resumeId}', or set CC_ALLOW_TAMPERED_RESUME=1 to override.`;
        emitHeadlessError(msg);
        writeErr(msg + "\n");
        return { exitCode: 1, result: msg, isError: true };
      }
      writeErr(
        `⚠ Resuming a TAMPERED transcript (${trust.reason}) — restored context is untrusted.\n`,
      );
    }
    try {
      history = (store.rebuildMessages(resumeId) || []).filter(
        (m) => m && m.role !== "system",
      );
    } catch {
      history = [];
    }
  }

  // ── P0-2: crash-safe side-effect ledger ────────────────────────────────
  // Dangerous tools (file writes, opaque shell, git push, publish/schedule/
  // notify/browser actions) are recorded prepare→start→commit|fail and the
  // full snapshot persisted before the effect settles, so a worker killed
  // mid-flight does NOT blindly replay an effect that may already have landed.
  // Only active when persisting (an ephemeral/one-shot run can't be resumed);
  // the byte-for-byte default path is untouched when no dangerous tool runs.
  const sideEffectRunNonce = String(deps.now ? deps.now() : Date.now());
  let sideEffectLedger = new SideEffectLedger({ clock: deps.now || null });
  let sideEffectSeq = 0;
  let currentSideEffectOpId = null;
  let resumeSideEffectContext = null;
  let resumeAsyncHookContext = null;
  const persistSideEffectLedger = () => {
    if (!persist) return;
    try {
      store.appendEvent(
        sessionId,
        SIDE_EFFECT_LEDGER_EVENT,
        sideEffectLedger.toJSON(),
      );
    } catch {
      // best-effort — never fail the run over ledger persistence
    }
  };
  if (persist) {
    try {
      const events = store.readEvents(sessionId) || [];
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i];
        if (
          e &&
          e.type === SIDE_EFFECT_LEDGER_EVENT &&
          e.data &&
          Array.isArray(e.data.ops)
        ) {
          sideEffectLedger = SideEffectLedger.fromJSON(e.data, {
            clock: deps.now || null,
          });
          break;
        }
      }
    } catch {
      // fresh ledger — best effort
    }
    // On resume, surface any operation that was in flight when the prior run
    // died: its outcome is UNKNOWN, so the model is told to VERIFY before any
    // replay rather than silently re-issue an irreversible effect.
    if (resumeId) {
      try {
        const plan = reconcileSideEffects(sideEffectLedger);
        if (plan.inspect.length > 0) {
          const lines = plan.plans
            .filter((p) => p.action === "inspect")
            .map((p) => {
              const op = sideEffectLedger.get(p.opId);
              const kind = op?.kind || "unknown";
              const key = op?.key ? ` (${op.key})` : "";
              return `  • [${kind}]${key} — ${p.reason}`;
            });
          resumeSideEffectContext =
            "Recovery notice — the previous run was interrupted while these " +
            "irreversible operations were in flight; their outcome is UNKNOWN. " +
            "Do NOT blindly re-run them. Verify whether each already took " +
            "effect before repeating it, and ask the user if unsure:\n" +
            lines.join("\n");
          writeErr(
            `⚠ ${plan.inspect.length} interrupted side-effect(s) need verification before replay (resume ${resumeId}).\n`,
          );
        }
      } catch {
        resumeSideEffectContext = null;
      }
      // On resume, recover any async-hook REWAKE (a background check that opted
      // in and FAILED) that the previous run parked but died before draining —
      // surface it to the model instead of silently swallowing the failure. The
      // take also clears the bucket so it isn't replayed on a later resume.
      try {
        const { takePending } = await import("../lib/async-hook-queue.cjs");
        const recovered = takePending(
          { sessionId, now: deps.now ? deps.now() : Date.now() },
          deps.asyncHookQueuePath || undefined,
          deps.asyncHookQueueFs || undefined,
        );
        if (Array.isArray(recovered) && recovered.length > 0) {
          const lines = recovered.map((r) => {
            const detail = r.error || r.additionalContext || "failed";
            return `  • ${r.command} — ${detail}`;
          });
          resumeAsyncHookContext =
            "Recovery notice — the previous run was interrupted after these " +
            "background (async) hook checks FAILED but before you were told. " +
            "Review each failure and decide whether it still needs action:\n" +
            lines.join("\n");
          writeErr(
            `⚠ Recovered ${recovered.length} failed async-hook check(s) from interrupted run (resume ${resumeId}).\n`,
          );
        }
      } catch {
        resumeAsyncHookContext = null;
      }
    }
  }

  // ── Wire the persistent ApprovalGate with our non-interactive confirmer
  // and force the session-policy tier dictated by --permission-mode. ──────
  let approvalGate = null;
  try {
    approvalGate = await getApprovalGate();
    if (approvalGate && (options.permissionMode || "default") === "auto") {
      // autoMode.decisions: user-configured riskLevel → allow/ask/deny
      // classifier. Only wrap when settings actually customize the map so the
      // unconfigured auto path keeps the byte-identical trusted-tier mapping.
      try {
        const {
          loadAutoModeConfig,
          resolveAutoModeDecisions,
          createAutoModeApprovalGate,
        } = await import("../lib/auto-mode-config.js");
        const autoConfig = loadAutoModeConfig({
          cwd,
          settingsFile: options.settingsFile,
        });
        const resolved = resolveAutoModeDecisions(autoConfig.effective);
        if (resolved.customized) {
          approvalGate = createAutoModeApprovalGate(approvalGate, resolved);
        }
      } catch {
        // fail to the default trusted mapping — never block the run
      }
    }
    if (approvalGate) {
      if (typeof approvalGate.setSessionPolicy === "function") {
        approvalGate.setSessionPolicy(sessionId, perm.sessionPolicy);
      }
      if (typeof approvalGate.setConfirmer === "function") {
        approvalGate.setConfirmer(perm.confirmer);
      }
    }
  } catch {
    approvalGate = null;
  }

  const budget = Number.isFinite(options.maxTurns)
    ? new IterationBudget({ limit: Math.max(1, Math.floor(options.maxTurns)) })
    : new IterationBudget();

  // Effective system prompt: built-in base, optionally replaced by
  // --system-prompt and/or extended by --append-system-prompt.
  // --output-style (or settings.json `outputStyle`) → a persona appended to the
  // system prompt. Resolved best-effort; a missing style is ignored with a warn.
  let outputStyleBody = null;
  try {
    const { resolveOutputStyle } = await import("../lib/output-styles.js");
    const st = resolveOutputStyle(options.outputStyle, cwd);
    if (st && st.missing && options.outputStyle) {
      writeErr(`  output-style: unknown style "${options.outputStyle}"\n`);
    } else if (st && st.body) {
      outputStyleBody = st.body;
    }
  } catch {
    outputStyleBody = null;
  }

  // Large-monorepo context lever: `instructionExcludes` (settings.json or an
  // explicit caller/SDK option) suppresses cc.md/CLAUDE.md/AGENTS.md, path-scoped
  // rules, and @imports that resolve into legacy/vendor/generated subtrees.
  // Explicit option wins; otherwise union across the layered settings files.
  let instructionExcludes = Array.isArray(options.instructionExcludes)
    ? options.instructionExcludes
    : null;
  if (!instructionExcludes) {
    try {
      const { readStringArraySetting } =
        await import("../lib/settings-loader.cjs");
      const fromSettings = readStringArraySetting("instructionExcludes", {
        cwd,
        settingsFile: options.settingsFile,
      });
      if (fromSettings && fromSettings.length)
        instructionExcludes = fromSettings;
    } catch {
      instructionExcludes = null; // fail-open
    }
  }

  // --no-project-memory (options.projectMemory === false): lean prompt — skip
  // rules.md (in buildSystemPrompt) + the cc.md/CLAUDE.md block. Absent flag
  // (undefined) leaves both paths byte-identical.
  const _leanNoProjectMemory = options.projectMemory === false;
  let _loadedInstructions = null;
  const systemContent = composeSystemPrompt(
    buildSystemPrompt(cwd, {
      additionalDirectories,
      projectMemory: options.projectMemory,
    }),
    {
      systemPrompt: options.systemPrompt,
      appendSystemPrompt: options.appendSystemPrompt,
      outputStyle: outputStyleBody,
      instructionExcludes,
      projectMemory: _leanNoProjectMemory ? false : undefined,
      onInstructionsLoaded: (loaded) => {
        _loadedInstructions = loaded;
      },
    },
  );

  // settings.json UserPromptSubmit hooks. block → abort the run; context → inject.
  if (settingsHooks) {
    try {
      const { runUserPromptSubmitHooks } =
        await import("../lib/settings-hook-events.cjs");
      const ups = runUserPromptSubmitHooks(settingsHooks, {
        prompt: userContent,
        cwd,
        sessionId,
      });
      if (ups.blocked) {
        writeErr(
          `[hook] prompt blocked${ups.reason ? ": " + ups.reason : ""}\n`,
        );
        const reason = ups.reason || "blocked by UserPromptSubmit hook";
        emitHeadlessError(reason);
        return { exitCode: 2, result: reason, isError: true };
      }
      if (ups.additionalContext) {
        userContent += `\n\n[hook context]\n${ups.additionalContext}`;
      }
    } catch (_err) {
      // settings hook dispatch is best-effort
    }
  }

  // settings.json InstructionsLoaded hooks (observe-only): the project-instruction
  // block was just composed — fire with the EXACT loaded file set so a hook can
  // audit which cc.md/CLAUDE.md/AGENTS.md/rules are authoritative this session.
  // Any emitted context is injected like SessionStart's. Best-effort; no-op when
  // project memory is off (no loaded set) or no hook is registered.
  let instructionsLoadedContext = null;
  if (settingsHooks && _loadedInstructions) {
    try {
      const { runInstructionsLoadedHooks } =
        await import("../lib/settings-hook-events.cjs");
      instructionsLoadedContext = runInstructionsLoadedHooks(settingsHooks, {
        files: _loadedInstructions.files,
        cwd,
        sessionId,
      }).additionalContext;
    } catch (_err) {
      instructionsLoadedContext = null;
    }
  }

  // settings.json SessionStart hooks → inject session context (observe-only).
  let sessionStartContext = null;
  if (settingsHooks) {
    try {
      const { runSessionStartHooks } =
        await import("../lib/settings-hook-events.cjs");
      sessionStartContext = runSessionStartHooks(settingsHooks, {
        source: resumeId ? "resume" : "startup",
        cwd,
        sessionId,
      }).additionalContext;
    } catch (_err) {
      sessionStartContext = null;
    }
  }

  // settings.json SessionResume hooks: fire when a persisted session's prior
  // history is actually being replayed (--resume / --continue with real
  // history), distinct from SessionStart (which also fires on a fresh startup).
  // A SessionResume hook can react to "we're picking an existing conversation
  // back up" — e.g. re-run a workspace sanity check. Observe-only, best-effort.
  if (settingsHooks && resumeId && history.length > 0) {
    try {
      const { runObserveHooks } =
        await import("../lib/settings-hook-events.cjs");
      runObserveHooks(
        settingsHooks,
        "SessionResume",
        {
          session_id: sessionId,
          resumed_from: resumeId,
          history_messages: history.length,
          cwd,
        },
        { cwd },
      );
    } catch (_err) {
      // observe-only
    }
  }

  // --image <path>: attach vision input to the user turn. buildUserContent
  // returns the plain string when there are no images, so text-only runs are
  // byte-for-byte unchanged; with images it builds an OpenAI-style multimodal
  // content array (agent-core converts it per-provider for ollama/anthropic).
  const userMessageContent = buildUserContent(userContent, options.images);

  // Merge consecutive same-role turns so a resumed session whose previous run
  // produced NO assistant response (history ends with a bare `user` turn) does
  // not yield two adjacent `user` messages — which Anthropic/Bedrock reject as
  // "roles must alternate", failing the resume (Claude Code 2.1.187 parity).
  // No-op on a healthy alternating transcript.
  const messages = mergeConsecutiveMessages([
    { role: "system", content: systemContent },
    ...(instructionsLoadedContext
      ? [{ role: "system", content: instructionsLoadedContext }]
      : []),
    ...(sessionStartContext
      ? [{ role: "system", content: sessionStartContext }]
      : []),
    ...(resumeSideEffectContext
      ? [{ role: "system", content: resumeSideEffectContext }]
      : []),
    ...(resumeAsyncHookContext
      ? [{ role: "system", content: resumeAsyncHookContext }]
      : []),
    ...history,
    { role: "user", content: userMessageContent },
  ]);

  // Persist the user turn up front (best-effort) so a session is recoverable
  // even if the run crashes mid-loop. startSession is append-safe: only seed
  // the header when the file does not yet exist.
  if (persist) {
    try {
      if (!store.sessionExists(sessionId)) {
        store.startSession(sessionId, {
          title: prompt.slice(0, 60),
          provider,
          model,
        });
      }
      // Persist the expanded content so a resumed session faithfully replays
      // what the model actually saw (the file snapshot, not just the @token).
      store.appendUserMessage(sessionId, userContent);
    } catch {
      // Persistence is best-effort — never fail the run over it.
    }
  }

  // --mcp-config: connect ad-hoc MCP servers for this run and expose their
  // tools to the LLM (Claude-Code parity). Connection is best-effort — a server
  // that fails to connect is logged to stderr and contributes no tools; a
  // missing/empty config file fails fast (the user explicitly asked for MCP).
  // Combine the ad-hoc --mcp-config file with the servers registered via
  // `cc mcp add` (their --auto-connect ones) into ONE client, exposing every
  // tool to the LLM. A bad --mcp-config file fails fast; registered connects
  // are best-effort. --no-mcp disables the registered set (ad-hoc still loads).
  let mcp = null;
  {
    const doResolve = deps.resolveAgentMcp || resolveAgentMcp;
    try {
      mcp = await doResolve(
        {
          mcpConfigPath: options.mcpConfig || null,
          managedSettingsFile: options.managedSettingsFile,
          db: db?.getDatabase?.() || null,
          includeRegistered: options.useRegisteredMcp !== false,
          // --strict-mcp-config: use ONLY the --mcp-config servers, ignoring
          // registered (cc mcp add) + IDE bridge auto-discovery.
          strict: options.strictMcpConfig === true,
          ide: options.ide,
          pdh: options.pdh,
          jetbrains: options.jetbrains,
          cwd: options.cwd || process.cwd(),
          // advertise the session id to spawned stdio MCP servers
          sessionId,
        },
        {
          writeErr,
          loadMcpConfig: deps.loadMcpConfig,
          loadRegisteredMcp: deps.loadRegisteredMcp,
          loadIdeMcp: deps.loadIdeMcp,
          loadJetbrainsMcp: deps.loadJetbrainsMcp,
        },
      );
      if (mcp && isText) {
        for (const c of mcp.connected) {
          writeErr(`  mcp: ${c.server} (${c.tools} tools)\n`);
        }
      }
      // MCP tool search (context scaling): when the tool schemas would eat a
      // significant share of the context window, defer them behind the
      // internal tool_search tool. Below-threshold / disabled → no-op, the
      // wiring object is untouched.
      if (mcp) {
        try {
          (deps.maybeApplyToolSearch || maybeApplyToolSearch)(mcp, {
            model,
            provider,
            cwd: options.cwd || process.cwd(),
            writeErr: isText ? writeErr : () => {},
          });
        } catch {
          // best-effort — full schemas still work without deferral
        }
      }
    } catch (err) {
      writeErr(`Error: ${err.message}\n`);
      emitHeadlessError(err.message);
      // Bad --mcp-config / MCP wiring is a CONFIG error, not a run failure.
      return {
        exitCode: HEADLESS_EXIT_CODES.CONFIG_ERROR,
        result: err.message,
        isError: true,
      };
    }
  }

  // IDE live context (Claude-Code parity): when an IDE bridge is connected,
  // share the editor's selection/active file/open tabs with this turn. Appended
  // to the in-flight user message only — AFTER persistence — so a resumed
  // session replays the prompt, not a stale editor snapshot. Best-effort with
  // a short timeout; CC_IDE_CONTEXT=0 disables.
  try {
    const { buildIdePromptContext, appendTextToContent, expandIdeMentions } =
      await import("../lib/ide-context.js");
    const last = messages[messages.length - 1];
    const ideCtx = await (deps.buildIdePromptContext || buildIdePromptContext)(
      mcp,
    );
    if (ideCtx) {
      last.content = appendTextToContent(last.content, ideCtx);
    }
    // Explicit @selection / @diagnostics mentions in the user's prompt
    // (Claude-Code parity). Scan the ORIGINAL prompt so injected file-ref
    // blocks can't spoof a mention; append the expansion to the in-flight
    // message only (ephemeral, like the ambient block above).
    const mentioned = await expandIdeMentions(prompt, mcp);
    for (const w of mentioned.warnings) writeErr(`  @ide: ${w}\n`);
    if (mentioned.block) {
      last.content = appendTextToContent(last.content, mentioned.block);
    }
  } catch {
    // IDE context is optional polish — never fail the run over it.
  }

  // --permission-prompt-tool: route every CONFIRM-tier approval to an MCP tool
  // (loaded via --mcp-config) instead of headless fail-closed. Overrides the
  // permission-mode confirmer on the gate for this session.
  if (options.permissionPromptTool) {
    let ppt;
    try {
      ppt = resolvePermissionPromptTool(mcp, options.permissionPromptTool);
    } catch (err) {
      writeErr(`Error: ${err.message}\n`);
      if (mcp?.mcpClient) await mcp.mcpClient.disconnectAll().catch(() => {});
      emitHeadlessError(err.message);
      // A bad --permission-prompt-tool reference is a CONFIG error.
      return {
        exitCode: HEADLESS_EXIT_CODES.CONFIG_ERROR,
        result: err.message,
        isError: true,
      };
    }
    if (approvalGate && typeof approvalGate.setConfirmer === "function") {
      approvalGate.setConfirmer(
        makePermissionPromptConfirmer({
          mcpClient: mcp.mcpClient,
          server: ppt.server,
          tool: ppt.tool,
          writeErr,
          isText,
        }),
      );
    }
  }

  // --remote-control: route CONFIRM-tier approvals to paired mobile/web
  // devices (第四阶段 #2). Self-hosts a lightweight WS server + approval
  // bridge for THIS run's session, prints the pairing URI/QR to stderr, and
  // installs the remote confirmer on the gate (same override point as
  // --permission-prompt-tool; that flag wins when both are given since it is
  // installed above and this block skips). Fail-closed on timeout.
  let _remoteApproval = null;
  if (options.remoteControl && !options.permissionPromptTool) {
    try {
      const { startHeadlessRemoteApproval } =
        await import("../lib/remote-approval-bridge.js");
      _remoteApproval = await (
        deps.startHeadlessRemoteApproval || startHeadlessRemoteApproval
      )({
        agentSessionId: sessionId,
        writeErr,
        isText,
      });
      if (approvalGate && typeof approvalGate.setConfirmer === "function") {
        approvalGate.setConfirmer(_remoteApproval.confirmer);
      }
    } catch (err) {
      // Remote approval could not come up → keep headless fail-closed rather
      // than running un-gated; say why so the user can fix pairing.
      writeErr(`  remote-control: unavailable (${err.message})\n`);
      _remoteApproval = null;
    }
  }

  // --otlp <file>: attach an OpenTelemetry recorder so the real agent loop's
  // model/tool/retry spans are captured and exported as OTLP/JSON on exit.
  // Off by default (zero cost) — only built when a path is requested.
  let _otlpRecorder = null;
  if (options.otlp) {
    try {
      const { TelemetryRecorder } =
        await import("../lib/telemetry/span-recorder.js");
      _otlpRecorder = new TelemetryRecorder({ serviceName: "cc-agent" });
    } catch {
      _otlpRecorder = null; // telemetry is best-effort, never blocks the run
    }
  }

  // Async-hook supervisor for headless: without one, `async:true` hooks
  // (PostToolUse / Stop) were silently skipped in `cc agent -p` (they only ran
  // in the REPL). Create one when settings hooks are present so background
  // checks run + get reaped here too. Fire-and-forget; drained after the loop.
  let _hookSupervisor = null;
  if (settingsHooks) {
    try {
      const { AsyncHookSupervisor } =
        await import("../lib/async-hook-supervisor.cjs");
      _hookSupervisor = new AsyncHookSupervisor({
        persistStats: true,
        // Durably park failed-rewake signals keyed by session so a crash before
        // the turn loop drains them doesn't lose the failure — recovered on the
        // next `--resume` (see the resume block above). Only a PERSISTABLE
        // session can be resumed, so the queue follows `persist`; a one-shot /
        // --ephemeral run stays byte-unchanged (no session id → no writes).
        persistQueue: persist,
        sessionId: persist ? sessionId : null,
      });
    } catch {
      _hookSupervisor = null; // async hooks are best-effort
    }
  }

  // Resolve auto-pin (flag > env > config > default-on). Config read is
  // best-effort — a broken config file must not take headless down.
  let _autoPinResolved;
  {
    const { resolveAutoPinOption } = await import("./auto-pin.js");
    let _autoPinCfg;
    try {
      const { loadConfig } = await import("../lib/config-manager.js");
      _autoPinCfg = loadConfig()?.context?.autoPin;
    } catch {
      _autoPinCfg = undefined;
    }
    _autoPinResolved = resolveAutoPinOption({
      flag: options.autoPin === true,
      config: _autoPinCfg,
    });
  }

  const loopOptions = {
    model,
    provider,
    recorder: _otlpRecorder,
    // --otlp-content: opt in to stamping prompt CONTENT onto --otlp spans. Off by
    // default → content stays redacted (agent-core omits it entirely, so default
    // OTLP output is byte-identical). Only meaningful when a recorder is attached.
    otlpIncludeContent: options.otlpContent === true,
    hookSupervisor: _hookSupervisor,
    // Extended thinking (Anthropic; opt-in via --think/--ultrathink). null/off
    // → chatWithTools sends no thinking field. thinkingBudget (--thinking-budget)
    // is the legacy-model budget_tokens override; ignored when thinking is off.
    thinking: options.thinking || null,
    thinkingBudget: options.thinkingBudget || null,
    baseUrl,
    apiKey,
    cwd,
    additionalDirectories,
    sandbox: options.sandbox || null,
    sessionId,
    // Auto-pin (default ON since 2026-07-07): pin the original task through
    // compaction. Precedence: --auto-pin flag > CC_AUTO_PIN ("1"/"0") >
    // config context.autoPin > default on. Falsy → agent-core passes no pin
    // predicate and compaction is byte-identical.
    autoPin: _autoPinResolved,
    autoCheckpoint: options.autoCheckpoint || false,
    checkpointSession: options.checkpointSession || sessionId,
    hookDb: db,
    approvalGate,
    permissionRules,
    settingsHooks,
    // Seed the subagent-contract CEILING with this run's permission mode so a
    // spawned sub-agent inherits/tightens from it (tighten-only): a
    // `--permission-mode bypassPermissions` run can hand a child bypass (→ allow
    // confirmer), a `--permission-mode plan` run clamps children to read-only,
    // while a "default" run resolves children to "default" exactly as before
    // (byte-identical — the previous null ceiling also yielded "default").
    subAgentContract: { permissionMode: options.permissionMode || "default" },
    classifyAllShell,
    enabledToolNames,
    disabledTools,
    iterationBudget: budget,
    // --mcp-config wiring: tool defs for the LLM + dispatch map + live client.
    mcpClient: mcp?.mcpClient || null,
    extraToolDefinitions: mcp?.extraToolDefinitions || undefined,
    externalToolExecutors: mcp?.externalToolExecutors || undefined,
    externalToolDescriptors: mcp?.externalToolDescriptors || undefined,
    // chatFn passthrough lets tests drive the loop deterministically.
    chatFn: deps.chatFn || options.chatFn || undefined,
    signal: options.signal || undefined,
    // Stream-stall hint (Claude-Code 2.1.185): when the connection is alive but
    // the API has gone silent mid-response, a headless run would otherwise look
    // frozen with no feedback. The REPL already surfaces this; mirror it here to
    // stderr — out-of-band for every output format (text answer / json envelope
    // / stream-json NDJSON all go to stdout) so machine consumers are unaffected
    // while a human watching a long `cc agent -p` run learns we're still waiting
    // and, when a hard inactivity timeout is set, when it will auto-retry. Plain
    // text (no chalk) since headless stderr is frequently piped/non-TTY.
    onStall: (ms, timeoutMs) => {
      const silent = Math.round(ms / 1000);
      const retryIn = timeoutMs > ms ? Math.round((timeoutMs - ms) / 1000) : 0;
      const suffix = retryIn > 0 ? ` · will retry in ${retryIn}s` : "";
      writeErr(`  ⏳ waiting for API response (silent ${silent}s)${suffix}…\n`);
    },
  };

  // Goal binding (cc goal, Phase 1). `--goal <id>` binds explicitly; `--goal`
  // with no value (options.goal === true) auto-resolves from active/session.
  // When omitted, headless stays goal-free (no behavior change). Best-effort:
  // a failure here must never fail the run.
  let boundGoalId = null;
  if (options.goal !== undefined && options.goal !== false) {
    try {
      const explicitId = typeof options.goal === "string" ? options.goal : null;
      const { resolveActiveGoal, linkSession } =
        await import("../lib/goal-store.js");
      const goal = (deps.resolveActiveGoal || resolveActiveGoal)({
        explicitId,
        sessionId,
      });
      if (goal) {
        const { goalPrepareCall } = await import("../lib/goal-context.js");
        loopOptions.prepareCall = goalPrepareCall(goal);
        boundGoalId = goal.id;
        // Link the session so a later `--continue`/`--resume` keeps this goal.
        if (explicitId && persist !== false) {
          try {
            linkSession(goal.id, sessionId);
          } catch {
            /* linking is optional polish — never fatal */
          }
        }
      }
    } catch {
      /* goal binding is best-effort — proceed without it */
    }
  }

  // --max-budget-usd: a hard USD spend cap (Claude-Code parity). Accumulates
  // per-call cost from token-usage events and stops the loop before the next
  // paid call once the cap is reached. null → no cap (unchanged behavior).
  const costBudget = options.maxCostUsd
    ? new CostBudget({
        limitUsd: options.maxCostUsd,
        table: options.priceTable,
      })
    : null;

  const startedAt = deps.now ? deps.now() : Date.now();
  const toolCalls = [];
  // Policy denials (blocked tool calls) collected for an end-of-run summary,
  // so a non-interactive run surfaces what got blocked the way the REPL's
  // `/permissions denials` does (Claude-Code 2.1.193 denial reasons).
  const denials = [];
  const usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
  // 用量归因: attributed child-loop usage (spawn_sub_agent / isolated
  // run_skill). Kept OUT of the `usage` accumulator above so the result
  // envelope and the end-of-run aggregate token_usage event keep their
  // long-standing "main loop only" semantics — the attributed records are
  // persisted as their own token_usage events instead (no double count).
  const attributedUsage = [];
  let finalText = "";
  let endReason = "complete";
  let stopForCost = false;

  const emitStream = (obj) => {
    if (isStream) writeOut(JSON.stringify(obj) + "\n");
  };

  // --include-partial-messages: forward live assistant-text deltas as
  // `stream_event` NDJSON lines (Claude-Code parity). Only meaningful for
  // stream-json output, where the agent loop's onToken hook feeds chunks as
  // they arrive from a streaming provider.
  if (isStream && options.includePartialMessages) {
    loopOptions.onToken = (text) =>
      emitStream({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text },
        },
      });
  }

  emitStream({
    type: "system",
    subtype: "init",
    // Deterministic-headless manifest (gap-analysis 2026-07-11): protocol
    // version + persistence + live sources + policy/tool digests so CI can
    // assert the run shape. Mirrors agent-sdk PROTOCOL_VERSION.
    protocol_version: STREAM_PROTOCOL_VERSION,
    session_id: sessionId,
    session_persistence: persist,
    model,
    provider,
    permission_mode: options.permissionMode || "default",
    tools: enabledToolNames,
    tools_hash: computeToolsHash(enabledToolNames),
    policy_digest: computePolicyDigest({
      permissionMode: options.permissionMode,
      allowedTools: options.allowedTools,
      disallowedTools: options.disallowedTools,
      permissionRules,
    }),
    loaded_sources: buildLoadedSources({
      permissionRules,
      settingsHooks,
      mcp: Boolean(mcp),
      enabledToolNames,
    }),
    // True isolation level for tool subprocesses: os-sandbox (bwrap) /
    // container (docker) / policy-only (no sandbox — rules are pre-execution).
    isolation_level: isolationLevel(options.sandbox),
    max_turns: budget.limit,
    resumed_from: resumeId,
    history_messages: history.length,
    additional_directories: additionalDirectories,
    goal_id: boundGoalId,
  });

  // --auto-rewake: after a turn finishes, run the async Stop hooks and, if an
  // `asyncRewake` check FAILED, append its report as a new user turn and re-run
  // the agent to fix it — bounded by `maxRewakes` (default 1). OPT-IN: when off
  // (the default), rewakeBudget is 0 and the loop below runs exactly once, so
  // one-shot `cc agent -p` behavior is byte-for-byte unchanged and no script is
  // surprised by a silent re-run. `_asyncStopHandled` tells the finally the
  // async Stop hooks already fired here so they aren't fired twice.
  const autoRewake = options.autoRewake === true;
  let rewakeBudget = autoRewake
    ? Number.isFinite(options.maxRewakes)
      ? options.maxRewakes
      : 1
    : 0;
  let _asyncStopHandled = false;
  const _settleAsyncStop = async () => {
    if (!settingsHooks || !_hookSupervisor) return { rewakes: [], results: [] };
    const { dispatchAsyncHooks } =
      await import("../lib/settings-hook-events.cjs");
    dispatchAsyncHooks(
      settingsHooks,
      "Stop",
      { reason: endReason, cwd, session_id: sessionId },
      { cwd, supervisor: _hookSupervisor },
    );
    const waitMs = Number.isFinite(options.asyncHookWaitMs)
      ? options.asyncHookWaitMs
      : 5000;
    const started = Date.now();
    while (
      _hookSupervisor.runningCount() > 0 &&
      Date.now() - started < waitMs
    ) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return {
      rewakes: _hookSupervisor.drainRewakes(),
      results: _hookSupervisor.drainResults(),
    };
  };

  // --goal-condition: session-level completion-condition engine (P1). After each
  // outer turn an independent checker judges a completion CONDITION; if unmet and
  // budget remains, a follow-up user turn re-drives the agent — until met
  // (goal_completed) or a budget is exhausted (goal_exhausted). OPT-IN: when
  // unset, `goalEngine` is null and the outer loop runs exactly once, so one-shot
  // `cc agent -p` behavior is byte-for-byte unchanged.
  let goalEngine = null;
  let _goalHelpers = null;
  let _goalTokensSeen = 0; // per-turn usage deltas (engine totals == run total)
  let _goalCostSeen = 0;
  // Model-judged conditions reuse the run's own model as an independent
  // evaluator (mirrors --goal-assess). Overridable via deps for tests.
  const _defaultGoalJudge = async (cond, transcript) => {
    const { chatWithTools } = await import("./agent-core.js");
    const { firstBalancedJson } = await import("../lib/json-schema-output.js");
    const judgePrompt =
      `You are judging whether a coding session met a completion condition.\n` +
      `Condition: ${cond.text || cond.source}\n\n` +
      `Latest assistant output:\n${String(transcript.finalText || "").slice(0, 2000)}\n\n` +
      `Reply with STRICT JSON only: {"met": true|false, "reason": "<short>"}.`;
    const r = await chatWithTools([{ role: "user", content: judgePrompt }], {
      model,
      provider,
      baseUrl,
      apiKey,
      enabledToolNames: [],
    });
    const text = r?.message?.content || "";
    let met = false;
    let reason = "model judge returned no verdict";
    const block = firstBalancedJson(text, "{");
    if (block) {
      try {
        const parsed = JSON.parse(block);
        met = parsed.met === true;
        if (typeof parsed.reason === "string" && parsed.reason.trim())
          reason = parsed.reason.trim();
        else reason = met ? "condition met" : "condition not met";
      } catch {
        /* tolerant: a non-JSON verdict stays unmet */
      }
    }
    return {
      met,
      reason,
      evidence: { kind: "model", raw: text.slice(0, 200) },
    };
  };
  // Persist the engine snapshot as a hash-chained `goal_snapshot` session event
  // (best-effort, only when persisting). Re-read on --resume so an unfinished
  // goal continues across processes with its outerTurns/tokens/cost/startedAtMs
  // intact. rebuildMessages ignores this event type, so it never pollutes model
  // context. Defined here so the outer loop can call it after each evaluate().
  const persistGoalSnapshot = () => {
    if (!persist || !goalEngine) return;
    try {
      store.appendEvent(sessionId, "goal_snapshot", goalEngine.snapshot());
    } catch {
      // best-effort — never fail the run over persistence
    }
  };
  if (options.goalCondition) {
    try {
      const eng = await import("../lib/goal-condition-engine.js");
      const goalNow = () => (deps.now ? deps.now() : Date.now());
      // Cross-process resume: if the resumed session persisted an UNFINISHED
      // goal, continue it (fromSnapshot keeps accumulated progress + startedAtMs)
      // rather than starting fresh. A finished (done) snapshot is ignored — the
      // prior goal already concluded, so --goal-condition begins a new cycle. On
      // restore the persisted condition/budget win over freshly-passed flags, so
      // a resume faithfully continues the same goal.
      let restoredSnap = null;
      if (resumeId) {
        try {
          const events = store.readEvents(resumeId) || [];
          for (let i = events.length - 1; i >= 0; i--) {
            const ev = events[i];
            if (ev && ev.type === "goal_snapshot") {
              const snap = ev.data;
              if (snap && snap.state && snap.state.done !== true)
                restoredSnap = snap;
              break; // only the latest goal_snapshot matters
            }
          }
        } catch {
          restoredSnap = null; // unreadable transcript → start fresh
        }
      }
      if (restoredSnap) {
        goalEngine = eng.GoalConditionEngine.fromSnapshot(restoredSnap, {
          now: goalNow,
        });
      } else {
        goalEngine = new eng.GoalConditionEngine({
          condition: options.goalCondition,
          budget: {
            maxOuterTurns: options.maxOuterTurns,
            maxTokens: options.goalMaxTokens,
            maxCostUsd: options.goalMaxCostUsd,
            maxTimeMs: options.goalMaxTimeMs,
          },
          now: goalNow,
        });
      }
      _goalHelpers = {
        isDeterministicCondition: eng.isDeterministicCondition,
        runDeterministicCheck: eng.runDeterministicCheck,
        GOAL_DECISION: eng.GOAL_DECISION,
      };
      const started = goalEngine.start();
      emitStream({
        type: started.type,
        condition: started.condition,
        budget: started.budget,
        resumed: Boolean(restoredSnap),
      });
      persistGoalSnapshot(); // checkpoint the starting/restored state
      if (isText)
        writeErr(
          `  ◎ goal-condition ${restoredSnap ? "resumed" : "active"}: ` +
            `${goalEngine.condition.source} ` +
            `(outer turn ${goalEngine.state.outerTurns + 1}/` +
            `${goalEngine.budget.maxOuterTurns})\n`,
        );
    } catch (err) {
      // A bad spec should have been rejected at the command layer; fail-open so
      // a malformed condition never aborts an otherwise-valid run.
      goalEngine = null;
      if (isText) writeErr(`  goal-condition ignored: ${err.message}\n`);
    }
  }

  // A Ctrl-C (SIGINT) / SIGTERM terminates Node WITHOUT unwinding the `finally`
  // below, so its background-task reaper is bypassed — a backgrounded run_shell
  // task (e.g. a dev server) this run spawned would be orphaned. Install a
  // scoped handler that reaps it synchronously + stops the async-hook
  // supervisor, then exits with the conventional 128+signal code. Headless has
  // no other SIGINT owner (no raw-mode keypress like the REPL), so this can't
  // race a competing handler. Removed in `finally` so a normal return leaves no
  // listener behind (runAgentHeadless can be called repeatedly in one process).
  const _onHardSignal = (sig) => {
    try {
      killAllBackgroundShellTasksSync();
    } catch {
      /* best-effort — never let cleanup throw during shutdown */
    }
    try {
      if (_hookSupervisor) _hookSupervisor.stopAll();
    } catch {
      /* best-effort */
    }
    process.exit(sig === "SIGTERM" ? 143 : 130);
  };
  process.once("SIGINT", _onHardSignal);
  process.once("SIGTERM", _onHardSignal);

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      for await (const event of runLoop(messages, loopOptions)) {
        switch (event.type) {
          case "checkpoint": {
            if (isText)
              writeErr(`  ⎌ checkpoint ${event.id} (before ${event.tool})\n`);
            emitStream({ type: "checkpoint", id: event.id, tool: event.tool });
            break;
          }
          case "tool-executing": {
            const line = `  [${event.tool}] ${formatToolArgs(event.tool, event.args)}`;
            if (isText) writeErr(line + "\n");
            emitStream({
              type: "tool_use",
              tool: event.tool,
              args: event.args,
            });
            toolCalls.push({ tool: event.tool, args: event.args });
            // P0-2: record an irreversible effect as STARTED (persisted before
            // it settles) so a crash before the matching tool-result leaves a
            // reconcilable "in flight" marker instead of a silent replay.
            currentSideEffectOpId = null;
            if (persist) {
              const se = classifyToolSideEffect(event.tool, event.args);
              if (se) {
                const opId = `${sideEffectRunNonce}:${sideEffectSeq++}`;
                currentSideEffectOpId = opId;
                sideEffectLedger
                  .prepare(opId, {
                    kind: se.kind,
                    key: se.key,
                    // Content-addressed key: a resumed replay of the SAME effect
                    // derives the SAME key, so an external provider can de-dupe
                    // and countDuplicateCommittedEffects can measure `0` repeats.
                    meta: {
                      tool: event.tool,
                      idempotencyKey: operationIdempotencyKey({
                        tool: event.tool,
                        args: event.args,
                      }),
                    },
                  })
                  .start(opId);
                persistSideEffectLedger();
              }
            }
            break;
          }
          case "tool-result": {
            const err = event.error || event.result?.error || null;
            // P0-2: settle the in-flight side-effect (commit on success, fail on
            // a clean error) and persist the updated ledger snapshot.
            if (persist && currentSideEffectOpId) {
              if (err)
                sideEffectLedger.fail(
                  currentSideEffectOpId,
                  String(err).slice(0, 200),
                );
              else sideEffectLedger.commit(currentSideEffectOpId);
              persistSideEffectLedger();
              currentSideEffectOpId = null;
            }
            if (isText && err) writeErr(`  Error: ${err}\n`);
            emitStream({
              type: "tool_result",
              tool: event.tool,
              is_error: Boolean(err),
              error: err,
              result: event.result,
            });
            if (toolCalls.length > 0) {
              toolCalls[toolCalls.length - 1].is_error = Boolean(err);
            }
            // Track policy denials (not plain tool failures) for the end-of-run
            // summary. The preceding tool-executing pushed the args.
            if (err) {
              const last = toolCalls[toolCalls.length - 1];
              const denial = classifyDenial({
                tool: event.tool,
                result: event.result,
                error: event.error,
                argsSummary:
                  last && last.tool === event.tool
                    ? formatToolArgs(event.tool, last.args)
                    : "",
              });
              if (denial) {
                recordDenial(denials, {
                  ...denial,
                  at: deps.now ? deps.now() : Date.now(),
                });
              }
            }
            break;
          }
          case "token-usage": {
            if (event.attribution) {
              // Child-loop (sub-agent / isolated-skill) spend: excluded from
              // the main `usage` envelope, persisted with its attribution
              // frame below, but still counted toward the cost budget — it
              // is real money on the same key.
              attributedUsage.push({
                provider: event.provider ?? null,
                model: event.model ?? null,
                usage: event.usage || null,
                attribution: event.attribution,
              });
            } else {
              usage.input_tokens += event.usage?.input_tokens || 0;
              usage.output_tokens += event.usage?.output_tokens || 0;
              // Carry prompt-cache tokens into accumulated usage (cost accuracy).
              usage.cache_read_input_tokens +=
                event.usage?.cache_read_input_tokens || 0;
              usage.cache_creation_input_tokens +=
                event.usage?.cache_creation_input_tokens || 0;
            }
            emitStream({ type: "token_usage", usage: event.usage });
            if (costBudget) {
              costBudget.add({
                provider: event.provider,
                model: event.model,
                usage: event.usage,
              });
              if (costBudget.shouldWarnInactive()) {
                const m = `cost cap $${options.maxCostUsd} set but model "${event.model}" is unpriced/free — cap inactive`;
                if (isText) writeErr(`  ${m}\n`);
                emitStream({ type: "cost_warning", message: m });
              }
              if (costBudget.exceeded()) {
                endReason = "cost-budget-exhausted";
                stopForCost = true;
                if (isText)
                  writeErr(
                    `  ⛔ cost budget $${options.maxCostUsd} reached (spent ≈$${costBudget.spentUsd}) — stopping\n`,
                  );
                emitStream({
                  type: "cost_budget_exhausted",
                  limit_usd: options.maxCostUsd,
                  spent_usd: costBudget.spentUsd,
                });
              }
            }
            break;
          }
          case "iteration-warning": {
            if (isText) writeErr(`  ${event.message}\n`);
            emitStream({ type: "iteration_warning", message: event.message });
            break;
          }
          case "iteration-budget-exhausted": {
            endReason = "max_turns";
            emitStream({
              type: "iteration_budget_exhausted",
              budget: event.budget,
            });
            break;
          }
          case "response-complete": {
            finalText = event.content || "";
            break;
          }
          case "run-ended": {
            if (event.reason) endReason = event.reason;
            break;
          }
          default:
            // slot-filling, run-started, etc. — surfaced only in stream mode.
            if (isStream && event.type) emitStream(event);
            break;
        }
        // Hard cost cap reached: stop consuming the loop so no further paid LLM
        // call is made (break out of the for-await, not just the switch).
        if (stopForCost) break;
      }
      // ── auto-rewake re-drive (opt-in via --auto-rewake) ─────────────────
      // Under auto-rewake, settle the async Stop hooks after EVERY turn (so the
      // final turn's background check still runs). If an asyncRewake check
      // failed and re-drive budget remains, append its report as a new user
      // turn and loop; if a rewake failed but budget is spent, surface it and
      // stop. When auto-rewake is off, this whole block is skipped and the
      // `finally` handles Stop exactly as before (default behavior unchanged).
      if (
        autoRewake &&
        _hookSupervisor &&
        !stopForCost &&
        endReason !== "max_turns" &&
        endReason !== "cost-budget-exhausted"
      ) {
        const { rewakes, results } = await _settleAsyncStop();
        _asyncStopHandled = true;
        for (const rs of results) {
          if (rs.additionalContext)
            writeErr(`[async-hook] ${rs.command}: ${rs.additionalContext}\n`);
        }
        if (rewakes.length > 0 && rewakeBudget > 0) {
          rewakeBudget--;
          const detail = rewakes
            .map(
              (rw) =>
                `- ${rw.command} failed` +
                `${rw.exitCode != null ? ` (exit ${rw.exitCode})` : ""}` +
                `${rw.error ? `: ${rw.error}` : ""}`,
            )
            .join("\n");
          messages.push({
            role: "user",
            content:
              `A background check flagged a problem after your last turn:\n${detail}\n` +
              `Investigate and fix it, then confirm it passes.`,
          });
          if (isText)
            writeErr(
              `  ↻ async-hook rewake — re-engaging agent (${rewakeBudget} re-drive(s) left)\n`,
            );
          emitStream({ type: "rewake", remaining: rewakeBudget });
          finalText = "";
          endReason = "complete";
          continue; // re-drive: run another agent turn
        }
        // A rewake fired but no budget remains — surface it (couldn't auto-fix).
        for (const rw of rewakes) {
          writeErr(
            `[async-hook REWAKE] ${rw.command} failed` +
              `${rw.exitCode != null ? ` (exit ${rw.exitCode})` : ""}` +
              `${rw.error ? `: ${rw.error}` : ""}\n`,
          );
        }
      }
      // ── goal-condition re-drive (opt-in via --goal-condition) ─────────────
      // After the turn settles (and any auto-rewake fix), evaluate the session
      // completion condition. Unmet + budget remaining → append a follow-up user
      // turn and re-drive; met → goal_completed; budget spent → goal_exhausted.
      // Cost / max-turns exhaustion of the INNER loop stops here regardless.
      if (
        goalEngine &&
        _goalHelpers &&
        !goalEngine.done &&
        !stopForCost &&
        endReason !== "cost-budget-exhausted" &&
        endReason !== "max_turns"
      ) {
        // Feed this turn's usage DELTA so the engine's totals equal the run's
        // cumulative usage (recordTurnUsage accumulates).
        const curTokens =
          usage.input_tokens +
          usage.output_tokens +
          usage.cache_read_input_tokens +
          usage.cache_creation_input_tokens;
        const curCost = costBudget ? Number(costBudget.spentUsd) || 0 : 0;
        goalEngine.recordTurnUsage({
          tokens: curTokens - _goalTokensSeen,
          costUsd: curCost - _goalCostSeen,
        });
        _goalTokensSeen = curTokens;
        _goalCostSeen = curCost;

        const cond = goalEngine.condition;
        let evaluation;
        try {
          if (_goalHelpers.isDeterministicCondition(cond)) {
            const gc = deps.goalCheck || {};
            const spawnSync =
              gc.spawnSync || (await import("node:child_process")).spawnSync;
            const existsSync =
              gc.existsSync || (await import("node:fs")).existsSync;
            evaluation = _goalHelpers.runDeterministicCheck(cond, {
              spawnSync,
              existsSync,
              cwd,
              lastOutput: finalText,
            });
          } else {
            const judge = deps.goalConditionJudge || _defaultGoalJudge;
            evaluation = await judge(cond, {
              prompt: options.prompt,
              finalText,
              toolCalls,
            });
          }
        } catch (err) {
          evaluation = {
            met: false,
            reason: `goal check failed: ${err.message}`,
            evidence: { error: true },
          };
        }

        const { decision, events } = goalEngine.evaluate(evaluation);
        for (const ev of events) {
          emitStream(ev);
          if (isText) {
            if (ev.type === "goal_completed")
              writeErr(`  ✔ goal-condition met: ${ev.reason}\n`);
            else if (ev.type === "goal_exhausted")
              writeErr(
                `  ⛔ goal-condition unmet (${ev.limit}): ${ev.reason}\n`,
              );
            else if (ev.type === "goal_evaluated")
              writeErr(
                `  ◎ goal-condition ${ev.met ? "met" : "not met"}: ${ev.reason}\n`,
              );
          }
        }
        // Checkpoint the post-evaluate state (outerTurns incremented, and
        // done/outcome on a terminal decision) so a crash or Ctrl-C between here
        // and the next turn still resumes at the right point.
        persistGoalSnapshot();
        if (decision === _goalHelpers.GOAL_DECISION.CONTINUE) {
          messages.push({
            role: "user",
            content:
              `The completion condition is not yet met: ${evaluation.reason}.\n` +
              `Keep working toward: "${cond.source}". When you believe it is ` +
              `satisfied, make sure it actually passes.`,
          });
          finalText = "";
          endReason = "complete";
          if (isText)
            writeErr(
              `  ↻ goal-condition re-drive — outer turn ${goalEngine.state.outerTurns + 1}\n`,
            );
          continue; // re-drive: run another outer turn
        }
        // complete | exhausted → fall through to the break below.
      }
      break;
    }
  } catch (err) {
    const message = err?.message || String(err);
    if (isStream) {
      emitStream({
        type: "result",
        subtype: "error",
        is_error: true,
        error: message,
      });
    } else if (isJson) {
      writeOut(
        JSON.stringify(
          buildResultEnvelope({
            subtype: "error",
            isError: true,
            result: message,
            sessionId,
            toolCalls,
            usage,
            numTurns: budget.consumed,
            durationMs: (deps.now ? deps.now() : Date.now()) - startedAt,
            denials,
          }),
        ) + "\n",
      );
    } else {
      writeErr(`Error: ${message}\n`);
    }
    // Provider/transport failures get their own exit code (5) so CI can tell
    // "the model call failed" from "the run itself errored" (1).
    return { exitCode: classifyLoopError(err), result: message, isError: true };
  } finally {
    // Drop the signal handlers first — a normal return must not leave a
    // process-wide SIGINT/SIGTERM listener behind (a later Ctrl-C would wrongly
    // exit with 130, and repeated in-process runs would leak listeners).
    process.removeListener("SIGINT", _onHardSignal);
    process.removeListener("SIGTERM", _onHardSignal);
    // Tear down ad-hoc MCP servers (--mcp-config) before returning, whether the
    // loop completed or threw. Best-effort: a failed disconnect never masks the
    // run's own outcome.
    if (mcp?.mcpClient) {
      try {
        await mcp.mcpClient.disconnectAll();
      } catch {
        // ignore — disconnect is best-effort
      }
    }
    // Kill any background run_shell tasks this run spawned so a backgrounded
    // command (e.g. a dev server) doesn't outlive the headless invocation.
    try {
      killAllBackgroundShellTasks();
    } catch {
      // best-effort — never mask the run's own outcome
    }
    // Tear down the --remote-control approval bridge + its self-hosted WS
    // server so the run's port/socket never outlives the invocation.
    if (_remoteApproval) {
      try {
        await _remoteApproval.close();
      } catch {
        // best-effort — never mask the run's own outcome
      }
    }
    // settings.json Stop + SessionEnd hooks when the run finishes. Stop is the
    // canonical async-hook trigger ("run the test suite at turn end"); fire its
    // async hooks fire-and-forget, then settle so a fast background check can
    // report back within this one-shot run.
    if (settingsHooks) {
      try {
        const { runObserveHooks, dispatchAsyncHooks } =
          await import("../lib/settings-hook-events.cjs");
        const stopPayload = { reason: endReason, cwd, session_id: sessionId };
        runObserveHooks(settingsHooks, "Stop", stopPayload, { cwd });
        // Skip the async Stop dispatch/settle here if the auto-rewake re-drive
        // loop already fired + drained it this run (avoids double-execution).
        if (_hookSupervisor && !_asyncStopHandled) {
          dispatchAsyncHooks(settingsHooks, "Stop", stopPayload, {
            cwd,
            supervisor: _hookSupervisor,
          });
          // Bounded settle: wait for in-flight async hooks (Stop + any
          // PostToolUse dispatched during the loop) to finish, capped so a
          // slow/hung check can never stall the run. Default 5s; tunable.
          const waitMs = Number.isFinite(options.asyncHookWaitMs)
            ? options.asyncHookWaitMs
            : 5000;
          const started = Date.now();
          while (
            _hookSupervisor.runningCount() > 0 &&
            Date.now() - started < waitMs
          ) {
            await new Promise((r) => setTimeout(r, 50));
          }
          // Surface any results/rewakes out-of-band on stderr (never touches the
          // stdout envelope). A rewake means a background check FAILED and would
          // re-engage the agent in an interactive session — flag it clearly so a
          // headless caller/CI can react.
          for (const rw of _hookSupervisor.drainRewakes()) {
            writeErr(
              `[async-hook REWAKE] ${rw.command} failed` +
                `${rw.exitCode != null ? ` (exit ${rw.exitCode})` : ""}` +
                `${rw.error ? `: ${rw.error}` : ""}\n`,
            );
          }
          for (const rs of _hookSupervisor.drainResults()) {
            if (rs.additionalContext) {
              writeErr(`[async-hook] ${rs.command}: ${rs.additionalContext}\n`);
            }
          }
        }
        // Always reap the supervisor (kills any straggler child + detaches the
        // exit reaper), whether the async Stop was handled here or in re-drive.
        if (_hookSupervisor) _hookSupervisor.stopAll();
        runObserveHooks(
          settingsHooks,
          "SessionEnd",
          { reason: "completed", cwd, session_id: sessionId },
          { cwd },
        );
      } catch {
        // observe-only + best-effort async surfacing
      }
    }
  }

  // coreAgentLoop emits run-ended reason "budget-exhausted" when the iteration
  // cap is hit; treat that as the max-turns error surface. A cost-budget stop
  // (--max-budget-usd) is its own error surface so callers can tell them apart.
  const exhausted =
    endReason === "budget-exhausted" || endReason === "max_turns";
  const costStopped = endReason === "cost-budget-exhausted";
  const isError = exhausted || costStopped || endReason === "no-response";
  const subtype = exhausted
    ? "error_max_turns"
    : costStopped
      ? "error_max_budget"
      : isError
        ? "error"
        : "success";
  const durationMs = (deps.now ? deps.now() : Date.now()) - startedAt;

  // Persist the assistant turn so a later --resume / --continue replays it.
  // The user turn was already recorded up front; only append on a clean run.
  if (persist && !isError) {
    try {
      if (finalText) store.appendAssistantMessage(sessionId, finalText);
      // 用量归因: compact per-tool records (name + error flag + skill hint —
      // never args) so `cc session usage --by tool|mcp` can aggregate
      // headless sessions too.
      for (const tc of toolCalls) {
        store.appendToolCallCompact(sessionId, {
          tool: tc.tool,
          isError: Boolean(tc.is_error),
          skill:
            tc.tool === "run_skill" ? tc.args?.skill_name || null : undefined,
        });
      }
      // Attributed child-loop usage first (chronology: it happened during
      // the run), then the unchanged main-loop aggregate.
      for (const au of attributedUsage) {
        store.appendTokenUsage(sessionId, au);
      }
      store.appendTokenUsage(sessionId, usage);
    } catch {
      // Persistence is best-effort — never fail the run over it.
    }
  }

  // Run-end goal self-assessment (cc goal Phase 2, opt-in via --goal-assess).
  // Spends one extra completion to judge whether the run advanced the bound
  // goal, then persists progress / key-result / drift updates. Best-effort: it
  // must never change the run's own outcome.
  if (options.goalAssess && boundGoalId && !isError) {
    try {
      const { getGoal } = await import("../lib/goal-store.js");
      const goal = (deps.getGoal || getGoal)(boundGoalId);
      if (goal) {
        const { assessGoalProgress } = await import("../lib/goal-assess.js");
        const doAssess = deps.assessGoalProgress || assessGoalProgress;
        const assessChat =
          deps.assessChat ||
          (async (assessPrompt) => {
            const { chatWithTools } = await import("./agent-core.js");
            const r = await chatWithTools(
              [{ role: "user", content: assessPrompt }],
              { model, provider, baseUrl, apiKey, enabledToolNames: [] },
            );
            return r?.message?.content || "";
          });
        const { assessment } = await doAssess({
          goal,
          transcript: { prompt: options.prompt, finalText, toolCalls },
          chat: assessChat,
        });
        if (assessment) {
          if (isText) {
            writeErr(
              `  ◎ goal ${boundGoalId}: ${assessment.advanced ? "advanced" : "no progress"}` +
                (assessment.progress != null
                  ? ` (${assessment.progress}%)`
                  : "") +
                "\n",
            );
          }
          emitStream({
            type: "goal_assessment",
            goal_id: boundGoalId,
            advanced: assessment.advanced,
            progress: assessment.progress,
            note: assessment.note,
          });
        }
      }
    } catch {
      /* assessment is best-effort — never affect the run outcome */
    }
  }

  // End-of-run policy-denial summary so a non-interactive run surfaces what was
  // blocked (mirrors the REPL's `/permissions denials`). Text → stderr lines;
  // stream → a `denials_summary` event before the final result.
  if (denials.length) {
    if (isText) {
      writeErr(
        `\n  ${denials.length} tool call(s) were denied by policy this run:\n` +
          formatDenials(denials, { now: deps.now ? deps.now() : Date.now() }) +
          "\n",
      );
    } else if (isStream) {
      emitStream({ type: "denials_summary", count: denials.length, denials });
    }
    try {
      const { appendRecentDenials } =
        await import("../lib/permission-denial-store.js");
      appendRecentDenials(denials, {
        sessionId,
        permissionMode: options.permissionMode || "default",
        cwd,
        source: "headless",
      });
    } catch {
      // Persisting the review surface is best-effort; never affect the run.
    }
  }

  if (isStream) {
    emitStream({
      type: "result",
      subtype,
      is_error: isError,
      result: finalText,
      session_id: sessionId,
      num_turns: budget.consumed,
      duration_ms: durationMs,
      usage,
    });
  } else if (isJson) {
    writeOut(
      JSON.stringify(
        buildResultEnvelope({
          subtype,
          isError,
          result: finalText,
          sessionId,
          toolCalls,
          usage,
          numTurns: budget.consumed,
          durationMs,
          denials,
        }),
      ) + "\n",
    );
  } else {
    // text: just the final answer on stdout.
    writeOut(finalText + (finalText.endsWith("\n") ? "" : "\n"));
  }

  // --otlp: write the captured spans/counters as OTLP/JSON. Best-effort — a
  // write failure logs to stderr but never changes the run's exit code.
  if (_otlpRecorder && options.otlp) {
    try {
      const fsp = await import("node:fs");
      fsp.writeFileSync(
        options.otlp,
        JSON.stringify(_otlpRecorder.toOtlp(), null, 2),
        "utf-8",
      );
      if (!isStream) {
        const sum = _otlpRecorder.summary();
        process.stderr.write(
          `[otlp] ${sum.spanCount} span(s) → ${options.otlp}\n`,
        );
      }
    } catch (err) {
      process.stderr.write(`[otlp] export failed: ${err.message}\n`);
    }
  }

  // Exit-code taxonomy: max-turns → 3, cost cap → 4 (both still non-zero, so
  // "any failure" checks keep working; scripts can now tell exhaustion apart).
  return {
    exitCode: exitCodeForEndReason(endReason, isError),
    result: finalText,
    isError,
  };
}

function buildResultEnvelope({
  subtype,
  isError,
  result,
  sessionId,
  toolCalls,
  usage,
  numTurns,
  durationMs,
  denials,
}) {
  const env = {
    type: "result",
    subtype,
    is_error: isError,
    result,
    session_id: sessionId,
    num_turns: numTurns,
    duration_ms: durationMs,
    tool_calls: toolCalls,
    usage,
  };
  // Only present when something was blocked — keeps the no-denial envelope
  // byte-identical to before (Claude-Code 2.1.193 denial reasons, json mode).
  if (Array.isArray(denials) && denials.length) env.denials = denials;
  return env;
}
