/**
 * Session-core singletons for the CLI
 *
 * Wires MemoryStore / BetaFlags / ApprovalGate with file-based persistence under
 * the CLI home dir (`~/.chainlesschain/`).
 *
 * Lazy: instances are created on first access so bootstrap stays fast.
 */

import { join } from "node:path";
import { getHomeDir } from "./paths.js";
import {
  MemoryStore,
  BetaFlags,
  ApprovalGate,
  APPROVAL_POLICY,
  createMemoryFileAdapter,
  createBetaFlagsFileAdapter,
  createApprovalGateFileAdapter,
  hydrateMemoryStore,
} from "@chainlesschain/session-core";

let _memoryStore = null;
let _betaFlags = null;
let _approvalGate = null;

export function getMemoryStorePath() {
  return join(getHomeDir(), "memory-store.json");
}

export function getBetaFlagsPath() {
  return join(getHomeDir(), "beta-flags.json");
}

export function getApprovalPoliciesPath() {
  return join(getHomeDir(), "approval-policies.json");
}

export function getMemoryStore() {
  if (_memoryStore) return _memoryStore;
  const adapter = createMemoryFileAdapter(getMemoryStorePath());
  _memoryStore = new MemoryStore({ adapter });
  hydrateMemoryStore(_memoryStore, adapter);
  return _memoryStore;
}

export async function getBetaFlags() {
  if (_betaFlags) return _betaFlags;
  const store = createBetaFlagsFileAdapter(getBetaFlagsPath());
  _betaFlags = new BetaFlags({ store });
  await _betaFlags.load();
  return _betaFlags;
}

export async function getApprovalGate() {
  if (_approvalGate) return _approvalGate;
  const store = createApprovalGateFileAdapter(getApprovalPoliciesPath());
  _approvalGate = new ApprovalGate({
    defaultPolicy: APPROVAL_POLICY.STRICT,
    store,
  });
  await _approvalGate.load();
  return _approvalGate;
}

export function resetSessionCoreSingletonsForTests() {
  _memoryStore = null;
  _betaFlags = null;
  _approvalGate = null;
}
