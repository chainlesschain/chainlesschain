/** Read-only diagnostic evidence check. Never authorizes or clears an execution. */
export const RECOVERY_SCHEMA = "chainlesschain.windows-job-recovery-native/v1";

export function inspectUnassignedCleanup(value, executionId) {
  return (
    typeof executionId === "string" &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(executionId) &&
    value?.schema === RECOVERY_SCHEMA &&
    value?.executionId === executionId &&
    value?.status === "NOT_ADMITTED" &&
    value?.nonElevated === true &&
    value?.unassignedFailureInjected === true &&
    value?.completed === false &&
    value?.cleanupConfirmed === true &&
    value?.finalJobEmpty === true &&
    value?.originalOwnerCleanupConfirmed === true &&
    value?.originalOwnerFallbackAttempted === true &&
    value?.error === "Injected failure before Job assignment and resume" &&
    !value?.cleanupError &&
    !value?.ownerCleanupError &&
    value?.custodianRestartTested === false &&
    value?.wfpTested === false &&
    Array.isArray(value?.events) &&
    value.events.length === 0
  );
}

export function inspectJobRecovery(value, executionId) {
  const errors = [];
  const require = (condition, message) => {
    if (!condition) errors.push(message);
  };
  require(value?.schema === RECOVERY_SCHEMA, "native schema mismatch");
  require(typeof executionId === "string" &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(executionId) &&
    value?.executionId === executionId, "execution identity mismatch");
  require(value?.status ===
    "NOT_ADMITTED", "diagnostic admission boundary changed");
  require(value?.nonElevated === true, "non-elevated host not observed");
  require(value?.completed === true, "native experiment incomplete");
  require(value?.cleanupConfirmed === true, "native cleanup unconfirmed");
  require(value?.finalJobEmpty === true &&
    value?.originalOwnerCleanupConfirmed ===
      true, "independent Job and original owner cleanup required");
  require(value?.unassignedFailureInjected ===
    false, "injected failure is not a completed experiment");
  require(value?.custodianRestartTested ===
    false, "custodian restart claim unsupported");
  require(value?.wfpTested === false, "WFP claim unsupported");
  require(!value?.error &&
    !value?.cleanupError &&
    !value?.ownerCleanupError, "native failure retained");
  const names = [
    "assigned-before-resume",
    "live-tree",
    "negative-identities",
    "owner-crashed",
    "termination-issued",
    "cleanup-fence",
  ];
  const events = Array.isArray(value?.events) ? value.events : [];
  require(events.length === names.length &&
    events.every(
      (event, i) => event?.name === names[i],
    ), "native event sequence incomplete or reordered");
  const [assigned, live, negative, crash, termination, cleanup] = events;
  const countAtLeast = (value, minimum) =>
    Number.isSafeInteger(value) && value >= minimum;
  const socketClosed = (value) => value === "eof" || value === "reset";
  require(assigned?.ownerInJob === true &&
    assigned?.jobActive === 1, "suspended owner assignment unproven");
  require(countAtLeast(live?.jobActive, 3) &&
    live?.socketChallenges === 3 &&
    live?.handlesJobVerified ===
      true, "live descendant membership and sockets unproven");
  require(negative?.wrongJobRejected === true &&
    negative?.staleIdentityRejected === true &&
    negative?.ownerInWrongJob === false &&
    negative?.wrongJobActive === 0 &&
    negative?.jobActive === live?.jobActive &&
    negative?.socketChallenges ===
      3, "wrong Job or stale identity rejection unproven");
  require(crash?.originalOwnerHandleSignaled === true &&
    crash?.ownerSocketClosed === true &&
    socketClosed(crash?.ownerSocketTerminal) &&
    countAtLeast(crash?.jobActive, 2) &&
    crash?.descendantSocketChallenges === 2 &&
    crash?.cleanupConfirmed ===
      false, "owner death must leave live descendants and unconfirmed cleanup");
  require(termination?.sameRetainedJob ===
    true, "original Job termination unproven");
  require(cleanup?.jobActive === 0 &&
    cleanup?.originalOwnerHandleSignaled === true &&
    cleanup?.retainedMemberHandlesSignaled === 3 &&
    cleanup?.descendantSocketsClosed === 2 &&
    Array.isArray(cleanup?.descendantSocketTerminals) &&
    cleanup.descendantSocketTerminals.length === 2 &&
    cleanup.descendantSocketTerminals.every(
      socketClosed,
    ), "empty Job, retained handles and closed sockets are all required");
  return {
    diagnosticCompleted: errors.length === 0,
    status: "NOT_ADMITTED",
    trusted: false,
    scope: "surviving-custodian-retained-job",
    networkObservation: "socket-closure-after-job-termination",
    durableServiceRecovery: "not-tested",
    wfpRevocation: "not-tested",
    errors,
  };
}
