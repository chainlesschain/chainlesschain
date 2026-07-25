"use strict";

const SAFE_MESSAGE_TYPE = /^[a-z0-9:._-]{1,100}$/iu;

/**
 * Return bounded routing metadata for a mobile command log entry.
 *
 * The payload can contain Cookie/OAuth credentials, stable account aliases,
 * or signed source URLs. Never stringify or recursively inspect it here.
 */
function summarizeMobileCommandMessage(message) {
  const payload = message && message.payload;
  const type =
    message &&
    typeof message.type === "string" &&
    SAFE_MESSAGE_TYPE.test(message.type)
      ? message.type
      : "[invalid]";
  const payloadFormat =
    payload == null
      ? "absent"
      : Array.isArray(payload)
        ? "array"
        : typeof payload;

  return {
    type,
    hasPayload: payload != null,
    payloadFormat,
    payloadBytes:
      typeof payload === "string" ? Buffer.byteLength(payload, "utf8") : null,
  };
}

module.exports = { summarizeMobileCommandMessage };
