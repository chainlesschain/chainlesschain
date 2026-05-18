/**
 * File-based adapters for MemoryStore and BetaFlags
 *
 * Phase G (integration): JSON file persistence for CLI/Desktop
 *   - `.chainlesschain/memory-store.json` — MemoryStore
 *   - `.chainlesschain/beta-flags.json`   — BetaFlags
 *
 * 纯同步 + 软错误:读失败返回默认值,写失败 throw 供 store-error 捕获。
 */

const fs = require("fs");
const path = require("path");

function ensureDirSync(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const txt = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, data) {
  ensureDirSync(filePath);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

/**
 * MemoryStore file adapter — pre-load records via fromFile,
 * save/remove writes back the full snapshot each call (memory store is small).
 */
function createMemoryFileAdapter(filePath) {
  return {
    filePath,
    _snapshot: readJsonSafe(filePath, { memories: [] }),

    load() {
      this._snapshot = readJsonSafe(filePath, { memories: [] });
      return this._snapshot.memories || [];
    },

    async save(memory) {
      const list = this._snapshot.memories || [];
      const idx = list.findIndex((m) => m.id === memory.id);
      if (idx >= 0) list[idx] = memory;
      else list.push(memory);
      this._snapshot.memories = list;
      writeJsonAtomic(filePath, this._snapshot);
    },

    async remove(id) {
      const list = this._snapshot.memories || [];
      this._snapshot.memories = list.filter((m) => m.id !== id);
      writeJsonAtomic(filePath, this._snapshot);
    },
  };
}

/**
 * Hydrate a MemoryStore from file, using its public `add()` so scorer/validators run.
 */
function hydrateMemoryStore(memoryStore, adapter) {
  const records = adapter.load();
  for (const r of records) {
    try {
      memoryStore._memories.set(r.id, { ...r });
    } catch {
      /* skip malformed */
    }
  }
  return records.length;
}

/**
 * BetaFlags file adapter
 */
function createBetaFlagsFileAdapter(filePath) {
  return {
    filePath,
    async load() {
      const data = readJsonSafe(filePath, { flags: [] });
      return Array.isArray(data.flags) ? data.flags : [];
    },
    async save(flags) {
      writeJsonAtomic(filePath, { flags: Array.from(flags) });
    },
  };
}

/**
 * ApprovalGate file adapter — persists per-session policy overrides.
 * Shape on disk: { policies: { [sessionId]: "strict" | "trusted" | "autopilot" } }
 */
function createApprovalGateFileAdapter(filePath) {
  return {
    filePath,
    async load() {
      const data = readJsonSafe(filePath, { policies: {} });
      return data.policies && typeof data.policies === "object"
        ? data.policies
        : {};
    },
    async save(policies) {
      writeJsonAtomic(filePath, { policies: policies || {} });
    },
  };
}

module.exports = {
  createMemoryFileAdapter,
  createBetaFlagsFileAdapter,
  createApprovalGateFileAdapter,
  hydrateMemoryStore,
  readJsonSafe,
  writeJsonAtomic,
};
