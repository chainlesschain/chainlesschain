/**
 * Argv escaping for Windows `shell: true` spawns.
 *
 * On Windows every `cc` invocation goes through `cmd.exe` (`shell: true`,
 * because the npm global shim is a `.cmd` batch file) — and Node joins the
 * args array into the command line with PLAIN SPACES, no quoting. Any
 * user-typed token (a handoff prompt, a rename title, a resume prompt, a
 * relay URL from workspace settings) that contains cmd metacharacters
 * (`&`, `|`, `<`, `>`, `^`, `"`, `%`, …) is therefore either mangled or —
 * for `&`/`|` — executed as a SECOND command. `Continue the task & run
 * tests` literally runs `run tests`.
 *
 * `escapeCmdArg` implements the cross-spawn escaping algorithm:
 *   1. msvcrt argument quoting (double trailing backslashes, `\"` for
 *      embedded quotes, wrap in `"…"`) so the target program's argv parser
 *      reconstructs the exact string;
 *   2. `^`-escape every cmd metacharacter so cmd.exe passes the quoted
 *      token through verbatim;
 *   3. once more for batch targets — cmd.exe re-parses the command line a
 *      second time when the target is a `.cmd`/`.bat` (our `cc` shim always
 *      is), so metacharacters need double `^^`-escaping to survive both
 *      passes.
 *
 * Pure (no `vscode`), platform injectable for tests. On non-Windows the
 * token is returned untouched — POSIX spawns here don't use a shell.
 */

const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/**
 * Escape one argv token for a `shell: true` spawn of a batch-file target.
 *
 * @param {string} arg  the raw token
 * @param {object} [opts]
 * @param {string} [opts.platform]  override for tests; defaults to process.platform
 * @returns {string} the token, escaped for cmd.exe on win32, verbatim elsewhere
 */
function escapeCmdArg(arg, opts = {}) {
  const platform = opts.platform || process.platform;
  const s = String(arg ?? "");
  if (platform !== "win32") return s;
  // msvcrt quoting: backslashes only need doubling when they precede a
  // quote (embedded or the closing one we add).
  let escaped = s.replace(/(\\*)"/g, '$1$1\\"');
  escaped = escaped.replace(/(\\*)$/, "$1$1");
  escaped = `"${escaped}"`;
  // cmd.exe pass 1 + pass 2 (batch target re-parse).
  escaped = escaped.replace(CMD_META, "^$1");
  escaped = escaped.replace(CMD_META, "^$1");
  return escaped;
}

/** Escape every token of an argv array (see escapeCmdArg). */
function escapeCmdArgs(args, opts = {}) {
  return (Array.isArray(args) ? args : []).map((a) => escapeCmdArg(a, opts));
}

module.exports = { escapeCmdArg, escapeCmdArgs };
