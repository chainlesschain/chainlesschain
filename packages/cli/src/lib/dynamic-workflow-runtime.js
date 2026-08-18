import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { types as utilTypes } from "node:util";
import {
  COWORK_WORKFLOW_CONTROL_SIGNAL_CODE,
  executeWorkflow as executeCoworkWorkflow,
} from "./cowork-workflow.js";
import {
  ARTIFACT_KINDS,
  ArtifactStore,
  MAX_ARTIFACT_BYTES,
  publicArtifactMetadata,
} from "./artifact-store.js";
import { writeSecurityStore } from "./durable-security-store.js";
import {
  CACHE_READ_MULTIPLIER,
  CACHE_READ_MULTIPLIER_BY_PROVIDER,
  CACHE_WRITE_MULTIPLIER,
  FREE_PROVIDERS,
  lookupRate,
  PRICE_TABLE,
} from "./llm-pricing.js";
import { containsSecret } from "./secret-scan.js";
import {
  sameFileStatIdentity,
  samePathHandleFileIdentity,
  withTrustedFileParentSync,
} from "./secure-file-identity.js";
import { canonicalJson } from "./scheduler-kernel/contract.js";
import { withFileLock } from "./with-file-lock.js";

export const DYNAMIC_WORKFLOW_RUNTIME_SCHEMA = "cc-dynamic-workflow-runtime/v1";
export const DYNAMIC_WORKFLOW_RUNTIME_VERSION = 1;
export const DYNAMIC_WORKFLOW_EFFECT_SCHEMA = "cc-dynamic-workflow-effect/v1";
export const DYNAMIC_WORKFLOW_CALL_SCHEMA = "cc-dynamic-workflow-call/v1";
export const DYNAMIC_WORKFLOW_OBSERVABILITY_SCHEMA =
  "cc-dynamic-workflow-observability/v1";
export const DYNAMIC_WORKFLOW_RUNTIME_CONTROL_CODE =
  COWORK_WORKFLOW_CONTROL_SIGNAL_CODE;

const STATE_STATUSES = new Set([
  "ready",
  "running",
  "pause_requested",
  "paused",
  "blocked",
  "failed",
  "stopped",
  "completed",
]);
const TERMINAL_STATUSES = new Set(["stopped", "completed"]);
const SHA256_RE = /^sha256:[a-f0-9]{64}$/u;
const MAX_STATE_BYTES = 4 * 1024 * 1024;
const MAX_EFFECTS = 64;
const MAX_EFFECT_BATCH_SIZE = 64;
const MAX_LINEAGE_EVENTS = 4096;
const MAX_CALLS_PER_EFFECT = 128;
const MAX_PROJECTED_ARTIFACTS_PER_EFFECT = 256;
const MAX_PROVIDER_TOKEN_COUNT = 1_000_000_000;
const MAX_PROVIDER_USD_RATE_PER_MILLION = 1_000_000;
const MAX_PROVIDER_CACHE_RATE_MULTIPLIER = 100;
const PROVIDER_CLIENT_REQUEST_ID_RE = /^ccwf_[a-f0-9]{64}$/u;
const PROVIDER_RECEIPT_ID_RE = /^[A-Za-z0-9._:-]{1,256}$/u;
const PROVIDER_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const PROVIDER_MODEL_RE = /^[\x21-\x7e]{1,256}$/u;
const ARTIFACT_ID_RE = /^art_[a-z0-9]+_[a-f0-9]{8}$/u;
const ARTIFACT_SHA256_RE = /^[a-f0-9]{64}$/u;
const WORKFLOW_TOOL_CALL_ID_RE = /^[\x21-\x7e]{1,512}$/u;
const WORKFLOW_TOOL_NAME_RE = /^[A-Za-z0-9._:-]{1,256}$/u;
const WORKFLOW_CHILD_EFFECT_PROTOCOL = "cc-workflow-child-effect/v1";
const WORKFLOW_PROVIDER_ATTEMPT_PROTOCOL = "cc-provider-request-attempt/v1";
const WORKFLOW_PROVIDER_CALL_ID_RE = /^[A-Za-z0-9._:-]{1,256}$/u;
const WORKFLOW_PROVIDER_REQUEST_ID_RE = /^ccwf_[a-f0-9]{64}$/u;
const DESCENDANT_OWNER_TOOL_NAMES = new Set(["run_skill", "spawn_sub_agent"]);
const ARTIFACT_METADATA_FIELDS = Object.freeze([
  "id",
  "title",
  "kind",
  "mime",
  "size",
  "sha256",
  "file",
  "sessionId",
  "createdAt",
  "expiresAt",
  "immutable",
  "recordDigest",
]);
const WORKFLOW_CALL_STATUSES = new Set([
  "started",
  "completed",
  "failed",
  "outcome_unknown",
  "operator_reconciled",
]);
const SETTLEMENT_AUTHORITIES = new Set([
  "provider-return",
  "operator-reconciled",
  "runtime-not-dispatched",
]);

function digest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update(canonicalJson(value, "dynamicWorkflowRuntime"), "utf8")
    .digest("hex")}`;
}

function isoNow(now) {
  const raw = typeof now === "function" ? now() : now;
  const date = raw == null ? new Date() : new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError("dynamic workflow runtime time is invalid");
  }
  return date.toISOString();
}

function safeId(value, field, max = 256) {
  if (
    typeof value !== "string" ||
    !new RegExp(`^[A-Za-z0-9][A-Za-z0-9._-]{0,${max - 1}}$`, "u").test(value) ||
    value.includes("..")
  ) {
    throw new TypeError(`${field} is invalid`);
  }
  return value;
}

function snapshotJson(value, field, maxBytes = MAX_STATE_BYTES) {
  let encoded;
  try {
    encoded = canonicalJson(value, field);
  } catch {
    throw new TypeError(`${field} must contain canonical JSON`);
  }
  if (Buffer.byteLength(encoded, "utf8") > maxBytes) {
    throw new TypeError(`${field} exceeds its byte limit`);
  }
  return JSON.parse(encoded);
}

function nonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function providerUsageDigest(usage) {
  return digest(
    "chainlesschain.dynamic-workflow.provider-token-usage.v1\0",
    usage,
  );
}

function validProviderUsage(value) {
  const fields =
    value && typeof value === "object" ? Object.keys(value).sort() : [];
  return (
    fields.length === 6 &&
    [
      "cacheCreationInputTokens",
      "cacheReadInputTokens",
      "inputTokens",
      "outputTokens",
      "schema",
      "totalTokens",
    ].every((field, index) => fields[index] === field) &&
    value?.schema === "cc-provider-token-usage/v1" &&
    nonNegativeSafeInteger(value.inputTokens) !== null &&
    nonNegativeSafeInteger(value.outputTokens) !== null &&
    nonNegativeSafeInteger(value.cacheReadInputTokens) !== null &&
    nonNegativeSafeInteger(value.cacheCreationInputTokens) !== null &&
    nonNegativeSafeInteger(value.totalTokens) !== null &&
    value.inputTokens <= MAX_PROVIDER_TOKEN_COUNT &&
    value.outputTokens <= MAX_PROVIDER_TOKEN_COUNT &&
    value.cacheReadInputTokens <= MAX_PROVIDER_TOKEN_COUNT &&
    value.cacheCreationInputTokens <= MAX_PROVIDER_TOKEN_COUNT &&
    value.totalTokens ===
      value.inputTokens +
        value.outputTokens +
        value.cacheReadInputTokens +
        value.cacheCreationInputTokens
  );
}

function exactObjectFields(value, expected) {
  const fields =
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value).sort()
      : [];
  const sortedExpected = [...expected].sort();
  return (
    fields.length === sortedExpected.length &&
    sortedExpected.every((field, index) => fields[index] === field)
  );
}

function nonNegativeFinite(value, max = Number.MAX_VALUE) {
  return Number.isFinite(value) && value >= 0 && value <= max;
}

function providerPricingDigest(pricing) {
  return digest(
    "chainlesschain.dynamic-workflow.provider-pricing-snapshot.v1\0",
    pricing,
  );
}

function providerCostEstimateDigest(cost) {
  return digest(
    "chainlesschain.dynamic-workflow.provider-cost-estimate.v1\0",
    cost,
  );
}

function providerPricingCatalogDigest() {
  return digest(
    "chainlesschain.dynamic-workflow.provider-pricing-catalog.v1\0",
    {
      freeProviders: FREE_PROVIDERS,
      priceTable: PRICE_TABLE,
      cacheReadMultiplier: CACHE_READ_MULTIPLIER,
      cacheReadMultiplierByProvider: CACHE_READ_MULTIPLIER_BY_PROVIDER,
      cacheCreationMultiplier: CACHE_WRITE_MULTIPLIER,
    },
  );
}

function providerPricingSnapshot(provider, model) {
  const rate = lookupRate(provider, model);
  if (!rate) return null;
  const cacheReadMultiplier =
    CACHE_READ_MULTIPLIER_BY_PROVIDER[provider] ?? CACHE_READ_MULTIPLIER;
  return {
    schema: "cc-provider-pricing-snapshot/v1",
    currency: "USD",
    authority: "builtin-public-list-estimate",
    provider,
    model,
    pattern: rate.pattern,
    inputUsdPerMillion: rate.in,
    outputUsdPerMillion: rate.out,
    cacheReadMultiplier,
    cacheCreationMultiplier: CACHE_WRITE_MULTIPLIER,
    free: rate.pattern === "free",
    catalogDigest: providerPricingCatalogDigest(),
  };
}

function validProviderPricing(value, provider, model) {
  return (
    exactObjectFields(value, [
      "schema",
      "currency",
      "authority",
      "provider",
      "model",
      "pattern",
      "inputUsdPerMillion",
      "outputUsdPerMillion",
      "cacheReadMultiplier",
      "cacheCreationMultiplier",
      "free",
      "catalogDigest",
    ]) &&
    value.schema === "cc-provider-pricing-snapshot/v1" &&
    value.currency === "USD" &&
    value.authority === "builtin-public-list-estimate" &&
    value.provider === provider &&
    value.model === model &&
    typeof value.pattern === "string" &&
    /^[A-Za-z0-9._:-]{1,128}$/u.test(value.pattern) &&
    nonNegativeFinite(
      value.inputUsdPerMillion,
      MAX_PROVIDER_USD_RATE_PER_MILLION,
    ) &&
    nonNegativeFinite(
      value.outputUsdPerMillion,
      MAX_PROVIDER_USD_RATE_PER_MILLION,
    ) &&
    nonNegativeFinite(
      value.cacheReadMultiplier,
      MAX_PROVIDER_CACHE_RATE_MULTIPLIER,
    ) &&
    nonNegativeFinite(
      value.cacheCreationMultiplier,
      MAX_PROVIDER_CACHE_RATE_MULTIPLIER,
    ) &&
    typeof value.free === "boolean" &&
    value.free ===
      (value.inputUsdPerMillion === 0 && value.outputUsdPerMillion === 0) &&
    SHA256_RE.test(value.catalogDigest || "")
  );
}

function estimateProviderCost(pricing, usage) {
  if (!pricing || !usage) return null;
  const inputUsd = (usage.inputTokens / 1_000_000) * pricing.inputUsdPerMillion;
  const outputUsd =
    (usage.outputTokens / 1_000_000) * pricing.outputUsdPerMillion;
  const cacheReadUsd =
    (usage.cacheReadInputTokens / 1_000_000) *
    pricing.inputUsdPerMillion *
    pricing.cacheReadMultiplier;
  const cacheCreationUsd =
    (usage.cacheCreationInputTokens / 1_000_000) *
    pricing.inputUsdPerMillion *
    pricing.cacheCreationMultiplier;
  return {
    schema: "cc-provider-cost-estimate/v1",
    currency: "USD",
    authority: "durable-pricing-snapshot-estimate",
    inputUsd,
    outputUsd,
    cacheReadUsd,
    cacheCreationUsd,
    totalUsd: inputUsd + outputUsd + cacheReadUsd + cacheCreationUsd,
    pricingDigest: providerPricingDigest(pricing),
  };
}

function validProviderCostEstimate(value, pricing, usage) {
  if (
    !exactObjectFields(value, [
      "schema",
      "currency",
      "authority",
      "inputUsd",
      "outputUsd",
      "cacheReadUsd",
      "cacheCreationUsd",
      "totalUsd",
      "pricingDigest",
    ]) ||
    value.schema !== "cc-provider-cost-estimate/v1" ||
    value.currency !== "USD" ||
    value.authority !== "durable-pricing-snapshot-estimate" ||
    ![
      value.inputUsd,
      value.outputUsd,
      value.cacheReadUsd,
      value.cacheCreationUsd,
      value.totalUsd,
    ].every((amount) => nonNegativeFinite(amount)) ||
    value.pricingDigest !== providerPricingDigest(pricing)
  ) {
    return false;
  }
  const expected = estimateProviderCost(pricing, usage);
  return (
    canonicalJson(value, "providerCostEstimate") ===
    canonicalJson(expected, "providerCostEstimate")
  );
}

function strictDataObjectSnapshot(value, fields, field, maxBytes = 64 * 1024) {
  let descriptors;
  try {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      utilTypes.isProxy(value)
    ) {
      throw new TypeError(`${field} must be a plain data object`);
    }
    descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== fields.length ||
      keys.some((key) => typeof key !== "string") ||
      fields.some(
        (name) =>
          !Object.hasOwn(descriptors, name) ||
          !Object.hasOwn(descriptors[name], "value"),
      )
    ) {
      throw new TypeError(`${field} has an invalid field set`);
    }
  } catch (cause) {
    if (cause instanceof TypeError && cause.message.startsWith(field)) {
      throw cause;
    }
    throw new TypeError(`${field} must be a plain data object`);
  }
  return snapshotJson(
    Object.fromEntries(fields.map((name) => [name, descriptors[name].value])),
    field,
    maxBytes,
  );
}

function validArtifactMetadata(value) {
  if (!exactObjectFields(value, ARTIFACT_METADATA_FIELDS)) return false;
  let timestampsValid = false;
  try {
    timestampsValid =
      isoNow(value.createdAt) === value.createdAt &&
      isoNow(value.expiresAt) === value.expiresAt &&
      Date.parse(value.expiresAt) >= Date.parse(value.createdAt);
  } catch {
    timestampsValid = false;
  }
  return (
    ARTIFACT_ID_RE.test(value.id || "") &&
    typeof value.title === "string" &&
    value.title.length >= 1 &&
    value.title.length <= 1024 &&
    !value.title.includes("\0") &&
    ARTIFACT_KINDS.includes(value.kind) &&
    typeof value.mime === "string" &&
    /^[\x21-\x7e]{1,256}$/u.test(value.mime) &&
    Number.isSafeInteger(value.size) &&
    value.size >= 0 &&
    value.size <= MAX_ARTIFACT_BYTES &&
    ARTIFACT_SHA256_RE.test(value.sha256 || "") &&
    typeof value.file === "string" &&
    value.file.length >= 1 &&
    value.file.length <= 512 &&
    path.basename(value.file) === value.file &&
    !/[\\/\0-\x1f\x7f]/u.test(value.file) &&
    (value.sessionId === null ||
      (typeof value.sessionId === "string" &&
        value.sessionId.length >= 1 &&
        value.sessionId.length <= 256)) &&
    timestampsValid &&
    typeof value.immutable === "boolean" &&
    (value.recordDigest === null || SHA256_RE.test(value.recordDigest || ""))
  );
}

function artifactMetadataDigest(metadata) {
  return digest(
    "chainlesschain.dynamic-workflow.artifact-store-metadata.v1\0",
    metadata,
  );
}

function artifactReadbackDigest(readback) {
  return digest(
    "chainlesschain.dynamic-workflow.artifact-store-readback.v1\0",
    readback,
  );
}

function validArtifactReadback(value) {
  return (
    exactObjectFields(value, [
      "schema",
      "authority",
      "metadata",
      "metadataDigest",
      "contentDigest",
    ]) &&
    value.schema === "cc-dynamic-workflow-artifact-readback/v1" &&
    value.authority === "artifact-store-index-and-bytes-at-settlement" &&
    validArtifactMetadata(value.metadata) &&
    value.metadataDigest === artifactMetadataDigest(value.metadata) &&
    value.contentDigest === `sha256:${value.metadata.sha256}`
  );
}

function artifactReadbackSettlement(event, artifactStore) {
  const supplied = strictDataObjectSnapshot(
    ownDataValue(event?.result, "published"),
    ARTIFACT_METADATA_FIELDS,
    "workflow published artifact metadata",
  );
  if (!validArtifactMetadata(supplied)) {
    throw new TypeError("workflow published artifact metadata is malformed");
  }
  if (containsSecret(JSON.stringify(supplied))) {
    throw new TypeError(
      "workflow published artifact metadata contains secret-shaped data",
    );
  }
  if (
    !artifactStore ||
    typeof artifactStore.get !== "function" ||
    typeof artifactStore.verifyIntegrity !== "function"
  ) {
    throw new TypeError("workflow artifact store readback is unavailable");
  }
  let stored;
  let integrity;
  try {
    stored = artifactStore.get(supplied.id);
    integrity = stored ? artifactStore.verifyIntegrity(stored) : null;
  } catch {
    throw new TypeError("workflow artifact store readback failed");
  }
  if (!stored || !integrity?.ok) {
    throw new TypeError(
      "workflow artifact store bytes are unavailable or invalid",
    );
  }
  const canonical = strictDataObjectSnapshot(
    publicArtifactMetadata(stored),
    ARTIFACT_METADATA_FIELDS,
    "workflow artifact store metadata",
  );
  if (
    !validArtifactMetadata(canonical) ||
    canonicalJson(canonical, "workflowArtifactMetadata") !==
      canonicalJson(supplied, "workflowArtifactMetadata") ||
    integrity.expectedSha256 !== supplied.sha256 ||
    integrity.actualSha256 !== supplied.sha256
  ) {
    throw new TypeError(
      "workflow artifact store readback does not match settlement",
    );
  }
  return {
    schema: "cc-dynamic-workflow-artifact-readback/v1",
    authority: "artifact-store-index-and-bytes-at-settlement",
    metadata: canonical,
    metadataDigest: artifactMetadataDigest(canonical),
    contentDigest: `sha256:${integrity.actualSha256}`,
  };
}

function effectResultDigest(result) {
  return digest("chainlesschain.dynamic-workflow.effect-result.v1\0", result);
}

function effectBatchId(runId, effects) {
  return digest("chainlesschain.dynamic-workflow.effect-batch.v1\0", {
    runId,
    effects: effects.map((effect) => ({
      key: effect.key,
      payloadDigest: effect.payloadDigest,
    })),
  });
}

function hasProviderDispatchMetadata(effect) {
  return [
    effect?.providerDispatchedAt,
    effect?.timeoutMs,
    effect?.timeoutObservedAt,
  ].some((field) => field !== undefined);
}

function isKnownUndispatched(effect) {
  return (
    hasProviderDispatchMetadata(effect) && effect?.providerDispatchedAt === null
  );
}

function stateMaterial(state) {
  const material = { ...state };
  delete material.stateDigest;
  return material;
}

function finalizeState(state) {
  const material = snapshotJson(stateMaterial(state), "workflow runtime state");
  return Object.freeze({
    ...material,
    stateDigest: digest(
      "chainlesschain.dynamic-workflow.runtime-state.v1\0",
      material,
    ),
  });
}

function appendLineage(state, type, details, now) {
  if (state.lineage.length >= MAX_LINEAGE_EVENTS) {
    throw new Error("dynamic workflow runtime lineage limit exceeded");
  }
  const at = isoNow(now);
  const previousDigest = state.lineage.at(-1)?.eventDigest || null;
  state.revision += 1;
  state.updatedAt = at;
  const material = {
    sequence: state.lineage.length + 1,
    revision: state.revision,
    at,
    type,
    details: snapshotJson(details || {}, "workflow runtime event", 64 * 1024),
    previousDigest,
  };
  state.lineage.push({
    ...material,
    eventDigest: digest(
      "chainlesschain.dynamic-workflow.runtime-event.v1\0",
      material,
    ),
  });
}

function transition(snapshot, type, details, mutate, now) {
  const state = snapshotJson(
    stateMaterial(snapshot),
    "workflow runtime transition",
  );
  mutate(state);
  appendLineage(state, type, details, now);
  return finalizeState(state);
}

function verifyLineage(state, issues) {
  if (
    !Array.isArray(state.lineage) ||
    state.lineage.length > MAX_LINEAGE_EVENTS
  ) {
    issues.push("lineage-invalid");
    return;
  }
  let previousDigest = null;
  for (const [index, event] of state.lineage.entries()) {
    const material = {
      sequence: event?.sequence,
      revision: event?.revision,
      at: event?.at,
      type: event?.type,
      details: event?.details,
      previousDigest: event?.previousDigest,
    };
    const expected = digest(
      "chainlesschain.dynamic-workflow.runtime-event.v1\0",
      material,
    );
    if (
      event?.sequence !== index + 1 ||
      event?.revision !== index + 1 ||
      event?.previousDigest !== previousDigest ||
      event?.eventDigest !== expected ||
      isoNow(event?.at) !== event.at
    ) {
      issues.push(`lineage-${index}-invalid`);
    }
    previousDigest = event?.eventDigest || null;
  }
}

function workflowCallId(
  effectId,
  kind,
  callId,
  childEffectId = null,
  ownerEffectId = null,
) {
  const material = {
    effectId,
    kind,
    callId,
    childEffectId,
  };
  if (ownerEffectId !== null) material.ownerEffectId = ownerEffectId;
  return digest("chainlesschain.dynamic-workflow.call-id.v1\0", material);
}

function expectedWorkflowProviderRequestId(effectId, source, sequence) {
  return `ccwf_${createHash("sha256")
    .update(`${effectId}\0${source}\0${String(sequence)}`, "utf8")
    .digest("hex")}`;
}

function verifyEffectCalls(
  effect,
  effectIndex,
  issues,
  startedLineageByCallId,
  receiptLineageByCallId,
  settlementLineageByCallId,
) {
  const calls = effect?.calls === undefined ? [] : effect.calls;
  if (!Array.isArray(calls) || calls.length > MAX_CALLS_PER_EFFECT) {
    issues.push(`effect-${effectIndex}-calls-invalid`);
    return;
  }
  const ids = new Set();
  const identities = new Set();
  const authorizedOwnerEffectIds = new Set([effect.id]);
  for (const [callIndex, call] of calls.entries()) {
    const legacyOwner = call?.ownerEffectId === undefined;
    const ownerEffectId = legacyOwner ? effect.id : call?.ownerEffectId;
    const requestSource =
      call?.requestSource === undefined
        ? call?.kind === "provider"
          ? call?.source
          : null
        : call.requestSource;
    const startedLineage = startedLineageByCallId.get(call?.id) || [];
    const receiptLineage = receiptLineageByCallId.get(call?.id) || [];
    const settlementLineage = settlementLineageByCallId.get(call?.id) || [];
    const receiptLineageValid =
      receiptLineage.length === 1 &&
      receiptLineage[0]?.details?.effectId === effect.id &&
      receiptLineage[0]?.details?.ownerEffectId === ownerEffectId &&
      receiptLineage[0]?.details?.callRecordId === call?.id;
    const hasReceiptTimestamp = Object.prototype.hasOwnProperty.call(
      call || {},
      "providerReceiptRecordedAt",
    );
    const hasProviderUsage = Object.prototype.hasOwnProperty.call(
      call || {},
      "providerUsage",
    );
    const settlementUsageDigestPresent = settlementLineage.some((event) =>
      Object.prototype.hasOwnProperty.call(
        event?.details || {},
        "providerUsageDigest",
      ),
    );
    const providerCostFields = [
      "providerModel",
      "providerPricing",
      "providerCostEstimate",
    ];
    const providerCostFieldCount = providerCostFields.filter((field) =>
      Object.prototype.hasOwnProperty.call(call || {}, field),
    ).length;
    const hasProviderCostSchema =
      providerCostFieldCount === providerCostFields.length;
    const startedPricingFieldsPresent = startedLineage.some(
      (event) =>
        Object.prototype.hasOwnProperty.call(
          event?.details || {},
          "providerModel",
        ) ||
        Object.prototype.hasOwnProperty.call(
          event?.details || {},
          "providerPricingDigest",
        ),
    );
    const settlementCostDigestPresent = settlementLineage.some((event) =>
      Object.prototype.hasOwnProperty.call(
        event?.details || {},
        "providerCostEstimateDigest",
      ),
    );
    const hasArtifactReadback = Object.prototype.hasOwnProperty.call(
      call || {},
      "artifactReadback",
    );
    const startedArtifactSchemaPresent = startedLineage.some((event) =>
      Object.prototype.hasOwnProperty.call(
        event?.details || {},
        "artifactReadbackSchema",
      ),
    );
    const settlementArtifactDigestPresent = settlementLineage.some((event) =>
      Object.prototype.hasOwnProperty.call(
        event?.details || {},
        "artifactReadbackDigest",
      ),
    );
    const terminal = call?.status !== "started";
    const identityKey = `${call?.kind || ""}\0${
      call?.kind === "tool" ? call?.childEffectId : call?.callId
    }`;
    let timestampsValid = false;
    let receiptTimestampValid = false;
    try {
      timestampsValid =
        isoNow(call?.startedAt) === call.startedAt &&
        Date.parse(call.startedAt) >= Date.parse(effect.requestedAt) &&
        (terminal
          ? isoNow(call?.settledAt) === call.settledAt &&
            Date.parse(call.settledAt) >= Date.parse(call.startedAt) &&
            (effect.settledAt === null ||
              Date.parse(call.settledAt) <= Date.parse(effect.settledAt))
          : call?.settledAt === null);
      receiptTimestampValid = call?.providerReceiptPersisted
        ? receiptLineageValid
          ? hasReceiptTimestamp &&
            isoNow(call.providerReceiptRecordedAt) ===
              call.providerReceiptRecordedAt &&
            Date.parse(call.providerReceiptRecordedAt) >=
              Date.parse(call.startedAt) &&
            (!terminal ||
              Date.parse(call.providerReceiptRecordedAt) <=
                Date.parse(call.settledAt))
          : receiptLineage.length === 0 && !hasReceiptTimestamp && terminal
        : receiptLineage.length === 0 &&
          (call?.providerReceiptRecordedAt === null || !hasReceiptTimestamp);
    } catch {
      timestampsValid = false;
      receiptTimestampValid = false;
    }
    const commonValid =
      call?.schema === DYNAMIC_WORKFLOW_CALL_SCHEMA &&
      call.effectId === effect.id &&
      SHA256_RE.test(call.id || "") &&
      call.id ===
        workflowCallId(
          effect.id,
          call.kind,
          call.callId,
          call.childEffectId,
          legacyOwner ? null : ownerEffectId,
        ) &&
      SHA256_RE.test(ownerEffectId || "") &&
      authorizedOwnerEffectIds.has(ownerEffectId) &&
      ["provider", "tool"].includes(call.kind) &&
      WORKFLOW_CALL_STATUSES.has(call.status) &&
      Number.isSafeInteger(call.sequence) &&
      call.sequence >= 1 &&
      typeof call.name === "string" &&
      call.name.length >= 1 &&
      call.name.length <= 256 &&
      typeof call.source === "string" &&
      call.source.length >= 1 &&
      call.source.length <= 64 &&
      typeof call.identitySemantics === "string" &&
      call.identitySemantics.length >= 1 &&
      call.identitySemantics.length <= 64 &&
      (call.settlementCode === null ||
        (typeof call.settlementCode === "string" &&
          call.settlementCode.length >= 1 &&
          call.settlementCode.length <= 128)) &&
      typeof call.outcomeUnknown === "boolean" &&
      call.outcomeUnknown === (call.status === "outcome_unknown") &&
      typeof call.providerReceiptPersisted === "boolean" &&
      (call.providerReceiptRequestId === null ||
        (typeof call.providerReceiptRequestId === "string" &&
          PROVIDER_RECEIPT_ID_RE.test(call.providerReceiptRequestId))) &&
      (call.providerReceiptResponseId === null ||
        (typeof call.providerReceiptResponseId === "string" &&
          PROVIDER_RECEIPT_ID_RE.test(call.providerReceiptResponseId))) &&
      call.providerReceiptPersisted ===
        Boolean(
          call.providerReceiptRequestId || call.providerReceiptResponseId,
        ) &&
      receiptTimestampValid &&
      (call.mcpLedgerId === null ||
        PROVIDER_RECEIPT_ID_RE.test(call.mcpLedgerId || "")) &&
      typeof call.mcpLedgerPrewritePersisted === "boolean" &&
      typeof call.mcpLedgerSettlementPersisted === "boolean" &&
      (!call.mcpLedgerSettlementPersisted || call.mcpLedgerPrewritePersisted) &&
      timestampsValid &&
      !ids.has(call.id) &&
      !identities.has(identityKey);
    const providerValid =
      call?.kind !== "provider" ||
      (call.protocol === WORKFLOW_PROVIDER_ATTEMPT_PROTOCOL &&
        WORKFLOW_PROVIDER_CALL_ID_RE.test(call.callId || "") &&
        call.childEffectId === null &&
        PROVIDER_NAME_RE.test(call.name || "") &&
        ["model", "semantic-compaction", "subagent"].includes(call.source) &&
        ["model", "semantic-compaction"].includes(requestSource) &&
        (call.source === "subagent"
          ? requestSource === "model"
          : requestSource === call.source) &&
        WORKFLOW_PROVIDER_REQUEST_ID_RE.test(call.clientRequestId || "") &&
        call.clientRequestId ===
          expectedWorkflowProviderRequestId(
            ownerEffectId,
            requestSource,
            call.sequence,
          ) &&
        call.identitySemantics === "trace-only" &&
        call.status !== "failed" &&
        (providerCostFieldCount === 0
          ? !startedPricingFieldsPresent && !settlementCostDigestPresent
          : hasProviderCostSchema &&
            (call.providerModel === null ||
              PROVIDER_MODEL_RE.test(call.providerModel || "")) &&
            (call.providerPricing === null ||
              validProviderPricing(
                call.providerPricing,
                call.name,
                call.providerModel,
              )) &&
            startedLineage.length === 1 &&
            startedLineage[0]?.details?.providerModel === call.providerModel &&
            startedLineage[0]?.details?.providerPricingDigest ===
              (call.providerPricing === null
                ? null
                : providerPricingDigest(call.providerPricing)) &&
            (call.status === "completed"
              ? (call.providerPricing === null
                  ? call.providerCostEstimate === null
                  : validProviderCostEstimate(
                      call.providerCostEstimate,
                      call.providerPricing,
                      call.providerUsage,
                    )) &&
                settlementLineage.length === 1 &&
                settlementLineage[0]?.details?.providerCostEstimateDigest ===
                  (call.providerCostEstimate === null
                    ? null
                    : providerCostEstimateDigest(call.providerCostEstimate))
              : call.providerCostEstimate === null &&
                (call.status === "outcome_unknown"
                  ? settlementLineage.length === 1 &&
                    settlementLineage[0]?.details
                      ?.providerCostEstimateDigest === null
                  : !settlementCostDigestPresent))) &&
        (hasProviderUsage
          ? call.status === "completed"
            ? validProviderUsage(call.providerUsage) &&
              settlementLineage.length === 1 &&
              settlementLineage[0]?.details?.providerUsageDigest ===
                providerUsageDigest(call.providerUsage)
            : call.providerUsage === null &&
              (call.status === "outcome_unknown"
                ? settlementLineage.length === 1 &&
                  settlementLineage[0]?.details?.providerUsageDigest === null
                : !settlementUsageDigestPresent)
          : !settlementUsageDigestPresent) &&
        !hasArtifactReadback &&
        !startedArtifactSchemaPresent &&
        !settlementArtifactDigestPresent &&
        call.mcpLedgerId === null &&
        call.mcpLedgerPrewritePersisted === false &&
        call.mcpLedgerSettlementPersisted === false);
    const toolValid =
      call?.kind !== "tool" ||
      (call.protocol === WORKFLOW_CHILD_EFFECT_PROTOCOL &&
        WORKFLOW_TOOL_CALL_ID_RE.test(call.callId || "") &&
        SHA256_RE.test(call.childEffectId || "") &&
        call.childEffectId ===
          expectedNestedToolEffectId(
            ownerEffectId,
            call.sequence,
            call.callId,
            call.name,
          ) &&
        WORKFLOW_TOOL_NAME_RE.test(call.name || "") &&
        call.source === "tool" &&
        requestSource === null &&
        call.clientRequestId === null &&
        call.providerReceiptPersisted === false &&
        call.providerReceiptRequestId === null &&
        call.providerReceiptResponseId === null &&
        (call.providerReceiptRecordedAt === null || !hasReceiptTimestamp) &&
        call.identitySemantics === "runtime-derived" &&
        (call.name !== "publish_artifact"
          ? !hasArtifactReadback &&
            !startedArtifactSchemaPresent &&
            !settlementArtifactDigestPresent
          : hasArtifactReadback
            ? startedLineage.length === 1 &&
              startedLineage[0]?.details?.artifactReadbackSchema ===
                "cc-dynamic-workflow-artifact-readback/v1" &&
              (call.status === "completed"
                ? validArtifactReadback(call.artifactReadback) &&
                  settlementLineage.length === 1 &&
                  settlementLineage[0]?.details?.artifactReadbackDigest ===
                    artifactReadbackDigest(call.artifactReadback)
                : call.artifactReadback === null &&
                  (["failed", "outcome_unknown"].includes(call.status)
                    ? settlementLineage.length === 1 &&
                      settlementLineage[0]?.details?.artifactReadbackDigest ===
                        null
                    : !settlementArtifactDigestPresent))
            : !startedArtifactSchemaPresent &&
              !settlementArtifactDigestPresent));
    const settlementValid = terminal
      ? call.settlementCode !== null || call.status === "completed"
      : call.settlementCode === null &&
        call.outcomeUnknown === false &&
        call.mcpLedgerId === null &&
        call.mcpLedgerPrewritePersisted === false &&
        call.mcpLedgerSettlementPersisted === false;
    const callValid =
      commonValid && providerValid && toolValid && settlementValid;
    if (!callValid) {
      issues.push(`effect-${effectIndex}-call-${callIndex}-invalid`);
    }
    if (
      callValid &&
      call.kind === "tool" &&
      DESCENDANT_OWNER_TOOL_NAMES.has(call.name)
    ) {
      authorizedOwnerEffectIds.add(call.childEffectId);
    }
    ids.add(call?.id);
    identities.add(identityKey);
  }
  if (
    effect?.status === "settled" &&
    calls.some((call) => call?.status === "started")
  ) {
    issues.push(`effect-${effectIndex}-calls-unsettled`);
  }
  if (calls.length > 0 && typeof effect?.providerDispatchedAt !== "string") {
    issues.push(`effect-${effectIndex}-calls-without-dispatch`);
  }
}

export function verifyDynamicWorkflowRuntimeState(value) {
  const state = snapshotJson(value, "workflow runtime state");
  const issues = [];
  if (
    state.schema !== DYNAMIC_WORKFLOW_RUNTIME_SCHEMA ||
    state.version !== DYNAMIC_WORKFLOW_RUNTIME_VERSION ||
    !STATE_STATUSES.has(state.status)
  ) {
    issues.push("identity-invalid");
  }
  try {
    safeId(state.runId, "runId");
    safeId(state.workflowId, "workflowId", 128);
  } catch {
    issues.push("run-binding-invalid");
  }
  if (
    !SHA256_RE.test(state.definitionDigest || "") ||
    !SHA256_RE.test(state.admissionDigest || "") ||
    typeof state.executionAuthoritySessionId !== "string" ||
    state.executionAuthoritySessionId.length === 0 ||
    state.executionAuthoritySessionId.length > 256
  ) {
    issues.push("authority-binding-invalid");
  }
  if (
    !Number.isSafeInteger(state.revision) ||
    state.revision < 1 ||
    state.revision !== state.lineage?.length
  ) {
    issues.push("revision-invalid");
  }
  verifyLineage(state, issues);
  if (!Array.isArray(state.effects) || state.effects.length > MAX_EFFECTS) {
    issues.push("effects-invalid");
  } else {
    const startedLineageByCallId = new Map();
    const receiptLineageByCallId = new Map();
    const settlementLineageByCallId = new Map();
    for (const event of state.lineage) {
      const callRecordId = event?.details?.callRecordId;
      const target =
        event.type === "effect-call-started"
          ? startedLineageByCallId
          : event.type === "effect-call-receipt-recorded"
            ? receiptLineageByCallId
            : event.type === "effect-call-settled"
              ? settlementLineageByCallId
              : null;
      if (!target) continue;
      if (!target.has(callRecordId)) {
        target.set(callRecordId, []);
      }
      target.get(callRecordId).push(event);
    }
    const knownCallIds = new Set(
      state.effects.flatMap((effect) =>
        Array.isArray(effect?.calls)
          ? effect.calls.map((call) => call?.id)
          : [],
      ),
    );
    let receiptLineageIndex = 0;
    for (const [callRecordId, events] of receiptLineageByCallId) {
      if (
        !SHA256_RE.test(callRecordId || "") ||
        !knownCallIds.has(callRecordId) ||
        events.length !== 1
      ) {
        issues.push(`receipt-lineage-${receiptLineageIndex}-invalid`);
      }
      receiptLineageIndex += 1;
    }
    const ids = new Set();
    const keys = new Set();
    const batches = new Map();
    for (const [index, effect] of state.effects.entries()) {
      let expectedKey = null;
      let expectedId = null;
      try {
        expectedKey = effectKey(effect);
        expectedId = digest("chainlesschain.dynamic-workflow.effect-id.v1\0", {
          runId: state.runId,
          key: expectedKey,
          payloadDigest: effect?.payloadDigest,
        });
      } catch {
        // The common invalid-effect branch below records the stable issue.
      }
      const resultDigest =
        effect?.result == null ? null : effectResultDigest(effect.result);
      const batchFields = [
        effect?.batchId,
        effect?.batchIndex,
        effect?.batchSize,
      ];
      const hasBatchMetadata = batchFields.some((field) => field !== undefined);
      const batchMetadataValid =
        !hasBatchMetadata ||
        (batchFields.every((field) => field !== undefined) &&
          SHA256_RE.test(effect.batchId || "") &&
          Number.isSafeInteger(effect.batchIndex) &&
          effect.batchIndex >= 0 &&
          Number.isSafeInteger(effect.batchSize) &&
          effect.batchSize >= 1 &&
          effect.batchSize <= MAX_EFFECT_BATCH_SIZE &&
          effect.batchIndex < effect.batchSize);
      const hasDispatchMetadata = hasProviderDispatchMetadata(effect);
      const dispatchFields = [
        effect?.providerDispatchedAt,
        effect?.timeoutMs,
        effect?.timeoutObservedAt,
      ];
      const providerDispatchedAtValid =
        effect?.providerDispatchedAt === null ||
        (typeof effect?.providerDispatchedAt === "string" &&
          isoNow(effect.providerDispatchedAt) === effect.providerDispatchedAt &&
          Date.parse(effect.providerDispatchedAt) >=
            Date.parse(effect.requestedAt));
      const timeoutObservedAtValid =
        effect?.timeoutObservedAt === null ||
        (typeof effect?.timeoutObservedAt === "string" &&
          Number(effect?.timeoutMs) > 0 &&
          isoNow(effect.timeoutObservedAt) === effect.timeoutObservedAt &&
          Date.parse(effect.timeoutObservedAt) >=
            Date.parse(effect.requestedAt) &&
          (effect.providerDispatchedAt === null ||
            Date.parse(effect.timeoutObservedAt) >=
              Date.parse(effect.providerDispatchedAt)));
      const dispatchMetadataValid =
        !hasDispatchMetadata ||
        (dispatchFields.every((field) => field !== undefined) &&
          Number.isFinite(effect.timeoutMs) &&
          effect.timeoutMs >= 0 &&
          providerDispatchedAtValid &&
          timeoutObservedAtValid);
      if (
        effect?.schema !== DYNAMIC_WORKFLOW_EFFECT_SCHEMA ||
        !SHA256_RE.test(effect.id || "") ||
        !SHA256_RE.test(effect.payloadDigest || "") ||
        !["pending", "settled"].includes(effect.status) ||
        typeof effect.key !== "string" ||
        effect.key.length === 0 ||
        effect.key.length > 1024 ||
        effect.key !== expectedKey ||
        effect.id !== expectedId ||
        isoNow(effect.requestedAt) !== effect.requestedAt ||
        ids.has(effect.id) ||
        keys.has(effect.key) ||
        !batchMetadataValid ||
        !dispatchMetadataValid ||
        (effect.status === "pending" &&
          (effect.result !== null ||
            effect.resultDigest !== null ||
            effect.settlementAuthority !== null ||
            effect.settledAt !== null)) ||
        (effect.status === "settled" &&
          (effect.result == null ||
            effect.resultDigest !== resultDigest ||
            !SETTLEMENT_AUTHORITIES.has(effect.settlementAuthority) ||
            (hasDispatchMetadata &&
              effect.settlementAuthority === "runtime-not-dispatched" &&
              (effect.providerDispatchedAt !== null ||
                effect.result?.status !== "failed" ||
                effect.result?.result?.providerDispatched !== false ||
                ![
                  "timeout-before-dispatch",
                  "stopped-before-dispatch",
                ].includes(effect.result?.result?.reason) ||
                (effect.result?.result?.reason ===
                  "timeout-before-dispatch") !==
                  (typeof effect.timeoutObservedAt === "string"))) ||
            (hasDispatchMetadata &&
              effect.settlementAuthority !== "runtime-not-dispatched" &&
              typeof effect.providerDispatchedAt !== "string") ||
            (hasDispatchMetadata &&
              typeof effect.providerDispatchedAt === "string" &&
              Date.parse(effect.providerDispatchedAt) >
                Date.parse(effect.settledAt)) ||
            (hasDispatchMetadata &&
              typeof effect.timeoutObservedAt === "string" &&
              Date.parse(effect.timeoutObservedAt) >
                Date.parse(effect.settledAt)) ||
            Date.parse(effect.settledAt) < Date.parse(effect.requestedAt) ||
            isoNow(effect.settledAt) !== effect.settledAt))
      ) {
        issues.push(`effect-${index}-invalid`);
      }
      ids.add(effect?.id);
      keys.add(effect?.key);
      verifyEffectCalls(
        effect,
        index,
        issues,
        startedLineageByCallId,
        receiptLineageByCallId,
        settlementLineageByCallId,
      );
      if (batchMetadataValid && hasBatchMetadata) {
        if (!batches.has(effect.batchId)) batches.set(effect.batchId, []);
        batches.get(effect.batchId).push(effect);
      }
    }
    let batchIndex = 0;
    for (const [batchId, entries] of batches) {
      entries.sort((left, right) => left.batchIndex - right.batchIndex);
      const expectedSize = entries[0]?.batchSize;
      const complete =
        entries.length === expectedSize &&
        entries.every(
          (entry, index) =>
            entry.batchSize === expectedSize &&
            entry.batchIndex === index &&
            entry.requestedAt === entries[0].requestedAt,
        );
      const expectedBatchId = complete
        ? effectBatchId(state.runId, entries)
        : null;
      if (!complete || batchId !== expectedBatchId) {
        issues.push(`effect-batch-${batchIndex}-invalid`);
      }
      batchIndex += 1;
    }
  }
  if (
    (state.status === "completed") !== (state.finalRecord != null) ||
    (state.status === "stopped" && state.finalRecord != null)
  ) {
    issues.push("terminal-record-invalid");
  }
  if (
    isoNow(state.createdAt) !== state.createdAt ||
    isoNow(state.updatedAt) !== state.updatedAt
  ) {
    issues.push("timestamp-invalid");
  }
  const expectedStateDigest = digest(
    "chainlesschain.dynamic-workflow.runtime-state.v1\0",
    stateMaterial(state),
  );
  if (state.stateDigest !== expectedStateDigest)
    issues.push("state-digest-invalid");
  if (issues.length > 0) {
    const error = new Error(
      `dynamic workflow runtime state is invalid: ${issues.join(", ")}`,
    );
    error.code = "CC_DYNAMIC_WORKFLOW_RUNTIME_STATE_INVALID";
    error.issues = issues;
    throw error;
  }
  return Object.freeze(state);
}

function parseStateBytes(raw) {
  const text =
    typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= 0 || bytes > MAX_STATE_BYTES) {
    throw new Error("dynamic workflow runtime state exceeds its byte limit");
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("dynamic workflow runtime state is corrupt");
  }
  return verifyDynamicWorkflowRuntimeState(value);
}

function readStateFile(statePath) {
  try {
    fs.lstatSync(statePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  return withTrustedFileParentSync(
    fs,
    statePath,
    ({ canonicalPath, parentDevice }) => {
      const before = fs.lstatSync(canonicalPath, { bigint: true });
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        Number(before.nlink) !== 1 ||
        Number(before.size) <= 0 ||
        Number(before.size) > MAX_STATE_BYTES
      ) {
        throw new Error(
          "dynamic workflow runtime state must be a bounded, regular, single-link file",
        );
      }
      let descriptor;
      try {
        let flags = Number(fs.constants.O_RDONLY || 0);
        if (typeof fs.constants.O_NOFOLLOW === "number") {
          flags |= fs.constants.O_NOFOLLOW;
        }
        descriptor = fs.openSync(canonicalPath, flags);
        const opened = fs.fstatSync(descriptor, { bigint: true });
        if (
          !opened.isFile() ||
          Number(opened.nlink) !== 1 ||
          !samePathHandleFileIdentity(before, opened, parentDevice)
        ) {
          throw new Error(
            "dynamic workflow runtime state identity changed while opening",
          );
        }
        const state = parseStateBytes(fs.readFileSync(descriptor, "utf8"));
        const after = fs.fstatSync(descriptor, { bigint: true });
        if (!sameFileStatIdentity(opened, after)) {
          throw new Error(
            "dynamic workflow runtime state changed while reading",
          );
        }
        return state;
      } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
      }
    },
  );
}

function replaceObject(target, value) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, value);
}

function withStateMutation(statePath, mutator) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
  return withFileLock(
    statePath,
    () => {
      const current = readStateFile(statePath);
      const result = mutator(current);
      if (result?.state) {
        const verified = verifyDynamicWorkflowRuntimeState(result.state);
        writeSecurityStore(statePath, "dynamic workflow runtime", verified);
      }
      return result?.value;
    },
    { failIfUnavailable: true, timeoutMs: 5000, staleMs: 30000 },
  );
}

export function dynamicWorkflowRunStatePath(cwd, runId) {
  const safeRunId = safeId(runId, "runId");
  return path.join(
    path.resolve(cwd),
    ".chainlesschain",
    "cowork",
    "workflow-runs",
    `${safeRunId}.json`,
  );
}

export function readDynamicWorkflowRuntimeState(statePath) {
  const state = readStateFile(path.resolve(statePath));
  if (!state) {
    const error = new Error("dynamic workflow runtime state was not found");
    error.code = "CC_DYNAMIC_WORKFLOW_RUNTIME_NOT_FOUND";
    throw error;
  }
  return state;
}

export function readDynamicWorkflowEffectResultFile(filePath) {
  const resolved = path.resolve(filePath);
  return withTrustedFileParentSync(
    fs,
    resolved,
    ({ canonicalPath, parentDevice }) => {
      const before = fs.lstatSync(canonicalPath, { bigint: true });
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        Number(before.nlink) !== 1 ||
        Number(before.size) <= 0 ||
        Number(before.size) > 1024 * 1024
      ) {
        throw new Error(
          "workflow effect result must be a bounded, regular, single-link file",
        );
      }
      let descriptor;
      try {
        let flags = Number(fs.constants.O_RDONLY || 0);
        if (typeof fs.constants.O_NOFOLLOW === "number") {
          flags |= fs.constants.O_NOFOLLOW;
        }
        descriptor = fs.openSync(canonicalPath, flags);
        const opened = fs.fstatSync(descriptor, { bigint: true });
        if (
          !opened.isFile() ||
          Number(opened.nlink) !== 1 ||
          !samePathHandleFileIdentity(before, opened, parentDevice)
        ) {
          throw new Error(
            "workflow effect result identity changed while opening",
          );
        }
        let parsed;
        try {
          parsed = JSON.parse(fs.readFileSync(descriptor, "utf8"));
        } catch {
          throw new Error("workflow effect result is not valid JSON");
        }
        const result = snapshotJson(
          parsed,
          "workflow reconciled effect result",
          1024 * 1024,
        );
        if (containsSecret(JSON.stringify(result))) {
          throw new Error("workflow effect result contains secret-shaped data");
        }
        const after = fs.fstatSync(descriptor, { bigint: true });
        if (!sameFileStatIdentity(opened, after)) {
          throw new Error("workflow effect result changed while being read");
        }
        return result;
      } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
      }
    },
  );
}

function stateBindings(execution, runId) {
  const admission = execution.runAdmission;
  if (!admission || typeof admission !== "object") {
    throw new TypeError("durable workflow execution requires run admission");
  }
  if (
    !Number.isSafeInteger(admission.maxParallel) ||
    admission.maxParallel < 1 ||
    admission.maxParallel > MAX_EFFECT_BATCH_SIZE
  ) {
    throw new TypeError("durable workflow maxParallel admission is invalid");
  }
  const generation = execution.workflow?.facade?.generation;
  const review = execution.workflow?.facade?.review;
  if (generation != null || review != null) {
    if (
      generation?.schema !== "cc-dynamic-workflow-generation/v1" ||
      review?.schema !== "cc-dynamic-workflow-review/v1" ||
      review?.decision !== "accepted" ||
      !SHA256_RE.test(review?.draftDigest || "") ||
      !SHA256_RE.test(review?.sourceDefinitionDigest || "") ||
      typeof review?.reviewer !== "string" ||
      review.reviewer.length === 0
    ) {
      const error = new Error(
        "model-generated durable workflow requires accepted review authority",
      );
      error.code = "CC_DYNAMIC_WORKFLOW_REVIEW_AUTHORITY_REQUIRED";
      throw error;
    }
  }
  return {
    runId: safeId(runId, "runId"),
    workflowId: safeId(execution.workflow?.id, "workflowId", 128),
    definitionDigest: execution.definitionDigest,
    admissionDigest: admission.admissionDigest,
    executionAuthoritySessionId:
      admission.executionLocation?.session?.sessionId,
    executionPolicy: snapshotJson(
      admission.executionPolicy,
      "workflow execution policy",
      64 * 1024,
    ),
  };
}

function bindingsMatch(state, bindings) {
  return (
    [
      "runId",
      "workflowId",
      "definitionDigest",
      "admissionDigest",
      "executionAuthoritySessionId",
    ].every((field) => state[field] === bindings[field]) &&
    canonicalJson(state.executionPolicy) ===
      canonicalJson(bindings.executionPolicy)
  );
}

function createState(bindings, now) {
  const at = isoNow(now);
  const state = {
    schema: DYNAMIC_WORKFLOW_RUNTIME_SCHEMA,
    version: DYNAMIC_WORKFLOW_RUNTIME_VERSION,
    ...bindings,
    revision: 0,
    status: "ready",
    effects: [],
    finalRecord: null,
    createdAt: at,
    updatedAt: at,
    lineage: [],
  };
  appendLineage(
    state,
    "run-created",
    { definitionDigest: bindings.definitionDigest },
    at,
  );
  return finalizeState(state);
}

function controlError(message, reason, state, effect = null, cause = null) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = DYNAMIC_WORKFLOW_RUNTIME_CONTROL_CODE;
  error.reason = reason;
  error.runtimeState = state;
  if (effect) error.pendingEffect = effect;
  return error;
}

function startRun(statePath, bindings, now) {
  return withStateMutation(statePath, (current) => {
    let state = current || createState(bindings, now);
    if (!bindingsMatch(state, bindings)) {
      throw new Error(
        "durable workflow run authority does not match stored state",
      );
    }
    if (state.status === "completed") return { value: state };
    if (state.status !== "ready") {
      throw new Error(
        `durable workflow run is ${state.status}; use explicit control or reconciliation`,
      );
    }
    state = transition(
      state,
      "run-started",
      {},
      (draft) => {
        draft.status = "running";
      },
      now,
    );
    return { state, value: state };
  });
}

function effectKey(effect) {
  const stepId = String(effect?.stepId || "");
  const iteration = Number(effect?.iteration);
  const attempt = Number(effect?.attempt);
  if (
    !stepId ||
    stepId.length > 512 ||
    !Number.isSafeInteger(iteration) ||
    iteration < 1 ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1
  ) {
    throw new TypeError("workflow effect context is invalid");
  }
  return `${stepId}\u0000${iteration}\u0000${attempt}`;
}

function effectPayload(args) {
  const { signal: _signal, workflowEffect: _workflowEffect, ...payload } = args;
  return snapshotJson(payload, "workflow effect payload", 1024 * 1024);
}

function prepareEffectRequest(args) {
  const key = effectKey(args.workflowEffect);
  const stepId = String(args.workflowEffect.stepId);
  const iteration = Number(args.workflowEffect.iteration);
  const attempt = Number(args.workflowEffect.attempt);
  const timeoutMs = Number(args.workflowEffect.timeoutMs || 0);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new TypeError("workflow effect timeout context is invalid");
  }
  const payload = effectPayload(args);
  const payloadDigest = digest(
    "chainlesschain.dynamic-workflow.effect-payload.v1\0",
    payload,
  );
  return { key, stepId, iteration, attempt, timeoutMs, payloadDigest };
}

function requestEffectBatch(statePath, runId, argsList, now) {
  if (!Array.isArray(argsList) || argsList.length === 0) {
    throw new TypeError("workflow effect request batch is empty");
  }
  if (argsList.length > MAX_EFFECT_BATCH_SIZE) {
    throw new Error("workflow effect request batch exceeds its hard limit");
  }
  const requests = argsList.map((args) => ({
    ...prepareEffectRequest(args),
  }));
  const batchKeys = new Set(requests.map((request) => request.key));
  if (batchKeys.size !== requests.length) {
    throw new Error("workflow effect request batch contains duplicate keys");
  }
  return withStateMutation(statePath, (current) => {
    if (!current || current.runId !== runId) {
      throw new Error(
        "durable workflow run disappeared before effect batch request",
      );
    }
    if (current.status === "pause_requested") {
      return {
        value: { control: "paused", state: current, results: null },
      };
    }
    if (current.status === "stopped") {
      return {
        value: { control: "stopped", state: current, results: null },
      };
    }
    if (current.status !== "running") {
      throw new Error(
        `durable workflow run cannot request an effect batch while ${current.status}`,
      );
    }
    const existingByKey = new Map(
      current.effects.map((effect) => [effect.key, effect]),
    );
    for (const request of requests) {
      const existing = existingByKey.get(request.key);
      if (existing && existing.payloadDigest !== request.payloadDigest) {
        throw new Error("workflow effect payload drifted during replay");
      }
    }
    const existingPending = requests
      .map((request) => existingByKey.get(request.key))
      .find(
        (effect) =>
          effect?.status === "pending" && !isKnownUndispatched(effect),
      );
    if (existingPending) {
      const state = transition(
        current,
        "effect-batch-reconciliation-required",
        { effectId: existingPending.id },
        (draft) => {
          draft.status = "blocked";
        },
        now,
      );
      return {
        state,
        value: {
          state,
          results: requests.map(() => ({
            pending: true,
            effect: existingPending,
            state,
          })),
        },
      };
    }
    const newRequests = [];
    const resultsByKey = new Map();
    for (const request of requests) {
      const existing = existingByKey.get(request.key);
      if (!existing) {
        newRequests.push(request);
        continue;
      }
      if (existing.status === "pending" && isKnownUndispatched(existing)) {
        resultsByKey.set(request.key, {
          cached: false,
          effect: existing,
        });
        continue;
      }
      resultsByKey.set(request.key, {
        cached: true,
        effect: existing,
        result: existing.result,
      });
    }
    if (current.effects.length + newRequests.length > MAX_EFFECTS) {
      throw new Error("durable workflow effect limit exceeded");
    }
    if (newRequests.length === 0) {
      return {
        value: {
          state: current,
          results: requests.map((request) => resultsByKey.get(request.key)),
        },
      };
    }
    const ordered = [...newRequests].sort((left, right) =>
      left.key.localeCompare(right.key),
    );
    const batchId = effectBatchId(runId, ordered);
    const requestedAt = isoNow(now);
    const effects = ordered.map((request, batchIndex) => {
      const id = digest("chainlesschain.dynamic-workflow.effect-id.v1\0", {
        runId,
        key: request.key,
        payloadDigest: request.payloadDigest,
      });
      return {
        schema: DYNAMIC_WORKFLOW_EFFECT_SCHEMA,
        id,
        key: request.key,
        stepId: request.stepId,
        iteration: request.iteration,
        attempt: request.attempt,
        payloadDigest: request.payloadDigest,
        batchId,
        batchIndex,
        batchSize: ordered.length,
        timeoutMs: request.timeoutMs,
        timeoutObservedAt: null,
        providerDispatchedAt: null,
        calls: [],
        status: "pending",
        requestedAt,
        settledAt: null,
        settlementAuthority: null,
        resultDigest: null,
        result: null,
      };
    });
    for (const effect of effects) {
      resultsByKey.set(effect.key, { cached: false, effect });
    }
    const state = transition(
      current,
      "effect-batch-requested",
      {
        batchId,
        effectIds: effects.map((effect) => effect.id),
        effectCount: effects.length,
      },
      (draft) => {
        draft.effects.push(...effects);
      },
      now,
    );
    return {
      state,
      value: {
        state,
        results: requests.map((request) => resultsByKey.get(request.key)),
      },
    };
  });
}

function createEffectRequestBatcher(statePath, runId, now) {
  let queue = [];
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    const batch = queue;
    queue = [];
    try {
      const requested = requestEffectBatch(
        statePath,
        runId,
        batch.map((entry) => entry.args),
        now,
      );
      for (let index = 0; index < batch.length; index += 1) {
        if (requested.control) batch[index].resolve(requested);
        else batch[index].resolve(requested.results[index]);
      }
    } catch (error) {
      for (const entry of batch) entry.reject(error);
    }
  };
  return (args) =>
    new Promise((resolve, reject) => {
      queue.push({ args, resolve, reject });
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(flush);
    });
}

function markEffectProviderDispatched(statePath, runId, effectId, now) {
  return withStateMutation(statePath, (current) => {
    if (!current || current.runId !== runId) {
      throw new Error("durable workflow run disappeared before dispatch");
    }
    const index = current.effects.findIndex((effect) => effect.id === effectId);
    const effect = current.effects[index];
    if (!effect || effect.status !== "pending") {
      throw new Error("workflow effect is not pending before dispatch");
    }
    if (!isKnownUndispatched(effect)) {
      throw new Error("workflow effect dispatch authority is unavailable");
    }
    if (current.status === "stopped") {
      return { value: { control: "stopped", state: current, effect } };
    }
    if (!["running", "pause_requested", "blocked"].includes(current.status)) {
      throw new Error(
        `workflow effect cannot be dispatched while ${current.status}`,
      );
    }
    const providerDispatchedAt = isoNow(now);
    const state = transition(
      current,
      "effect-provider-dispatched",
      { effectId, providerDispatchedAt },
      (draft) => {
        draft.effects[index] = {
          ...draft.effects[index],
          providerDispatchedAt,
        };
      },
      now,
    );
    return {
      state,
      value: {
        effect: state.effects[index],
        state,
      },
    };
  });
}

function observeEffectTimeout(statePath, runId, effectId, now) {
  return withStateMutation(statePath, (current) => {
    if (!current || current.runId !== runId) return { value: current };
    const index = current.effects.findIndex((effect) => effect.id === effectId);
    const effect = current.effects[index];
    if (
      !effect ||
      effect.status !== "pending" ||
      !hasProviderDispatchMetadata(effect) ||
      typeof effect.providerDispatchedAt !== "string" ||
      !(effect.timeoutMs > 0) ||
      effect.timeoutObservedAt !== null
    ) {
      return { value: current };
    }
    const timeoutObservedAt = isoNow(now);
    const state = transition(
      current,
      "effect-timeout-observed",
      { effectId, timeoutMs: effect.timeoutMs, timeoutObservedAt },
      (draft) => {
        draft.effects[index] = {
          ...draft.effects[index],
          timeoutObservedAt,
        };
      },
      now,
    );
    return { state, value: state };
  });
}

function ownDataValue(value, property) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, property);
    return descriptor && Object.hasOwn(descriptor, "value")
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function providerUsageSettlement(event) {
  const usage = ownDataValue(event, "usage");
  let descriptors;
  try {
    if (
      !usage ||
      typeof usage !== "object" ||
      Array.isArray(usage) ||
      utilTypes.isProxy(usage)
    ) {
      throw new TypeError();
    }
    descriptors = Object.getOwnPropertyDescriptors(usage);
  } catch {
    throw new TypeError("workflow provider token usage is malformed");
  }
  const fields = Reflect.ownKeys(descriptors);
  if (
    fields.length > 32 ||
    fields.some(
      (field) =>
        typeof field !== "string" ||
        descriptors[field].enumerable !== true ||
        !Object.hasOwn(descriptors[field], "value"),
    )
  ) {
    throw new TypeError("workflow provider token usage is malformed");
  }
  const count = (canonical, alias, required) => {
    const canonicalField = descriptors[canonical];
    const aliasField = descriptors[alias];
    if (!canonicalField && !aliasField) {
      if (required) {
        throw new TypeError("workflow provider token usage is incomplete");
      }
      return 0;
    }
    const canonicalValue = canonicalField?.value;
    const aliasValue = aliasField?.value;
    if (
      (canonicalField && aliasField && canonicalValue !== aliasValue) ||
      nonNegativeSafeInteger(canonicalField ? canonicalValue : aliasValue) ===
        null ||
      (canonicalField ? canonicalValue : aliasValue) > MAX_PROVIDER_TOKEN_COUNT
    ) {
      throw new TypeError("workflow provider token usage is malformed");
    }
    return canonicalField ? canonicalValue : aliasValue;
  };
  const inputTokens = count("input_tokens", "prompt_tokens", true);
  const outputTokens = count("output_tokens", "completion_tokens", true);
  const cacheReadInputTokens = count(
    "cache_read_input_tokens",
    "cache_read_tokens",
    false,
  );
  const cacheCreationInputTokens = count(
    "cache_creation_input_tokens",
    "cache_creation_tokens",
    false,
  );
  const totalTokens =
    inputTokens +
    outputTokens +
    cacheReadInputTokens +
    cacheCreationInputTokens;
  if (!Number.isSafeInteger(totalTokens)) {
    throw new TypeError("workflow provider token usage exceeds its limit");
  }
  return {
    schema: "cc-provider-token-usage/v1",
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    totalTokens,
  };
}

function workflowCallAttempt(effectId, kind, event, now) {
  const startedAt = isoNow(now);
  const ownerEffectId = event?.workflowEffectId;
  if (kind === "provider") {
    const providerModel = event?.model == null ? null : event.model;
    const requestSource =
      event?.workflowRequestSource ||
      (event?.source === "subagent" ? "model" : event?.source);
    if (
      event?.type !== "model-usage-started" ||
      !SHA256_RE.test(ownerEffectId || "") ||
      !WORKFLOW_PROVIDER_CALL_ID_RE.test(event.callId || "") ||
      !PROVIDER_NAME_RE.test(event.provider || "") ||
      (providerModel !== null &&
        !PROVIDER_MODEL_RE.test(providerModel || "")) ||
      !["model", "semantic-compaction", "subagent"].includes(event.source) ||
      !["model", "semantic-compaction"].includes(requestSource) ||
      (event.source === "subagent"
        ? requestSource !== "model"
        : requestSource !== event.source) ||
      !Number.isSafeInteger(event.callSequence) ||
      event.callSequence < 1 ||
      !WORKFLOW_PROVIDER_REQUEST_ID_RE.test(event.providerRequestId || "") ||
      event.providerRequestId !==
        expectedWorkflowProviderRequestId(
          ownerEffectId,
          requestSource,
          event.callSequence,
        ) ||
      event.requestIdentitySemantics !== "trace-only"
    ) {
      throw new TypeError("workflow provider call boundary is malformed");
    }
    return {
      schema: DYNAMIC_WORKFLOW_CALL_SCHEMA,
      id: workflowCallId(effectId, kind, event.callId, null, ownerEffectId),
      effectId,
      ownerEffectId,
      kind,
      protocol: WORKFLOW_PROVIDER_ATTEMPT_PROTOCOL,
      callId: event.callId,
      childEffectId: null,
      sequence: event.callSequence,
      name: event.provider,
      source: event.source,
      requestSource,
      clientRequestId: event.providerRequestId,
      identitySemantics: "trace-only",
      status: "started",
      startedAt,
      settledAt: null,
      outcomeUnknown: false,
      settlementCode: null,
      providerReceiptPersisted: false,
      providerReceiptRequestId: null,
      providerReceiptResponseId: null,
      providerReceiptRecordedAt: null,
      providerUsage: null,
      providerModel,
      providerPricing: providerPricingSnapshot(event.provider, providerModel),
      providerCostEstimate: null,
      mcpLedgerId: null,
      mcpLedgerPrewritePersisted: false,
      mcpLedgerSettlementPersisted: false,
    };
  }
  if (
    kind !== "tool" ||
    event?.type !== "tool-executing" ||
    !SHA256_RE.test(ownerEffectId || "") ||
    event.workflowEffectProtocol !== WORKFLOW_CHILD_EFFECT_PROTOCOL ||
    !SHA256_RE.test(event.workflowChildEffectId || "") ||
    !Number.isSafeInteger(event.workflowChildSequence) ||
    event.workflowChildSequence < 1 ||
    !WORKFLOW_TOOL_CALL_ID_RE.test(event.tool_use_id || "") ||
    !WORKFLOW_TOOL_NAME_RE.test(event.tool || "") ||
    event.workflowChildEffectId !==
      expectedNestedToolEffectId(
        ownerEffectId,
        event.workflowChildSequence,
        event.tool_use_id,
        event.tool,
      )
  ) {
    throw new TypeError("workflow tool call boundary is malformed");
  }
  return {
    schema: DYNAMIC_WORKFLOW_CALL_SCHEMA,
    id: workflowCallId(
      effectId,
      kind,
      event.tool_use_id,
      event.workflowChildEffectId,
      ownerEffectId,
    ),
    effectId,
    ownerEffectId,
    kind,
    protocol: WORKFLOW_CHILD_EFFECT_PROTOCOL,
    callId: event.tool_use_id,
    childEffectId: event.workflowChildEffectId,
    sequence: event.workflowChildSequence,
    name: event.tool,
    source: "tool",
    requestSource: null,
    clientRequestId: null,
    identitySemantics: "runtime-derived",
    status: "started",
    startedAt,
    settledAt: null,
    outcomeUnknown: false,
    settlementCode: null,
    providerReceiptPersisted: false,
    providerReceiptRequestId: null,
    providerReceiptResponseId: null,
    providerReceiptRecordedAt: null,
    ...(event.tool === "publish_artifact" ? { artifactReadback: null } : {}),
    mcpLedgerId: null,
    mcpLedgerPrewritePersisted: false,
    mcpLedgerSettlementPersisted: false,
  };
}

function beginEffectCall(statePath, runId, effectId, kind, event, now) {
  const attempt = workflowCallAttempt(effectId, kind, event, now);
  return withStateMutation(statePath, (current) => {
    if (!current || current.runId !== runId) {
      throw new Error("durable workflow run disappeared before call boundary");
    }
    const index = current.effects.findIndex((effect) => effect.id === effectId);
    const effect = current.effects[index];
    const calls = effect?.calls || [];
    if (
      !effect ||
      effect.status !== "pending" ||
      typeof effect.providerDispatchedAt !== "string"
    ) {
      throw new Error("workflow effect cannot begin a durable child call");
    }
    if (calls.length >= MAX_CALLS_PER_EFFECT) {
      throw new Error("workflow effect child-call limit exceeded");
    }
    if (
      attempt.ownerEffectId !== effectId &&
      !calls.some(
        (call) =>
          call.kind === "tool" &&
          call.childEffectId === attempt.ownerEffectId &&
          DESCENDANT_OWNER_TOOL_NAMES.has(call.name),
      )
    ) {
      throw new Error("workflow descendant call owner is not authorized");
    }
    if (
      calls.some(
        (call) =>
          call.id === attempt.id ||
          (call.kind === attempt.kind &&
            (attempt.kind === "tool"
              ? call.childEffectId === attempt.childEffectId
              : call.callId === attempt.callId)),
      )
    ) {
      throw new Error("workflow child-call boundary is duplicated");
    }
    const state = transition(
      current,
      "effect-call-started",
      {
        effectId,
        ownerEffectId: attempt.ownerEffectId,
        callRecordId: attempt.id,
        kind,
        ...(kind === "provider"
          ? {
              providerModel: attempt.providerModel,
              providerPricingDigest:
                attempt.providerPricing === null
                  ? null
                  : providerPricingDigest(attempt.providerPricing),
            }
          : kind === "tool" && attempt.name === "publish_artifact"
            ? {
                artifactReadbackSchema:
                  "cc-dynamic-workflow-artifact-readback/v1",
              }
            : {}),
      },
      (draft) => {
        draft.effects[index] = {
          ...draft.effects[index],
          calls: [...(draft.effects[index].calls || []), attempt],
        };
      },
      now,
    );
    return { state, value: state.effects[index].calls.at(-1) };
  });
}

function providerReceiptSettlement(call, event) {
  const receipt = ownDataValue(event, "providerReceipt");
  if (receipt === null || receipt === undefined) {
    return {
      persisted: false,
      requestId: null,
      responseId: null,
    };
  }
  let descriptors;
  try {
    if (
      typeof receipt !== "object" ||
      Array.isArray(receipt) ||
      utilTypes.isProxy(receipt)
    ) {
      throw new TypeError();
    }
    descriptors = Object.getOwnPropertyDescriptors(receipt);
  } catch {
    throw new TypeError("workflow provider receipt settlement is malformed");
  }
  const expectedFields = [
    "callId",
    "callSequence",
    "clientRequestId",
    "independentlyReadable",
    "protocol",
    "provider",
    "requestId",
    "requestIdentitySemantics",
    "responseId",
    "source",
    "workflowEffectId",
  ];
  const ownFields = Reflect.ownKeys(descriptors);
  const fields = ownFields.filter((field) => typeof field === "string").sort();
  const hasOnlyDataFields =
    ownFields.length === expectedFields.length &&
    fields.length === expectedFields.length &&
    fields.every(
      (field, index) =>
        field === expectedFields[index] &&
        descriptors[field].enumerable === true &&
        Object.hasOwn(descriptors[field], "value"),
    );
  const value = (field) => descriptors?.[field]?.value;
  const requestId = value("requestId");
  const responseId = value("responseId");
  if (
    !hasOnlyDataFields ||
    value("protocol") !== "cc-provider-request-receipt/v1" ||
    value("provider") !== call.name ||
    value("workflowEffectId") !== (call.ownerEffectId ?? call.effectId) ||
    value("callId") !== call.callId ||
    value("callSequence") !== call.sequence ||
    value("source") !== call.requestSource ||
    value("clientRequestId") !== call.clientRequestId ||
    value("requestIdentitySemantics") !== "trace-only" ||
    value("independentlyReadable") !== false ||
    (requestId !== null &&
      (typeof requestId !== "string" ||
        !PROVIDER_RECEIPT_ID_RE.test(requestId))) ||
    (responseId !== null &&
      (typeof responseId !== "string" ||
        !PROVIDER_RECEIPT_ID_RE.test(responseId))) ||
    (!requestId && !responseId)
  ) {
    throw new TypeError("workflow provider receipt settlement is malformed");
  }
  return { persisted: true, requestId, responseId };
}

function recordEffectCallReceipt(statePath, runId, effectId, event, now) {
  return withStateMutation(statePath, (current) => {
    if (!current || current.runId !== runId) {
      throw new Error(
        "durable workflow run disappeared before provider receipt prewrite",
      );
    }
    const effectIndex = current.effects.findIndex(
      (effect) => effect.id === effectId,
    );
    const effect = current.effects[effectIndex];
    const callIndex = (effect?.calls || []).findIndex(
      (call) => call.kind === "provider" && call.callId === event?.callId,
    );
    const call = effect?.calls?.[callIndex];
    if (
      !effect ||
      effect.status !== "pending" ||
      !call ||
      call.status !== "started" ||
      call.providerReceiptPersisted === true
    ) {
      throw new Error("workflow provider call cannot record this receipt");
    }
    if (
      event?.type !== "provider-request-receipt" ||
      event.provider !== call.name ||
      event.source !== call.source ||
      event.workflowRequestSource !== call.requestSource ||
      event.workflowEffectId !== (call.ownerEffectId ?? call.effectId)
    ) {
      throw new TypeError("workflow provider receipt envelope is malformed");
    }
    const receipt = providerReceiptSettlement(call, event);
    if (!receipt.persisted) {
      throw new TypeError("workflow provider receipt envelope is empty");
    }
    const providerReceiptRecordedAt = isoNow(now);
    const state = transition(
      current,
      "effect-call-receipt-recorded",
      {
        effectId,
        ownerEffectId: call.ownerEffectId ?? call.effectId,
        callRecordId: call.id,
      },
      (draft) => {
        const calls = [...(draft.effects[effectIndex].calls || [])];
        calls[callIndex] = {
          ...calls[callIndex],
          providerReceiptPersisted: true,
          providerReceiptRequestId: receipt.requestId,
          providerReceiptResponseId: receipt.responseId,
          providerReceiptRecordedAt,
        };
        draft.effects[effectIndex] = {
          ...draft.effects[effectIndex],
          calls,
        };
      },
      now,
    );
    return { state, value: state.effects[effectIndex].calls[callIndex] };
  });
}

function effectCallSettlement(call, event, now, artifactStore) {
  let status;
  let settlementCode = null;
  let providerUsage = call.providerUsage;
  let providerCostEstimate = call.providerCostEstimate;
  let providerReceiptPersisted = call.providerReceiptPersisted;
  let providerReceiptRequestId = call.providerReceiptRequestId;
  let providerReceiptResponseId = call.providerReceiptResponseId;
  let artifactReadback = call.artifactReadback;
  let mcpLedgerId = null;
  let mcpLedgerPrewritePersisted = false;
  let mcpLedgerSettlementPersisted = false;
  if (call.kind === "provider") {
    if (
      !["token-usage", "model-usage-unknown"].includes(event?.type) ||
      event.callId !== call.callId ||
      (event.provider && event.provider !== call.name) ||
      (Object.prototype.hasOwnProperty.call(call, "providerModel") &&
        event.model != null &&
        event.model !== call.providerModel) ||
      (event.source && event.source !== call.source)
    ) {
      throw new TypeError("workflow provider call settlement is malformed");
    }
    status = event.type === "token-usage" ? "completed" : "outcome_unknown";
    providerUsage =
      status === "completed" ? providerUsageSettlement(event) : null;
    providerCostEstimate =
      status === "completed"
        ? estimateProviderCost(call.providerPricing, providerUsage)
        : null;
    settlementCode =
      status === "outcome_unknown"
        ? String(event.code || "provider_outcome_unknown")
        : null;
    const providerReceipt = providerReceiptSettlement(call, event);
    if (
      providerReceipt.persisted &&
      (!call.providerReceiptPersisted ||
        providerReceipt.requestId !== call.providerReceiptRequestId ||
        providerReceipt.responseId !== call.providerReceiptResponseId)
    ) {
      throw new TypeError(
        "workflow provider receipt was not durably prewritten",
      );
    }
  } else {
    if (
      event?.type !== "tool-result" ||
      event.workflowEffectId !== (call.ownerEffectId ?? call.effectId) ||
      event.workflowEffectProtocol !== WORKFLOW_CHILD_EFFECT_PROTOCOL ||
      event.workflowChildEffectId !== call.childEffectId ||
      event.workflowChildSequence !== call.sequence ||
      event.tool_use_id !== call.callId ||
      event.tool !== call.name
    ) {
      throw new TypeError("workflow tool call settlement is malformed");
    }
    const outcomeUnknown =
      ownDataValue(event.result, "outcomeUnknown") === true;
    const failed = Boolean(event.error || ownDataValue(event.result, "error"));
    status = outcomeUnknown
      ? "outcome_unknown"
      : failed
        ? "failed"
        : "completed";
    settlementCode = outcomeUnknown
      ? "nested_tool_outcome_unknown"
      : failed
        ? "tool_failed"
        : null;
    mcpLedgerId = ownDataValue(event.result, "mcpLedgerId") ?? null;
    mcpLedgerPrewritePersisted =
      ownDataValue(event.result, "mcpLedgerPrewritePersisted") === true;
    mcpLedgerSettlementPersisted =
      ownDataValue(event.result, "mcpLedgerSettlementPersisted") === true;
    if (
      (mcpLedgerId !== null &&
        !PROVIDER_RECEIPT_ID_RE.test(String(mcpLedgerId))) ||
      (mcpLedgerSettlementPersisted && !mcpLedgerPrewritePersisted)
    ) {
      throw new TypeError("workflow MCP call settlement is malformed");
    }
    if (Object.prototype.hasOwnProperty.call(call, "artifactReadback")) {
      const published = ownDataValue(event.result, "published");
      if (status === "completed") {
        artifactReadback = artifactReadbackSettlement(event, artifactStore);
      } else {
        if (published !== undefined && published !== null) {
          throw new TypeError(
            "failed workflow artifact settlement cannot claim a published artifact",
          );
        }
        artifactReadback = null;
      }
    }
  }
  if (
    settlementCode !== null &&
    (!/^[A-Za-z0-9._:-]{1,128}$/u.test(settlementCode) ||
      settlementCode.includes(".."))
  ) {
    throw new TypeError("workflow call settlement code is malformed");
  }
  return {
    ...call,
    status,
    settledAt: isoNow(now),
    outcomeUnknown: status === "outcome_unknown",
    settlementCode,
    providerReceiptPersisted,
    providerReceiptRequestId,
    providerReceiptResponseId,
    ...(call.kind === "provider" ? { providerUsage } : {}),
    ...(call.kind === "provider" &&
    Object.prototype.hasOwnProperty.call(call, "providerCostEstimate")
      ? { providerCostEstimate }
      : {}),
    ...(call.kind === "tool" &&
    Object.prototype.hasOwnProperty.call(call, "artifactReadback")
      ? { artifactReadback }
      : {}),
    mcpLedgerId,
    mcpLedgerPrewritePersisted,
    mcpLedgerSettlementPersisted,
  };
}

function settleEffectCall(
  statePath,
  runId,
  effectId,
  kind,
  event,
  now,
  artifactStore,
) {
  return withStateMutation(statePath, (current) => {
    if (!current || current.runId !== runId) {
      throw new Error(
        "durable workflow run disappeared before call settlement",
      );
    }
    const effectIndex = current.effects.findIndex(
      (effect) => effect.id === effectId,
    );
    const effect = current.effects[effectIndex];
    const callIndex = (effect?.calls || []).findIndex((call) =>
      kind === "tool"
        ? call.kind === kind &&
          call.childEffectId === event?.workflowChildEffectId
        : call.kind === kind && call.callId === event?.callId,
    );
    const call = effect?.calls?.[callIndex];
    if (
      !effect ||
      effect.status !== "pending" ||
      !call ||
      call.status !== "started"
    ) {
      throw new Error("workflow child call is not started at settlement");
    }
    const settlement = effectCallSettlement(call, event, now, artifactStore);
    const usageDigest =
      kind === "provider" && settlement.providerUsage !== null
        ? providerUsageDigest(settlement.providerUsage)
        : null;
    const hasProviderCostSchema = Object.prototype.hasOwnProperty.call(
      settlement,
      "providerCostEstimate",
    );
    const costEstimateDigest =
      kind === "provider" &&
      hasProviderCostSchema &&
      settlement.providerCostEstimate !== null
        ? providerCostEstimateDigest(settlement.providerCostEstimate)
        : null;
    const hasArtifactReadback = Object.prototype.hasOwnProperty.call(
      settlement,
      "artifactReadback",
    );
    const settledArtifactReadbackDigest =
      kind === "tool" &&
      hasArtifactReadback &&
      settlement.artifactReadback !== null
        ? artifactReadbackDigest(settlement.artifactReadback)
        : null;
    const state = transition(
      current,
      "effect-call-settled",
      {
        effectId,
        callRecordId: call.id,
        kind,
        status: settlement.status,
        ...(kind === "provider" ? { providerUsageDigest: usageDigest } : {}),
        ...(kind === "provider" && hasProviderCostSchema
          ? { providerCostEstimateDigest: costEstimateDigest }
          : {}),
        ...(kind === "tool" && hasArtifactReadback
          ? { artifactReadbackDigest: settledArtifactReadbackDigest }
          : {}),
      },
      (draft) => {
        const calls = [...(draft.effects[effectIndex].calls || [])];
        calls[callIndex] = settlement;
        draft.effects[effectIndex] = {
          ...draft.effects[effectIndex],
          calls,
        };
      },
      now,
    );
    return { state, value: state.effects[effectIndex].calls[callIndex] };
  });
}

function createDurableCallObservers(
  statePath,
  runId,
  effectId,
  now,
  artifactStore,
) {
  return Object.freeze({
    strictUsageTelemetry: true,
    onUsageBoundary(event) {
      beginEffectCall(statePath, runId, effectId, "provider", event, now);
    },
    onUsageSettlement(event) {
      settleEffectCall(statePath, runId, effectId, "provider", event, now);
    },
    onProviderReceipt(event) {
      recordEffectCallReceipt(statePath, runId, effectId, event, now);
    },
    onToolCallBoundary(event) {
      beginEffectCall(statePath, runId, effectId, "tool", event, now);
    },
    onToolCallSettlement(event) {
      settleEffectCall(
        statePath,
        runId,
        effectId,
        "tool",
        event,
        now,
        artifactStore,
      );
    },
  });
}

function runtimeNotDispatchedResult(effect, reason) {
  if (reason !== "timeout" && reason !== "stopped") {
    throw new TypeError("undispatched workflow effect reason is invalid");
  }
  const timeout = reason === "timeout";
  return {
    taskId: `runtime-${effect.id.slice("sha256:".length, 39)}`,
    status: "failed",
    result: {
      summary: timeout
        ? `step timed out after ${effect.timeoutMs}ms before provider dispatch`
        : "workflow stopped before provider dispatch",
      providerDispatched: false,
      reason: timeout ? "timeout-before-dispatch" : "stopped-before-dispatch",
    },
  };
}

function settleUndispatchedEffect(statePath, runId, effectId, reason, now) {
  return withStateMutation(statePath, (current) => {
    if (!current || current.runId !== runId) {
      throw new Error(
        "durable workflow run disappeared before undispatched settlement",
      );
    }
    const index = current.effects.findIndex((effect) => effect.id === effectId);
    const effect = current.effects[index];
    if (
      !effect ||
      effect.status !== "pending" ||
      !isKnownUndispatched(effect) ||
      (reason === "timeout" && !(effect.timeoutMs > 0)) ||
      (reason === "stopped" && current.status !== "stopped")
    ) {
      throw new Error("workflow effect is not safely undispatched");
    }
    const result = runtimeNotDispatchedResult(effect, reason);
    const resultDigest = effectResultDigest(result);
    const timeoutObservedAt =
      reason === "timeout" && effect.timeoutObservedAt === null
        ? isoNow(now)
        : effect.timeoutObservedAt;
    const settledAt = isoNow(now);
    const state = transition(
      current,
      "effect-not-dispatched",
      {
        effectId,
        reason,
        resultDigest,
        settlementAuthority: "runtime-not-dispatched",
      },
      (draft) => {
        draft.effects[index] = {
          ...draft.effects[index],
          status: "settled",
          timeoutObservedAt,
          settledAt,
          settlementAuthority: "runtime-not-dispatched",
          resultDigest,
          result,
        };
      },
      now,
    );
    return { state, value: result };
  });
}

function settleEffect(statePath, runId, effectId, rawResult, now) {
  const result = snapshotJson(rawResult, "workflow effect result", 1024 * 1024);
  const resultDigest = effectResultDigest(result);
  if (containsSecret(JSON.stringify(result))) {
    throw new Error("workflow effect result contains secret-shaped data");
  }
  return withStateMutation(statePath, (current) => {
    if (!current || current.runId !== runId) {
      throw new Error("durable workflow run disappeared before settlement");
    }
    const index = current.effects.findIndex((effect) => effect.id === effectId);
    const effect = current.effects[index];
    if (!effect || effect.status !== "pending") {
      throw new Error("workflow effect is not pending at settlement");
    }
    if (
      hasProviderDispatchMetadata(effect) &&
      typeof effect.providerDispatchedAt !== "string"
    ) {
      throw new Error("workflow effect provider dispatch was not persisted");
    }
    if (
      (effect.calls || []).some((call) =>
        ["started", "outcome_unknown"].includes(call.status),
      )
    ) {
      throw new Error(
        "workflow effect has an unsettled or outcome-unknown durable child call",
      );
    }
    const settledAt = isoNow(now);
    const state = transition(
      current,
      "effect-settled",
      { effectId, resultDigest, settlementAuthority: "provider-return" },
      (draft) => {
        draft.effects[index] = {
          ...draft.effects[index],
          status: "settled",
          settledAt,
          settlementAuthority: "provider-return",
          resultDigest,
          result,
        };
      },
      now,
    );
    return { state, value: result };
  });
}

function blockPendingEffect(statePath, runId, effectId, now) {
  return withStateMutation(statePath, (current) => {
    if (!current || current.runId !== runId) return { value: current };
    const effect = current.effects.find((entry) => entry.id === effectId);
    if (
      !effect ||
      effect.status !== "pending" ||
      current.status === "stopped"
    ) {
      return { value: current };
    }
    if (current.status === "blocked") return { value: current };
    const state = transition(
      current,
      "effect-reconciliation-required",
      { effectId },
      (draft) => {
        draft.status = "blocked";
      },
      now,
    );
    return { state, value: state };
  });
}

function finalizePauseAfterSettlementBarrier(statePath, runId, now) {
  return withStateMutation(statePath, (current) => {
    if (!current || current.runId !== runId) return { value: current };
    if (current.status !== "pause_requested") return { value: current };
    if (current.effects.some((effect) => effect.status === "pending")) {
      return { value: current };
    }
    const state = transition(
      current,
      "run-paused",
      { barrier: "all-requested-effects-settled" },
      (draft) => {
        draft.status = "paused";
      },
      now,
    );
    return { state, value: state };
  });
}

function completeRun(statePath, runId, record, now) {
  const finalRecord = snapshotJson(
    record,
    "workflow final record",
    2 * 1024 * 1024,
  );
  return withStateMutation(statePath, (current) => {
    if (!current || current.runId !== runId) {
      throw new Error("durable workflow run disappeared before completion");
    }
    if (current.status === "pause_requested") {
      const state = transition(
        current,
        "run-paused",
        {},
        (draft) => {
          draft.status = "paused";
        },
        now,
      );
      return { state, value: { control: "paused", state } };
    }
    if (current.status === "stopped") {
      return { value: { control: "stopped", state: current } };
    }
    if (current.status !== "running") {
      throw new Error(
        `durable workflow run cannot complete while ${current.status}`,
      );
    }
    const state = transition(
      current,
      "run-completed",
      { recordStatus: finalRecord.status },
      (draft) => {
        draft.status = "completed";
        draft.finalRecord = finalRecord;
      },
      now,
    );
    return { state, value: { record: finalRecord, state } };
  });
}

function markFailed(statePath, runId, error, now) {
  return withStateMutation(statePath, (current) => {
    if (
      !current ||
      current.runId !== runId ||
      TERMINAL_STATUSES.has(current.status) ||
      ["paused", "blocked", "pause_requested"].includes(current.status)
    ) {
      return { value: current };
    }
    const state = transition(
      current,
      "run-failed",
      { code: String(error?.code || "WORKFLOW_RUN_FAILED").slice(0, 256) },
      (draft) => {
        draft.status = "failed";
      },
      now,
    );
    return { state, value: state };
  });
}

export async function executeDurableDynamicWorkflow(options = {}, deps = {}) {
  const statePath = path.resolve(options.statePath);
  const runId = safeId(options.runId, "runId");
  const execution = options.execution;
  const bindings = stateBindings(execution, runId);
  if (typeof deps.runTask !== "function") {
    throw new TypeError("durable workflow task provider is required");
  }
  const initial = startRun(statePath, bindings, deps.now);
  if (initial.status === "completed") return initial.finalRecord;
  const requestEffectForDispatch = createEffectRequestBatcher(
    statePath,
    runId,
    deps.now,
  );
  const artifactStore = deps.artifactStore || new ArtifactStore();
  const durableRunTask = async (args) => {
    const requested = await requestEffectForDispatch(args);
    if (requested.control) {
      throw controlError(
        `dynamic workflow run ${requested.control}`,
        requested.control,
        requested.state,
      );
    }
    if (requested.pending) {
      throw controlError(
        `workflow effect ${requested.effect.id} requires reconciliation`,
        "reconciliation-required",
        requested.state,
        requested.effect,
      );
    }
    if (requested.cached) return requested.result;
    if (typeof deps.beforeProviderDispatch === "function") {
      try {
        await deps.beforeProviderDispatch(requested.effect, args);
      } catch (cause) {
        const state = readDynamicWorkflowRuntimeState(statePath);
        throw controlError(
          `workflow effect ${requested.effect.id} was persisted but not dispatched`,
          "undispatched-recovery-required",
          state,
          requested.effect,
          cause,
        );
      }
    }
    if (
      isKnownUndispatched(requested.effect) &&
      (requested.effect.timeoutObservedAt !== null || args.signal?.aborted)
    ) {
      return settleUndispatchedEffect(
        statePath,
        runId,
        requested.effect.id,
        "timeout",
        deps.now,
      );
    }
    const dispatched = markEffectProviderDispatched(
      statePath,
      runId,
      requested.effect.id,
      deps.now,
    );
    if (dispatched.control === "stopped") {
      settleUndispatchedEffect(
        statePath,
        runId,
        requested.effect.id,
        "stopped",
        deps.now,
      );
      const state = readDynamicWorkflowRuntimeState(statePath);
      throw controlError("dynamic workflow run stopped", "stopped", state);
    }
    const effect = dispatched.effect;
    let timeoutObservationError = null;
    const observeTimeout = () => {
      try {
        observeEffectTimeout(statePath, runId, effect.id, deps.now);
      } catch (error) {
        timeoutObservationError ||= error;
      }
    };
    if (args.signal) {
      args.signal.addEventListener("abort", observeTimeout, { once: true });
      if (args.signal.aborted) observeTimeout();
    }
    let result;
    try {
      const durableCallObservers = createDurableCallObservers(
        statePath,
        runId,
        effect.id,
        deps.now,
        artifactStore,
      );
      result = await deps.runTask({
        ...args,
        workflowEffectId: effect.id,
        ...durableCallObservers,
      });
      if (typeof deps.afterProvider === "function") {
        await deps.afterProvider(effect, result);
      }
      if (timeoutObservationError) throw timeoutObservationError;
    } catch (cause) {
      const state = blockPendingEffect(statePath, runId, effect.id, deps.now);
      throw controlError(
        `workflow effect ${effect.id} has an unknown outcome and requires reconciliation`,
        "reconciliation-required",
        state,
        effect,
        cause,
      );
    } finally {
      args.signal?.removeEventListener("abort", observeTimeout);
    }
    try {
      return settleEffect(statePath, runId, effect.id, result, deps.now);
    } catch (cause) {
      const state = blockPendingEffect(statePath, runId, effect.id, deps.now);
      throw controlError(
        `workflow effect ${effect.id} settlement is unknown and requires reconciliation`,
        "reconciliation-required",
        state,
        effect,
        cause,
      );
    }
  };
  try {
    const record = await (deps.executeWorkflow || executeCoworkWorkflow)({
      ...execution,
      maxParallel: execution.runAdmission.maxParallel,
      runTask: durableRunTask,
    });
    const completed = completeRun(statePath, runId, record, deps.now);
    if (completed.control) {
      throw controlError(
        `dynamic workflow run ${completed.control}`,
        completed.control,
        completed.state,
      );
    }
    return completed.record;
  } catch (error) {
    if (
      error?.code === DYNAMIC_WORKFLOW_RUNTIME_CONTROL_CODE &&
      error.reason === "paused"
    ) {
      const state = finalizePauseAfterSettlementBarrier(
        statePath,
        runId,
        deps.now,
      );
      const pending = state?.effects?.find(
        (effect) => effect.status === "pending",
      );
      if (pending) {
        throw controlError(
          `workflow effect ${pending.id} requires reconciliation before pause can settle`,
          "reconciliation-required",
          state,
          pending,
          error,
        );
      }
      if (state?.status === "stopped") {
        throw controlError(
          "dynamic workflow run stopped while its pause barrier was settling",
          "stopped",
          state,
          null,
          error,
        );
      }
      throw controlError(
        "dynamic workflow run paused after its settlement barrier",
        "paused",
        state,
        null,
        error,
      );
    }
    if (error?.code !== DYNAMIC_WORKFLOW_RUNTIME_CONTROL_CODE) {
      markFailed(statePath, runId, error, deps.now);
    }
    throw error;
  }
}

function requireRevision(state, expectedRevision) {
  const expected = Number(expectedRevision);
  if (!Number.isSafeInteger(expected) || expected < 1) {
    throw new TypeError("expected runtime revision is required");
  }
  if (state.revision !== expected) {
    throw new Error(
      `stale dynamic workflow runtime revision: expected ${expected}, found ${state.revision}`,
    );
  }
}

export function requestDurableWorkflowPause(
  statePath,
  expectedRevision,
  deps = {},
) {
  return withStateMutation(path.resolve(statePath), (current) => {
    if (!current)
      throw new Error("dynamic workflow runtime state was not found");
    requireRevision(current, expectedRevision);
    if (TERMINAL_STATUSES.has(current.status)) {
      throw new Error(`cannot pause a ${current.status} workflow run`);
    }
    const immediate = ["ready", "paused", "failed"].includes(current.status);
    const state = transition(
      current,
      immediate ? "run-paused" : "pause-requested",
      {},
      (draft) => {
        draft.status = immediate ? "paused" : "pause_requested";
      },
      deps.now,
    );
    return { state, value: state };
  });
}

export function requestDurableWorkflowStop(
  statePath,
  expectedRevision,
  deps = {},
) {
  return withStateMutation(path.resolve(statePath), (current) => {
    if (!current)
      throw new Error("dynamic workflow runtime state was not found");
    requireRevision(current, expectedRevision);
    if (current.status === "completed") {
      throw new Error("cannot stop a completed workflow run");
    }
    if (current.status === "stopped") return { value: current };
    const state = transition(
      current,
      "run-stopped",
      {},
      (draft) => {
        draft.status = "stopped";
        draft.finalRecord = null;
      },
      deps.now,
    );
    return { state, value: state };
  });
}

export function prepareDurableWorkflowResume(
  statePath,
  expectedRevision,
  deps = {},
) {
  return withStateMutation(path.resolve(statePath), (current) => {
    if (!current)
      throw new Error("dynamic workflow runtime state was not found");
    requireRevision(current, expectedRevision);
    if (TERMINAL_STATUSES.has(current.status)) {
      throw new Error(`cannot resume a ${current.status} workflow run`);
    }
    const pending = current.effects.find(
      (effect) => effect.status === "pending" && !isKnownUndispatched(effect),
    );
    if (pending) {
      const error = new Error(
        `workflow effect ${pending.id} must be reconciled before resume`,
      );
      error.code = "CC_DYNAMIC_WORKFLOW_EFFECT_RECONCILIATION_REQUIRED";
      error.pendingEffect = pending;
      throw error;
    }
    const state = transition(
      current,
      "run-resume-authorized",
      {},
      (draft) => {
        draft.status = "ready";
      },
      deps.now,
    );
    return { state, value: state };
  });
}

export function reconcileDurableWorkflowEffect(
  statePath,
  input = {},
  deps = {},
) {
  const effectId = String(input.effectId || "")
    .trim()
    .toLowerCase();
  if (!SHA256_RE.test(effectId)) throw new TypeError("effectId is invalid");
  const result = snapshotJson(
    input.result,
    "workflow reconciled effect result",
    1024 * 1024,
  );
  if (containsSecret(JSON.stringify(result))) {
    throw new Error("workflow reconciled result contains secret-shaped data");
  }
  const resultDigest = effectResultDigest(result);
  return withStateMutation(path.resolve(statePath), (current) => {
    if (!current)
      throw new Error("dynamic workflow runtime state was not found");
    requireRevision(current, input.expectedRevision);
    const index = current.effects.findIndex((effect) => effect.id === effectId);
    const effect = current.effects[index];
    if (!effect || effect.status !== "pending") {
      throw new Error("workflow effect is not pending reconciliation");
    }
    if (isKnownUndispatched(effect)) {
      throw new Error(
        "workflow effect was not dispatched and must be resumed instead of reconciled",
      );
    }
    const firstPending = current.effects.find(
      (candidate) =>
        candidate.status === "pending" && !isKnownUndispatched(candidate),
    );
    if (firstPending?.id !== effectId) {
      const error = new Error(
        `workflow effect ${firstPending.id} must be reconciled before ${effectId}`,
      );
      error.code = "CC_DYNAMIC_WORKFLOW_EFFECT_RECONCILIATION_OUT_OF_ORDER";
      error.pendingEffect = firstPending;
      throw error;
    }
    const settledAt = isoNow(deps.now);
    const state = transition(
      current,
      "effect-reconciled",
      { effectId, resultDigest, settlementAuthority: "operator-reconciled" },
      (draft) => {
        const calls = (draft.effects[index].calls || []).map((call) =>
          call.status === "started"
            ? {
                ...call,
                status: "operator_reconciled",
                settledAt,
                outcomeUnknown: false,
                settlementCode: "operator_reconciled",
              }
            : call,
        );
        draft.effects[index] = {
          ...draft.effects[index],
          calls,
          status: "settled",
          settledAt,
          settlementAuthority: "operator-reconciled",
          resultDigest,
          result,
        };
        const unknownPendingRemain = draft.effects.some(
          (candidate) =>
            candidate.status === "pending" && !isKnownUndispatched(candidate),
        );
        if (draft.status === "blocked" && !unknownPendingRemain) {
          draft.status = "ready";
        }
      },
      deps.now,
    );
    return { state, value: state };
  });
}

function reportedContentDigest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  for (const candidate of [value.sha256, value.digest, value.recordDigest]) {
    if (typeof candidate !== "string") continue;
    const normalized = candidate.startsWith("sha256:")
      ? candidate.toLowerCase()
      : `sha256:${candidate.toLowerCase()}`;
    if (SHA256_RE.test(normalized)) return normalized;
  }
  return null;
}

function projectResultValues(effect, field, domain) {
  const values = effect.result?.result?.[field];
  if (!Array.isArray(values)) {
    return { count: 0, truncated: false, lineage: [] };
  }
  const visible = values.slice(0, MAX_PROJECTED_ARTIFACTS_PER_EFFECT);
  return {
    count: values.length,
    truncated: values.length > visible.length,
    lineage: visible.map((value, ordinal) => ({
      effectId: effect.id,
      ordinal,
      valueDigest: digest(domain, value),
      reportedContentDigest: reportedContentDigest(value),
    })),
  };
}

function projectLegacyProviderRequestReceipts(effect) {
  const attemptValues = Array.isArray(effect.result?.providerRequestAttempts)
    ? effect.result.providerRequestAttempts
    : [];
  const receiptValues = Array.isArray(effect.result?.providerRequestReceipts)
    ? effect.result.providerRequestReceipts
    : [];
  const visibleAttempts = attemptValues.slice(
    0,
    MAX_PROJECTED_ARTIFACTS_PER_EFFECT,
  );
  const visibleReceipts = receiptValues.slice(
    0,
    MAX_PROJECTED_ARTIFACTS_PER_EFFECT,
  );
  const attemptLineage = [];
  const receiptLineage = [];
  const attemptsByCallId = new Map();
  const matchedAttemptCallIds = new Set();
  let invalidAttempts = 0;
  let invalidReceipts = 0;

  for (let ordinal = 0; ordinal < visibleAttempts.length; ordinal += 1) {
    const attempt = visibleAttempts[ordinal];
    if (
      effect.settlementAuthority !== "provider-return" ||
      effect.result?.workflowEffectId !== effect.id ||
      !attempt ||
      typeof attempt !== "object" ||
      Array.isArray(attempt) ||
      attempt.protocol !== "cc-provider-request-attempt/v1" ||
      attempt.workflowEffectId !== effect.id ||
      !PROVIDER_NAME_RE.test(attempt.provider || "") ||
      !PROVIDER_RECEIPT_ID_RE.test(attempt.callId || "") ||
      !Number.isSafeInteger(attempt.callSequence) ||
      attempt.callSequence < 1 ||
      !["model", "semantic-compaction"].includes(attempt.source) ||
      !PROVIDER_CLIENT_REQUEST_ID_RE.test(attempt.clientRequestId || "") ||
      attempt.requestIdentitySemantics !== "trace-only" ||
      attemptsByCallId.has(attempt.callId)
    ) {
      invalidAttempts += 1;
      continue;
    }
    const projected = {
      effectId: effect.id,
      ordinal,
      provider: attempt.provider,
      callId: attempt.callId,
      callSequence: attempt.callSequence,
      source: attempt.source,
      clientRequestId: attempt.clientRequestId,
      requestIdentitySemantics: "trace-only",
    };
    attemptsByCallId.set(attempt.callId, projected);
    attemptLineage.push(projected);
  }

  for (let ordinal = 0; ordinal < visibleReceipts.length; ordinal += 1) {
    const receipt = visibleReceipts[ordinal];
    const requestId = receipt?.requestId ?? null;
    const responseId = receipt?.responseId ?? null;
    const attempt = attemptsByCallId.get(receipt?.callId);
    if (
      effect.settlementAuthority !== "provider-return" ||
      effect.result?.workflowEffectId !== effect.id ||
      !receipt ||
      typeof receipt !== "object" ||
      Array.isArray(receipt) ||
      receipt.protocol !== "cc-provider-request-receipt/v1" ||
      receipt.workflowEffectId !== effect.id ||
      !PROVIDER_NAME_RE.test(receipt.provider || "") ||
      typeof receipt.callId !== "string" ||
      !PROVIDER_RECEIPT_ID_RE.test(receipt.callId) ||
      !Number.isSafeInteger(receipt.callSequence) ||
      receipt.callSequence < 1 ||
      !["model", "semantic-compaction"].includes(receipt.source) ||
      !PROVIDER_CLIENT_REQUEST_ID_RE.test(receipt.clientRequestId || "") ||
      (requestId !== null && !PROVIDER_RECEIPT_ID_RE.test(requestId)) ||
      (responseId !== null && !PROVIDER_RECEIPT_ID_RE.test(responseId)) ||
      (!requestId && !responseId) ||
      receipt.requestIdentitySemantics !== "trace-only" ||
      receipt.independentlyReadable !== false ||
      !attempt ||
      attempt.provider !== receipt.provider ||
      attempt.callSequence !== receipt.callSequence ||
      attempt.source !== receipt.source ||
      attempt.clientRequestId !== receipt.clientRequestId ||
      matchedAttemptCallIds.has(receipt.callId)
    ) {
      invalidReceipts += 1;
      continue;
    }
    matchedAttemptCallIds.add(receipt.callId);
    receiptLineage.push({
      effectId: effect.id,
      ordinal,
      provider: receipt.provider,
      callId: receipt.callId,
      callSequence: receipt.callSequence,
      source: receipt.source,
      clientRequestId: receipt.clientRequestId,
      requestId,
      responseId,
      requestIdentitySemantics: "trace-only",
      independentlyReadable: false,
    });
  }
  return {
    attemptCount: attemptValues.length,
    receiptCount: receiptValues.length,
    invalidAttempts,
    invalidReceipts,
    missingReceipts: attemptLineage.length - matchedAttemptCallIds.size,
    truncated:
      attemptValues.length > visibleAttempts.length ||
      receiptValues.length > visibleReceipts.length,
    attemptLineage,
    receiptLineage,
  };
}

function projectProviderRequestReceipts(state) {
  const attemptLineage = [];
  const receiptLineage = [];
  const requestAttemptEffectIds = new Set();
  const receiptEffectIds = new Set();
  const providerReturnedReceiptEffectIds = new Set();
  let attemptCount = 0;
  let receiptCount = 0;
  let invalidAttempts = 0;
  let invalidReceipts = 0;
  let missingReceipts = 0;
  let truncatedEffects = 0;
  let durableCallEffects = 0;
  let legacyResultFallbackEffects = 0;
  let conflictingOuterResultEffects = 0;

  for (const effect of state.effects) {
    const providerCalls = (effect.calls || []).filter(
      (call) => call.kind === "provider",
    );
    if (providerCalls.length > 0) {
      durableCallEffects += 1;
      attemptCount += providerCalls.length;
      receiptCount += providerCalls.filter(
        (call) => call.providerReceiptPersisted,
      ).length;
      missingReceipts += providerCalls.filter(
        (call) => !call.providerReceiptPersisted,
      ).length;
      requestAttemptEffectIds.add(effect.id);
      if (providerCalls.some((call) => call.providerReceiptPersisted)) {
        receiptEffectIds.add(effect.id);
        if (effect.settlementAuthority === "provider-return") {
          providerReturnedReceiptEffectIds.add(effect.id);
        }
      }
      const hasOuterResultEvidence =
        Array.isArray(effect.result?.providerRequestAttempts) ||
        Array.isArray(effect.result?.providerRequestReceipts);
      if (hasOuterResultEvidence) {
        const reported = projectLegacyProviderRequestReceipts(effect);
        const directCalls = providerCalls.filter(
          (call) => call.ownerEffectId === effect.id,
        );
        const attemptMatches =
          reported.invalidAttempts === 0 &&
          reported.attemptLineage.length === directCalls.length &&
          directCalls.every((call) => {
            const attempt = reported.attemptLineage.find(
              (candidate) => candidate.callId === call.callId,
            );
            return (
              attempt?.provider === call.name &&
              attempt?.callSequence === call.sequence &&
              attempt?.source === call.requestSource &&
              attempt?.clientRequestId === call.clientRequestId
            );
          });
        const directReceiptCalls = directCalls.filter(
          (call) => call.providerReceiptPersisted,
        );
        const receiptMatches =
          reported.invalidReceipts === 0 &&
          reported.receiptLineage.length === directReceiptCalls.length &&
          directReceiptCalls.every((call) => {
            const receipt = reported.receiptLineage.find(
              (candidate) => candidate.callId === call.callId,
            );
            return (
              receipt?.requestId === call.providerReceiptRequestId &&
              receipt?.responseId === call.providerReceiptResponseId
            );
          });
        if (!attemptMatches || !receiptMatches) {
          conflictingOuterResultEffects += 1;
        }
      }
      const visibleCalls = providerCalls.slice(
        0,
        MAX_PROJECTED_ARTIFACTS_PER_EFFECT,
      );
      if (providerCalls.length > visibleCalls.length) truncatedEffects += 1;
      for (let ordinal = 0; ordinal < visibleCalls.length; ordinal += 1) {
        const call = visibleCalls[ordinal];
        const attempt = {
          effectId: effect.id,
          ownerEffectId: call.ownerEffectId,
          callRecordId: call.id,
          ordinal,
          provider: call.name,
          callId: call.callId,
          callSequence: call.sequence,
          source: call.requestSource,
          attributionSource: call.source,
          clientRequestId: call.clientRequestId,
          status: call.status,
          startedAt: call.startedAt,
          requestIdentitySemantics: "trace-only",
          authoritySource: "durable-call-store",
        };
        attemptLineage.push(attempt);
        if (!call.providerReceiptPersisted) continue;
        receiptLineage.push({
          ...attempt,
          requestId: call.providerReceiptRequestId,
          responseId: call.providerReceiptResponseId,
          recordedAt:
            call.providerReceiptRecordedAt === undefined
              ? call.settledAt
              : call.providerReceiptRecordedAt,
          independentlyReadable: false,
        });
      }
      continue;
    }

    if (effect.status !== "settled") continue;
    const hasOuterResultEvidence =
      Array.isArray(effect.result?.providerRequestAttempts) ||
      Array.isArray(effect.result?.providerRequestReceipts);
    if (effect.calls !== undefined) {
      if (
        hasOuterResultEvidence &&
        ((effect.result?.providerRequestAttempts?.length || 0) > 0 ||
          (effect.result?.providerRequestReceipts?.length || 0) > 0)
      ) {
        conflictingOuterResultEffects += 1;
      }
      continue;
    }
    const legacy = projectLegacyProviderRequestReceipts(effect);
    if (legacy.attemptCount === 0 && legacy.receiptCount === 0) continue;
    legacyResultFallbackEffects += 1;
    attemptCount += legacy.attemptCount;
    receiptCount += legacy.receiptCount;
    invalidAttempts += legacy.invalidAttempts;
    invalidReceipts += legacy.invalidReceipts;
    missingReceipts += legacy.missingReceipts;
    if (legacy.truncated) truncatedEffects += 1;
    if (legacy.attemptLineage.length > 0) {
      requestAttemptEffectIds.add(effect.id);
    }
    if (legacy.receiptLineage.length > 0) {
      receiptEffectIds.add(effect.id);
      providerReturnedReceiptEffectIds.add(effect.id);
    }
    attemptLineage.push(
      ...legacy.attemptLineage.map((attempt) => ({
        ...attempt,
        authoritySource: "legacy-task-result",
      })),
    );
    receiptLineage.push(
      ...legacy.receiptLineage.map((receipt) => ({
        ...receipt,
        recordedAt: effect.settledAt,
        authoritySource: "legacy-task-result",
      })),
    );
  }

  return {
    attemptCount,
    receiptCount,
    invalidAttempts,
    invalidReceipts,
    missingReceipts,
    truncatedEffects,
    durableCallEffects,
    legacyResultFallbackEffects,
    conflictingOuterResultEffects,
    requestAttemptEffects: requestAttemptEffectIds.size,
    receiptEffects: receiptEffectIds.size,
    providerReturnedReceiptEffects: providerReturnedReceiptEffectIds.size,
    attemptLineage,
    receiptLineage,
  };
}

function expectedNestedToolEffectId(effectId, sequence, toolUseId, tool) {
  return `sha256:${createHash("sha256")
    .update(
      `${effectId}\0tool\0${String(sequence)}\0${toolUseId}\0${tool}`,
      "utf8",
    )
    .digest("hex")}`;
}

function projectLegacyNestedToolEffects(effect) {
  const attemptValues = Array.isArray(effect.result?.nestedEffectAttempts)
    ? effect.result.nestedEffectAttempts
    : [];
  const settlementValues = Array.isArray(effect.result?.nestedEffectSettlements)
    ? effect.result.nestedEffectSettlements
    : [];
  const visibleAttempts = attemptValues.slice(
    0,
    MAX_PROJECTED_ARTIFACTS_PER_EFFECT,
  );
  const visibleSettlements = settlementValues.slice(
    0,
    MAX_PROJECTED_ARTIFACTS_PER_EFFECT,
  );
  const attemptsById = new Map();
  const settledIds = new Set();
  const attemptLineage = [];
  const settlementLineage = [];
  let invalidAttempts = 0;
  let invalidSettlements = 0;
  let durableMcpSettlements = 0;

  for (let ordinal = 0; ordinal < visibleAttempts.length; ordinal += 1) {
    const attempt = visibleAttempts[ordinal];
    const expectedId =
      attempt &&
      expectedNestedToolEffectId(
        effect.id,
        attempt.childSequence,
        attempt.toolUseId,
        attempt.tool,
      );
    if (
      effect.settlementAuthority !== "provider-return" ||
      effect.result?.workflowEffectId !== effect.id ||
      !attempt ||
      typeof attempt !== "object" ||
      Array.isArray(attempt) ||
      attempt.protocol !== WORKFLOW_CHILD_EFFECT_PROTOCOL ||
      attempt.workflowEffectId !== effect.id ||
      !SHA256_RE.test(attempt.childEffectId || "") ||
      attempt.childEffectId !== expectedId ||
      !Number.isSafeInteger(attempt.childSequence) ||
      attempt.childSequence < 1 ||
      attempt.kind !== "tool" ||
      !WORKFLOW_TOOL_NAME_RE.test(attempt.tool || "") ||
      !WORKFLOW_TOOL_CALL_ID_RE.test(attempt.toolUseId || "") ||
      attempt.identitySemantics !== "runtime-derived" ||
      attemptsById.has(attempt.childEffectId) ||
      [...attemptsById.values()].some(
        (existing) => existing.childSequence === attempt.childSequence,
      )
    ) {
      invalidAttempts += 1;
      continue;
    }
    const projected = {
      effectId: effect.id,
      ordinal,
      childEffectId: attempt.childEffectId,
      childSequence: attempt.childSequence,
      kind: "tool",
      tool: attempt.tool,
      toolUseId: attempt.toolUseId,
      identitySemantics: "runtime-derived",
    };
    attemptsById.set(attempt.childEffectId, projected);
    attemptLineage.push(projected);
  }

  for (let ordinal = 0; ordinal < visibleSettlements.length; ordinal += 1) {
    const settlement = visibleSettlements[ordinal];
    const attempt = attemptsById.get(settlement?.childEffectId);
    const mcpLedgerId = settlement?.mcpLedgerId ?? null;
    const validMcpLedgerId =
      mcpLedgerId === null || PROVIDER_RECEIPT_ID_RE.test(mcpLedgerId);
    const mcpPersistenceValid =
      mcpLedgerId === null
        ? settlement?.mcpLedgerPrewritePersisted === false &&
          settlement?.mcpLedgerSettlementPersisted === false
        : typeof settlement?.mcpLedgerPrewritePersisted === "boolean" &&
          typeof settlement?.mcpLedgerSettlementPersisted === "boolean" &&
          (!settlement.mcpLedgerSettlementPersisted ||
            settlement.mcpLedgerPrewritePersisted);
    if (
      effect.settlementAuthority !== "provider-return" ||
      effect.result?.workflowEffectId !== effect.id ||
      !settlement ||
      typeof settlement !== "object" ||
      Array.isArray(settlement) ||
      settlement.protocol !== WORKFLOW_CHILD_EFFECT_PROTOCOL ||
      settlement.workflowEffectId !== effect.id ||
      !attempt ||
      settlement.childSequence !== attempt.childSequence ||
      settlement.kind !== "tool" ||
      settlement.tool !== attempt.tool ||
      settlement.toolUseId !== attempt.toolUseId ||
      !["completed", "failed"].includes(settlement.status) ||
      settlement.outcomeUnknown !== false ||
      !validMcpLedgerId ||
      !mcpPersistenceValid ||
      settledIds.has(settlement.childEffectId)
    ) {
      invalidSettlements += 1;
      continue;
    }
    settledIds.add(settlement.childEffectId);
    if (
      mcpLedgerId &&
      settlement.mcpLedgerPrewritePersisted &&
      settlement.mcpLedgerSettlementPersisted
    ) {
      durableMcpSettlements += 1;
    }
    settlementLineage.push({
      effectId: effect.id,
      ordinal,
      childEffectId: settlement.childEffectId,
      childSequence: settlement.childSequence,
      kind: "tool",
      tool: settlement.tool,
      toolUseId: settlement.toolUseId,
      status: settlement.status,
      outcomeUnknown: false,
      mcpLedgerId,
      mcpLedgerPrewritePersisted:
        settlement.mcpLedgerPrewritePersisted === true,
      mcpLedgerSettlementPersisted:
        settlement.mcpLedgerSettlementPersisted === true,
    });
  }

  return {
    attemptCount: attemptValues.length,
    settlementCount: settlementValues.length,
    invalidAttempts,
    invalidSettlements,
    missingSettlements: attemptLineage.length - settledIds.size,
    durableMcpSettlements,
    truncated:
      attemptValues.length > visibleAttempts.length ||
      settlementValues.length > visibleSettlements.length,
    attemptLineage,
    settlementLineage,
  };
}

function projectNestedToolEffects(state) {
  const attemptLineage = [];
  const settlementLineage = [];
  let attemptCount = 0;
  let settlementCount = 0;
  let invalidAttempts = 0;
  let invalidSettlements = 0;
  let missingSettlements = 0;
  let durableMcpSettlements = 0;
  let truncatedEffects = 0;
  let durableCallEffects = 0;
  let legacyResultFallbackEffects = 0;
  let conflictingOuterResultEffects = 0;

  for (const effect of state.effects) {
    const toolCalls = (effect.calls || []).filter(
      (call) => call.kind === "tool",
    );
    if (toolCalls.length > 0) {
      durableCallEffects += 1;
      attemptCount += toolCalls.length;
      settlementCount += toolCalls.filter(
        (call) => call.status !== "started",
      ).length;
      missingSettlements += toolCalls.filter(
        (call) => call.status === "started",
      ).length;
      durableMcpSettlements += toolCalls.filter(
        (call) =>
          call.mcpLedgerId &&
          call.mcpLedgerPrewritePersisted &&
          call.mcpLedgerSettlementPersisted,
      ).length;

      const hasOuterResultEvidence =
        Array.isArray(effect.result?.nestedEffectAttempts) ||
        Array.isArray(effect.result?.nestedEffectSettlements);
      if (hasOuterResultEvidence) {
        const reported = projectLegacyNestedToolEffects(effect);
        const directCalls = toolCalls.filter(
          (call) => call.ownerEffectId === effect.id,
        );
        const attemptMatches =
          reported.invalidAttempts === 0 &&
          reported.attemptLineage.length === directCalls.length &&
          directCalls.every((call) => {
            const attempt = reported.attemptLineage.find(
              (candidate) => candidate.childEffectId === call.childEffectId,
            );
            return (
              attempt?.childSequence === call.sequence &&
              attempt?.tool === call.name &&
              attempt?.toolUseId === call.callId
            );
          });
        const directTerminalCalls = directCalls.filter(
          (call) => call.status !== "started",
        );
        const settlementMatches =
          reported.invalidSettlements === 0 &&
          reported.settlementLineage.length === directTerminalCalls.length &&
          directTerminalCalls.every((call) => {
            const settlement = reported.settlementLineage.find(
              (candidate) => candidate.childEffectId === call.childEffectId,
            );
            return (
              settlement?.status === call.status &&
              settlement?.mcpLedgerId === call.mcpLedgerId &&
              settlement?.mcpLedgerPrewritePersisted ===
                call.mcpLedgerPrewritePersisted &&
              settlement?.mcpLedgerSettlementPersisted ===
                call.mcpLedgerSettlementPersisted
            );
          });
        if (!attemptMatches || !settlementMatches) {
          conflictingOuterResultEffects += 1;
        }
      }

      const visibleCalls = toolCalls.slice(
        0,
        MAX_PROJECTED_ARTIFACTS_PER_EFFECT,
      );
      if (toolCalls.length > visibleCalls.length) truncatedEffects += 1;
      for (let ordinal = 0; ordinal < visibleCalls.length; ordinal += 1) {
        const call = visibleCalls[ordinal];
        const attempt = {
          effectId: effect.id,
          ownerEffectId: call.ownerEffectId,
          callRecordId: call.id,
          ordinal,
          childEffectId: call.childEffectId,
          childSequence: call.sequence,
          kind: "tool",
          tool: call.name,
          toolUseId: call.callId,
          status: call.status,
          startedAt: call.startedAt,
          identitySemantics: "runtime-derived",
          authoritySource: "durable-call-store",
        };
        attemptLineage.push(attempt);
        if (call.status === "started") continue;
        settlementLineage.push({
          ...attempt,
          settledAt: call.settledAt,
          outcomeUnknown: call.outcomeUnknown,
          settlementCode: call.settlementCode,
          mcpLedgerId: call.mcpLedgerId,
          mcpLedgerPrewritePersisted: call.mcpLedgerPrewritePersisted,
          mcpLedgerSettlementPersisted: call.mcpLedgerSettlementPersisted,
        });
      }
      continue;
    }

    if (effect.status !== "settled") continue;
    const hasOuterResultEvidence =
      Array.isArray(effect.result?.nestedEffectAttempts) ||
      Array.isArray(effect.result?.nestedEffectSettlements);
    if (effect.calls !== undefined) {
      if (
        hasOuterResultEvidence &&
        ((effect.result?.nestedEffectAttempts?.length || 0) > 0 ||
          (effect.result?.nestedEffectSettlements?.length || 0) > 0)
      ) {
        conflictingOuterResultEffects += 1;
      }
      continue;
    }
    const legacy = projectLegacyNestedToolEffects(effect);
    if (legacy.attemptCount === 0 && legacy.settlementCount === 0) continue;
    legacyResultFallbackEffects += 1;
    attemptCount += legacy.attemptCount;
    settlementCount += legacy.settlementCount;
    invalidAttempts += legacy.invalidAttempts;
    invalidSettlements += legacy.invalidSettlements;
    missingSettlements += legacy.missingSettlements;
    durableMcpSettlements += legacy.durableMcpSettlements;
    if (legacy.truncated) truncatedEffects += 1;
    attemptLineage.push(
      ...legacy.attemptLineage.map((attempt) => ({
        ...attempt,
        authoritySource: "legacy-task-result",
      })),
    );
    settlementLineage.push(
      ...legacy.settlementLineage.map((settlement) => ({
        ...settlement,
        settledAt: effect.settledAt,
        authoritySource: "legacy-task-result",
      })),
    );
  }

  return {
    attemptCount,
    settlementCount,
    invalidAttempts,
    invalidSettlements,
    missingSettlements,
    durableMcpSettlements,
    truncatedEffects,
    durableCallEffects,
    legacyResultFallbackEffects,
    conflictingOuterResultEffects,
    attemptLineage,
    settlementLineage,
  };
}

function projectDurableWorkflowCalls(state) {
  const lineage = state.effects.flatMap((effect) =>
    (effect.calls || []).map((call) => ({
      effectId: effect.id,
      callRecordId: call.id,
      kind: call.kind,
      protocol: call.protocol,
      ownerEffectId: call.ownerEffectId ?? effect.id,
      childEffectId: call.childEffectId,
      sequence: call.sequence,
      name: call.name,
      source: call.source,
      requestSource:
        call.requestSource ?? (call.kind === "provider" ? call.source : null),
      descendant: (call.ownerEffectId ?? effect.id) !== effect.id,
      status: call.status,
      startedAt: call.startedAt,
      settledAt: call.settledAt,
      outcomeUnknown: call.outcomeUnknown,
      settlementCode: call.settlementCode,
      providerReceipt: call.providerReceiptPersisted
        ? {
            protocol: "cc-provider-request-receipt/v1",
            requestId: call.providerReceiptRequestId,
            responseId: call.providerReceiptResponseId,
            recordedAt:
              call.providerReceiptRecordedAt === undefined
                ? call.settledAt
                : call.providerReceiptRecordedAt,
            requestIdentitySemantics: "trace-only",
            independentlyReadable: false,
          }
        : null,
      providerUsage:
        call.kind === "provider" && validProviderUsage(call.providerUsage)
          ? {
              ...call.providerUsage,
              recordedAt: call.settledAt,
            }
          : null,
      providerUsageSchemaPresent:
        call.kind === "provider" &&
        Object.prototype.hasOwnProperty.call(call, "providerUsage"),
      providerModel:
        call.kind === "provider" &&
        Object.prototype.hasOwnProperty.call(call, "providerModel")
          ? call.providerModel
          : null,
      providerPricing:
        call.kind === "provider" &&
        validProviderPricing(
          call.providerPricing,
          call.name,
          call.providerModel,
        )
          ? call.providerPricing
          : null,
      providerCostEstimate:
        call.kind === "provider" &&
        validProviderCostEstimate(
          call.providerCostEstimate,
          call.providerPricing,
          call.providerUsage,
        )
          ? call.providerCostEstimate
          : null,
      providerCostSchemaPresent:
        call.kind === "provider" &&
        ["providerModel", "providerPricing", "providerCostEstimate"].every(
          (field) => Object.prototype.hasOwnProperty.call(call, field),
        ),
      artifactReadback:
        call.kind === "tool" && validArtifactReadback(call.artifactReadback)
          ? call.artifactReadback
          : null,
      artifactReadbackSchemaPresent:
        call.kind === "tool" &&
        Object.prototype.hasOwnProperty.call(call, "artifactReadback"),
      mcpLedgerId: call.mcpLedgerId,
      mcpLedgerPrewritePersisted: call.mcpLedgerPrewritePersisted,
      mcpLedgerSettlementPersisted: call.mcpLedgerSettlementPersisted,
    })),
  );
  return {
    authority: "runtime-state-hash-chain-fsync",
    count: lineage.length,
    started: lineage.filter((call) => call.status === "started").length,
    completed: lineage.filter((call) => call.status === "completed").length,
    failed: lineage.filter((call) => call.status === "failed").length,
    outcomeUnknown: lineage.filter((call) => call.status === "outcome_unknown")
      .length,
    operatorReconciled: lineage.filter(
      (call) => call.status === "operator_reconciled",
    ).length,
    descendants: lineage.filter((call) => call.descendant).length,
    providerReceipts: lineage.filter((call) => call.providerReceipt !== null)
      .length,
    providerUsageRecords: lineage.filter((call) => call.providerUsage !== null)
      .length,
    providerCostEstimateRecords: lineage.filter(
      (call) => call.providerCostEstimate !== null,
    ).length,
    artifactReadbackRecords: lineage.filter(
      (call) => call.artifactReadback !== null,
    ).length,
    providerNativeIdempotencyProven: false,
    providerReceiptsIndependentlyReadable: false,
    lineageDigest: digest(
      "chainlesschain.dynamic-workflow.durable-call-lineage.v1\0",
      lineage,
    ),
    lineage,
  };
}

function projectProviderTokenUsage(state) {
  const totals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    totalTokens: 0,
  };
  const lineage = [];
  const observedEffectIds = new Set();
  let providerCalls = 0;
  let pendingCalls = 0;
  let outcomeUnknownCalls = 0;
  let operatorReconciledCalls = 0;
  let legacyCalls = 0;
  for (const effect of state.effects) {
    for (const call of effect.calls || []) {
      if (call.kind !== "provider") continue;
      providerCalls += 1;
      if (call.status === "started") pendingCalls += 1;
      if (call.status === "outcome_unknown") outcomeUnknownCalls += 1;
      if (call.status === "operator_reconciled") operatorReconciledCalls += 1;
      if (!Object.prototype.hasOwnProperty.call(call, "providerUsage")) {
        legacyCalls += 1;
        continue;
      }
      if (!validProviderUsage(call.providerUsage)) continue;
      observedEffectIds.add(effect.id);
      totals.inputTokens += call.providerUsage.inputTokens;
      totals.outputTokens += call.providerUsage.outputTokens;
      totals.cacheReadInputTokens += call.providerUsage.cacheReadInputTokens;
      totals.cacheCreationInputTokens +=
        call.providerUsage.cacheCreationInputTokens;
      totals.totalTokens += call.providerUsage.totalTokens;
      lineage.push({
        effectId: effect.id,
        ownerEffectId: call.ownerEffectId ?? effect.id,
        callRecordId: call.id,
        callId: call.callId,
        sequence: call.sequence,
        provider: call.name,
        model: Object.prototype.hasOwnProperty.call(call, "providerModel")
          ? call.providerModel
          : null,
        source: call.source,
        requestSource: call.requestSource ?? call.source,
        descendant: (call.ownerEffectId ?? effect.id) !== effect.id,
        settledAt: call.settledAt,
        usage: call.providerUsage,
        usageDigest: providerUsageDigest(call.providerUsage),
      });
    }
  }
  return {
    authority:
      legacyCalls > 0
        ? "runtime-state-hash-chain-fsync-with-legacy-call-schema"
        : "runtime-state-hash-chain-fsync",
    crashVisible: true,
    providerCalls,
    providerReportedCalls: lineage.length,
    providerReportedEffects: observedEffectIds.size,
    missingProviderReportedCalls: providerCalls - lineage.length,
    pendingCalls,
    outcomeUnknownCalls,
    operatorReconciledCalls,
    legacyCalls,
    providerReported: lineage.length > 0 ? totals : null,
    lineageDigest: digest(
      "chainlesschain.dynamic-workflow.provider-token-usage-lineage.v1\0",
      lineage,
    ),
    lineage,
  };
}

function projectProviderCostEstimates(state) {
  const lineage = [];
  const pricedEffectIds = new Set();
  let providerCalls = 0;
  let pricingSnapshotCalls = 0;
  let pendingCalls = 0;
  let outcomeUnknownCalls = 0;
  let operatorReconciledCalls = 0;
  let unpricedCalls = 0;
  let modelMissingCalls = 0;
  let legacyCalls = 0;
  let estimatedUsd = 0;
  for (const effect of state.effects) {
    for (const call of effect.calls || []) {
      if (call.kind !== "provider") continue;
      providerCalls += 1;
      if (call.status === "started") pendingCalls += 1;
      if (call.status === "outcome_unknown") outcomeUnknownCalls += 1;
      if (call.status === "operator_reconciled") operatorReconciledCalls += 1;
      const hasSchema = [
        "providerModel",
        "providerPricing",
        "providerCostEstimate",
      ].every((field) => Object.prototype.hasOwnProperty.call(call, field));
      if (!hasSchema) {
        legacyCalls += 1;
        continue;
      }
      if (call.providerModel === null) modelMissingCalls += 1;
      if (
        validProviderPricing(
          call.providerPricing,
          call.name,
          call.providerModel,
        )
      ) {
        pricingSnapshotCalls += 1;
      }
      if (
        call.status === "completed" &&
        validProviderUsage(call.providerUsage) &&
        call.providerPricing === null
      ) {
        unpricedCalls += 1;
      }
      if (
        !validProviderCostEstimate(
          call.providerCostEstimate,
          call.providerPricing,
          call.providerUsage,
        )
      ) {
        continue;
      }
      pricedEffectIds.add(effect.id);
      estimatedUsd += call.providerCostEstimate.totalUsd;
      lineage.push({
        effectId: effect.id,
        ownerEffectId: call.ownerEffectId ?? effect.id,
        callRecordId: call.id,
        callId: call.callId,
        sequence: call.sequence,
        provider: call.name,
        model: call.providerModel,
        source: call.source,
        requestSource: call.requestSource ?? call.source,
        descendant: (call.ownerEffectId ?? effect.id) !== effect.id,
        settledAt: call.settledAt,
        pricing: call.providerPricing,
        estimate: call.providerCostEstimate,
        estimateDigest: providerCostEstimateDigest(call.providerCostEstimate),
      });
    }
  }
  return {
    authority:
      legacyCalls > 0
        ? "durable-pricing-snapshot-estimate-with-legacy-call-schema"
        : "durable-pricing-snapshot-estimate",
    currency: "USD",
    reportedUsd: null,
    estimatedUsd: lineage.length > 0 ? estimatedUsd : null,
    providerCalls,
    pricingSnapshotCalls,
    pricedCalls: lineage.length,
    pricedEffects: pricedEffectIds.size,
    missingEstimateCalls: providerCalls - lineage.length,
    pendingCalls,
    outcomeUnknownCalls,
    operatorReconciledCalls,
    unpricedCalls,
    modelMissingCalls,
    legacyCalls,
    lineageDigest: digest(
      "chainlesschain.dynamic-workflow.provider-cost-estimate-lineage.v1\0",
      lineage,
    ),
    lineage,
  };
}

function projectArtifactStoreReadbacks(state) {
  const lineage = [];
  const verifiedEffectIds = new Set();
  let artifactCalls = 0;
  let completedCalls = 0;
  let failedCalls = 0;
  let pendingCalls = 0;
  let outcomeUnknownCalls = 0;
  let operatorReconciledCalls = 0;
  let missingReadbacks = 0;
  let legacyCalls = 0;
  for (const effect of state.effects) {
    for (const call of effect.calls || []) {
      if (call.kind !== "tool" || call.name !== "publish_artifact") continue;
      artifactCalls += 1;
      if (call.status === "completed") completedCalls += 1;
      if (call.status === "failed") failedCalls += 1;
      if (call.status === "started") pendingCalls += 1;
      if (call.status === "outcome_unknown") outcomeUnknownCalls += 1;
      if (call.status === "operator_reconciled") operatorReconciledCalls += 1;
      if (!Object.prototype.hasOwnProperty.call(call, "artifactReadback")) {
        legacyCalls += 1;
        if (call.status !== "failed") missingReadbacks += 1;
        continue;
      }
      if (!validArtifactReadback(call.artifactReadback)) {
        if (call.status !== "failed") missingReadbacks += 1;
        continue;
      }
      verifiedEffectIds.add(effect.id);
      lineage.push({
        effectId: effect.id,
        ownerEffectId: call.ownerEffectId ?? effect.id,
        callRecordId: call.id,
        callId: call.callId,
        sequence: call.sequence,
        descendant: (call.ownerEffectId ?? effect.id) !== effect.id,
        settledAt: call.settledAt,
        readback: call.artifactReadback,
        readbackDigest: artifactReadbackDigest(call.artifactReadback),
      });
    }
  }
  return {
    authority:
      legacyCalls > 0
        ? "artifact-store-index-and-bytes-at-settlement-with-legacy-call-schema"
        : "artifact-store-index-and-bytes-at-settlement",
    verificationTiming: "tool-settlement",
    immutableRetentionProven: false,
    artifactCalls,
    completedCalls,
    failedCalls,
    verifiedCalls: lineage.length,
    verifiedEffects: verifiedEffectIds.size,
    missingReadbacks,
    pendingCalls,
    outcomeUnknownCalls,
    operatorReconciledCalls,
    legacyCalls,
    lineageDigest: digest(
      "chainlesschain.dynamic-workflow.artifact-store-readback-lineage.v1\0",
      lineage,
    ),
    lineage,
  };
}

function projectDynamicWorkflowObservability(state) {
  const settled = state.effects.filter((effect) => effect.status === "settled");
  const effectLineage = [];
  const artifactLineage = [];
  const checkpointLineage = [];
  const providerRequestAttemptLineage = [];
  const providerReceiptLineage = [];
  const nestedEffectAttemptLineage = [];
  const nestedEffectSettlementLineage = [];
  const durableCalls = projectDurableWorkflowCalls(state);
  const providerTokenUsage = projectProviderTokenUsage(state);
  const providerCostEstimates = projectProviderCostEstimates(state);
  const artifactStoreReadbacks = projectArtifactStoreReadbacks(state);
  const providerReceipts = projectProviderRequestReceipts(state);
  const nestedEffects = projectNestedToolEffects(state);
  let requestToSettlementMs = 0;
  let maxRequestToSettlementMs = 0;
  let estimatedTokens = 0;
  let tokenEstimateEffects = 0;
  let completedTaskEffects = 0;
  let failedTaskEffects = 0;
  let invalidTaskResultEffects = 0;
  let artifactCount = 0;
  let checkpointCount = 0;
  let artifactTruncatedEffects = 0;
  let checkpointTruncatedEffects = 0;
  const providerRequestAttemptCount = providerReceipts.attemptCount;
  const providerRequestAttemptEffects = providerReceipts.requestAttemptEffects;
  const providerReceiptCount = providerReceipts.receiptCount;
  const providerReceiptEffects = providerReceipts.receiptEffects;
  const invalidProviderRequestAttempts = providerReceipts.invalidAttempts;
  const invalidProviderReceipts = providerReceipts.invalidReceipts;
  const missingProviderRequestReceipts = providerReceipts.missingReceipts;
  const providerReceiptTruncatedEffects = providerReceipts.truncatedEffects;
  const nestedEffectAttemptCount = nestedEffects.attemptCount;
  const nestedEffectSettlementCount = nestedEffects.settlementCount;
  const nestedEffectDurableMcpSettlements = nestedEffects.durableMcpSettlements;
  const invalidNestedEffectAttempts = nestedEffects.invalidAttempts;
  const invalidNestedEffectSettlements = nestedEffects.invalidSettlements;
  const missingNestedEffectSettlements = nestedEffects.missingSettlements;
  const nestedEffectTruncatedEffects = nestedEffects.truncatedEffects;

  for (const effect of settled) {
    const elapsed = Math.max(
      0,
      Date.parse(effect.settledAt) - Date.parse(effect.requestedAt),
    );
    requestToSettlementMs += elapsed;
    maxRequestToSettlementMs = Math.max(maxRequestToSettlementMs, elapsed);

    const taskStatus = effect.result?.status;
    if (taskStatus === "completed") completedTaskEffects += 1;
    else if (taskStatus === "failed") failedTaskEffects += 1;
    else invalidTaskResultEffects += 1;

    const tokenCount = nonNegativeSafeInteger(
      effect.result?.result?.tokenCount,
    );
    if (tokenCount !== null) {
      estimatedTokens += tokenCount;
      tokenEstimateEffects += 1;
    }

    const artifacts = projectResultValues(
      effect,
      "artifacts",
      "chainlesschain.dynamic-workflow.artifact-observation.v1\0",
    );
    artifactCount += artifacts.count;
    artifactLineage.push(...artifacts.lineage);
    if (artifacts.truncated) artifactTruncatedEffects += 1;

    const checkpoints = projectResultValues(
      effect,
      "checkpoints",
      "chainlesschain.dynamic-workflow.checkpoint-observation.v1\0",
    );
    checkpointCount += checkpoints.count;
    checkpointLineage.push(...checkpoints.lineage);
    if (checkpoints.truncated) checkpointTruncatedEffects += 1;

    effectLineage.push({
      effectId: effect.id,
      stepId: effect.stepId,
      iteration: effect.iteration,
      attempt: effect.attempt,
      status: effect.status,
      batchId: effect.batchId || null,
      batchIndex: effect.batchIndex ?? null,
      batchSize: effect.batchSize ?? null,
      timeoutMs: effect.timeoutMs ?? null,
      timeoutObservedAt: effect.timeoutObservedAt ?? null,
      providerDispatchedAt: effect.providerDispatchedAt ?? null,
      taskStatus:
        taskStatus === "completed" || taskStatus === "failed"
          ? taskStatus
          : "invalid",
      payloadDigest: effect.payloadDigest,
      resultDigest: effect.resultDigest,
      settlementAuthority: effect.settlementAuthority,
      requestedAt: effect.requestedAt,
      settledAt: effect.settledAt,
      requestToSettlementMs: elapsed,
    });
  }

  const gaps = [
    "provider-cost-usd-unavailable",
    "provider-native-idempotency-unavailable",
    "provider-receipt-independent-readback-unavailable",
    "checkpoint-provider-readback-unavailable",
    "artifact-store-immutable-retention-unavailable",
  ];
  providerRequestAttemptLineage.push(...providerReceipts.attemptLineage);
  providerReceiptLineage.push(...providerReceipts.receiptLineage);
  nestedEffectAttemptLineage.push(...nestedEffects.attemptLineage);
  nestedEffectSettlementLineage.push(...nestedEffects.settlementLineage);
  if (providerTokenUsage.providerReportedCalls === 0) {
    gaps.push("provider-token-usage-unavailable");
  }
  if (providerTokenUsage.missingProviderReportedCalls > 0) {
    gaps.push("provider-token-usage-incomplete");
  }
  if (providerTokenUsage.legacyCalls > 0) {
    gaps.push("provider-token-usage-legacy-call-schema");
  }
  if (providerCostEstimates.pricedCalls === 0) {
    gaps.push("provider-cost-estimate-unavailable");
  }
  if (providerCostEstimates.missingEstimateCalls > 0) {
    gaps.push("provider-cost-estimate-incomplete");
  }
  if (providerCostEstimates.legacyCalls > 0) {
    gaps.push("provider-cost-estimate-legacy-call-schema");
  }
  if (artifactStoreReadbacks.verifiedCalls === 0) {
    gaps.push("artifact-store-readback-unavailable");
  }
  if (artifactStoreReadbacks.missingReadbacks > 0) {
    gaps.push("artifact-store-readback-incomplete");
  }
  if (artifactStoreReadbacks.legacyCalls > 0) {
    gaps.push("artifact-store-readback-legacy-call-schema");
  }
  if (tokenEstimateEffects !== settled.length) {
    gaps.push("cowork-token-estimate-incomplete");
  }
  if (artifactTruncatedEffects > 0) {
    gaps.push("artifact-lineage-projection-truncated");
  }
  if (checkpointTruncatedEffects > 0) {
    gaps.push("checkpoint-lineage-projection-truncated");
  }
  const providerReturnedEffects = settled.filter(
    (effect) => effect.settlementAuthority === "provider-return",
  ).length;
  if (
    providerReceipts.providerReturnedReceiptEffects !==
      providerReturnedEffects ||
    missingProviderRequestReceipts > 0
  ) {
    gaps.push("provider-request-receipt-incomplete");
  }
  if (invalidProviderRequestAttempts > 0) {
    gaps.push("provider-request-attempt-invalid");
  }
  if (invalidProviderReceipts > 0) {
    gaps.push("provider-request-receipt-invalid");
  }
  if (providerReceiptTruncatedEffects > 0) {
    gaps.push("provider-request-receipt-projection-truncated");
  }
  if (providerReceipts.legacyResultFallbackEffects > 0) {
    gaps.push("provider-request-receipt-legacy-result-fallback");
  }
  if (providerReceipts.conflictingOuterResultEffects > 0) {
    gaps.push("provider-request-result-disagrees-with-durable-store");
  }
  if (invalidNestedEffectAttempts > 0) {
    gaps.push("nested-tool-effect-attempt-invalid");
  }
  if (invalidNestedEffectSettlements > 0) {
    gaps.push("nested-tool-effect-settlement-invalid");
  }
  if (missingNestedEffectSettlements > 0) {
    gaps.push("nested-tool-effect-settlement-incomplete");
  }
  if (nestedEffectTruncatedEffects > 0) {
    gaps.push("nested-tool-effect-projection-truncated");
  }
  if (nestedEffects.legacyResultFallbackEffects > 0) {
    gaps.push("nested-tool-independent-ledger-incomplete");
    gaps.push("nested-tool-effect-legacy-result-fallback");
  }
  if (nestedEffects.conflictingOuterResultEffects > 0) {
    gaps.push("nested-tool-result-disagrees-with-durable-store");
  }

  return snapshotJson(
    {
      schema: DYNAMIC_WORKFLOW_OBSERVABILITY_SCHEMA,
      complete: false,
      effects: {
        requested: state.effects.length,
        settled: settled.length,
        pending: state.effects.length - settled.length,
        providerReturned: settled.filter(
          (effect) => effect.settlementAuthority === "provider-return",
        ).length,
        operatorReconciled: settled.filter(
          (effect) => effect.settlementAuthority === "operator-reconciled",
        ).length,
        runtimeNotDispatched: settled.filter(
          (effect) => effect.settlementAuthority === "runtime-not-dispatched",
        ).length,
        providerDispatched: state.effects.filter(
          (effect) => typeof effect.providerDispatchedAt === "string",
        ).length,
        timeoutObserved: state.effects.filter(
          (effect) => typeof effect.timeoutObservedAt === "string",
        ).length,
        completedTasks: completedTaskEffects,
        failedTasks: failedTaskEffects,
        invalidTaskResults: invalidTaskResultEffects,
        lineageDigest: digest(
          "chainlesschain.dynamic-workflow.effect-observability.v1\0",
          effectLineage,
        ),
        lineage: effectLineage,
      },
      duration: {
        authority: "request-to-settlement-wall-clock",
        observedEffects: settled.length,
        totalMs: requestToSettlementMs,
        maxMs: maxRequestToSettlementMs,
      },
      tokens: {
        ...providerTokenUsage,
        estimateAuthority: "cowork-result-heuristic",
        estimated: estimatedTokens,
        observedEffects: tokenEstimateEffects,
        missingEffects: settled.length - tokenEstimateEffects,
      },
      cost: {
        ...providerCostEstimates,
        observedEffects: providerCostEstimates.pricedEffects,
        projectedRecords: providerCostEstimates.lineage.length,
      },
      providerReceipts: {
        authority:
          providerReceipts.legacyResultFallbackEffects > 0
            ? "runtime-state-hash-chain-fsync-with-legacy-task-result-fallback"
            : "runtime-state-hash-chain-fsync",
        receiptSemantics: "provider-returned-trace-only",
        crashVisible: true,
        durableCallEffects: providerReceipts.durableCallEffects,
        legacyResultFallbackEffects:
          providerReceipts.legacyResultFallbackEffects,
        conflictingOuterResultEffects:
          providerReceipts.conflictingOuterResultEffects,
        count: providerReceiptCount,
        projectedRecords: providerReceiptLineage.length,
        requestAttempts: providerRequestAttemptCount,
        projectedRequestAttempts: providerRequestAttemptLineage.length,
        requestAttemptEffects: providerRequestAttemptEffects,
        observedEffects: providerReceiptEffects,
        providerReturnedObservedEffects:
          providerReceipts.providerReturnedReceiptEffects,
        missingProviderReturnedEffects: Math.max(
          0,
          providerReturnedEffects -
            providerReceipts.providerReturnedReceiptEffects,
        ),
        missingRequestReceipts: missingProviderRequestReceipts,
        invalidRequestAttempts: invalidProviderRequestAttempts,
        invalidRecords: invalidProviderReceipts,
        truncatedEffects: providerReceiptTruncatedEffects,
        nativeIdempotencyProven: false,
        independentlyReadable: false,
        requestAttemptLineageDigest: digest(
          "chainlesschain.dynamic-workflow.provider-request-attempt-lineage.v1\0",
          providerRequestAttemptLineage,
        ),
        lineageDigest: digest(
          "chainlesschain.dynamic-workflow.provider-request-receipt-lineage.v1\0",
          providerReceiptLineage,
        ),
        requestAttemptLineage: providerRequestAttemptLineage,
        lineage: providerReceiptLineage,
      },
      durableCalls,
      nestedEffects: {
        authority:
          nestedEffects.legacyResultFallbackEffects > 0
            ? "runtime-state-hash-chain-fsync-with-legacy-task-result-fallback"
            : "runtime-state-hash-chain-fsync",
        crashVisible: true,
        durableCallEffects: nestedEffects.durableCallEffects,
        legacyResultFallbackEffects: nestedEffects.legacyResultFallbackEffects,
        conflictingOuterResultEffects:
          nestedEffects.conflictingOuterResultEffects,
        attempts: nestedEffectAttemptCount,
        settlements: nestedEffectSettlementCount,
        projectedAttempts: nestedEffectAttemptLineage.length,
        projectedSettlements: nestedEffectSettlementLineage.length,
        durableMcpSettlements: nestedEffectDurableMcpSettlements,
        missingSettlements: missingNestedEffectSettlements,
        invalidAttempts: invalidNestedEffectAttempts,
        invalidSettlements: invalidNestedEffectSettlements,
        truncatedEffects: nestedEffectTruncatedEffects,
        allEffectsIndependentlyDurable:
          nestedEffects.legacyResultFallbackEffects === 0,
        attemptLineageDigest: digest(
          "chainlesschain.dynamic-workflow.nested-effect-attempt-lineage.v1\0",
          nestedEffectAttemptLineage,
        ),
        settlementLineageDigest: digest(
          "chainlesschain.dynamic-workflow.nested-effect-settlement-lineage.v1\0",
          nestedEffectSettlementLineage,
        ),
        attemptLineage: nestedEffectAttemptLineage,
        settlementLineage: nestedEffectSettlementLineage,
      },
      artifacts: {
        authority: "task-result-digest-only",
        count: artifactCount,
        projectedRecords: artifactLineage.length,
        truncatedEffects: artifactTruncatedEffects,
        lineageDigest: digest(
          "chainlesschain.dynamic-workflow.artifact-lineage.v1\0",
          artifactLineage,
        ),
        lineage: artifactLineage,
        storeReadbacks: artifactStoreReadbacks,
      },
      checkpoints: {
        authority: "task-result-digest-only",
        count: checkpointCount,
        projectedRecords: checkpointLineage.length,
        truncatedEffects: checkpointTruncatedEffects,
        lineageDigest: digest(
          "chainlesschain.dynamic-workflow.checkpoint-lineage.v1\0",
          checkpointLineage,
        ),
        lineage: checkpointLineage,
      },
      gaps,
    },
    "dynamic workflow observability projection",
    2 * 1024 * 1024,
  );
}

export function projectDynamicWorkflowRuntime(stateOrPath) {
  const state =
    typeof stateOrPath === "string"
      ? readDynamicWorkflowRuntimeState(stateOrPath)
      : verifyDynamicWorkflowRuntimeState(stateOrPath);
  return Object.freeze({
    schema: DYNAMIC_WORKFLOW_RUNTIME_SCHEMA,
    runId: state.runId,
    workflowId: state.workflowId,
    revision: state.revision,
    status: state.status,
    definitionDigest: state.definitionDigest,
    admissionDigest: state.admissionDigest,
    executionAuthoritySessionId: state.executionAuthoritySessionId,
    effectCount: state.effects.length,
    settledEffectCount: state.effects.filter(
      (effect) => effect.status === "settled",
    ).length,
    pendingEffects: Object.freeze(
      state.effects
        .filter((effect) => effect.status === "pending")
        .map((effect) =>
          Object.freeze({
            id: effect.id,
            key: effect.key,
            payloadDigest: effect.payloadDigest,
            batchId: effect.batchId || null,
            batchIndex: effect.batchIndex ?? null,
            batchSize: effect.batchSize ?? null,
            timeoutMs: effect.timeoutMs ?? null,
            timeoutObservedAt: effect.timeoutObservedAt ?? null,
            providerDispatchedAt: effect.providerDispatchedAt ?? null,
            requestedAt: effect.requestedAt,
          }),
        ),
    ),
    finalRecordStatus: state.finalRecord?.status || null,
    observability: projectDynamicWorkflowObservability(state),
    updatedAt: state.updatedAt,
    stateDigest: state.stateDigest,
  });
}
