/**
 * Multiline REPL input via backslash continuation (Claude-Code multiline parity).
 *
 * Node's readline submits on every Enter, so a single prompt is one line. This
 * pure helper lets the REPL accumulate a multi-line prompt: a physical line that
 * ends with a continuation backslash keeps the prompt open and the next line is
 * appended (joined with "\n"), so code blocks / multi-paragraph prompts can be
 * entered without a turn firing per line.
 *
 * The rule is shell-like but Windows-path-safe: a trailing backslash continues
 * the line ONLY when it is a lone `\` or the backslash run is preceded by
 * whitespace, and the run length is odd (so `\\` stays a literal backslash).
 * That keeps a stray path like `dir C:\` from being swallowed as a continuation.
 *
 *   analyzeContinuation("write a function \\") → { continued:true,  text:"write a function" }
 *   analyzeContinuation("dir C:\\")            → { continued:false, text:"dir C:\\" }
 *   analyzeContinuation("plain line")          → { continued:false, text:"plain line" }
 *
 * The REPL keeps an array of `text` pieces and `joinContinuation()` stitches the
 * final submission.
 */

/** Count the run of backslashes at the very end of a string. */
function trailingBackslashes(s) {
  let n = 0;
  for (let i = s.length - 1; i >= 0 && s[i] === "\\"; i--) n++;
  return n;
}

/**
 * Decide whether a physical input line continues onto the next one.
 *
 * @param {string} line  the raw line as readline delivered it
 * @returns {{ continued:boolean, text:string }}
 *   continued → drop the trailing backslash (+ the space before it) and wait for
 *   more; not continued → the line stands as typed (text === line).
 */
export function analyzeContinuation(line) {
  const s = typeof line === "string" ? line : "";
  const n = trailingBackslashes(s);
  if (n === 0 || n % 2 === 0) return { continued: false, text: s };
  // Odd trailing backslashes: gate on what precedes the run so Windows paths
  // (no preceding whitespace) are not treated as continuations.
  const before = s[s.length - n - 1]; // undefined when the run is the whole line
  const gated = before === undefined || /\s/.test(before);
  if (!gated) return { continued: false, text: s };
  // Strip exactly one trailing backslash, then trim the now-trailing whitespace
  // so the join reads cleanly.
  const text = s.slice(0, s.length - 1).replace(/\s+$/, "");
  return { continued: true, text };
}

/**
 * Stitch accumulated continuation pieces plus the final line into one prompt.
 *
 * @param {string[]} pieces  prior `text` values from continued lines
 * @param {string} finalLine the line that ended the continuation (raw)
 * @returns {string}
 */
export function joinContinuation(pieces, finalLine) {
  const parts = Array.isArray(pieces) ? pieces.slice() : [];
  parts.push(typeof finalLine === "string" ? finalLine : "");
  return parts.join("\n");
}
