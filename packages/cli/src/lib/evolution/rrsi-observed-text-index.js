/** Retained observations and prohibitions, never proof of causal generation. */
import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import { captureRrsiRegistryStorePolicy } from "./rrsi-registry-store-policy.js";
import { captureEvolutionLedgerFileBackend } from "./evolution-ledger-file-backend.js";
import {
  EvolutionArtifactPorts,
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_REF_SCHEMA,
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
  EVOLUTION_LEDGER_MAX_EVENTS,
} from "./evolution-ledger.js";
import {
  captureRrsiHistoryLedgerAdapter,
  RRSI_HISTORY_EVENT_TYPE,
  RRSI_HISTORY_EVENT_SCHEMA,
} from "./rrsi-history-ledger-adapter.js";
import {
  rrsiCanonical,
  rrsiHash,
  rrsiDigest,
  rrsiInteger,
  rrsiId,
  rrsiExact,
  rrsiEnvelope,
  snapshotRrsiData,
  freezeRrsiData,
} from "./rrsi-data.js";

export const RRSI_OBSERVED_TEXT_MAX_BYTES = 1024 * 1024;
export const RRSI_OBSERVED_TEXT_CHUNK_BYTES = 64 * 1024;
export const RRSI_OBSERVED_TEXT_EVENT_TYPE =
  "rrsi.content-restriction.observed";
export const RRSI_OBSERVED_TEXT_HOLD_CODE = "CC_RRSI_CONTENT_PROVENANCE_HOLD";
const CHUNK_TYPE = "rrsi-observed-text-chunk";
const MANIFEST_TYPE = "rrsi-observed-text-manifest";
const EVENT_TYPE = "rrsi-content-restriction-event";
const CHUNK_SCHEMA = "chainlesschain.rrsi-observed-text-chunk/v1";
const MANIFEST_SCHEMA = "chainlesschain.rrsi-observed-text-manifest/v1";
const RECORD_SCHEMA = "chainlesschain.rrsi-content-restriction-event/v1";
const INDEX_SCHEMA = "chainlesschain.rrsi-observed-text-index/v1";
const MAX_RECORDS = 256;
const REQUIRED = ["generation-unverified", "rrsi-evidence-required"];
const CODES = [
  ...REQUIRED,
  "source-conflict",
  "cross-pool-exposure",
  "publication-incomplete",
];
const INDEXES = new WeakMap();
const hashBytes = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const same = (a, b) => rrsiCanonical(a) === rrsiCanonical(b);
const head = (value) =>
  Object.fromEntries(
    ["ledgerId", "identityDigest", "epoch", "sequence", "headDigest"].map(
      (key) => [key, value[key]],
    ),
  );
const identity = (value) =>
  Object.fromEntries(
    ["ledgerId", "identityDigest", "epoch"].map((key) => [key, value[key]]),
  );
function hold(message, cause) {
  throw Object.assign(new Error(message, cause ? { cause } : undefined), {
    code: RRSI_OBSERVED_TEXT_HOLD_CODE,
  });
}
function guarded(operation) {
  try {
    return operation();
  } catch (cause) {
    if (
      [
        RRSI_OBSERVED_TEXT_HOLD_CODE,
        "STATE_LOCK_OWNERSHIP_LOST",
        "CC_RRSI_TEXT_COMMIT_UNKNOWN",
      ].includes(cause?.code)
    )
      throw cause;
    hold("observed text index could not authenticate its boundary", cause);
  }
}
function own(input, names) {
  if (
    !input ||
    isProxy(input) ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Reflect.ownKeys(input).length !== names.length
  )
    hold("observed text requires plain own fields");
  return Object.fromEntries(
    names.map((name) => {
      const field = Object.getOwnPropertyDescriptor(input, name);
      if (!field?.enumerable || !("value" in field))
        hold("observed text cannot use accessors");
      return [name, field.value];
    }),
  );
}
function ref(value) {
  if (isProxy(value)) hold("observed text reference cannot be a proxy");
  const copied = Object.fromEntries(
    ["schema", "ref", "digest"].map((key) => {
      const field = Object.getOwnPropertyDescriptor(value, key);
      if (!field?.enumerable || !("value" in field))
        hold("observed text requires original own reference data");
      return [key, field.value];
    }),
  );
  if (copied.schema !== EVOLUTION_ARTIFACT_REF_SCHEMA)
    hold("observed text reference schema differs");
  rrsiDigest(copied.digest, "artifact digest");
  if (typeof copied.ref !== "string" || copied.ref.length > 256)
    hold("observed text reference is invalid");
  return copied;
}
function sortedRefs(values) {
  const compare = (a, b) => (a === b ? 0 : a < b ? -1 : 1);
  return values
    .map(ref)
    .sort((a, b) => compare(a.ref, b.ref) || compare(a.digest, b.digest));
}
/** Strings preserve BOM, CRLF and Unicode; lone surrogates are rejected. */
export function encodeRrsiObservedSkillText(text) {
  if (typeof text !== "string") hold("Skill text must be a string");
  if (
    text.length < 1 ||
    text.length > RRSI_OBSERVED_TEXT_MAX_BYTES ||
    Buffer.byteLength(text, "utf8") > RRSI_OBSERVED_TEXT_MAX_BYTES
  )
    hold("Skill text exceeds its nonempty 1 MiB bound");
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length < 1 || bytes.length > RRSI_OBSERVED_TEXT_MAX_BYTES)
    hold("Skill text exceeds its nonempty 1 MiB bound");
  const decoded = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(bytes);
  if (decoded !== text) hold("Skill text does not roundtrip as exact UTF-8");
  return bytes;
}
function restrictions(input) {
  const values = snapshotRrsiData(input);
  if (
    !Array.isArray(values) ||
    values.length > CODES.length ||
    values.some((code) => !CODES.includes(code)) ||
    new Set(values).size !== values.length
  )
    hold("text restrictions must be distinct supported prohibition codes");
  return [...new Set([...REQUIRED, ...values])].sort();
}

export function createRrsiObservedTextIndex(input) {
  const options = own(input, [
    "storePolicy",
    "backend",
    "artifactPorts",
    "ledgerArtifactResolver",
  ]);
  const policy = captureRrsiRegistryStorePolicy(options.storePolicy);
  const backend = captureEvolutionLedgerFileBackend(options.backend);
  if (
    !policy.matchesBackend(backend) ||
    !policy.matchesArtifactPorts(options.artifactPorts) ||
    !policy.matchesArtifactResolver(options.ledgerArtifactResolver)
  )
    hold("text index requires the original policy storage graph");
  const ledger = backend.ledger;
  const methods = Object.fromEntries(
    ["verify", "read", "appendDomainEvent"].map((name) => {
      const method = Object.getOwnPropertyDescriptor(ledger, name)?.value;
      if (!Object.isFrozen(ledger) || typeof method !== "function")
        hold("text index requires original frozen v2 journal methods");
      return [name, (...args) => Reflect.apply(method, ledger, args)];
    }),
  );
  const originalIdentity = freezeRrsiData(identity(methods.verify()));
  const descriptor = freezeRrsiData({
    schema: INDEX_SCHEMA,
    tenantId: policy.descriptor.tenantId,
    artifactTenantId: policy.descriptor.artifactTenantId,
    audience: policy.descriptor.audience,
    purpose: policy.descriptor.purpose,
    indexId: `rrsi-text.${rrsiHash(INDEX_SCHEMA, policy.descriptor.tenantId).slice(7)}`,
    ledgerIdentity: originalIdentity,
    observationBoundary: "authenticated-retained-readback",
    tenantWideIndexAuthorityVerified: false,
    generationProvenanceVerified: false,
    grantsMutationOrPromotionAuthority: false,
  });
  const context = {
    audience: descriptor.audience,
    purpose: descriptor.purpose,
    retention: "ledger",
  };
  function resolve(reference, type, validate) {
    const copied = ref(reference);
    const resolution = options.ledgerArtifactResolver({
      ledgerId: originalIdentity.ledgerId,
      epoch: originalIdentity.epoch,
      ref: copied,
      tenantId: descriptor.artifactTenantId,
    });
    if (
      resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
      resolution.authenticated !== true ||
      resolution.found !== true ||
      resolution.ref !== copied.ref ||
      resolution.digest !== copied.digest ||
      !Buffer.isBuffer(resolution.bytes) ||
      resolution.bytes.length > 1024 * 1024
    )
      hold("retained text artifact cannot be authenticated");
    const stored = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(resolution.bytes),
    );
    rrsiExact(
      stored,
      [
        "schema",
        "tenantId",
        "audience",
        "purpose",
        "retention",
        "type",
        "value",
      ],
      "retained text record",
    );
    if (
      stored.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
      stored.tenantId !== descriptor.artifactTenantId ||
      stored.audience !== descriptor.audience ||
      stored.purpose !== descriptor.purpose ||
      stored.retention !== "ledger" ||
      stored.type !== type
    )
      hold("retained text artifact scope or retention differs");
    const validated = validate(stored.value);
    if (!Buffer.from(rrsiCanonical(stored)).equals(resolution.bytes))
      hold("retained text artifact is not exact canonical bytes");
    return validated;
  }
  function publish(type, value, assertOwnership, validate) {
    assertOwnership();
    const result = Reflect.apply(
      EvolutionArtifactPorts.prototype.putCanonical,
      options.artifactPorts,
      [type, value, context],
    );
    if (
      result?.receipt?.persisted !== true ||
      result.receipt.integrityVerified !== true ||
      result.receipt.readbackVerified !== true ||
      result.receipt.retention !== "ledger" ||
      !same(resolve(result.ref, type, validate), value)
    )
      hold("text artifact publication cannot be retained exactly");
    assertOwnership();
    return ref(result.ref);
  }
  function validateChunk(value) {
    rrsiExact(
      value,
      ["schema", "byteLength", "chunkDigest", "bytesBase64"],
      "text chunk",
    );
    if (
      value.schema !== CHUNK_SCHEMA ||
      !Number.isSafeInteger(value.byteLength) ||
      value.byteLength < 1 ||
      value.byteLength > RRSI_OBSERVED_TEXT_CHUNK_BYTES ||
      typeof value.bytesBase64 !== "string" ||
      value.bytesBase64.length >
        4 * Math.ceil(RRSI_OBSERVED_TEXT_CHUNK_BYTES / 3)
    )
      hold("text chunk exceeds its bound");
    const bytes = Buffer.from(value.bytesBase64, "base64");
    if (
      bytes.length !== value.byteLength ||
      bytes.toString("base64") !== value.bytesBase64 ||
      hashBytes(bytes) !== value.chunkDigest
    )
      hold("text chunk bytes or digest differ");
    return value;
  }
  function validateManifest(input) {
    const value = snapshotRrsiData(input);
    rrsiExact(
      value,
      ["schema", "skillTextDigest", "byteLength", "chunks"],
      "text manifest",
    );
    rrsiDigest(value.skillTextDigest, "Skill text digest");
    if (
      value.schema !== MANIFEST_SCHEMA ||
      !Number.isSafeInteger(value.byteLength) ||
      value.byteLength < 1 ||
      value.byteLength > RRSI_OBSERVED_TEXT_MAX_BYTES ||
      !Array.isArray(value.chunks) ||
      value.chunks.length !==
        Math.ceil(value.byteLength / RRSI_OBSERVED_TEXT_CHUNK_BYTES)
    )
      hold("text manifest length or chunk count differs");
    value.chunks.forEach((entry) => {
      rrsiExact(entry, ["ref", "byteLength", "chunkDigest"], "manifest chunk");
      ref(entry.ref);
      rrsiDigest(entry.chunkDigest, "chunk digest");
    });
    return value;
  }
  function readBytes(reference, expectedDigest) {
    const manifest = resolve(reference, MANIFEST_TYPE, validateManifest);
    if (manifest.skillTextDigest !== expectedDigest)
      hold("text manifest belongs to another Skill text digest");
    const chunks = manifest.chunks.map((entry, index) => {
      const value = resolve(entry.ref, CHUNK_TYPE, validateChunk);
      if (
        value.chunkDigest !== entry.chunkDigest ||
        value.byteLength !== entry.byteLength ||
        value.byteLength !==
          Math.min(
            RRSI_OBSERVED_TEXT_CHUNK_BYTES,
            manifest.byteLength - index * RRSI_OBSERVED_TEXT_CHUNK_BYTES,
          )
      )
        hold("text chunk order or actual length differs");
      return Buffer.from(value.bytesBase64, "base64");
    });
    const bytes = Buffer.concat(chunks, manifest.byteLength);
    if (
      bytes.length !== manifest.byteLength ||
      hashBytes(bytes) !== expectedDigest
    )
      hold("reconstructed Skill text digest differs");
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    if (!encodeRrsiObservedSkillText(text).equals(bytes))
      hold("retained text does not roundtrip as exact UTF-8");
    return text;
  }
  function retain(bytes, assertOwnership) {
    const chunks = [];
    for (
      let offset = 0;
      offset < bytes.length;
      offset += RRSI_OBSERVED_TEXT_CHUNK_BYTES
    ) {
      const chunk = bytes.subarray(
        offset,
        offset + RRSI_OBSERVED_TEXT_CHUNK_BYTES,
      );
      const value = {
        schema: CHUNK_SCHEMA,
        byteLength: chunk.length,
        chunkDigest: hashBytes(chunk),
        bytesBase64: chunk.toString("base64"),
      };
      chunks.push({
        ref: publish(CHUNK_TYPE, value, assertOwnership, validateChunk),
        byteLength: value.byteLength,
        chunkDigest: value.chunkDigest,
      });
    }
    const value = {
      schema: MANIFEST_SCHEMA,
      skillTextDigest: hashBytes(bytes),
      byteLength: bytes.length,
      chunks,
    };
    return publish(MANIFEST_TYPE, value, assertOwnership, validateManifest);
  }
  function validateRecord(input) {
    const value = snapshotRrsiData(input);
    const keys = [
      "descriptor",
      "ordinal",
      "skillTextDigest",
      "manifestRef",
      "association",
      "restrictions",
      "previousRecordDigest",
      "observedHead",
    ];
    rrsiExact(
      value,
      [
        "schema",
        ...keys,
        "recordDigest",
        "structuralOnly",
        "authenticated",
        "readyForExecution",
        "qualifiesForPromotion",
      ],
      "text restriction record",
    );
    if (
      !same(
        value,
        rrsiEnvelope(
          RECORD_SCHEMA,
          "recordDigest",
          Object.fromEntries(keys.map((key) => [key, value[key]])),
        ),
      )
    )
      hold("text restriction envelope differs");
    if (
      !same(value.descriptor, descriptor) ||
      !same(value.restrictions, restrictions(value.restrictions))
    )
      hold("text restriction scope or mandatory prohibitions differ");
    rrsiDigest(value.skillTextDigest, "Skill text digest");
    ref(value.manifestRef);
    rrsiExact(
      value.association,
      [
        "historyScopeId",
        "goalId",
        "campaignDigest",
        "executionId",
        "historyDescriptor",
        "registrationRecord",
      ],
      "preparation association",
    );
    rrsiExact(
      value.association.registrationRecord,
      ["recordDigest", "ref", "sequence"],
      "preparation registration",
    );
    rrsiDigest(value.association.campaignDigest, "associated campaign digest");
    rrsiId(
      value.association.executionId,
      "associated preparation execution ID",
    );
    rrsiDigest(
      value.association.registrationRecord.recordDigest,
      "preparation record digest",
    );
    return value;
  }
  function verifyAssociation(
    association,
    events,
    beforeSequence = events.length + 1,
    historyCache = new Map(),
  ) {
    const registration = association.registrationRecord;
    if (
      !Number.isSafeInteger(registration.sequence) ||
      registration.sequence < 1 ||
      registration.sequence >= beforeSequence
    )
      hold("preparation declaration must precede its text observation");
    const event = events[registration.sequence - 1];
    if (
      !event ||
      event.type !== RRSI_HISTORY_EVENT_TYPE ||
      event.tenantId !== descriptor.tenantId ||
      event.artifactTenantId !== descriptor.artifactTenantId ||
      event.skillName !== association.goalId ||
      event.correlationId !== association.historyScopeId ||
      !same(ref(event.subjectRef), registration.ref)
    )
      hold("preparation registration is not in the original journal");
    const expectedDescriptor = association.historyDescriptor;
    rrsiExact(
      expectedDescriptor,
      [
        "tenantId",
        "artifactTenantId",
        "goalId",
        "audience",
        "purpose",
        "scopeId",
        "settlementAuthority",
      ],
      "associated History descriptor",
    );
    const expectedScope = `rrsi.${rrsiHash("chainlesschain.rrsi-history-scope/v1", { tenantId: descriptor.tenantId, goalId: association.goalId }).slice(7)}`;
    if (
      typeof association.goalId !== "string" ||
      !/^[a-z][a-z0-9-]{0,127}$/u.test(association.goalId) ||
      association.historyScopeId !== expectedScope
    )
      hold("associated History requires its canonical tenant and goal scope");
    if (
      expectedDescriptor.tenantId !== descriptor.tenantId ||
      expectedDescriptor.artifactTenantId !== descriptor.artifactTenantId ||
      expectedDescriptor.audience !== descriptor.audience ||
      expectedDescriptor.purpose !== descriptor.purpose ||
      expectedDescriptor.goalId !== association.goalId ||
      expectedDescriptor.scopeId !== association.historyScopeId
    )
      hold("preparation declaration descriptor differs from its index scope");
    const coreKeys = [
      "descriptor",
      "ledgerId",
      "epoch",
      "operationId",
      "kind",
      "payload",
      "previousRecordDigest",
      "acceptedAt",
    ];
    const cacheKey = rrsiCanonical(expectedDescriptor);
    if (!historyCache.has(cacheKey)) {
      const declarations = new Map();
      const operations = new Set();
      let previous = null;
      for (const item of events) {
        if (
          item.type !== RRSI_HISTORY_EVENT_TYPE ||
          item.tenantId !== descriptor.tenantId ||
          item.skillName !== association.goalId
        )
          continue;
        if (
          declarations.size >= 5000 ||
          item.schema !== EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA ||
          item.artifactTenantId !== descriptor.artifactTenantId ||
          item.correlationId !== association.historyScopeId ||
          item.decision !== "accepted"
        )
          hold("preparation declaration chain event scope differs");
        const candidate = resolve(
          item.subjectRef,
          "rrsi-history-event",
          snapshotRrsiData,
        );
        rrsiId(candidate.operationId, "History declaration operation ID");
        if (operations.has(candidate.operationId))
          hold("History declaration has duplicate operations");
        operations.add(candidate.operationId);
        const rebuilt = rrsiEnvelope(
          RRSI_HISTORY_EVENT_SCHEMA,
          "recordDigest",
          Object.fromEntries(coreKeys.map((key) => [key, candidate[key]])),
        );
        const scopeDigest = rrsiHash(
          "chainlesschain.rrsi-history-descriptor/v1",
          expectedDescriptor,
        );
        const expectedId = `rrsi.${rrsiHash("chainlesschain.rrsi-history-operation/v1", { scopeDigest, operationId: candidate.operationId }).slice(7)}`;
        if (
          !same(candidate, rebuilt) ||
          !same(candidate.descriptor, expectedDescriptor) ||
          candidate.previousRecordDigest !== previous ||
          candidate.ledgerId !== originalIdentity.ledgerId ||
          candidate.epoch !== originalIdentity.epoch ||
          candidate.acceptedAt !== item.timestamp ||
          item.eventId !== expectedId
        )
          hold(
            "preparation declaration envelope, predecessor or original event differs",
          );
        declarations.set(item.sequence, candidate);
        previous = candidate.recordDigest;
      }
      historyCache.set(cacheKey, declarations);
    }
    const record = historyCache.get(cacheKey).get(registration.sequence);
    if (
      !record ||
      event.sourceRefs.length !== 0 ||
      record.recordDigest !== registration.recordDigest ||
      record.ledgerId !== originalIdentity.ledgerId ||
      record.epoch !== originalIdentity.epoch ||
      record.kind !== "reserve-preparation" ||
      record.payload.executionId !== association.executionId ||
      record.payload.phase !== "candidate-proposal" ||
      record.payload.campaignDigest !== association.campaignDigest
    )
      hold("preparation declaration reference differs");
  }
  function load() {
    const before = head(methods.verify());
    if (!same(identity(before), originalIdentity))
      hold("text index journal identity changed");
    const events = methods.read({
      afterSequence: 0,
      limit: EVOLUTION_LEDGER_MAX_EVENTS,
    });
    if (
      events.length !== before.sequence ||
      events.some((event, index) => event.sequence !== index + 1) ||
      (events.at(-1)?.eventDigest ?? null) !== before.headDigest
    )
      hold("text index requires complete contiguous journal history");
    const historyCache = new Map();
    const records = [],
      entries = new Map(),
      operations = new Map();
    for (const event of events) {
      if (event.type !== RRSI_OBSERVED_TEXT_EVENT_TYPE) continue;
      if (
        records.length >= MAX_RECORDS ||
        event.schema !== EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA ||
        event.tenantId !== descriptor.tenantId ||
        event.artifactTenantId !== descriptor.artifactTenantId ||
        event.correlationId !== descriptor.indexId ||
        event.skillName !== null ||
        event.decision !== "quarantined"
      )
        hold("text restriction history scope or capacity differs");
      const record = resolve(event.subjectRef, EVENT_TYPE, validateRecord);
      const operationId = `rrsi-text.${rrsiHash(RECORD_SCHEMA, { skillTextDigest: record.skillTextDigest, association: record.association, restrictions: record.restrictions }).slice(7)}`;
      if (
        record.ordinal !== records.length + 1 ||
        record.previousRecordDigest !==
          (records.at(-1)?.record.recordDigest ?? null) ||
        !same(record.observedHead, {
          ...originalIdentity,
          sequence: event.sequence - 1,
          headDigest: event.prevDigest,
        }) ||
        event.eventId !== operationId ||
        operations.has(operationId) ||
        !same(
          event.sourceRefs.map(ref),
          sortedRefs([
            record.manifestRef,
            record.association.registrationRecord.ref,
            ...(records.length ? [records.at(-1).ref] : []),
          ]),
        )
      )
        hold("text restriction chain, operation or original head differs");
      verifyAssociation(
        record.association,
        events,
        event.sequence,
        historyCache,
      );
      const text = readBytes(record.manifestRef, record.skillTextDigest);
      const previous = entries.get(record.skillTextDigest);
      if (previous && previous.text !== text)
        hold("same text digest has conflicting retained bytes");
      entries.set(record.skillTextDigest, {
        text,
        manifestRef: record.manifestRef,
        restrictions: [
          ...new Set([
            ...(previous?.restrictions ?? []),
            ...record.restrictions,
          ]),
        ].sort(),
        associations: [...(previous?.associations ?? []), record.association],
        recordDigest: record.recordDigest,
      });
      const retained = {
        record,
        ref: ref(event.subjectRef),
        eventSequence: event.sequence,
      };
      records.push(retained);
      operations.set(operationId, retained);
    }
    if (!same(before, head(methods.verify())))
      hold("text index journal changed during authenticated readback");
    return { head: before, events, records, entries, operations };
  }
  function historyPrefix(state, checkpoint) {
    rrsiExact(
      checkpoint,
      ["ledgerId", "identityDigest", "epoch", "sequence", "headDigest"],
      "observed history checkpoint",
    );
    rrsiInteger(
      checkpoint.sequence,
      "observed history sequence",
      1,
      state.head.sequence,
    );
    rrsiDigest(checkpoint.headDigest, "observed history event head digest");
    if (
      !same(identity(checkpoint), originalIdentity) ||
      state.events[checkpoint.sequence - 1].eventDigest !==
        checkpoint.headDigest
    )
      hold("observed history checkpoint is not the original journal prefix");
    const records = state.records.filter(
      (entry) => entry.eventSequence <= checkpoint.sequence,
    );
    const entries = new Map();
    for (const { record } of records)
      entries.set(
        record.skillTextDigest,
        [
          ...new Set([
            ...(entries.get(record.skillTextDigest) ?? []),
            ...record.restrictions,
          ]),
        ].sort(),
      );
    const sorted = [...entries]
      .sort(([a], [b]) => (a === b ? 0 : a < b ? -1 : 1))
      .map(([skillTextDigest, codes]) => ({
        skillTextDigest,
        restrictions: codes,
      }));
    return freezeRrsiData({
      checkpoint,
      restrictionHistory: {
        recordCount: records.length,
        tailRecordDigest: records.at(-1)?.record.recordDigest ?? null,
        restrictionsDigest: rrsiHash(
          "chainlesschain.rrsi-observed-text-restriction-set/v1",
          sorted,
        ),
      },
    });
  }
  function captureHistoryCheckpoints(input) {
    const request = snapshotRrsiData(input);
    rrsiExact(request, ["checkpoints"], "observed history checkpoint request");
    if (!Array.isArray(request.checkpoints) || request.checkpoints.length > 2)
      hold("observed history requires at most two checkpoints");
    const state = load();
    // Anchor v1 cannot represent the genuine null digest at sequence zero.
    // Fresh v2 migration events are included in this nonempty event prefix.
    const current = historyPrefix(state, state.head);
    const prefixes = request.checkpoints.map((checkpoint) =>
      historyPrefix(state, checkpoint),
    );
    const snapshot = rrsiEnvelope(
      "chainlesschain.rrsi-observed-text-history-snapshot/v1",
      "historySnapshotDigest",
      {
        tenantId: descriptor.tenantId,
        indexId: descriptor.indexId,
        ledgerIdentity: originalIdentity,
        artifactScope: {
          artifactTenantId: descriptor.artifactTenantId,
          audience: descriptor.audience,
          purpose: descriptor.purpose,
        },
        indexDescriptorDigest: rrsiHash(
          "chainlesschain.rrsi-observed-text-index-descriptor/v1",
          descriptor,
        ),
        localCompositionDigest: rrsiHash(
          "chainlesschain.rrsi-observed-text-local-composition/v1",
          {
            indexDescriptor: descriptor,
            policyDescriptor: policy.descriptor,
            backendDescriptor: backend.descriptor,
          },
        ),
        current,
        prefixes,
        localRetainedHistoryReplayed: true,
        fullPhysicalStorageGraphVerified: false,
        tenantWideIndexAuthorityVerified: false,
        generationProvenanceVerified: false,
        grantsMutationOrPromotionAuthority: false,
        decision: "HOLD",
      },
    );
    const recheck = () =>
      guarded(() => {
        if (!same(state.head, head(methods.verify())))
          hold("observed history head changed after prefix capture");
        return true;
      });
    recheck();
    return Object.freeze({ snapshot, recheck });
  }
  function lookup(skillTextDigest) {
    rrsiDigest(skillTextDigest, "Skill text digest");
    const state = load();
    const entry = state.entries.get(skillTextDigest);
    if (!entry)
      hold("unknown Skill text has no authenticated restriction record");
    return { state, entry };
  }
  function readObservedText(skillTextDigest) {
    return lookup(skillTextDigest).entry.text;
  }
  function inspectRestrictions(skillTextDigest) {
    const { state, entry } = lookup(skillTextDigest);
    return freezeRrsiData({
      skillTextDigest,
      manifestRef: entry.manifestRef,
      restrictions: entry.restrictions,
      associations: entry.associations,
      recordDigest: entry.recordDigest,
      currentHead: state.head,
      observedBytesAuthenticated: true,
      observationBoundary: descriptor.observationBoundary,
      preparationDeclarationRetained: true,
      generationProvenanceVerified: false,
      sourceDerivationVerified: false,
      tenantWideIndexAuthorityVerified: false,
      decision: "HOLD",
      readyForExecution: false,
      qualifiesForPromotion: false,
    });
  }
  function registerObservedSkillText(input) {
    const request = own(input, [
      "text",
      "historyAdapter",
      "preparationExecutionId",
      "restrictionCodes",
    ]);
    const bytes = encodeRrsiObservedSkillText(request.text);
    const codes = restrictions(request.restrictionCodes);
    rrsiId(request.preparationExecutionId, "preparation execution ID");
    const history = captureRrsiHistoryLedgerAdapter(request.historyAdapter);
    if (
      history.ledger !== ledger ||
      history.artifactPorts !== options.artifactPorts ||
      history.ledgerArtifactResolver !== options.ledgerArtifactResolver ||
      history.descriptor.tenantId !== descriptor.tenantId ||
      history.descriptor.artifactTenantId !== descriptor.artifactTenantId ||
      history.descriptor.audience !== descriptor.audience ||
      history.descriptor.purpose !== descriptor.purpose
    )
      hold("text observation requires the same original History storage graph");
    // Resolve History before taking the index/policy lock; no reversed lock nesting.
    const preparation = history.resolvePreparation(
      request.preparationExecutionId,
    );
    if (
      preparation.reservation.bindings.phase !== "candidate-proposal" ||
      !same(preparation.identity, originalIdentity)
    )
      hold(
        "text observation requires an original candidate-proposal preparation",
      );
    const association = snapshotRrsiData({
      historyScopeId: history.descriptor.scopeId,
      goalId: history.descriptor.goalId,
      campaignDigest: preparation.reservation.bindings.campaignDigest,
      executionId: request.preparationExecutionId,
      historyDescriptor: history.descriptor,
      registrationRecord: preparation.registrationRecord,
    });
    return policy.maintain((assertOwnership) => {
      const state = load();
      const assertCurrent = () => {
        assertOwnership();
        if (!same(state.head, head(methods.verify())))
          hold("text index head changed before artifact publication");
        assertOwnership();
      };
      const skillTextDigest = hashBytes(bytes);
      const operationId = `rrsi-text.${rrsiHash(RECORD_SCHEMA, { skillTextDigest, association, restrictions: codes }).slice(7)}`;
      verifyAssociation(association, state.events);
      if (state.operations.has(operationId))
        return inspectRestrictions(skillTextDigest);
      if (state.records.length >= MAX_RECORDS)
        hold("text restriction log reached its bounded capacity");
      const previous = state.entries.get(skillTextDigest);
      if (previous && !encodeRrsiObservedSkillText(previous.text).equals(bytes))
        hold("same Skill text digest conflicts with the observed bytes");
      const manifestRef = previous?.manifestRef ?? retain(bytes, assertCurrent);
      const record = rrsiEnvelope(RECORD_SCHEMA, "recordDigest", {
        descriptor,
        ordinal: state.records.length + 1,
        skillTextDigest,
        manifestRef,
        association,
        restrictions: codes,
        previousRecordDigest: state.records.at(-1)?.record.recordDigest ?? null,
        observedHead: state.head,
      });
      const reference = publish(
        EVENT_TYPE,
        record,
        assertCurrent,
        validateRecord,
      );
      if (!same(state.head, head(methods.verify())))
        hold("text index head changed before commit");
      assertOwnership();
      try {
        const receipt = methods.appendDomainEvent(
          {
            type: RRSI_OBSERVED_TEXT_EVENT_TYPE,
            eventId: operationId,
            tenantId: descriptor.tenantId,
            artifactTenantId: descriptor.artifactTenantId,
            correlationId: descriptor.indexId,
            skillName: null,
            decision: "quarantined",
            reason:
              "Retained text observation; generation and tenant-wide authority remain unverified",
            sourceRefs: [
              manifestRef,
              association.registrationRecord.ref,
              ...(state.records.length ? [state.records.at(-1).ref] : []),
            ],
            subjectRef: reference,
          },
          {
            expectedHeadDigest: state.head.headDigest,
            expectedSequence: state.head.sequence,
          },
        );
        if (receipt?.authenticated !== true || receipt.durable !== true)
          hold("text restriction commit receipt is uncertain");
      } catch (cause) {
        throw Object.assign(
          new Error(
            "text restriction commit is uncertain; re-read the original index",
            { cause },
          ),
          { code: "CC_RRSI_TEXT_COMMIT_UNKNOWN" },
        );
      }
      assertOwnership();
      const committed = load().operations.get(operationId);
      if (committed?.record.recordDigest !== record.recordDigest)
        hold("text restriction commit could not be read back exactly");
      return inspectRestrictions(skillTextDigest);
    });
  }
  // Reopen validates every retained declaration and chunk; an empty fresh
  // graph still gives unknown/HOLD and never a non-RRSI admission default.
  guarded(load);
  const index = Object.freeze({
    descriptor,
    registerObservedSkillText: (input) =>
      guarded(() => registerObservedSkillText(input)),
    readObservedText: (digest) => guarded(() => readObservedText(digest)),
    inspectRestrictions: (digest) => guarded(() => inspectRestrictions(digest)),
  });
  INDEXES.set(
    index,
    Object.freeze({
      descriptor,
      matchesPolicy: (value) => value === options.storePolicy,
      readObservedText: index.readObservedText,
      inspectRestrictions: index.inspectRestrictions,
      captureHistoryCheckpoints: (input) =>
        guarded(() => captureHistoryCheckpoints(input)),
    }),
  );
  return index;
}

export function captureRrsiObservedTextIndex(value) {
  const captured = INDEXES.get(value);
  if (!captured) hold("a genuine observed text index is required");
  return captured;
}
