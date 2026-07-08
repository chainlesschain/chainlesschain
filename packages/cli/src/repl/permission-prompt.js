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

/**
 * Resolve the idle timeout (ms) for interactive permission prompts.
 *
 * An unanswered prompt blocks the whole agent turn forever (e.g. the user
 * walked away mid-run). With a timeout configured, the prompt auto-denies
 * after `ms` of silence — deny is the only safe unattended answer.
 *
 * Precedence: CC_PERMISSION_ASK_TIMEOUT_MS env > config
 * `permissions.askTimeoutMs` > default 0 (disabled — waits forever, the
 * historical behavior). Non-finite / non-positive values disable it.
 *
 * @param {{env?: string, config?: unknown}} [opts] - injectable for tests
 * @returns {number} timeout in ms, 0 = disabled
 */
export function resolveAskIdleTimeoutMs({ env, config } = {}) {
  const envRaw =
    env !== undefined ? env : process.env.CC_PERMISSION_ASK_TIMEOUT_MS;
  const candidate =
    envRaw !== undefined && envRaw !== null && envRaw !== ""
      ? Number(envRaw)
      : typeof config === "number" || typeof config === "string"
        ? Number(config)
        : NaN; // booleans/objects are not a timeout — disabled
  return Number.isFinite(candidate) && candidate > 0 ? candidate : 0;
}

/**
 * Race an interactive question against an idle timeout.
 *
 * `ask` is the readline-question-as-promise (never rejects). On timeout the
 * caller must still close its readline interface; the stranded question
 * callback becomes a no-op once the interface is closed.
 *
 * @param {(prompt: string) => Promise<string>} ask
 * @param {string} prompt
 * @param {number} timeoutMs - 0/negative = no timeout (plain await)
 * @returns {Promise<{answer: string|null, timedOut: boolean}>}
 */
export async function questionWithIdleTimeout(ask, prompt, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { answer: await ask(prompt), timedOut: false };
  }
  let timer = null;
  try {
    return await Promise.race([
      ask(prompt).then((answer) => ({ answer, timedOut: false })),
      new Promise((res) => {
        timer = setTimeout(
          () => res({ answer: null, timedOut: true }),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
