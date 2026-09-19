"use strict";

const {
  redactBrowserLogValue,
} = require("../../browser/browser-log-redaction");

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
};
