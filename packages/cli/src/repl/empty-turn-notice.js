/**
 * Decide the notice to show when an agent turn completes with NO answer text
 * (Claude-Code 2.1.183 parity: "Fixed silent turn completion with only thinking
 * blocks"). Without this, a turn whose model produced only extended-thinking
 * blocks — or an empty response — returned to the prompt with nothing printed,
 * looking like a silent no-op / hang.
 *
 * Pure + side-effect-free so it is unit-testable (the interactive REPL itself
 * can't be driven over piped stdin). The REPL applies dim styling to the
 * returned string.
 *
 * @param {object} opts
 * @param {string} [opts.response]  the turn's final answer text
 * @param {string} [opts.reasoning] extended-thinking text, if any
 * @param {boolean} [opts.suppressed] true if an AssistantResponse hook suppressed the answer
 * @returns {string|null} the notice text (no styling/newlines), or null when
 *   the turn DID produce an answer or was hook-suppressed (nothing to add).
 */
export function emptyTurnNotice({ response, reasoning, suppressed } = {}) {
  if (suppressed) return null;
  // Truthiness mirrors the REPL's `if (effectiveResponse)` render branch: a
  // non-empty answer (even whitespace) is printed there, so no notice is needed.
  if (response) return null;
  return reasoning
    ? "(the model returned reasoning but no answer text)"
    : "(the model returned no text response)";
}
