/**
 * Provenance for durable system messages that are safe to replay after a
 * fresh host system prompt.
 *
 * The JSONL wire tag is hash-chain protected, but it must never reach a model
 * provider. Runtime objects therefore carry the same tag in a private WeakMap;
 * message keys and provider serialization remain byte-for-byte unchanged.
 */

import { types as utilTypes } from "node:util";

export const SESSION_MESSAGE_PROVENANCE_FIELD = "_cc_replay";
export const SESSION_FORK_AUTHORITY_FIELD = "_cc_fork_authority";
export const SESSION_MESSAGE_PROVENANCE_SCHEMA =
  "chainlesschain.session-message-provenance/v1";

export const DURABLE_SYSTEM_MESSAGE_KINDS = Object.freeze({
  COMPACT_SUMMARY: "compact-summary",
  COMPACT_TOOL_COLLAPSE: "compact-tool-collapse",
  CHECKPOINT_SUMMARY: "checkpoint-summary",
  MIGRATION_SUMMARY: "migration-summary",
  FORK_LINEAGE: "fork-lineage",
});

const DURABLE_KINDS = new Set(Object.values(DURABLE_SYSTEM_MESSAGE_KINDS));
const RUNTIME_PROVENANCE = new WeakMap();
const INVALID_DATA = Symbol("invalid-session-message-data");
const MAX_DATA_DEPTH = 100;
const MAX_DATA_NODES = 100_000;

function isObjectMessage(value) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !utilTypes.isProxy(value) &&
    !Array.isArray(value)
  );
}

/**
 * Snapshot a JSON-shaped object without invoking user-controlled accessors or
 * Proxy traps. Session messages cross persistence and host-adapter trust
 * boundaries, so an accessor-bearing value is invalid rather than executable.
 */
function plainDataSnapshot(value) {
  if (!isObjectMessage(value) || utilTypes.isProxy(value)) return null;
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  if (prototype !== Object.prototype && prototype !== null) return null;

  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key === "symbol")) return null;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (
      !Object.prototype.hasOwnProperty.call(descriptor, "value") ||
      descriptor.enumerable !== true
    ) {
      return null;
    }
  }
  return { value, descriptors, keys };
}

function plainDataArrayValues(value) {
  if (utilTypes.isProxy(value) || !Array.isArray(value)) return null;
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  const lengthDescriptor = descriptors.length;
  const length = lengthDescriptor?.value;
  const keys = Reflect.ownKeys(descriptors);
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    keys.some((key) => typeof key === "symbol") ||
    keys.length !== length + 1
  ) {
    return null;
  }
  const values = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      !descriptor ||
      !Object.prototype.hasOwnProperty.call(descriptor, "value") ||
      descriptor.enumerable !== true
    ) {
      return null;
    }
    values.push(descriptor.value);
  }
  return values;
}

function dataValue(snapshot, key) {
  const descriptor = snapshot?.descriptors?.[key];
  return descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value")
    ? descriptor.value
    : undefined;
}

function ownDataMessageRole(value) {
  if (!isObjectMessage(value)) return null;
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  const descriptor = descriptors.role;
  if (
    !descriptor ||
    !Object.prototype.hasOwnProperty.call(descriptor, "value") ||
    descriptor.enumerable !== true ||
    typeof descriptor.value !== "string"
  ) {
    return null;
  }
  return descriptor.value;
}

function cloneJsonDataValue(value, state, depth) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (!value || typeof value !== "object" || depth > MAX_DATA_DEPTH) {
    return INVALID_DATA;
  }
  if (utilTypes.isProxy(value)) return INVALID_DATA;
  state.remaining -= 1;
  if (state.remaining < 0 || state.ancestors.has(value)) return INVALID_DATA;
  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const values = plainDataArrayValues(value);
      if (!values) return INVALID_DATA;
      const clean = [];
      for (const item of values) {
        const cloned = cloneJsonDataValue(item, state, depth + 1);
        if (cloned === INVALID_DATA) return INVALID_DATA;
        clean.push(cloned);
      }
      return clean;
    }

    const snapshot = plainDataSnapshot(value);
    if (!snapshot) return INVALID_DATA;
    const clean = {};
    for (const key of snapshot.keys) {
      const cloned = cloneJsonDataValue(
        snapshot.descriptors[key].value,
        state,
        depth + 1,
      );
      if (cloned === INVALID_DATA) return INVALID_DATA;
      Object.defineProperty(clean, key, {
        value: cloned,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return clean;
  } finally {
    state.ancestors.delete(value);
  }
}

function cloneWithoutWireTag(snapshot) {
  const clean = {};
  const state = {
    ancestors: new WeakSet([snapshot.value]),
    remaining: MAX_DATA_NODES - 1,
  };
  for (const key of snapshot.keys) {
    if (
      key === SESSION_MESSAGE_PROVENANCE_FIELD ||
      key === SESSION_FORK_AUTHORITY_FIELD
    ) {
      continue;
    }
    const cloned = cloneJsonDataValue(
      snapshot.descriptors[key].value,
      state,
      1,
    );
    if (cloned === INVALID_DATA) return null;
    Object.defineProperty(clean, key, {
      value: cloned,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return clean;
}

function canonicalTag(kind) {
  if (!DURABLE_KINDS.has(kind)) {
    throw new TypeError(`Unsupported durable system message kind: ${kind}`);
  }
  return Object.freeze({
    schema: SESSION_MESSAGE_PROVENANCE_SCHEMA,
    kind,
  });
}

function validWireTag(value) {
  const snapshot = plainDataSnapshot(value);
  return Boolean(
    snapshot &&
    snapshot.keys.length === 2 &&
    snapshot.keys.includes("schema") &&
    snapshot.keys.includes("kind") &&
    dataValue(snapshot, "schema") === SESSION_MESSAGE_PROVENANCE_SCHEMA &&
    DURABLE_KINDS.has(dataValue(snapshot, "kind")),
  );
}

function attachRuntimeTag(message, tag) {
  RUNTIME_PROVENANCE.set(message, tag);
  return message;
}

export function markDurableSystemMessage(message, kind) {
  const snapshot = plainDataSnapshot(message);
  if (!snapshot || dataValue(snapshot, "role") !== "system") {
    throw new TypeError("Only system messages can carry durable provenance");
  }
  return attachRuntimeTag(message, canonicalTag(kind));
}

export function getDurableSystemMessageProvenance(message) {
  const snapshot = plainDataSnapshot(message);
  if (!snapshot || dataValue(snapshot, "role") !== "system") return null;
  const tag = RUNTIME_PROVENANCE.get(message);
  return validWireTag(tag) ? tag : null;
}

/**
 * Preserve an existing runtime capability across one explicitly trusted clone.
 * Generic object spread, structuredClone and JSON round-trips intentionally do
 * not preserve this WeakMap authority.
 */
export function preserveDurableSystemMessageProvenance(source, clone) {
  const tag = getDurableSystemMessageProvenance(source);
  if (!tag) return clone;
  const snapshot = plainDataSnapshot(clone);
  if (!snapshot || dataValue(snapshot, "role") !== "system") {
    throw new TypeError("Durable system provenance clone is invalid");
  }
  return attachRuntimeTag(clone, canonicalTag(tag.kind));
}

/** Convert a runtime-only marker to the transcript wire representation. */
export function encodePersistedMessage(message) {
  if (!message || typeof message !== "object") return message;
  if (!isObjectMessage(message)) {
    throw new TypeError("Session message must be a plain data object");
  }
  const snapshot = plainDataSnapshot(message);
  if (!snapshot) {
    throw new TypeError("Session message must be a plain data object");
  }
  const clean = cloneWithoutWireTag(snapshot);
  if (!clean) {
    throw new TypeError("Session message must contain JSON-safe data");
  }
  const tag = getDurableSystemMessageProvenance(message);
  if (!tag) return clean;
  return {
    ...clean,
    [SESSION_MESSAGE_PROVENANCE_FIELD]: tag,
  };
}

/**
 * Decode provenance only after the caller has verified the JSONL hash chain
 * and its independent head/count anchor while holding the session lock.
 */
export function decodeVerifiedPersistedMessage(message) {
  if (!message || typeof message !== "object") return message;
  if (!isObjectMessage(message)) return null;
  const snapshot = plainDataSnapshot(message);
  if (!snapshot) return null;
  const wireTag = dataValue(snapshot, SESSION_MESSAGE_PROVENANCE_FIELD);
  const clean = cloneWithoutWireTag(snapshot);
  if (!clean) return null;
  if (dataValue(snapshot, "role") === "system" && validWireTag(wireTag)) {
    const tagSnapshot = plainDataSnapshot(wireTag);
    return attachRuntimeTag(
      clean,
      canonicalTag(dataValue(tagSnapshot, "kind")),
    );
  }
  return clean;
}

/** Strip an untrusted wire field without granting runtime replay authority. */
export function sanitizePersistedMessage(message) {
  if (!message || typeof message !== "object") return message;
  if (!isObjectMessage(message)) return null;
  const snapshot = plainDataSnapshot(message);
  return snapshot ? cloneWithoutWireTag(snapshot) : null;
}

/** Deep-sanitize an untrusted persisted message array without granting replay. */
export function sanitizePersistedMessages(messages, options = {}) {
  const strict = options?.strict === true;
  const rawMessages = plainDataArrayValues(messages);
  if (!rawMessages) {
    if (strict) {
      throw new TypeError(
        "Persisted messages must be a plain dense data array",
      );
    }
    return [];
  }
  const clean = [];
  for (const raw of rawMessages) {
    const message = sanitizePersistedMessage(raw);
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      if (strict) {
        throw new TypeError("Persisted message must contain JSON-safe data");
      }
      continue;
    }
    clean.push(message);
  }
  return clean;
}

/**
 * Deep-sanitize only conversation messages. The role is inspected through its
 * own data descriptor before the full message is cloned, so a host-owned
 * system notice may carry a private Symbol marker and still be skipped without
 * executing any accessor or Proxy trap. Non-system messages remain strict
 * plain JSON data.
 */
export function sanitizePersistedNonSystemMessages(messages, options = {}) {
  const strict = options?.strict === true;
  const rawMessages = plainDataArrayValues(messages);
  if (!rawMessages) {
    if (strict) {
      throw new TypeError(
        "Persisted messages must be a plain dense data array",
      );
    }
    return [];
  }
  const clean = [];
  for (const raw of rawMessages) {
    const role = ownDataMessageRole(raw);
    if (!role) {
      if (strict) {
        throw new TypeError("Persisted message role must be plain string data");
      }
      continue;
    }
    if (role === "system") continue;
    const message = sanitizePersistedMessage(raw);
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      if (strict) {
        throw new TypeError("Persisted message must contain JSON-safe data");
      }
      continue;
    }
    clean.push(message);
  }
  return clean;
}

/**
 * Canonical host resume projection: conversation messages always replay;
 * system messages replay only when their durable provenance is explicit.
 */
export function projectCanonicalResumeMessages(messages, options = {}) {
  const strict = options?.strict === true;
  const invalid = (message) => {
    if (strict) throw new TypeError(message);
    return null;
  };
  const rawMessages = plainDataArrayValues(messages);
  if (!rawMessages) {
    invalid("Canonical resume messages must be a plain dense data array");
    return [];
  }
  const projected = [];
  for (const raw of rawMessages) {
    const snapshot = plainDataSnapshot(raw);
    if (!snapshot) {
      invalid("Canonical resume message must be a plain data object");
      continue;
    }
    const role = dataValue(snapshot, "role");
    if (typeof role !== "string") {
      invalid("Canonical resume message role must be a string");
      continue;
    }

    const runtimeTag = getDurableSystemMessageProvenance(raw);
    const clean = cloneWithoutWireTag(snapshot);
    if (!clean) {
      invalid("Canonical resume message must contain JSON-safe data");
      continue;
    }
    if (role !== "system") {
      projected.push(clean);
    } else if (runtimeTag) {
      projected.push(attachRuntimeTag(clean, canonicalTag(runtimeTag.kind)));
    }
  }
  return projected;
}
