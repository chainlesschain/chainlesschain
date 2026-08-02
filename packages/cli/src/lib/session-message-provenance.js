/**
 * Provenance for durable system messages that are safe to replay after a
 * fresh host system prompt.
 *
 * The JSONL wire tag is hash-chain protected, but it must never reach a model
 * provider. Runtime objects therefore carry the same tag in a private WeakMap;
 * message keys and provider serialization remain byte-for-byte unchanged.
 */

export const SESSION_MESSAGE_PROVENANCE_FIELD = "_cc_replay";
export const SESSION_MESSAGE_PROVENANCE_SCHEMA =
  "chainlesschain.session-message-provenance/v1";

export const DURABLE_SYSTEM_MESSAGE_KINDS = Object.freeze({
  COMPACT_SUMMARY: "compact-summary",
  COMPACT_TOOL_COLLAPSE: "compact-tool-collapse",
  CHECKPOINT_SUMMARY: "checkpoint-summary",
  MIGRATION_SUMMARY: "migration-summary",
});

const DURABLE_KINDS = new Set(Object.values(DURABLE_SYSTEM_MESSAGE_KINDS));
const RUNTIME_PROVENANCE = new WeakMap();

function isObjectMessage(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
  return (
    isObjectMessage(value) &&
    value.schema === SESSION_MESSAGE_PROVENANCE_SCHEMA &&
    DURABLE_KINDS.has(value.kind)
  );
}

function attachRuntimeTag(message, tag) {
  RUNTIME_PROVENANCE.set(message, tag);
  return message;
}

export function markDurableSystemMessage(message, kind) {
  if (!isObjectMessage(message) || message.role !== "system") {
    throw new TypeError("Only system messages can carry durable provenance");
  }
  return attachRuntimeTag(message, canonicalTag(kind));
}

export function getDurableSystemMessageProvenance(message) {
  if (!isObjectMessage(message) || message.role !== "system") return null;
  const tag = RUNTIME_PROVENANCE.get(message);
  return validWireTag(tag) ? tag : null;
}

function withoutWireTag(message) {
  if (
    !Object.prototype.hasOwnProperty.call(
      message,
      SESSION_MESSAGE_PROVENANCE_FIELD,
    )
  ) {
    return message;
  }
  const clean = { ...message };
  delete clean[SESSION_MESSAGE_PROVENANCE_FIELD];
  return clean;
}

/** Convert a runtime-only marker to the transcript wire representation. */
export function encodePersistedMessage(message) {
  if (!isObjectMessage(message)) return message;
  const clean = withoutWireTag(message);
  const tag = getDurableSystemMessageProvenance(message);
  if (!tag) return clean;
  return {
    ...clean,
    [SESSION_MESSAGE_PROVENANCE_FIELD]: tag,
  };
}

/** Strip the transcript wire tag and restore its runtime-only marker. */
export function decodePersistedMessage(message) {
  if (!isObjectMessage(message)) return message;
  const wireTag = message[SESSION_MESSAGE_PROVENANCE_FIELD];
  const clean = withoutWireTag(message);
  if (clean.role === "system" && validWireTag(wireTag)) {
    return attachRuntimeTag(clean, canonicalTag(wireTag.kind));
  }
  return clean;
}

/**
 * Canonical host resume projection: conversation messages always replay;
 * system messages replay only when their durable provenance is explicit.
 */
export function projectCanonicalResumeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const projected = [];
  for (const raw of messages) {
    const message = decodePersistedMessage(raw);
    if (!isObjectMessage(message) || typeof message.role !== "string") continue;
    if (
      message.role !== "system" ||
      getDurableSystemMessageProvenance(message)
    ) {
      projected.push(message);
    }
  }
  return projected;
}
