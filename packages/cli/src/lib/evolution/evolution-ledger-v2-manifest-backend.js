import { types as utilTypes } from "node:util";

import { captureImmutableLedgerSegmentStorePort } from "./evolution-immutable-ledger-segment-store.js";
import {
  captureEvolutionLedgerManifestAuthority,
  deriveEvolutionLedgerManifestHead,
  sealEvolutionLedgerManifestSegment,
  verifyEvolutionLedgerManifestChain,
} from "./evolution-ledger-manifest-chain.js";
import { captureEvolutionLedgerManifestHeadStore } from "./evolution-ledger-manifest-head-store.js";
import { captureEvolutionLedgerManifestCatalog } from "./evolution-ledger-manifest-catalog.js";
import { captureEvolutionLedgerManifestWitnessAdapter } from "./evolution-ledger-manifest-witness-adapter.js";

export const EVOLUTION_LEDGER_V2_MANIFEST_BACKEND_SCHEMA =
  "chainlesschain.evolution-ledger-v2-manifest-backend/v2";
export const EVOLUTION_LEDGER_V2_MANIFEST_APPEND_RECEIPT_SCHEMA =
  "chainlesschain.evolution-ledger-v2-manifest-append-receipt/v2";
export const EVOLUTION_LEDGER_V2_MANIFEST_CONFLICT_SCHEMA =
  "chainlesschain.evolution-ledger-v2-manifest-conflict/v2";
export const EVOLUTION_LEDGER_V2_MANIFEST_INVALID_CODE =
  "CC_EVOLUTION_LEDGER_V2_MANIFEST_INVALID";
export const EVOLUTION_LEDGER_V2_MANIFEST_CORRUPT_CODE =
  "CC_EVOLUTION_LEDGER_V2_MANIFEST_CORRUPT";
export const EVOLUTION_LEDGER_V2_MANIFEST_UNAVAILABLE_CODE =
  "CC_EVOLUTION_LEDGER_V2_MANIFEST_UNAVAILABLE";
export const EVOLUTION_LEDGER_V2_MANIFEST_COMMIT_UNKNOWN_CODE =
  "CC_EVOLUTION_LEDGER_V2_MANIFEST_COMMIT_UNKNOWN";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const CONFIG_KEYS = new Set([
  "descriptor",
  "catalog",
  "headStore",
  "manifestAuthority",
  "now",
  "segmentStore",
  "witnessAdapter",
]);
const DESCRIPTOR_KEYS = new Set([
  "epoch",
  "ledgerId",
  "maximumEventsPerSegment",
  "tenantId",
]);
const APPEND_KEYS = new Set([
  "eventDigests",
  "expectedHeadDigest",
  "expectedWitnessDigest",
  "minimumRetainedUntil",
]);
const VERIFY_KEYS = new Set();
const BACKENDS = new WeakSet();

export class EvolutionLedgerV2ManifestBackendError extends Error {
  constructor(code, message, options = undefined) {
    super(message, options);
    this.name = "EvolutionLedgerV2ManifestBackendError";
    this.code = code;
  }
}

function failure(code, message, options = undefined) {
  return new EvolutionLedgerV2ManifestBackendError(code, message, options);
}

function rejectProxy(
  value,
  label,
  code = EVOLUTION_LEDGER_V2_MANIFEST_INVALID_CODE,
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
  code = EVOLUTION_LEDGER_V2_MANIFEST_INVALID_CODE,
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
  code = EVOLUTION_LEDGER_V2_MANIFEST_INVALID_CODE,
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

function positive(
  value,
  label,
  code = EVOLUTION_LEDGER_V2_MANIFEST_INVALID_CODE,
) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1024) {
    throw failure(code, `${label} is invalid`);
  }
  return value;
}

function digest(
  value,
  label,
  code = EVOLUTION_LEDGER_V2_MANIFEST_INVALID_CODE,
) {
  if (!DIGEST.test(value || ""))
    throw failure(code, `${label} must be sha256-bound`);
  return value;
}

function nullableDigest(
  value,
  label,
  code = EVOLUTION_LEDGER_V2_MANIFEST_INVALID_CODE,
) {
  return value === null ? null : digest(value, label, code);
}

function descriptor(value) {
  const fields = exactRecord(
    value,
    DESCRIPTOR_KEYS,
    "v2 manifest backend descriptor",
  );
  return Object.freeze({
    epoch: identifier(data(fields, "epoch"), "descriptor.epoch"),
    ledgerId: identifier(data(fields, "ledgerId"), "descriptor.ledgerId"),
    maximumEventsPerSegment: positive(
      data(fields, "maximumEventsPerSegment"),
      "descriptor.maximumEventsPerSegment",
    ),
    tenantId: identifier(data(fields, "tenantId"), "descriptor.tenantId"),
  });
}

function own(record, name, code = EVOLUTION_LEDGER_V2_MANIFEST_CORRUPT_CODE) {
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

function checkpointParts(catalog, headStore, witnessAdapter) {
  let head;
  let manifest;
  let witness;
  try {
    manifest = catalog.readLatest();
    head = headStore.read();
    witness = witnessAdapter.read();
  } catch (cause) {
    if (cause instanceof EvolutionLedgerV2ManifestBackendError) throw cause;
    throw failure(
      EVOLUTION_LEDGER_V2_MANIFEST_UNAVAILABLE_CODE,
      "v2 manifest checkpoint cannot be read",
      { cause },
    );
  }
  return { head, manifest, witness };
}

function witnessMatchesHead(witness, head) {
  if (head === null) return witness.status === "absent";
  if (witness.status !== "committed") return false;
  return (
    own(witness.record, "anchorDigest") === head.manifestDigest &&
    own(witness.record, "headDigest") === head.headDigest &&
    own(witness.record, "sequence") === head.sequence
  );
}

function coherentCheckpoint({ head, manifest, witness }) {
  if (head === null) {
    if (manifest !== null || witness.status !== "absent") {
      throw failure(
        EVOLUTION_LEDGER_V2_MANIFEST_CORRUPT_CODE,
        "v2 manifest catalog or witness exists without a manifest head",
      );
    }
    return Object.freeze({ head: null, manifest: null, witness });
  }
  if (!witnessMatchesHead(witness, head)) {
    throw failure(
      EVOLUTION_LEDGER_V2_MANIFEST_CORRUPT_CODE,
      "v2 manifest head has no matching committed witness",
    );
  }
  if (manifest?.manifestDigest !== head.manifestDigest) {
    throw failure(
      EVOLUTION_LEDGER_V2_MANIFEST_CORRUPT_CODE,
      "v2 manifest catalog latest does not bind the manifest head",
    );
  }
  return Object.freeze({ head, manifest, witness });
}

function coherentSnapshot(catalog, headStore, witnessAdapter) {
  return coherentCheckpoint(
    checkpointParts(catalog, headStore, witnessAdapter),
  );
}

function conflict(snapshot) {
  return Object.freeze({
    conflict: true,
    currentHeadDigest: snapshot.head?.headDigest ?? null,
    currentWitnessDigest: snapshot.witness.witnessDigest,
    schema: EVOLUTION_LEDGER_V2_MANIFEST_CONFLICT_SCHEMA,
  });
}

function unknown(message, cause = undefined) {
  return failure(
    EVOLUTION_LEDGER_V2_MANIFEST_COMMIT_UNKNOWN_CODE,
    message,
    cause ? { cause } : undefined,
  );
}

export function createEvolutionLedgerV2ManifestBackend(options = undefined) {
  const fields = exactRecord(
    options,
    CONFIG_KEYS,
    "v2 manifest backend configuration",
  );
  const normalizedDescriptor = descriptor(data(fields, "descriptor"));
  const scope = Object.freeze({
    epoch: normalizedDescriptor.epoch,
    ledgerId: normalizedDescriptor.ledgerId,
    tenantId: normalizedDescriptor.tenantId,
  });
  const manifestAuthority = captureEvolutionLedgerManifestAuthority(
    data(fields, "manifestAuthority"),
  );
  const catalog = captureEvolutionLedgerManifestCatalog(
    data(fields, "catalog"),
    scope,
  );
  const segmentStore = captureImmutableLedgerSegmentStorePort(
    data(fields, "segmentStore"),
    scope,
  );
  const headStore = captureEvolutionLedgerManifestHeadStore(
    data(fields, "headStore"),
    scope,
  );
  const witnessAdapter = captureEvolutionLedgerManifestWitnessAdapter(
    data(fields, "witnessAdapter"),
    scope,
  );
  if (
    witnessAdapter.descriptor.maximumEventsPerSegment !==
    normalizedDescriptor.maximumEventsPerSegment
  ) {
    throw failure(
      EVOLUTION_LEDGER_V2_MANIFEST_INVALID_CODE,
      "v2 manifest witness segment bound differs",
    );
  }
  const now = data(fields, "now");
  rejectProxy(now, "v2 manifest backend clock");
  if (typeof now !== "function") {
    throw failure(
      EVOLUTION_LEDGER_V2_MANIFEST_INVALID_CODE,
      "v2 manifest backend clock is required",
    );
  }

  const verifyPreparedChain = (head) =>
    verifyEvolutionLedgerManifestChain({
      authority: manifestAuthority,
      descriptor: normalizedDescriptor,
      head,
      manifests: catalog.list(),
      segmentStore,
    });

  const recoverCheckpoint = () => {
    let parts = checkpointParts(catalog, headStore, witnessAdapter);
    try {
      return coherentCheckpoint(parts);
    } catch (initialFailure) {
      if (parts.manifest === null) throw initialFailure;
    }

    let proposedHead = parts.head;
    if (parts.head?.manifestDigest !== parts.manifest.manifestDigest) {
      const previousManifestDigest = parts.head?.manifestDigest ?? null;
      const previousManifestSequence = parts.head?.manifestSequence ?? 0;
      const previousSequence = parts.head?.sequence ?? 0;
      if (
        parts.manifest.previousManifestDigest !== previousManifestDigest ||
        parts.manifest.manifestSequence !== previousManifestSequence + 1 ||
        parts.manifest.sequenceStart !== previousSequence + 1 ||
        !witnessMatchesHead(parts.witness, parts.head)
      ) {
        throw failure(
          EVOLUTION_LEDGER_V2_MANIFEST_CORRUPT_CODE,
          "v2 manifest partial checkpoint is not a recoverable next segment",
        );
      }
      proposedHead = deriveEvolutionLedgerManifestHead({
        authority: manifestAuthority,
        descriptor: normalizedDescriptor,
        manifest: parts.manifest,
        previousHead: parts.head,
      });
      verifyPreparedChain(proposedHead);
      let committed;
      try {
        committed = headStore.commit({
          expectedHeadDigest: parts.head?.headDigest ?? null,
          nextHead: proposedHead,
        });
      } catch (cause) {
        throw unknown(
          "v2 manifest head recovery may be committed; reopen before retrying",
          cause,
        );
      }
      if (committed.committed !== true) {
        const observed = headStore.read();
        if (observed?.headDigest !== proposedHead.headDigest) {
          throw unknown(
            "v2 manifest head recovery conflicted; reopen before retrying",
          );
        }
      }
      parts = checkpointParts(catalog, headStore, witnessAdapter);
    }

    if (!witnessMatchesHead(parts.witness, proposedHead)) {
      const witnessIsPrevious =
        (parts.witness.status === "absent" &&
          proposedHead.previousHeadDigest === null &&
          parts.manifest.sequenceStart === 1) ||
        (parts.witness.status === "committed" &&
          own(parts.witness.record, "headDigest") ===
            proposedHead.previousHeadDigest &&
          own(parts.witness.record, "anchorDigest") ===
            parts.manifest.previousManifestDigest &&
          own(parts.witness.record, "sequence") ===
            parts.manifest.sequenceStart - 1);
      if (!witnessIsPrevious) {
        throw failure(
          EVOLUTION_LEDGER_V2_MANIFEST_CORRUPT_CODE,
          "v2 manifest witness is not at the recoverable previous checkpoint",
        );
      }
      verifyPreparedChain(proposedHead);
      let checkpointed;
      try {
        checkpointed = witnessAdapter.checkpoint({
          expectedWitnessDigest: parts.witness.witnessDigest,
          head: proposedHead,
          manifest: parts.manifest,
        });
      } catch (cause) {
        throw unknown(
          "v2 manifest witness recovery may be committed; reopen before retrying",
          cause,
        );
      }
      if (checkpointed.checkpointed !== true) {
        const observed = witnessAdapter.read();
        if (!witnessMatchesHead(observed, proposedHead)) {
          throw unknown(
            "v2 manifest witness recovery conflicted; reopen before retrying",
          );
        }
      }
    }
    return coherentSnapshot(catalog, headStore, witnessAdapter);
  };

  const backend = Object.freeze({
    descriptor: Object.freeze({
      ...normalizedDescriptor,
      schema: EVOLUTION_LEDGER_V2_MANIFEST_BACKEND_SCHEMA,
    }),
    read() {
      return recoverCheckpoint();
    },
    appendSegment(input) {
      const request = exactRecord(
        input,
        APPEND_KEYS,
        "v2 manifest append request",
      );
      const expectedHeadDigest = nullableDigest(
        data(request, "expectedHeadDigest"),
        "expectedHeadDigest",
      );
      const expectedWitnessDigest = digest(
        data(request, "expectedWitnessDigest"),
        "expectedWitnessDigest",
      );
      const current = recoverCheckpoint();
      if (
        (current.head?.headDigest ?? null) !== expectedHeadDigest ||
        current.witness.witnessDigest !== expectedWitnessDigest
      ) {
        return conflict(current);
      }
      const sealed = sealEvolutionLedgerManifestSegment({
        authority: manifestAuthority,
        descriptor: normalizedDescriptor,
        eventDigests: data(request, "eventDigests"),
        minimumRetainedUntil: data(request, "minimumRetainedUntil"),
        now,
        previousHead: current.head,
        segmentStore,
      });
      let catalogResult;
      try {
        catalogResult = catalog.append({
          expectedManifestDigest: current.manifest?.manifestDigest ?? null,
          manifest: sealed.manifest,
        });
      } catch (cause) {
        throw unknown(
          "v2 manifest catalog may be committed; reopen before retrying",
          cause,
        );
      }
      if (catalogResult.appended !== true) {
        throw unknown(
          "v2 manifest catalog conflicted after segment retention; reopen before retrying",
        );
      }
      let headResult;
      try {
        headResult = headStore.commit({
          expectedHeadDigest,
          nextHead: sealed.head,
        });
      } catch (cause) {
        throw unknown(
          "v2 manifest head may be committed; reopen before retrying",
          cause,
        );
      }
      if (headResult.committed !== true) {
        throw unknown(
          "v2 manifest catalog is committed but head CAS conflicted; reopen before retrying",
        );
      }
      let witnessResult;
      try {
        witnessResult = witnessAdapter.checkpoint({
          expectedWitnessDigest,
          head: sealed.head,
          manifest: sealed.manifest,
        });
      } catch (cause) {
        throw unknown(
          "v2 manifest witness may be checkpointed; reopen before retrying",
          cause,
        );
      }
      if (witnessResult.checkpointed !== true) {
        throw unknown(
          "v2 manifest head is committed but witness checkpoint conflicted; reopen before retrying",
        );
      }
      let final;
      try {
        final = recoverCheckpoint();
      } catch (cause) {
        throw unknown(
          "v2 manifest commit readback is unavailable; reopen before retrying",
          cause,
        );
      }
      if (
        final.head?.headDigest !== sealed.head.headDigest ||
        final.witness.witnessDigest !== witnessResult.witnessDigest
      ) {
        throw unknown(
          "v2 manifest commit readback differs; reopen before retrying",
        );
      }
      return Object.freeze({
        authenticated: true,
        durable: true,
        headDigest: sealed.head.headDigest,
        immutable: true,
        manifestDigest: sealed.manifest.manifestDigest,
        manifestSequence: sealed.manifest.manifestSequence,
        readbackVerified: true,
        schema: EVOLUTION_LEDGER_V2_MANIFEST_APPEND_RECEIPT_SCHEMA,
        segmentReceipt: sealed.segmentReceipt,
        sequenceEnd: sealed.manifest.sequenceEnd,
        sequenceStart: sealed.manifest.sequenceStart,
        witnessed: true,
        witnessDigest: final.witness.witnessDigest,
      });
    },
    verify(input = {}) {
      exactRecord(input, VERIFY_KEYS, "v2 manifest verification request");
      const snapshot = recoverCheckpoint();
      if (snapshot.head === null) {
        throw failure(
          EVOLUTION_LEDGER_V2_MANIFEST_INVALID_CODE,
          "an empty v2 manifest backend has no chain to verify",
        );
      }
      return verifyEvolutionLedgerManifestChain({
        authority: manifestAuthority,
        descriptor: normalizedDescriptor,
        head: snapshot.head,
        manifests: catalog.list(),
        segmentStore,
      });
    },
  });
  BACKENDS.add(backend);
  return backend;
}

export function captureEvolutionLedgerV2ManifestBackend(value) {
  if (!BACKENDS.has(value)) {
    throw new TypeError(
      "a branded Evolution Ledger v2 manifest backend is required",
    );
  }
  return value;
}

export function isEvolutionLedgerV2ManifestBackend(value) {
  return BACKENDS.has(value);
}
