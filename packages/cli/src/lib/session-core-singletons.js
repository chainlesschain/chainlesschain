/**
 * Session-core singletons for the CLI
 *
 * Wires MemoryStore / BetaFlags / ApprovalGate with file-based persistence under
 * the CLI home dir (`~/.chainlesschain/`).
 *
 * Lazy: instances are created on first access so bootstrap stays fast.
 */

import { join } from "node:path";
import { promises as fsp, existsSync, mkdirSync } from "node:fs";
import { getHomeDir } from "./paths.js";
import {
  MemoryStore,
  BetaFlags,
  ApprovalGate,
  APPROVAL_POLICY,
  SessionManager,
  StreamRouter,
  createMemoryFileAdapter,
  createBetaFlagsFileAdapter,
  createApprovalGateFileAdapter,
  hydrateMemoryStore,
} from "@chainlesschain/session-core";

let _memoryStore = null;
let _betaFlags = null;
let _approvalGate = null;
let _sessionManager = null;

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

export function getParkedSessionsPath() {
  return join(getHomeDir(), "parked-sessions.json");
}

function createParkedSessionsStore(filePath) {
  async function readAll() {
    try {
      const raw = await fsp.readFile(filePath, "utf8");
      return JSON.parse(raw || "{}");
    } catch {
      return {};
    }
  }
  async function writeAll(map) {
    const dir = join(filePath, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    await fsp.writeFile(filePath, JSON.stringify(map, null, 2), "utf8");
  }
  return {
    async save(json) {
      const map = await readAll();
      map[json.sessionId] = json;
      await writeAll(map);
    },
    async load(sessionId) {
      const map = await readAll();
      return map[sessionId] || null;
    },
    async remove(sessionId) {
      const map = await readAll();
      delete map[sessionId];
      await writeAll(map);
    },
    async list() {
      return Object.values(await readAll());
    },
  };
}

export function getSessionManager() {
  if (_sessionManager) return _sessionManager;
  const store = createParkedSessionsStore(getParkedSessionsPath());
  _sessionManager = new SessionManager({ store });
  _sessionManager._parkedStore = store;
  return _sessionManager;
}

export function createStreamRouter() {
  return new StreamRouter();
}

export function resetSessionCoreSingletonsForTests() {
  _memoryStore = null;
  _betaFlags = null;
  _approvalGate = null;
  _sessionManager = null;
}
