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
import { managedToolCheckpointRequired } from "./managed-tool-checkpoint.js";
import {
  digestWorkspaceEvidence,
  WORKSPACE_TRANSACTION_COVERAGE,
  WORKSPACE_TRANSACTION_STATE,
  WORKSPACE_TRANSACTION_VERSION,
  WorkspaceTransactionManager,
} from "./process-execution-broker/workspace-transaction.js";
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
export const DYNAMIC_WORKFLOW_INPUT_REQUEST_SCHEMA =
  "cc-dynamic-workflow-input-request/v1";
export const DYNAMIC_WORKFLOW_OBSERVABILITY_SCHEMA =
  "cc-dynamic-workflow-observability/v1";
export const DYNAMIC_WORKFLOW_RUNTIME_CONTROL_CODE =
  COWORK_WORKFLOW_CONTROL_SIGNAL_CODE;

const STATE_STATUSES = new Set([
  "ready",
  "running",
  "pause_requested",
  "input_requested",
  "needs_input",
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
const MAX_INPUT_REQUESTS = 64;
const MAX_INPUT_OPTIONS = 32;
const MAX_INPUT_RESPONSE_BYTES = 64 * 1024;
const MAX_WORKBENCH_RUN_FILES = 1024;
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

const CHECKPOINT_EVIDENCE_BASE_FIELDS = Object.freeze([
  "version",
  "transactionId",
  "checkpointId",
  "checkpointDigest",
  "writeManifestDigest",
  "fileCoverage",
  "coverage",
  "externalSideEffects",
  "outcome",
  "executions",
  "exclusions",
  "uncoveredPaths",
  "evidenceDigest",
]);

const CHECKPOINT_BINDING_FIELDS = Object.freeze([
  "schema",
  "authority",
  "transactionId",
  "checkpointId",
  "checkpointDigest",
  "preparedStateDigest",
  "coverage",
  "fileCoverage",
  "externalSideEffects",
]);

function checkpointBindingSnapshot(value) {
  if (value === undefined || value === null) return null;
  return strictDataObjectSnapshot(
    value,
    CHECKPOINT_BINDING_FIELDS,
    "workflow managed checkpoint binding",
  );
}

function validCheckpointBinding(value) {
  return (
    exactObjectFields(value, CHECKPOINT_BINDING_FIELDS) &&
    value.schema === "cc-managed-tool-checkpoint-binding/v1" &&
    value.authority === "process-broker-workspace-transaction-prepared" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/u.test(value.transactionId || "") &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/u.test(value.checkpointId || "") &&
    SHA256_RE.test(value.checkpointDigest || "") &&
    SHA256_RE.test(value.preparedStateDigest || "") &&
    Object.values(WORKSPACE_TRANSACTION_COVERAGE).includes(value.coverage) &&
    Object.values(WORKSPACE_TRANSACTION_COVERAGE).includes(
      value.fileCoverage,
    ) &&
    typeof value.externalSideEffects === "boolean"
  );
}

function checkpointBindingDigest(binding) {
  return digest(
    "chainlesschain.dynamic-workflow.checkpoint-prepared-binding.v1\0",
    binding,
  );
}

function checkpointReadbackMatchesBinding(readback, binding) {
  return (
    binding === null ||
    (validCheckpointBinding(binding) &&
      readback.transactionId === binding.transactionId &&
      readback.checkpointId === binding.checkpointId &&
      readback.checkpointDigest === binding.checkpointDigest &&
      readback.coverage === binding.coverage &&
      readback.fileCoverage === binding.fileCoverage &&
      readback.externalSideEffects === binding.externalSideEffects)
  );
}

function checkpointEvidenceSnapshot(value) {
  const outcome = ownDataValue(value, "outcome");
  const fields =
    outcome === "rolled_back"
      ? [
          ...CHECKPOINT_EVIDENCE_BASE_FIELDS,
          "rollbackReason",
          "verificationDigest",
        ]
      : CHECKPOINT_EVIDENCE_BASE_FIELDS;
  return strictDataObjectSnapshot(
    value,
    fields,
    "workflow managed checkpoint evidence",
    512 * 1024,
  );
}

function boundedStringArray(value, maxItems = 4096, maxLength = 4096) {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every(
      (entry) =>
        typeof entry === "string" &&
        entry.length >= 1 &&
        entry.length <= maxLength &&
        !entry.includes("\0"),
    )
  );
}

function validCheckpointEvidence(value) {
  if (
    !value ||
    value.version !== WORKSPACE_TRANSACTION_VERSION ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/u.test(value.transactionId || "") ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/u.test(value.checkpointId || "") ||
    !SHA256_RE.test(value.checkpointDigest || "") ||
    !SHA256_RE.test(value.writeManifestDigest || "") ||
    !Object.values(WORKSPACE_TRANSACTION_COVERAGE).includes(
      value.fileCoverage,
    ) ||
    !Object.values(WORKSPACE_TRANSACTION_COVERAGE).includes(value.coverage) ||
    typeof value.externalSideEffects !== "boolean" ||
    !["committed", "rolled_back"].includes(value.outcome) ||
    !boundedStringArray(value.executions, 4096, 256) ||
    !boundedStringArray(value.exclusions) ||
    !boundedStringArray(value.uncoveredPaths) ||
    !SHA256_RE.test(value.evidenceDigest || "") ||
    (value.outcome === "rolled_back" &&
      (typeof value.rollbackReason !== "string" ||
        value.rollbackReason.length < 1 ||
        value.rollbackReason.length > 1000 ||
        !SHA256_RE.test(value.verificationDigest || "")))
  ) {
    return false;
  }
  const unsigned = { ...value };
  delete unsigned.evidenceDigest;
  return value.evidenceDigest === digestWorkspaceEvidence(unsigned);
}

function checkpointReadbackDigest(readback) {
  return digest(
    "chainlesschain.dynamic-workflow.checkpoint-store-readback.v1\0",
    readback,
  );
}

function validCheckpointReadback(value) {
  return (
    exactObjectFields(value, [
      "schema",
      "authority",
      "transactionId",
      "checkpointId",
      "outcome",
      "coverage",
      "fileCoverage",
      "externalSideEffects",
      "checkpointDigest",
      "writeManifestDigest",
      "evidenceDigest",
      "stateDigest",
    ]) &&
    value.schema === "cc-dynamic-workflow-checkpoint-readback/v1" &&
    value.authority === "workspace-transaction-store-terminal-readback" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/u.test(value.transactionId || "") &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/u.test(value.checkpointId || "") &&
    ["committed", "rolled_back"].includes(value.outcome) &&
    Object.values(WORKSPACE_TRANSACTION_COVERAGE).includes(value.coverage) &&
    Object.values(WORKSPACE_TRANSACTION_COVERAGE).includes(
      value.fileCoverage,
    ) &&
    typeof value.externalSideEffects === "boolean" &&
    SHA256_RE.test(value.checkpointDigest || "") &&
    SHA256_RE.test(value.writeManifestDigest || "") &&
    SHA256_RE.test(value.evidenceDigest || "") &&
    SHA256_RE.test(value.stateDigest || "")
  );
}

function checkpointStoreReadback(evidence, checkpointStore, binding = null) {
  if (
    binding !== null &&
    (!validCheckpointBinding(binding) ||
      evidence.transactionId !== binding.transactionId ||
      evidence.checkpointId !== binding.checkpointId ||
      evidence.checkpointDigest !== binding.checkpointDigest ||
      evidence.coverage !== binding.coverage ||
      evidence.fileCoverage !== binding.fileCoverage ||
      evidence.externalSideEffects !== binding.externalSideEffects)
  ) {
    throw new TypeError(
      "workflow managed checkpoint settlement does not match its prepared binding",
    );
  }
  if (!checkpointStore || typeof checkpointStore.inspect !== "function") {
    throw new TypeError("workflow checkpoint store readback is unavailable");
  }
  let stored;
  try {
    stored = snapshotJson(
      checkpointStore.inspect(evidence.transactionId),
      "workflow checkpoint store state",
      2 * 1024 * 1024,
    );
  } catch {
    throw new TypeError("workflow checkpoint store readback failed");
  }
  const unsignedState = { ...stored };
  delete unsignedState.stateDigest;
  const expectedState =
    evidence.outcome === "committed"
      ? WORKSPACE_TRANSACTION_STATE.COMMITTED
      : WORKSPACE_TRANSACTION_STATE.ROLLED_BACK;
  if (
    stored.id !== evidence.transactionId ||
    stored.checkpointId !== evidence.checkpointId ||
    stored.state !== expectedState ||
    !SHA256_RE.test(stored.stateDigest || "") ||
    stored.stateDigest !== digestWorkspaceEvidence(unsignedState) ||
    canonicalJson(stored.evidence, "workflowCheckpointEvidence") !==
      canonicalJson(evidence, "workflowCheckpointEvidence")
  ) {
    throw new TypeError(
      "workflow checkpoint store readback does not match settlement",
    );
  }
  const readback = {
    schema: "cc-dynamic-workflow-checkpoint-readback/v1",
    authority: "workspace-transaction-store-terminal-readback",
    transactionId: evidence.transactionId,
    checkpointId: evidence.checkpointId,
    outcome: evidence.outcome,
    coverage: evidence.coverage,
    fileCoverage: evidence.fileCoverage,
    externalSideEffects: evidence.externalSideEffects,
    checkpointDigest: evidence.checkpointDigest,
    writeManifestDigest: evidence.writeManifestDigest,
    evidenceDigest: evidence.evidenceDigest,
    stateDigest: stored.stateDigest,
  };
  if (!checkpointReadbackMatchesBinding(readback, binding)) {
    throw new TypeError(
      "workflow checkpoint store readback does not match its prepared binding",
    );
  }
  return readback;
}

function checkpointReadbackSettlement(event, checkpointStore, binding = null) {
  const managed = ownDataValue(event?.result, "managedCheckpoint");
  if (managed === undefined || managed === null) return null;
  const skipped = ownDataValue(managed, "skipped");
  const status = ownDataValue(managed, "status");
  if (skipped === true) {
    const observation = strictDataObjectSnapshot(
      managed,
      ["skipped", "toolName", "coverage", "fileCoverage", "reason"],
      "workflow unavailable managed checkpoint",
    );
    if (
      observation.toolName !== event.tool ||
      observation.coverage !== WORKSPACE_TRANSACTION_COVERAGE.NONE ||
      observation.fileCoverage !== WORKSPACE_TRANSACTION_COVERAGE.NONE ||
      typeof observation.reason !== "string" ||
      observation.reason.length < 1 ||
      observation.reason.length > 256
    ) {
      throw new TypeError(
        "workflow unavailable managed checkpoint is malformed",
      );
    }
    return null;
  }
  if (["not_started", "recovery_required"].includes(status)) {
    const observation = strictDataObjectSnapshot(
      managed,
      status === "not_started"
        ? ["status", "coverage", "code"]
        : [
            "status",
            "coverage",
            "code",
            "transactionId",
            "checkpointId",
            "settlement",
            "originalToolError",
          ],
      "workflow unavailable managed checkpoint",
    );
    const hasToolError = Boolean(
      event?.error || ownDataValue(event?.result, "error"),
    );
    if (
      observation.coverage !== WORKSPACE_TRANSACTION_COVERAGE.NONE ||
      !hasToolError
    ) {
      throw new TypeError(
        "workflow unavailable managed checkpoint is malformed",
      );
    }
    return null;
  }
  const settlement = strictDataObjectSnapshot(
    managed,
    [
      "skipped",
      "toolName",
      "transactionId",
      "checkpointId",
      "evidence",
      "coverage",
      "fileCoverage",
    ],
    "workflow managed checkpoint settlement",
    1024 * 1024,
  );
  const evidence = checkpointEvidenceSnapshot(settlement.evidence);
  if (
    settlement.skipped !== false ||
    settlement.toolName !== event.tool ||
    settlement.transactionId !== evidence.transactionId ||
    settlement.checkpointId !== evidence.checkpointId ||
    settlement.coverage !== evidence.coverage ||
    settlement.fileCoverage !== evidence.fileCoverage ||
    !validCheckpointEvidence(evidence)
  ) {
    throw new TypeError("workflow managed checkpoint settlement is malformed");
  }
  return checkpointStoreReadback(evidence, checkpointStore, binding);
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
    const hasCheckpointReadback = Object.prototype.hasOwnProperty.call(
      call || {},
      "checkpointReadback",
    );
    const startedCheckpointSchemaPresent = startedLineage.some((event) =>
      Object.prototype.hasOwnProperty.call(
        event?.details || {},
        "checkpointReadbackSchema",
      ),
    );
    const settlementCheckpointDigestPresent = settlementLineage.some((event) =>
      Object.prototype.hasOwnProperty.call(
        event?.details || {},
        "checkpointReadbackDigest",
      ),
    );
    const hasCheckpointBinding = Object.prototype.hasOwnProperty.call(
      call || {},
      "checkpointBinding",
    );
    const startedCheckpointBindingDigestPresent = startedLineage.some((event) =>
      Object.prototype.hasOwnProperty.call(
        event?.details || {},
        "checkpointBindingDigest",
      ),
    );
    const checkpointBindingValid = hasCheckpointBinding
      ? startedLineage.length === 1 &&
        (call.checkpointBinding === null ||
          validCheckpointBinding(call.checkpointBinding)) &&
        startedLineage[0]?.details?.checkpointBindingDigest ===
          (call.checkpointBinding === null
            ? null
            : checkpointBindingDigest(call.checkpointBinding))
      : !startedCheckpointBindingDigestPresent;
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
        !hasCheckpointReadback &&
        !startedCheckpointSchemaPresent &&
        !settlementCheckpointDigestPresent &&
        !hasCheckpointBinding &&
        !startedCheckpointBindingDigestPresent &&
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
              !settlementArtifactDigestPresent) &&
        (managedToolCheckpointRequired(call.name)
          ? hasCheckpointReadback
            ? checkpointBindingValid &&
              startedLineage.length === 1 &&
              startedLineage[0]?.details?.checkpointReadbackSchema ===
                "cc-dynamic-workflow-checkpoint-readback/v1" &&
              (["completed", "failed", "outcome_unknown"].includes(call.status)
                ? (call.checkpointReadback === null ||
                    (validCheckpointReadback(call.checkpointReadback) &&
                      checkpointReadbackMatchesBinding(
                        call.checkpointReadback,
                        hasCheckpointBinding ? call.checkpointBinding : null,
                      ))) &&
                  settlementLineage.length === 1 &&
                  settlementLineage[0]?.details?.checkpointReadbackDigest ===
                    (call.checkpointReadback === null
                      ? null
                      : checkpointReadbackDigest(call.checkpointReadback))
                : call.checkpointReadback === null &&
                  !settlementCheckpointDigestPresent)
            : !hasCheckpointBinding &&
              !startedCheckpointSchemaPresent &&
              !startedCheckpointBindingDigestPresent &&
              !settlementCheckpointDigestPresent
          : !hasCheckpointReadback &&
            !hasCheckpointBinding &&
            !startedCheckpointSchemaPresent &&
            !startedCheckpointBindingDigestPresent &&
            !settlementCheckpointDigestPresent));
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

function verifyInputRequests(state, issues) {
  if (state.inputRequests === undefined) {
    if (["input_requested", "needs_input"].includes(state.status)) {
      issues.push("input-requests-missing");
    }
    return;
  }
  if (
    !Array.isArray(state.inputRequests) ||
    state.inputRequests.length > MAX_INPUT_REQUESTS
  ) {
    issues.push("input-requests-invalid");
    return;
  }
  const ids = new Set();
  const stepIds = new Set();
  let pendingCount = 0;
  for (const [index, request] of state.inputRequests.entries()) {
    let valid = true;
    let normalized = null;
    const plainRequest =
      request && typeof request === "object" && !Array.isArray(request);
    try {
      normalized = normalizeStageInputRequest({
        stepId: request?.stepId,
        prompt: request?.prompt,
        options: request?.options,
        multiSelect: request?.multiSelect,
      });
    } catch {
      valid = false;
    }
    const expectedId = normalized
      ? stageInputRequestIdentity(state.runId, normalized)
      : null;
    const pending = request?.status === "pending";
    const answered = request?.status === "answered";
    const cancelled = request?.status === "cancelled";
    if (pending) pendingCount += 1;
    if (
      !plainRequest ||
      request?.schema !== DYNAMIC_WORKFLOW_INPUT_REQUEST_SCHEMA ||
      (plainRequest && Reflect.ownKeys(request).length !== 11) ||
      request?.id !== expectedId ||
      ids.has(request?.id) ||
      stepIds.has(request?.stepId) ||
      (!pending && !answered && !cancelled) ||
      isoNow(request?.requestedAt) !== request.requestedAt ||
      (pending &&
        (request.resolvedAt !== null ||
          request.responseDigest !== null ||
          request.response !== null))
    ) {
      valid = false;
    }
    if (answered) {
      let answer = null;
      try {
        answer = normalizeStageInputAnswer(request.response, request);
      } catch {
        valid = false;
      }
      if (
        answer === null ||
        !SHA256_RE.test(request.responseDigest || "") ||
        request.responseDigest !==
          stageInputResponseDigest(request.id, request.response) ||
        typeof request.resolvedAt !== "string" ||
        isoNow(request.resolvedAt) !== request.resolvedAt ||
        Date.parse(request.resolvedAt) < Date.parse(request.requestedAt)
      ) {
        valid = false;
      }
    }
    if (
      cancelled &&
      (typeof request.resolvedAt !== "string" ||
        isoNow(request.resolvedAt) !== request.resolvedAt ||
        Date.parse(request.resolvedAt) < Date.parse(request.requestedAt) ||
        request.responseDigest !== null ||
        request.response !== null)
    ) {
      valid = false;
    }
    if (!valid) issues.push(`input-request-${index}-invalid`);
    ids.add(request?.id);
    stepIds.add(request?.stepId);
  }
  const inputStatus = ["input_requested", "needs_input"].includes(state.status);
  if (
    pendingCount > 1 ||
    inputStatus !== (pendingCount === 1) ||
    (state.status === "needs_input" &&
      state.effects?.some((effect) => effect?.status === "pending"))
  ) {
    issues.push("input-request-state-invalid");
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
  if (state.executionBudget !== undefined && state.executionBudget !== null) {
    const budget = state.executionBudget;
    const fields = [
      "maxExpandedTasks",
      "maxParallel",
      "maxTokens",
      "maxUsd",
      "maxDurationMs",
    ];
    const validBudget =
      budget &&
      typeof budget === "object" &&
      !Array.isArray(budget) &&
      Object.keys(budget).length === fields.length &&
      fields.every((field) => Object.hasOwn(budget, field)) &&
      fields.every((field) => {
        const amount = budget[field];
        if (amount === null) return true;
        if (!Number.isFinite(amount) || amount < 0) return false;
        return (
          field === "maxUsd" || (Number.isSafeInteger(amount) && amount >= 1)
        );
      });
    if (!validBudget) issues.push("execution-budget-invalid");
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
  verifyInputRequests(state, issues);
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

export function readDynamicWorkflowInputResponseFile(filePath) {
  const payload = readDynamicWorkflowEffectResultFile(filePath);
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    Reflect.ownKeys(payload).length !== 1 ||
    !Object.hasOwn(payload, "answer")
  ) {
    throw new Error(
      'workflow input response file must contain exactly {"answer": ...}',
    );
  }
  return payload.answer;
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
    executionBudget: snapshotJson(
      execution.workflow?.facade?.budget || null,
      "workflow execution budget",
      16 * 1024,
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
      canonicalJson(bindings.executionPolicy) &&
    (state.executionBudget === undefined ||
      canonicalJson(state.executionBudget) ===
        canonicalJson(bindings.executionBudget))
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
    inputRequests: [],
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

function runtimeInputRequests(state) {
  return Array.isArray(state?.inputRequests) ? state.inputRequests : [];
}

function normalizeStageInputRequest(value) {
  const request = snapshotJson(
    value,
    "workflow stage input request",
    64 * 1024,
  );
  const fields = Object.keys(request || {});
  if (
    !request ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    fields.length !== 4 ||
    !["stepId", "prompt", "options", "multiSelect"].every((field) =>
      Object.hasOwn(request, field),
    ) ||
    typeof request.stepId !== "string" ||
    request.stepId.length === 0 ||
    request.stepId.length > 512 ||
    typeof request.prompt !== "string" ||
    request.prompt.trim() !== request.prompt ||
    request.prompt.length === 0 ||
    request.prompt.length > 4096 ||
    typeof request.multiSelect !== "boolean" ||
    !(
      request.options === null ||
      (Array.isArray(request.options) &&
        request.options.length > 0 &&
        request.options.length <= MAX_INPUT_OPTIONS &&
        request.options.every(
          (option) =>
            typeof option === "string" &&
            option.trim() === option &&
            option.length > 0 &&
            option.length <= 512,
        ) &&
        new Set(request.options).size === request.options.length)
    ) ||
    (request.multiSelect && request.options === null)
  ) {
    throw new TypeError("workflow stage input request is malformed");
  }
  if (containsSecret(JSON.stringify(request))) {
    throw new Error("workflow stage input request contains secret-shaped data");
  }
  return request;
}

function stageInputRequestIdentity(runId, request) {
  return digest("chainlesschain.dynamic-workflow.input-request.v1\0", {
    runId,
    request,
  });
}

function normalizeStageInputAnswer(value, request) {
  const answer = snapshotJson(
    value,
    "workflow stage input answer",
    MAX_INPUT_RESPONSE_BYTES,
  );
  if (request.multiSelect) {
    if (
      !Array.isArray(answer) ||
      answer.length === 0 ||
      answer.length > MAX_INPUT_OPTIONS ||
      answer.some((item) => typeof item !== "string") ||
      new Set(answer).size !== answer.length ||
      answer.some((item) => !request.options.includes(item))
    ) {
      throw new TypeError("workflow stage input answer is malformed");
    }
  } else if (
    typeof answer !== "string" ||
    answer.length === 0 ||
    Buffer.byteLength(answer, "utf8") > MAX_INPUT_RESPONSE_BYTES ||
    (request.options !== null && !request.options.includes(answer))
  ) {
    throw new TypeError("workflow stage input answer is malformed");
  }
  if (containsSecret(JSON.stringify(answer))) {
    throw new Error("workflow stage input answer contains secret-shaped data");
  }
  return answer;
}

function stageInputResponseDigest(requestId, answer) {
  return digest("chainlesschain.dynamic-workflow.input-response.v1\0", {
    requestId,
    answer,
  });
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

function resolveDurableWorkflowStageInput(statePath, runId, rawRequest, now) {
  const request = normalizeStageInputRequest(rawRequest);
  const requestId = stageInputRequestIdentity(runId, request);
  const outcome = withStateMutation(statePath, (current) => {
    if (!current || current.runId !== runId) {
      throw new Error("durable workflow run disappeared before input request");
    }
    const inputRequests = runtimeInputRequests(current);
    const matchingStep = inputRequests.find(
      (entry) => entry.stepId === request.stepId,
    );
    if (matchingStep && matchingStep.id !== requestId) {
      throw new Error("workflow stage input request drifted during replay");
    }
    if (matchingStep?.status === "answered") {
      return { value: { answer: matchingStep.response, state: current } };
    }
    if (matchingStep?.status === "pending") {
      return {
        value: { pending: matchingStep, state: current },
      };
    }
    const existingPending = inputRequests.find(
      (entry) => entry.status === "pending",
    );
    if (existingPending) {
      return {
        value: { pending: existingPending, state: current },
      };
    }
    if (current.status !== "running") {
      throw new Error(
        `durable workflow run cannot request input while ${current.status}`,
      );
    }
    if (inputRequests.length >= MAX_INPUT_REQUESTS) {
      throw new Error("durable workflow input request limit exceeded");
    }
    const requestedAt = isoNow(now);
    const pending = {
      schema: DYNAMIC_WORKFLOW_INPUT_REQUEST_SCHEMA,
      id: requestId,
      stepId: request.stepId,
      prompt: request.prompt,
      options: request.options,
      multiSelect: request.multiSelect,
      status: "pending",
      requestedAt,
      resolvedAt: null,
      responseDigest: null,
      response: null,
    };
    const state = transition(
      current,
      "input-requested",
      { requestId, stepId: request.stepId },
      (draft) => {
        draft.inputRequests = [...runtimeInputRequests(draft), pending];
        draft.status = "input_requested";
      },
      now,
    );
    return { state, value: { pending, state } };
  });
  if (outcome.answer !== undefined) return outcome.answer;
  throw controlError(
    `workflow stage ${outcome.pending.stepId} needs input`,
    "needs-input",
    outcome.state,
  );
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
    if (["input_requested", "needs_input"].includes(current.status)) {
      return {
        value: { control: "needs-input", state: current, results: null },
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
    if (
      !["running", "pause_requested", "input_requested", "blocked"].includes(
        current.status,
      )
    ) {
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
  const checkpointRequired = managedToolCheckpointRequired(event.tool);
  const checkpointBindingValue = ownDataValue(
    event,
    "managedCheckpointBinding",
  );
  const checkpointBinding = checkpointBindingSnapshot(checkpointBindingValue);
  if (
    (!checkpointRequired && checkpointBindingValue !== undefined) ||
    (checkpointBinding !== null && !validCheckpointBinding(checkpointBinding))
  ) {
    throw new TypeError("workflow tool checkpoint boundary is malformed");
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
    ...(checkpointRequired
      ? { checkpointBinding, checkpointReadback: null }
      : {}),
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
          : {}),
        ...(kind === "tool" && attempt.name === "publish_artifact"
          ? {
              artifactReadbackSchema:
                "cc-dynamic-workflow-artifact-readback/v1",
            }
          : {}),
        ...(kind === "tool" &&
        Object.prototype.hasOwnProperty.call(attempt, "checkpointReadback")
          ? {
              checkpointReadbackSchema:
                "cc-dynamic-workflow-checkpoint-readback/v1",
              checkpointBindingDigest:
                attempt.checkpointBinding === null
                  ? null
                  : checkpointBindingDigest(attempt.checkpointBinding),
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

function effectCallSettlement(
  call,
  event,
  now,
  artifactStore,
  checkpointStore,
) {
  let status;
  let settlementCode = null;
  let providerUsage = call.providerUsage;
  let providerCostEstimate = call.providerCostEstimate;
  let providerReceiptPersisted = call.providerReceiptPersisted;
  let providerReceiptRequestId = call.providerReceiptRequestId;
  let providerReceiptResponseId = call.providerReceiptResponseId;
  let artifactReadback = call.artifactReadback;
  let checkpointReadback = call.checkpointReadback;
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
    if (Object.prototype.hasOwnProperty.call(call, "checkpointReadback")) {
      checkpointReadback = checkpointReadbackSettlement(
        event,
        checkpointStore,
        Object.prototype.hasOwnProperty.call(call, "checkpointBinding")
          ? call.checkpointBinding
          : null,
      );
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
    ...(call.kind === "tool" &&
    Object.prototype.hasOwnProperty.call(call, "checkpointReadback")
      ? { checkpointReadback }
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
  checkpointStore,
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
    const settlement = effectCallSettlement(
      call,
      event,
      now,
      artifactStore,
      checkpointStore,
    );
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
    const hasCheckpointReadback = Object.prototype.hasOwnProperty.call(
      settlement,
      "checkpointReadback",
    );
    const settledCheckpointReadbackDigest =
      kind === "tool" &&
      hasCheckpointReadback &&
      settlement.checkpointReadback !== null
        ? checkpointReadbackDigest(settlement.checkpointReadback)
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
        ...(kind === "tool" && hasCheckpointReadback
          ? { checkpointReadbackDigest: settledCheckpointReadbackDigest }
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
  checkpointStore,
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
        checkpointStore,
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

function finalizeInputAfterSettlementBarrier(statePath, runId, now) {
  return withStateMutation(statePath, (current) => {
    if (!current || current.runId !== runId) return { value: current };
    if (current.status !== "input_requested") return { value: current };
    if (current.effects.some((effect) => effect.status === "pending")) {
      return { value: current };
    }
    const pending = runtimeInputRequests(current).find(
      (request) => request.status === "pending",
    );
    if (!pending) {
      throw new Error("workflow input barrier has no pending request");
    }
    const state = transition(
      current,
      "run-needs-input",
      { requestId: pending.id, barrier: "all-requested-effects-settled" },
      (draft) => {
        draft.status = "needs_input";
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
    if (current.status === "input_requested") {
      const state = transition(
        current,
        "run-needs-input",
        { barrier: "workflow-completion" },
        (draft) => {
          draft.status = "needs_input";
        },
        now,
      );
      return { state, value: { control: "needs-input", state } };
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
      [
        "paused",
        "blocked",
        "pause_requested",
        "input_requested",
        "needs_input",
      ].includes(current.status)
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

function managedCheckpointRuntimeExclusions(cwd, statePath, existing = []) {
  const exclusions = Array.isArray(existing) ? [...existing] : [];
  if (typeof cwd !== "string" || !cwd.trim()) return exclusions;
  const workspaceRoot = path.resolve(cwd);
  const runtimeStatePath = path.resolve(statePath);
  const relativeState = path.relative(workspaceRoot, runtimeStatePath);
  if (
    !relativeState ||
    path.isAbsolute(relativeState) ||
    relativeState === ".." ||
    relativeState.startsWith(`..${path.sep}`)
  ) {
    return exclusions;
  }
  const relativeDirectory = path.dirname(relativeState);
  const exclusion =
    relativeDirectory === "." ? relativeState : relativeDirectory;
  return [...new Set([...exclusions, exclusion.replaceAll("\\", "/")])];
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
  const checkpointStore =
    deps.checkpointStore || new WorkspaceTransactionManager();
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
        checkpointStore,
      );
      result = await deps.runTask({
        ...args,
        workflowEffectId: effect.id,
        managedCheckpoint: true,
        managedCheckpointExclusions: managedCheckpointRuntimeExclusions(
          args.cwd,
          statePath,
          args.managedCheckpointExclusions,
        ),
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
      resolveInput: (request) =>
        resolveDurableWorkflowStageInput(statePath, runId, request, deps.now),
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
      error.reason === "needs-input"
    ) {
      const state = finalizeInputAfterSettlementBarrier(
        statePath,
        runId,
        deps.now,
      );
      const pendingEffect = state?.effects?.find(
        (effect) => effect.status === "pending",
      );
      if (pendingEffect) {
        throw controlError(
          `workflow effect ${pendingEffect.id} requires reconciliation before input can settle`,
          "reconciliation-required",
          state,
          pendingEffect,
          error,
        );
      }
      throw controlError(
        "dynamic workflow run needs input after its settlement barrier",
        "needs-input",
        state,
        null,
        error,
      );
    }
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
    if (["input_requested", "needs_input"].includes(current.status)) {
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
        const resolvedAt = isoNow(deps.now);
        draft.inputRequests = runtimeInputRequests(draft).map((request) =>
          request.status === "pending"
            ? { ...request, status: "cancelled", resolvedAt }
            : request,
        );
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
    const pendingInput = runtimeInputRequests(current).find(
      (request) => request.status === "pending",
    );
    if (pendingInput) {
      const error = new Error(
        `workflow input request ${pendingInput.id} must be answered before resume`,
      );
      error.code = "CC_DYNAMIC_WORKFLOW_INPUT_REQUIRED";
      error.pendingInputRequest = pendingInput;
      throw error;
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

export function submitDurableWorkflowInput(statePath, input = {}, deps = {}) {
  const requestId = String(input.requestId || "")
    .trim()
    .toLowerCase();
  if (!SHA256_RE.test(requestId)) {
    throw new TypeError("workflow input request id is invalid");
  }
  return withStateMutation(path.resolve(statePath), (current) => {
    if (!current)
      throw new Error("dynamic workflow runtime state was not found");
    requireRevision(current, input.expectedRevision);
    if (current.status !== "needs_input") {
      throw new Error(
        `cannot answer workflow input while run is ${current.status}`,
      );
    }
    if (current.effects.some((effect) => effect.status === "pending")) {
      throw new Error(
        "workflow input cannot be answered before the effect settlement barrier",
      );
    }
    const requests = runtimeInputRequests(current);
    const requestIndex = requests.findIndex(
      (request) => request.id === requestId,
    );
    const request = requests[requestIndex];
    if (!request || request.status !== "pending") {
      throw new Error("workflow input request is not pending");
    }
    const answer = normalizeStageInputAnswer(input.answer, request);
    const responseDigest = stageInputResponseDigest(requestId, answer);
    const resolvedAt = isoNow(deps.now);
    const state = transition(
      current,
      "input-answered",
      { requestId, stepId: request.stepId, responseDigest },
      (draft) => {
        draft.inputRequests = [...runtimeInputRequests(draft)];
        draft.inputRequests[requestIndex] = {
          ...draft.inputRequests[requestIndex],
          status: "answered",
          resolvedAt,
          responseDigest,
          response: answer,
        };
        draft.status = "ready";
      },
      deps.now,
    );
    return { state, value: state };
  });
}

function checkpointReadbackFromPreparedBinding(binding, checkpointStore) {
  if (!validCheckpointBinding(binding)) {
    throw new TypeError("workflow checkpoint prepared binding is malformed");
  }
  if (!checkpointStore || typeof checkpointStore.inspect !== "function") {
    throw new TypeError("workflow checkpoint store readback is unavailable");
  }
  let stored;
  try {
    stored = checkpointStore.inspect(binding.transactionId);
  } catch {
    throw new TypeError("workflow checkpoint store readback failed");
  }
  if (
    ![
      WORKSPACE_TRANSACTION_STATE.COMMITTED,
      WORKSPACE_TRANSACTION_STATE.ROLLED_BACK,
    ].includes(stored?.state)
  ) {
    return null;
  }
  const evidence = checkpointEvidenceSnapshot(stored.evidence);
  if (!validCheckpointEvidence(evidence)) {
    throw new TypeError("workflow checkpoint terminal evidence is malformed");
  }
  return checkpointStoreReadback(evidence, checkpointStore, binding);
}

export function recoverDurableWorkflowCheckpointCall(
  statePath,
  input = {},
  deps = {},
) {
  const callRecordId = String(input.callRecordId || "")
    .trim()
    .toLowerCase();
  if (!SHA256_RE.test(callRecordId)) {
    throw new TypeError("callRecordId is invalid");
  }
  const checkpointStore =
    deps.checkpointStore || new WorkspaceTransactionManager();
  return withStateMutation(path.resolve(statePath), (current) => {
    if (!current) {
      throw new Error("dynamic workflow runtime state was not found");
    }
    requireRevision(current, input.expectedRevision);
    let effectIndex = -1;
    let callIndex = -1;
    for (const [candidateEffectIndex, effect] of current.effects.entries()) {
      const candidateCallIndex = (effect.calls || []).findIndex(
        (call) => call.id === callRecordId,
      );
      if (candidateCallIndex >= 0) {
        effectIndex = candidateEffectIndex;
        callIndex = candidateCallIndex;
        break;
      }
    }
    const effect = current.effects[effectIndex];
    const call = effect?.calls?.[callIndex];
    if (
      !effect ||
      effect.status !== "pending" ||
      !call ||
      call.kind !== "tool" ||
      call.status !== "started"
    ) {
      throw new Error(
        "workflow checkpoint call is not pending terminal recovery",
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(call, "artifactReadback") ||
      !Object.prototype.hasOwnProperty.call(call, "checkpointBinding") ||
      !validCheckpointBinding(call.checkpointBinding)
    ) {
      throw new Error(
        "workflow checkpoint call has no recoverable prepared binding",
      );
    }
    const checkpointReadback = checkpointReadbackFromPreparedBinding(
      call.checkpointBinding,
      checkpointStore,
    );
    if (checkpointReadback === null) {
      const error = new Error(
        "workflow checkpoint transaction has not reached a recoverable terminal state",
      );
      error.code = "CC_DYNAMIC_WORKFLOW_CHECKPOINT_NOT_TERMINAL";
      throw error;
    }
    const committed = checkpointReadback.outcome === "committed";
    const settledAt = isoNow(deps.now);
    const settlementCode = committed
      ? "checkpoint_store_recovered_commit"
      : "checkpoint_store_recovered_rollback";
    const state = transition(
      current,
      "effect-call-settled",
      {
        effectId: effect.id,
        callRecordId: call.id,
        kind: "tool",
        status: committed ? "completed" : "failed",
        checkpointReadbackDigest: checkpointReadbackDigest(checkpointReadback),
        checkpointRecovery: "terminal-store",
      },
      (draft) => {
        const calls = [...(draft.effects[effectIndex].calls || [])];
        calls[callIndex] = {
          ...calls[callIndex],
          status: committed ? "completed" : "failed",
          settledAt,
          outcomeUnknown: false,
          settlementCode,
          checkpointReadback,
        };
        draft.effects[effectIndex] = {
          ...draft.effects[effectIndex],
          calls,
        };
      },
      deps.now,
    );
    return { state, value: state };
  });
}

export function recoverDurableWorkflowCheckpointCalls(
  statePath,
  input = {},
  deps = {},
) {
  const checkpointStore =
    deps.checkpointStore || new WorkspaceTransactionManager();
  return withStateMutation(path.resolve(statePath), (current) => {
    if (!current) {
      throw new Error("dynamic workflow runtime state was not found");
    }
    requireRevision(current, input.expectedRevision);
    const recoveries = [];
    for (const [effectIndex, effect] of current.effects.entries()) {
      if (effect.status !== "pending") continue;
      for (const [callIndex, call] of (effect.calls || []).entries()) {
        if (
          call.kind !== "tool" ||
          call.status !== "started" ||
          Object.prototype.hasOwnProperty.call(call, "artifactReadback") ||
          !Object.prototype.hasOwnProperty.call(call, "checkpointBinding") ||
          !validCheckpointBinding(call.checkpointBinding)
        ) {
          continue;
        }
        const checkpointReadback = checkpointReadbackFromPreparedBinding(
          call.checkpointBinding,
          checkpointStore,
        );
        if (checkpointReadback === null) continue;
        const committed = checkpointReadback.outcome === "committed";
        recoveries.push({
          effectIndex,
          callIndex,
          effectId: effect.id,
          callRecordId: call.id,
          committed,
          checkpointReadback,
          settlementCode: committed
            ? "checkpoint_store_recovered_commit"
            : "checkpoint_store_recovered_rollback",
        });
      }
    }
    if (recoveries.length === 0) {
      const error = new Error(
        "no workflow checkpoint calls have a recoverable terminal store state",
      );
      error.code = "CC_DYNAMIC_WORKFLOW_CHECKPOINT_BATCH_EMPTY";
      throw error;
    }
    if (current.lineage.length + recoveries.length > MAX_LINEAGE_EVENTS) {
      throw new Error(
        "dynamic workflow runtime lineage limit prevents batch recovery",
      );
    }
    const settledAt = isoNow(deps.now);
    const draft = snapshotJson(
      stateMaterial(current),
      "workflow checkpoint batch recovery",
    );
    for (const recovery of recoveries) {
      const calls = [...(draft.effects[recovery.effectIndex].calls || [])];
      calls[recovery.callIndex] = {
        ...calls[recovery.callIndex],
        status: recovery.committed ? "completed" : "failed",
        settledAt,
        outcomeUnknown: false,
        settlementCode: recovery.settlementCode,
        checkpointReadback: recovery.checkpointReadback,
      };
      draft.effects[recovery.effectIndex] = {
        ...draft.effects[recovery.effectIndex],
        calls,
      };
      appendLineage(
        draft,
        "effect-call-settled",
        {
          effectId: recovery.effectId,
          callRecordId: recovery.callRecordId,
          kind: "tool",
          status: recovery.committed ? "completed" : "failed",
          checkpointReadbackDigest: checkpointReadbackDigest(
            recovery.checkpointReadback,
          ),
          checkpointRecovery: "terminal-store-batch",
        },
        settledAt,
      );
    }
    const state = finalizeState(draft);
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
      checkpointReadback:
        call.kind === "tool" && validCheckpointReadback(call.checkpointReadback)
          ? call.checkpointReadback
          : null,
      checkpointReadbackSchemaPresent:
        call.kind === "tool" &&
        Object.prototype.hasOwnProperty.call(call, "checkpointReadback"),
      checkpointBinding:
        call.kind === "tool" && validCheckpointBinding(call.checkpointBinding)
          ? call.checkpointBinding
          : null,
      checkpointBindingSchemaPresent:
        call.kind === "tool" &&
        Object.prototype.hasOwnProperty.call(call, "checkpointBinding"),
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
    checkpointReadbackRecords: lineage.filter(
      (call) => call.checkpointReadback !== null,
    ).length,
    checkpointBindingRecords: lineage.filter(
      (call) => call.checkpointBinding !== null,
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

function projectCheckpointStoreReadbacks(state) {
  const lineage = [];
  const verifiedEffectIds = new Set();
  let toolCalls = 0;
  let completedCalls = 0;
  let failedCalls = 0;
  let pendingCalls = 0;
  let outcomeUnknownCalls = 0;
  let operatorReconciledCalls = 0;
  let committedCalls = 0;
  let rolledBackCalls = 0;
  let fullCoverageCalls = 0;
  let partialCoverageCalls = 0;
  let externalSideEffectCalls = 0;
  let preparedBindingCalls = 0;
  let terminalStoreRecoveredCalls = 0;
  let bindingLegacyCalls = 0;
  let missingReadbacks = 0;
  let legacyCalls = 0;
  for (const effect of state.effects) {
    for (const call of effect.calls || []) {
      if (call.kind !== "tool" || !managedToolCheckpointRequired(call.name)) {
        continue;
      }
      toolCalls += 1;
      if (call.status === "completed") completedCalls += 1;
      if (call.status === "failed") failedCalls += 1;
      if (call.status === "started") pendingCalls += 1;
      if (call.status === "outcome_unknown") outcomeUnknownCalls += 1;
      if (call.status === "operator_reconciled") operatorReconciledCalls += 1;
      if (!Object.prototype.hasOwnProperty.call(call, "checkpointBinding")) {
        bindingLegacyCalls += 1;
      }
      if (validCheckpointBinding(call.checkpointBinding)) {
        preparedBindingCalls += 1;
      }
      if (
        [
          "checkpoint_store_recovered_commit",
          "checkpoint_store_recovered_rollback",
        ].includes(call.settlementCode)
      ) {
        terminalStoreRecoveredCalls += 1;
      }
      if (!Object.prototype.hasOwnProperty.call(call, "checkpointReadback")) {
        legacyCalls += 1;
        missingReadbacks += 1;
        continue;
      }
      if (!validCheckpointReadback(call.checkpointReadback)) {
        missingReadbacks += 1;
        continue;
      }
      if (call.checkpointReadback.outcome === "committed") committedCalls += 1;
      if (call.checkpointReadback.outcome === "rolled_back") {
        rolledBackCalls += 1;
      }
      if (
        call.checkpointReadback.coverage === WORKSPACE_TRANSACTION_COVERAGE.FULL
      ) {
        fullCoverageCalls += 1;
      }
      if (
        call.checkpointReadback.coverage ===
        WORKSPACE_TRANSACTION_COVERAGE.PARTIAL
      ) {
        partialCoverageCalls += 1;
      }
      if (call.checkpointReadback.externalSideEffects) {
        externalSideEffectCalls += 1;
      }
      verifiedEffectIds.add(effect.id);
      lineage.push({
        effectId: effect.id,
        ownerEffectId: call.ownerEffectId ?? effect.id,
        callRecordId: call.id,
        callId: call.callId,
        sequence: call.sequence,
        tool: call.name,
        descendant: (call.ownerEffectId ?? effect.id) !== effect.id,
        settledAt: call.settledAt,
        readback: call.checkpointReadback,
        readbackDigest: checkpointReadbackDigest(call.checkpointReadback),
      });
    }
  }
  return {
    authority:
      legacyCalls > 0
        ? "workspace-transaction-store-terminal-readback-with-legacy-call-schema"
        : "workspace-transaction-store-terminal-readback",
    verificationTiming: "tool-settlement",
    rollbackScope: "workspace-files-only",
    externalSideEffectsRollbackProven: false,
    toolCalls,
    completedCalls,
    failedCalls,
    verifiedCalls: lineage.length,
    verifiedEffects: verifiedEffectIds.size,
    committedCalls,
    rolledBackCalls,
    fullCoverageCalls,
    partialCoverageCalls,
    externalSideEffectCalls,
    preparedBindingCalls,
    terminalStoreRecoveredCalls,
    bindingLegacyCalls,
    missingReadbacks,
    pendingCalls,
    outcomeUnknownCalls,
    operatorReconciledCalls,
    legacyCalls,
    lineageDigest: digest(
      "chainlesschain.dynamic-workflow.checkpoint-store-readback-lineage.v1\0",
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
  const checkpointStoreReadbacks = projectCheckpointStoreReadbacks(state);
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
  if (checkpointStoreReadbacks.verifiedCalls === 0) {
    gaps.push("checkpoint-provider-readback-unavailable");
  }
  if (checkpointStoreReadbacks.missingReadbacks > 0) {
    gaps.push("checkpoint-store-readback-incomplete");
  }
  if (checkpointStoreReadbacks.legacyCalls > 0) {
    gaps.push("checkpoint-store-readback-legacy-call-schema");
  }
  if (
    checkpointStoreReadbacks.preparedBindingCalls <
    checkpointStoreReadbacks.toolCalls
  ) {
    gaps.push("checkpoint-prepared-binding-incomplete");
  }
  if (checkpointStoreReadbacks.bindingLegacyCalls > 0) {
    gaps.push("checkpoint-prepared-binding-legacy-call-schema");
  }
  if (
    checkpointStoreReadbacks.verifiedCalls > 0 &&
    checkpointStoreReadbacks.fullCoverageCalls <
      checkpointStoreReadbacks.verifiedCalls
  ) {
    gaps.push("checkpoint-full-coverage-incomplete");
  }
  if (checkpointStoreReadbacks.externalSideEffectCalls > 0) {
    gaps.push("checkpoint-external-side-effect-rollback-unavailable");
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
        storeReadbacks: checkpointStoreReadbacks,
      },
      gaps,
    },
    "dynamic workflow observability projection",
    2 * 1024 * 1024,
  );
}

function projectCurrentWorkflowStoreReadbacks(state, deps = {}) {
  const artifactStore = deps.artifactStore || new ArtifactStore();
  const checkpointStore =
    deps.checkpointStore || new WorkspaceTransactionManager();
  const artifacts = {
    eligibleCalls: 0,
    verifiedCalls: 0,
    mismatchedCalls: 0,
    unavailableCalls: 0,
    lineage: [],
  };
  const checkpoints = {
    eligibleCalls: 0,
    verifiedCalls: 0,
    mismatchedCalls: 0,
    unavailableCalls: 0,
    lineage: [],
  };

  for (const effect of state.effects) {
    for (const call of effect.calls || []) {
      if (validArtifactReadback(call.artifactReadback)) {
        artifacts.eligibleCalls += 1;
        const storedDigest = artifactReadbackDigest(call.artifactReadback);
        let currentDigest = null;
        let status = "unavailable";
        try {
          const current = artifactReadbackSettlement(
            { result: { published: call.artifactReadback.metadata } },
            artifactStore,
          );
          currentDigest = artifactReadbackDigest(current);
          status = currentDigest === storedDigest ? "verified" : "mismatch";
        } catch {
          status = "unavailable";
        }
        if (status === "verified") artifacts.verifiedCalls += 1;
        else if (status === "mismatch") artifacts.mismatchedCalls += 1;
        else artifacts.unavailableCalls += 1;
        artifacts.lineage.push({
          effectId: effect.id,
          callRecordId: call.id,
          artifactId: call.artifactReadback.metadata.id,
          storedReadbackDigest: storedDigest,
          currentReadbackDigest: currentDigest,
          status,
        });
      }

      if (validCheckpointReadback(call.checkpointReadback)) {
        checkpoints.eligibleCalls += 1;
        const storedDigest = checkpointReadbackDigest(call.checkpointReadback);
        let currentDigest = null;
        let status = "unavailable";
        if (validCheckpointBinding(call.checkpointBinding)) {
          try {
            const current = checkpointReadbackFromPreparedBinding(
              call.checkpointBinding,
              checkpointStore,
            );
            if (current !== null) {
              currentDigest = checkpointReadbackDigest(current);
              status = currentDigest === storedDigest ? "verified" : "mismatch";
            }
          } catch {
            status = "unavailable";
          }
        }
        if (status === "verified") checkpoints.verifiedCalls += 1;
        else if (status === "mismatch") checkpoints.mismatchedCalls += 1;
        else checkpoints.unavailableCalls += 1;
        checkpoints.lineage.push({
          effectId: effect.id,
          callRecordId: call.id,
          transactionId: call.checkpointReadback.transactionId,
          checkpointId: call.checkpointReadback.checkpointId,
          storedReadbackDigest: storedDigest,
          currentReadbackDigest: currentDigest,
          status,
        });
      }
    }
  }

  const gaps = [];
  if (artifacts.mismatchedCalls > 0) {
    gaps.push("artifact-store-current-readback-mismatch");
  }
  if (artifacts.unavailableCalls > 0) {
    gaps.push("artifact-store-current-readback-unavailable");
  }
  if (checkpoints.mismatchedCalls > 0) {
    gaps.push("checkpoint-store-current-readback-mismatch");
  }
  if (checkpoints.unavailableCalls > 0) {
    gaps.push("checkpoint-store-current-readback-unavailable");
  }
  const eligibleCalls = artifacts.eligibleCalls + checkpoints.eligibleCalls;
  const verifiedCalls = artifacts.verifiedCalls + checkpoints.verifiedCalls;
  return snapshotJson(
    {
      schema: "cc-dynamic-workflow-current-store-readback/v1",
      authority: "artifact-and-checkpoint-store-at-status-projection",
      verificationTiming: "runtime-status",
      complete: eligibleCalls > 0 && eligibleCalls === verifiedCalls,
      eligibleCalls,
      verifiedCalls,
      artifacts: {
        ...artifacts,
        lineageDigest: digest(
          "chainlesschain.dynamic-workflow.current-artifact-readback-lineage.v1\0",
          artifacts.lineage,
        ),
      },
      checkpoints: {
        ...checkpoints,
        lineageDigest: digest(
          "chainlesschain.dynamic-workflow.current-checkpoint-readback-lineage.v1\0",
          checkpoints.lineage,
        ),
      },
      gaps,
    },
    "dynamic workflow current store readback projection",
    2 * 1024 * 1024,
  );
}

export function projectDynamicWorkflowRuntime(stateOrPath, options = {}) {
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
    inputRequestCount: runtimeInputRequests(state).length,
    answeredInputRequestCount: runtimeInputRequests(state).filter(
      (request) => request.status === "answered",
    ).length,
    pendingInputRequests: Object.freeze(
      runtimeInputRequests(state)
        .filter((request) => request.status === "pending")
        .map((request) =>
          Object.freeze({
            id: request.id,
            stepId: request.stepId,
            prompt: request.prompt,
            options: request.options
              ? Object.freeze([...request.options])
              : null,
            multiSelect: request.multiSelect,
            requestedAt: request.requestedAt,
          }),
        ),
    ),
    finalRecordStatus: state.finalRecord?.status || null,
    observability: projectDynamicWorkflowObservability(state),
    currentStoreReadbacks:
      options.currentStoreReadback === true
        ? projectCurrentWorkflowStoreReadbacks(state, options)
        : null,
    updatedAt: state.updatedAt,
    stateDigest: state.stateDigest,
  });
}

function checkpointRecoverySummary(state, options = {}) {
  const checkpointStore =
    options.checkpointStore || new WorkspaceTransactionManager();
  let prepared = 0;
  let terminal = 0;
  let pending = 0;
  let unavailable = 0;
  for (const effect of state.effects) {
    if (effect.status !== "pending") continue;
    for (const call of effect.calls || []) {
      if (
        call.kind !== "tool" ||
        call.status !== "started" ||
        Object.hasOwn(call, "artifactReadback") ||
        !validCheckpointBinding(call.checkpointBinding)
      ) {
        continue;
      }
      prepared += 1;
      try {
        if (
          checkpointReadbackFromPreparedBinding(
            call.checkpointBinding,
            checkpointStore,
          ) === null
        ) {
          pending += 1;
        } else {
          terminal += 1;
        }
      } catch {
        unavailable += 1;
      }
    }
  }
  return Object.freeze({ prepared, terminal, pending, unavailable });
}

function observedBudgetStatus(observed, limit, complete) {
  if (!Number.isFinite(limit) || !Number.isFinite(observed) || !complete) {
    return "unknown";
  }
  return observed > limit ? "exceeded" : "within";
}

const WORKFLOW_RECOVERY_BACKOFF_MS = Object.freeze([
  15_000,
  60_000,
  5 * 60_000,
  15 * 60_000,
]);

function dynamicWorkflowRecoveryPolicy(state, recovery) {
  const pendingInput = runtimeInputRequests(state).filter(
    (request) => request.status === "pending",
  ).length;
  const pendingEffects = state.effects.filter(
    (effect) => effect.status === "pending",
  );
  const uncertainEffects = pendingEffects.filter(
    (effect) => !isKnownUndispatched(effect),
  ).length;
  let risk = "none";
  let severity = "info";
  let recommendedAction = "none";
  let requiresApproval = false;
  let automaticallyExecutable = false;

  if (recovery.terminal > 0) {
    risk = "terminal_checkpoint_recovery";
    severity = "warning";
    recommendedAction = "recover";
    requiresApproval = true;
    automaticallyExecutable = true;
  } else if (pendingInput > 0) {
    risk = "input_required";
    severity = "warning";
    recommendedAction = "reply";
    requiresApproval = true;
  } else if (uncertainEffects > 0) {
    risk = "operator_adjudication_required";
    severity = "critical";
    recommendedAction = "reconcile";
    requiresApproval = true;
  } else if (state.status === "pause_requested") {
    risk = "settlement_barrier_pending";
    severity = "info";
    recommendedAction = "wait";
  } else if (
    ["paused", "failed", "blocked"].includes(state.status) &&
    pendingEffects.length === 0
  ) {
    risk = "restart_ready";
    severity = "warning";
    recommendedAction = "resume";
    requiresApproval = true;
    automaticallyExecutable = true;
  }

  const notificationKey = digest(
    "chainlesschain.dynamic-workflow.recovery-notification.v1\0",
    {
      runId: state.runId,
      revision: state.revision,
      stateDigest: state.stateDigest,
      risk,
      recommendedAction,
    },
  );
  return Object.freeze({
    schema: "cc-dynamic-workflow-recovery-policy/v1",
    risk,
    severity,
    recommendedAction,
    requiresApproval,
    automaticallyExecutable,
    unattendedMutationAllowed: false,
    pendingInput,
    pendingEffects: pendingEffects.length,
    uncertainEffects,
    notification: Object.freeze({
      key: notificationKey,
      backoffMs: WORKFLOW_RECOVERY_BACKOFF_MS,
      resetOnStateDigestChange: true,
    }),
  });
}

/**
 * Bounded, content-free view used by the cross-IDE Sessions Workbench. Tool
 * arguments, prompts, provider output, result bodies, and filesystem bindings
 * deliberately never cross this projection boundary.
 */
export function projectDynamicWorkflowWorkbenchState(
  stateOrPath,
  options = {},
) {
  const state =
    typeof stateOrPath === "string"
      ? readDynamicWorkflowRuntimeState(stateOrPath)
      : verifyDynamicWorkflowRuntimeState(stateOrPath);
  const observability = projectDynamicWorkflowObservability(state);
  const recovery = checkpointRecoverySummary(state, options);
  const recoveryPolicy = dynamicWorkflowRecoveryPolicy(state, recovery);
  const recentEffect = state.effects.at(-1) || null;
  const recentCall = recentEffect?.calls?.at(-1) || null;
  const lastTransition = state.lineage.at(-1) || null;
  const budget = state.executionBudget || null;
  const providerTokens = observability.tokens.providerReported?.totalTokens;
  const observedTokens = Number.isFinite(providerTokens)
    ? providerTokens
    : observability.tokens.missingEffects === 0
      ? observability.tokens.estimated
      : null;
  const tokenComplete =
    Number.isFinite(providerTokens) ||
    observability.tokens.missingEffects === 0;
  const observedUsd = Number.isFinite(observability.cost.estimatedUsd)
    ? observability.cost.estimatedUsd
    : null;
  const costComplete =
    observability.cost.providerCalls === observability.cost.pricedCalls;
  const observedDurationMs = observability.duration.totalMs;
  const durationComplete = observability.effects.pending === 0;
  const budgetStatus = {
    tokens: observedBudgetStatus(
      observedTokens,
      budget?.maxTokens,
      tokenComplete,
    ),
    usd: observedBudgetStatus(observedUsd, budget?.maxUsd, costComplete),
    duration: observedBudgetStatus(
      observedDurationMs,
      budget?.maxDurationMs,
      durationComplete,
    ),
  };
  const overallBudgetStatus = Object.values(budgetStatus).includes("exceeded")
    ? "exceeded"
    : Object.values(budgetStatus).includes("unknown")
      ? "unknown"
      : "within";

  return Object.freeze({
    schema: "cc-dynamic-workflow-workbench-state/v1",
    runId: state.runId,
    workflowId: state.workflowId,
    status: state.status,
    revision: state.revision,
    stateDigest: state.stateDigest,
    definitionDigest: state.definitionDigest,
    admissionDigest: state.admissionDigest,
    executionAuthoritySessionId: state.executionAuthoritySessionId,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    phase: Object.freeze({
      status: state.status,
      transition: lastTransition?.type || "run-created",
      at: lastTransition?.at || state.createdAt,
    }),
    agents: Object.freeze({
      requested: observability.effects.requested,
      settled: observability.effects.settled,
      pending: observability.effects.pending,
      completed: observability.effects.completedTasks,
      failed: observability.effects.failedTasks,
    }),
    input: Object.freeze({
      requested: runtimeInputRequests(state).length,
      pending: runtimeInputRequests(state).filter(
        (request) => request.status === "pending",
      ).length,
    }),
    budget: Object.freeze({
      limits: budget,
      observed: Object.freeze({
        tokens: observedTokens,
        usd: observedUsd,
        durationMs: observedDurationMs,
      }),
      status: Object.freeze(budgetStatus),
      overall: overallBudgetStatus,
    }),
    artifacts: Object.freeze({ count: observability.artifacts.count }),
    checkpoints: Object.freeze({ count: observability.checkpoints.count }),
    recovery,
    recoveryPolicy,
    recent: recentEffect
      ? Object.freeze({
          effectId: recentEffect.id,
          stepId: recentEffect.stepId,
          status: recentEffect.status,
          taskStatus:
            recentEffect.result?.status === "completed" ||
            recentEffect.result?.status === "failed"
              ? recentEffect.result.status
              : null,
          requestedAt: recentEffect.requestedAt,
          settledAt: recentEffect.settledAt || null,
          resultDigest: recentEffect.resultDigest || null,
          call: recentCall
            ? Object.freeze({
                id: recentCall.id,
                kind: recentCall.kind,
                name: recentCall.name,
                status: recentCall.status,
                settlementCode: recentCall.settlementCode,
                settledAt: recentCall.settledAt,
              })
            : null,
        })
      : null,
  });
}

/** Securely discover durable workflow state files below one project root. */
export function listDynamicWorkflowWorkbenchStates(cwd, options = {}) {
  const limit = Math.max(1, Math.min(256, Number(options.limit) || 100));
  const projectionOptions = Object.hasOwn(options, "checkpointStore")
    ? options
    : { ...options, checkpointStore: new WorkspaceTransactionManager() };
  const directory = path.join(
    path.resolve(cwd),
    ".chainlesschain",
    "cowork",
    "workflow-runs",
  );
  let stat;
  try {
    stat = fs.lstatSync(directory);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return Object.freeze({ runs: Object.freeze([]), invalidCount: 0 });
    }
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("dynamic workflow runtime directory is not trusted");
  }
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  if (entries.length > MAX_WORKBENCH_RUN_FILES) {
    throw new Error("dynamic workflow runtime directory exceeds safe limits");
  }
  const runs = [];
  let invalidCount = 0;
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}\.json$/u.test(entry.name)
    ) {
      continue;
    }
    const runId = entry.name.slice(0, -".json".length);
    try {
      const statePath = dynamicWorkflowRunStatePath(cwd, runId);
      const state = readDynamicWorkflowRuntimeState(statePath);
      if (state.runId !== runId) throw new Error("run identity mismatch");
      runs.push(projectDynamicWorkflowWorkbenchState(state, projectionOptions));
    } catch {
      invalidCount += 1;
    }
  }
  runs.sort(
    (left, right) =>
      (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0) ||
      left.runId.localeCompare(right.runId),
  );
  return Object.freeze({
    runs: Object.freeze(runs.slice(0, limit)),
    invalidCount,
  });
}

/** Deterministic, non-mutating batch inventory for startup/periodic recovery. */
export function buildDynamicWorkflowRecoveryPlan(cwd, options = {}) {
  const discovered = listDynamicWorkflowWorkbenchStates(cwd, options);
  const policy = Object.freeze({
    schema: "cc-dynamic-workflow-recovery-policy-set/v1",
    unattendedMutationAllowed: false,
    approvalRequiredFor: Object.freeze([
      "recover",
      "resume",
      "reply",
      "reconcile",
    ]),
    backoffMs: WORKFLOW_RECOVERY_BACKOFF_MS,
  });
  const items = discovered.runs.map((run) =>
    Object.freeze({
      runId: run.runId,
      workflowId: run.workflowId,
      revision: run.revision,
      stateDigest: run.stateDigest,
      status: run.status,
      updatedAt: run.updatedAt,
      risk: run.recoveryPolicy.risk,
      severity: run.recoveryPolicy.severity,
      recommendedAction: run.recoveryPolicy.recommendedAction,
      requiresApproval: run.recoveryPolicy.requiresApproval,
      automaticallyExecutable: run.recoveryPolicy.automaticallyExecutable,
      notificationKey: run.recoveryPolicy.notification.key,
      recovery: run.recovery,
    }),
  );
  const summary = Object.freeze({
    total: items.length,
    invalid: discovered.invalidCount,
    attention: items.filter((item) => item.risk !== "none").length,
    critical: items.filter((item) => item.severity === "critical").length,
    approvalRequired: items.filter((item) => item.requiresApproval).length,
    automaticallyExecutable: items.filter(
      (item) => item.automaticallyExecutable,
    ).length,
  });
  const planMaterial = { policy, summary, items };
  return Object.freeze({
    schema: "cc-dynamic-workflow-recovery-plan/v1",
    authority: "cli",
    mode: "dry-run",
    generatedAt: isoNow(options.now),
    projectDigest: digest(
      "chainlesschain.dynamic-workflow.recovery-project.v1\0",
      path.resolve(cwd),
    ),
    planDigest: digest(
      "chainlesschain.dynamic-workflow.recovery-plan.v1\0",
      planMaterial,
    ),
    ...planMaterial,
  });
}
