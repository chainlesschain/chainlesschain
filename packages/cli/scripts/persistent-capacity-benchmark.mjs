#!/usr/bin/env node

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { release, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import {
  applyMemoryCommand,
  canonicalDigest,
  createMemoryCandidate,
} from "@chainlesschain/context-memory-kernel";
import {
  DEFAULT_MAX_EVENTS,
  DEFAULT_MAX_STORE_BYTES,
  DurableJsonMemoryPort,
  STORE_SCHEMA,
  stateDigest,
} from "../src/lib/context-memory-kernel/durable-memory-port.js";
import { listBackgroundAgents } from "../src/lib/background-agent-supervisor.js";

export const PERSISTENT_CAPACITY_SCHEMA =
  "chainlesschain.persistent-capacity-measurement/v1";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(SCRIPT_PATH);
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, "../../..");
const AT = "2026-09-13T00:00:00.000Z";
const CLOCK = () => Date.parse(AT);
const MAX_WORKER_OUTPUT_BYTES = 1024 * 1024;

function option(name, fallback = null, argv = process.argv) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
}

function positiveInteger(value, fallback, name) {
  if (value == null || value === "") return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function countList(value, fallback, name, maximum) {
  if (value == null || String(value).trim() === "") return [...fallback];
  const values = [
    ...new Set(
      String(value)
        .split(",")
        .map((entry) => positiveInteger(entry.trim(), null, name)),
    ),
  ].sort((left, right) => left - right);
  if (values.some((entry) => entry > maximum)) {
    throw new Error(`${name} entries must not exceed ${maximum}`);
  }
  return values;
}

export function resolvePersistentCapacityProfile(
  profileName = "smoke",
  env = process.env,
) {
  if (!new Set(["smoke", "formal"]).has(profileName)) {
    throw new Error("persistent capacity profile must be smoke or formal");
  }
  const formal = profileName === "formal";
  const requiredMemoryCounts = formal ? [1_000, 10_000, 100_000] : [100, 1_000];
  const requiredBackgroundCounts = formal ? [1_000, 10_000] : [100, 1_000];
  const memoryCounts = countList(
    env.CC_PERSISTENT_CAPACITY_MEMORY_COUNTS,
    requiredMemoryCounts,
    "CC_PERSISTENT_CAPACITY_MEMORY_COUNTS",
    100_000,
  );
  const backgroundCounts = countList(
    env.CC_PERSISTENT_CAPACITY_BACKGROUND_COUNTS,
    requiredBackgroundCounts,
    "CC_PERSISTENT_CAPACITY_BACKGROUND_COUNTS",
    100_000,
  );
  if (
    formal &&
    (!requiredMemoryCounts.every((count) => memoryCounts.includes(count)) ||
      !requiredBackgroundCounts.every((count) =>
        backgroundCounts.includes(count),
      ))
  ) {
    throw new Error(
      "formal profile must retain memory tiers 1k/10k/100k and background tiers 1k/10k",
    );
  }
  const samples = positiveInteger(
    env.CC_PERSISTENT_CAPACITY_SAMPLES,
    formal ? 11 : 3,
    "CC_PERSISTENT_CAPACITY_SAMPLES",
  );
  const concurrency = positiveInteger(
    env.CC_PERSISTENT_CAPACITY_CONCURRENCY,
    formal ? 8 : 2,
    "CC_PERSISTENT_CAPACITY_CONCURRENCY",
  );
  if (formal && (samples < 11 || concurrency < 8)) {
    throw new Error(
      "formal profile requires at least 11 samples and concurrency 8",
    );
  }
  if (samples > 100 || concurrency > 32) {
    throw new Error(
      "persistent capacity samples/concurrency exceed safety limits",
    );
  }
  return Object.freeze({
    name: profileName,
    memoryCounts: Object.freeze(memoryCounts),
    backgroundCounts: Object.freeze(backgroundCounts),
    samples,
    concurrency,
    maxStoreBytes: DEFAULT_MAX_STORE_BYTES,
    maxEvents: DEFAULT_MAX_EVENTS,
    performanceThresholds: null,
  });
}

function round(value) {
  return Number(Number(value).toFixed(3));
}

export function summarizeDurations(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return {
      samples: 0,
      minMs: null,
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
      maxMs: null,
    };
  }
  const ordered = values.map(Number).sort((left, right) => left - right);
  const percentile = (fraction) =>
    ordered[
      Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)
    ];
  return {
    samples: ordered.length,
    minMs: round(ordered[0]),
    p50Ms: round(percentile(0.5)),
    p95Ms: round(percentile(0.95)),
    p99Ms: round(percentile(0.99)),
    maxMs: round(ordered.at(-1)),
  };
}

function memoryId(index) {
  return `capacity-memory-${String(index).padStart(6, "0")}`;
}

function memoryRecord(index) {
  return createMemoryCandidate(
    {
      memoryId: memoryId(index),
      scope: "project",
      scopeId: "persistent-capacity",
      category: "benchmark",
      content: `persistent capacity record ${index}`,
      provenance: {
        source: "persistent-capacity-benchmark",
        actor: "benchmark",
        observedAt: AT,
      },
      evidenceRefs: [
        { store: "persistent-capacity-fixture", id: `source-${index}` },
      ],
      confidence: 0.5,
      importance: (index % 10) / 10,
      tags: [`bucket-${index % 32}`],
      sensitivity: "internal",
      allowedSinks: ["provider.local"],
      retentionPolicy: { mode: "durable" },
      activate: true,
      createdAt: AT,
    },
    { clock: CLOCK },
  );
}

function creationEvent(record, index) {
  const event = {
    schema: "chainlesschain.memory-event/v1",
    eventId: `capacity-event-${String(index).padStart(6, "0")}`,
    type: "memory.active",
    memoryId: record.memoryId,
    fromState: null,
    toState: record.state,
    previousRevision: 0,
    revision: record.revision,
    recordDigest: record.digest,
    at: AT,
  };
  event.digest = canonicalDigest(event, "chainlesschain.memory-event/v1");
  return event;
}

export function createDurableMemoryFixture(recordCount) {
  const count = positiveInteger(recordCount, null, "recordCount");
  if (count > DEFAULT_MAX_EVENTS) {
    throw new Error(
      `recordCount exceeds the ${DEFAULT_MAX_EVENTS} event ceiling`,
    );
  }
  const state = {
    schema: STORE_SCHEMA,
    schemaVersion: 1,
    storeRevision: count,
    records: {},
    events: [],
    reconciliations: {},
  };
  for (let index = 0; index < count; index += 1) {
    const record = memoryRecord(index);
    state.records[record.memoryId] = record;
    state.events.push(creationEvent(record, index));
  }
  state.digest = stateDigest(state);
  return state;
}

export function writeDurableMemoryFixture(filePath, recordCount) {
  const started = performance.now();
  const state = createDurableMemoryFixture(recordCount);
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const serialized = `${JSON.stringify(state)}\n`;
  writeFileSync(filePath, serialized, { encoding: "utf8", mode: 0o600 });
  return {
    recordCount,
    eventCount: state.events.length,
    bytes: Buffer.byteLength(serialized),
    setupMs: round(performance.now() - started),
    seededThroughProductionCommit: false,
  };
}

export function writeBackgroundAgentFixture(directory, recordCount) {
  const started = performance.now();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (let index = 0; index < recordCount; index += 1) {
    const id = `bg-capacity-${String(index).padStart(8, "0")}`;
    writeFileSync(
      join(directory, `${id}.json`),
      `${JSON.stringify({
        id,
        status: "completed",
        title: `capacity task ${index}`,
        startedAt: index + 1,
        endedAt: index + 2,
      })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  }
  return {
    recordCount,
    setupMs: round(performance.now() - started),
    seededThroughProductionWriter: false,
  };
}

async function timed(operation) {
  const started = performance.now();
  const value = await operation();
  return { value, durationMs: round(performance.now() - started) };
}

function workerArgument(name, argv = process.argv) {
  const value = option(name, null, argv);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`worker requires ${name}`);
  }
  return value;
}

export async function runPersistentCapacityWorker(argv = process.argv) {
  const kind = workerArgument("--worker", argv);
  const targetPath = workerArgument("--path", argv);
  const lockObservations = [];
  const port = new DurableJsonMemoryPort({
    filePath: targetPath,
    lockObserver: (observation) => lockObservations.push(observation),
  });
  const started = performance.now();
  try {
    let count = null;
    if (kind === "memory-query") {
      count = (await port.query()).length;
    } else if (kind === "memory-update") {
      const id = workerArgument("--id", argv);
      const record = await port.read(id);
      if (!record) throw new Error(`worker memory is missing: ${id}`);
      const transition = applyMemoryCommand(
        record,
        {
          type: "reinforce",
          expectedRevision: record.revision,
          confidenceDelta: 0.01,
          authority: "persistent-capacity-benchmark",
          at: AT,
        },
        { clock: CLOCK },
      );
      const committed = await port.commit(transition, record.revision);
      if (!committed.ok) throw new Error(`worker update raced: ${id}`);
      count = 1;
    } else if (kind === "memory-delete") {
      const id = workerArgument("--id", argv);
      const record = await port.read(id);
      if (!record) throw new Error(`worker memory is missing: ${id}`);
      const fence = `capacity-delete-${id}`;
      const deleted = applyMemoryCommand(
        record,
        {
          type: "delete",
          expectedRevision: record.revision,
          deletionFence: fence,
          authority: "persistent-capacity-benchmark",
          at: AT,
        },
        { clock: CLOCK },
      );
      const tombstoned = await port.commit(deleted, record.revision);
      if (!tombstoned.ok) throw new Error(`worker delete raced: ${id}`);
      const purged = applyMemoryCommand(
        deleted.record,
        {
          type: "purge",
          expectedRevision: deleted.record.revision,
          deletionFence: fence,
          authority: "persistent-capacity-benchmark",
          at: AT,
        },
        { clock: CLOCK },
      );
      const finalized = await port.commit(purged, deleted.record.revision);
      if (!finalized.ok) throw new Error(`worker purge raced: ${id}`);
      count = 1;
    } else if (kind === "background-list") {
      const previous = process.env.CC_BACKGROUND_AGENTS_DIR;
      process.env.CC_BACKGROUND_AGENTS_DIR = targetPath;
      try {
        count = listBackgroundAgents({ all: true, persist: false }).length;
      } finally {
        if (previous === undefined) delete process.env.CC_BACKGROUND_AGENTS_DIR;
        else process.env.CC_BACKGROUND_AGENTS_DIR = previous;
      }
    } else {
      throw new Error(`unknown persistent capacity worker kind: ${kind}`);
    }
    return {
      ok: true,
      kind,
      count,
      operationMs: round(performance.now() - started),
      lockObservations,
      peakRssBytes: process.memoryUsage().rss,
    };
  } catch (error) {
    return {
      ok: false,
      kind,
      code: error?.code || "PERSISTENT_CAPACITY_WORKER_FAILED",
      message: error?.message || String(error),
      operationMs: round(performance.now() - started),
      lockObservations,
      peakRssBytes: process.memoryUsage().rss,
    };
  }
}

function runWorker(kind, targetPath, id = null) {
  return new Promise((resolvePromise) => {
    const args = [SCRIPT_PATH, "--worker", kind, "--path", targetPath];
    if (id) args.push("--id", id);
    const started = performance.now();
    const child = spawn(process.execPath, args, {
      cwd: REPOSITORY_ROOT,
      env: { ...process.env },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let overflow = false;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolvePromise(result);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish({
        ok: false,
        kind,
        code: "PERSISTENT_CAPACITY_WORKER_TIMEOUT",
        message: "worker exceeded the 120 second timeout",
        wallMs: round(performance.now() - started),
        lockObservations: [],
      });
    }, 120_000);
    const capture = (field, chunk) => {
      const next = field + String(chunk);
      if (Buffer.byteLength(next, "utf8") > MAX_WORKER_OUTPUT_BYTES) {
        overflow = true;
        child.kill();
        return field;
      }
      return next;
    };
    child.stdout.on("data", (chunk) => {
      stdout = capture(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = capture(stderr, chunk);
    });
    child.on("error", (error) => {
      finish({
        ok: false,
        kind,
        code: error.code || "PERSISTENT_CAPACITY_WORKER_SPAWN_FAILED",
        message: error.message,
        wallMs: round(performance.now() - started),
        lockObservations: [],
      });
    });
    child.on("close", (code) => {
      if (overflow) {
        finish({
          ok: false,
          kind,
          code: "PERSISTENT_CAPACITY_WORKER_OUTPUT_LIMIT",
          message: "worker output exceeded its limit",
          wallMs: round(performance.now() - started),
          lockObservations: [],
        });
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        finish({
          ...parsed,
          processExitCode: code,
          wallMs: round(performance.now() - started),
          stderr: stderr.trim() || null,
        });
      } catch (error) {
        finish({
          ok: false,
          kind,
          code: "PERSISTENT_CAPACITY_WORKER_PROTOCOL_INVALID",
          message: error.message,
          processExitCode: code,
          wallMs: round(performance.now() - started),
          stderr: stderr.trim() || null,
          lockObservations: [],
        });
      }
    });
  });
}

function workerSeriesSummary(results) {
  const successes = results.filter((result) => result.ok);
  const lockWaits = successes.flatMap((result) =>
    (result.lockObservations || []).map((entry) => entry.waitMs),
  );
  return {
    requested: results.length,
    succeeded: successes.length,
    failed: results.length - successes.length,
    wall: summarizeDurations(results.map((result) => result.wallMs)),
    operation: summarizeDurations(
      successes.map((result) => result.operationMs),
    ),
    lockWait: summarizeDurations(lockWaits),
    failures: results
      .filter((result) => !result.ok)
      .map((result) => ({ code: result.code, message: result.message })),
    peakRssBytes:
      successes.length > 0
        ? Math.max(...successes.map((result) => result.peakRssBytes || 0))
        : null,
  };
}

export async function measureDurableMemoryTier(
  root,
  recordCount,
  { samples = 3, concurrency = 2 } = {},
) {
  const filePath = join(root, `memory-${recordCount}`, "kernel-v1.json");
  const fixture = writeDurableMemoryFixture(filePath, recordCount);
  const cold = await runWorker("memory-query", filePath);
  const lockObservations = [];
  const port = new DurableJsonMemoryPort({
    filePath,
    lockObserver: (observation) => lockObservations.push(observation),
  });
  const queryDurations = [];
  const readDurations = [];
  const listDurations = [];
  let observedCount = null;
  let reachable = true;
  let readFailure = null;
  try {
    for (let index = 0; index < samples; index += 1) {
      const query = await timed(() => port.query());
      observedCount = query.value.length;
      queryDurations.push(query.durationMs);
      const read = await timed(() => port.read(memoryId(index % recordCount)));
      if (!read.value) throw new Error("persistent memory fixture read missed");
      readDurations.push(read.durationMs);
      const listed = await timed(() =>
        port.listRecords({ includeTombstones: true }),
      );
      if (listed.value.length !== recordCount) {
        throw new Error(
          "persistent memory list count changed during read phase",
        );
      }
      listDurations.push(listed.durationMs);
    }
  } catch (error) {
    reachable = false;
    readFailure = {
      code: error?.code || "PERSISTENT_MEMORY_READ_FAILED",
      message: error?.message || String(error),
    };
  }

  const activeConcurrency = Math.min(concurrency, Math.floor(recordCount / 2));
  let concurrentReads = null;
  let concurrentUpdates = null;
  let concurrentDeletes = null;
  if (reachable && activeConcurrency > 0) {
    concurrentReads = workerSeriesSummary(
      await Promise.all(
        Array.from({ length: activeConcurrency }, () =>
          runWorker("memory-query", filePath),
        ),
      ),
    );
    concurrentUpdates = workerSeriesSummary(
      await Promise.all(
        Array.from({ length: activeConcurrency }, (_, index) =>
          runWorker("memory-update", filePath, memoryId(index)),
        ),
      ),
    );
    concurrentDeletes = workerSeriesSummary(
      await Promise.all(
        Array.from({ length: activeConcurrency }, (_, index) =>
          runWorker(
            "memory-delete",
            filePath,
            memoryId(activeConcurrency + index),
          ),
        ),
      ),
    );
  }

  return {
    recordCount,
    fixture,
    configuredLimits: {
      maxStoreBytes: DEFAULT_MAX_STORE_BYTES,
      maxEvents: DEFAULT_MAX_EVENTS,
    },
    reachedConfiguredEventCeiling: recordCount >= DEFAULT_MAX_EVENTS,
    reachable,
    readFailure,
    observedCount,
    coldProcess: cold,
    query: summarizeDurations(queryDurations),
    pointRead: summarizeDurations(readDurations),
    listAndSort: summarizeDurations(listDurations),
    lockWait: summarizeDurations(
      lockObservations.map((observation) => observation.waitMs),
    ),
    concurrentReads,
    concurrentUpdates,
    concurrentDeletes,
    finalBytes: statSync(filePath).size,
    peakRssBytes: process.memoryUsage().rss,
  };
}

export async function measureBackgroundAgentTier(
  root,
  recordCount,
  { samples = 3 } = {},
) {
  const directory = join(root, `background-${recordCount}`);
  const fixture = writeBackgroundAgentFixture(directory, recordCount);
  const cold = await runWorker("background-list", directory);
  const previous = process.env.CC_BACKGROUND_AGENTS_DIR;
  process.env.CC_BACKGROUND_AGENTS_DIR = directory;
  const durations = [];
  let observedCount = null;
  try {
    for (let index = 0; index < samples; index += 1) {
      const measurement = await timed(() =>
        listBackgroundAgents({ all: true, persist: false }),
      );
      observedCount = measurement.value.length;
      durations.push(measurement.durationMs);
    }
  } finally {
    if (previous === undefined) delete process.env.CC_BACKGROUND_AGENTS_DIR;
    else process.env.CC_BACKGROUND_AGENTS_DIR = previous;
  }
  return {
    recordCount,
    fixture,
    observedCount,
    coldProcess: cold,
    fullDirectoryListAndSort: summarizeDurations(durations),
    paginationApplied: false,
    indexApplied: false,
    peakRssBytes: process.memoryUsage().rss,
  };
}

function checkoutEvidence(profileName, argv = process.argv) {
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
  }).trim();
  const requestedSha = option(
    "--candidate-sha",
    process.env.GITHUB_SHA || "",
    argv,
  );
  if (requestedSha && requestedSha !== head) {
    throw new Error("candidate SHA must equal checkout HEAD");
  }
  const dirtyLines = execFileSync(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    { cwd: REPOSITORY_ROOT, encoding: "utf8" },
  )
    .split(/\r?\n/u)
    .filter(Boolean);
  if (profileName === "formal" && dirtyLines.length > 0) {
    throw new Error(
      "formal persistent capacity measurement requires a clean worktree",
    );
  }
  return {
    candidateSha: head,
    exactCheckout: !requestedSha || requestedSha === head,
    cleanWorktree: dirtyLines.length === 0,
    dirtyEntryCount: dirtyLines.length,
  };
}

export async function runPersistentCapacityBenchmark({
  profileName = "smoke",
  env = process.env,
  argv = process.argv,
  root = null,
} = {}) {
  const profile = resolvePersistentCapacityProfile(profileName, env);
  const checkout = checkoutEvidence(profileName, argv);
  const benchmarkRoot =
    root || mkdtempSync(join(tmpdir(), "cc-persistent-capacity-"));
  const ownsRoot = !root;
  const startedAt = new Date().toISOString();
  const started = performance.now();
  try {
    const memory = [];
    for (const count of profile.memoryCounts) {
      memory.push(
        await measureDurableMemoryTier(benchmarkRoot, count, profile),
      );
    }
    const backgroundAgents = [];
    for (const count of profile.backgroundCounts) {
      backgroundAgents.push(
        await measureBackgroundAgentTier(benchmarkRoot, count, profile),
      );
    }
    const receipt = {
      schema: PERSISTENT_CAPACITY_SCHEMA,
      schemaVersion: 1,
      status: "measured",
      startedAt,
      durationMs: round(performance.now() - started),
      host: {
        platform: process.platform,
        release: release(),
        architecture: process.arch,
        nodeVersion: process.version,
      },
      checkout,
      configuration: profile,
      measurements: { memory, backgroundAgents },
      qualification: {
        performanceGate: false,
        productionQualified: false,
        reason: "measurement-only-no-approved-slo",
      },
      limitations: [
        "fixtures are generated directly and setup time is reported separately",
        "first-process timing includes process startup but may benefit from the host filesystem cache",
        "background listing still performs full directory enumeration and sorting",
        "results apply only to the recorded host and exact checkout",
      ],
      finalPeakRssBytes: process.memoryUsage().rss,
    };
    receipt.digest = canonicalDigest(receipt, PERSISTENT_CAPACITY_SCHEMA);
    return receipt;
  } finally {
    if (ownsRoot && !argv.includes("--keep")) {
      rmSync(benchmarkRoot, { recursive: true, force: true });
    }
  }
}

async function main() {
  if (option("--worker")) {
    const result = await runPersistentCapacityWorker();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const profileName = option("--profile", "smoke");
  const receipt = await runPersistentCapacityBenchmark({ profileName });
  const output = `${JSON.stringify(receipt, null, 2)}\n`;
  const outputPath = option("--output");
  if (outputPath) {
    const target = resolve(process.cwd(), outputPath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, output, "utf8");
  } else {
    process.stdout.write(output);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
