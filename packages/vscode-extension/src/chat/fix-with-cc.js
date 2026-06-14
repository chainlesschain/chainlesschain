/**
 * "Fix with ChainlessChain" — pure helpers for the diagnostics quick-fix
 * (Claude Code IDE parity: a lightbulb / context action on an error or warning
 * that seeds the chat panel with a fix request scoped to THIS file + THESE
 * problems). vscode-free → unit-testable without a host; the thin
 * CodeActionProvider glue lives in src/code-actions.js.
 */

// vscode DiagnosticSeverity: Error=0, Warning=1, Information=2, Hint=3.
const SEVERITY_LABEL = ["Error", "Warning", "Info", "Hint"];

const MAX_DIAGNOSTICS = 10; // a fix request shouldn't dump a whole noisy file
const MAX_MESSAGE_LEN = 300;

function severityLabel(sev) {
  return SEVERITY_LABEL[typeof sev === "number" ? sev : 0] || "Problem";
}

/** A diagnostic's code can be a primitive or a { value } object — normalize. */
function diagnosticCode(code) {
  if (code == null) return "";
  if (typeof code === "string" || typeof code === "number") return String(code);
  if (typeof code === "object" && code.value != null) return String(code.value);
  return "";
}

/** Collapse whitespace + truncate a (possibly multi-line) diagnostic message. */
function tidyMessage(msg) {
  const s = String(msg == null ? "" : msg)
    .replace(/\s+/g, " ")
    .trim();
  return s.length > MAX_MESSAGE_LEN ? s.slice(0, MAX_MESSAGE_LEN - 1) + "…" : s;
}

/** One human-readable bullet: `- [Error] line 13: <msg> (ts 2304)`. */
function formatDiagnosticLine(d) {
  const line = (typeof d.line === "number" ? d.line : 0) + 1; // 0-based → 1-based
  const where = d.source
    ? `${d.source}${diagnosticCode(d.code) ? " " + diagnosticCode(d.code) : ""}`
    : diagnosticCode(d.code);
  const tail = where ? ` (${where})` : "";
  return `- [${severityLabel(d.severity)}] line ${line}: ${tidyMessage(d.message)}${tail}`;
}

/** True when there's at least one diagnostic worth offering a fix for. */
function hasFixableDiagnostics(diagnostics) {
  return Array.isArray(diagnostics) && diagnostics.length > 0;
}

/** Lightbulb / context-menu title — singular vs counted. */
function buildFixActionTitle(diagnostics) {
  const n = Array.isArray(diagnostics) ? diagnostics.length : 0;
  return n > 1
    ? `Fix ${n} problems with ChainlessChain`
    : "Fix with ChainlessChain";
}

/**
 * Build the prompt text seeded into the chat input. References the file as
 * `@<relPath>` so the CLI's file-ref expander attaches its contents, then
 * lists the problems. Ends with a newline so the user can keep typing.
 */
function formatFixPrompt({ relPath, diagnostics } = {}) {
  const list = (Array.isArray(diagnostics) ? diagnostics : []).slice(
    0,
    MAX_DIAGNOSTICS,
  );
  if (!list.length) return "";
  const path = String(relPath || "")
    .replace(/\\/g, "/")
    .trim();
  const target = path ? `@${path}` : "this file";
  const noun = list.length > 1 ? "problems" : "problem";
  const head = `Fix the following ${noun} in ${target} and briefly explain the change:`;
  const bullets = list.map(formatDiagnosticLine);
  const omitted =
    diagnostics.length > MAX_DIAGNOSTICS
      ? [`- …and ${diagnostics.length - MAX_DIAGNOSTICS} more`]
      : [];
  return [head, ...bullets, ...omitted].join("\n") + "\n";
}

module.exports = {
  SEVERITY_LABEL,
  MAX_DIAGNOSTICS,
  severityLabel,
  diagnosticCode,
  tidyMessage,
  formatDiagnosticLine,
  hasFixableDiagnostics,
  buildFixActionTitle,
  formatFixPrompt,
};
