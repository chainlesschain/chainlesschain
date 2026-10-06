"use strict";

const {
  redactBrowserLogValue,
} = require("../../browser/browser-log-redaction");
const {
  projectAuditField,
  projectAuditMetadata,
  AUDIT_POLICY_VERSION,
} = require("@chainlesschain/session-core/audit-data-policy");

const SCHEMA = "remote-command-audit-redaction/v1";
const LABELS = new Set(["params", "result", "error"]);
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/u;

function assertLabel(label) {
  if (!LABELS.has(label)) {
    throw new TypeError("Remote command audit label is invalid");
  }
}

function createRemoteCommandAuditProjection(label, value) {
  assertLabel(label);
  const redaction = redactBrowserLogValue(
    `remote-command-audit-${label}`,
    value,
  );
  return Object.freeze({
    schema: SCHEMA,
    label,
    redacted: true,
    policyVersion: AUDIT_POLICY_VERSION,
    metadata: projectAuditMetadata(value),
    valueDigest: redaction.valueDigest,
    byteLength: redaction.byteLength,
  });
}

function isRemoteCommandAuditProjection(label, value) {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype &&
    value.schema === SCHEMA &&
    value.label === label &&
    value.redacted === true &&
    typeof value.valueDigest === "string" &&
    SHA256_DIGEST.test(value.valueDigest) &&
    (value.byteLength === null ||
      (Number.isSafeInteger(value.byteLength) && value.byteLength >= 0))
  );
}

function serializeRemoteCommandAuditValue(label, value) {
  if (value === null || value === undefined) {
    return null;
  }
  return JSON.stringify(createRemoteCommandAuditProjection(label, value));
}

function deserializeRemoteCommandAuditValue(label, raw) {
  assertLabel(label);
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }

  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
  }

  if (isRemoteCommandAuditProjection(label, parsed)) {
    return Object.freeze({
      schema: SCHEMA,
      label,
      redacted: true,
      policyVersion: AUDIT_POLICY_VERSION,
      metadata: projectAuditMetadata(parsed.metadata ?? null),
      valueDigest: parsed.valueDigest,
      byteLength: parsed.byteLength,
    });
  }

  return createRemoteCommandAuditProjection(label, parsed);
}

module.exports = {
  createRemoteCommandAuditProjection,
  deserializeRemoteCommandAuditValue,
  serializeRemoteCommandAuditValue,
  projectRemoteAuditEnvelope,
  projectStoredRemoteAuditEnvelope,
};

function projectRemoteAuditEnvelope(entry) {
  const result = {};
  for (const key of [
    "requestId",
    "deviceDid",
    "deviceName",
    "namespace",
    "action",
    "status",
    "level",
    "duration",
    "timestamp",
    "createdAt",
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(entry, key);
    if (descriptor && "value" in descriptor)
      result[key] = projectAuditField(key, descriptor.value);
  }
  return result;
}

function projectStoredRemoteAuditEnvelope(entry) {
  const result = {};
  for (const key of [
    "id",
    "request_id",
    "device_did",
    "device_name",
    "command_namespace",
    "command_action",
    "status",
    "level",
    "duration",
    "timestamp",
    "created_at",
  ]) {
    if (key === "id") result.id = entry.id;
    else
      result[key] = projectAuditField(key.replace("command_", ""), entry[key]);
  }
  return result;
}
