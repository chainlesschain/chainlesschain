import { types as utilTypes } from "node:util";

import { EVOLUTION_LEDGER_WITNESS_SCHEMA } from "./evolution-ledger.js";
import {
  captureEvolutionLedgerManifestAuthority,
  verifyEvolutionLedgerManifestHead,
  verifyEvolutionLedgerSegmentManifest,
} from "./evolution-ledger-manifest-chain.js";

export const EVOLUTION_LEDGER_MANIFEST_WITNESS_ADAPTER_SCHEMA =
  "chainlesschain.evolution-ledger-manifest-witness-adapter/v2";
export const EVOLUTION_LEDGER_MANIFEST_WITNESS_RECEIPT_SCHEMA =
  "chainlesschain.evolution-ledger-manifest-witness-receipt/v2";
export const EVOLUTION_LEDGER_MANIFEST_WITNESS_INVALID_CODE =
  "CC_EVOLUTION_LEDGER_MANIFEST_WITNESS_INVALID";
export const EVOLUTION_LEDGER_MANIFEST_WITNESS_CORRUPT_CODE =
  "CC_EVOLUTION_LEDGER_MANIFEST_WITNESS_CORRUPT";
export const EVOLUTION_LEDGER_MANIFEST_WITNESS_UNAVAILABLE_CODE =
  "CC_EVOLUTION_LEDGER_MANIFEST_WITNESS_UNAVAILABLE";
export const EVOLUTION_LEDGER_MANIFEST_WITNESS_COMMIT_UNKNOWN_CODE =
  "CC_EVOLUTION_LEDGER_MANIFEST_WITNESS_COMMIT_UNKNOWN";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ADAPTERS = new WeakSet();
const CONFIG_KEYS = new Set(["descriptor", "manifestAuthority", "witness"]);
const DESCRIPTOR_KEYS = new Set([
  "epoch",
  "identityDigest",
  "ledgerId",
  "manifestTrustKeyId",
  "maximumEventsPerSegment",
  "storeMarkerDigest",
  "storeMarkerEntryDigest",
  "storeMarkerId",
  "tenantId",
  "witnessTrust",
]);
const TRUST_KEYS = new Set(["algorithm", "keyId", "trustPolicyDigest"]);
const CHECKPOINT_KEYS = new Set(["expectedWitnessDigest", "head", "manifest"]);

export class EvolutionLedgerManifestWitnessError extends Error {
  constructor(code, message, options = undefined) {
    super(message, options);
    this.name = "EvolutionLedgerManifestWitnessError";
    this.code = code;
  }
}

function failure(code, message, options = undefined) {
  return new EvolutionLedgerManifestWitnessError(code, message, options);
}

function rejectProxy(
  value,
  label,
  code = EVOLUTION_LEDGER_MANIFEST_WITNESS_INVALID_CODE,
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
  code = EVOLUTION_LEDGER_MANIFEST_WITNESS_INVALID_CODE,
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

function data(fields, key) {
  return fields[key].value;
}

function identifier(
  value,
  label,
  code = EVOLUTION_LEDGER_MANIFEST_WITNESS_INVALID_CODE,
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

function digest(
  value,
  label,
  code = EVOLUTION_LEDGER_MANIFEST_WITNESS_INVALID_CODE,
) {
  if (!DIGEST.test(value || ""))
    throw failure(code, `${label} must be sha256-bound`);
  return value;
}

function scope(value) {
  const fields = exactRecord(
    value,
    DESCRIPTOR_KEYS,
    "manifest witness descriptor",
  );
  const maximumEventsPerSegment = data(fields, "maximumEventsPerSegment");
  if (
    !Number.isSafeInteger(maximumEventsPerSegment) ||
    maximumEventsPerSegment < 1 ||
    maximumEventsPerSegment > 1024
  ) {
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_WITNESS_INVALID_CODE,
      "descriptor.maximumEventsPerSegment is invalid",
    );
  }
  const trustFields = exactRecord(
    data(fields, "witnessTrust"),
    TRUST_KEYS,
    "descriptor.witnessTrust",
  );
  const witnessTrust = Object.freeze({
    algorithm: identifier(
      data(trustFields, "algorithm"),
      "witnessTrust.algorithm",
    ),
    keyId: identifier(data(trustFields, "keyId"), "witnessTrust.keyId"),
    trustPolicyDigest: digest(
      data(trustFields, "trustPolicyDigest"),
      "witnessTrust.trustPolicyDigest",
    ),
  });
  const manifestTrustKeyId = identifier(
    data(fields, "manifestTrustKeyId"),
    "descriptor.manifestTrustKeyId",
  );
  if (manifestTrustKeyId === witnessTrust.keyId) {
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_WITNESS_INVALID_CODE,
      "manifest and witness trust key identities must be independent",
    );
  }
  return Object.freeze({
    epoch: identifier(data(fields, "epoch"), "descriptor.epoch"),
    identityDigest: digest(
      data(fields, "identityDigest"),
      "descriptor.identityDigest",
    ),
    ledgerId: identifier(data(fields, "ledgerId"), "descriptor.ledgerId"),
    manifestTrustKeyId,
    maximumEventsPerSegment,
    storeMarkerDigest: digest(
      data(fields, "storeMarkerDigest"),
      "descriptor.storeMarkerDigest",
    ),
    storeMarkerEntryDigest: digest(
      data(fields, "storeMarkerEntryDigest"),
      "descriptor.storeMarkerEntryDigest",
    ),
    storeMarkerId: identifier(
      data(fields, "storeMarkerId"),
      "descriptor.storeMarkerId",
    ),
    tenantId: identifier(data(fields, "tenantId"), "descriptor.tenantId"),
    witnessTrust,
  });
}

function captureWitness(value) {
  rejectProxy(value, "manifest witness");
  if (!value || typeof value !== "object") {
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_WITNESS_INVALID_CODE,
      "manifest witness is required",
    );
  }
  const id = Object.getOwnPropertyDescriptor(value, "id");
  if (!id || !("value" in id)) {
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_WITNESS_INVALID_CODE,
      "manifest witness id must be own data",
    );
  }
  const read = Object.getOwnPropertyDescriptor(value, "read");
  const compareAndSwap = Object.getOwnPropertyDescriptor(
    value,
    "compareAndSwap",
  );
  if (
    !read ||
    !compareAndSwap ||
    !("value" in read) ||
    !("value" in compareAndSwap) ||
    typeof read.value !== "function" ||
    typeof compareAndSwap.value !== "function"
  ) {
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_WITNESS_INVALID_CODE,
      "manifest witness read and compareAndSwap ports are required",
    );
  }
  rejectProxy(read.value, "manifest witness.read");
  rejectProxy(compareAndSwap.value, "manifest witness.compareAndSwap");
  return Object.freeze({
    compareAndSwap: Object.freeze((request) =>
      Reflect.apply(compareAndSwap.value, value, [request]),
    ),
    id: identifier(id.value, "manifest witness id"),
    read: Object.freeze(() => Reflect.apply(read.value, value, [])),
  });
}

function sync(
  value,
  label,
  code = EVOLUTION_LEDGER_MANIFEST_WITNESS_UNAVAILABLE_CODE,
) {
  rejectProxy(value, label, code);
  if (utilTypes.isPromise(value))
    throw failure(code, `${label} must be synchronous`);
  return value;
}

function own(record, name, code) {
  rejectProxy(record, "witness record", code);
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw failure(code, "witness record is invalid");
  }
  const field = Object.getOwnPropertyDescriptor(record, name);
  if (!field || !("value" in field)) {
    throw failure(code, `witness record.${name} must be own data`);
  }
  return field.value;
}

function normalizeWitness(record, descriptor, witnessId, code) {
  if (own(record, "schema", code) !== EVOLUTION_LEDGER_WITNESS_SCHEMA) {
    throw failure(code, "witness record schema is invalid");
  }
  if (
    own(record, "authenticated", code) !== true ||
    own(record, "durable", code) !== true
  ) {
    throw failure(code, "witness record is not authenticated durable state");
  }
  if (own(record, "witnessId", code) !== witnessId) {
    throw failure(code, "witness record id binding differs");
  }
  const status = own(record, "status", code);
  const witnessDigest = digest(
    own(record, "witnessDigest", code),
    "witnessDigest",
    code,
  );
  const generation = own(record, "generation", code);
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw failure(code, "witness generation is invalid");
  }
  const trust = descriptor.witnessTrust;
  for (const [field, expected] of Object.entries(trust)) {
    if (own(record, field, code) !== expected) {
      throw failure(code, `witness ${field} trust binding differs`);
    }
  }
  if (status === "absent") {
    if (generation !== 0)
      throw failure(code, "absent witness generation is invalid");
    return Object.freeze({ status, witnessDigest, generation, record });
  }
  if (status !== "committed") throw failure(code, "witness status is invalid");
  for (const [field, expected] of Object.entries({
    epoch: descriptor.epoch,
    identityDigest: descriptor.identityDigest,
    ledgerId: descriptor.ledgerId,
    storeMarkerDigest: descriptor.storeMarkerDigest,
    storeMarkerEntryDigest: descriptor.storeMarkerEntryDigest,
    storeMarkerId: descriptor.storeMarkerId,
  })) {
    if (own(record, field, code) !== expected) {
      throw failure(code, `witness ${field} binding differs`);
    }
  }
  return Object.freeze({ status, witnessDigest, generation, record });
}

function verifyManifestPair(authority, descriptor, rawManifest, rawHead) {
  let manifest;
  let head;
  const manifestDescriptor = Object.freeze({
    epoch: descriptor.epoch,
    ledgerId: descriptor.ledgerId,
    maximumEventsPerSegment: descriptor.maximumEventsPerSegment,
    tenantId: descriptor.tenantId,
  });
  try {
    manifest = verifyEvolutionLedgerSegmentManifest({
      authority,
      descriptor: manifestDescriptor,
      manifest: rawManifest,
    });
    head = verifyEvolutionLedgerManifestHead({
      authority,
      descriptor: manifestDescriptor,
      head: rawHead,
    });
  } catch (cause) {
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_WITNESS_INVALID_CODE,
      "manifest witness input is invalid",
      { cause },
    );
  }
  if (
    head.manifestDigest !== manifest.manifestDigest ||
    head.manifestSequence !== manifest.manifestSequence ||
    head.sequence !== manifest.sequenceEnd ||
    head.eventDigest !== manifest.eventDigests.at(-1)
  ) {
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_WITNESS_INVALID_CODE,
      "manifest head does not bind its checkpoint manifest",
    );
  }
  return Object.freeze({ head, manifest });
}

function snapshot(descriptor, witnessId, manifest, head) {
  return Object.freeze({
    anchorDigest: manifest.manifestDigest,
    epoch: descriptor.epoch,
    headDigest: head.headDigest,
    identityDigest: descriptor.identityDigest,
    ledgerId: descriptor.ledgerId,
    payloadDigest: manifest.eventDigestRoot,
    segmentDigest: manifest.contentDigest,
    sequence: head.sequence,
    storeMarkerDigest: descriptor.storeMarkerDigest,
    storeMarkerEntryDigest: descriptor.storeMarkerEntryDigest,
    storeMarkerId: descriptor.storeMarkerId,
    witnessId,
  });
}

function sameWitness(left, right) {
  return left?.witnessDigest === right?.witnessDigest;
}

export function createEvolutionLedgerManifestWitnessAdapter(
  options = undefined,
) {
  const fields = exactRecord(
    options,
    CONFIG_KEYS,
    "manifest witness adapter configuration",
  );
  const descriptor = scope(data(fields, "descriptor"));
  const manifestAuthority = captureEvolutionLedgerManifestAuthority(
    data(fields, "manifestAuthority"),
  );
  const witness = captureWitness(data(fields, "witness"));

  const read = () => {
    let raw;
    try {
      raw = sync(witness.read(), "manifest witness read result");
    } catch (cause) {
      if (cause instanceof EvolutionLedgerManifestWitnessError) throw cause;
      throw failure(
        EVOLUTION_LEDGER_MANIFEST_WITNESS_UNAVAILABLE_CODE,
        "manifest witness read failed",
        { cause },
      );
    }
    return normalizeWitness(
      raw,
      descriptor,
      witness.id,
      EVOLUTION_LEDGER_MANIFEST_WITNESS_CORRUPT_CODE,
    );
  };

  const adapter = Object.freeze({
    descriptor: Object.freeze({
      ...descriptor,
      schema: EVOLUTION_LEDGER_MANIFEST_WITNESS_ADAPTER_SCHEMA,
      witnessId: witness.id,
    }),
    read,
    checkpoint(input) {
      const requestFields = exactRecord(
        input,
        CHECKPOINT_KEYS,
        "manifest witness checkpoint request",
      );
      const expectedWitnessDigest = digest(
        data(requestFields, "expectedWitnessDigest"),
        "expectedWitnessDigest",
      );
      const { manifest, head } = verifyManifestPair(
        manifestAuthority,
        descriptor,
        data(requestFields, "manifest"),
        data(requestFields, "head"),
      );
      const current = read();
      if (current.witnessDigest !== expectedWitnessDigest) {
        return Object.freeze({
          checkpointed: false,
          conflict: true,
          current: current.record,
          schema: EVOLUTION_LEDGER_MANIFEST_WITNESS_RECEIPT_SCHEMA,
        });
      }
      const next = snapshot(descriptor, witness.id, manifest, head);
      let rawAcknowledgement;
      try {
        rawAcknowledgement = sync(
          witness.compareAndSwap({ expected: current.record, next }),
          "manifest witness compareAndSwap result",
        );
      } catch (cause) {
        throw failure(
          EVOLUTION_LEDGER_MANIFEST_WITNESS_COMMIT_UNKNOWN_CODE,
          "manifest witness acknowledgement was lost; reopen before retrying",
          { cause },
        );
      }
      let acknowledgement;
      try {
        acknowledgement = normalizeWitness(
          rawAcknowledgement,
          descriptor,
          witness.id,
          EVOLUTION_LEDGER_MANIFEST_WITNESS_CORRUPT_CODE,
        );
      } catch (cause) {
        throw failure(
          EVOLUTION_LEDGER_MANIFEST_WITNESS_COMMIT_UNKNOWN_CODE,
          "manifest witness acknowledgement is invalid; reopen before retrying",
          { cause },
        );
      }
      if (!sameWitness(acknowledgement, current)) {
        const fieldsToBind = {
          anchorDigest: manifest.manifestDigest,
          headDigest: head.headDigest,
          payloadDigest: manifest.eventDigestRoot,
          segmentDigest: manifest.contentDigest,
          sequence: head.sequence,
        };
        for (const [field, expected] of Object.entries(fieldsToBind)) {
          if (
            own(
              acknowledgement.record,
              field,
              EVOLUTION_LEDGER_MANIFEST_WITNESS_CORRUPT_CODE,
            ) !== expected
          ) {
            throw failure(
              EVOLUTION_LEDGER_MANIFEST_WITNESS_COMMIT_UNKNOWN_CODE,
              "manifest witness acknowledged substituted checkpoint; reopen before retrying",
            );
          }
        }
      } else {
        return Object.freeze({
          checkpointed: false,
          conflict: true,
          current: acknowledgement.record,
          schema: EVOLUTION_LEDGER_MANIFEST_WITNESS_RECEIPT_SCHEMA,
        });
      }
      let readback;
      try {
        readback = read();
      } catch (cause) {
        throw failure(
          EVOLUTION_LEDGER_MANIFEST_WITNESS_COMMIT_UNKNOWN_CODE,
          "manifest witness may be checkpointed; reopen before retrying",
          { cause },
        );
      }
      if (!sameWitness(readback, acknowledgement)) {
        throw failure(
          EVOLUTION_LEDGER_MANIFEST_WITNESS_COMMIT_UNKNOWN_CODE,
          "manifest witness readback differs; reopen before retrying",
        );
      }
      return Object.freeze({
        checkpointed: true,
        conflict: false,
        headDigest: head.headDigest,
        manifestDigest: manifest.manifestDigest,
        schema: EVOLUTION_LEDGER_MANIFEST_WITNESS_RECEIPT_SCHEMA,
        sequence: head.sequence,
        witnessDigest: readback.witnessDigest,
      });
    },
  });
  ADAPTERS.add(adapter);
  return adapter;
}

export function captureEvolutionLedgerManifestWitnessAdapter(
  value,
  expected = undefined,
) {
  if (!ADAPTERS.has(value)) {
    throw new TypeError(
      "a branded Evolution Ledger manifest witness adapter is required",
    );
  }
  if (expected !== undefined) {
    const fields = exactRecord(
      expected,
      new Set(["epoch", "ledgerId", "tenantId"]),
      "expected manifest witness scope",
    );
    for (const field of ["epoch", "ledgerId", "tenantId"]) {
      if (value.descriptor[field] !== data(fields, field)) {
        throw failure(
          EVOLUTION_LEDGER_MANIFEST_WITNESS_INVALID_CODE,
          `manifest witness ${field} scope differs`,
        );
      }
    }
  }
  return value;
}
