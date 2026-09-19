export const TOOL_RECOVERY_PAUSED_CODE = "CC_TOOL_RECOVERY_PAUSED";

/**
 * A recovery pause is a synthetic runtime result: the requested tool never
 * executed and therefore produced no new evidence about the underlying task.
 * Loop guards must not feed that result back into their retry counters, or a
 * one-turn pause becomes a self-sustaining recovery loop.
 */
export function isToolRecoveryPaused(result) {
  return result?.code === TOOL_RECOVERY_PAUSED_CODE;
}
