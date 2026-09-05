import { createHash } from "node:crypto";
import { pruningCanonical as canonical } from "../../src/lib/evolution/governed-wiki-pruning-journal.js";
import { captureSkillReleaseOperationReader } from "../../src/lib/evolution/evolution-ledger-ports.js";
import { NOW } from "./evolution-workbench-rollback.js";
const digest = (value) =>
  `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;

// Canonical workflow READ fixtures connected to an actual already committed
// Registry transaction. This does not simulate a production Eval producer.
export function appendWorkbenchTransitionRecords(
  h,
  { forgedTransaction = false } = {},
) {
  const d = h.descriptor;
  const reader = captureSkillReleaseOperationReader(
    h.registryOptions.transactionLedger,
  );
  const actual = reader.resolveReleaseOrigin({
    tenantId: d.tenantId,
    skillName: d.skillName,
    releaseDigest: h.release.baseline.releaseDigest,
    context: reader.currentContext(),
  }).result;
  const matrixContext = {
    baselineId: "test-baseline",
    matrixAuthorityRoot: digest("test-matrix"),
    matrixEvalId: "test-eval",
    planDigest: digest("test-plan"),
  };
  const requestCore = {
    schema: "chainlesschain.skill-registry-transition-request/v1",
    tenantId: d.tenantId,
    streamId: d.streamId,
    candidateId: h.release.baseline.candidateId,
    skillName: d.skillName,
    candidateCreatedRef: "test://candidate",
    evalCompletedRef: "test://eval",
    humanTaskSettledRef: "test://review",
    matrixContext,
    receipts: actual.intent.mutationRequest.receipts,
    effectiveAt: new Date(NOW).toISOString(),
    sourceReceiptDigest: digest("test-source"),
  };
  const requestDigest = digest(requestCore);
  const request = {
    ...requestCore,
    requestDigest,
    requestId: `skill-transition:${requestDigest.slice(7)}`,
  };
  const attemptCore = {
    schema: "chainlesschain.skill-registry-transition-attempt/v1",
    tenantId: d.tenantId,
    streamId: d.streamId,
    requestId: request.requestId,
    requestDigest,
    ordinal: 1,
    candidateId: request.candidateId,
    skillName: d.skillName,
    matrixContext,
    mutationRequest: actual.intent.mutationRequest,
    createdAt: new Date(NOW).toISOString(),
  };
  const attemptDigest = digest(attemptCore);
  const attempt = {
    ...attemptCore,
    attemptDigest,
    attemptId: `skill-transition-attempt:${attemptDigest.slice(7)}`,
  };
  const settlementCore = {
    schema: "chainlesschain.skill-registry-transition-settlement/v1",
    tenantId: d.tenantId,
    streamId: d.streamId,
    requestId: request.requestId,
    requestDigest,
    attemptId: attempt.attemptId,
    attemptDigest,
    candidateId: request.candidateId,
    skillName: d.skillName,
    activeReleaseDigest: actual.intent.targetReleaseDigest,
    authorityReceiptDigest: actual.intent.authorityReceiptDigest,
    mutationRequestDigest: actual.intent.requestDigest,
    transitionSubjectDigest: actual.intent.transitionSubjectDigest,
    transactionId: forgedTransaction
      ? digest("forged-transaction")
      : actual.intent.transactionId,
    revision: actual.projection.revision,
    stateDigest: actual.projection.stateDigest,
    settledAt: new Date(NOW).toISOString(),
  };
  const settlement = {
    ...settlementCore,
    settlementDigest: digest(settlementCore),
  };
  function append(
    kind,
    value,
    eventSuffix,
    logicalDigest,
    decision,
    sourceRefs,
  ) {
    const artifact = h.artifactPorts.putCanonical(
      `skill-registry-transition-${kind}`,
      value,
      { audience: d.audience, purpose: d.purpose, retention: "ledger" },
    );
    const type = `skill.registry-transition.${eventSuffix}`;
    h.backend.ledger.appendDomainEvent({
      type,
      eventId: `${type}.${logicalDigest.slice(7)}`,
      tenantId: d.tenantId,
      artifactTenantId: d.artifactTenantId,
      correlationId: d.streamId,
      skillName: d.skillName,
      subjectRef: artifact.ref,
      sourceRefs,
      timestamp: new Date(NOW).toISOString(),
      decision,
      reason: `test ${kind}`,
    });
    return artifact.ref;
  }
  const requestRef = append(
    "request",
    request,
    "requested",
    requestDigest,
    "proposed",
    [],
  );
  const attemptRef = append(
    "attempt",
    attempt,
    "attempted",
    attemptDigest,
    "prepared",
    [requestRef],
  );
  append(
    "settlement",
    settlement,
    "settled",
    settlement.settlementDigest,
    "committed",
    [requestRef, attemptRef],
  );
  return { request, attempt, settlement };
}
