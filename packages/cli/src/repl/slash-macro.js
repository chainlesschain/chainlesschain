/**
 * resolveSlashMacro — the REPL's user-command-macro wire.
 *
 * Maps a raw REPL line to a user-defined command macro (.claude/commands/*.md).
 * A leading `/name` whose first whitespace-delimited token resolves to a macro
 * is expanded ($ARGUMENTS/$1.. + bang + @file, via slash-commands). Plain text
 * or an unknown `/...` is returned unchanged so it reaches the LLM verbatim --
 * e.g. asking about a path like "/etc/hosts" is never swallowed.
 *
 * Kept in its own tiny module (free of the heavy REPL import chain) so it is
 * cheap to unit-test, and it accepts injected deps for hermetic tests.
 */

/**
 * @param {string} input  raw REPL line
 * @param {object} [opts] { cwd, deps:{ getCommand, expandCommand } }
 * @returns {Promise<{matched:boolean, promptText:string, warnings:string[],
 *                    name?:string, scope?:string, model?:string|null,
 *                    allowedTools?:string|null}>}
 *   `model` / `allowedTools` are the matched command's frontmatter (or null),
 *   so a caller running the macro as a whole turn can scope the run the same
 *   way `cc command run` does.
 */
export async function resolveSlashMacro(input, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const trimmed = String(input ?? "").trim();
  if (!trimmed.startsWith("/")) {
    return { matched: false, promptText: trimmed, warnings: [] };
  }
  const [head, ...rest] = trimmed.slice(1).split(/\s+/);
  const { getCommand, expandCommand } =
    opts.deps || (await import("../lib/slash-commands.js"));
  const macro = head ? getCommand(head, cwd) : null;
  if (!macro) {
    return { matched: false, promptText: trimmed, warnings: [] };
  }
  const { prompt: expanded, warnings } = expandCommand(
    macro,
    rest.filter(Boolean),
    { cwd },
  );
  return {
    matched: true,
    promptText: expanded,
    warnings,
    name: macro.name,
    scope: macro.scope,
    model: macro.model || null,
    allowedTools: macro.allowedTools || null,
  };
}
