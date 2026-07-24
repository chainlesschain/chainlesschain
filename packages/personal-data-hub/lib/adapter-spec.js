/**
 * PersonalDataAdapter contract — what every adapter (Email / Alipay / WeChat /
 * AI Chat / ...) must implement so the AdapterRegistry can orchestrate sync.
 *
 * Mirrors §9.1 of docs/design/Personal_Data_Hub_Architecture.md.
 *
 *   class MyAdapter {
 *     name = "my-adapter";
 *     version = "0.1.0";
 *     capabilities = ["sync:imap", "parse:bill"];
 *     rateLimits = { perMinute: 60 };
 *     dataDisclosure = {
 *       fields: ["email:from,subject,body"],
 *       sensitivity: "high",
 *       legalGate: false,
 *     };
 *
 *     async authenticate(ctx) { ... return { ok: true } }
 *     async *sync(opts)        { yield rawEvent1; yield rawEvent2; ... }
 *     normalize(raw)           { return { events, persons, places, items, topics } }
 *     async healthCheck()      { return { ok: true } }
 *   }
 *
 * Design rationale:
 *   - `sync` is an AsyncIterable so adapters can stream large windows without
 *     buffering everything in memory. The registry batches yielded raws
 *     before validating + writing.
 *   - `normalize` is sync and takes ONE raw at a time. Heavy IO belongs in
 *     `sync`; `normalize` is pure transform → testable in isolation.
 *   - `dataDisclosure.legalGate` flips the UI from "one-tap enable" to
 *     "checkbox-gated user agreement" (WeChat needs this; Alipay doesn't).
 *
 * This module's runtime checks are NOT defensive against adversarial
 * adapters — they only catch the common "I forgot a field" mistakes during
 * development. Adapters run in the same trust boundary as the hub itself.
 */

"use strict";

const SENSITIVITY_LEVELS = Object.freeze(["low", "medium", "high"]);

function isString(v) {
  return typeof v === "string";
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.length > 0;
}

function isFunction(v) {
  return typeof v === "function";
}

function isAsyncIterableProducer(fn) {
  // AsyncGeneratorFunction's constructor name in V8 is "AsyncGeneratorFunction".
  // We can also accept a regular function that returns an AsyncIterable, so
  // accept either ctor name OR a function (we'll call it and check at runtime).
  if (!isFunction(fn)) return false;
  const ctor = fn.constructor && fn.constructor.name;
  return (
    ctor === "AsyncGeneratorFunction" ||
    ctor === "Function" ||
    ctor === "AsyncFunction"
  );
}

/**
 * Verify an object conforms to the PersonalDataAdapter contract. Returns
 * { ok: true } on success or { ok: false, errors: [...] } on the first
 * spec violation found in each field (collected, not throw-on-first).
 *
 * Use in tests and as a sanity check in AdapterRegistry.register so a
 * malformed adapter is rejected at registration time rather than failing
 * mysteriously mid-sync.
 */
const EXTRACT_MODES = ["web-api", "device-pull", "file-import"];
const WATERMARK_STRATEGIES = ["count", "max-captured-at", "explicit", "none"];

function assertAdapter(a) {
  const errors = [];

  if (a == null || typeof a !== "object") {
    return { ok: false, errors: ["adapter must be an object instance"] };
  }

  // Identity
  if (!isNonEmptyString(a.name)) errors.push("name must be a non-empty string");
  if (!isNonEmptyString(a.version))
    errors.push("version must be a non-empty string");

  // Capabilities (array of strings, may be empty)
  if (!Array.isArray(a.capabilities) || !a.capabilities.every(isString)) {
    errors.push("capabilities must be a (possibly empty) array of strings");
  }

  // Phase 7.5: extractMode — optional, defaults "web-api". Adapters that
  // pull from a mobile device declare "device-pull" so the registry can
  // gate sync on device-connection state.
  if (a.extractMode !== undefined) {
    if (!EXTRACT_MODES.includes(a.extractMode)) {
      errors.push(
        `extractMode must be one of ${EXTRACT_MODES.join("|")} when present`,
      );
    }
  }

  // Incremental-sync watermark contract. `count` is the backward-compatible
  // default used by MockAdapter and older adapters. Timestamp-based adapters
  // opt into `max-captured-at`; opaque cursors (IMAP UID state, WeChat
  // msgSvrId, API continuation tokens) use `explicit` and call the
  // registry-provided opts.updateWatermark(value). `none` preserves any
  // existing watermark without advancing it.
  if (
    a.watermarkStrategy !== undefined &&
    !WATERMARK_STRATEGIES.includes(a.watermarkStrategy)
  ) {
    errors.push(
      `watermarkStrategy must be one of ${WATERMARK_STRATEGIES.join("|")} when present`,
    );
  }
  if (
    a.watermarkRequiresCompleteScan !== undefined &&
    typeof a.watermarkRequiresCompleteScan !== "boolean"
  ) {
    errors.push("watermarkRequiresCompleteScan must be a boolean when present");
  }
  if (
    a.watermarkLookbackMs !== undefined &&
    (!Number.isSafeInteger(a.watermarkLookbackMs) || a.watermarkLookbackMs < 0)
  ) {
    errors.push(
      "watermarkLookbackMs must be a non-negative safe integer when present",
    );
  }
  if (
    a.initialPageBudget !== undefined &&
    (!Number.isSafeInteger(a.initialPageBudget) || a.initialPageBudget <= 0)
  ) {
    errors.push(
      "initialPageBudget must be a positive safe integer when present",
    );
  }
  if (a.defaultScope !== undefined && !isNonEmptyString(a.defaultScope)) {
    errors.push("defaultScope must be a non-empty string when present");
  }
  for (const field of [
    "snapshotScopeIdentityFields",
    "snapshotScopeTopLevelFields",
  ]) {
    if (
      a[field] !== undefined &&
      (!Array.isArray(a[field]) || !a[field].every(isNonEmptyString))
    ) {
      errors.push(
        `${field} must be an array of non-empty strings when present`,
      );
    }
  }
  if (
    a.snapshotScopeIdentityIncludesField !== undefined &&
    typeof a.snapshotScopeIdentityIncludesField !== "boolean"
  ) {
    errors.push(
      "snapshotScopeIdentityIncludesField must be a boolean when present",
    );
  }

  // Rate limits (optional, but if present must be an object with numeric fields)
  if (a.rateLimits !== undefined) {
    const rl = a.rateLimits;
    if (rl == null || typeof rl !== "object") {
      errors.push("rateLimits must be an object when present");
    } else {
      for (const field of ["perMinute", "perDay", "minIntervalMs"]) {
        if (
          rl[field] !== undefined &&
          (!Number.isSafeInteger(rl[field]) || rl[field] < 0)
        ) {
          errors.push(
            `rateLimits.${field} must be a non-negative safe integer when present`,
          );
        }
      }
    }
  }

  // Data disclosure (required — adapter must declare what it touches)
  if (a.dataDisclosure == null || typeof a.dataDisclosure !== "object") {
    errors.push("dataDisclosure must be a plain object");
  } else {
    const dd = a.dataDisclosure;
    if (!Array.isArray(dd.fields) || !dd.fields.every(isString)) {
      errors.push("dataDisclosure.fields must be an array of strings");
    }
    if (!SENSITIVITY_LEVELS.includes(dd.sensitivity)) {
      errors.push(
        `dataDisclosure.sensitivity must be one of ${SENSITIVITY_LEVELS.join("|")}`,
      );
    }
    if (dd.legalGate !== undefined && typeof dd.legalGate !== "boolean") {
      errors.push("dataDisclosure.legalGate must be a boolean when present");
    }
    if (
      dd.retentionDays !== undefined &&
      (typeof dd.retentionDays !== "number" || dd.retentionDays <= 0)
    ) {
      errors.push(
        "dataDisclosure.retentionDays must be a positive number when present",
      );
    }
  }

  // Required methods
  if (!isFunction(a.authenticate))
    errors.push("authenticate must be a function");
  if (!isFunction(a.healthCheck)) errors.push("healthCheck must be a function");
  if (!isFunction(a.normalize)) errors.push("normalize must be a function");
  if (!isAsyncIterableProducer(a.sync)) {
    errors.push(
      "sync must be a function (async generator or async fn returning AsyncIterable)",
    );
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * Coerce arbitrary thrown values into Error instances with the original
 * preserved as .cause. Used by registry sync paths so the caller always
 * gets a real Error to log/await-throw against.
 */
function toError(thrown, context) {
  if (thrown instanceof Error) {
    if (context && !thrown.context) thrown.context = context;
    return thrown;
  }
  const e = new Error(
    `${context ? context + ": " : ""}${typeof thrown === "string" ? thrown : JSON.stringify(thrown)}`,
  );
  e.cause = thrown;
  return e;
}

module.exports = {
  SENSITIVITY_LEVELS,
  assertAdapter,
  EXTRACT_MODES,
  WATERMARK_STRATEGIES,
  toError,
};
