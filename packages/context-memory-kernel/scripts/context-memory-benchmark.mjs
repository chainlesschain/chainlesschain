import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import {
  ContextMemoryKernel,
  InMemoryContentPort,
  InMemoryMemoryPort,
  InMemoryProjectionPurgePort,
  InMemorySessionContextPort,
  canonicalDigest,
  createMemoryCandidate,
  normalizeContextItem,
  planContext,
  rankMemoryRecords,
} from "../index.mjs";

const AT = "2026-08-30T00:00:00.000Z";
const CLOCK = () => Date.parse(AT);
const MIB = 1024 * 1024;
const PROFILES = Object.freeze({
  quick: {
    planSizes: [1_000],
    planSamples: 3,
    messageCounts: [100],
    toolResultMiB: [1],
    memoryCounts: [1_000],
    deletionCounts: [1, 100],
    casMessageCount: 100,
  },
  release: {
    planSizes: [1_000, 10_000],
    planSamples: 7,
    messageCounts: [100, 1_000],
    toolResultMiB: [1, 10, 100],
    memoryCounts: [1_000, 10_000, 100_000],
    deletionCounts: [1, 100, 10_000],
    casMessageCount: 1_000,
  },
});

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function candidateSha() {
  const explicit = option("--candidate-sha", process.env.GITHUB_SHA || "");
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const value = explicit || head;
  if (!/^[a-f0-9]{40}$/u.test(value)) {
    throw new Error("candidate SHA must be a full commit SHA");
  }
  if (value !== head) throw new Error("candidate SHA must equal checkout HEAD");
  if (
    execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      encoding: "utf8",
    }).trim()
  ) {
    throw new Error("capacity receipt requires a clean candidate worktree");
  }
  return value;
}

function platformName() {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

function round(value) {
  return Number(value.toFixed(3));
}

function percentile(values, fraction) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[
    Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)
  ];
}

async function timed(operation) {
  const started = performance.now();
  const value = await operation();
  return { value, durationMs: round(performance.now() - started) };
}

function peakRssBytes() {
  return Math.max(
    process.memoryUsage().rss,
    process.resourceUsage().maxRSS * 1024,
  );
}

function contextItem(id, overrides = {}) {
  return normalizeContextItem({
    schemaVersion: 1,
    itemId: id,
    kind: "message",
    scope: "session",
    scopeId: "benchmark-session",
    sourceRef: { store: "benchmark", id: `source-${id}` },
    provenance: {
      source: "benchmark",
      actor: "benchmark-user",
      observedAt: AT,
    },
    trust: "user",
    sensitivity: "internal",
    allowedSinks: ["provider.local"],
    tokenEstimate: 24,
    priority: 50,
    pinned: false,
    createdAt: AT,
    content: `benchmark context ${id}`,
    ...overrides,
  });
}

function protectedGoal(sessionId = "benchmark-session") {
  return contextItem(`goal-${sessionId}`, {
    scopeId: sessionId,
    kind: "task-state",
    tokenEstimate: 24,
    priority: 1_000,
    pinned: true,
    binding: { requiredForRecovery: true, taskState: "running" },
    content: "preserve the benchmark recovery goal",
  });
}

function planRequest(items, sessionId = "benchmark-session") {
  return {
    modelWindowTokens: 4_096,
    reservedOutputTokens: 512,
    safetyMarginTokens: 256,
    recoveryReserveTokens: 256,
    items,
    sink: "provider.local",
    scopeAdmissions: [{ scope: "session", scopeId: sessionId }],
    policyVersion: "benchmark-v1",
    modelProfile: "benchmark-model",
    sessionHead: `head:${sessionId}`,
    memoryRevision: 0,
    now: AT,
  };
}

async function benchmarkPlans(profile) {
  const results = [];
  for (const itemCount of profile.planSizes) {
    const items = Array.from({ length: itemCount }, (_, index) =>
      contextItem(`plan-${itemCount}-${index}`, {
        priority: index % 101,
        tokenEstimate: 8 + (index % 32),
      }),
    );
    const durations = [];
    let observedPeakRssBytes = peakRssBytes();
    for (let sample = 0; sample < profile.planSamples; sample += 1) {
      const measurement = await timed(() => planContext(planRequest(items)));
      if (measurement.value.selectedItemIds.length === 0) {
        throw new Error("plan benchmark selected no context");
      }
      durations.push(measurement.durationMs);
      observedPeakRssBytes = Math.max(observedPeakRssBytes, peakRssBytes());
    }
    results.push({
      itemCount,
      samples: durations.length,
      p50Ms: round(percentile(durations, 0.5)),
      p95Ms: round(percentile(durations, 0.95)),
      peakRssBytes: observedPeakRssBytes,
    });
  }
  return results;
}

async function compactItems(items, sessionId, operationId) {
  const sessions = new InMemorySessionContextPort([
    { sessionId, head: `head:${sessionId}`, items },
  ]);
  const kernel = new ContextMemoryKernel({
    sessionPort: sessions,
    clock: CLOCK,
  });
  const measurement = await timed(() =>
    kernel.compactContext({
      operationId,
      sessionId,
      modelWindowTokens: 2_048,
      reservedOutputTokens: 256,
      safetyMarginTokens: 128,
      recoveryReserveTokens: 128,
      sink: "provider.local",
      scopeAdmissions: [{ scope: "session", scopeId: sessionId }],
      policyVersion: "benchmark-v1",
      modelProfile: "benchmark-model",
      now: AT,
    }),
  );
  if (
    measurement.value.status !== "committed" ||
    !measurement.value.selectedItemIds.includes(`goal-${sessionId}`)
  ) {
    throw new Error("compaction benchmark violated its recovery invariant");
  }
  return {
    durationMs: measurement.durationMs,
    inputCount: items.length,
    outputCount: measurement.value.selectedItemIds.length,
    peakRssBytes: peakRssBytes(),
  };
}

function compactRequest(sessionId, operationId) {
  return {
    operationId,
    sessionId,
    modelWindowTokens: 2_048,
    reservedOutputTokens: 256,
    safetyMarginTokens: 128,
    recoveryReserveTokens: 128,
    sink: "provider.local",
    scopeAdmissions: [{ scope: "session", scopeId: sessionId }],
    policyVersion: "benchmark-v1",
    modelProfile: "benchmark-model",
    now: AT,
  };
}

async function benchmarkCompactionCas(profile) {
  const sessionId = "cas-benchmark";
  const items = [
    protectedGoal(sessionId),
    ...Array.from({ length: profile.casMessageCount }, (_, index) =>
      contextItem(`cas-message-${index}`, {
        scopeId: sessionId,
        tokenEstimate: 32,
        priority: index % 40,
      }),
    ),
  ];
  const sessions = new InMemorySessionContextPort([
    { sessionId, head: `head:${sessionId}`, items },
  ]);
  const first = new ContextMemoryKernel({
    sessionPort: sessions,
    clock: CLOCK,
  });
  const second = new ContextMemoryKernel({
    sessionPort: sessions,
    clock: CLOCK,
  });
  const race = await timed(() =>
    Promise.all([
      first.compactContext(compactRequest(sessionId, "cas-contender-a")),
      second.compactContext(compactRequest(sessionId, "cas-contender-b")),
    ]),
  );
  const statuses = race.value.map((receipt) => receipt.status).sort();
  if (statuses.join(",") !== "committed,stale") {
    throw new Error(
      `compaction CAS benchmark had unexpected outcomes: ${statuses}`,
    );
  }
  const recompute = await timed(() =>
    second.compactContext(compactRequest(sessionId, "cas-recompute")),
  );
  if (recompute.value.status !== "committed") {
    throw new Error("stale compaction did not commit after recomputation");
  }
  return {
    messageCount: profile.casMessageCount,
    contenderCount: 2,
    raceMs: race.durationMs,
    committedCount: statuses.filter((status) => status === "committed").length,
    staleCount: statuses.filter((status) => status === "stale").length,
    recomputeMs: recompute.durationMs,
    recomputeStatus: recompute.value.status,
    peakRssBytes: peakRssBytes(),
  };
}

async function benchmarkMessageCompaction(profile) {
  const results = [];
  for (const messageCount of profile.messageCounts) {
    const sessionId = `messages-${messageCount}`;
    const items = [
      protectedGoal(sessionId),
      ...Array.from({ length: messageCount }, (_, index) =>
        contextItem(`message-${messageCount}-${index}`, {
          scopeId: sessionId,
          tokenEstimate: 32,
          priority: index % 40,
        }),
      ),
    ];
    results.push({
      messageCount,
      ...(await compactItems(
        items,
        sessionId,
        `compact-messages-${messageCount}`,
      )),
    });
  }
  return results;
}

async function benchmarkToolResults(profile) {
  const results = [];
  for (const sizeMiB of profile.toolResultMiB) {
    const byteLength = sizeMiB * MIB;
    const content = Buffer.alloc(byteLength, 0x78);
    const contentPort = new InMemoryContentPort();
    const stored = await timed(() =>
      contentPort.put(content, {
        objectId: `tool-result-${sizeMiB}mib`,
        mimeType: "application/octet-stream",
        summary: `${sizeMiB} MiB benchmark tool result`,
      }),
    );
    const sessionId = `tool-${sizeMiB}mib`;
    const toolCallId = `tool-call-${sizeMiB}mib`;
    const items = [
      protectedGoal(sessionId),
      contextItem(`call-${sizeMiB}mib`, {
        scopeId: sessionId,
        kind: "tool-evidence",
        trust: "host",
        tokenEstimate: 32,
        binding: { toolCallId, toolRole: "call", toolOutcome: "succeeded" },
        content: `read ${sizeMiB} MiB fixture`,
      }),
      contextItem(`result-${sizeMiB}mib`, {
        scopeId: sessionId,
        kind: "tool-evidence",
        trust: "external",
        tokenEstimate: Math.min(16_777_216, Math.ceil(byteLength / 4)),
        binding: { toolCallId, toolRole: "result", toolOutcome: "succeeded" },
        content: undefined,
        contentRef: stored.value,
      }),
    ];
    const compacted = await compactItems(
      items,
      sessionId,
      `compact-tool-${sizeMiB}mib`,
    );
    results.push({
      sizeMiB,
      byteLength,
      contentStoreMs: stored.durationMs,
      ...compacted,
    });
  }
  return results;
}

function memoryRecord(index) {
  const targetScope = index % 4 === 0;
  const hasNeedle = index % 97 === 0;
  return createMemoryCandidate(
    {
      memoryId: `benchmark-memory-${index}`,
      scope: targetScope ? "project" : "user",
      scopeId: targetScope
        ? "benchmark-project"
        : `benchmark-user-${index % 8}`,
      category: `category-${index % 16}`,
      content: `${hasNeedle ? "needle " : ""}benchmark memory ${index}`,
      provenance: {
        source: "benchmark",
        actor: "benchmark-user",
        observedAt: AT,
      },
      evidenceRefs: [{ store: "benchmark", id: `memory-source-${index}` }],
      confidence: 0.5 + (index % 5) / 10,
      importance: 0.5 + (index % 4) / 10,
      tags: [hasNeedle ? "needle" : `topic-${index % 32}`],
      sensitivity: "internal",
      allowedSinks: ["provider.local"],
      retentionPolicy: { mode: "durable" },
      activate: true,
      createdAt: AT,
    },
    { clock: CLOCK },
  );
}

function buildVectorIndex(recordCount, dimensions = 8) {
  const vectors = new Float32Array(recordCount * dimensions);
  for (let index = 0; index < recordCount; index += 1) {
    for (let dimension = 0; dimension < dimensions; dimension += 1) {
      vectors[index * dimensions + dimension] =
        (((index + 1) * (dimension + 17)) % 101) / 100;
    }
  }
  return { dimensions, vectors };
}

function vectorRecallProjection(records, index, limit = 10) {
  const query = Float32Array.from(
    { length: index.dimensions },
    (_, dimension) => (dimension + 1) / index.dimensions,
  );
  const candidates = [];
  for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
    const record = records[recordIndex];
    if (
      record.scope !== "project" ||
      record.scopeId !== "benchmark-project" ||
      !record.allowedSinks.includes("provider.local")
    ) {
      continue;
    }
    let score = 0;
    for (let dimension = 0; dimension < index.dimensions; dimension += 1) {
      score +=
        query[dimension] *
        index.vectors[recordIndex * index.dimensions + dimension];
    }
    candidates.push({ memoryId: record.memoryId, score });
  }
  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.memoryId.localeCompare(right.memoryId, "en"),
  );
  return candidates.slice(0, limit);
}

async function benchmarkMemoryRecall(profile) {
  const results = [];
  for (const recordCount of profile.memoryCounts) {
    const built = await timed(() =>
      Array.from({ length: recordCount }, (_, index) => memoryRecord(index)),
    );
    const records = built.value;
    const scoped = await timed(() =>
      records.filter(
        (record) =>
          record.scope === "project" && record.scopeId === "benchmark-project",
      ),
    );
    const lexical = await timed(() =>
      rankMemoryRecords(records, {
        query: "needle",
        sink: "provider.local",
        scopeAdmissions: [{ scope: "project", scopeId: "benchmark-project" }],
        limit: 20,
        tokenBudget: 8_192,
        now: AT,
      }),
    );
    const vectorIndex = await timed(() => buildVectorIndex(recordCount));
    const vector = await timed(() =>
      vectorRecallProjection(records, vectorIndex.value, 20),
    );
    if (lexical.value.results.length === 0 || vector.value.length !== 20) {
      throw new Error("memory recall benchmark produced incomplete results");
    }
    results.push({
      recordCount,
      datasetBuildMs: built.durationMs,
      scopeFilterMs: scoped.durationMs,
      admittedScopeCount: scoped.value.length,
      lexicalRecallMs: lexical.durationMs,
      lexicalResultCount: lexical.value.results.length,
      vectorIndexBuildMs: vectorIndex.durationMs,
      vectorRecallMs: vector.durationMs,
      vectorResultCount: vector.value.length,
      peakRssBytes: peakRssBytes(),
    });
  }
  return results;
}

async function benchmarkDeletion(profile) {
  const results = [];
  for (const recordCount of profile.deletionCounts) {
    const records = Array.from({ length: recordCount }, (_, index) =>
      memoryRecord(index + 1_000_000),
    );
    const memoryPort = new InMemoryMemoryPort(records);
    const purgePorts = [
      new InMemoryProjectionPurgePort("benchmark-search-index"),
      new InMemoryProjectionPurgePort("benchmark-cache"),
      new InMemoryProjectionPurgePort("benchmark-replica"),
    ];
    const kernel = new ContextMemoryKernel({
      memoryPort,
      reconciliationPort: memoryPort,
      purgePorts,
      clock: CLOCK,
    });
    const converged = await timed(async () => {
      for (let offset = 0; offset < records.length; offset += 100) {
        await Promise.all(
          records.slice(offset, offset + 100).map((record) =>
            kernel.deleteMemory({
              requestId: `benchmark-delete-${record.memoryId}`,
              subject: "benchmark-user",
              scope: record.scope,
              ...(record.scopeId ? { scopeId: record.scopeId } : {}),
              selector: `memory:${record.memoryId}`,
              memoryId: record.memoryId,
              expectedRevision: record.revision,
              fence: `fence-${record.memoryId}`,
              authority: "benchmark-delete",
            }),
          ),
        );
      }
    });
    const authority = await memoryPort.query();
    if (
      authority.some(
        (record) => record.state !== "purged" || record.content !== "",
      ) ||
      purgePorts.some((port) => port.purged.size !== recordCount)
    ) {
      throw new Error(
        "deletion benchmark did not converge across every projection",
      );
    }
    results.push({
      recordCount,
      convergenceMs: converged.durationMs,
      stores: [memoryPort.name, ...purgePorts.map((port) => port.name)],
      authorityPurgedCount: authority.length,
      projectionPurgedCounts: Object.fromEntries(
        purgePorts.map((port) => [port.name, port.purged.size]),
      ),
      peakRssBytes: peakRssBytes(),
    });
  }
  return results;
}

const profileName = option("--profile", "quick");
const profile = PROFILES[profileName];
if (!profile) throw new Error(`unknown benchmark profile ${profileName}`);
const exactCandidateSha = candidateSha();
const startedAt = new Date().toISOString();
const started = performance.now();
const receipt = {
  schema: "chainlesschain.context-memory-capacity-benchmark/v1",
  schemaVersion: 1,
  candidateSha: exactCandidateSha,
  platform: platformName(),
  architecture: process.arch,
  nodeVersion: process.version,
  profile: profileName,
  status: "passed",
  startedAt,
  configuration: profile,
  measurements: {
    contextPlan: await benchmarkPlans(profile),
    messageCompaction: await benchmarkMessageCompaction(profile),
    toolResultCompaction: await benchmarkToolResults(profile),
    compactionCas: await benchmarkCompactionCas(profile),
    memoryRecall: await benchmarkMemoryRecall(profile),
    deletionConvergence: await benchmarkDeletion(profile),
  },
  durationMs: round(performance.now() - started),
  finalPeakRssBytes: peakRssBytes(),
};
receipt.digest = canonicalDigest(receipt, receipt.schema);
const output = `${JSON.stringify(receipt, null, 2)}\n`;
const outputPath = option("--output");
if (outputPath) writeFileSync(outputPath, output, "utf8");
else process.stdout.write(output);
