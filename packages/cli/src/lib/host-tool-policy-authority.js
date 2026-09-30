/** Host-owned policy snapshots and synchronous, irreversible revisions.
 * Revisions cover commits through this owner in this process. Persisting a
 * session's latest policy does not make these revisions a durable journal.
 */
import { randomUUID } from "node:crypto";
import { snapshotMcpJsonRpcInput } from "./mcp-call-ledger.js";

const AUTHORITIES = new WeakSet();
const CHILD_AUTHORITIES = new WeakMap();

function unavailable() {
  const error = new Error("Host tool policy authority is unavailable");
  error.code = "CC_HOST_TOOL_POLICY_AUTHORITY_UNAVAILABLE";
  return error;
}

function capturePolicy(policy) {
  if (policy == null) return null;
  try {
    const snapshot = snapshotMcpJsonRpcInput(policy);
    if (typeof snapshot !== "object" || Array.isArray(snapshot))
      throw unavailable();
    for (const field of ["tools", "toolPolicies"]) {
      const policies = snapshot[field];
      if (policies == null) continue;
      if (typeof policies !== "object" || Array.isArray(policies))
        throw unavailable();
      for (const entry of Object.values(policies)) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry))
          throw unavailable();
        for (const flag of [
          "allowed",
          "requiresConfirmation",
          "requiresPlanApproval",
          "isReadOnly",
        ]) {
          if (entry[flag] !== undefined && typeof entry[flag] !== "boolean")
            throw unavailable();
        }
        if (entry.decision !== undefined && typeof entry.decision !== "string")
          throw unavailable();
      }
    }
    if (
      snapshot.toolDefinitions !== undefined &&
      !Array.isArray(snapshot.toolDefinitions)
    )
      throw unavailable();
    return snapshot;
  } catch {
    throw unavailable();
  }
}

export function captureHostToolPolicyAuthority(authority) {
  if (authority == null) return null;
  if (!AUTHORITIES.has(authority)) throw unavailable();
  return authority;
}

/** The host retains the controller; consumers receive only `authority`. */
export function createHostToolPolicyAuthority(policy = null) {
  const ownerId = randomUUID();
  let snapshot = Object.freeze({
    schema: "chainlesschain.host-tool-policy-authority/v1",
    ownerId,
    revision: 0,
    policy: capturePolicy(policy),
  });
  let invalid = false;
  const listeners = new Set();
  function publish(nextPolicy) {
    if (snapshot.revision >= Number.MAX_SAFE_INTEGER) throw unavailable();
    snapshot = Object.freeze({
      ...snapshot,
      revision: snapshot.revision + 1,
      policy: nextPolicy,
    });
    // Commit before notifying. A failing observer cannot hide a revision from
    // the remaining execution monitors.
    for (const listener of [...listeners]) {
      try {
        listener(snapshot);
      } catch {
        // Observer delivery does not roll back committed authority.
      }
    }
    return snapshot;
  }
  const authority = Object.freeze({
    getSnapshot() {
      if (invalid) throw unavailable();
      return snapshot;
    },
    subscribePolicyRevision(listener) {
      if (typeof listener !== "function")
        throw new TypeError("listener required");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  AUTHORITIES.add(authority);
  return Object.freeze({
    authority,
    commit(nextPolicy) {
      const captured = capturePolicy(nextPolicy);
      if (
        !invalid &&
        JSON.stringify(captured) === JSON.stringify(snapshot.policy)
      )
        return snapshot;
      invalid = false;
      return publish(captured);
    },
    invalidate() {
      invalid = true;
      return publish(snapshot.policy);
    },
  });
}

/** Inherit the live ceiling without introducing host definitions into a child. */
export function hostToolPolicyAuthorityForChild(value) {
  const parent = captureHostToolPolicyAuthority(value);
  if (!parent) return null;
  if (CHILD_AUTHORITIES.has(parent)) return CHILD_AUTHORITIES.get(parent);
  let previous = null;
  let projected = null;
  const child = Object.freeze({
    getSnapshot() {
      const current = parent.getSnapshot();
      if (current !== previous) {
        projected = Object.freeze({
          ...current,
          policy: current.policy
            ? Object.freeze({
                ...current.policy,
                toolDefinitions: Object.freeze([]),
              })
            : null,
        });
        previous = current;
      }
      return projected;
    },
    subscribePolicyRevision: parent.subscribePolicyRevision,
  });
  AUTHORITIES.add(child);
  CHILD_AUTHORITIES.set(parent, child);
  return child;
}
