// Shared by every Broker in this JS runtime. A new Broker, different cwd or
// cleared audit history cannot turn a lost process owner into cleanup evidence.
// This is an in-memory admission fence, not a durable recovery mechanism.
const unresolvedOwners = new Map();

export const PROCESS_OWNERSHIP_UNCONFIRMED =
  "BROKER_PROCESS_OWNERSHIP_UNCONFIRMED";

export function observeProcessOwnership(proc, executionId) {
  if (!proc?.ownedProcessTreeClosed || !proc.pid) return;
  const retain = (receipt) => {
    if (receipt?.cleanup?.confirmed !== false) return;
    if (!unresolvedOwners.has(executionId)) {
      unresolvedOwners.set(executionId, { proc });
    }
  };
  // Install before post-spawn bookkeeping and caller listeners. The error
  // precedes cleanup:unconfirmed, so reentrant callers must already be fenced.
  proc.on("error", (error) => {
    if (error.code === "EXTERNAL_AGENT_CLEANUP_UNCONFIRMED")
      retain(proc.ownedProcessTreeEvidence);
  });
  proc.once("cleanup:unconfirmed", retain);
}

export function getProcessOwnershipStatus() {
  return {
    blocked: unresolvedOwners.size > 0,
    unresolvedExecutionIds: [...unresolvedOwners.keys()],
    recoveryRequired: unresolvedOwners.size > 0,
    durable: false,
    restartSafe: false,
  };
}

export function assertProcessOwnershipAvailable() {
  if (unresolvedOwners.size === 0) return;
  const error = new Error(
    "Managed process execution is blocked because an earlier process tree has unconfirmed cleanup; restarting does not prove cleanup",
  );
  error.code = PROCESS_OWNERSHIP_UNCONFIRMED;
  error.recoveryRequired = true;
  error.executionStarted = false;
  throw error;
}
