const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function validReleaseId(value) {
  return (
    value === null ||
    (typeof value === "string" && value.length > 0 && value.length <= 256)
  );
}

function validateGovernance(value) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.runStatus !== "string" ||
    value.runStatus.length < 1 ||
    value.runStatus.length > 64 ||
    !validReleaseId(value.activeReleaseId) ||
    !validReleaseId(value.lastKnownGoodReleaseId) ||
    !Number.isSafeInteger(value.conflictCount) ||
    value.conflictCount < 0 ||
    (value.pilot !== null &&
      (!value.pilot ||
        !["candidate", "shadow", "canary", "active", "rolled-back"].includes(
          value.pilot.stage,
        ) ||
        !Number.isSafeInteger(value.pilot.revision) ||
        value.pilot.revision < 0 ||
        typeof value.pilot.killSwitch !== "boolean" ||
        typeof value.pilot.reconciliationRequired !== "boolean"))
  ) {
    throw new Error("Evolution Workbench governance state is invalid");
  }
}

export function validateEvolutionWorkbenchResponse(response) {
  const value = response?.result;
  if (
    response?.success !== true ||
    !value ||
    !DIGEST.test(value.projectionDigest || "") ||
    !Array.isArray(value.candidates) ||
    value.candidates.length > 500
  ) {
    throw new Error(
      response?.error || "Evolution Workbench projection is invalid",
    );
  }
  validateGovernance(value.governance);
  for (const candidate of value.candidates) {
    if (
      !DIGEST.test(candidate?.packetDigest || "") ||
      !DIGEST.test(candidate?.candidateContentDigest || "") ||
      typeof candidate?.candidateId !== "string" ||
      !["pending", "approved", "rejected", "expired"].includes(
        candidate?.status,
      ) ||
      typeof candidate?.actualUsage?.active !== "boolean"
    ) {
      throw new Error("Evolution Workbench candidate is invalid");
    }
  }
  return value;
}

function checkedReason(value) {
  const reason = typeof value === "string" ? value.trim() : "";
  if (!reason || reason.length > 2048) {
    throw new Error("A bounded human reason is required");
  }
  return reason;
}

export function buildEvolutionReviewRequest(candidate, decision, reason) {
  if (
    !DIGEST.test(candidate?.packetDigest || "") ||
    candidate?.status !== "pending" ||
    !["approve", "reject"].includes(decision)
  ) {
    throw new Error("Only a pending packet can be reviewed");
  }
  return {
    packetDigests: [candidate.packetDigest],
    decision,
    reason: checkedReason(reason),
  };
}

export function buildEvolutionRollbackRequest(candidates, target, reason) {
  const active = Array.isArray(candidates)
    ? candidates.filter(({ actualUsage }) => actualUsage?.active === true)
    : [];
  if (
    active.length !== 1 ||
    !DIGEST.test(active[0]?.packetDigest || "") ||
    !DIGEST.test(target?.packetDigest || "") ||
    target?.status !== "approved" ||
    target?.actualUsage?.active !== false ||
    active[0].packetDigest === target.packetDigest
  ) {
    throw new Error(
      "Rollback requires one active version and an approved target",
    );
  }
  return {
    fromPacketDigest: active[0].packetDigest,
    toPacketDigest: target.packetDigest,
    reason: checkedReason(reason),
  };
}

export function shortEvolutionDigest(value) {
  return DIGEST.test(value || "")
    ? `${value.slice(0, 15)}…${value.slice(-8)}`
    : "—";
}
