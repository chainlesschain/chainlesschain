/**
 * Headless exit-code taxonomy (gap-analysis 2026-07-11, P0 "确定性 Headless"):
 * scripted callers can tell apart WHY a run ended without parsing stderr.
 *
 * Backward compatibility: every failure is still non-zero, 0 stays success,
 * 2 stays "settings hook blocked the prompt" (pre-existing), 130/143 stay the
 * signal-interrupt codes. The new codes carve budget/turn exhaustion and
 * config errors out of the generic 1.
 */

const HEADLESS_EXIT_CODES = Object.freeze({
  OK: 0,
  /** generic failure (tool/loop/unclassified error) */
  ERROR: 1,
  /** a settings hook blocked the prompt (pre-existing semantic) */
  HOOK_BLOCKED: 2,
  /** the turn budget (--max-turns / loop iteration cap) ran out first */
  MAX_TURNS: 3,
  /** the --max-budget-usd cost cap stopped the run */
  MAX_BUDGET: 4,
  /** the LLM call itself failed (provider/model/network error) */
  MODEL_ERROR: 5,
  /** bad run configuration (--mcp-config / --permission-prompt-tool / settings) */
  CONFIG_ERROR: 6,
  /** user interrupt (SIGINT) — 128+2, shell convention */
  INTERRUPT_SIGINT: 130,
  /** termination (SIGTERM) — 128+15, shell convention */
  INTERRUPT_SIGTERM: 143,
});

/**
 * Best-effort classifier for errors thrown out of the agent loop: provider /
 * transport failures → MODEL_ERROR, everything else → generic ERROR. Checks
 * structural markers (HTTP status, network error codes) before falling back —
 * never message-text guessing beyond the explicit LLM markers.
 */
function classifyLoopError(err) {
  if (!err) return HEADLESS_EXIT_CODES.ERROR;
  const status = err.status ?? err.statusCode ?? err.response?.status;
  if (Number.isFinite(Number(status))) return HEADLESS_EXIT_CODES.MODEL_ERROR;
  const code = err.code || err.cause?.code;
  if (
    typeof code === "string" &&
    /^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR)/.test(
      code,
    )
  ) {
    return HEADLESS_EXIT_CODES.MODEL_ERROR;
  }
  if (typeof err.name === "string" && /LLM|Provider|Api/i.test(err.name)) {
    return HEADLESS_EXIT_CODES.MODEL_ERROR;
  }
  return HEADLESS_EXIT_CODES.ERROR;
}

/**
 * Map a finished run's endReason (+ error flag) to an exit code.
 * @param {string} endReason  "complete" | "max_turns" | "budget-exhausted" |
 *                            "cost-budget-exhausted" | "no-response" | ...
 * @param {boolean} isError
 */
function exitCodeForEndReason(endReason, isError) {
  if (!isError) return HEADLESS_EXIT_CODES.OK;
  if (endReason === "max_turns" || endReason === "budget-exhausted") {
    return HEADLESS_EXIT_CODES.MAX_TURNS;
  }
  if (endReason === "cost-budget-exhausted") {
    return HEADLESS_EXIT_CODES.MAX_BUDGET;
  }
  return HEADLESS_EXIT_CODES.ERROR;
}

module.exports = {
  HEADLESS_EXIT_CODES,
  classifyLoopError,
  exitCodeForEndReason,
};
