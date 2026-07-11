/**
 * IDE-context redaction — the implicit-context counterpart of the credential
 * READ guard ([[credential-guard.js]]).
 *
 * The IDE bridge shares editor state (selection text, open-editor tabs,
 * terminal output, diagnostics) with every prompt WITHOUT any tool-permission
 * gate: nothing was "read" through read_file, so denyRead rules and the
 * credential guard never fire. An open `.env` tab or an `export API_KEY=…`
 * still visible in the integrated terminal would ride straight into model
 * context. This module closes that side door:
 *
 *   1. `filterIdeFileEntry` — file-path entries (open editors, selection file,
 *      diagnostics files) that name a credential file are dropped, reusing the
 *      exact same `credentialFileReason` patterns the read guard enforces. The
 *      non-resolved variant is deliberate: these paths come from the IDE, may
 *      not exist locally, and a pure string check never touches the fs.
 *   2. `redactSecretsInText` — free text (selection, terminal output,
 *      diagnostic messages) is scrubbed with a conservative set of secret
 *      shapes: AWS access-key ids, Bearer tokens, PEM private-key blocks,
 *      well-known token prefixes, and `SECRET_NAME = value` assignments (only
 *      the VALUE is swallowed — key names and ordinary code survive).
 *
 * Precision over recall, same posture as the guards: a redactor that mangles
 * everyday code teaches users to turn it off. `CC_IDE_CONTEXT_REDACTION=0`
 * disables (default ON).
 */

import {
  credentialFileReason,
  _internals as credentialGuardInternals,
} from "./credential-guard.js";

const REDACTED = "[REDACTED]";
const REDACTED_FILE = "[redacted credential file]";

// Boundary-delimited secret words (KEY / TOKEN / SECRET / PASSWORD / …) —
// shared with the credential guard so both surfaces agree on what "looks
// secret".
const SECRET_VAR_RE = credentialGuardInternals.SECRET_VAR_RE;

// AWS access-key ids are globally unique, fixed-shape strings.
const AWS_ACCESS_KEY_RE = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g;

// `Bearer <token>` in headers / curl lines / pasted requests.
const BEARER_RE = /\b(Bearer)\s+[A-Za-z0-9\-._~+/=]{8,}/g;

// PEM private-key blocks — the bytes ARE the secret. A block whose END marker
// was truncated off still redacts to the end of the text (fail toward safety).
const PEM_PRIVATE_KEY_RE =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g;

// High-precision vendor token prefixes (OpenAI/Anthropic sk-, GitHub PATs,
// GitLab PATs, Slack xox*) — unambiguous even outside an assignment.
const TOKEN_PREFIX_RE =
  /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g;

// `API_KEY = "value"` / `token: value` / JSON `"secret": "value"` — the key
// must contain a boundary-delimited secret word, the value must be a bare
// token-like run (≥8 chars, no spaces). The trailing lookahead rejects values
// that continue into a call — `token = getToken()` is code, not a secret.
// Only the value is replaced; the key and separator are kept so the agent
// still sees WHAT was configured, just not the secret itself.
const ASSIGNMENT_RE =
  /\b([A-Za-z_][A-Za-z0-9_-]*)(["']?\s*[=:]\s*)(["']?)([A-Za-z0-9+/=_.\-]{8,})\3(?![A-Za-z0-9+/=_.\-(])/g;

/**
 * Env kill-switch: CC_IDE_CONTEXT_REDACTION=0|false|no|off disables all IDE
 * context redaction. Default ON — only an explicit opt-out turns it off.
 */
export function ideRedactionEnabled(env = process.env) {
  const raw = env && env.CC_IDE_CONTEXT_REDACTION;
  return !(raw != null && /^(0|false|no|off)$/i.test(String(raw).trim()));
}

/**
 * Gate one IDE-supplied file-path entry (open-editor tab, selection file,
 * diagnostic file). Returns the path unchanged when it is fine to share, or
 * null when it names a credential/secret file and the whole entry must be
 * dropped (or replaced with the `REDACTED_FILE_PLACEHOLDER`).
 *
 * Pure string check by design (non-resolved `credentialFileReason`): IDE paths
 * may be remote/virtual, and a context filter must never do fs I/O. `cwd` is
 * accepted for signature parity with the resolved guards but unused here.
 *
 * @param {string} filePath
 * @param {object} [opts] { cwd?, env? }
 * @returns {string|null}
 */
export function filterIdeFileEntry(filePath, opts = {}) {
  const p = String(filePath || "");
  if (!p) return filePath ?? null;
  if (!ideRedactionEnabled(opts.env || process.env)) return filePath;
  return credentialFileReason(p) ? null : filePath;
}

/**
 * Scrub secret-shaped substrings out of IDE-supplied free text (selection
 * text, terminal output, diagnostic messages). Non-strings pass through
 * untouched; with the kill-switch off the text is returned as-is.
 *
 * @param {string} text
 * @param {object} [opts] { env? }
 * @returns {string}
 */
export function redactSecretsInText(text, opts = {}) {
  if (typeof text !== "string" || text.length === 0) return text;
  if (!ideRedactionEnabled(opts.env || process.env)) return text;
  let out = text;
  out = out.replace(PEM_PRIVATE_KEY_RE, REDACTED);
  out = out.replace(BEARER_RE, (_m, word) => `${word} ${REDACTED}`);
  out = out.replace(AWS_ACCESS_KEY_RE, REDACTED);
  out = out.replace(TOKEN_PREFIX_RE, REDACTED);
  out = out.replace(ASSIGNMENT_RE, (m, key, sep, quote, _value) => {
    // Hyphens count as segment boundaries too (api-key ≙ api_key).
    if (!SECRET_VAR_RE.test(key.replace(/-/g, "_"))) return m;
    return `${key}${sep}${quote}${REDACTED}${quote}`;
  });
  return out;
}

export const REDACTED_MARKER = REDACTED;
export const REDACTED_FILE_PLACEHOLDER = REDACTED_FILE;

export const _internals = {
  AWS_ACCESS_KEY_RE,
  BEARER_RE,
  PEM_PRIVATE_KEY_RE,
  TOKEN_PREFIX_RE,
  ASSIGNMENT_RE,
};
