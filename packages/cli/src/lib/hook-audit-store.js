import crypto from "node:crypto";
import path from "node:path";
import { getHomeDir } from "./paths.js";
import {
  mutateSecurityStore,
  readSecurityStore,
} from "./durable-security-store.js";
import { stableStringify } from "./hook-runtime-contract.js";

export const HOOK_AUDIT_STORE_SCHEMA =
  "chainlesschain.hook-runtime-audit-store/v1";
export const HOOK_AUDIT_RECORD_SCHEMA = "chainlesschain.hook-runtime-audit/v1";
export const DEFAULT_MAX_HOOK_AUDIT_RECORDS = 10000;

function sha256(label, value) {
  return crypto
    .createHash("sha256")
    .update(`${label}\0`, "utf8")
    .update(String(value), "utf8")
    .digest("hex");
}

function safeToken(value, max = 256) {
  if (value == null) return null;
  const text = String(value);
  return text.length <= max ? text : text.slice(0, max);
}

function digestToken(value) {
  if (value == null || value === "") return null;
  const text = String(value);
  return /^[a-f0-9]{64}$/iu.test(text)
    ? text.toLowerCase()
    : sha256("chainlesschain.hook-audit-token.v1", text);
}

function normalizeRecord(record = {}) {
  return {
    schema: HOOK_AUDIT_RECORD_SCHEMA,
    timestamp: safeToken(record.timestamp || new Date().toISOString(), 64),
    phase: safeToken(record.phase, 32),
    event: safeToken(record.event, 96),
    eventId: digestToken(record.eventId),
    executionId: digestToken(record.executionId),
    hookId: digestToken(record.hookId),
    hookDigest: digestToken(record.hookDigest),
    sourceKind: safeToken(record.sourceKind, 32),
    sourceDigest: digestToken(record.sourceDigest),
    trustStatus: safeToken(record.trustStatus, 64),
    priority: Number.isFinite(Number(record.priority))
      ? Number(record.priority)
      : null,
    executionMode: safeToken(record.executionMode, 32),
    status: safeToken(record.status, 32),
    decision: safeToken(record.decision, 32),
    durationMs: Number.isFinite(Number(record.durationMs))
      ? Math.max(0, Math.floor(Number(record.durationMs)))
      : null,
    errorCode: safeToken(record.errorCode, 96),
  };
}

function hashRecord(prevHash, record) {
  return sha256(
    "chainlesschain.hook-audit-chain.v1",
    `${prevHash || "genesis"}\n${stableStringify(record)}`,
  );
}

function validateStore(store) {
  if (Object.keys(store).length === 0) {
    return {
      schema: HOOK_AUDIT_STORE_SCHEMA,
      anchorHash: null,
      headHash: null,
      records: [],
    };
  }
  if (
    store.schema !== HOOK_AUDIT_STORE_SCHEMA ||
    !Array.isArray(store.records) ||
    (store.anchorHash != null && typeof store.anchorHash !== "string") ||
    (store.headHash != null && typeof store.headHash !== "string")
  ) {
    const error = new Error("Hook audit store has an invalid schema");
    error.code = "CC_HOOK_AUDIT_STORE_INVALID";
    throw error;
  }
  return store;
}

export class HookAuditStore {
  constructor({ filePath, maxRecords, now } = {}) {
    this.filePath =
      filePath ||
      process.env.CC_HOOK_AUDIT_FILE ||
      path.join(getHomeDir(), "audit", "hook-runtime-v1.json");
    this.maxRecords = Math.max(
      100,
      Math.min(100000, Number(maxRecords) || DEFAULT_MAX_HOOK_AUDIT_RECORDS),
    );
    this.now = typeof now === "function" ? now : () => new Date().toISOString();
  }

  append(record) {
    const normalized = normalizeRecord({
      ...record,
      timestamp: record?.timestamp || this.now(),
    });
    return mutateSecurityStore(this.filePath, "Hook runtime audit", (draft) => {
      const store = validateStore(draft);
      if (Object.keys(draft).length === 0) Object.assign(draft, store);
      const prevHash = draft.headHash || draft.anchorHash || null;
      const hash = hashRecord(prevHash, normalized);
      draft.records.push({ record: normalized, prevHash, hash });
      draft.headHash = hash;
      if (draft.records.length > this.maxRecords) {
        const removeCount = draft.records.length - this.maxRecords;
        const removed = draft.records.splice(0, removeCount);
        draft.anchorHash =
          removed[removed.length - 1]?.hash || draft.anchorHash;
      }
      return Object.freeze({ ...normalized, prevHash, hash });
    });
  }

  list({ limit = 100 } = {}) {
    const store = validateStore(
      readSecurityStore(this.filePath, "Hook runtime audit"),
    );
    return store.records.slice(-Math.max(0, Number(limit) || 0));
  }

  verify() {
    const store = validateStore(
      readSecurityStore(this.filePath, "Hook runtime audit"),
    );
    let prev = store.anchorHash || null;
    for (let index = 0; index < store.records.length; index += 1) {
      const entry = store.records[index];
      if (!entry || entry.prevHash !== prev) {
        return { ok: false, length: store.records.length, brokenAt: index };
      }
      const expected = hashRecord(prev, entry.record);
      if (entry.hash !== expected) {
        return { ok: false, length: store.records.length, brokenAt: index };
      }
      prev = entry.hash;
    }
    return {
      ok: prev === (store.headHash || store.anchorHash || null),
      length: store.records.length,
      brokenAt:
        prev === (store.headHash || store.anchorHash || null)
          ? -1
          : store.records.length,
      headHash: store.headHash || null,
    };
  }
}

let defaultStore;
export function getDefaultHookAuditStore() {
  if (!defaultStore) defaultStore = new HookAuditStore();
  return defaultStore;
}

export function _resetDefaultHookAuditStore() {
  defaultStore = undefined;
}
