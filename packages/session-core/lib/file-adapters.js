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
const crypto = require("crypto");

// Temp-name generator behind a seam so it's testable. A UNIQUE name per write is
// essential: with a fixed `${filePath}.tmp`, two processes writing the same file
// (multiple `cc` sessions sharing memory-store.json) race on one temp — one
// process's rename can move the OTHER's half-written temp into place, corrupting
// the file or throwing ENOENT. pid + random makes each write independent.
const _deps = {
  tmpName: (filePath) =>
    `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`,
};

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
  const tmp = _deps.tmpName(filePath);
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, filePath);
  } catch (err) {
    // Don't leave a stray temp behind if the rename (or write) fails.
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* best-effort cleanup */
    }
    throw err;
  }
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
  _deps,
};
