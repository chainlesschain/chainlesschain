import { createHash } from "node:crypto";

import skillInvocationReceipt from "@chainlesschain/session-core/skill-invocation-receipt";

const { verifySkillInvocationReceipt } = skillInvocationReceipt;

export const EVOLUTION_WORKBENCH_METRICS_SNAPSHOT_SCHEMA =
  "chainlesschain.evolution-workbench-metrics-snapshot/v1";
export const EVOLUTION_WORKBENCH_METRICS_MAX_RECEIPTS = 100_000;
export const EVOLUTION_WORKBENCH_METRICS_MAX_DELTA = 10_000;

const DIGEST = /^sha256:[a-f0-9]{64}$/u;

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

export function verifyEvolutionWorkbenchMetricsSnapshot(
  value,
  { tenantId, evolutionRunId, skillName },
) {
  if (
    value?.schema !== EVOLUTION_WORKBENCH_METRICS_SNAPSHOT_SCHEMA ||
    value.tenantId !== tenantId ||
    value.evolutionRunId !== evolutionRunId ||
    value.skillName !== skillName ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !Array.isArray(value.receiptDigests) ||
    value.receiptDigests.length > EVOLUTION_WORKBENCH_METRICS_MAX_RECEIPTS ||
    new Set(value.receiptDigests).size !== value.receiptDigests.length ||
    !Array.isArray(value.versions) ||
    value.versions.length > EVOLUTION_WORKBENCH_METRICS_MAX_RECEIPTS
  ) {
    throw new TypeError("Workbench metrics snapshot is invalid");
  }
  for (const receiptDigest of value.receiptDigests)
    digest(receiptDigest, "receipt digest");
  for (const version of value.versions) {
    digest(version.contentDigest, "version content digest");
    for (const field of [
      "receiptCount",
      "completed",
      "failed",
      "blocked",
      "tokensInput",
      "tokensOutput",
      "costUsd",
      "latencyMs",
      "maxLatencyMs",
    ]) {
      if (!Number.isFinite(version[field]) || version[field] < 0) {
        throw new TypeError(`Workbench metrics ${field} is invalid`);
      }
    }
    if (
      version.completed + version.failed + version.blocked !==
      version.receiptCount
    ) {
      throw new Error("Workbench metrics outcomes do not sum to receiptCount");
    }
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

function nextSnapshot(previous, source, receipts) {
  if (source.priorSourceDigest !== previous.sourceDigest) {
    throw new Error("Workbench metrics source lineage is discontinuous");
  }
  const seen = new Set(previous.receiptDigests);
  const versions = new Map(
    previous.versions.map((entry) => [
      entry.contentDigest,
      structuredClone(entry),
    ]),
  );
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

export class EvolutionWorkbenchMetricsAggregator {
  constructor({ tenantId, evolutionRunId, skillName, ports } = {}) {
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
    const snapshot = nextSnapshot(previous, source, receipts);
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
