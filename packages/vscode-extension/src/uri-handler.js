/**
 * Pure parser for ChainlessChain deep links — Claude-Code `vscode://…/open`
 * parity. An external tool, doc button, or the CLI can open
 *   vscode://chainlesschain.chainlesschain-ide/open
 *   vscode://chainlesschain.chainlesschain-ide/open?prompt=fix%20the%20bug
 * to focus the chat panel (and optionally seed a prompt).
 *
 * vscode-free so it unit-tests without a host. The extension's handleUri() just
 * feeds it `{ path, query }` from the incoming Uri and acts on the result.
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

/**
 * Parse an incoming deep link into an action. Returns `{ action:"open", prompt? }`
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
  return out;
}

module.exports = { parseDeepLink };
