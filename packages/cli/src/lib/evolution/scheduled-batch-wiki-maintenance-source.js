import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import { SchedulerStore } from "../scheduler-kernel/store.js";
import {
  WIKI_MAINTENANCE_TRIGGER_KIND,
  WikiMaintenanceTriggerLedgerAdapter,
} from "./wiki-maintenance-trigger-ledger-adapter.js";

export const SCHEDULED_BATCH_WIKI_MAINTENANCE_SOURCE_SCHEMA =
  "chainlesschain.scheduled-batch-wiki-maintenance-source/v1";
export const SCHEDULED_BATCH_WIKI_MAINTENANCE_PRODUCER_SCHEMA =
  "chainlesschain.scheduled-batch-wiki-maintenance-producer/v1";
export const SCHEDULED_BATCH_WIKI_MAINTENANCE_JOB_SCHEMA =
  "chainlesschain.scheduled-batch-wiki-maintenance-job/v1";
export const SCHEDULED_BATCH_WIKI_MAINTENANCE_RESULT_SCHEMA =
  "chainlesschain.scheduled-batch-wiki-maintenance-result/v1";
export const SCHEDULED_BATCH_WIKI_MAINTENANCE_INVALID_CODE =
  "CC_SCHEDULED_BATCH_WIKI_MAINTENANCE_INVALID";

const SOURCES = new WeakSet();
const PRODUCERS = new WeakSet();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const BUILD_KEYS = new Set(["occurrenceId"]);
const VERIFY_KEYS = new Set([
  "tenantId",
  "kind",
  "sourceId",
  "sourceReceiptDigest",
  "evidenceRefs",
  "effectiveAt",
]);
const JOB_PAYLOAD_KEYS = new Set([
  "schema",
  "tenantId",
  "evidenceSelectorDigest",
]);
const RESULT_KEYS = new Set([
  "schema",
  "tenantId",
  "evidenceRefs",
  "evidenceSetDigest",
]);
const AUTHORITY_RESULT_KEYS = new Set([
  "authenticated",
  "durable",
  "tenantId",
  "occurrenceId",
  "jobId",
  "jobRevision",
  "occurrenceDigest",
  "receiptDigest",
]);

function failure(message, options) {
  const error = new Error(message, options);
  error.code = SCHEDULED_BATCH_WIKI_MAINTENANCE_INVALID_CODE;
  return error;
}

function assertExactRecord(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw failure(`${label} must be a plain object`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== "string" || !keys.has(key))
  ) {
    throw failure(`${label} must contain exactly the supported fields`);
  }
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw failure(`${label}.${String(key)} must be an enumerable data field`);
    }
  }
}

function requiredString(value, label) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    Buffer.byteLength(value, "utf8") > 256
  ) {
    throw failure(`${label} is invalid`);
  }
  return value;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function same(left, right) {
  return canonical(left) === canonical(right);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function evidenceRefs(value) {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 256 ||
    value.some(
      (item) =>
        typeof item !== "string" ||
        item.trim() === "" ||
        Buffer.byteLength(item, "utf8") > 512,
    )
  ) {
    throw failure("scheduled batch evidenceRefs are invalid");
  }
  const normalized = [...new Set(value)].sort();
  if (normalized.length !== value.length) {
    throw failure("scheduled batch evidenceRefs must be unique");
  }
  return normalized;
}

function captureResolver(value) {
  if (
    !value ||
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    typeof value.resolve !== "function"
  ) {
    throw new TypeError("schedulerStoreResolver.resolve is required");
  }
  const resolve = value.resolve.bind(value);
  Object.freeze(value);
  return resolve;
}

function captureVerifier(value) {
  if (
    !value ||
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    typeof value.verify !== "function"
  ) {
    throw new TypeError("schedulerAuthorityVerifier.verify is required");
  }
  const verify = value.verify.bind(value);
  Object.freeze(value);
  return verify;
}

function captureSource(value) {
  if (!SOURCES.has(value)) {
    throw new TypeError(
      "a branded scheduled-batch Wiki maintenance source is required",
    );
  }
  return value;
}

function readBatch(resolveStore, tenantId, occurrenceIdInput) {
  const occurrenceId = requiredString(occurrenceIdInput, "occurrenceId");
  const store = resolveStore(deepFreeze({ tenantId, occurrenceId }));
  if (!(store instanceof SchedulerStore)) {
    throw failure("scheduler resolver did not return a SchedulerStore");
  }
  const occurrence = store.getOccurrence(occurrenceId);
  if (
    !occurrence ||
    occurrence.id !== occurrenceId ||
    occurrence.status !== "succeeded" ||
    occurrence.authority?.tenantId !== tenantId ||
    !Number.isSafeInteger(occurrence.jobRevision) ||
    occurrence.jobRevision < 1 ||
    !Number.isSafeInteger(occurrence.settledAt) ||
    occurrence.settledAt < occurrence.scheduledFor
  ) {
    throw failure("scheduler occurrence is not a settled tenant batch");
  }
  const job = store.getJob(occurrence.jobId);
  if (
    !job ||
    job.id !== occurrence.jobId ||
    job.revision !== occurrence.jobRevision ||
    job.authority?.tenantId !== tenantId
  ) {
    throw failure("scheduled batch job binding is stale or missing");
  }
  assertExactRecord(
    job.payload,
    JOB_PAYLOAD_KEYS,
    "scheduled batch job payload",
  );
  if (
    job.payload.schema !== SCHEDULED_BATCH_WIKI_MAINTENANCE_JOB_SCHEMA ||
    job.payload.tenantId !== tenantId ||
    !DIGEST.test(job.payload.evidenceSelectorDigest ?? "")
  ) {
    throw failure("scheduled batch job payload is not evolution-governed");
  }
  assertExactRecord(occurrence.result, RESULT_KEYS, "scheduled batch result");
  const refs = evidenceRefs(occurrence.result.evidenceRefs);
  if (
    occurrence.result.schema !==
      SCHEDULED_BATCH_WIKI_MAINTENANCE_RESULT_SCHEMA ||
    occurrence.result.tenantId !== tenantId ||
    occurrence.result.evidenceSetDigest !== digest(refs)
  ) {
    throw failure("scheduled batch result evidence binding is invalid");
  }
  const occurrenceDigest = digest({ job, occurrence });
  return deepFreeze({
    job,
    occurrence,
    occurrenceDigest,
    evidenceRefs: refs,
    effectiveAt: new Date(occurrence.settledAt).toISOString(),
  });
}

async function projectTrigger(
  resolveStore,
  verifyAuthority,
  tenantId,
  occurrenceId,
) {
  const batch = readBatch(resolveStore, tenantId, occurrenceId);
  const verified = await verifyAuthority(
    deepFreeze({
      tenantId,
      job: batch.job,
      occurrence: batch.occurrence,
      occurrenceDigest: batch.occurrenceDigest,
    }),
  );
  assertExactRecord(
    verified,
    AUTHORITY_RESULT_KEYS,
    "scheduler authority verification",
  );
  if (
    verified.authenticated !== true ||
    verified.durable !== true ||
    verified.tenantId !== tenantId ||
    verified.occurrenceId !== batch.occurrence.id ||
    verified.jobId !== batch.job.id ||
    verified.jobRevision !== batch.job.revision ||
    verified.occurrenceDigest !== batch.occurrenceDigest ||
    !DIGEST.test(verified.receiptDigest ?? "")
  ) {
    throw failure("scheduler authority did not authenticate the exact batch");
  }
  return deepFreeze({
    kind: WIKI_MAINTENANCE_TRIGGER_KIND.SCHEDULED_BATCH,
    sourceId: batch.occurrence.id,
    sourceReceiptDigest: verified.receiptDigest,
    evidenceRefs: batch.evidenceRefs,
    effectiveAt: batch.effectiveAt,
  });
}

export function createScheduledBatchWikiMaintenanceSource({
  tenantId: tenantInput,
  schedulerStoreResolver,
  schedulerAuthorityVerifier,
} = {}) {
  const tenantId = requiredString(tenantInput, "tenantId");
  const resolveStore = captureResolver(schedulerStoreResolver);
  const verifyAuthority = captureVerifier(schedulerAuthorityVerifier);
  const source = {
    schema: SCHEDULED_BATCH_WIKI_MAINTENANCE_SOURCE_SCHEMA,
    tenantId,
    async build(input) {
      assertExactRecord(input, BUILD_KEYS, "scheduled batch trigger input");
      return projectTrigger(
        resolveStore,
        verifyAuthority,
        tenantId,
        input.occurrenceId,
      );
    },
    async verify(input) {
      assertExactRecord(input, VERIFY_KEYS, "Wiki maintenance source request");
      if (
        input.tenantId !== tenantId ||
        input.kind !== WIKI_MAINTENANCE_TRIGGER_KIND.SCHEDULED_BATCH
      ) {
        throw failure("Wiki maintenance source is not this tenant batch");
      }
      const expected = await projectTrigger(
        resolveStore,
        verifyAuthority,
        tenantId,
        input.sourceId,
      );
      if (!same(input, { tenantId, ...expected })) {
        throw failure(
          "Wiki maintenance source no longer matches the durable scheduler batch",
        );
      }
      return deepFreeze({
        authenticated: true,
        durable: true,
        tenantId,
        kind: expected.kind,
        sourceId: expected.sourceId,
        receiptDigest: expected.sourceReceiptDigest,
        evidenceRefs: expected.evidenceRefs,
        effectiveAt: expected.effectiveAt,
      });
    },
  };
  SOURCES.add(source);
  return Object.freeze(source);
}

export function createScheduledBatchWikiMaintenanceProducer({
  source: sourceInput,
  triggerAdapter,
} = {}) {
  const source = captureSource(sourceInput);
  if (
    !(triggerAdapter instanceof WikiMaintenanceTriggerLedgerAdapter) ||
    triggerAdapter.descriptor?.tenantId !== source.tenantId
  ) {
    throw new TypeError(
      "a tenant-matched WikiMaintenanceTriggerLedgerAdapter is required",
    );
  }
  const enqueue = triggerAdapter.enqueue.bind(triggerAdapter);
  const producer = {
    schema: SCHEDULED_BATCH_WIKI_MAINTENANCE_PRODUCER_SCHEMA,
    tenantId: source.tenantId,
    async enqueueSettledBatch(input) {
      return enqueue(await source.build(input));
    },
  };
  PRODUCERS.add(producer);
  return Object.freeze(producer);
}

export function captureScheduledBatchWikiMaintenanceProducer(value) {
  if (!PRODUCERS.has(value)) {
    throw new TypeError(
      "a branded scheduled-batch Wiki maintenance producer is required",
    );
  }
  return value;
}
