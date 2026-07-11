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
  appendCompactEvent as jsonlAppendCompactEvent,
  rebuildMessages as jsonlRebuildMessages,
  sessionExists as jsonlSessionExists,
  getLastSessionId as jsonlGetLastSessionId,
  verifySession as jsonlVerifySession,
} from "../harness/jsonl-session-store.js";
import { expandFileRefsAsync } from "./file-ref-expander.js";
import { composeSystemPrompt } from "./system-prompt.js";
import { buildUserContent } from "../lib/image-input.js";
import { mergeConsecutiveMessages } from "./message-roles.js";
import { isHeadlessConfigCommand } from "../lib/headless-config-command.js";
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
 * @param {object} options { resume, continueSession, sessionId, persistSession }
 * @param {object} store   { getLastSessionId }  (injection seam)
 * @param {string} fallbackId  used when nothing is being resumed
 * @returns {{ sessionId:string, resumeId:string|null, persist:boolean, wantLatest:boolean }}
 */
export function resolveHeadlessSession(options = {}, store = {}, fallbackId) {
  const { resume, continueSession, sessionId, persistSession } = options;
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
  const persist = persistSession === true || resumeId != null || wantLatest;
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
    appendCompactEvent: deps.appendCompactEvent || jsonlAppendCompactEvent,
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

  const systemContent = composeSystemPrompt(
    buildSystemPrompt(cwd, { additionalDirectories }),
    {
      systemPrompt: options.systemPrompt,
      appendSystemPrompt: options.appendSystemPrompt,
      outputStyle: outputStyleBody,
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
    ...(sessionStartContext
      ? [{ role: "system", content: sessionStartContext }]
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
      return { exitCode: 1, result: err.message, isError: true };
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
      return { exitCode: 1, result: err.message, isError: true };
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
      _hookSupervisor = new AsyncHookSupervisor();
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
    session_id: sessionId,
    model,
    provider,
    permission_mode: options.permissionMode || "default",
    tools: enabledToolNames,
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
            break;
          }
          case "tool-result": {
            const err = event.error || event.result?.error || null;
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
            usage.input_tokens += event.usage?.input_tokens || 0;
            usage.output_tokens += event.usage?.output_tokens || 0;
            // Carry prompt-cache tokens into accumulated usage (cost accuracy).
            usage.cache_read_input_tokens +=
              event.usage?.cache_read_input_tokens || 0;
            usage.cache_creation_input_tokens +=
              event.usage?.cache_creation_input_tokens || 0;
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
    return { exitCode: 1, result: message, isError: true };
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

  return { exitCode: isError ? 1 : 0, result: finalText, isError };
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
