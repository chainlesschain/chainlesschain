/**
 * `/memory` REPL command (Claude-Code parity) — show the project-memory files
 * the agent auto-loads into its system prompt (the cc.md > CLAUDE.md > AGENTS.md
 * hierarchy + @imports + path-scoped rules), so "why does it know/behave like
 * this?" is answerable in-session. Distinct from `#` (append a note to cc.md)
 * and `cc memory recall` (the scoped MemoryStore).
 *
 * Pure: renders a loadProjectInstructions() result. The REPL does the I/O.
 */

/**
 * @param {{files?:Array<{path:string,scope:string,bytes?:number,truncated?:boolean}>,warnings?:string[]}} loaded
 * @param {{enabled?:boolean}} [opts]  enabled=false when CC_PROJECT_MEMORY=0
 * @returns {string}
 */
export function renderMemoryFiles(loaded, { enabled = true } = {}) {
  const files = Array.isArray(loaded?.files) ? loaded.files : [];
  const warnings = Array.isArray(loaded?.warnings) ? loaded.warnings : [];
  const lines = ["Project memory (auto-loaded into the system prompt):"];

  if (!enabled) {
    lines.push(
      "  ⚠ disabled via CC_PROJECT_MEMORY=0 — the files below are NOT loaded this session",
    );
  }

  if (files.length === 0) {
    lines.push("  (none found — run `cc init` to generate a cc.md)");
    return lines.join("\n");
  }

  let total = 0;
  for (const f of files) {
    const bytes = Number(f.bytes) || 0;
    total += bytes;
    lines.push(
      `  [${String(f.scope || "?").padEnd(7)}] ${f.path}  ${bytes}B${f.truncated ? " (truncated)" : ""}`,
    );
  }
  lines.push(
    `  ${files.length} file(s), ${total}B total · precedence cc.md > CLAUDE.md > AGENTS.md`,
  );
  for (const w of warnings) lines.push(`  ⚠ ${w}`);
  return lines.join("\n");
}
