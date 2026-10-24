import { openSync, readSync, closeSync } from "node:fs";
import { types } from "node:util";
import { createRequire } from "node:module";
import { transportErrorDetails } from "../src/lib/transport-error-details.js";
import { storageFailureCodesFromMessage } from "../src/lib/storage-failure-cause-codes.js";

const MAX_BYTES = 65_536;
const MAX_EVENTS = 128;
const EVENTS = new Set(["undici:request:error", "undici:client:connectError"]);
const ENDPOINTS = new Set(["loopback-broker", "other", "unknown"]);
const cliRequire = createRequire(
  new URL("../src/lib/ollama-provider-fetch.js", import.meta.url),
);

function version(value) {
  return typeof value === "string" && /^\d{1,5}\.\d{1,5}\.\d{1,5}$/u.test(value)
    ? value
    : null;
}

/** Resolution readback only; this is not proof of a successful model call. */
export function readReliabilityFetchRuntime() {
  let undici = null;
  try {
    undici = version(cliRequire("undici/package.json").version);
  } catch {
    // An unavailable dependency is reported without exposing its path.
  }
  return {
    coordinate: "parent-shared-binary-and-cli-module-resolution",
    node: version(process.versions.node),
    uv: version(process.versions.uv),
    bundledUndici: version(process.versions.undici),
    ollamaUndici: undici,
  };
}

function data(value, key) {
  if (!value || typeof value !== "object" || types.isProxy(value))
    return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function transportDetails(value) {
  if (!value || typeof value !== "object") return null;
  return (
    transportErrorDetails({
      name: data(value, "name"),
      code: data(value, "code"),
      cause: { code: data(value, "causeCode") },
    }) || null
  );
}

export function reliabilityResultFailure(event, turn) {
  if (data(event, "is_error") === false) return null;
  const details = data(event, "error_details");
  const storageCauseCodes =
    data(event, "code") === "CC_AGENT_EVOLUTION_INGRESS_FAILED" &&
    data(event, "subtype") === "error_evolution_ingress"
      ? storageFailureCodesFromMessage(data(event, "error"))
      : [];
  return {
    turn: Number.isSafeInteger(turn) && turn > 0 ? turn : null,
    subtype: data(event, "subtype") === "error" ? "error" : "unknown",
    errorDetails:
      data(details, "kind") === "transport" ? transportDetails(details) : null,
    ...(storageCauseCodes.length ? { storageCauseCodes } : {}),
  };
}

/** Re-project passive telemetry; never copy raw provider text or coordinates. */
export function readReliabilityFetchDiagnostics(file) {
  let fd;
  try {
    fd = openSync(file, "r");
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    let truncated = length > MAX_BYTES;
    const text = bytes
      .subarray(0, Math.min(length, MAX_BYTES))
      .toString("utf8");
    let enabled = false;
    const events = [];
    for (const line of text.split("\n")) {
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (record?.schema !== "chainlesschain.fetch-diagnostics/v1") continue;
      if (record.event === "enabled" && record.passive === true) enabled = true;
      if (record.event === "truncated") truncated = true;
      if (!EVENTS.has(record.event)) continue;
      if (events.length === MAX_EVENTS) {
        truncated = true;
        break;
      }
      events.push({
        event: record.event,
        endpoint: ENDPOINTS.has(record.endpoint) ? record.endpoint : "unknown",
        error: transportDetails(record.error),
      });
    }
    return { available: true, enabled, truncated, events };
  } catch {
    return { available: false, enabled: false, truncated: false, events: [] };
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* Diagnostics cannot change the outcome. */
      }
    }
  }
}
