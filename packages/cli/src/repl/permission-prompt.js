/**
 * Build the header line for the REPL's interactive permission prompt.
 *
 * The confirmer is shared by three callers that pass different shapes:
 *   - settings `ask` rules / hook `ask`  → `rule` is set (e.g. "Bash", "hook:…")
 *   - the destructive-git guard           → `reason` is set, `rule` is null
 *   - the sensitive-file-write guard      → `reason` is set, `rule` is null
 * The previous template interpolated `${rule}` unconditionally, so the
 * rule-less guards rendered a literal "null" in the prompt. This picks the
 * right phrasing for each case.
 *
 * Pure + side-effect-free so it is unit-testable (the interactive confirmer
 * closure that consumes it cannot be driven over piped stdin).
 *
 * @returns {string} the prompt header (no styling, no trailing "Proceed?")
 */
export function buildPermissionPrompt({ tool, args, rule, reason } = {}) {
  const detail = args?.command
    ? ` ${args.command}`
    : args?.path
      ? ` ${args.path}`
      : "";
  if (rule) return `[Permission] rule "${rule}" asks before ${tool}:${detail}`;
  if (reason) return `[Permission] ${reason}`;
  return `[Permission] confirm ${tool}:${detail}`;
}
