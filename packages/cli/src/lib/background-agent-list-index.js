import {
  chmodSync,
  lstatSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";

export const BACKGROUND_AGENT_LIST_INDEX_SCHEMA =
  "chainlesschain.background-agent-list-index/v1";
export const BACKGROUND_AGENT_LIST_INDEX_FILE =
  ".background-agent-list-index-v1";

const STATE_FILE = /^(bg-[A-Za-z0-9-]+)\.json$/u;
const MAX_INDEX_BYTES = 64 * 1024 * 1024;
const MAX_INDEX_ENTRIES = 1_000_000;

function sha256(value, domain) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(value)
    .digest("hex")}`;
}

function stateFileSignature(directory, name, id) {
  const target = join(directory, name);
  const link = lstatSync(target);
  if (!link.isFile() || link.isSymbolicLink()) {
    throw new TypeError(`background agent state is not a regular file: ${id}`);
  }
  const stat = statSync(target, { bigint: true });
  return {
    id,
    name,
    size: String(stat.size),
    mtimeNs: String(stat.mtimeNs),
    ctimeNs: String(stat.ctimeNs),
    dev: String(stat.dev),
    ino: String(stat.ino),
  };
}

function collectInventory(directory) {
  const files = readdirSync(directory, { withFileTypes: true })
    .map((entry) => {
      const match = STATE_FILE.exec(entry.name);
      if (!match || entry.name.includes(".job.")) return null;
      if (!entry.isFile()) {
        throw new TypeError(
          `background agent state is not a regular file: ${match[1]}`,
        );
      }
      return stateFileSignature(directory, entry.name, match[1]);
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  if (files.length > MAX_INDEX_ENTRIES) {
    throw new RangeError(
      `background agent list index exceeds ${MAX_INDEX_ENTRIES} entries`,
    );
  }
  const encoded = JSON.stringify(files);
  return {
    files,
    digest: sha256(encoded, "cc.background-agent-list-inventory/v1"),
  };
}

function normalizeEntry(value, inventoryIds) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!inventoryIds.has(value.id)) return null;
  const startedAt = Number(value.startedAt);
  if (!Number.isFinite(startedAt) || startedAt < 0) return null;
  if (
    typeof value.status !== "string" ||
    value.status.length === 0 ||
    value.status.length > 64
  ) {
    return null;
  }
  return { id: value.id, startedAt, status: value.status };
}

function readCachedIndex(directory, inventory) {
  const target = join(directory, BACKGROUND_AGENT_LIST_INDEX_FILE);
  try {
    const stat = lstatSync(target);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size <= 0 ||
      stat.size > MAX_INDEX_BYTES
    ) {
      return null;
    }
    const parsed = JSON.parse(readFileSync(target, "utf8"));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      parsed.schema !== BACKGROUND_AGENT_LIST_INDEX_SCHEMA ||
      parsed.inventoryDigest !== inventory.digest ||
      parsed.fileCount !== inventory.files.length ||
      !Array.isArray(parsed.entries) ||
      parsed.entries.length > inventory.files.length
    ) {
      return null;
    }
    const inventoryIds = new Set(inventory.files.map((file) => file.id));
    const entries = parsed.entries.map((entry) =>
      normalizeEntry(entry, inventoryIds),
    );
    if (entries.some((entry) => entry === null)) return null;
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
      return null;
    }
    const contentDigest = sha256(
      JSON.stringify({
        schema: parsed.schema,
        inventoryDigest: parsed.inventoryDigest,
        fileCount: parsed.fileCount,
        entries,
      }),
      "cc.background-agent-list-index/v1",
    );
    if (parsed.digest !== contentDigest) return null;
    return entries;
  } catch {
    return null;
  }
}

function writeCachedIndex(directory, inventory, entries) {
  const target = join(directory, BACKGROUND_AGENT_LIST_INDEX_FILE);
  const value = {
    schema: BACKGROUND_AGENT_LIST_INDEX_SCHEMA,
    inventoryDigest: inventory.digest,
    fileCount: inventory.files.length,
    entries,
  };
  value.digest = sha256(
    JSON.stringify(value),
    "cc.background-agent-list-index/v1",
  );
  const temporary = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify(value)}\n`, "utf8");
    } finally {
      closeSync(descriptor);
    }
    if (process.platform !== "win32") chmodSync(temporary, 0o600);
    renameSync(temporary, target);
  } catch {
    rmSync(temporary, { force: true });
  }
}

function projectState(state, id) {
  if (!state || typeof state !== "object" || String(state.id) !== id) {
    return null;
  }
  const startedAt = Number(state.startedAt || 0);
  if (!Number.isFinite(startedAt) || startedAt < 0) return null;
  if (
    typeof state.status !== "string" ||
    state.status.length === 0 ||
    state.status.length > 64
  ) {
    return null;
  }
  return { id, startedAt, status: state.status };
}

/**
 * Load a content-free projection when it exactly matches every authority-file
 * identity. A miss rebuilds from authority and retries the inventory fence;
 * callers must fall back to their authoritative scan if a concurrent writer
 * prevents a stable rebuild.
 */
export function loadBackgroundAgentListIndex({ directory, readState }) {
  if (typeof directory !== "string" || !directory) {
    throw new TypeError("background agent list index directory is required");
  }
  if (typeof readState !== "function") {
    throw new TypeError("background agent list index readState is required");
  }
  const inventory = collectInventory(directory);
  const cached = readCachedIndex(directory, inventory);
  if (cached) {
    return Object.freeze({
      source: "index",
      entries: Object.freeze(cached.map((entry) => Object.freeze(entry))),
    });
  }

  const entries = inventory.files
    .map((file) => projectState(readState(file.id), file.id))
    .filter(Boolean);
  const verifiedInventory = collectInventory(directory);
  if (verifiedInventory.digest !== inventory.digest) {
    const error = new Error(
      "background agent authority changed while rebuilding the list index",
    );
    error.code = "BACKGROUND_AGENT_LIST_INDEX_RACE";
    throw error;
  }
  writeCachedIndex(directory, inventory, entries);
  return Object.freeze({
    source: "rebuilt",
    entries: Object.freeze(entries.map((entry) => Object.freeze(entry))),
  });
}
