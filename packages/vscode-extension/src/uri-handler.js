/**
 * Pure parser for ChainlessChain deep links — Claude-Code `vscode://…/open`
 * parity. An external tool, doc button, or the CLI can open
 *   vscode://chainlesschain.chainlesschain-ide/open
 *   vscode://chainlesschain.chainlesschain-ide/open?prompt=fix%20the%20bug
 *   vscode://…/open?session=panel-1720&file=C:\repo\a.ts&line=42&mode=default
 * to focus the chat panel, seed a prompt, resume a session, and/or reveal a
 * file at a line.
 *
 * vscode-free so it unit-tests without a host. The extension's handleUri() just
 * feeds it `{ path, query }` from the incoming Uri and acts on the result.
 *
 * SECURITY: a deep link is UNTRUSTED input (a web page can invoke
 * `vscode://…`). So: the prompt is only SEEDED (never auto-sent — the human
 * reviews and hits Send); `mode` accepts only the safe approval modes and
 * NEVER `bypassPermissions` (an external link must not be able to arm
 * auto-approval); ids/lines are shape-validated; and `workspace` is returned
 * verbatim for the host to compare against the open folder (so a link meant for
 * repo A doesn't act on repo B).
 */

/** Percent/`+`-decode a query token, never throwing on a malformed escape. */
function decodeSafe(s) {
  try {
    return decodeURIComponent(String(s).replace(/\+/g, " "));
  } catch {
    return String(s).replace(/\+/g, " ");
  }
}

/** First value of `key` in a raw `a=1&b=2` query string, or null. */
function getQueryParam(query, key) {
  const raw = String(query || "");
  if (!raw) return null;
  for (const pair of raw.split("&")) {
    if (!pair) continue;
    const i = pair.indexOf("=");
    const k = decodeSafe(i < 0 ? pair : pair.slice(0, i));
    if (k === key) return decodeSafe(i < 0 ? "" : pair.slice(i + 1));
  }
  return null;
}

// Approval modes a deep link may request. bypassPermissions is DELIBERATELY
// absent — an untrusted link must not be able to arm auto-approval; the user
// can still switch to it manually inside the panel.
const SAFE_DEEP_LINK_MODES = new Set(["default", "acceptEdits", "plan"]);

// A session id is our own `panel-<ts>-<rand>` / CLI id shape — conservative
// allowlist so a junk/oversized value never reaches `cc … --resume`.
const SESSION_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

/** Clean + validate a session id, or null. */
function normalizeSession(raw) {
  const s = (raw || "").trim();
  return SESSION_ID_RE.test(s) ? s : null;
}

/** Parse a 1-based line number, or null (0/negative/NaN/huge → null). */
function normalizeLine(raw) {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isInteger(n) || n < 1 || n > 2_000_000_000) return null;
  return n;
}

/**
 * Parse an incoming deep link into an action. Returns
 *   `{ action:"open", prompt?, session?, file?, line?, workspace?, mode? }`
 * for `/open` (the bare authority also maps to "open"), or null for anything we
 * don't handle — so an unknown path is ignored rather than misfiring.
 *
 * @param {{path?:string, query?:string}} uri
 */
function parseDeepLink(uri = {}) {
  const path = String(uri.path || "")
    .replace(/^\/+/, "")
    .toLowerCase();
  const action = path || "open";
  if (action !== "open") return null; // only /open is supported today

  const out = { action: "open" };

  const prompt = getQueryParam(uri.query, "prompt");
  if (prompt && prompt.trim()) out.prompt = prompt;

  const session = normalizeSession(getQueryParam(uri.query, "session"));
  if (session) out.session = session;

  // File path is kept VERBATIM (already percent-decoded) so Windows drive
  // paths, spaces, and non-ASCII (中文/emoji) round-trip untouched; the host
  // resolves it against the workspace.
  const file = getQueryParam(uri.query, "file");
  if (file && file.trim()) {
    out.file = file;
    const line = normalizeLine(getQueryParam(uri.query, "line"));
    if (line) out.line = line; // a line without a file is meaningless → dropped
  }

  const workspace = getQueryParam(uri.query, "workspace");
  if (workspace && workspace.trim()) out.workspace = workspace;

  const mode = (getQueryParam(uri.query, "mode") || "").trim();
  if (SAFE_DEEP_LINK_MODES.has(mode)) out.mode = mode;

  return out;
}

module.exports = { parseDeepLink, SAFE_DEEP_LINK_MODES };
