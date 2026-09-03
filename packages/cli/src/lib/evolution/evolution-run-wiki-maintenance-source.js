import { types as utilTypes } from "node:util";

import evolutionRun from "@chainlesschain/session-core/evolution-run";

import { captureAgentEvolutionRuntimeComposition } from "./agent-evolution-runtime-composition-brand.js";
import {
  WIKI_MAINTENANCE_TRIGGER_KIND,
  WikiMaintenanceTriggerLedgerAdapter,
} from "./wiki-maintenance-trigger-ledger-adapter.js";

const { EVENT_TYPES } = evolutionRun;

export const EVOLUTION_RUN_WIKI_MAINTENANCE_SOURCE_SCHEMA =
  "chainlesschain.evolution-run-wiki-maintenance-source/v1";
export const EVOLUTION_RUN_WIKI_MAINTENANCE_PRODUCER_SCHEMA =
  "chainlesschain.evolution-run-wiki-maintenance-producer/v1";
export const EVOLUTION_RUN_WIKI_MAINTENANCE_SOURCE_INVALID_CODE =
  "CC_EVOLUTION_RUN_WIKI_MAINTENANCE_SOURCE_INVALID";

const SOURCES = new WeakSet();
const PRODUCERS = new WeakSet();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SUPPORTED_KINDS = new Set([
  WIKI_MAINTENANCE_TRIGGER_KIND.SESSION_END,
  WIKI_MAINTENANCE_TRIGGER_KIND.GOAL_END,
]);
const VERIFY_KEYS = new Set([
  "tenantId",
  "kind",
  "sourceId",
  "sourceReceiptDigest",
  "evidenceRefs",
  "effectiveAt",
]);
const BUILD_KEYS = new Set(["kind", "runId"]);

function failure(message, options) {
  const error = new Error(message, options);
  error.code = EVOLUTION_RUN_WIKI_MAINTENANCE_SOURCE_INVALID_CODE;
  return error;
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

function canonicalTimestamp(value, label) {
  requiredString(value, label);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw failure(`${label} must be a canonical timestamp`);
  }
  return value;
}

function captureCompositionResolver(value) {
  if (
    !value ||
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    typeof value.resolve !== "function"
  ) {
    throw new TypeError("runCompositionResolver.resolve is required");
  }
  const resolve = value.resolve.bind(value);
  Object.freeze(value);
  return resolve;
}

function captureSource(value) {
  if (!SOURCES.has(value)) {
    throw new TypeError(
      "a branded EvolutionRun Wiki maintenance source is required",
    );
  }
  return value;
}

function normalizeBuildInput(value) {
  assertExactRecord(value, BUILD_KEYS, "completed run trigger input");
  if (!SUPPORTED_KINDS.has(value.kind)) {
    throw failure(
      "completed EvolutionRun sources only support session-end and goal-end",
    );
  }
  return deepFreeze({
    kind: value.kind,
    runId: requiredString(value.runId, "runId"),
  });
}

function captureRun(resolveComposition, tenantId, runId) {
  let composition;
  try {
    composition = captureAgentEvolutionRuntimeComposition(
      resolveComposition(deepFreeze({ tenantId, runId })),
    );
  } catch (cause) {
    throw failure(
      "run resolver did not return a branded Agent evolution composition",
      { cause },
    );
  }
  if (
    composition.tenantId !== tenantId ||
    composition.runId !== runId ||
    typeof composition.loadRun !== "function"
  ) {
    throw failure(
      "run resolver did not return the exact tenant-scoped Agent evolution composition",
    );
  }
  return composition;
}

function projectTrigger(resolveComposition, tenantId, input) {
  const normalized = normalizeBuildInput(input);
  const composition = captureRun(
    resolveComposition,
    tenantId,
    normalized.runId,
  );
  const loaded = composition.loadRun();
  const events = loaded?.events;
  const projection = loaded?.projection;
  const completion = Array.isArray(events) ? events.at(-1) : null;
  if (
    !Array.isArray(events) ||
    events.length < 2 ||
    projection?.tenantId !== tenantId ||
    projection.runId !== normalized.runId ||
    projection.status !== "completed" ||
    !DIGEST.test(projection.projectionDigest ?? "") ||
    completion?.type !== EVENT_TYPES.RUN_COMPLETED ||
    completion.subjectId !== normalized.runId
  ) {
    throw failure("EvolutionRun is not durably completed");
  }
  const effectiveAt = canonicalTimestamp(
    completion.data?.occurredAt,
    "run completion occurredAt",
  );
  const evidenceEvents = events.filter(
    (event) => event.type === EVENT_TYPES.RAW_EVENT_REFERENCED,
  );
  const evidenceRefs = [
    ...new Set(
      evidenceEvents.map((event) =>
        requiredString(event.subjectId, "evidence subjectId"),
      ),
    ),
  ].sort();
  if (evidenceRefs.length === 0 || evidenceRefs.length > 256) {
    throw failure("completed EvolutionRun has no bounded evidence set");
  }
  if (
    normalized.kind === WIKI_MAINTENANCE_TRIGGER_KIND.GOAL_END &&
    !evidenceEvents.some((event) => event.data?.evidenceKind === "goal-ended")
  ) {
    throw failure(
      "goal-end trigger requires authenticated goal-ended evidence",
    );
  }
  return deepFreeze({
    kind: normalized.kind,
    sourceId: normalized.runId,
    sourceReceiptDigest: projection.projectionDigest,
    evidenceRefs,
    effectiveAt,
  });
}

export function createEvolutionRunWikiMaintenanceSource({
  tenantId: tenantInput,
  runCompositionResolver,
} = {}) {
  const tenantId = requiredString(tenantInput, "tenantId");
  const resolveComposition = captureCompositionResolver(runCompositionResolver);
  const source = {
    schema: EVOLUTION_RUN_WIKI_MAINTENANCE_SOURCE_SCHEMA,
    tenantId,
    build(input) {
      return projectTrigger(resolveComposition, tenantId, input);
    },
    async verify(input) {
      assertExactRecord(input, VERIFY_KEYS, "Wiki maintenance source request");
      if (input.tenantId !== tenantId) {
        throw failure("Wiki maintenance source belongs to another tenant");
      }
      const expected = projectTrigger(resolveComposition, tenantId, {
        kind: input.kind,
        runId: input.sourceId,
      });
      if (!same(input, { tenantId, ...expected })) {
        throw failure(
          "Wiki maintenance source no longer matches the durable EvolutionRun",
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

export function createEvolutionRunWikiMaintenanceProducer({
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
    schema: EVOLUTION_RUN_WIKI_MAINTENANCE_PRODUCER_SCHEMA,
    tenantId: source.tenantId,
    async enqueueCompletedRun(input) {
      return enqueue(source.build(input));
    },
  };
  PRODUCERS.add(producer);
  return Object.freeze(producer);
}

export function captureEvolutionRunWikiMaintenanceProducer(value) {
  if (!PRODUCERS.has(value)) {
    throw new TypeError(
      "a branded EvolutionRun Wiki maintenance producer is required",
    );
  }
  return value;
}
