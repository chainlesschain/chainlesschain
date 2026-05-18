/**
 * Desktop session-core singletons
 *
 * Managed Agents parity Phase H: mirrors packages/cli/src/lib/session-core-singletons.js
 * so the Desktop main process uses the *same* file-backed MemoryStore /
 * BetaFlags / ApprovalGate that the CLI does. Persistence lives under
 * `<userData>/.chainlesschain/` and shares the JSON schema with the CLI, so a
 * user's session policy, memories, and beta flags survive restarts and are
 * consistent across CLI ↔ Desktop.
 *
 * Lazy: instances are created on first access so boot stays fast. The `app`
 * dependency is injected lazily (and overridable via `_deps.app`) so this
 * module is unit-testable without an Electron runtime.
 */

const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const {
  MemoryStore,
  BetaFlags,
  ApprovalGate,
  APPROVAL_POLICY,
  SessionManager,
  createMemoryFileAdapter,
  createBetaFlagsFileAdapter,
  createApprovalGateFileAdapter,
  hydrateMemoryStore,
} = require("@chainlesschain/session-core");

const _deps = {
  // Injected lazily so tests can override without pulling in electron.
  getUserDataDir: null,
};

function resolveHomeDir() {
  if (_deps.getUserDataDir) {
    return _deps.getUserDataDir();
  }
  // Lazy-require electron so the module can be loaded in Vitest/Node test env
  // where `electron` is unavailable.
  const { app } = require("electron");
  return path.join(app.getPath("userData"), ".chainlesschain");
}

let _memoryStore = null;
let _betaFlags = null;
let _approvalGate = null;
let _sessionManager = null;

function getMemoryStorePath() {
  return path.join(resolveHomeDir(), "memory-store.json");
}

function getBetaFlagsPath() {
  return path.join(resolveHomeDir(), "beta-flags.json");
}

function getApprovalPoliciesPath() {
  return path.join(resolveHomeDir(), "approval-policies.json");
}

function getMemoryStore() {
  if (_memoryStore) {
    return _memoryStore;
  }
  const adapter = createMemoryFileAdapter(getMemoryStorePath());
  _memoryStore = new MemoryStore({ adapter });
  hydrateMemoryStore(_memoryStore, adapter);
  return _memoryStore;
}

async function getBetaFlags() {
  if (_betaFlags) {
    return _betaFlags;
  }
  const store = createBetaFlagsFileAdapter(getBetaFlagsPath());
  _betaFlags = new BetaFlags({ store });
  await _betaFlags.load();
  return _betaFlags;
}

async function getApprovalGate() {
  if (_approvalGate) {
    return _approvalGate;
  }
  const store = createApprovalGateFileAdapter(getApprovalPoliciesPath());
  _approvalGate = new ApprovalGate({
    defaultPolicy: APPROVAL_POLICY.STRICT,
    store,
  });
  await _approvalGate.load();
  return _approvalGate;
}

function getParkedSessionsPath() {
  return path.join(resolveHomeDir(), "parked-sessions.json");
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
    const dir = path.join(filePath, "..");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
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

function getSessionManager() {
  if (_sessionManager) {
    return _sessionManager;
  }
  const store = createParkedSessionsStore(getParkedSessionsPath());
  _sessionManager = new SessionManager({ store });
  _sessionManager._parkedStore = store;
  return _sessionManager;
}

function resetSessionCoreSingletonsForTests() {
  _memoryStore = null;
  _betaFlags = null;
  _approvalGate = null;
  _sessionManager = null;
}

module.exports = {
  getMemoryStore,
  getBetaFlags,
  getApprovalGate,
  getSessionManager,
  getMemoryStorePath,
  getBetaFlagsPath,
  getApprovalPoliciesPath,
  getParkedSessionsPath,
  resetSessionCoreSingletonsForTests,
  _deps,
};
