/**
 * IDE live prompt context (Claude-Code parity) — when an IDE bridge is
 * connected (lib/ide-bridge.js → mcp-config.js `loadIdeMcp`, server `ide`),
 * automatically share the editor's state at the moment a prompt is submitted:
 * the active file, the open editor tabs, and the current selection. The agent
 * no longer has to *choose* to call mcp__ide__getSelection — the context rides
 * along with every user turn, exactly like Claude Code's at-submit selection
 * sharing.
 *
 * The context is EPHEMERAL by design: entry points append it to the in-flight
 * user content only, after session persistence, so a resumed session replays
 * the user's words, not a stale editor snapshot.
 *
 * Everything here is best-effort and bounded: a missing/slow IDE server can
 * never block or fail a turn (short timeout, all errors → null), and the
 * injected block is capped. `CC_IDE_CONTEXT=0` disables the feature without
 * disconnecting the IDE tools themselves.
 */

import { simpleDiff } from "./note-versioning.js";
import {
  filterIdeFileEntry,
  redactSecretsInText,
} from "./ide-context-redaction.js";
import { normalizeIdePathForCli, detectWsl } from "./remote-path-mapping.js";

/** Hard cap on the selected text we inline into the prompt. */
const SELECTION_TEXT_CAP = 2000;
/** At most this many open-editor entries are listed. */
const OPEN_EDITORS_CAP = 10;
/** Recent terminal commands pulled into the ambient block. */
const TERMINAL_LIMIT = 2;
/** Per-command output cap inside the ambient block (tighter than the tool's). */
const TERMINAL_OUTPUT_CAP = 800;
/** Per-tool-call budget; the IDE answers from memory, so this is generous. */
const DEFAULT_TIMEOUT_MS = 1500;

/** Env kill-switch: CC_IDE_CONTEXT=0|false|off disables injection. */
export function ideContextEnabled(env = process.env) {
  const v = String(env?.CC_IDE_CONTEXT ?? "").toLowerCase();
  return !(v === "0" || v === "false" || v === "off");
}

/**
 * Sub-switch for terminal output in the ambient block: CC_IDE_TERMINAL=0|false|off
 * drops it while keeping selection/editors (terminal output can be noisy or
 * sensitive). Implies off whenever CC_IDE_CONTEXT is off.
 */
export function ideTerminalEnabled(env = process.env) {
  if (!ideContextEnabled(env)) return false;
  const v = String(env?.CC_IDE_TERMINAL ?? "").toLowerCase();
  return !(v === "0" || v === "false" || v === "off");
}

/**
 * Does this resolved MCP bundle expose the IDE bridge's selection tool?
 * (`resolveAgentMcp` connects the bridge as server `ide`, so its tools land in
 * `externalToolExecutors` as mcp__ide__*.)
 */
export function hasIdeContextTools(mcp) {
  return !!(
    mcp?.mcpClient?.callTool &&
    mcp.externalToolExecutors?.mcp__ide__getSelection?.kind === "mcp"
  );
}

/** Does this MCP surface expose the IDE bridge's terminal-output tool? */
export function hasIdeTerminalTool(mcp) {
  return !!(
    mcp?.mcpClient?.callTool &&
    mcp.externalToolExecutors?.mcp__ide__getTerminalOutput?.kind === "mcp"
  );
}

/**
 * Read an MCP tools/call result's first text block as JSON. The IDE bridge
 * servers always wrap handler data as
 * `{content:[{type:"text",text:JSON.stringify(data)}]}`. Returns null for
 * isError results, non-text content, or unparsable text.
 */
export function parseToolResultJson(result) {
  if (!result || result.isError) return null;
  const block = Array.isArray(result.content)
    ? result.content.find((b) => b && b.type === "text")
    : null;
  if (!block || typeof block.text !== "string") return null;
  try {
    return JSON.parse(block.text);
  } catch {
    return null;
  }
}

// ─── Redaction seams (see [[ide-context-redaction.js]]) ─────────────────────
// IDE context bypasses the tool-permission layer entirely (nothing goes
// through read_file), so credential files and secret-shaped text are filtered
// HERE, at the collection boundary, before anything reaches the prompt.
// CC_IDE_CONTEXT_REDACTION=0 disables (the filters below become pass-through).
//
// The same boundary also folds a remote file representation (a vscode-remote://
// URI, a \\wsl.localhost\… UNC, or a Windows drive path while cc runs in WSL)
// into the path THIS host can open (see [[remote-path-mapping.js]]) — otherwise
// the agent, reading the inlined path, would target a file cc can't see. The
// credential filter runs on the ORIGINAL value (basename is preserved by the
// map, so the verdict is unchanged). CC_IDE_PATH_MAP=0 disables it.

/** Env gate: CC_IDE_PATH_MAP=0|false|off disables remote path normalization. */
export function idePathMapEnabled(env = process.env) {
  const v = String(env?.CC_IDE_PATH_MAP ?? "").toLowerCase();
  return !(v === "0" || v === "false" || v === "off");
}

/** Fold one IDE-reported file value into a path cc can open on this host. */
function mapIdeFile(file, env) {
  if (typeof file !== "string" || !idePathMapEnabled(env)) return file;
  return normalizeIdePathForCli(file, {
    platform: process.platform,
    wsl: detectWsl(env || {}),
  });
}

/** Drop the selection when it lives in a credential file; scrub its text. */
function sanitizeIdeSelection(sel, env) {
  if (!sel) return sel;
  if (sel.file && filterIdeFileEntry(sel.file, { env }) === null) return null;
  let out = sel;
  const mappedFile = mapIdeFile(sel.file, env);
  if (mappedFile !== sel.file) out = { ...out, file: mappedFile };
  if (typeof out.text === "string" && out.text.length > 0) {
    const scrubbed = redactSecretsInText(out.text, { env });
    if (scrubbed !== out.text) out = { ...out, text: scrubbed };
  }
  return out;
}

/** Drop open-editor entries whose file is a credential file; map the rest. */
function sanitizeIdeEditors(editors, env) {
  if (!Array.isArray(editors)) return editors;
  return editors
    .filter(
      (e) => !(e && e.file && filterIdeFileEntry(e.file, { env }) === null),
    )
    .map((e) => {
      if (!e || typeof e.file !== "string") return e;
      const mapped = mapIdeFile(e.file, env);
      return mapped === e.file ? e : { ...e, file: mapped };
    });
}

/** Scrub secret-shaped text out of terminal commands and their output. */
function sanitizeIdeTerminals(terms, env) {
  if (!Array.isArray(terms)) return terms;
  return terms.map((t) => {
    if (!t || typeof t !== "object") return t;
    const out = { ...t };
    if (typeof out.command === "string") {
      out.command = redactSecretsInText(out.command, { env });
    }
    if (typeof out.output === "string") {
      out.output = redactSecretsInText(out.output, { env });
    }
    return out;
  });
}

/** Drop diagnostics for credential files; map their file + scrub message text. */
function sanitizeIdeDiagnostics(diags, env) {
  if (!Array.isArray(diags)) return diags;
  return diags
    .filter(
      (d) => !(d && d.file && filterIdeFileEntry(d.file, { env }) === null),
    )
    .map((d) => {
      if (!d) return d;
      let out = d;
      if (typeof d.file === "string") {
        const mapped = mapIdeFile(d.file, env);
        if (mapped !== d.file) out = { ...out, file: mapped };
      }
      if (typeof out.message === "string") {
        out = { ...out, message: redactSecretsInText(out.message, { env }) };
      }
      return out;
    });
}

/** Resolve to the promise's value, or null after `ms` / on rejection. */
function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/**
 * Query the connected IDE for its live state. Returns
 * `{ selection, openEditors }` (either field may be null) or null when the
 * feature is disabled, no IDE tools are connected, or nothing useful came
 * back. Never throws.
 *
 * @param {object} mcp   resolved bundle from resolveAgentMcp
 * @param {object} opts  { env?, timeoutMs? }
 */
export async function collectIdeContext(mcp, opts = {}) {
  if (!ideContextEnabled(opts.env || process.env)) return null;
  if (!hasIdeContextTools(mcp)) return null;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const executors = mcp.externalToolExecutors;
  const call = (name, args = {}) => {
    const exec = executors[name];
    if (!exec || exec.kind !== "mcp") return Promise.resolve(null);
    let p;
    try {
      p = mcp.mcpClient.callTool(exec.serverName, exec.toolName, args);
    } catch {
      return Promise.resolve(null);
    }
    return withTimeout(p.then(parseToolResultJson), timeoutMs);
  };
  const wantTerminal =
    ideTerminalEnabled(opts.env || process.env) && hasIdeTerminalTool(mcp);
  const [selection, editors, terminalData] = await Promise.all([
    call("mcp__ide__getSelection"),
    call("mcp__ide__getOpenEditors"),
    wantTerminal
      ? call("mcp__ide__getTerminalOutput", { limit: TERMINAL_LIMIT })
      : Promise.resolve(null),
  ]);
  const env = opts.env || process.env;
  const sel = sanitizeIdeSelection(selection || null, env);
  let openEditors = Array.isArray(editors?.editors) ? editors.editors : null;
  if (openEditors) openEditors = sanitizeIdeEditors(openEditors, env);
  let terminals = Array.isArray(terminalData?.terminals)
    ? terminalData.terminals
    : null;
  if (terminals) terminals = sanitizeIdeTerminals(terminals, env);
  if (
    !sel &&
    !(openEditors && openEditors.length > 0) &&
    !(terminals && terminals.length > 0)
  ) {
    return null;
  }
  return { selection: sel, openEditors, terminals };
}

/**
 * Render collected IDE state as a compact tagged block for the user turn.
 * Returns null when there is nothing worth saying.
 */
export function formatIdeContext(ctx) {
  if (!ctx) return null;
  const lines = [];
  const editors = Array.isArray(ctx.openEditors) ? ctx.openEditors : [];
  const active = editors.find((e) => e && e.active);
  if (active?.file) lines.push(`Active file: ${active.file}`);
  if (editors.length > 0) {
    const names = editors
      .filter((e) => e && e.file)
      .slice(0, OPEN_EDITORS_CAP)
      .map((e) => (e.active ? `${e.file} (active)` : e.file));
    const more = editors.length - names.length;
    lines.push(
      `Open editors: ${names.join(", ")}${more > 0 ? ` (+${more} more)` : ""}`,
    );
  }
  const sel = ctx.selection;
  if (sel && typeof sel.text === "string" && sel.text.length > 0) {
    const start = sel.selection?.start?.line;
    const end = sel.selection?.end?.line;
    const range =
      Number.isInteger(start) && Number.isInteger(end)
        ? `:${start + 1}-${end + 1}` // editor lines are 0-based
        : "";
    const text =
      sel.text.length > SELECTION_TEXT_CAP
        ? sel.text.slice(0, SELECTION_TEXT_CAP) + "\n...(selection truncated)"
        : sel.text;
    lines.push(`Selected text in ${sel.file || "the active editor"}${range}:`);
    lines.push(text);
  } else if (sel?.file && !active) {
    lines.push(`Active file: ${sel.file}`);
  }
  const terms = Array.isArray(ctx.terminals) ? ctx.terminals : [];
  if (terms.length > 0) {
    const shown = terms
      .slice(-TERMINAL_LIMIT)
      .filter((t) => t && typeof t.command === "string");
    if (shown.length > 0) {
      lines.push("Recent terminal commands:");
      for (const t of shown) {
        const code = t.exitCode == null ? "" : ` (exit ${t.exitCode})`;
        let out = typeof t.output === "string" ? t.output : "";
        const truncated = out.length > TERMINAL_OUTPUT_CAP || t.outputTruncated;
        if (out.length > TERMINAL_OUTPUT_CAP)
          out = out.slice(-TERMINAL_OUTPUT_CAP);
        lines.push(`$ ${t.command}${code}`);
        if (out.trim().length > 0) {
          lines.push(out + (truncated ? "\n...(output truncated)" : ""));
        }
      }
    }
  }
  if (lines.length === 0) return null;
  return (
    "<ide-context>\n" +
    "Live editor state, shared automatically at prompt time (an IDE is " +
    "connected). This reflects what the user is looking at NOW:\n" +
    lines.join("\n") +
    "\n</ide-context>"
  );
}

/**
 * Append extra text to user-turn content, preserving multimodal arrays
 * (OpenAI-style content parts from --image runs).
 */
export function appendTextToContent(content, extra) {
  if (!extra) return content;
  if (typeof content === "string") {
    return content.length > 0 ? `${content}\n\n${extra}` : extra;
  }
  if (Array.isArray(content)) {
    return [...content, { type: "text", text: extra }];
  }
  return content;
}

/**
 * One-call convenience for entry points: collect + format. Returns the tagged
 * block string or null. Never throws.
 */
export async function buildIdePromptContext(mcp, opts = {}) {
  try {
    const ctx = await collectIdeContext(mcp, opts);
    return ctx ? formatIdeContext(ctx) : null;
  } catch {
    return null;
  }
}

// ─── Post-edit diagnostics feedback (Claude-Code parity) ────────────────────
//
// After the agent mutates a file, the connected IDE's language servers see the
// change and update their diagnostics. Pulling them right back into the tool
// result lets the model fix what it just broke in the SAME loop instead of
// discovering it turns later. The IDE needs a beat to re-lint, hence the
// settle delay (CC_IDE_DIAG_SETTLE_MS overrides; 0 skips the wait).

/** Give language servers this long to notice the disk change before asking. */
const DIAG_SETTLE_MS = 600;
/** At most this many diagnostics are surfaced per edit. */
const DIAG_CAP = 10;
/** Only these severities are worth interrupting the model for. */
const DIAG_SEVERITIES = new Set(["error", "warning"]);

/** Does this MCP surface expose the IDE bridge's diagnostics tool? */
export function hasIdeDiagnosticsTool(mcp) {
  return !!(
    mcp?.mcpClient?.callTool &&
    mcp.externalToolExecutors?.mcp__ide__getDiagnostics?.kind === "mcp"
  );
}

/**
 * Pull the IDE's current error/warning diagnostics for one file. `mcp` accepts
 * either a resolveAgentMcp bundle or agent-core's tool context (both carry
 * `mcpClient` + `externalToolExecutors`). Returns a non-empty array or null.
 * Never throws.
 *
 * @param {object} mcp       { mcpClient, externalToolExecutors }
 * @param {string} filePath  absolute path of the just-edited file
 * @param {object} opts      { env?, settleMs?, timeoutMs? }
 */
export async function collectIdeDiagnostics(mcp, filePath, opts = {}) {
  const env = opts.env || process.env;
  if (!ideContextEnabled(env)) return null;
  if (!filePath || !hasIdeDiagnosticsTool(mcp)) return null;
  const settle =
    opts.settleMs ??
    (Number.isFinite(Number(env.CC_IDE_DIAG_SETTLE_MS))
      ? Number(env.CC_IDE_DIAG_SETTLE_MS)
      : DIAG_SETTLE_MS);
  if (settle > 0) await new Promise((r) => setTimeout(r, settle));
  const exec = mcp.externalToolExecutors.mcp__ide__getDiagnostics;
  let p;
  try {
    p = mcp.mcpClient.callTool(exec.serverName, exec.toolName, {
      path: filePath,
    });
  } catch {
    return null;
  }
  const data = await withTimeout(
    p.then(parseToolResultJson),
    opts.timeoutMs || DEFAULT_TIMEOUT_MS,
  );
  const all = Array.isArray(data?.diagnostics) ? data.diagnostics : null;
  if (!all) return null;
  const relevant = sanitizeIdeDiagnostics(
    all.filter(
      (d) => d && DIAG_SEVERITIES.has(String(d.severity).toLowerCase()),
    ),
    env,
  );
  return relevant.length > 0 ? relevant : null;
}

// ─── IDE-native diff approval (Claude-Code parity) ──────────────────────────
//
// When a permission `ask` fires for a file edit and an IDE bridge is up, the
// confirmation can be the editor's own openDiff review instead of a terminal
// y/N. The openDiff contract (extension P2): it BLOCKS until the user decides;
// on Accept the IDE itself writes the (possibly user-edited) right-hand text
// to the file — so an accepted review REPLACES the tool's own write, it does
// not precede it. The caller must skip normal execution on "accepted".

/** Env kill-switch for diff-approval routing: CC_IDE_DIFF_APPROVAL=0 disables. */
export function ideDiffApprovalEnabled(env = process.env) {
  const v = String(env?.CC_IDE_DIFF_APPROVAL ?? "").toLowerCase();
  return !(v === "0" || v === "false" || v === "off");
}

/** Does this MCP surface expose the IDE bridge's openDiff tool? */
export function hasIdeOpenDiff(mcp) {
  return !!(
    mcp?.mcpClient?.callTool &&
    mcp.externalToolExecutors?.mcp__ide__openDiff?.kind === "mcp"
  );
}

const DIFF_REVIEW_AUDIT_SCHEMA = "cc-diff-review/v1";

function auditString(value, max) {
  if (value == null) return null;
  const text = String(value).slice(0, max);
  return text || null;
}

function auditIndex(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function auditFingerprint(value) {
  if (!value || typeof value !== "object") return null;
  const sha256 = auditString(value.sha256, 64);
  if (!/^[a-f0-9]{64}$/i.test(sha256 || "")) return null;
  return {
    sha256: sha256.toLowerCase(),
    chars: auditIndex(value.chars),
    lines: auditIndex(value.lines),
  };
}

/**
 * Reduce a host-provided Diff Review audit to the bounded v1 wire contract.
 * Correlation ids and path are overwritten from the CLI request so a malformed
 * or stale local bridge cannot spoof which session/tool the decision belongs to.
 */
export function normalizeDiffReviewAudit(value, binding = {}) {
  if (
    !value ||
    typeof value !== "object" ||
    value.schema !== DIFF_REVIEW_AUDIT_SCHEMA
  ) {
    return null;
  }
  const requestedOutcome = auditString(binding.outcome ?? value.outcome, 64);
  const outcome = ["accepted", "rejected", "changes-requested"].includes(
    requestedOutcome,
  )
    ? requestedOutcome
    : "rejected";
  const comments = (Array.isArray(value.comments) ? value.comments : [])
    .filter((comment) => comment && typeof comment === "object")
    .map((comment) => ({
      line: auditIndex(comment.line),
      endLine: auditIndex(comment.endLine),
      lineFingerprint: auditFingerprint(comment.lineFingerprint),
      note: auditString(comment.note, 1000),
    }))
    .filter((comment) => comment.note)
    .slice(0, 32);
  const selectedHunks = [
    ...new Set(
      (Array.isArray(value.selectedHunks) ? value.selectedHunks : []).filter(
        (index) => Number.isInteger(index) && index >= 0,
      ),
    ),
  ]
    .sort((a, b) => a - b)
    .slice(0, 128);
  return {
    schema: DIFF_REVIEW_AUDIT_SCHEMA,
    reviewId: auditString(value.reviewId, 64),
    createdAt: auditString(value.createdAt, 64),
    actor: auditString(value.actor, 128) || "local-user",
    host: auditString(value.host, 64) || "ide",
    path: auditString(binding.path ?? value.path, 2048),
    sessionId: auditString(binding.sessionId, 256),
    turnId: auditString(binding.turnId, 256),
    toolUseId: auditString(binding.toolUseId, 256),
    outcome,
    source: auditString(value.source, 64) || "agent-proposed",
    written: value.written === true,
    followUpRequested:
      value.followUpRequested === true || outcome === "changes-requested",
    baseline: auditFingerprint(value.baseline),
    proposed: auditFingerprint(value.proposed),
    reviewed: auditFingerprint(value.reviewed),
    final: auditFingerprint(value.final),
    selectedHunks,
    appliedHunks: auditIndex(value.appliedHunks),
    totalHunks: auditIndex(value.totalHunks),
    comments,
    reason: auditString(value.reason, 512),
  };
}

/**
 * Run one blocking openDiff review in the connected IDE. Returns
 *   { outcome:"accepted", finalText|null }  — the IDE wrote the file itself
 *   { outcome:"rejected" }                  — nothing was written
 *   { outcome:"changes-requested", comments, reviewedText }
 *                                           — the user annotated the diff with
 *                                             revision notes instead of
 *                                             accepting/rejecting; nothing was
 *                                             written and the caller should
 *                                             feed `comments` back to the agent
 *                                             so it revises and re-proposes.
 *   null                                    — IDE unavailable / transport
 *                                             error / malformed reply → the
 *                                             caller falls back to its normal
 *                                             confirmation path.
 * Deliberately NO timeout: a review takes as long as the user takes (the MCP
 * HTTP client has no request timeout; the extension holds the response open).
 */
export async function requestIdeDiffApproval(mcp, req = {}) {
  if (!hasIdeOpenDiff(mcp)) return null;
  if (!req.path || typeof req.modifiedText !== "string") return null;
  const exec = mcp.externalToolExecutors.mcp__ide__openDiff;
  const reviewContext = Object.fromEntries(
    Object.entries({
      sessionId: auditString(req.sessionId, 256),
      turnId: auditString(req.turnId, 256),
      toolUseId: auditString(req.toolUseId, 256),
    }).filter(([, value]) => value),
  );
  let result;
  try {
    result = await mcp.mcpClient.callTool(exec.serverName, exec.toolName, {
      path: req.path,
      modifiedText: req.modifiedText,
      ...(typeof req.originalText === "string"
        ? { originalText: req.originalText }
        : {}),
      ...(req.title ? { title: req.title } : {}),
      ...(Object.values(reviewContext).some(Boolean) ? { reviewContext } : {}),
    });
  } catch {
    return null;
  }
  const data = parseToolResultJson(result);
  const audit = normalizeDiffReviewAudit(data?.audit, {
    ...reviewContext,
    path: req.path,
    outcome: data?.outcome,
  });
  if (data?.outcome === "accepted") {
    return {
      outcome: "accepted",
      finalText: typeof data.finalText === "string" ? data.finalText : null,
      ...(audit ? { audit } : {}),
    };
  }
  if (data?.outcome === "changes-requested") {
    return {
      outcome: "changes-requested",
      comments: Array.isArray(data.comments) ? data.comments : [],
      reviewedText:
        typeof data.reviewedText === "string" ? data.reviewedText : null,
      ...(audit ? { audit } : {}),
    };
  }
  if (data?.outcome === "rejected") {
    return { outcome: "rejected", ...(audit ? { audit } : {}) };
  }
  return null; // anything else is not a verdict — fail safe to fallback
}

/**
 * Render line-anchored review comments (from an openDiff "changes-requested"
 * verdict) into a compact feedback block the agent can act on. Each comment is
 * `{ line?, endLine?, lineText?, note }` with 0-based editor lines. Returns
 * null when there is no actionable note. Pure — safe to unit-test.
 */
export function formatReviewComments(comments, { path: filePath } = {}) {
  if (!Array.isArray(comments) || comments.length === 0) return null;
  const lines = comments
    .map((c) => {
      if (!c || typeof c.note !== "string" || c.note.trim().length === 0) {
        return null;
      }
      const start = Number.isInteger(c.line) ? c.line + 1 : null; // 0→1-based
      const end = Number.isInteger(c.endLine) ? c.endLine + 1 : start;
      const where =
        start != null
          ? end != null && end !== start
            ? `lines ${start}-${end}`
            : `line ${start}`
          : "(general)";
      const anchor =
        typeof c.lineText === "string" && c.lineText.trim().length > 0
          ? `  ⟪${c.lineText.trim().slice(0, 120)}⟫`
          : "";
      return `  • ${where}: ${c.note.trim()}${anchor}`;
    })
    .filter(Boolean);
  if (lines.length === 0) return null;
  const header = filePath
    ? `Review comments on ${filePath}:`
    : "Review comments:";
  return `${header}\n${lines.join("\n")}`;
}

/**
 * Render what the reviewer changed when they edited the proposal inside the
 * IDE diff before accepting: a compact -/+ line summary of proposal → final,
 * so the agent SEES the amendments instead of just a `userEdited` flag (its
 * mental model of the file would otherwise be its own rejected proposal).
 * Returns null when the texts are equal or not both strings. Pure.
 */
export function summarizeUserAmendments(
  proposedText,
  finalText,
  { maxLines = 30, maxChars = 2400 } = {},
) {
  if (typeof proposedText !== "string" || typeof finalText !== "string") {
    return null;
  }
  if (proposedText === finalText) return null;
  const a = proposedText.split("\n");
  const b = finalText.split("\n");

  // Common prefix/suffix trim — cheap, and bounds the LCS below.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let endA = a.length;
  let endB = b.length;
  while (endA > pre && endB > pre && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(pre, endA);
  const midB = b.slice(pre, endB);

  const out = [];
  const MAX_DP_CELLS = 1_000_000; // simpleDiff is a full-matrix LCS — guard it
  if (
    midA.length === 0 ||
    midB.length === 0 ||
    (midA.length + 1) * (midB.length + 1) > MAX_DP_CELLS
  ) {
    // Pure insertion/deletion (an empty side would round-trip through
    // join/split as one phantom "" line) or a pathological diff: one direct
    // block (still tells the agent WHERE and WHAT).
    out.push(`  @ line ${pre + 1}:`);
    for (const l of midA) out.push(`  - ${l}`);
    for (const l of midB) out.push(`  + ${l}`);
  } else {
    let lineB = pre; // 1-based final-file line = lineB + 1
    let inBlock = false;
    for (const d of simpleDiff(midA.join("\n"), midB.join("\n"))) {
      if (d.type === "same") {
        inBlock = false;
        lineB++;
        continue;
      }
      if (!inBlock) {
        out.push(`  @ line ${lineB + 1}:`);
        inBlock = true;
      }
      if (d.type === "remove") {
        out.push(`  - ${d.line}`);
      } else {
        out.push(`  + ${d.line}`);
        lineB++;
      }
    }
  }

  const header =
    "The user edited the proposal in the IDE diff before accepting — the " +
    "file was written with THEIR version. Their changes relative to your " +
    "proposal (-, proposed → +, applied):";
  let body = out;
  if (out.length > maxLines) {
    body = out.slice(0, maxLines);
    body.push(`  … (${out.length - maxLines} more lines changed)`);
  }
  let text = `${header}\n${body.join("\n")}`;
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars)}\n  … (truncated)`;
  }
  return text;
}

// ─── Explicit @selection / @diagnostics at-mentions (Claude-Code parity) ────
//
// The ambient `<ide-context>` block above shares the selection on every turn.
// These at-mentions are the *explicit* counterpart: when the user writes
// `@selection` or `@diagnostics` in their prompt, expand it against the
// connected IDE — the same surface Claude Code exposes as an at-mention.
// `@diagnostics` adds value the ambient block never had: the WHOLE workspace's
// current problems on demand (ambient diagnostics are only post-edit, one file).
//
// Deliberately NOT gated on CC_IDE_CONTEXT: that kill-switch silences ambient
// sharing, but an explicit `@mention` is a direct user request and should still
// work. It still requires the IDE tools to be connected; without them the
// mention is left in the prose and a warning is surfaced.

/** Workspace-wide diagnostics can be large; cap what we inline. */
const WORKSPACE_DIAG_CAP = 50;
/** Explicit `@terminal` pulls more history than the ambient block (2). */
const TERMINAL_MENTION_LIMIT = 5;
/** And a roomier per-command output cap, since the user asked for it. */
const TERMINAL_MENTION_OUTPUT_CAP = 2000;

// `@selection` / `@diagnostics` / `@terminal` preceded by start / whitespace /
// opening bracket-quote (so `foo@selection` and email-like text never match),
// each taken as a whole word.
const IDE_MENTION_RE = /(^|[\s("'`[{])@(selection|diagnostics|terminal)\b/gi;

/**
 * Unique IDE pseudo-mentions in the text, in first-seen order. Returns a
 * subset of `["selection", "diagnostics", "terminal"]`.
 */
export function findIdeMentions(text) {
  const src = typeof text === "string" ? text : "";
  const seen = new Set();
  const out = [];
  let m;
  IDE_MENTION_RE.lastIndex = 0;
  while ((m = IDE_MENTION_RE.exec(src)) !== null) {
    const kind = m[2].toLowerCase();
    if (!seen.has(kind)) {
      seen.add(kind);
      out.push(kind);
    }
  }
  return out;
}

/** Call one IDE MCP tool with args, returning its parsed JSON or null. */
async function callIdeToolJson(mcp, name, args, timeoutMs) {
  const exec = mcp?.externalToolExecutors?.[name];
  if (!exec || exec.kind !== "mcp" || !mcp.mcpClient?.callTool) return null;
  let p;
  try {
    p = mcp.mcpClient.callTool(exec.serverName, exec.toolName, args || {});
  } catch {
    return null;
  }
  return withTimeout(p.then(parseToolResultJson), timeoutMs);
}

/** Render a getSelection result as a tagged `@selection` block, or null. */
export function formatSelectionMention(sel) {
  if (!sel || typeof sel.text !== "string" || sel.text.length === 0) {
    return null;
  }
  const start = sel.selection?.start?.line;
  const end = sel.selection?.end?.line;
  const range =
    Number.isInteger(start) && Number.isInteger(end)
      ? `:${start + 1}-${end + 1}` // editor lines are 0-based
      : "";
  const text =
    sel.text.length > SELECTION_TEXT_CAP
      ? sel.text.slice(0, SELECTION_TEXT_CAP) + "\n...(selection truncated)"
      : sel.text;
  return (
    '<ide-selection note="referenced via @selection">\n' +
    `${sel.file || "the active editor"}${range}:\n` +
    text +
    "\n</ide-selection>"
  );
}

/** Render a getDiagnostics result as a tagged `@diagnostics` block, or null. */
export function formatDiagnosticsMention(data) {
  const all = Array.isArray(data?.diagnostics) ? data.diagnostics : null;
  if (!all) return null;
  const relevant = all.filter(
    (d) => d && DIAG_SEVERITIES.has(String(d.severity).toLowerCase()),
  );
  if (relevant.length === 0) return null;
  const shown = relevant.slice(0, WORKSPACE_DIAG_CAP).map((d) => {
    const loc = Number.isInteger(d.line) ? `:${d.line + 1}` : "";
    const src = d.source ? ` (${d.source})` : "";
    return `  [${d.severity}] ${d.file || ""}${loc} ${d.message || ""}${src}`.trimEnd();
  });
  const more = relevant.length - shown.length;
  return (
    '<ide-diagnostics note="referenced via @diagnostics — current workspace problems">\n' +
    shown.join("\n") +
    (more > 0 ? `\n  (+${more} more)` : "") +
    "\n</ide-diagnostics>"
  );
}

/** Render a getTerminalOutput result as a tagged `@terminal` block, or null. */
export function formatTerminalMention(data) {
  const all = Array.isArray(data?.terminals) ? data.terminals : null;
  if (!all || all.length === 0) return null;
  const shown = all
    .slice(-TERMINAL_MENTION_LIMIT)
    .filter((t) => t && typeof t.command === "string");
  if (shown.length === 0) return null;
  const lines = [];
  for (const t of shown) {
    const code = t.exitCode == null ? "" : ` (exit ${t.exitCode})`;
    let outp = typeof t.output === "string" ? t.output : "";
    const truncated =
      outp.length > TERMINAL_MENTION_OUTPUT_CAP || t.outputTruncated;
    if (outp.length > TERMINAL_MENTION_OUTPUT_CAP) {
      outp = outp.slice(-TERMINAL_MENTION_OUTPUT_CAP);
    }
    lines.push(`  $ ${t.command}${code}`);
    if (outp.trim().length > 0) {
      lines.push(outp + (truncated ? "\n  …(output truncated)" : ""));
    }
  }
  return (
    '<ide-terminal note="referenced via @terminal — recent integrated-terminal commands">\n' +
    lines.join("\n") +
    "\n</ide-terminal>"
  );
}

/**
 * Expand `@selection` / `@diagnostics` / `@terminal` mentions found in `text`
 * against the connected IDE. Returns
 *   { block: string|null, expanded: string[], warnings: string[] }
 * where `block` is the concatenated context block(s) to APPEND to the user
 * turn (it never includes the original prose — the caller already has that),
 * `expanded` lists the mentions that produced content, and `warnings` explains
 * any that did not (no IDE, empty selection, no problems). Never throws.
 */
export async function expandIdeMentions(text, mcp, opts = {}) {
  const out = { block: null, expanded: [], warnings: [] };
  const src = typeof text === "string" ? text : "";
  if (!src.includes("@")) return out;
  const mentions = findIdeMentions(src);
  if (mentions.length === 0) return out;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const env = opts.env || process.env;
  const blocks = [];
  for (const kind of mentions) {
    try {
      if (kind === "selection") {
        if (!hasIdeContextTools(mcp)) {
          out.warnings.push(
            "@selection — no IDE bridge connected (left as-is)",
          );
          continue;
        }
        const sel = sanitizeIdeSelection(
          await callIdeToolJson(mcp, "mcp__ide__getSelection", {}, timeoutMs),
          env,
        );
        const b = formatSelectionMention(sel);
        if (b) {
          blocks.push(b);
          out.expanded.push("selection");
        } else {
          out.warnings.push("@selection — no active selection (left as-is)");
        }
      } else if (kind === "diagnostics") {
        if (!hasIdeDiagnosticsTool(mcp)) {
          out.warnings.push(
            "@diagnostics — no IDE bridge connected (left as-is)",
          );
          continue;
        }
        const data = await callIdeToolJson(
          mcp,
          "mcp__ide__getDiagnostics",
          {},
          timeoutMs,
        );
        const safe =
          data && Array.isArray(data.diagnostics)
            ? {
                ...data,
                diagnostics: sanitizeIdeDiagnostics(data.diagnostics, env),
              }
            : data;
        const b = formatDiagnosticsMention(safe);
        if (b) {
          blocks.push(b);
          out.expanded.push("diagnostics");
        } else {
          out.warnings.push("@diagnostics — no problems reported (left as-is)");
        }
      } else if (kind === "terminal") {
        if (!hasIdeTerminalTool(mcp)) {
          out.warnings.push(
            "@terminal — no IDE bridge / terminal support (left as-is)",
          );
          continue;
        }
        const data = await callIdeToolJson(
          mcp,
          "mcp__ide__getTerminalOutput",
          { limit: TERMINAL_MENTION_LIMIT },
          timeoutMs,
        );
        const safe =
          data && Array.isArray(data.terminals)
            ? { ...data, terminals: sanitizeIdeTerminals(data.terminals, env) }
            : data;
        const b = formatTerminalMention(safe);
        if (b) {
          blocks.push(b);
          out.expanded.push("terminal");
        } else {
          out.warnings.push("@terminal — no recent commands (left as-is)");
        }
      }
    } catch {
      // best-effort: a single failed mention never blocks the turn
    }
  }
  if (blocks.length > 0) out.block = blocks.join("\n\n");
  return out;
}

/**
 * Render pulled diagnostics as a compact feedback string for the tool result.
 * Returns null when there is nothing to report.
 */
export function formatIdeDiagnostics(diags, { cap = DIAG_CAP } = {}) {
  if (!Array.isArray(diags) || diags.length === 0) return null;
  const shown = diags.slice(0, cap).map((d) => {
    const loc = Number.isInteger(d.line) ? `:${d.line + 1}` : "";
    const src = d.source ? ` (${d.source})` : "";
    return `  [${d.severity}] ${d.file || ""}${loc} ${d.message || ""}${src}`.trimEnd();
  });
  const more = diags.length - shown.length;
  return (
    `IDE diagnostics after this edit (${diags.length} problem${diags.length === 1 ? "" : "s"}):\n` +
    shown.join("\n") +
    (more > 0 ? `\n  (+${more} more)` : "")
  );
}
