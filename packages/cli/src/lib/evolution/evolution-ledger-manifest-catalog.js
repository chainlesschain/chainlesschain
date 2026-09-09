import { types as utilTypes } from "node:util";

import {
  captureEvolutionLedgerManifestAuthority,
  verifyEvolutionLedgerSegmentManifest,
} from "./evolution-ledger-manifest-chain.js";

export const EVOLUTION_LEDGER_MANIFEST_CATALOG_SCHEMA =
  "chainlesschain.evolution-ledger-manifest-catalog/v2";
export const EVOLUTION_LEDGER_MANIFEST_CATALOG_APPEND_REQUEST_SCHEMA =
  "chainlesschain.evolution-ledger-manifest-catalog-append-request/v2";
export const EVOLUTION_LEDGER_MANIFEST_CATALOG_APPEND_RESULT_SCHEMA =
  "chainlesschain.evolution-ledger-manifest-catalog-append-result/v2";
export const EVOLUTION_LEDGER_MANIFEST_CATALOG_INVALID_CODE =
  "CC_EVOLUTION_LEDGER_MANIFEST_CATALOG_INVALID";
export const EVOLUTION_LEDGER_MANIFEST_CATALOG_CORRUPT_CODE =
  "CC_EVOLUTION_LEDGER_MANIFEST_CATALOG_CORRUPT";
export const EVOLUTION_LEDGER_MANIFEST_CATALOG_UNAVAILABLE_CODE =
  "CC_EVOLUTION_LEDGER_MANIFEST_CATALOG_UNAVAILABLE";
export const EVOLUTION_LEDGER_MANIFEST_CATALOG_COMMIT_UNKNOWN_CODE =
  "CC_EVOLUTION_LEDGER_MANIFEST_CATALOG_COMMIT_UNKNOWN";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const CONFIG_KEYS = new Set(["backend", "descriptor", "manifestAuthority"]);
const DESCRIPTOR_KEYS = new Set([
  "epoch",
  "ledgerId",
  "maximumEventsPerSegment",
  "tenantId",
]);
const APPEND_KEYS = new Set(["expectedManifestDigest", "manifest"]);
const RESULT_KEYS = new Set(["appended", "latest", "schema"]);
const CATALOGS = new WeakSet();

export class EvolutionLedgerManifestCatalogError extends Error {
  constructor(code, message, options = undefined) {
    super(message, options);
    this.name = "EvolutionLedgerManifestCatalogError";
    this.code = code;
  }
}

function failure(code, message, options = undefined) {
  return new EvolutionLedgerManifestCatalogError(code, message, options);
}

function rejectProxy(
  value,
  label,
  code = EVOLUTION_LEDGER_MANIFEST_CATALOG_INVALID_CODE,
) {
  if (
    (typeof value === "object" && value !== null) ||
    typeof value === "function"
  ) {
    if (utilTypes.isProxy(value))
      throw failure(code, `${label} must not be a Proxy`);
  }
}

function exactRecord(
  value,
  keys,
  label,
  code = EVOLUTION_LEDGER_MANIFEST_CATALOG_INVALID_CODE,
) {
  rejectProxy(value, label, code);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw failure(code, `${label} must be a record`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw failure(code, `${label} must use a plain prototype`);
  }
  const fields = Object.getOwnPropertyDescriptors(value);
  const names = Object.keys(fields);
  if (names.length !== keys.size || names.some((name) => !keys.has(name))) {
    throw failure(code, `${label} fields are invalid`);
  }
  for (const name of names) {
    if (!("value" in fields[name])) {
      throw failure(code, `${label}.${name} must be an own data property`);
    }
  }
  return fields;
}

function data(fields, name) {
  return fields[name].value;
}

function identifier(
  value,
  label,
  code = EVOLUTION_LEDGER_MANIFEST_CATALOG_INVALID_CODE,
) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 512 ||
    value.includes("\0")
  ) {
    throw failure(code, `${label} is invalid`);
  }
  return value;
}

function maximum(
  value,
  label,
  code = EVOLUTION_LEDGER_MANIFEST_CATALOG_INVALID_CODE,
) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1024) {
    throw failure(code, `${label} is invalid`);
  }
  return value;
}

function digest(
  value,
  label,
  code = EVOLUTION_LEDGER_MANIFEST_CATALOG_INVALID_CODE,
) {
  if (!DIGEST.test(value || ""))
    throw failure(code, `${label} must be sha256-bound`);
  return value;
}

function nullableDigest(
  value,
  label,
  code = EVOLUTION_LEDGER_MANIFEST_CATALOG_INVALID_CODE,
) {
  return value === null ? null : digest(value, label, code);
}

function descriptor(value) {
  const fields = exactRecord(
    value,
    DESCRIPTOR_KEYS,
    "manifest catalog descriptor",
  );
  return Object.freeze({
    epoch: identifier(data(fields, "epoch"), "descriptor.epoch"),
    ledgerId: identifier(data(fields, "ledgerId"), "descriptor.ledgerId"),
    maximumEventsPerSegment: maximum(
      data(fields, "maximumEventsPerSegment"),
      "descriptor.maximumEventsPerSegment",
    ),
    tenantId: identifier(data(fields, "tenantId"), "descriptor.tenantId"),
  });
}

function callable(value, name) {
  const field = Object.getOwnPropertyDescriptor(value, name);
  if (!field || !("value" in field) || typeof field.value !== "function") {
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_CATALOG_INVALID_CODE,
      `manifest catalog backend.${name} must be an own function`,
    );
  }
  rejectProxy(field.value, `manifest catalog backend.${name}`);
  return field.value;
}

function synchronous(
  value,
  label,
  code = EVOLUTION_LEDGER_MANIFEST_CATALOG_UNAVAILABLE_CODE,
) {
  rejectProxy(value, label, code);
  if (utilTypes.isPromise(value))
    throw failure(code, `${label} must be synchronous`);
  return value;
}

function manifest(authority, descriptorValue, value, code) {
  try {
    return verifyEvolutionLedgerSegmentManifest({
      authority,
      descriptor: descriptorValue,
      manifest: value,
    });
  } catch (cause) {
    throw failure(code, "manifest catalog manifest is invalid", { cause });
  }
}

function latest(authority, descriptorValue, raw, code) {
  return raw === null ? null : manifest(authority, descriptorValue, raw, code);
}

function sameManifest(left, right) {
  return left?.manifestDigest === right?.manifestDigest;
}

function linked(previous, next) {
  return (
    next.manifestSequence === (previous?.manifestSequence ?? 0) + 1 &&
    next.previousManifestDigest === (previous?.manifestDigest ?? null) &&
    next.sequenceStart === (previous?.sequenceEnd ?? 0) + 1
  );
}

export function createEvolutionLedgerManifestCatalog(options = undefined) {
  const fields = exactRecord(
    options,
    CONFIG_KEYS,
    "manifest catalog configuration",
  );
  const descriptorValue = descriptor(data(fields, "descriptor"));
  const authority = captureEvolutionLedgerManifestAuthority(
    data(fields, "manifestAuthority"),
  );
  const backend = data(fields, "backend");
  rejectProxy(backend, "manifest catalog backend");
  if (!backend || typeof backend !== "object") {
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_CATALOG_INVALID_CODE,
      "manifest catalog backend is required",
    );
  }
  const loadLatest = callable(backend, "loadLatest");
  const compareAndAppend = callable(backend, "compareAndAppend");
  const list = callable(backend, "list");

  const readLatest = () => {
    let raw;
    try {
      raw = synchronous(
        Reflect.apply(loadLatest, backend, [
          Object.freeze({ ...descriptorValue }),
        ]),
        "manifest catalog loadLatest result",
      );
    } catch (cause) {
      if (cause instanceof EvolutionLedgerManifestCatalogError) throw cause;
      throw failure(
        EVOLUTION_LEDGER_MANIFEST_CATALOG_UNAVAILABLE_CODE,
        "manifest catalog loadLatest failed",
        { cause },
      );
    }
    return latest(
      authority,
      descriptorValue,
      raw,
      EVOLUTION_LEDGER_MANIFEST_CATALOG_CORRUPT_CODE,
    );
  };

  const catalog = Object.freeze({
    descriptor: Object.freeze({
      ...descriptorValue,
      schema: EVOLUTION_LEDGER_MANIFEST_CATALOG_SCHEMA,
    }),
    append(input) {
      const request = exactRecord(
        input,
        APPEND_KEYS,
        "manifest catalog append request",
      );
      const expectedManifestDigest = nullableDigest(
        data(request, "expectedManifestDigest"),
        "expectedManifestDigest",
      );
      const next = manifest(
        authority,
        descriptorValue,
        data(request, "manifest"),
        EVOLUTION_LEDGER_MANIFEST_CATALOG_INVALID_CODE,
      );
      const observed = readLatest();
      if ((observed?.manifestDigest ?? null) !== expectedManifestDigest) {
        return Object.freeze({
          appended: false,
          conflict: true,
          latest: observed,
          schema: EVOLUTION_LEDGER_MANIFEST_CATALOG_APPEND_RESULT_SCHEMA,
        });
      }
      if (!linked(observed, next)) {
        throw failure(
          EVOLUTION_LEDGER_MANIFEST_CATALOG_INVALID_CODE,
          "manifest catalog append does not link to its current latest manifest",
        );
      }
      let rawResult;
      try {
        rawResult = synchronous(
          Reflect.apply(compareAndAppend, backend, [
            Object.freeze({
              expectedManifestDigest,
              manifest: next,
              schema: EVOLUTION_LEDGER_MANIFEST_CATALOG_APPEND_REQUEST_SCHEMA,
            }),
          ]),
          "manifest catalog compareAndAppend result",
        );
      } catch (cause) {
        throw failure(
          EVOLUTION_LEDGER_MANIFEST_CATALOG_COMMIT_UNKNOWN_CODE,
          "manifest catalog acknowledgement was lost; reopen before retrying",
          { cause },
        );
      }
      let result;
      try {
        const resultFields = exactRecord(
          rawResult,
          RESULT_KEYS,
          "manifest catalog append result",
          EVOLUTION_LEDGER_MANIFEST_CATALOG_CORRUPT_CODE,
        );
        if (
          data(resultFields, "schema") !==
            EVOLUTION_LEDGER_MANIFEST_CATALOG_APPEND_RESULT_SCHEMA ||
          typeof data(resultFields, "appended") !== "boolean"
        ) {
          throw failure(
            EVOLUTION_LEDGER_MANIFEST_CATALOG_CORRUPT_CODE,
            "manifest catalog append result is invalid",
          );
        }
        result = Object.freeze({
          appended: data(resultFields, "appended"),
          latest: latest(
            authority,
            descriptorValue,
            data(resultFields, "latest"),
            EVOLUTION_LEDGER_MANIFEST_CATALOG_CORRUPT_CODE,
          ),
        });
      } catch (cause) {
        throw failure(
          EVOLUTION_LEDGER_MANIFEST_CATALOG_COMMIT_UNKNOWN_CODE,
          "manifest catalog acknowledgement is invalid; reopen before retrying",
          { cause },
        );
      }
      if (!result.appended) {
        if (sameManifest(result.latest, next)) {
          throw failure(
            EVOLUTION_LEDGER_MANIFEST_CATALOG_CORRUPT_CODE,
            "manifest catalog denied a manifest that it returned as latest",
          );
        }
        return Object.freeze({
          appended: false,
          conflict: true,
          latest: result.latest,
          schema: EVOLUTION_LEDGER_MANIFEST_CATALOG_APPEND_RESULT_SCHEMA,
        });
      }
      if (!sameManifest(result.latest, next)) {
        throw failure(
          EVOLUTION_LEDGER_MANIFEST_CATALOG_COMMIT_UNKNOWN_CODE,
          "manifest catalog acknowledged substituted data; reopen before retrying",
        );
      }
      let readback;
      try {
        readback = readLatest();
      } catch (cause) {
        throw failure(
          EVOLUTION_LEDGER_MANIFEST_CATALOG_COMMIT_UNKNOWN_CODE,
          "manifest catalog may be committed; reopen before retrying",
          { cause },
        );
      }
      if (!sameManifest(readback, next)) {
        throw failure(
          EVOLUTION_LEDGER_MANIFEST_CATALOG_COMMIT_UNKNOWN_CODE,
          "manifest catalog readback differs; reopen before retrying",
        );
      }
      return Object.freeze({
        appended: true,
        conflict: false,
        latest: readback,
        schema: EVOLUTION_LEDGER_MANIFEST_CATALOG_APPEND_RESULT_SCHEMA,
      });
    },
    list() {
      let raw;
      try {
        raw = synchronous(
          Reflect.apply(list, backend, [Object.freeze({ ...descriptorValue })]),
          "manifest catalog list result",
        );
      } catch (cause) {
        if (cause instanceof EvolutionLedgerManifestCatalogError) throw cause;
        throw failure(
          EVOLUTION_LEDGER_MANIFEST_CATALOG_UNAVAILABLE_CODE,
          "manifest catalog list failed",
          { cause },
        );
      }
      rejectProxy(
        raw,
        "manifest catalog list",
        EVOLUTION_LEDGER_MANIFEST_CATALOG_CORRUPT_CODE,
      );
      if (!Array.isArray(raw) || Object.keys(raw).length !== raw.length) {
        throw failure(
          EVOLUTION_LEDGER_MANIFEST_CATALOG_CORRUPT_CODE,
          "manifest catalog list must be a dense array",
        );
      }
      let previous = null;
      const manifests = raw.map((entry) => {
        const current = manifest(
          authority,
          descriptorValue,
          entry,
          EVOLUTION_LEDGER_MANIFEST_CATALOG_CORRUPT_CODE,
        );
        if (!linked(previous, current)) {
          throw failure(
            EVOLUTION_LEDGER_MANIFEST_CATALOG_CORRUPT_CODE,
            "manifest catalog chain linkage is invalid",
          );
        }
        previous = current;
        return current;
      });
      const currentLatest = readLatest();
      if (!sameManifest(currentLatest, manifests.at(-1) ?? null)) {
        throw failure(
          EVOLUTION_LEDGER_MANIFEST_CATALOG_CORRUPT_CODE,
          "manifest catalog latest differs from its listed chain",
        );
      }
      return Object.freeze(manifests);
    },
    readLatest,
  });
  CATALOGS.add(catalog);
  return catalog;
}

export function captureEvolutionLedgerManifestCatalog(
  value,
  expected = undefined,
) {
  if (!CATALOGS.has(value)) {
    throw new TypeError(
      "a branded Evolution Ledger manifest catalog is required",
    );
  }
  if (expected !== undefined) {
    const fields = exactRecord(
      expected,
      new Set(["epoch", "ledgerId", "tenantId"]),
      "expected manifest catalog scope",
    );
    for (const field of ["epoch", "ledgerId", "tenantId"]) {
      if (value.descriptor[field] !== data(fields, field)) {
        throw failure(
          EVOLUTION_LEDGER_MANIFEST_CATALOG_INVALID_CODE,
          `manifest catalog ${field} scope differs`,
        );
      }
    }
  }
  return value;
}

export function isEvolutionLedgerManifestCatalog(value) {
  return CATALOGS.has(value);
}
