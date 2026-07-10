/**
 * `cc agent --disable-slash-commands` — REPL slash-dispatch bypass predicate.
 *
 * When active, a "/"-leading line is NOT dispatched to the built-in slash
 * handlers (nor custom .claude/commands macros nor MCP prompt expansion): it
 * reaches the model verbatim, the same fall-through an unmatched slash line
 * already takes. `/exit` and `/quit` stay live so the session remains
 * closable from the keyboard.
 *
 * The REPL swaps the dispatched string for a sentinel no handler can match
 * (leading NUL — nothing in the dispatch chain starts with a control char)
 * and restores the user's real text for the model turn.
 */

/** The dispatch sentinel — starts with NUL so no handler branch matches. */
export function slashBypassSentinel() {
  return String.fromCharCode(0) + "slash-bypassed";
}

/**
 * Should this line bypass slash dispatch?
 * @param {string} line     the trimmed input line
 * @param {boolean} disabled  whether --disable-slash-commands is active
 * @returns {boolean}
 */
export function slashDispatchBypassed(line, disabled) {
  return (
    disabled === true &&
    typeof line === "string" &&
    line.startsWith("/") &&
    line !== "/exit" &&
    line !== "/quit"
  );
}
