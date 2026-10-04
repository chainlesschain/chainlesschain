export const historicalNames = [
  "transfers the real lock only after a sidecar readiness handshake",
  "commits the canonical binary and alias with lineage/result persistence",
  "rolls the canonical binary and alias back after verification fails",
  "restores prior backup and lineage generations after verification fails",
  "commits an independent rescue without consuming its canonical backup",
];

export function createPlan(env = process.env) {
  const gateContext = env.CC_UPDATER_DIAGNOSTIC_GATE_CONTEXT === "true";
  const fullUpdaterSuite =
    gateContext || env.CC_UPDATER_DIAGNOSTIC_FULL_SUITE === "true";
  return {
    gateContext,
    fullUpdaterSuite,
    hostProbeTiming: gateContext ? "after-tests" : "before-tests",
    predecessorArgs: [
      "node_modules/vitest/vitest.mjs",
      "run",
      "packages/cli/__tests__/unit/native-installers-transaction.test.js",
      "--maxWorkers=1",
    ],
    updaterSelectionArgs: fullUpdaterSuite
      ? []
      : ["--testNamePattern", historicalNames.join("|")],
  };
}

// Match the original Bash set -e sequence: a failed predecessor stops the run.
export async function runTestSequence(plan, runPredecessor, runUpdater) {
  if (plan.gateContext) {
    const predecessor = await runPredecessor(plan.predecessorArgs);
    if (predecessor.status !== 0) {
      return {
        status: predecessor.status ?? 1,
        updaterRan: false,
        observationComplete: true,
        reason: "installer-predecessor-failed",
      };
    }
  }
  return { ...(await runUpdater()), updaterRan: true };
}
