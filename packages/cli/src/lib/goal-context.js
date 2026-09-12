/**
 * goal-context — turn-scoped injection of the active goal into the agent loop.
 *
 * When a goal is bound to a run, a compact reminder of its objective + open key
 * results is supplemented into each LLM call (via agent-core's `prepareCall`
 * seam), so every turn is measured against the goal without polluting the
 * persistent message history.
 *
 * IMPORTANT: this composes WITH the existing `defaultPrepareCall` (turn-context)
 * rather than replacing it — both suffixes are concatenated. Keep the produced
 * text terse: it is re-sent on every iteration and is billed each time.
 */

/** Hard cap on the open key results we list, to bound per-turn token cost. */
const MAX_KEY_RESULTS = 8;

/**
 * Build the compact system-prompt supplement for a goal, or null when the goal
 * is missing / not active.
 * @param {object|null} goal
 * @returns {string|null}
 */
export function buildGoalContext(goal) {
  if (!goal || goal.status !== "active") return null;
  const objective = String(goal.objective || "").trim();
  if (!objective) return null;

  const pct = Number.isFinite(goal.progress) ? goal.progress : 0;
  const lines = [`Active goal (${pct}% complete): ${objective}`];

  const open = (goal.keyResults || []).filter((k) => k && !k.done);
  for (const kr of open.slice(0, MAX_KEY_RESULTS)) {
    const target =
      kr.target != null ? ` [${kr.current ?? 0}/${kr.target}]` : "";
    lines.push(`- key result: ${kr.text}${target}`);
  }
  if (open.length > MAX_KEY_RESULTS) {
    lines.push(`- (+${open.length - MAX_KEY_RESULTS} more key results)`);
  }

  lines.push(
    "Each turn, prefer actions that advance these key results; if you must diverge, briefly say why.",
  );
  return lines.join("\n");
}

/**
 * A `prepareCall`-shaped function bound to a goal. Defensive: never throws
 * (agent-core swallows prepareCall errors, but we avoid relying on that).
 * @param {object|null} goal
 * @returns {(ctx:object) => ({systemSuffix:string}|null)}
 */
export function goalPrepareCall(goal) {
  return () => {
    try {
      const suffix = buildGoalContext(goal);
      return suffix ? { systemSuffix: suffix } : null;
    } catch {
      return null;
    }
  };
}

/**
 * Compose several `prepareCall` functions into one. Each is invoked per turn
 * and their non-empty transient system/user contexts are concatenated without
 * changing authority: `systemSuffix` stays system, `userContext` stays user.
 * A failing member is skipped, never fatal.
 * @param {Array<Function|null|undefined>} fns
 * @returns {(ctx:object) => Promise<{systemSuffix:string}|null>}
 */
export function composePrepareCall(fns) {
  const list = (fns || []).filter((f) => typeof f === "function");
  return async (ctx) => {
    const systemParts = [];
    const userParts = [];
    for (const fn of list) {
      try {
        const r = await fn(ctx);
        if (r && typeof r.systemSuffix === "string" && r.systemSuffix.trim()) {
          systemParts.push(r.systemSuffix);
        }
        if (r && typeof r.userContext === "string" && r.userContext.trim()) {
          userParts.push(r.userContext);
        }
      } catch {
        /* a failing member must not break the turn */
      }
    }
    if (systemParts.length === 0 && userParts.length === 0) return null;
    return {
      ...(systemParts.length ? { systemSuffix: systemParts.join("\n\n") } : {}),
      ...(userParts.length ? { userContext: userParts.join("\n\n") } : {}),
    };
  };
}
