import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import skillInvocationReceipt from "@chainlesschain/session-core/skill-invocation-receipt";

const { verifySkillInvocationReceipt } = skillInvocationReceipt;

export const EVOLUTION_WORKBENCH_METRICS_SNAPSHOT_SCHEMA =
  "chainlesschain.evolution-workbench-metrics-snapshot/v1";
export const EVOLUTION_WORKBENCH_METRICS_MAX_RECEIPTS = 100_000;
export const EVOLUTION_WORKBENCH_METRICS_MAX_DELTA = 10_000;
export const EVOLUTION_WORKBENCH_METRICS_MAX_HOT_RECEIPTS = 10_000;
export const EVOLUTION_WORKBENCH_METRICS_HISTORY_SCHEMA =
  "chainlesschain.evolution-workbench-metrics-history/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const RETENTION_SNAPSHOT_KEYS = Object.freeze(
  [
    "evolutionRunId",
    "priorSnapshotDigest",
    "receiptDigests",
    "retainedReceiptCount",
    "retentionRootDigest",
    "revision",
    "schema",
    "skillName",
    "snapshotDigest",
    "sourceDigest",
    "tenantId",
    "throughAt",
    "versions",
  ].sort(),
);
const LEGACY_SNAPSHOT_KEYS = Object.freeze(
  RETENTION_SNAPSHOT_KEYS.filter(
    (key) => key !== "retainedReceiptCount" && key !== "retentionRootDigest",
  ),
);
const OUTCOME_SNAPSHOT_KEYS = Object.freeze(
  [...RETENTION_SNAPSHOT_KEYS, "outcomeHistoryComplete"].sort(),
);
const LEGACY_VERSION_KEYS = Object.freeze(
  [
    "blocked",
    "completed",
    "contentDigest",
    "costUsd",
    "failed",
    "latencyMs",
    "maxLatencyMs",
    "receiptCount",
    "tokensInput",
    "tokensOutput",
  ].sort(),
);
const OUTCOME_VERSION_KEYS = Object.freeze(
  [
    ...LEGACY_VERSION_KEYS,
    "outcomeCompleted",
    "outcomeReceiptCount",
    "userCorrectionCount",
  ].sort(),
);
const HISTORY_KEYS = Object.freeze(
  [
    "authenticated",
    "durable",
    "evolutionRunId",
    "historyDigest",
    "receipts",
    "schema",
    "skillName",
    "snapshotDigest",
    "sourceDigest",
    "tenantId",
    "throughAt",
  ].sort(),
);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(canonical(value))
    .digest("hex")}`;
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function string(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} is required`);
  }
  return value;
}

function digest(value, label) {
  if (!DIGEST.test(value ?? "")) throw new TypeError(`${label} is invalid`);
  return value;
}

function exactRecord(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length &&
    actual.every((key, index) => key === keys[index])
  );
}

function boundedString(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value
  );
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function nonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function createEmptyEvolutionWorkbenchMetricsSnapshot(
  tenantId,
  evolutionRunId,
  skillName,
) {
  const core = {
    schema: EVOLUTION_WORKBENCH_METRICS_SNAPSHOT_SCHEMA,
    tenantId,
    evolutionRunId,
    skillName,
    revision: 0,
    priorSnapshotDigest: null,
    sourceDigest: null,
    throughAt: null,
    retainedReceiptCount: 0,
    retentionRootDigest: null,
    outcomeHistoryComplete: true,
    receiptDigests: [],
    versions: [],
  };
  return freeze({
    ...core,
    snapshotDigest: hash(EVOLUTION_WORKBENCH_METRICS_SNAPSHOT_SCHEMA, core),
  });
}

export function digestEvolutionWorkbenchMetricsDelta({
  tenantId,
  evolutionRunId,
  priorSourceDigest,
  throughAt,
  receipts,
}) {
  return hash("chainlesschain.evolution-workbench-metrics-delta/v1", {
    tenantId,
    evolutionRunId,
    priorSourceDigest,
    throughAt,
    receiptDigests: receipts.map(({ receiptDigest }) => receiptDigest),
  });
}

export function digestEvolutionWorkbenchMetricsHistory({
  tenantId,
  evolutionRunId,
  skillName,
  snapshotDigest,
  sourceDigest,
  throughAt,
  receipts,
}) {
  return hash(EVOLUTION_WORKBENCH_METRICS_HISTORY_SCHEMA, {
    tenantId,
    evolutionRunId,
    skillName,
    snapshotDigest,
    sourceDigest,
    throughAt,
    receiptDigests: receipts.map(({ receiptDigest }) => receiptDigest),
  });
}

export function digestEvolutionWorkbenchMetricsRetentionBatch({
  tenantId,
  evolutionRunId,
  skillName,
  priorRetentionRootDigest,
  priorRetainedReceiptCount,
  throughAt,
  receiptDigests,
}) {
  return hash("chainlesschain.evolution-workbench-metrics-retention-batch/v1", {
    tenantId,
    evolutionRunId,
    skillName,
    priorRetentionRootDigest,
    priorRetainedReceiptCount,
    throughAt,
    receiptDigests: [...receiptDigests].sort(),
  });
}

export function digestEvolutionWorkbenchMetricsRetentionQuery({
  tenantId,
  evolutionRunId,
  skillName,
  retentionRootDigest,
  receiptDigests,
}) {
  return hash("chainlesschain.evolution-workbench-metrics-retention-query/v1", {
    tenantId,
    evolutionRunId,
    skillName,
    retentionRootDigest,
    receiptDigests,
  });
}

export function verifyEvolutionWorkbenchMetricsSnapshot(
  value,
  { tenantId, evolutionRunId, skillName },
) {
  const exactOutcome = exactRecord(value, OUTCOME_SNAPSHOT_KEYS);
  const exactRetention = exactRecord(value, RETENTION_SNAPSHOT_KEYS);
  const exactLegacy = exactRecord(value, LEGACY_SNAPSHOT_KEYS);
  if (
    (!exactOutcome && !exactRetention && !exactLegacy) ||
    value.schema !== EVOLUTION_WORKBENCH_METRICS_SNAPSHOT_SCHEMA ||
    !boundedString(value.tenantId) ||
    !boundedString(value.evolutionRunId) ||
    !boundedString(value.skillName) ||
    value.tenantId !== tenantId ||
    value.evolutionRunId !== evolutionRunId ||
    value.skillName !== skillName ||
    !safeCount(value.revision) ||
    (value.revision === 0
      ? value.priorSnapshotDigest !== null ||
        value.sourceDigest !== null ||
        value.throughAt !== null
      : !DIGEST.test(value.priorSnapshotDigest ?? "") ||
        !DIGEST.test(value.sourceDigest ?? "") ||
        typeof value.throughAt !== "string" ||
        !Number.isFinite(Date.parse(value.throughAt))) ||
    !DIGEST.test(value.snapshotDigest ?? "") ||
    !Array.isArray(value.receiptDigests) ||
    value.receiptDigests.length > EVOLUTION_WORKBENCH_METRICS_MAX_RECEIPTS ||
    new Set(value.receiptDigests).size !== value.receiptDigests.length ||
    value.receiptDigests.join("\n") !==
      [...value.receiptDigests].sort().join("\n") ||
    !Array.isArray(value.versions) ||
    value.versions.length > EVOLUTION_WORKBENCH_METRICS_MAX_RECEIPTS
  ) {
    throw new TypeError("Workbench metrics snapshot is invalid");
  }
  const retainedReceiptCount = value.retainedReceiptCount ?? 0;
  const retentionRootDigest = value.retentionRootDigest ?? null;
  if (
    !safeCount(retainedReceiptCount) ||
    (retainedReceiptCount === 0 && retentionRootDigest !== null) ||
    (retainedReceiptCount > 0 && !DIGEST.test(retentionRootDigest ?? ""))
  ) {
    throw new TypeError("Workbench metrics retention state is invalid");
  }
  if (
    value.revision === 0 &&
    (retainedReceiptCount !== 0 ||
      value.receiptDigests.length !== 0 ||
      value.versions.length !== 0)
  ) {
    throw new TypeError("Workbench metrics genesis snapshot is invalid");
  }
  if (
    exactOutcome &&
    (typeof value.outcomeHistoryComplete !== "boolean" ||
      (value.revision === 0 && value.outcomeHistoryComplete !== true))
  ) {
    throw new TypeError("Workbench metrics outcome coverage is invalid");
  }
  for (const receiptDigest of value.receiptDigests)
    digest(receiptDigest, "receipt digest");
  const versionDigests = new Set();
  let projectedReceiptCount = 0;
  let priorVersionDigest = null;
  let versionLayout = null;
  for (const version of value.versions) {
    const outcomeVersion = exactRecord(version, OUTCOME_VERSION_KEYS);
    const legacyVersion = exactRecord(version, LEGACY_VERSION_KEYS);
    if (
      (!outcomeVersion && !legacyVersion) ||
      versionDigests.has(version.contentDigest)
    ) {
      throw new TypeError("Workbench metrics version is invalid");
    }
    const layout = outcomeVersion ? "outcome" : "legacy";
    if (versionLayout !== null && versionLayout !== layout) {
      throw new TypeError("Workbench metrics version layouts are mixed");
    }
    versionLayout = layout;
    digest(version.contentDigest, "version content digest");
    if (
      priorVersionDigest !== null &&
      version.contentDigest.localeCompare(priorVersionDigest) <= 0
    ) {
      throw new TypeError("Workbench metrics versions are not canonical");
    }
    priorVersionDigest = version.contentDigest;
    versionDigests.add(version.contentDigest);
    for (const field of ["receiptCount", "completed", "failed", "blocked"]) {
      if (!safeCount(version[field])) {
        throw new TypeError(`Workbench metrics ${field} is invalid`);
      }
    }
    if (outcomeVersion) {
      for (const field of [
        "outcomeReceiptCount",
        "outcomeCompleted",
        "userCorrectionCount",
      ]) {
        if (!safeCount(version[field])) {
          throw new TypeError(`Workbench metrics ${field} is invalid`);
        }
      }
      if (
        version.outcomeReceiptCount > version.receiptCount ||
        version.outcomeCompleted > version.outcomeReceiptCount ||
        version.userCorrectionCount > version.outcomeReceiptCount
      ) {
        throw new Error("Workbench metrics outcome counts are inconsistent");
      }
    }
    for (const field of [
      "tokensInput",
      "tokensOutput",
      "costUsd",
      "latencyMs",
      "maxLatencyMs",
    ]) {
      if (!nonNegativeNumber(version[field])) {
        throw new TypeError(`Workbench metrics ${field} is invalid`);
      }
    }
    if (
      version.receiptCount < 1 ||
      version.completed + version.failed + version.blocked !==
        version.receiptCount
    ) {
      throw new Error("Workbench metrics outcomes do not sum to receiptCount");
    }
    projectedReceiptCount += version.receiptCount;
    if (!Number.isSafeInteger(projectedReceiptCount)) {
      throw new TypeError("Workbench metrics receipt total is invalid");
    }
  }
  if (
    projectedReceiptCount !==
    retainedReceiptCount + value.receiptDigests.length
  ) {
    throw new Error("Workbench metrics receipt retention total is invalid");
  }
  if (
    (exactOutcome && versionLayout === "legacy") ||
    (!exactOutcome && versionLayout === "outcome")
  ) {
    throw new TypeError("Workbench metrics outcome layout is invalid");
  }
  const core = structuredClone(value);
  delete core.snapshotDigest;
  if (
    hash(EVOLUTION_WORKBENCH_METRICS_SNAPSHOT_SCHEMA, core) !==
    value.snapshotDigest
  ) {
    throw new Error("Workbench metrics snapshot digest is invalid");
  }
  return freeze(structuredClone(value));
}

function nextSnapshot(previous, source, receipts, retention) {
  if (source.priorSourceDigest !== previous.sourceDigest) {
    throw new Error("Workbench metrics source lineage is discontinuous");
  }
  const seen = new Set(retention.hotReceiptDigests);
  const versions = new Map(
    previous.versions.map((entry) => [
      entry.contentDigest,
      {
        ...structuredClone(entry),
        outcomeReceiptCount: entry.outcomeReceiptCount ?? 0,
        outcomeCompleted: entry.outcomeCompleted ?? 0,
        userCorrectionCount: entry.userCorrectionCount ?? 0,
      },
    ]),
  );
  const previousReceiptCount = previous.versions.reduce(
    (total, version) => total + version.receiptCount,
    0,
  );
  const outcomeHistoryComplete =
    previous.outcomeHistoryComplete === true || previousReceiptCount === 0;
  for (const receipt of receipts) {
    if (seen.has(receipt.receiptDigest)) {
      throw new Error("Workbench metrics source replayed a receipt");
    }
    seen.add(receipt.receiptDigest);
    for (const contentDigest of receipt.selectedSkillDigests) {
      const current = versions.get(contentDigest) ?? {
        contentDigest,
        receiptCount: 0,
        completed: 0,
        failed: 0,
        blocked: 0,
        outcomeReceiptCount: 0,
        outcomeCompleted: 0,
        userCorrectionCount: 0,
        tokensInput: 0,
        tokensOutput: 0,
        costUsd: 0,
        latencyMs: 0,
        maxLatencyMs: 0,
      };
      current.receiptCount += 1;
      current[receipt.executionStatus] += 1;
      current.tokensInput += receipt.tokenCostLatency.tokensInput;
      current.tokensOutput += receipt.tokenCostLatency.tokensOutput;
      current.costUsd += receipt.tokenCostLatency.costUsd;
      current.latencyMs += receipt.tokenCostLatency.latencyMs;
      current.maxLatencyMs = Math.max(
        current.maxLatencyMs,
        receipt.tokenCostLatency.latencyMs,
      );
      const hasOutcomeEvidence =
        receipt.graderReceipts.length > 0 || receipt.userCorrectionRef !== null;
      if (
        hasOutcomeEvidence &&
        ["completed", "failed"].includes(receipt.executionStatus)
      ) {
        current.outcomeReceiptCount += 1;
        if (receipt.executionStatus === "completed") {
          current.outcomeCompleted += 1;
        }
        if (receipt.userCorrectionRef !== null) {
          current.userCorrectionCount += 1;
        }
      }
      versions.set(contentDigest, current);
    }
  }
  if (seen.size > EVOLUTION_WORKBENCH_METRICS_MAX_RECEIPTS) {
    throw new Error("Workbench metrics receipt retention limit was reached");
  }
  const core = {
    schema: EVOLUTION_WORKBENCH_METRICS_SNAPSHOT_SCHEMA,
    tenantId: previous.tenantId,
    evolutionRunId: previous.evolutionRunId,
    skillName: previous.skillName,
    revision: previous.revision + 1,
    priorSnapshotDigest: previous.snapshotDigest,
    sourceDigest: source.sourceDigest,
    throughAt: source.throughAt,
    retainedReceiptCount: retention.retainedReceiptCount,
    retentionRootDigest: retention.retentionRootDigest,
    outcomeHistoryComplete,
    receiptDigests: [...seen].sort(),
    versions: [...versions.values()].sort((left, right) =>
      left.contentDigest.localeCompare(right.contentDigest),
    ),
  };
  return freeze({
    ...core,
    snapshotDigest: hash(EVOLUTION_WORKBENCH_METRICS_SNAPSHOT_SCHEMA, core),
  });
}

function projectReceiptHistory(receipts) {
  const versions = new Map();
  for (const receipt of receipts) {
    for (const contentDigest of receipt.selectedSkillDigests) {
      const current = versions.get(contentDigest) ?? {
        contentDigest,
        receiptCount: 0,
        completed: 0,
        failed: 0,
        blocked: 0,
        outcomeReceiptCount: 0,
        outcomeCompleted: 0,
        userCorrectionCount: 0,
        tokensInput: 0,
        tokensOutput: 0,
        costUsd: 0,
        latencyMs: 0,
        maxLatencyMs: 0,
      };
      current.receiptCount += 1;
      current[receipt.executionStatus] += 1;
      current.tokensInput += receipt.tokenCostLatency.tokensInput;
      current.tokensOutput += receipt.tokenCostLatency.tokensOutput;
      current.costUsd += receipt.tokenCostLatency.costUsd;
      current.latencyMs += receipt.tokenCostLatency.latencyMs;
      current.maxLatencyMs = Math.max(
        current.maxLatencyMs,
        receipt.tokenCostLatency.latencyMs,
      );
      const hasOutcomeEvidence =
        receipt.graderReceipts.length > 0 || receipt.userCorrectionRef !== null;
      if (
        hasOutcomeEvidence &&
        ["completed", "failed"].includes(receipt.executionStatus)
      ) {
        current.outcomeReceiptCount += 1;
        if (receipt.executionStatus === "completed") {
          current.outcomeCompleted += 1;
        }
        if (receipt.userCorrectionRef !== null) {
          current.userCorrectionCount += 1;
        }
      }
      versions.set(contentDigest, current);
    }
  }
  return [...versions.values()].sort((left, right) =>
    left.contentDigest.localeCompare(right.contentDigest),
  );
}

function legacyProjection(versions) {
  return versions.map((version) => {
    const projected = {};
    for (const key of LEGACY_VERSION_KEYS) projected[key] = version[key];
    return projected;
  });
}

export class EvolutionWorkbenchMetricsOutcomeBackfiller {
  constructor({ tenantId, evolutionRunId, skillName, ports } = {}) {
    this.descriptor = freeze({
      tenantId: string(tenantId, "tenantId"),
      evolutionRunId: string(evolutionRunId, "evolutionRunId"),
      skillName: string(skillName, "skillName"),
    });
    if (!ports || typeof ports !== "object" || utilTypes.isProxy(ports)) {
      throw new TypeError("Workbench metrics backfill ports are required");
    }
    for (const name of [
      "loadSnapshot",
      "readReceiptHistory",
      "commitSnapshot",
      "queryRetainedReceiptDigests",
    ]) {
      if (typeof ports[name] !== "function" || utilTypes.isProxy(ports[name])) {
        throw new TypeError(
          `Workbench metrics backfill port ${name} is required`,
        );
      }
      this[`_${name}`] = ports[name].bind(ports);
    }
  }

  async backfill() {
    const loaded = await this._loadSnapshot(this.descriptor);
    if (
      loaded?.found !== true ||
      loaded.authenticated !== true ||
      loaded.durable !== true
    ) {
      throw new Error(
        "Workbench metrics backfill snapshot is not authoritative",
      );
    }
    const previous = verifyEvolutionWorkbenchMetricsSnapshot(
      loaded.snapshot,
      this.descriptor,
    );
    if (
      previous.outcomeHistoryComplete === true ||
      previous.versions.length === 0
    ) {
      return freeze({ status: "already-complete", snapshot: previous });
    }

    const expectedReceiptCount =
      (previous.retainedReceiptCount ?? 0) + previous.receiptDigests.length;
    const history = await this._readReceiptHistory({
      ...this.descriptor,
      snapshotDigest: previous.snapshotDigest,
      sourceDigest: previous.sourceDigest,
      throughAt: previous.throughAt,
      expectedReceiptCount,
    });
    if (
      !history ||
      typeof history !== "object" ||
      utilTypes.isProxy(history) ||
      !exactRecord(history, HISTORY_KEYS) ||
      history.schema !== EVOLUTION_WORKBENCH_METRICS_HISTORY_SCHEMA ||
      history.authenticated !== true ||
      history.durable !== true ||
      history.tenantId !== this.descriptor.tenantId ||
      history.evolutionRunId !== this.descriptor.evolutionRunId ||
      history.skillName !== this.descriptor.skillName ||
      history.snapshotDigest !== previous.snapshotDigest ||
      history.sourceDigest !== previous.sourceDigest ||
      history.throughAt !== previous.throughAt ||
      !Array.isArray(history.receipts) ||
      utilTypes.isProxy(history.receipts) ||
      history.receipts.length !== expectedReceiptCount ||
      history.receipts.length > EVOLUTION_WORKBENCH_METRICS_MAX_RECEIPTS
    ) {
      throw new Error("Workbench metrics receipt history is not authoritative");
    }
    const receipts = history.receipts.map((receipt) => {
      if (
        receipt &&
        typeof receipt === "object" &&
        utilTypes.isProxy(receipt)
      ) {
        throw new Error("Workbench metrics receipt history content is invalid");
      }
      const verified = verifySkillInvocationReceipt(receipt);
      if (
        verified.evolutionRunId !== this.descriptor.evolutionRunId ||
        verified.attributionEligible !== true ||
        Date.parse(verified.completedAt) > Date.parse(previous.throughAt)
      ) {
        throw new Error("Workbench metrics history lacks exact attribution");
      }
      return verified;
    });
    const receiptDigests = receipts.map(({ receiptDigest }) => receiptDigest);
    if (
      new Set(receiptDigests).size !== receiptDigests.length ||
      receiptDigests.join("\n") !== [...receiptDigests].sort().join("\n") ||
      history.historyDigest !==
        digestEvolutionWorkbenchMetricsHistory({ ...history, receipts })
    ) {
      throw new Error("Workbench metrics receipt history content is invalid");
    }
    const supplied = new Set(receiptDigests);
    if (previous.receiptDigests.some((digest) => !supplied.has(digest))) {
      throw new Error("Workbench metrics receipt history is incomplete");
    }
    const hot = new Set(previous.receiptDigests);
    const retainedDigests = receiptDigests.filter((digest) => !hot.has(digest));
    if (retainedDigests.length !== (previous.retainedReceiptCount ?? 0)) {
      throw new Error(
        "Workbench metrics retained receipt history is incomplete",
      );
    }
    if (retainedDigests.length > 0) {
      const query = {
        ...this.descriptor,
        retentionRootDigest: previous.retentionRootDigest,
        receiptDigests: retainedDigests,
      };
      const checked = await this._queryRetainedReceiptDigests(query);
      if (
        checked?.authenticated !== true ||
        checked.durable !== true ||
        checked.retentionRootDigest !== previous.retentionRootDigest ||
        checked.queryDigest !==
          digestEvolutionWorkbenchMetricsRetentionQuery(query) ||
        !Array.isArray(checked.matches) ||
        checked.matches.length !== retainedDigests.length ||
        checked.matches.some((match) => match !== true)
      ) {
        throw new Error(
          "Workbench metrics retained receipt history is not authoritative",
        );
      }
    }
    const versions = projectReceiptHistory(receipts);
    if (
      canonical(legacyProjection(versions)) !==
      canonical(legacyProjection(previous.versions))
    ) {
      throw new Error("Workbench metrics history does not reconcile");
    }
    const core = {
      schema: EVOLUTION_WORKBENCH_METRICS_SNAPSHOT_SCHEMA,
      tenantId: previous.tenantId,
      evolutionRunId: previous.evolutionRunId,
      skillName: previous.skillName,
      revision: previous.revision + 1,
      priorSnapshotDigest: previous.snapshotDigest,
      sourceDigest: previous.sourceDigest,
      throughAt: previous.throughAt,
      retainedReceiptCount: previous.retainedReceiptCount ?? 0,
      retentionRootDigest: previous.retentionRootDigest ?? null,
      outcomeHistoryComplete: true,
      receiptDigests: previous.receiptDigests,
      versions,
    };
    const snapshot = freeze({
      ...core,
      snapshotDigest: hash(EVOLUTION_WORKBENCH_METRICS_SNAPSHOT_SCHEMA, core),
    });
    const committed = await this._commitSnapshot({
      ...this.descriptor,
      expectedSnapshotDigest: previous.snapshotDigest,
      snapshot,
    });
    if (
      committed?.authenticated !== true ||
      committed.durable !== true ||
      committed.snapshotDigest !== snapshot.snapshotDigest
    ) {
      throw new Error("Workbench metrics backfill was not durably committed");
    }
    const readback = await this._loadSnapshot(this.descriptor);
    if (
      readback?.found !== true ||
      readback.authenticated !== true ||
      readback.durable !== true ||
      verifyEvolutionWorkbenchMetricsSnapshot(
        readback.snapshot,
        this.descriptor,
      ).snapshotDigest !== snapshot.snapshotDigest
    ) {
      throw new Error("Workbench metrics backfill readback differs");
    }
    return freeze({
      status: "reconciled",
      receiptCount: receipts.length,
      snapshot,
    });
  }
}

export class EvolutionWorkbenchMetricsAggregator {
  constructor({
    tenantId,
    evolutionRunId,
    skillName,
    hotReceiptLimit = EVOLUTION_WORKBENCH_METRICS_MAX_HOT_RECEIPTS,
    ports,
  } = {}) {
    this.descriptor = freeze({
      tenantId: string(tenantId, "tenantId"),
      evolutionRunId: string(evolutionRunId, "evolutionRunId"),
      skillName: string(skillName, "skillName"),
    });
    for (const name of ["loadSnapshot", "readReceiptDelta", "commitSnapshot"]) {
      if (typeof ports?.[name] !== "function") {
        throw new TypeError(`Workbench metrics port ${name} is required`);
      }
      this[`_${name}`] = ports[name].bind(ports);
    }
    if (
      !Number.isSafeInteger(hotReceiptLimit) ||
      hotReceiptLimit < 1 ||
      hotReceiptLimit > EVOLUTION_WORKBENCH_METRICS_MAX_HOT_RECEIPTS
    ) {
      throw new TypeError("Workbench metrics hot receipt limit is invalid");
    }
    this.hotReceiptLimit = hotReceiptLimit;
    this._retainReceiptDigests =
      typeof ports?.retainReceiptDigests === "function"
        ? ports.retainReceiptDigests.bind(ports)
        : null;
    this._queryRetainedReceiptDigests =
      typeof ports?.queryRetainedReceiptDigests === "function"
        ? ports.queryRetainedReceiptDigests.bind(ports)
        : null;
  }

  async aggregate() {
    const loaded = await this._loadSnapshot(this.descriptor);
    let previous;
    if (
      loaded?.found === false &&
      loaded.authenticated === true &&
      loaded.durable === true
    ) {
      previous = createEmptyEvolutionWorkbenchMetricsSnapshot(
        this.descriptor.tenantId,
        this.descriptor.evolutionRunId,
        this.descriptor.skillName,
      );
    } else if (
      loaded?.found === true &&
      loaded.authenticated === true &&
      loaded.durable === true
    ) {
      previous = verifyEvolutionWorkbenchMetricsSnapshot(
        loaded.snapshot,
        this.descriptor,
      );
    } else {
      throw new Error("Workbench metrics snapshot load is not authoritative");
    }
    const source = await this._readReceiptDelta({
      ...this.descriptor,
      fromSourceDigest: previous.sourceDigest,
    });
    if (
      source?.authenticated !== true ||
      source.durable !== true ||
      source.tenantId !== this.descriptor.tenantId ||
      source.evolutionRunId !== this.descriptor.evolutionRunId ||
      source.priorSourceDigest !== previous.sourceDigest ||
      !DIGEST.test(source.sourceDigest ?? "") ||
      typeof source.throughAt !== "string" ||
      !Number.isFinite(Date.parse(source.throughAt)) ||
      !Array.isArray(source.receipts) ||
      source.receipts.length > EVOLUTION_WORKBENCH_METRICS_MAX_DELTA
    ) {
      throw new Error("Workbench metrics receipt delta is not authoritative");
    }
    const receipts = source.receipts.map((receipt) => {
      const verified = verifySkillInvocationReceipt(receipt);
      if (
        verified.evolutionRunId !== this.descriptor.evolutionRunId ||
        verified.attributionEligible !== true
      ) {
        throw new Error("Workbench metrics receipt lacks exact attribution");
      }
      return verified;
    });
    if (
      source.sourceDigest !==
        digestEvolutionWorkbenchMetricsDelta({ ...source, receipts }) ||
      (previous.throughAt !== null &&
        Date.parse(source.throughAt) <= Date.parse(previous.throughAt)) ||
      receipts.some(
        (receipt) =>
          Date.parse(receipt.completedAt) > Date.parse(source.throughAt),
      )
    ) {
      throw new Error("Workbench metrics delta content or window is invalid");
    }
    const receiptDigests = receipts.map(({ receiptDigest }) => receiptDigest);
    const hotReceiptDigests = new Set(previous.receiptDigests);
    if (receiptDigests.some((value) => hotReceiptDigests.has(value))) {
      throw new Error("Workbench metrics source replayed a receipt");
    }
    const retainedReceiptCount = previous.retainedReceiptCount ?? 0;
    const retentionRootDigest = previous.retentionRootDigest ?? null;
    if (retainedReceiptCount > 0) {
      if (!this._queryRetainedReceiptDigests) {
        throw new Error("Workbench metrics retention query port is required");
      }
      const query = {
        ...this.descriptor,
        retentionRootDigest,
        receiptDigests,
      };
      const checked = await this._queryRetainedReceiptDigests(query);
      if (
        checked?.authenticated !== true ||
        checked.durable !== true ||
        checked.retentionRootDigest !== retentionRootDigest ||
        checked.queryDigest !==
          digestEvolutionWorkbenchMetricsRetentionQuery(query) ||
        !Array.isArray(checked.matches) ||
        checked.matches.length !== receiptDigests.length ||
        checked.matches.some((match) => typeof match !== "boolean")
      ) {
        throw new Error(
          "Workbench metrics retention query is not authoritative",
        );
      }
      if (checked.matches.some(Boolean)) {
        throw new Error("Workbench metrics source replayed a retained receipt");
      }
    }
    let retention = {
      retainedReceiptCount,
      retentionRootDigest,
      hotReceiptDigests: previous.receiptDigests,
    };
    if (
      previous.receiptDigests.length + receipts.length >
      this.hotReceiptLimit
    ) {
      if (!this._retainReceiptDigests) {
        throw new Error("Workbench metrics retention commit port is required");
      }
      const batch = {
        ...this.descriptor,
        priorRetentionRootDigest: retentionRootDigest,
        priorRetainedReceiptCount: retainedReceiptCount,
        throughAt: previous.throughAt,
        receiptDigests: previous.receiptDigests,
      };
      const retained = await this._retainReceiptDigests(batch);
      if (
        retained?.authenticated !== true ||
        retained.durable !== true ||
        retained.priorRetentionRootDigest !== retentionRootDigest ||
        retained.batchDigest !==
          digestEvolutionWorkbenchMetricsRetentionBatch(batch) ||
        !DIGEST.test(retained.retentionRootDigest ?? "") ||
        retained.retainedReceiptCount !==
          retainedReceiptCount + previous.receiptDigests.length
      ) {
        throw new Error("Workbench metrics receipt retention was not durable");
      }
      retention = {
        retainedReceiptCount: retained.retainedReceiptCount,
        retentionRootDigest: retained.retentionRootDigest,
        hotReceiptDigests: [],
      };
    }
    const snapshot = nextSnapshot(previous, source, receipts, retention);
    const committed = await this._commitSnapshot({
      ...this.descriptor,
      expectedSnapshotDigest: previous.snapshotDigest,
      snapshot,
    });
    if (
      committed?.authenticated !== true ||
      committed.durable !== true ||
      committed.snapshotDigest !== snapshot.snapshotDigest
    ) {
      throw new Error("Workbench metrics snapshot was not durably committed");
    }
    return snapshot;
  }
}
