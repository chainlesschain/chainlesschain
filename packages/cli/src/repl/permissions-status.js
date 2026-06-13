/**
 * `/permissions` REPL command (Claude-Code parity) — show the allow / ask /
 * deny rules in effect for THIS session (loaded from .claude/settings.json by
 * settings-loader, applied by permission-rules in agent-core's executeTool).
 * These rules are otherwise invisible mid-session; surfacing them tells the
 * user exactly what the agent can do unprompted, what it asks about, and what
 * is blocked.
 *
 * Pure: takes the effective rules ({allow,ask,deny}) + the contributing source
 * files, returns plain text. The REPL does the I/O.
 */

function pushGroup(lines, label, marker, rules) {
  const list = Array.isArray(rules) ? rules : [];
  if (list.length === 0) return;
  lines.push(`  ${label}:`);
  for (const r of list) lines.push(`    ${marker} ${r}`);
}

/**
 * @param {{allow?:string[],ask?:string[],deny?:string[]}|null} rules
 * @param {{files?:string[]}} [opts]
 * @returns {string}
 */
export function renderPermissions(rules, { files = [] } = {}) {
  const r = rules || { allow: [], ask: [], deny: [] };
  const count =
    (r.allow?.length || 0) + (r.ask?.length || 0) + (r.deny?.length || 0);

  if (count === 0) {
    return [
      "Permission rules: none configured.",
      "  Tools run under the default gate — dangerous shell commands still",
      "  always require approval. Add rules in .claude/settings.json or via",
      "  `cc permissions add`.",
    ].join("\n");
  }

  const lines = ["Permission rules (effective this session):"];
  // Render most-restrictive first to mirror the deny > ask > allow precedence.
  pushGroup(lines, "deny  (blocked)", "✗", r.deny);
  pushGroup(lines, "ask   (prompt first)", "?", r.ask);
  pushGroup(lines, "allow (auto-approved)", "✓", r.allow);
  if (Array.isArray(files) && files.length) {
    lines.push(`  sources: ${files.join(", ")}`);
  }
  lines.push(
    "  precedence: deny > ask > allow · dangerous shell commands are always denied",
  );
  return lines.join("\n");
}
