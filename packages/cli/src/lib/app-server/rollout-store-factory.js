import path from "node:path";

import {
  JsonlRolloutStore,
  assertRolloutStore,
  defaultRolloutStoreDirectory,
} from "./rollout-store.js";
import {
  SqliteRolloutStore,
  sqliteRolloutStoreAvailable,
} from "./sqlite-rollout-store.js";

export const ROLLOUT_STORE_BACKENDS = Object.freeze(["jsonl", "sqlite"]);
export const ROLLOUT_STORE_ENV = "CHAINLESSCHAIN_ROLLOUT_STORE";
export const ROLLOUT_STORE_PATH_ENV = "CHAINLESSCHAIN_ROLLOUT_STORE_PATH";

function factoryError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "RolloutStoreFactoryError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

export function normalizeRolloutStoreBackend(value = null) {
  const backend = String(value || "jsonl")
    .trim()
    .toLowerCase();
  if (!ROLLOUT_STORE_BACKENDS.includes(backend)) {
    throw factoryError(
      "CC_ROLLOUT_BACKEND_UNSUPPORTED",
      `unsupported rollout store backend: ${backend || "empty"}`,
      { backend, supported: [...ROLLOUT_STORE_BACKENDS] },
    );
  }
  return backend;
}

export function defaultSqliteRolloutStoreFilename() {
  return path.join(
    path.dirname(defaultRolloutStoreDirectory()),
    "rollouts.sqlite",
  );
}

function labelStore(store, backend, location) {
  if (!Object.isExtensible(store)) return store;
  for (const [key, value] of Object.entries({ backend, location })) {
    if (!Object.prototype.hasOwnProperty.call(store, key)) {
      Object.defineProperty(store, key, {
        configurable: false,
        enumerable: false,
        writable: false,
        value,
      });
    }
  }
  return store;
}

/**
 * Resolve one physical adapter behind the canonical RolloutStore contract.
 * A host-provided adapter is the extension seam for remote/synchronized stores;
 * it is accepted only after the complete logical contract is present.
 */
export function createRolloutStore({
  backend = process.env[ROLLOUT_STORE_ENV] || "jsonl",
  location = process.env[ROLLOUT_STORE_PATH_ENV] || null,
  directory = null,
  filename = null,
  adapter = null,
  now = Date.now,
} = {}) {
  if (adapter) {
    return labelStore(assertRolloutStore(adapter), "custom", location || null);
  }

  const normalizedBackend = normalizeRolloutStoreBackend(backend);
  if (normalizedBackend === "jsonl") {
    const resolvedDirectory = path.resolve(
      directory || location || defaultRolloutStoreDirectory(),
    );
    return labelStore(
      assertRolloutStore(
        new JsonlRolloutStore({ directory: resolvedDirectory, now }),
      ),
      normalizedBackend,
      resolvedDirectory,
    );
  }

  if (!sqliteRolloutStoreAvailable()) {
    throw factoryError(
      "CC_ROLLOUT_SQLITE_UNAVAILABLE",
      "SQLite rollout storage is unavailable in this Node runtime",
    );
  }
  const resolvedFilename = path.resolve(
    filename ||
      (directory ? path.join(directory, "rollouts.sqlite") : null) ||
      location ||
      defaultSqliteRolloutStoreFilename(),
  );
  return labelStore(
    assertRolloutStore(
      new SqliteRolloutStore({ filename: resolvedFilename, now }),
    ),
    normalizedBackend,
    resolvedFilename,
  );
}

export function closeRolloutStore(store) {
  if (store && typeof store.close === "function") store.close();
}
