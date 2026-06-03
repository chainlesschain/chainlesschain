/**
 * reviewer.js — Reviewer Gate: VLM 检查 commit 质量
 *
 * 在 commit 前调用 VLM 检查主角占比/美学分:
 *   - protagonist_ratio >= threshold → pass
 *   - 不达标 → reject (触发 rerun)
 *
 * 扩展 ApprovalGate 为 quality-check policy 类型。
 */

export const DEFAULT_THRESHOLDS = {
  protagonist_ratio: 0.5,
  aesthetic_score: 2.5,
};

/**
 * Quality checker registry.
 * Each checker: { name, check(entry, context) => { pass, score, reason } }
 */
const checkerRegistry = new Map();

export function registerChecker(name, checkFn) {
  checkerRegistry.set(name, { name, check: checkFn });
}

export function getChecker(name) {
  return checkerRegistry.get(name);
}

export function listCheckers() {
  return Array.from(checkerRegistry.keys());
}

// ── Built-in checkers ─────────────────────────────────────────

registerChecker("vision-protagonist", async (entry, context) => {
  if (!context.llmCall) {
    return { pass: true, score: 0.5, reason: "No VLM available, skipped" };
  }

  const result = await context.llmCall({
    type: "protagonist-detect",
    clips: entry.clips,
    mainCharacter: context.mainCharacter,
  });

  const ratio = result?.protagonist_ratio ?? result?.ratio ?? 0;
  const threshold =
    context.thresholds?.protagonist_ratio ??
    DEFAULT_THRESHOLDS.protagonist_ratio;

  return {
    pass: ratio >= threshold,
    score: ratio,
    reason:
      ratio >= threshold
        ? `Protagonist ratio ${(ratio * 100).toFixed(0)}% >= ${(threshold * 100).toFixed(0)}%`
        : `Protagonist ratio ${(ratio * 100).toFixed(0)}% < ${(threshold * 100).toFixed(0)}% threshold`,
  };
});

registerChecker("aesthetic-score", async (entry, context) => {
  if (!context.llmCall) {
    return { pass: true, score: 3.0, reason: "No VLM available, skipped" };
  }

  const result = await context.llmCall({
    type: "aesthetic-analysis",
    clips: entry.clips,
  });

  const score = result?.overall_aesthetic_score ?? 3.0;
  const threshold =
    context.thresholds?.aesthetic_score ?? DEFAULT_THRESHOLDS.aesthetic_score;

  return {
    pass: score >= threshold,
    score,
    reason:
      score >= threshold
        ? `Aesthetic ${score.toFixed(1)} >= ${threshold}`
        : `Aesthetic ${score.toFixed(1)} < ${threshold} threshold`,
  };
});

/**
 * Review an entry against specified checkers.
 *
 * @param {object} entry - shot_point entry with clips
 * @param {string[]} checkerNames - names of checkers to run
 * @param {object} context - { llmCall, mainCharacter, thresholds }
 * @returns {{ pass: boolean, checks: object[], aggregateScore: number }}
 */
export async function reviewEntry(entry, checkerNames, context) {
  const checks = [];

  for (const name of checkerNames) {
    const checker = checkerRegistry.get(name);
    if (!checker) {
      checks.push({
        name,
        pass: true,
        score: 0,
        reason: `Unknown checker: ${name}`,
      });
      continue;
    }

    try {
      const result = await checker.check(entry, context);
      checks.push({ name, ...result });
    } catch (err) {
      checks.push({
        name,
        pass: false,
        score: 0,
        reason: `Checker error: ${err.message}`,
      });
    }
  }

  const allPass = checks.every((c) => c.pass);
  const aggregateScore =
    checks.length > 0
      ? checks.reduce((s, c) => s + c.score, 0) / checks.length
      : 0;

  return { pass: allPass, checks, aggregateScore };
}

/**
 * Quality-check policy for ApprovalGate integration.
 *
 * Usage:
 *   const policy = createQualityCheckPolicy(["vision-protagonist"], { thresholds, onFail: "rerun" });
 *   const result = await policy.evaluate(entry, context);
 */
export function createQualityCheckPolicy(checkerNames, options = {}) {
  return {
    type: "quality-check",
    checkers: checkerNames,
    onFail: options.onFail || "rerun",
    thresholds: options.thresholds || DEFAULT_THRESHOLDS,

    async evaluate(entry, context) {
      const mergedCtx = {
        ...context,
        thresholds: {
          ...DEFAULT_THRESHOLDS,
          ...this.thresholds,
          ...context.thresholds,
        },
      };
      const review = await reviewEntry(entry, this.checkers, mergedCtx);
      return {
        ...review,
        action: review.pass ? "approve" : this.onFail,
      };
    },
  };
}
