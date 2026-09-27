import path from "node:path";
import { getMachineSecurityAnchorDir } from "../paths.js";
import { ProcessOwnershipJournal } from "./process-ownership-journal.js";

// Shared by every Broker in this JS runtime. A new Broker, different cwd or
// cleared audit history cannot turn a lost process owner into cleanup evidence.
// Linux additionally records ownership before the native launch. Retaining
// that record across restart is a fence, not proof of descendant cleanup.
const unresolvedOwners = new Map();
let journal = null;

function durableJournal() {
  if (process.platform !== "linux") return null;
  journal ??= new ProcessOwnershipJournal(
    path.join(getMachineSecurityAnchorDir(), "process-ownership-v1"),
  );
  return journal;
}

export function prepareProcessOwnership(executionId) {
  return durableJournal()?.prepare(executionId) ?? null;
}

export const PROCESS_OWNERSHIP_UNCONFIRMED =
  "BROKER_PROCESS_OWNERSHIP_UNCONFIRMED";

export function observeProcessOwnership(proc, executionId, lease = null) {
  // The facade emits close only after actual tree cleanup, or after a native
  // spawn that created no supervisor at all. Persist that fact before Bridge
  // callers receive close. An error/exit/PID probe cannot settle this record.
  if (lease)
    proc.prependOnceListener("close", () => {
      if (
        proc.pid &&
        proc.ownedProcessTreeEvidence?.cleanup?.confirmed !== true
      )
        return;
      try {
        lease.settle();
      } catch (error) {
        proc.emit("error", error);
      }
    });
  if (!proc?.ownedProcessTreeClosed || !proc.pid) return;
  const retain = (receipt) => {
    if (receipt?.cleanup?.confirmed !== false) return;
    lease?.retain();
    if (!unresolvedOwners.has(executionId)) {
      unresolvedOwners.set(executionId, { proc, durable: lease !== null });
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
  const durable = durableJournal()?.inspect();
  return {
    blocked: unresolvedOwners.size > 0 || durable?.blocked === true,
    unresolvedExecutionIds: [
      ...new Set([
        ...unresolvedOwners.keys(),
        ...(durable?.blocked ? durable.pendingExecutionIds : []),
      ]),
    ],
    recoveryRequired: unresolvedOwners.size > 0 || durable?.blocked === true,
    durable:
      !!durable &&
      [...unresolvedOwners.values()].every((owner) => owner.durable),
    restartSafe: false,
  };
}

export function assertProcessOwnershipAvailable() {
  if (unresolvedOwners.size === 0) {
    durableJournal()?.assertAvailable();
    return;
  }
  const error = new Error(
    "Managed process execution is blocked because an earlier process tree has unconfirmed cleanup; restarting does not prove cleanup",
  );
  error.code = PROCESS_OWNERSHIP_UNCONFIRMED;
  error.recoveryRequired = true;
  error.executionStarted = false;
  throw error;
}
