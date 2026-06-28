/**
 * Pure renderer for the `/hooks` REPL command — a user-facing view of the
 * decision-capable `.claude/settings.json` `hooks` block loaded for this
 * session. The data comes from settings-hooks' loadHooks(); this module only
 * formats it, so it stays deterministic and unit-testable.
 *
 * Mirrors Claude Code's /hooks view. The separate observe-only DB hooks
 * (`cc hook add`) are not part of this block — a pointer to `cc hook list` is
 * shown instead.
 *
 * Input shape (the settings.json `hooks` object):
 *   { <Event>: [ { matcher, hooks: [ { type, command, timeout } ] } ], ... }
 *   Event ∈ PreToolUse | PostToolUse | UserPromptSubmit | SessionStart |
 *           SessionEnd | Stop | PreCompact | SubagentStop | Notification
 */

/** One hook command rendered to a single line. */
function fmtHook(h) {
  if (!h || typeof h !== "object") return "    (invalid hook)";
  const cmd =
    h.type === "command"
      ? String(h.command || "").trim() || "(no command)"
      : `(${h.type || "unknown"} hook)`;
  const to =
    h.timeout != null && Number.isFinite(Number(h.timeout))
      ? ` [timeout ${Number(h.timeout)}s]`
      : "";
  return `      ${cmd}${to}`;
}

/**
 * Render the loaded settings.json hooks block as a plain-text block.
 * @param {object|null} hooks  the merged `hooks` object, or null when none
 */
export function formatSettingsHooks(hooks) {
  const events =
    hooks && typeof hooks === "object" ? Object.keys(hooks) : [];
  if (events.length === 0) {
    return (
      "No settings.json hooks loaded.\n" +
      "  Define a `hooks` block in .claude/settings.json (PreToolUse / " +
      "PostToolUse / UserPromptSubmit / SessionStart / Stop / PreCompact / …).\n" +
      "  Observe-only DB hooks: cc hook list"
    );
  }
  let total = 0;
  const body = [];
  for (const ev of events) {
    const entries = Array.isArray(hooks[ev]) ? hooks[ev] : [];
    body.push(`  ${ev}:`);
    for (const entry of entries) {
      const matcher = entry?.matcher ? String(entry.matcher) : "*";
      body.push(`    matcher ${matcher}`);
      const hs = Array.isArray(entry?.hooks) ? entry.hooks : [];
      for (const h of hs) {
        total += 1;
        body.push(fmtHook(h));
      }
    }
  }
  const header = `settings.json hooks (decision-capable, ${total} command(s) across ${events.length} event(s)):`;
  return (
    header +
    "\n" +
    body.join("\n") +
    "\n  Test a hook: cc hook test <event> <tool> --run · observe-only DB hooks: cc hook list"
  );
}
