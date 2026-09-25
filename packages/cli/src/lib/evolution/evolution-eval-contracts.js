/** Shared evaluation contracts; keep this module free of runtime dependencies. */

export const EVOLUTION_EVAL_TASK_SCHEMA =
  "chainlesschain.evolution-eval-task/v1";
export const EVOLUTION_EVAL_SUITE_SCHEMA =
  "chainlesschain.evolution-eval-suite/v1";
export const EVOLUTION_EVAL_POLICY_SCHEMA =
  "chainlesschain.evolution-eval-policy/v2";
export const EVOLUTION_EVAL_RECEIPT_SCHEMA =
  "chainlesschain.evolution-eval-receipt/v4";
export const EVOLUTION_EVAL_RESULT_EVIDENCE_SCHEMA =
  "chainlesschain.evolution-eval-result-evidence/v1";
export const EVOLUTION_EVAL_SUITE_AUTHORITY_SCHEMA =
  "chainlesschain.evolution-eval-suite-authority-receipt/v1";
export const EVOLUTION_EVAL_ENVIRONMENT_SCHEMA =
  "chainlesschain.evolution-eval-environment-receipt/v1";
export const EVOLUTION_EVAL_ARTIFACT_SCHEMA =
  "chainlesschain.evolution-eval-artifact-resolution-receipt/v1";
export const EVOLUTION_EVAL_PROVENANCE_SCHEMA =
  "chainlesschain.evolution-eval-provenance-binding-receipt/v1";
export const EVOLUTION_EVAL_SUBJECT_SCHEMA =
  "chainlesschain.evolution-eval-subject-handle-receipt/v1";
export const EVOLUTION_EVAL_REPLAY_SCHEMA =
  "chainlesschain.evolution-eval-handle-reservation-receipt/v1";
export const EVOLUTION_EVAL_SUPERVISION_SCHEMA =
  "chainlesschain.evolution-eval-deadline-enforcement-receipt/v3";
export const EVOLUTION_EVAL_ISOLATED_TARGET_SCHEMA =
  "chainlesschain.evolution-eval-isolated-target/v2";
export const EVOLUTION_EVAL_AUTHORITY_DESCRIPTOR_SCHEMA =
  "chainlesschain.evolution-eval-authority-descriptor/v1";
/**
 * Authority roots commit configuration supplied by a trusted composition
 * boundary. They are not local proofs that JavaScript callable bytes match a
 * declared handlerArtifactDigest. Production must use an attested loader that
 * binds each descriptor to the loaded callable; requests and plugins must not
 * construct Gate/Verifier authority ports.
 */
export const EVOLUTION_EVAL_AUTHORITY_ROOT_SEMANTICS = Object.freeze({
  kind: "trusted-composition-configuration-commitment",
  callableBinding: "attested-loader-required",
  requestConstructedAuthorities: "forbidden",
});
export const EVOLUTION_EVAL_TARGET_INVOCATION_SCHEMA =
  "chainlesschain.evolution-eval-target-invocation/v2";
export const EVOLUTION_EVAL_TARGET_REVOCATION_SCHEMA =
  "chainlesschain.evolution-eval-target-revocation/v2";
export const EVOLUTION_EVAL_EXECUTION_SCHEMA =
  "chainlesschain.evolution-eval-execution-receipt/v1";
export const EVOLUTION_EVAL_GRADE_SCHEMA =
  "chainlesschain.evolution-eval-grade-receipt/v1";
export const EVOLUTION_EVAL_SAFETY_SCHEMA =
  "chainlesschain.evolution-eval-safety-receipt/v1";

export const EVOLUTION_EVAL_INVALID_CODE = "CC_EVOLUTION_EVAL_INVALID";
export const EVOLUTION_EVAL_LEAKAGE_CODE = "CC_EVOLUTION_EVAL_LEAKAGE";
export const EVOLUTION_EVAL_AUTHORITY_FAILED_CODE =
  "CC_EVOLUTION_EVAL_AUTHORITY_FAILED";
export const EVOLUTION_EVAL_EXECUTION_FAILED_CODE =
  "CC_EVOLUTION_EVAL_EXECUTION_FAILED";
export const EVOLUTION_EVAL_GRADER_FAILED_CODE =
  "CC_EVOLUTION_EVAL_GRADER_FAILED";
export const EVOLUTION_EVAL_SAFETY_FAILED_CODE =
  "CC_EVOLUTION_EVAL_SAFETY_FAILED";
export const EVOLUTION_EVAL_SUPERVISOR_UNRESPONSIVE_CODE =
  "CC_EVOLUTION_EVAL_SUPERVISOR_UNRESPONSIVE";
export const EVOLUTION_EVAL_TARGET_SETTLEMENT_UNCONFIRMED_CODE =
  "CC_EVOLUTION_EVAL_TARGET_SETTLEMENT_UNCONFIRMED";

export const EVOLUTION_EVAL_ATTESTATION_PURPOSES = Object.freeze({
  suite: "chainlesschain.evolution-eval.suite-authority/v1",
  environment: "chainlesschain.evolution-eval.environment/v1",
  artifact: "chainlesschain.evolution-eval.artifact/v1",
  provenance: "chainlesschain.evolution-eval.provenance/v1",
  subject: "chainlesschain.evolution-eval.subject/v1",
  replay: "chainlesschain.evolution-eval.handle-replay/v1",
  supervisor: "chainlesschain.evolution-eval.deadline-supervisor/v3",
  targetInvocation:
    "chainlesschain.evolution-eval.target-invocation-evidence/v1",
  targetRevocation:
    "chainlesschain.evolution-eval.target-revocation-evidence/v1",
  execution: "chainlesschain.evolution-eval.execution/v1",
  grade: "chainlesschain.evolution-eval.grade/v1",
  safety: "chainlesschain.evolution-eval.safety/v1",
  receipt: "chainlesschain.evolution-eval.receipt/v3",
  clock: "chainlesschain.evolution-eval.trusted-clock/v1",
});
