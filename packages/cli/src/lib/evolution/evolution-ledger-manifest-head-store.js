import { types as utilTypes } from "node:util";

import {
  captureEvolutionLedgerManifestAuthority,
  verifyEvolutionLedgerManifestHead,
} from "./evolution-ledger-manifest-chain.js";

export const EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_SCHEMA =
  "chainlesschain.evolution-ledger-manifest-head-store/v2";
export const EVOLUTION_LEDGER_MANIFEST_HEAD_CAS_REQUEST_SCHEMA =
  "chainlesschain.evolution-ledger-manifest-head-cas-request/v2";
export const EVOLUTION_LEDGER_MANIFEST_HEAD_CAS_RESULT_SCHEMA =
  "chainlesschain.evolution-ledger-manifest-head-cas-result/v2";

export const EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_INVALID_CODE =
  "CC_EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_INVALID";
export const EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_CORRUPT_CODE =
  "CC_EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_CORRUPT";
export const EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_UNAVAILABLE_CODE =
  "CC_EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_UNAVAILABLE";
export const EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_COMMIT_UNKNOWN_CODE =
  "CC_EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_COMMIT_UNKNOWN";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const STORES = new WeakSet();
const CONFIG_KEYS = new Set([
  "authority",
  "compareAndSet",
  "descriptor",
  "load",
]);
const REQUEST_KEYS = new Set(["expectedHeadDigest", "nextHead"]);
const CAS_RESULT_KEYS = new Set(["committed", "head", "schema"]);
const SCOPE_KEYS = new Set([
  "epoch",
  "ledgerId",
  "maximumEventsPerSegment",
  "tenantId",
]);

export class EvolutionLedgerManifestHeadStoreError extends Error {
  constructor(code, message, options = undefined) {
    super(message, options);
    this.name = "EvolutionLedgerManifestHeadStoreError";
    this.code = code;
  }
}

function failure(code, message, options = undefined) {
  return new EvolutionLedgerManifestHeadStoreError(code, message, options);
}

function rejectProxy(
  value,
  label,
  code = EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_INVALID_CODE,
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
  code = EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_INVALID_CODE,
) {
  rejectProxy(value, label, code);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw failure(code, `${label} must be a record`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw failure(code, `${label} must use a plain prototype`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Object.keys(descriptors);
  if (names.length !== keys.size || names.some((name) => !keys.has(name))) {
    throw failure(code, `${label} fields are invalid`);
  }
  for (const name of names) {
    if (!("value" in descriptors[name])) {
      throw failure(code, `${label}.${name} must be an own data property`);
    }
  }
  return descriptors;
}

function data(descriptors, key) {
  return descriptors[key].value;
}

function nullableDigest(value, label, code) {
  if (value === null) return null;
  if (!DIGEST.test(value || ""))
    throw failure(code, `${label} must be sha256-bound or null`);
  return value;
}

function sync(
  value,
  label,
  code = EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_UNAVAILABLE_CODE,
) {
  rejectProxy(value, label, code);
  if (utilTypes.isPromise(value))
    throw failure(code, `${label} must be synchronous`);
  return value;
}

function scope(value) {
  const fields = exactRecord(
    value,
    SCOPE_KEYS,
    "manifest head store descriptor",
  );
  const maximum = data(fields, "maximumEventsPerSegment");
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 1024) {
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_INVALID_CODE,
      "descriptor.maximumEventsPerSegment is invalid",
    );
  }
  const output = {};
  for (const key of ["epoch", "ledgerId", "tenantId"]) {
    const valueAtKey = data(fields, key);
    if (
      typeof valueAtKey !== "string" ||
      valueAtKey.trim() !== valueAtKey ||
      valueAtKey.length < 1 ||
      valueAtKey.length > 512 ||
      valueAtKey.includes("\0")
    ) {
      throw failure(
        EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_INVALID_CODE,
        `descriptor.${key} is invalid`,
      );
    }
    output[key] = valueAtKey;
  }
  output.maximumEventsPerSegment = maximum;
  return Object.freeze(output);
}

function verifyHead(authority, descriptor, value, code) {
  try {
    return verifyEvolutionLedgerManifestHead({
      authority,
      descriptor,
      head: value,
    });
  } catch (cause) {
    if (cause?.code === "CC_EVOLUTION_LEDGER_MANIFEST_UNAVAILABLE") {
      throw failure(
        EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_UNAVAILABLE_CODE,
        "manifest head signature verification is unavailable",
        { cause },
      );
    }
    throw failure(code, "manifest head is invalid", { cause });
  }
}

function request(value, authority, descriptor) {
  const fields = exactRecord(value, REQUEST_KEYS, "manifest head CAS request");
  const expectedHeadDigest = nullableDigest(
    data(fields, "expectedHeadDigest"),
    "expectedHeadDigest",
    EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_INVALID_CODE,
  );
  const nextHead = verifyHead(
    authority,
    descriptor,
    data(fields, "nextHead"),
    EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_INVALID_CODE,
  );
  if (nextHead.previousHeadDigest !== expectedHeadDigest) {
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_INVALID_CODE,
      "next manifest head previousHeadDigest does not match its CAS expectation",
    );
  }
  return Object.freeze({ expectedHeadDigest, nextHead });
}

function result(value, authority, descriptor) {
  const fields = exactRecord(
    value,
    CAS_RESULT_KEYS,
    "manifest head CAS result",
    EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_CORRUPT_CODE,
  );
  if (
    data(fields, "schema") !== EVOLUTION_LEDGER_MANIFEST_HEAD_CAS_RESULT_SCHEMA
  ) {
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_CORRUPT_CODE,
      "manifest head CAS result schema is invalid",
    );
  }
  const committed = data(fields, "committed");
  if (typeof committed !== "boolean") {
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_CORRUPT_CODE,
      "manifest head CAS committed flag is invalid",
    );
  }
  const rawHead = data(fields, "head");
  const head =
    rawHead === null
      ? null
      : verifyHead(
          authority,
          descriptor,
          rawHead,
          EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_CORRUPT_CODE,
        );
  if (committed && head === null) {
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_CORRUPT_CODE,
      "a committed manifest head CAS result must return a head",
    );
  }
  return Object.freeze({ committed, head });
}

function sameHead(left, right) {
  return (left?.headDigest ?? null) === (right?.headDigest ?? null);
}

export function createEvolutionLedgerManifestHeadStore(options = undefined) {
  const fields = exactRecord(
    options,
    CONFIG_KEYS,
    "manifest head store configuration",
  );
  const descriptor = scope(data(fields, "descriptor"));
  const authority = captureEvolutionLedgerManifestAuthority(
    data(fields, "authority"),
  );
  const load = data(fields, "load");
  const compareAndSet = data(fields, "compareAndSet");
  rejectProxy(load, "manifest head store load");
  rejectProxy(compareAndSet, "manifest head store compareAndSet");
  if (typeof load !== "function" || typeof compareAndSet !== "function") {
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_INVALID_CODE,
      "manifest head store requires synchronous load and compareAndSet functions",
    );
  }

  const read = () => {
    let rawHead;
    try {
      rawHead = sync(
        Reflect.apply(load, undefined, [Object.freeze({ ...descriptor })]),
        "manifest head store load result",
      );
    } catch (cause) {
      if (cause instanceof EvolutionLedgerManifestHeadStoreError) throw cause;
      throw failure(
        EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_UNAVAILABLE_CODE,
        "manifest head store load failed",
        { cause },
      );
    }
    return rawHead === null
      ? null
      : verifyHead(
          authority,
          descriptor,
          rawHead,
          EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_CORRUPT_CODE,
        );
  };

  const store = Object.freeze({
    descriptor: Object.freeze({
      ...descriptor,
      schema: EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_SCHEMA,
    }),
    read,
    commit(input) {
      const normalized = request(input, authority, descriptor);
      const observed = read();
      if (!sameHead(observed, { headDigest: normalized.expectedHeadDigest })) {
        return Object.freeze({
          committed: false,
          conflict: true,
          head: observed,
          schema: EVOLUTION_LEDGER_MANIFEST_HEAD_CAS_RESULT_SCHEMA,
        });
      }
      let rawResult;
      try {
        rawResult = sync(
          Reflect.apply(compareAndSet, undefined, [
            Object.freeze({
              expectedHeadDigest: normalized.expectedHeadDigest,
              nextHead: normalized.nextHead,
              schema: EVOLUTION_LEDGER_MANIFEST_HEAD_CAS_REQUEST_SCHEMA,
            }),
          ]),
          "manifest head store compareAndSet result",
        );
      } catch (cause) {
        throw failure(
          EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_COMMIT_UNKNOWN_CODE,
          "manifest head CAS acknowledgement was lost; reopen before retrying",
          { cause },
        );
      }
      let acknowledgement;
      try {
        acknowledgement = result(rawResult, authority, descriptor);
      } catch (cause) {
        throw failure(
          EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_COMMIT_UNKNOWN_CODE,
          "manifest head CAS acknowledgement is invalid; reopen before retrying",
          { cause },
        );
      }
      if (!acknowledgement.committed) {
        if (sameHead(acknowledgement.head, normalized.nextHead)) {
          throw failure(
            EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_CORRUPT_CODE,
            "manifest head CAS denied a head that it returned as current",
          );
        }
        return Object.freeze({
          committed: false,
          conflict: true,
          head: acknowledgement.head,
          schema: EVOLUTION_LEDGER_MANIFEST_HEAD_CAS_RESULT_SCHEMA,
        });
      }
      if (!sameHead(acknowledgement.head, normalized.nextHead)) {
        throw failure(
          EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_CORRUPT_CODE,
          "manifest head CAS acknowledged substituted data",
        );
      }
      let readback;
      try {
        readback = read();
      } catch (cause) {
        if (cause instanceof EvolutionLedgerManifestHeadStoreError) {
          throw failure(
            EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_COMMIT_UNKNOWN_CODE,
            "manifest head CAS may be committed; reopen before retrying",
            { cause },
          );
        }
        throw cause;
      }
      if (!sameHead(readback, normalized.nextHead)) {
        throw failure(
          EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_COMMIT_UNKNOWN_CODE,
          "manifest head CAS readback differs; reopen before retrying",
        );
      }
      return Object.freeze({
        committed: true,
        conflict: false,
        head: readback,
        schema: EVOLUTION_LEDGER_MANIFEST_HEAD_CAS_RESULT_SCHEMA,
      });
    },
  });
  STORES.add(store);
  return store;
}

export function captureEvolutionLedgerManifestHeadStore(
  value,
  expected = undefined,
) {
  if (!STORES.has(value)) {
    throw new TypeError(
      "a branded Evolution Ledger manifest head store is required",
    );
  }
  if (expected !== undefined) {
    const fields = exactRecord(
      expected,
      new Set(["epoch", "ledgerId", "tenantId"]),
      "expected manifest head store scope",
    );
    for (const field of ["epoch", "ledgerId", "tenantId"]) {
      if (value.descriptor[field] !== data(fields, field)) {
        throw failure(
          EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_INVALID_CODE,
          `manifest head store ${field} scope differs`,
        );
      }
    }
  }
  return value;
}

export function isEvolutionLedgerManifestHeadStore(value) {
  return STORES.has(value);
}
