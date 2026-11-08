#!/usr/bin/env node
// Synthetic isolated stores only. Eight real processes share one authority.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  applyMemoryCommand,
  canonicalDigest,
} from "@chainlesschain/context-memory-kernel";
import { SegmentedMemoryPort } from "../src/lib/context-memory-kernel/segmented-memory-port.js";
import { compareMemoryRows } from "../src/lib/context-memory-kernel/memory-query-index.js";

const script = fileURLToPath(import.meta.url);
const at = "2026-10-29T00:00:00.000Z";
const digest = (value) =>
  canonicalDigest(value, "cc.memory-mixed-benchmark/v1");
const sha = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const queryOptions = { category: "benchmark", limit: 20 };
const projection = (records) =>
  records.map((record) => ({
    memoryId: record.memoryId,
    digest: record.digest,
  }));

async function worker({ filePath, role, id }) {
  const locks = [];
  const port = new SegmentedMemoryPort({
    filePath,
    lockObserver: (entry) => locks.push(entry),
  });
  const startedAt = Date.now(),
    started = performance.now();
  if (role === "reader") {
    const page = await port.listPage(queryOptions);
    return {
      role,
      startedAt,
      finishedAt: Date.now(),
      durationMs: performance.now() - started,
      locks,
      storeRevision: page.storeRevision,
      rows: projection(page.records),
    };
  }
  let record = await port.read(id);
  assert.ok(record);
  const mutations = [];
  for (const type of role === "writer" ? ["reinforce"] : ["delete", "purge"]) {
    const transition = applyMemoryCommand(record, {
      type,
      expectedRevision: record.revision,
      authority: "memory-mixed-benchmark",
      at,
      ...(type === "reinforce"
        ? { confidenceDelta: 0.01 }
        : { deletionFence: `mixed-${id}` }),
    });
    const committed = await port.commit(transition, record.revision);
    assert.equal(
      committed.ok,
      true,
      "disjoint synthetic writers must not lose a commit",
    );
    mutations.push({
      storeRevision: committed.storeRevision,
      record: transition.record,
      event: transition.event,
    });
    record = transition.record;
  }
  return {
    role,
    startedAt,
    finishedAt: Date.now(),
    durationMs: performance.now() - started,
    locks,
    mutations,
  };
}

function startWorker() {
  const lifecycle = { spawnedAt: Date.now(), phase: "spawned" };
  const child = fork(script, ["--worker"], {
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  lifecycle.pid = child.pid;
  let readyResolve, readyReject, resultResolve, resultReject, result;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const done = new Promise((resolve, reject) => {
    resultResolve = resolve;
    resultReject = reject;
  });
  // A worker can fail before the parent begins awaiting the entire barrier.
  ready.catch(() => {});
  done.catch(() => {});
  let failure,
    stderr = "";
  const fail = (error) => {
    failure ||= error;
    failure.worker = { ...lifecycle, pid: child.pid };
    readyReject(error);
    child.kill();
  };
  const timeout = setTimeout(
    () => fail(new Error("mixed Memory worker exceeded 120 seconds")),
    120_000,
  );
  child.stderr.on("data", (bytes) => {
    stderr += String(bytes);
    if (stderr.length > 16_384)
      fail(new Error("mixed Memory worker output exceeded limit"));
  });
  child.on("error", fail);
  child.on("message", (message) => {
    if (message?.type === "ready") {
      lifecycle.readyAt = Date.now();
      lifecycle.phase = "ready";
      readyResolve();
    } else if (message?.type === "result") {
      result = message.result;
      lifecycle.resultAt = Date.now();
      lifecycle.phase = "result";
    } else if (message?.type === "failure") fail(new Error(message.message));
  });
  child.on("close", (code) => {
    lifecycle.closedAt = Date.now();
    clearTimeout(timeout);
    if (failure || code !== 0 || !result) {
      const error =
        failure ||
        new Error(
          `mixed Memory worker failed (${code}): ${stderr.slice(0, 1000)}`,
        );
      error.worker ||= { ...lifecycle, pid: child.pid };
      readyReject(error);
      resultReject(error);
    } else
      resultResolve({
        ...result,
        lifecycle: { ...lifecycle, phase: "closed" },
      });
  });
  return {
    ready,
    done,
    start: (input) => {
      lifecycle.startedAt = Date.now();
      lifecycle.phase = "running";
      lifecycle.role = input.role;
      child.send(input);
    },
    stop: () => child.kill(),
  };
}

async function runRound(filePath, ids) {
  const children = Array.from({ length: 8 }, startWorker);
  try {
    await Promise.all(children.map((child) => child.ready));
    const started = performance.now();
    children.forEach((child, index) =>
      child.start({
        filePath,
        role: index < 4 ? "reader" : index < 6 ? "writer" : "deleter",
        id: ids[index - 4],
      }),
    );
    const results = await Promise.all(children.map((child) => child.done));
    const durationMs = performance.now() - started;
    assert.ok(
      Math.max(...results.map((result) => result.startedAt)) <
        Math.min(...results.map((result) => result.finishedAt)),
      "all eight process operations must actually overlap",
    );
    return {
      durationMs,
      operationsPerSecond: 8000 / durationMs,
      results,
      allEightOperationsOverlap: true,
    };
  } finally {
    children.forEach((child) => child.stop());
    await Promise.allSettled(children.map((child) => child.done));
  }
}

// onProgress is synchronous and observational; copy the report to retain a
// historical snapshot, and do not mutate the live measurement state.
export async function runMemoryMixedBenchmark({
  counts = [1000, 10000, 100000],
  rounds = 11,
  onProgress = () => {},
} = {}) {
  assert.ok(Number.isSafeInteger(rounds) && rounds > 0 && rounds <= 100);
  assert.ok(
    counts.length > 0 &&
      counts.every(
        (n) => Number.isSafeInteger(n) && n >= rounds * 4 && n <= 100000,
      ),
  );
  // Workers only need the authority port. Keep the fixture generator's broad
  // background/runtime module graph in the parent process.
  const { createDurableMemoryFixture, summarizeDurations } =
    await import("./persistent-capacity-benchmark.mjs");
  const parent = fs.realpathSync.native(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, "cc-memory-mixed-"));
  const sourcePaths = [
    "./memory-mixed-concurrency-benchmark.mjs",
    "./persistent-capacity-benchmark.mjs",
    "../src/lib/context-memory-kernel/segmented-memory-port.js",
    "../src/lib/context-memory-kernel/durable-memory-port.js",
    "../src/lib/context-memory-kernel/memory-query-control.js",
    "../src/lib/context-memory-kernel/memory-shard-snapshots.js",
    "../src/lib/context-memory-kernel/memory-query-bundle.js",
    "../src/lib/context-memory-kernel/memory-query-index.js",
    "../src/lib/with-file-lock.js",
    "../src/lib/secure-file-identity.js",
    "../../context-memory-kernel/lib/memory-reducer.js",
    "../../context-memory-kernel/lib/contracts.js",
    "../../context-memory-kernel/lib/canonical.js",
  ];
  const sources = () =>
    Object.fromEntries(
      sourcePaths.map((name) => [
        name,
        sha(fs.readFileSync(new URL(name, import.meta.url))),
      ]),
    );
  const report = {
    schema: "chainlesschain.memory-mixed-concurrency/v1",
    measuredAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: os.cpus()[0]?.model,
      osRelease: os.release(),
    },
    sourceDigests: sources(),
    providerCalls: 0,
    concurrency: 8,
    roundsPerTier: rounds,
    complete: false,
    scope:
      "Four readers, two updates, and two delete/purge operations released together from an IPC barrier; disjoint mutation IDs, one strict disk authority.",
    limitations: [
      "Local synthetic workload; not cross-platform admission, native IDE Stop, crash recovery, or sustained production throughput.",
      "Read requests each capture one generation; concurrent cursors are not reused across changing generations.",
      "Timing includes process IPC and shutdown after the ready barrier; fixture construction and final full audit are outside it.",
    ],
    tiers: [],
  };
  const checkpoint = () => {
    try {
      onProgress(report);
    } catch (error) {
      error.benchmarkStage = "checkpoint";
      throw error;
    }
  };
  const cleanup = () => {
    if (
      path.dirname(path.resolve(root)) !== parent ||
      !path.basename(root).startsWith("cc-memory-mixed-")
    )
      throw new Error("unsafe mixed benchmark cleanup target");
    fs.rmSync(root, { recursive: true, force: true });
  };
  let cleanupAttempted = false;
  let primaryFailure;
  try {
    report.stage = "checkpoint";
    checkpoint();
    for (const count of counts) {
      report.stage = "fixture";
      report.activeRound = { count, round: null };
      const filePath = path.join(root, `authority-${count}.json`);
      const port = new SegmentedMemoryPort({ filePath });
      const state = createDurableMemoryFixture(count);
      await port.importSnapshot(state);
      const originalDigest = state.digest;
      const ids = Object.values(state.records)
        .sort(compareMemoryRows)
        .slice(0, rounds * 4)
        .map((row) => row.memoryId);
      const values = [];
      const tier = {
        count,
        fixtureDigest: originalDigest,
        complete: false,
        finalAuditVerified: false,
        rounds: values,
      };
      report.tiers.push(tier);
      checkpoint();
      const expectedPage = () =>
        projection(
          Object.values(state.records)
            .filter((record) => !["deleted", "purged"].includes(record.state))
            .sort(compareMemoryRows)
            .slice(0, 20),
        );
      for (let index = 0; index < rounds; index++) {
        report.activeRound = { count, round: index + 1 };
        report.stage = "worker";
        checkpoint();
        const round = await runRound(
          filePath,
          ids.slice(index * 4, index * 4 + 4),
        );
        report.stage = "round-validation";
        const generations = new Map([[state.storeRevision, expectedPage()]]);
        const mutations = round.results
          .flatMap((entry) => entry.mutations || [])
          .sort((a, b) => a.storeRevision - b.storeRevision);
        assert.equal(mutations.length, 6);
        for (const mutation of mutations) {
          assert.equal(
            mutation.storeRevision,
            ++state.storeRevision,
            "audit generations must be gapless",
          );
          state.records[mutation.record.memoryId] = mutation.record;
          state.events.push(mutation.event);
          generations.set(state.storeRevision, expectedPage());
        }
        for (const result of round.results.filter(
          (entry) => entry.role === "reader",
        ))
          assert.deepEqual(
            result.rows,
            generations.get(result.storeRevision),
            "reader mixed generations or observed a deleted record",
          );
        round.generationsVerified = true;
        // Record digests and event IDs suffice in the public report; validation
        // above and the final full export compare the actual record/event bytes.
        for (const result of round.results)
          if (result.mutations)
            result.mutations = result.mutations.map((mutation) => ({
              storeRevision: mutation.storeRevision,
              memoryId: mutation.record.memoryId,
              recordDigest: mutation.record.digest,
              eventDigest: mutation.event.digest,
              state: mutation.record.state,
            }));
        values.push(round);
        checkpoint();
        if ((index + 1) % 10 === 0 || index + 1 === rounds)
          process.stderr.write(
            `Mixed Memory ${count}: ${index + 1}/${rounds} rounds\n`,
          );
      }
      report.stage = "final-audit";
      report.activeRound = { count, round: null };
      const snapshot = await port.exportSnapshot();
      assert.equal(snapshot.storeRevision, state.storeRevision);
      assert.deepEqual(snapshot.records, state.records);
      assert.deepEqual(
        snapshot.events,
        state.events,
        "audit event order/content diverged",
      );
      const page = await port.listPage(queryOptions);
      assert.deepEqual(projection(page.records), expectedPage());
      const active = Object.values(state.records)
        .filter((record) => !["deleted", "purged"].includes(record.state))
        .sort(compareMemoryRows);
      assert.deepEqual(
        projection(await port.listRecords()),
        projection(active),
      );
      assert.equal(active.length, count - rounds * 2);
      assert.equal(fs.existsSync(`${filePath}.lock`), false);
      Object.assign(tier, {
        count,
        fixtureDigest: originalDigest,
        finalRevision: snapshot.storeRevision,
        finalRecordsDigest: digest(snapshot.records),
        finalEventsDigest: digest(snapshot.events),
        finalAuditVerified: true,
        finalDeletionVisibilityVerified: true,
        finalActiveRecords: active.length,
        lockReleased: true,
        rounds: values,
        wall: summarizeDurations(values.map((entry) => entry.durationMs)),
        read: summarizeDurations(
          values.flatMap((entry) =>
            entry.results
              .filter((result) => result.role === "reader")
              .map((result) => result.durationMs),
          ),
        ),
        lockWait: summarizeDurations(
          values.flatMap((entry) =>
            entry.results.flatMap((result) =>
              result.locks.map((lock) => lock.waitMs),
            ),
          ),
        ),
        operationsPerSecond:
          (8000 * rounds) /
          values.reduce((sum, entry) => sum + entry.durationMs, 0),
        complete: true,
      });
      delete report.activeRound;
      checkpoint();
      process.stderr.write(
        `Mixed Memory ${count}: ${JSON.stringify({ rounds, readP95: tier.read.p95Ms, lockWaitP95: tier.lockWait.p95Ms, operationsPerSecond: tier.operationsPerSecond })}\n`,
      );
    }
    report.stage = "source-stability";
    assert.deepEqual(
      sources(),
      report.sourceDigests,
      "implementation changed during measurement",
    );
    report.stage = "cleanup";
    cleanupAttempted = true;
    cleanup();
    report.stage = "complete";
    report.complete = true;
    checkpoint();
    return report;
  } catch (error) {
    primaryFailure = error;
    report.complete = false;
    report.failure = {
      message: error.message,
      stage: error.benchmarkStage || report.stage,
      ...(error.code ? { code: error.code } : {}),
      ...(report.activeRound || {}),
      ...(error.worker ? { worker: error.worker } : {}),
    };
    try {
      onProgress(report);
    } catch (checkpointError) {
      primaryFailure = new AggregateError(
        [error, checkpointError],
        "Memory benchmark failed and its evidence checkpoint could not be saved",
        { cause: error },
      );
    }
    throw primaryFailure;
  } finally {
    if (!cleanupAttempted) {
      try {
        cleanup();
      } catch (cleanupError) {
        report.complete = false;
        report.cleanupFailure = { message: cleanupError.message };
        const failures = [primaryFailure, cleanupError].filter(Boolean);
        try {
          onProgress(report);
        } catch (checkpointError) {
          failures.push(checkpointError);
        }
        throw new AggregateError(failures, "Memory benchmark cleanup failed", {
          cause: primaryFailure || cleanupError,
        });
      }
    }
  }
}

if (process.argv.includes("--worker")) {
  process.once("message", async (input) => {
    try {
      process.send({ type: "result", result: await worker(input) });
    } catch (error) {
      process.send({ type: "failure", message: error.stack || String(error) });
      process.exitCode = 1;
    } finally {
      process.disconnect();
    }
  });
  process.send({ type: "ready" });
} else if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  const { values } = parseArgs({
    options: {
      counts: { type: "string", default: "1000,10000,100000" },
      rounds: { type: "string", default: "11" },
      output: { type: "string" },
    },
  });
  if (values.output) fs.writeFileSync(values.output, "{}\n", { flag: "wx" });
  const save = (report) => {
    if (!values.output) return;
    const temporary = `${values.output}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, {
      flag: "wx",
    });
    fs.renameSync(temporary, values.output);
  };
  const report = await runMemoryMixedBenchmark({
    counts: values.counts.split(",").map(Number),
    rounds: Number(values.rounds),
    onProgress: save,
  });
  if (!values.output)
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}
