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

/** Hard cap on the selected text we inline into the prompt. */
const SELECTION_TEXT_CAP = 2000;
/** At most this many open-editor entries are listed. */
const OPEN_EDITORS_CAP = 10;
/** Per-tool-call budget; the IDE answers from memory, so this is generous. */
const DEFAULT_TIMEOUT_MS = 1500;

/** Env kill-switch: CC_IDE_CONTEXT=0|false|off disables injection. */
export function ideContextEnabled(env = process.env) {
  const v = String(env?.CC_IDE_CONTEXT ?? "").toLowerCase();
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
  const call = (name) => {
    const exec = executors[name];
    if (!exec || exec.kind !== "mcp") return Promise.resolve(null);
    let p;
    try {
      p = mcp.mcpClient.callTool(exec.serverName, exec.toolName, {});
    } catch {
      return Promise.resolve(null);
    }
    return withTimeout(p.then(parseToolResultJson), timeoutMs);
  };
  const [selection, editors] = await Promise.all([
    call("mcp__ide__getSelection"),
    call("mcp__ide__getOpenEditors"),
  ]);
  const openEditors = Array.isArray(editors?.editors) ? editors.editors : null;
  if (!selection && !(openEditors && openEditors.length > 0)) return null;
  return { selection: selection || null, openEditors };
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
