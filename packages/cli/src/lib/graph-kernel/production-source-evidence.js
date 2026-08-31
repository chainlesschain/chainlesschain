import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import {
  canonicalGraphEvidenceJson as canonicalGraphJson,
  graphEvidenceDigest as graphDigest,
} from "./evidence-digest.js";
import { GRAPH_CUTOVER_REQUIRED_PLATFORMS } from "./cutover-contract.js";
import {
  GRAPH_LEGACY_WRITER_OBSERVATION_SCHEMA,
  GRAPH_RETIREMENT_EVIDENCE_SCHEMA,
  graphLegacyWriterObservationDigest,
  graphRetirementEvidenceDigest,
} from "./retirement-evidence.js";
import {
  assertGraphProductionRuntimeSurfaceManifest,
  graphRuntimeEntryManifestDigest,
  graphRuntimeSurfaceEntry,
  graphRuntimeSurfaceManifestDigest,
} from "./runtime-surface-manifest.js";

export const GRAPH_PRODUCTION_SOURCE_REGISTRY_SCHEMA =
  "chainlesschain.graph-production-source-registry/v1";
export const GRAPH_PRODUCTION_SOURCE_FRAGMENT_SCHEMA =
  "chainlesschain.graph-production-source-fragment/v1";
export const GRAPH_PRODUCTION_SOURCE_RECEIPT_SCHEMA =
  "chainlesschain.graph-production-source-receipt/v1";
export const GRAPH_PRODUCTION_RAW_LOG_SCHEMA =
  "chainlesschain.graph-production-raw-log/v1";
export const GRAPH_PRODUCTION_SOURCE_WORKFLOW =
  ".github/workflows/graph-kernel-production-evidence.yml";
export const GRAPH_PRODUCTION_SOURCE_REF = "refs/heads/main";
export const GRAPH_PRODUCTION_SOURCE_ENVIRONMENT = "graph-kernel-production";
export const GRAPH_PRODUCTION_SOURCE_JOB = "source";
export const GRAPH_PRODUCTION_REQUIRED_RUNNER_LABELS = Object.freeze([
  "graph-kernel-production",
  "physical",
  "self-hosted",
]);
// Covers the 120-minute physical source matrix plus hosted aggregation while
// still rejecting observations from another dispatch/challenge.
export const GRAPH_PRODUCTION_RECEIPT_MAX_AGE_MS = 3 * 60 * 60 * 1_000;
export const GRAPH_PRODUCTION_OBSERVATION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
export const GRAPH_PRODUCTION_CLOCK_SKEW_MS = 30 * 1_000;

const COMMIT = /^[a-f0-9]{40}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const CHALLENGE = /^[A-Za-z0-9_-]{32,128}$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const ZERO_DIGEST = `sha256:${"0".repeat(64)}`;
const WINDOW_EVENT_TYPES = new Set([
  "shadow_observation",
  "canary_observation",
  "retirement_observation",
  "legacy_writer_observation",
]);
const BASE_EVENT_TYPES = Object.freeze([
  "shadow_observation",
  "canary_observation",
  "rollback_observation",
  "final_ledger_observation",
  "legacy_writer_observation",
]);

function sourceError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "GraphProductionSourceEvidenceError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function text(value, field, maximumBytes = 1_024) {
  const normalized = String(value || "").trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > maximumBytes) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_INVALID",
      `${field} must be a non-empty bounded string`,
      { field },
    );
  }
  return normalized;
}

function exactCommit(value, field = "commitSha") {
  const normalized = String(value || "").toLowerCase();
  if (!COMMIT.test(normalized)) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_INVALID",
      `${field} must be an exact 40-character commit`,
      { field },
    );
  }
  return normalized;
}

function digest(value, field) {
  const normalized = String(value || "").toLowerCase();
  if (!DIGEST.test(normalized)) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_INVALID",
      `${field} must be a sha256 digest`,
      { field },
    );
  }
  return normalized;
}

function positive(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_INVALID",
      `${field} must be a positive safe integer`,
      { field, value },
    );
  }
  return normalized;
}

function nonNegative(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_INVALID",
      `${field} must be a non-negative safe integer`,
      { field, value },
    );
  }
  return normalized;
}

function timestamp(value, field) {
  const normalized = String(value || "");
  const milliseconds = Date.parse(normalized);
  const canonical = Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : "";
  if (
    !Number.isFinite(milliseconds) ||
    (canonical !== normalized &&
      canonical.replace(/\.000Z$/u, "Z") !== normalized)
  ) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_INVALID",
      `${field} must be a canonical ISO timestamp`,
      { field },
    );
  }
  return { value: canonical, milliseconds };
}

function exactMembers(actual, expected, field) {
  const normalizedActual = [...actual].sort();
  const normalizedExpected = [...expected].sort();
  if (
    new Set(normalizedActual).size !== normalizedActual.length ||
    normalizedActual.length !== normalizedExpected.length ||
    normalizedActual.some((value, index) => value !== normalizedExpected[index])
  ) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_COVERAGE_INCOMPLETE",
      `${field} must contain exactly ${normalizedExpected.join(", ")}`,
      { field, expected: normalizedExpected, actual: normalizedActual },
    );
  }
}

function uniqueStrings(value, field) {
  if (!Array.isArray(value) || value.length === 0) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_INVALID",
      `${field} must be a non-empty array`,
      { field },
    );
  }
  const normalized = value.map((entry, index) =>
    text(entry, `${field}[${index}]`, 128),
  );
  if (new Set(normalized).size !== normalized.length) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_INVALID",
      `${field} must not contain duplicates`,
      { field },
    );
  }
  return normalized.sort();
}

function uniqueLabels(value, field) {
  if (!Array.isArray(value) || value.length === 0) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_INVALID",
      `${field} must be a non-empty array`,
      { field },
    );
  }
  const normalized = value.map((entry, index) =>
    text(entry, `${field}[${index}]`, 128).toLowerCase(),
  );
  if (new Set(normalized).size !== normalized.length) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_INVALID",
      `${field} must not contain case-insensitive duplicates`,
      { field },
    );
  }
  return normalized.sort();
}

function includesEveryLabel(actual, required) {
  const labels = new Set(actual);
  return required.every((label) => labels.has(label));
}

function publicKeyDigest(publicKeySpki) {
  const bytes = Buffer.from(publicKeySpki, "base64url");
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function ed25519PublicKey(publicKeySpki, field) {
  if (!BASE64URL.test(String(publicKeySpki || ""))) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_REGISTRY_INVALID",
      `${field} must be base64url-encoded SPKI`,
      { field },
    );
  }
  let key;
  try {
    key = createPublicKey({
      key: Buffer.from(publicKeySpki, "base64url"),
      format: "der",
      type: "spki",
    });
  } catch (cause) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_REGISTRY_INVALID",
      `${field} is not a valid public key`,
      { field, cause },
    );
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_REGISTRY_INVALID",
      `${field} must contain an Ed25519 public key`,
      { field },
    );
  }
  return key;
}

export function graphProductionSourceRegistryDigest(value) {
  const unsigned = clone(value);
  delete unsigned.registryDigest;
  return graphDigest(unsigned, "cc.graph.production-source-registry/v1");
}

function normalizeJobsInventory(value, expected) {
  if (value === undefined) return null;
  const jobs = Array.isArray(value) ? value : value?.jobs;
  if (!Array.isArray(jobs)) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_JOB_INVENTORY_INVALID",
      "Actions job inventory must contain a jobs array",
    );
  }
  if (
    !Number.isSafeInteger(Number(value?.apiTotalCount)) ||
    Number(value.apiTotalCount) !== jobs.length
  ) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_JOB_INVENTORY_INVALID",
      "paginated Actions job inventory must match the API total_count",
    );
  }
  if (
    Number(value?.workflowRunId) !== expected.workflowRunId ||
    Number(value?.workflowRunAttempt) !== expected.workflowRunAttempt ||
    exactCommit(value?.headSha, "jobsInventory.headSha") !== expected.commitSha
  ) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_JOB_BINDING_MISMATCH",
      "Actions job inventory envelope does not bind its exact queried run, attempt, and commit",
    );
  }
  const sourceJobs = jobs.filter((job) =>
    /^Collect signed (?:linux|windows|macos) source receipts$/u.test(
      String(job?.name || ""),
    ),
  );
  if (sourceJobs.length !== GRAPH_CUTOVER_REQUIRED_PLATFORMS.length) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_JOB_INVENTORY_INVALID",
      "Actions job inventory must contain exactly the three fixed platform source jobs",
    );
  }
  const byId = new Map();
  for (const job of sourceJobs) {
    const id = positive(job?.id, "jobsInventory.id");
    const normalized = {
      id,
      runId: positive(job?.run_id, `jobsInventory.${id}.run_id`),
      headSha: exactCommit(job?.head_sha, `jobsInventory.${id}.head_sha`),
      name: text(job?.name, `jobsInventory.${id}.name`, 256),
      status: text(job?.status, `jobsInventory.${id}.status`, 32),
      conclusion: text(job?.conclusion, `jobsInventory.${id}.conclusion`, 32),
      runnerId: positive(job?.runner_id, `jobsInventory.${id}.runner_id`),
      runnerName: text(
        job?.runner_name,
        `jobsInventory.${id}.runner_name`,
        256,
      ),
      labels: uniqueLabels(job?.labels, `jobsInventory.${id}.labels`),
      startedAt: timestamp(job?.started_at, `jobsInventory.${id}.started_at`),
      completedAt: timestamp(
        job?.completed_at,
        `jobsInventory.${id}.completed_at`,
      ),
    };
    if (
      normalized.runId !== expected.workflowRunId ||
      (job?.run_attempt != null &&
        positive(job.run_attempt, `jobsInventory.${id}.run_attempt`) !==
          expected.workflowRunAttempt) ||
      normalized.headSha !== expected.commitSha
    ) {
      throw sourceError(
        "CC_GRAPH_PRODUCTION_JOB_BINDING_MISMATCH",
        `Actions job ${id} does not belong to the exact producer run, attempt, and commit`,
      );
    }
    if (
      normalized.status !== "completed" ||
      normalized.conclusion !== "success" ||
      normalized.completedAt.milliseconds < normalized.startedAt.milliseconds
    ) {
      throw sourceError(
        "CC_GRAPH_PRODUCTION_JOB_BINDING_MISMATCH",
        `Actions source job ${id} must be completed successfully with a canonical execution window`,
      );
    }
    if (byId.has(id)) {
      throw sourceError(
        "CC_GRAPH_PRODUCTION_JOB_INVENTORY_INVALID",
        `Actions job inventory duplicates id ${id}`,
      );
    }
    byId.set(id, normalized);
  }
  return byId;
}

export function normalizeGraphProductionSourceRegistry(
  input,
  { expectedRepository, expectedManifestDigest, expectedRegistryDigest } = {},
) {
  if (input?.schema !== GRAPH_PRODUCTION_SOURCE_REGISTRY_SCHEMA) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_REGISTRY_INVALID",
      `source registry schema must be ${GRAPH_PRODUCTION_SOURCE_REGISTRY_SCHEMA}`,
    );
  }
  const sources = Array.isArray(input?.sources)
    ? input.sources.map((entry, index) => {
        const platform = String(entry?.platform || "").toLowerCase();
        if (!GRAPH_CUTOVER_REQUIRED_PLATFORMS.includes(platform)) {
          throw sourceError(
            "CC_GRAPH_PRODUCTION_SOURCE_REGISTRY_INVALID",
            `sources[${index}].platform is not supported`,
          );
        }
        if (entry?.sourceKind !== "physical_self_hosted_runner") {
          throw sourceError(
            "CC_GRAPH_PRODUCTION_SOURCE_REGISTRY_INVALID",
            "the required platform mapping must use physical self-hosted runners",
          );
        }
        const runnerLabels = uniqueLabels(
          entry?.runner?.labels,
          `sources[${index}].runner.labels`,
        );
        for (const requiredLabel of [
          ...GRAPH_PRODUCTION_REQUIRED_RUNNER_LABELS,
          platform,
        ]) {
          if (!runnerLabels.includes(requiredLabel)) {
            throw sourceError(
              "CC_GRAPH_PRODUCTION_SOURCE_REGISTRY_INVALID",
              `sources[${index}] is missing runner label ${requiredLabel}`,
            );
          }
        }
        const publicKeySpki = text(
          entry?.publicKeySpki,
          `sources[${index}].publicKeySpki`,
          512,
        );
        ed25519PublicKey(publicKeySpki, `sources[${index}].publicKeySpki`);
        const normalized = {
          sourceId: text(entry?.sourceId, `sources[${index}].sourceId`, 128),
          platform,
          sourceKind: "physical_self_hosted_runner",
          enabled: entry?.enabled === true,
          validFrom: timestamp(entry?.validFrom, `sources[${index}].validFrom`)
            .value,
          validUntil: timestamp(
            entry?.validUntil,
            `sources[${index}].validUntil`,
          ).value,
          keyId: digest(entry?.keyId, `sources[${index}].keyId`),
          publicKeySpki,
          hardwareIdentityDigest: digest(
            entry?.hardwareIdentityDigest,
            `sources[${index}].hardwareIdentityDigest`,
          ),
          operatorIdentityDigest: digest(
            entry?.operatorIdentityDigest,
            `sources[${index}].operatorIdentityDigest`,
          ),
          attester: {
            identityDigest: digest(
              entry?.attester?.identityDigest,
              `sources[${index}].attester.identityDigest`,
            ),
            measurementDigest: digest(
              entry?.attester?.measurementDigest,
              `sources[${index}].attester.measurementDigest`,
            ),
            logAuthorityDigest: digest(
              entry?.attester?.logAuthorityDigest,
              `sources[${index}].attester.logAuthorityDigest`,
            ),
          },
          runner: {
            registrationId: positive(
              entry?.runner?.registrationId,
              `sources[${index}].runner.registrationId`,
            ),
            name: text(
              entry?.runner?.name,
              `sources[${index}].runner.name`,
              256,
            ),
            labels: runnerLabels,
          },
          collector: {
            endpoint: text(
              entry?.collector?.endpoint,
              `sources[${index}].collector.endpoint`,
              2_048,
            ),
            credentialDigest: digest(
              entry?.collector?.credentialDigest,
              `sources[${index}].collector.credentialDigest`,
            ),
          },
        };
        if (
          !normalized.enabled ||
          Date.parse(normalized.validFrom) >= Date.parse(normalized.validUntil)
        ) {
          throw sourceError(
            "CC_GRAPH_PRODUCTION_SOURCE_KEY_INACTIVE",
            `${normalized.sourceId} signing key is revoked or has an invalid validity window; historical validity is checked against the signed receipt and Actions job`,
          );
        }
        let collectorUrl;
        try {
          collectorUrl = new URL(normalized.collector.endpoint);
        } catch {
          collectorUrl = null;
        }
        if (
          !collectorUrl ||
          collectorUrl.protocol !== "https:" ||
          collectorUrl.username ||
          collectorUrl.password ||
          collectorUrl.search ||
          collectorUrl.hash
        ) {
          throw sourceError(
            "CC_GRAPH_PRODUCTION_SOURCE_REGISTRY_INVALID",
            `sources[${index}].collector.endpoint must be a credential-free HTTPS URL`,
          );
        }
        if (normalized.keyId !== publicKeyDigest(publicKeySpki)) {
          throw sourceError(
            "CC_GRAPH_PRODUCTION_SOURCE_REGISTRY_INVALID",
            `sources[${index}].keyId does not bind the Ed25519 public key`,
          );
        }
        return normalized;
      })
    : [];
  sources.sort((left, right) => left.platform.localeCompare(right.platform));
  exactMembers(
    sources.map((source) => source.platform),
    GRAPH_CUTOVER_REQUIRED_PLATFORMS,
    "source registry platforms",
  );
  exactMembers(
    sources.map((source) => source.sourceId),
    [...new Set(sources.map((source) => source.sourceId))],
    "source registry ids",
  );
  if (
    new Set(sources.map((source) => source.runner.registrationId)).size !==
      sources.length ||
    new Set(sources.map((source) => source.runner.name)).size !==
      sources.length ||
    new Set(sources.map((source) => source.keyId)).size !== sources.length ||
    new Set(sources.map((source) => source.hardwareIdentityDigest)).size !==
      sources.length ||
    new Set(sources.map((source) => source.operatorIdentityDigest)).size !==
      sources.length ||
    new Set(sources.map((source) => source.attester.identityDigest)).size !==
      sources.length ||
    new Set(sources.map((source) => source.attester.logAuthorityDigest))
      .size !== sources.length ||
    new Set(sources.map((source) => source.collector.credentialDigest)).size !==
      sources.length ||
    new Set(
      sources.map((source) => {
        const endpoint = new URL(source.collector.endpoint);
        return `${endpoint.origin}${endpoint.pathname}`;
      }),
    ).size !== sources.length
  ) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_REGISTRY_INVALID",
      "platform sources must use independent runners, hardware, operators, attesters, append-only log authorities, endpoints, credentials, and Ed25519 keys",
    );
  }
  const normalized = {
    schema: GRAPH_PRODUCTION_SOURCE_REGISTRY_SCHEMA,
    repository: text(input?.repository, "registry.repository"),
    ref: text(input?.ref, "registry.ref"),
    workflow: text(input?.workflow, "registry.workflow"),
    environment: text(input?.environment, "registry.environment"),
    manifestDigest: digest(input?.manifestDigest, "registry.manifestDigest"),
    sources,
  };
  if (
    (expectedRepository && normalized.repository !== expectedRepository) ||
    normalized.ref !== GRAPH_PRODUCTION_SOURCE_REF ||
    normalized.workflow !== GRAPH_PRODUCTION_SOURCE_WORKFLOW ||
    normalized.environment !== GRAPH_PRODUCTION_SOURCE_ENVIRONMENT ||
    (expectedManifestDigest &&
      normalized.manifestDigest !== expectedManifestDigest)
  ) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_REGISTRY_INVALID",
      "source registry does not match the protected producer identity or manifest",
    );
  }
  normalized.registryDigest = digest(
    input?.registryDigest,
    "registry.registryDigest",
  );
  const calculated = graphProductionSourceRegistryDigest(normalized);
  if (
    normalized.registryDigest !== calculated ||
    (expectedRegistryDigest &&
      normalized.registryDigest !== expectedRegistryDigest)
  ) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_REGISTRY_DIGEST_MISMATCH",
      "source registry digest does not match its canonical contents or protected pin",
      { calculated, expectedRegistryDigest },
    );
  }
  return Object.freeze(normalized);
}

export function graphProductionRawEventDigest(event, sourceId) {
  const unsigned = clone(event);
  delete unsigned.eventDigest;
  return graphDigest(
    { sourceId, event: unsigned },
    "cc.graph.production-raw-event/v1",
  );
}

export function graphProductionRawLogMerkleRoot(digests) {
  if (!Array.isArray(digests) || digests.length === 0) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_RAW_LOG_INVALID",
      "raw log cannot be empty",
    );
  }
  const leaves = digests.map((value, index) => {
    const eventDigest = digest(value, `rawLog.eventDigests[${index}]`);
    return createHash("sha256")
      .update(Buffer.concat([Buffer.from([0]), Buffer.from(eventDigest)]))
      .digest();
  });
  const treeHash = (nodes) => {
    if (nodes.length === 1) return nodes[0];
    let split = 1;
    while (split * 2 < nodes.length) split *= 2;
    return createHash("sha256")
      .update(
        Buffer.concat([
          Buffer.from([1]),
          treeHash(nodes.slice(0, split)),
          treeHash(nodes.slice(split)),
        ]),
      )
      .digest();
  };
  return `sha256:${treeHash(leaves).toString("hex")}`;
}

function expectedEventTypes(strategy) {
  if (strategy === "disabled") return ["disabled_probe"];
  return strategy === "retire"
    ? [...BASE_EVENT_TYPES, "retirement_observation"]
    : [...BASE_EVENT_TYPES];
}

function payloadObservationTime(type, payload, field) {
  if (WINDOW_EVENT_TYPES.has(type)) {
    return timestamp(payload?.endedAt, `${field}.payload.endedAt`);
  }
  if (type === "final_ledger_observation") {
    return timestamp(
      payload?.canonicalActivatedAt,
      `${field}.payload.canonicalActivatedAt`,
    );
  }
  return timestamp(payload?.observedAt, `${field}.payload.observedAt`);
}

function validateWindowPayload(payload, field, collectorEnded, nowMs) {
  const started = timestamp(payload?.startedAt, `${field}.startedAt`);
  const ended = timestamp(payload?.endedAt, `${field}.endedAt`);
  const durationMs = ended.milliseconds - started.milliseconds;
  const monotonicDurationMs = positive(
    payload?.monotonicDurationMs,
    `${field}.monotonicDurationMs`,
  );
  const driftTolerance = Math.max(5_000, Math.round(durationMs * 0.01));
  if (
    durationMs < 1 ||
    payload?.durationMs !== durationMs ||
    Math.abs(monotonicDurationMs - durationMs) > driftTolerance ||
    ended.milliseconds > collectorEnded.milliseconds ||
    started.milliseconds < nowMs - GRAPH_PRODUCTION_OBSERVATION_MAX_AGE_MS ||
    ended.milliseconds > nowMs + GRAPH_PRODUCTION_CLOCK_SKEW_MS
  ) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_CLOCK_INVALID",
      `${field} does not bind a current wall-clock and monotonic observation window`,
      { durationMs, monotonicDurationMs },
    );
  }
}

function normalizeRawLog(
  input,
  { source, strategy, collectorStarted, collectorEnded, nowMs, field },
) {
  if (input?.schema !== GRAPH_PRODUCTION_RAW_LOG_SCHEMA) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_RAW_LOG_INVALID",
      `${field}.schema must be ${GRAPH_PRODUCTION_RAW_LOG_SCHEMA}`,
    );
  }
  const events = Array.isArray(input?.events)
    ? input.events.map((entry, index) => {
        const eventField = `${field}.events[${index}]`;
        const type = text(entry?.type, `${eventField}.type`, 64);
        if (!expectedEventTypes(strategy).includes(type)) {
          throw sourceError(
            "CC_GRAPH_PRODUCTION_RAW_LOG_INVALID",
            `${eventField}.type is not valid for ${strategy}`,
          );
        }
        if (
          !entry?.payload ||
          typeof entry.payload !== "object" ||
          Array.isArray(entry.payload)
        ) {
          throw sourceError(
            "CC_GRAPH_PRODUCTION_RAW_LOG_INVALID",
            `${eventField}.payload must be an object`,
          );
        }
        const normalized = {
          sequence: positive(entry?.sequence, `${eventField}.sequence`),
          wallTime: timestamp(entry?.wallTime, `${eventField}.wallTime`).value,
          monotonicMs: nonNegative(
            entry?.monotonicMs,
            `${eventField}.monotonicMs`,
          ),
          type,
          payload: clone(entry.payload),
          previousEventDigest: digest(
            entry?.previousEventDigest,
            `${eventField}.previousEventDigest`,
          ),
        };
        normalized.eventDigest = digest(
          entry?.eventDigest,
          `${eventField}.eventDigest`,
        );
        const calculated = graphProductionRawEventDigest(
          normalized,
          source.sourceId,
        );
        if (normalized.eventDigest !== calculated) {
          throw sourceError(
            "CC_GRAPH_PRODUCTION_RAW_EVENT_DIGEST_MISMATCH",
            `${eventField}.eventDigest does not match its canonical event`,
          );
        }
        return normalized;
      })
    : [];
  exactMembers(
    events.map((event) => event.type),
    expectedEventTypes(strategy),
    `${field}.event types`,
  );
  let previousDigest = ZERO_DIGEST;
  let previousWall = -Infinity;
  let previousMonotonic = -1;
  for (const [index, event] of events.entries()) {
    const eventWall = Date.parse(event.wallTime);
    const wallDelta = eventWall - previousWall;
    const monotonicDelta = event.monotonicMs - previousMonotonic;
    const eventDriftTolerance = Number.isFinite(wallDelta)
      ? Math.max(5_000, Math.round(wallDelta * 0.01))
      : 0;
    if (
      event.sequence !== index + 1 ||
      event.previousEventDigest !== previousDigest ||
      eventWall < previousWall ||
      event.monotonicMs < previousMonotonic ||
      (Number.isFinite(wallDelta) &&
        Math.abs(monotonicDelta - wallDelta) > eventDriftTolerance) ||
      eventWall > collectorStarted.milliseconds ||
      eventWall > nowMs + GRAPH_PRODUCTION_CLOCK_SKEW_MS ||
      eventWall < nowMs - GRAPH_PRODUCTION_OBSERVATION_MAX_AGE_MS
    ) {
      throw sourceError(
        "CC_GRAPH_PRODUCTION_RAW_LOG_NOT_APPEND_ONLY",
        `${field} is not a monotonic append-only event chain`,
        { index },
      );
    }
    const observationTime = payloadObservationTime(
      event.type,
      event.payload,
      `${field}.events[${index}]`,
    );
    if (observationTime.value !== event.wallTime) {
      throw sourceError(
        "CC_GRAPH_PRODUCTION_SOURCE_CLOCK_INVALID",
        `${field}.events[${index}] wall time does not match its observation payload`,
      );
    }
    if (WINDOW_EVENT_TYPES.has(event.type)) {
      validateWindowPayload(
        event.payload,
        `${field}.events[${index}].payload`,
        collectorEnded,
        nowMs,
      );
    }
    previousDigest = event.eventDigest;
    previousWall = eventWall;
    previousMonotonic = event.monotonicMs;
  }
  const eventDigests = events.map((event) => event.eventDigest);
  const chainHead = digest(input?.chainHead, `${field}.chainHead`);
  const merkleRoot = digest(input?.merkleRoot, `${field}.merkleRoot`);
  if (
    chainHead !== eventDigests.at(-1) ||
    merkleRoot !== graphProductionRawLogMerkleRoot(eventDigests)
  ) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_RAW_LOG_ROOT_MISMATCH",
      `${field} chain head or Merkle root does not match the signed raw events`,
    );
  }
  return {
    schema: GRAPH_PRODUCTION_RAW_LOG_SCHEMA,
    bootIdDigest: digest(input?.bootIdDigest, `${field}.bootIdDigest`),
    events,
    chainHead,
    merkleRoot,
  };
}

export function graphProductionSourceReceiptSigningBytes(payload) {
  return Buffer.from(
    `cc.graph.production-source-receipt-signature/v1\0${canonicalGraphJson(payload)}`,
    "utf8",
  );
}

export function graphProductionSourceReceiptDigest(value) {
  const unsigned = clone(value);
  delete unsigned.receiptDigest;
  return graphDigest(unsigned, "cc.graph.production-source-receipt/v1");
}

export function signGraphProductionSourceReceipt(payload, privateKeyInput) {
  const privateKey =
    privateKeyInput?.type === "private"
      ? privateKeyInput
      : createPrivateKey(privateKeyInput);
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_SIGNATURE_INVALID",
      "source receipt signing key must be Ed25519",
    );
  }
  const signature = sign(
    null,
    graphProductionSourceReceiptSigningBytes(payload),
    privateKey,
  ).toString("base64url");
  const receipt = { payload: clone(payload), signature };
  receipt.receiptDigest = graphProductionSourceReceiptDigest(receipt);
  return receipt;
}

function normalizeSourceReceipt(
  input,
  {
    source,
    registry,
    expected,
    strategy,
    surface,
    entryId,
    entryManifestDigest,
    nowMs,
    jobsInventory,
    field,
  },
) {
  const payloadInput = input?.payload;
  if (payloadInput?.schema !== GRAPH_PRODUCTION_SOURCE_RECEIPT_SCHEMA) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_RECEIPT_INVALID",
      `${field}.payload schema is invalid`,
    );
  }
  const collectorStarted = timestamp(
    payloadInput?.collectorStartedAt,
    `${field}.payload.collectorStartedAt`,
  );
  const collectorEnded = timestamp(
    payloadInput?.collectorEndedAt,
    `${field}.payload.collectorEndedAt`,
  );
  const wallElapsed =
    collectorEnded.milliseconds - collectorStarted.milliseconds;
  const monotonicElapsedMs = nonNegative(
    payloadInput?.collectorMonotonicElapsedMs,
    `${field}.payload.collectorMonotonicElapsedMs`,
  );
  const collectorTolerance = Math.max(2_000, Math.round(wallElapsed * 0.2));
  if (
    wallElapsed < 0 ||
    Math.abs(monotonicElapsedMs - wallElapsed) > collectorTolerance ||
    collectorEnded.milliseconds > nowMs + GRAPH_PRODUCTION_CLOCK_SKEW_MS ||
    nowMs - collectorEnded.milliseconds > GRAPH_PRODUCTION_RECEIPT_MAX_AGE_MS
  ) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_CLOCK_INVALID",
      `${field} collector wall-clock/monotonic binding is stale or invalid`,
    );
  }
  const payload = {
    schema: GRAPH_PRODUCTION_SOURCE_RECEIPT_SCHEMA,
    sourceId: text(payloadInput?.sourceId, `${field}.payload.sourceId`, 128),
    platform: String(payloadInput?.platform || "").toLowerCase(),
    keyId: digest(payloadInput?.keyId, `${field}.payload.keyId`),
    registryDigest: digest(
      payloadInput?.registryDigest,
      `${field}.payload.registryDigest`,
    ),
    manifestDigest: digest(
      payloadInput?.manifestDigest,
      `${field}.payload.manifestDigest`,
    ),
    entryManifestDigest: digest(
      payloadInput?.entryManifestDigest,
      `${field}.payload.entryManifestDigest`,
    ),
    surface: text(payloadInput?.surface, `${field}.payload.surface`, 128),
    entryId: text(payloadInput?.entryId, `${field}.payload.entryId`, 256),
    commitSha: exactCommit(
      payloadInput?.commitSha,
      `${field}.payload.commitSha`,
    ),
    repository: text(
      payloadInput?.repository,
      `${field}.payload.repository`,
      256,
    ),
    ref: text(payloadInput?.ref, `${field}.payload.ref`, 256),
    workflow: text(payloadInput?.workflow, `${field}.payload.workflow`, 256),
    workflowRunId: positive(
      payloadInput?.workflowRunId,
      `${field}.payload.workflowRunId`,
    ),
    workflowRunAttempt: positive(
      payloadInput?.workflowRunAttempt,
      `${field}.payload.workflowRunAttempt`,
    ),
    workflowJob: text(
      payloadInput?.workflowJob,
      `${field}.payload.workflowJob`,
      128,
    ),
    workflowJobDatabaseId: positive(
      payloadInput?.workflowJobDatabaseId,
      `${field}.payload.workflowJobDatabaseId`,
    ),
    runner: {
      registrationId: positive(
        payloadInput?.runner?.registrationId,
        `${field}.payload.runner.registrationId`,
      ),
      name: text(
        payloadInput?.runner?.name,
        `${field}.payload.runner.name`,
        256,
      ),
      labels: uniqueLabels(
        payloadInput?.runner?.labels,
        `${field}.payload.runner.labels`,
      ),
    },
    hardwareIdentityDigest: digest(
      payloadInput?.hardwareIdentityDigest,
      `${field}.payload.hardwareIdentityDigest`,
    ),
    operatorIdentityDigest: digest(
      payloadInput?.operatorIdentityDigest,
      `${field}.payload.operatorIdentityDigest`,
    ),
    attester: {
      identityDigest: digest(
        payloadInput?.attester?.identityDigest,
        `${field}.payload.attester.identityDigest`,
      ),
      measurementDigest: digest(
        payloadInput?.attester?.measurementDigest,
        `${field}.payload.attester.measurementDigest`,
      ),
      logAuthorityDigest: digest(
        payloadInput?.attester?.logAuthorityDigest,
        `${field}.payload.attester.logAuthorityDigest`,
      ),
    },
    challenge: String(payloadInput?.challenge || ""),
    nonce: String(payloadInput?.nonce || ""),
    collectorStartedAt: collectorStarted.value,
    collectorEndedAt: collectorEnded.value,
    collectorMonotonicElapsedMs: monotonicElapsedMs,
  };
  payload.rawLog = normalizeRawLog(payloadInput?.rawLog, {
    source,
    strategy,
    collectorStarted,
    collectorEnded,
    nowMs,
    field: `${field}.payload.rawLog`,
  });
  if (
    payload.sourceId !== source.sourceId ||
    payload.platform !== source.platform ||
    payload.keyId !== source.keyId ||
    payload.registryDigest !== registry.registryDigest ||
    payload.manifestDigest !== registry.manifestDigest ||
    payload.entryManifestDigest !== entryManifestDigest ||
    payload.surface !== surface ||
    payload.entryId !== entryId ||
    payload.commitSha !== expected.commitSha ||
    payload.repository !== expected.repository ||
    payload.ref !== GRAPH_PRODUCTION_SOURCE_REF ||
    payload.workflow !== GRAPH_PRODUCTION_SOURCE_WORKFLOW ||
    payload.workflowRunId !== expected.workflowRunId ||
    payload.workflowRunAttempt !== expected.workflowRunAttempt ||
    payload.workflowJob !== GRAPH_PRODUCTION_SOURCE_JOB ||
    canonicalGraphJson(payload.runner) !== canonicalGraphJson(source.runner) ||
    payload.hardwareIdentityDigest !== source.hardwareIdentityDigest ||
    payload.operatorIdentityDigest !== source.operatorIdentityDigest ||
    canonicalGraphJson(payload.attester) !==
      canonicalGraphJson(source.attester) ||
    !CHALLENGE.test(payload.challenge) ||
    payload.challenge !== expected.challenge ||
    !CHALLENGE.test(payload.nonce)
  ) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_BINDING_MISMATCH",
      `${field} does not bind the exact protected source/run/runner/challenge`,
    );
  }
  const job = jobsInventory?.get(payload.workflowJobDatabaseId);
  if (
    jobsInventory &&
    (!job ||
      job.status !== "completed" ||
      job.conclusion !== "success" ||
      job.name !== `Collect signed ${payload.platform} source receipts` ||
      job.runnerId !== payload.runner.registrationId ||
      job.runnerName !== payload.runner.name ||
      !includesEveryLabel(job.labels, [
        ...GRAPH_PRODUCTION_REQUIRED_RUNNER_LABELS,
        payload.platform,
      ]) ||
      collectorStarted.milliseconds < Date.parse(source.validFrom) ||
      collectorEnded.milliseconds > Date.parse(source.validUntil) ||
      job.startedAt.milliseconds < Date.parse(source.validFrom) ||
      job.startedAt.milliseconds >= Date.parse(source.validUntil) ||
      collectorStarted.milliseconds < job.startedAt.milliseconds ||
      collectorEnded.milliseconds > job.completedAt.milliseconds)
  ) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_JOB_BINDING_MISMATCH",
      `${field} is not contained by its successful Actions source job and runner identity`,
    );
  }
  if (!BASE64URL.test(String(input?.signature || ""))) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_SIGNATURE_INVALID",
      `${field}.signature must be base64url`,
    );
  }
  const signature = Buffer.from(input.signature, "base64url");
  if (
    signature.length !== 64 ||
    !verify(
      null,
      graphProductionSourceReceiptSigningBytes(payload),
      ed25519PublicKey(source.publicKeySpki, `${field}.publicKey`),
      signature,
    )
  ) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_SIGNATURE_INVALID",
      `${field} Ed25519 signature does not verify against the pinned registry key`,
    );
  }
  const normalized = {
    payload,
    signature: input.signature,
  };
  normalized.receiptDigest = digest(
    input?.receiptDigest,
    `${field}.receiptDigest`,
  );
  if (
    normalized.receiptDigest !== graphProductionSourceReceiptDigest(normalized)
  ) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_RECEIPT_DIGEST_MISMATCH",
      `${field}.receiptDigest does not bind the signed receipt`,
    );
  }
  return normalized;
}

function phaseEvidenceDigest(receipts, type, domain, extra = {}) {
  return graphDigest(
    {
      ...extra,
      sources: receipts.map((receipt) => ({
        sourceId: receipt.payload.sourceId,
        receiptDigest: receipt.receiptDigest,
        rawLogRoot: receipt.payload.rawLog.merkleRoot,
        eventDigest: receipt.payload.rawLog.events.find(
          (event) => event.type === type,
        ).eventDigest,
      })),
    },
    domain,
  );
}

function commonPhasePayload(receipts, type) {
  const payloads = receipts.map(
    (receipt) =>
      receipt.payload.rawLog.events.find((event) => event.type === type)
        .payload,
  );
  const canonical = canonicalGraphJson(payloads[0]);
  if (payloads.some((payload) => canonicalGraphJson(payload) !== canonical)) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_CROSS_CHECK_FAILED",
      `${type} differs across independently signed platform receipts`,
    );
  }
  return clone(payloads[0]);
}

function windowPayload(value) {
  const normalized = clone(value);
  delete normalized.monotonicDurationMs;
  return normalized;
}

function withItemDigests(items, receipts, type, key, domain) {
  return items.map((item) => ({
    ...item,
    evidenceDigest: phaseEvidenceDigest(receipts, type, domain, {
      key: item[key],
    }),
  }));
}

function deriveLegacyWriterEvidence(receipts, type, identity, strategy) {
  const payload = windowPayload(commonPhasePayload(receipts, type));
  payload.writerObservations = withItemDigests(
    payload.writerObservations || [],
    receipts,
    type,
    "writerFile",
    "cc.graph.production-derived-writer/v1",
  );
  payload.mutationProbes = withItemDigests(
    payload.mutationProbes || [],
    receipts,
    type,
    "mutationFunction",
    "cc.graph.production-derived-mutation/v1",
  );
  const unsigned = {
    schema:
      strategy === "retire"
        ? GRAPH_LEGACY_WRITER_OBSERVATION_SCHEMA
        : "chainlesschain.graph-entry-writer-observation/v1",
    surface: identity.surface,
    entryId: identity.entryId,
    rolloutKey: identity.rolloutKey,
    manifestDigest: identity.manifestDigest,
    commitSha: identity.commitSha,
    ...payload,
  };
  return {
    ...unsigned,
    evidenceDigest:
      strategy === "retire"
        ? graphLegacyWriterObservationDigest(unsigned)
        : graphDigest(unsigned, "cc.graph.entry-writer-observation/v1"),
  };
}

function deriveRetirementEvidence(receipts, identity) {
  const payload = windowPayload(
    commonPhasePayload(receipts, "retirement_observation"),
  );
  payload.replacementJourneys = withItemDigests(
    payload.replacementJourneys || [],
    receipts,
    "retirement_observation",
    "replacementEntryId",
    "cc.graph.production-derived-replacement/v1",
  );
  payload.mutationProbes = withItemDigests(
    payload.mutationProbes || [],
    receipts,
    "retirement_observation",
    "mutationFunction",
    "cc.graph.production-derived-retirement-mutation/v1",
  );
  payload.historicalReadProbes = withItemDigests(
    payload.historicalReadProbes || [],
    receipts,
    "retirement_observation",
    "historicalReadFunction",
    "cc.graph.production-derived-historical-read/v1",
  );
  const unsigned = {
    schema: GRAPH_RETIREMENT_EVIDENCE_SCHEMA,
    surface: identity.surface,
    entryId: identity.entryId,
    rolloutKey: identity.rolloutKey,
    manifestDigest: identity.manifestDigest,
    commitSha: identity.commitSha,
    ...payload,
  };
  return {
    ...unsigned,
    evidenceDigest: graphRetirementEvidenceDigest(unsigned),
  };
}

function deriveObservationSources(receipts, observationDigests) {
  return receipts.map((receipt) => ({
    platform: receipt.payload.platform,
    sourceKind: "physical_self_hosted_runner",
    sourceId: receipt.payload.sourceId,
    identityDigest: graphDigest(
      receipt.payload.runner,
      "cc.graph.production-runner-identity/v1",
    ),
    keyId: receipt.payload.keyId,
    registryDigest: receipt.payload.registryDigest,
    runnerRegistrationId: receipt.payload.runner.registrationId,
    runnerName: receipt.payload.runner.name,
    runnerLabels: [...receipt.payload.runner.labels],
    challenge: receipt.payload.challenge,
    nonce: receipt.payload.nonce,
    rawLogRoot: receipt.payload.rawLog.merkleRoot,
    receiptDigest: receipt.receiptDigest,
    authenticationDigest: graphDigest(
      {
        keyId: receipt.payload.keyId,
        receiptDigest: receipt.receiptDigest,
        signature: receipt.signature,
      },
      "cc.graph.production-source-authentication/v1",
    ),
    observationDigests: [...observationDigests].sort(),
  }));
}

function deriveDurableEntry(receipts, expected, commitSha) {
  const entry = expected.entry;
  const identity = {
    surface: expected.surface.originSurface,
    entryId: entry.id,
    rolloutKey: entry.rolloutKey,
    cutoverStrategy: entry.cutoverStrategy,
    manifestDigest: graphRuntimeEntryManifestDigest(
      expected.manifest,
      expected.surface.originSurface,
      entry.id,
    ),
    commitSha,
  };
  const shadow = windowPayload(
    commonPhasePayload(receipts, "shadow_observation"),
  );
  shadow.comparisons = withItemDigests(
    shadow.comparisons || [],
    receipts,
    "shadow_observation",
    "dimension",
    "cc.graph.production-derived-shadow-comparison/v1",
  );
  shadow.evidenceDigest = phaseEvidenceDigest(
    receipts,
    "shadow_observation",
    "cc.graph.production-derived-shadow/v1",
  );
  const canary = windowPayload(
    commonPhasePayload(receipts, "canary_observation"),
  );
  canary.platformJourneys = withItemDigests(
    canary.platformJourneys || [],
    receipts,
    "canary_observation",
    "platform",
    "cc.graph.production-derived-canary-platform/v1",
  );
  canary.evidenceDigest = phaseEvidenceDigest(
    receipts,
    "canary_observation",
    "cc.graph.production-derived-canary/v1",
  );
  const rollback = commonPhasePayload(receipts, "rollback_observation");
  delete rollback.observedAt;
  rollback.drills = withItemDigests(
    rollback.drills || [],
    receipts,
    "rollback_observation",
    "transition",
    "cc.graph.production-derived-rollback-drill/v1",
  );
  rollback.evidenceDigest = phaseEvidenceDigest(
    receipts,
    "rollback_observation",
    "cc.graph.production-derived-rollback/v1",
  );
  const finalLedger = commonPhasePayload(receipts, "final_ledger_observation");
  finalLedger.evidenceDigest = phaseEvidenceDigest(
    receipts,
    "final_ledger_observation",
    "cc.graph.production-derived-final-ledger/v1",
  );
  const legacyReadOnly = deriveLegacyWriterEvidence(
    receipts,
    "legacy_writer_observation",
    identity,
    entry.cutoverStrategy,
  );
  const unsigned = {
    ...identity,
    stageSequence: [
      "shadow",
      "internal_canary",
      "opt_in_canary",
      "canonical_default",
      "legacy_read_only",
    ],
    shadow,
    canary,
    rollback,
    finalLedger,
    legacyReadOnly,
  };
  if (entry.cutoverStrategy === "retire") {
    unsigned.retirementEvidence = deriveRetirementEvidence(receipts, identity);
  }
  const observationDigests = [
    shadow.evidenceDigest,
    canary.evidenceDigest,
    rollback.evidenceDigest,
    finalLedger.evidenceDigest,
    legacyReadOnly.evidenceDigest,
    ...(unsigned.retirementEvidence
      ? [unsigned.retirementEvidence.evidenceDigest]
      : []),
  ];
  unsigned.observationSources = deriveObservationSources(
    receipts,
    observationDigests,
  );
  return {
    ...unsigned,
    evidenceDigest: graphDigest(
      unsigned,
      "cc.graph.production-cutover-entry/v1",
    ),
  };
}

function deriveDisabledEntry(receipts, expected, commitSha) {
  const payload = commonPhasePayload(receipts, "disabled_probe");
  const observedAt = timestamp(
    payload?.observedAt,
    "disabledProbe.observedAt",
  ).value;
  delete payload.observedAt;
  const disablementProbeDigest = phaseEvidenceDigest(
    receipts,
    "disabled_probe",
    "cc.graph.production-derived-disabled-probe/v1",
    { observedAt },
  );
  const unsigned = {
    surface: expected.surface.originSurface,
    entryId: expected.entry.id,
    rolloutKey: expected.entry.rolloutKey,
    cutoverStrategy: "disabled",
    manifestDigest: graphRuntimeEntryManifestDigest(
      expected.manifest,
      expected.surface.originSurface,
      expected.entry.id,
    ),
    commitSha,
    ...payload,
    disablementProbeDigest,
    observationSources: deriveObservationSources(receipts, [
      disablementProbeDigest,
    ]),
  };
  return {
    ...unsigned,
    evidenceDigest: graphDigest(
      unsigned,
      "cc.graph.production-disabled-entry/v1",
    ),
  };
}

function manifestEntries(manifest) {
  return manifest.surfaces.flatMap((surface) =>
    surface.entries.map((entry) => ({ manifest, surface, entry })),
  );
}

export function normalizeGraphProductionSourceBundle(
  { registry: registryInput, fragments: fragmentInputs },
  {
    manifest,
    expectedCommitSha,
    expectedRepository,
    expectedRegistryDigest,
    expectedWorkflowRunId,
    expectedWorkflowRunAttempt,
    expectedChallenge,
    jobsInventory: jobsInventoryInput,
    clock = Date.now,
  },
) {
  const nowMs = Number(clock());
  if (!Number.isFinite(nowMs)) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_CLOCK_INVALID",
      "trusted clock returned an invalid time",
    );
  }
  const commitSha = exactCommit(expectedCommitSha, "expectedCommitSha");
  assertGraphProductionRuntimeSurfaceManifest(manifest);
  const manifestDigest = graphRuntimeSurfaceManifestDigest(manifest);
  const registry = normalizeGraphProductionSourceRegistry(registryInput, {
    expectedRepository,
    expectedManifestDigest: manifestDigest,
    expectedRegistryDigest,
  });
  const expected = {
    commitSha,
    repository: text(expectedRepository, "expectedRepository", 256),
    workflowRunId: positive(expectedWorkflowRunId, "expectedWorkflowRunId"),
    workflowRunAttempt: positive(
      expectedWorkflowRunAttempt,
      "expectedWorkflowRunAttempt",
    ),
    challenge: String(expectedChallenge || ""),
  };
  if (!CHALLENGE.test(expected.challenge)) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_SOURCE_BINDING_MISMATCH",
      "expected challenge must be an unpredictable 32-128 character token",
    );
  }
  const jobsInventory = normalizeJobsInventory(jobsInventoryInput, expected);
  if (!jobsInventory) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_JOB_INVENTORY_INVALID",
      "current-attempt Actions job inventory is required",
    );
  }
  const expectedEntries = manifestEntries(manifest);
  const expectedKeys = expectedEntries.map(
    ({ surface, entry }) => `${surface.originSurface}/${entry.id}`,
  );
  const fragments = Array.isArray(fragmentInputs) ? fragmentInputs : [];
  exactMembers(
    fragments.map((fragment) => `${fragment?.surface}/${fragment?.entryId}`),
    expectedKeys,
    "source fragments",
  );
  const fragmentMap = new Map(
    fragments.map((fragment) => [
      `${fragment.surface}/${fragment.entryId}`,
      fragment,
    ]),
  );
  const nonces = new Set();
  const sourceJobIds = new Map();
  const sourceBootIds = new Map();
  const normalizedFragments = [];
  const entries = [];
  const disabledEntries = [];
  for (const expectedEntry of expectedEntries) {
    const surface = expectedEntry.surface.originSurface;
    const entryId = expectedEntry.entry.id;
    const key = `${surface}/${entryId}`;
    const input = fragmentMap.get(key);
    const entryManifestDigest = graphRuntimeEntryManifestDigest(
      manifest,
      surface,
      entryId,
    );
    if (
      input?.schema !== GRAPH_PRODUCTION_SOURCE_FRAGMENT_SCHEMA ||
      input?.registryDigest !== registry.registryDigest ||
      input?.manifestDigest !== manifestDigest ||
      input?.entryManifestDigest !== entryManifestDigest
    ) {
      throw sourceError(
        "CC_GRAPH_PRODUCTION_SOURCE_FRAGMENT_INVALID",
        `${key} fragment does not bind the registry and frozen manifest`,
      );
    }
    const receiptsBySource = new Map(
      (Array.isArray(input?.receipts) ? input.receipts : []).map((receipt) => [
        receipt?.payload?.sourceId,
        receipt,
      ]),
    );
    exactMembers(
      [...receiptsBySource.keys()],
      registry.sources.map((source) => source.sourceId),
      `${key}.receipt sources`,
    );
    const receipts = registry.sources.map((source, index) => {
      const receipt = normalizeSourceReceipt(
        receiptsBySource.get(source.sourceId),
        {
          source,
          registry,
          expected,
          strategy: expectedEntry.entry.cutoverStrategy,
          surface,
          entryId,
          entryManifestDigest,
          nowMs,
          jobsInventory,
          field: `${key}.receipts[${index}]`,
        },
      );
      if (nonces.has(receipt.payload.nonce)) {
        throw sourceError(
          "CC_GRAPH_PRODUCTION_SOURCE_REPLAYED",
          `source receipt nonce was replayed: ${receipt.payload.nonce}`,
        );
      }
      nonces.add(receipt.payload.nonce);
      const priorJobId = sourceJobIds.get(source.sourceId);
      if (
        priorJobId !== undefined &&
        priorJobId !== receipt.payload.workflowJobDatabaseId
      ) {
        throw sourceError(
          "CC_GRAPH_PRODUCTION_JOB_BINDING_MISMATCH",
          `${source.sourceId} changed Actions job identity across the 23 entries`,
        );
      }
      sourceJobIds.set(source.sourceId, receipt.payload.workflowJobDatabaseId);
      const priorBootId = sourceBootIds.get(source.sourceId);
      if (
        priorBootId !== undefined &&
        priorBootId !== receipt.payload.rawLog.bootIdDigest
      ) {
        throw sourceError(
          "CC_GRAPH_PRODUCTION_SOURCE_CROSS_CHECK_FAILED",
          `${source.sourceId} changed physical boot identity across the 23 entries`,
        );
      }
      sourceBootIds.set(source.sourceId, receipt.payload.rawLog.bootIdDigest);
      return receipt;
    });
    if (
      new Set(receipts.map((receipt) => receipt.payload.rawLog.bootIdDigest))
        .size !== receipts.length ||
      new Set(receipts.map((receipt) => receipt.payload.rawLog.merkleRoot))
        .size !== receipts.length
    ) {
      throw sourceError(
        "CC_GRAPH_PRODUCTION_SOURCE_CROSS_CHECK_FAILED",
        `${key} must have independent host boot identities and raw log roots`,
      );
    }
    normalizedFragments.push({
      schema: GRAPH_PRODUCTION_SOURCE_FRAGMENT_SCHEMA,
      surface,
      entryId,
      registryDigest: registry.registryDigest,
      manifestDigest,
      entryManifestDigest,
      receipts,
    });
    const derived =
      expectedEntry.entry.cutoverStrategy === "disabled"
        ? deriveDisabledEntry(receipts, expectedEntry, commitSha)
        : deriveDurableEntry(receipts, expectedEntry, commitSha);
    if (expectedEntry.entry.cutoverStrategy === "disabled") {
      disabledEntries.push(derived);
    } else {
      entries.push(derived);
    }
  }
  const order = (left, right) =>
    `${left.surface}/${left.entryId}`.localeCompare(
      `${right.surface}/${right.entryId}`,
    );
  if (
    sourceJobIds.size !== registry.sources.length ||
    new Set(sourceJobIds.values()).size !== registry.sources.length ||
    sourceBootIds.size !== registry.sources.length ||
    new Set(sourceBootIds.values()).size !== registry.sources.length ||
    [...jobsInventory.keys()].some(
      (jobId) => !new Set(sourceJobIds.values()).has(jobId),
    )
  ) {
    throw sourceError(
      "CC_GRAPH_PRODUCTION_JOB_BINDING_MISMATCH",
      "all 23 entries must use the same three independent fixed source jobs",
    );
  }
  return Object.freeze({
    manifestDigest,
    registry,
    fragments: normalizedFragments.sort(order),
    entries: entries.sort(order),
    disabledEntries: disabledEntries.sort(order),
  });
}
