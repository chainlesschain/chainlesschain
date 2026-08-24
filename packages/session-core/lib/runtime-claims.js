/**
 * Machine-readable execution truthfulness contract shared by CLI and Desktop.
 *
 * A caller may claim terminal success only for a real execution that produced
 * both a successful runtime terminal event and an immutable receipt. Planning,
 * validation and simulation are deliberately non-successful outcomes.
 */

const RUNTIME_CLAIMS_SCHEMA = "cc-runtime-claims/v1";

const RUNTIME_MODE = Object.freeze({
  VALIDATE_ONLY: "validate-only",
  SIMULATED: "simulated",
  REAL_EXECUTION: "real-execution",
});

const TERMINAL_EVIDENCE_KIND = Object.freeze({
  RUNTIME_EVENT: "runtime-terminal-event",
  OUTPUT_RECEIPT: "output-receipt",
  ARTIFACT_DIGEST: "artifact-digest",
  WORKTREE_COMMIT: "worktree-commit",
  TEST_RECEIPT: "test-receipt",
});

const RECEIPT_KINDS = new Set([
  TERMINAL_EVIDENCE_KIND.OUTPUT_RECEIPT,
  TERMINAL_EVIDENCE_KIND.ARTIFACT_DIGEST,
  TERMINAL_EVIDENCE_KIND.WORKTREE_COMMIT,
  TERMINAL_EVIDENCE_KIND.TEST_RECEIPT,
]);

function createRuntimeClaims({
  mode,
  durable = false,
  crashSafe = false,
  isolatedWrites = false,
} = {}) {
  if (!Object.values(RUNTIME_MODE).includes(mode)) {
    throw new TypeError(`Unsupported runtime mode: ${mode}`);
  }

  return Object.freeze({
    schema: RUNTIME_CLAIMS_SCHEMA,
    mode,
    validateOnly: mode === RUNTIME_MODE.VALIDATE_ONLY,
    simulated: mode === RUNTIME_MODE.SIMULATED,
    realExecution: mode === RUNTIME_MODE.REAL_EXECUTION,
    durable: durable === true,
    crashSafe: crashSafe === true,
    isolatedWrites: isolatedWrites === true,
  });
}

function hasTerminalSuccessEvidence(runtimeClaims, evidence) {
  if (
    runtimeClaims?.schema !== RUNTIME_CLAIMS_SCHEMA ||
    runtimeClaims.realExecution !== true ||
    runtimeClaims.mode !== RUNTIME_MODE.REAL_EXECUTION ||
    !Array.isArray(evidence)
  ) {
    return false;
  }

  const terminal = evidence.some(
    (item) =>
      item?.kind === TERMINAL_EVIDENCE_KIND.RUNTIME_EVENT &&
      item.outcome === "completed" &&
      typeof item.source === "string" &&
      item.source.length > 0,
  );
  const receipt = evidence.some(
    (item) =>
      RECEIPT_KINDS.has(item?.kind) &&
      typeof item.digest === "string" &&
      /^sha256:[a-f0-9]{64}$/u.test(item.digest),
  );
  return terminal && receipt;
}

module.exports = {
  RUNTIME_CLAIMS_SCHEMA,
  RUNTIME_MODE,
  TERMINAL_EVIDENCE_KIND,
  createRuntimeClaims,
  hasTerminalSuccessEvidence,
};
