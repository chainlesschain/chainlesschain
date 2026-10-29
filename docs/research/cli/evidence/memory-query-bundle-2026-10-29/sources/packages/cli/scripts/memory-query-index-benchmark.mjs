#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs, {
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import {
  canonicalDigest,
  normalizeMemoryRecord,
} from "@chainlesschain/context-memory-kernel";
import {
  createDurableMemoryFixture,
  summarizeDurations,
} from "./persistent-capacity-benchmark.mjs";
import { SegmentedMemoryPort } from "../src/lib/context-memory-kernel/segmented-memory-port.js";
import {
  CliCanonicalMemoryService,
  publicEntry,
} from "../src/lib/context-memory-kernel/memory-service.js";
import { compareMemoryRows } from "../src/lib/context-memory-kernel/memory-query-index.js";
import { stateDigest } from "../src/lib/context-memory-kernel/durable-memory-port.js";

const script = fileURLToPath(import.meta.url);
const category = "category-7";
const limit = 20;
const digest = (rows) =>
  canonicalDigest(rows, "cc.memory-query-benchmark-rows/v1");
const option = (name, fallback) => {
  const offset = process.argv.indexOf(name);
  return offset < 0 ? fallback : process.argv[offset + 1];
};
const sourceDigests = () =>
  Object.fromEntries(
    [
      ...[
        "segmented-memory-port.js",
        "durable-memory-port.js",
        "memory-query-index.js",
        "memory-service.js",
        "memory-query-control.js",
        "memory-shard-snapshots.js",
        "memory-query-bundle.js",
      ].map((name) => [`../src/lib/context-memory-kernel/${name}`, name]),
      ["../src/lib/with-file-lock.js", "with-file-lock.js"],
      ["../../context-memory-kernel/lib/canonical.js", "kernel/canonical.js"],
      ["../../context-memory-kernel/lib/contracts.js", "kernel/contracts.js"],
      ["./persistent-capacity-benchmark.mjs", "fixture-generator.mjs"],
      ["./memory-query-index-benchmark.mjs", "benchmark.mjs"],
    ].map(([file, name]) => [
      name,
      createHash("sha256")
        .update(readFileSync(new URL(file, import.meta.url)))
        .digest("hex"),
    ]),
  );

async function measure(port, mode) {
  let authorityReads = 0;
  let authorityBytes = 0;
  const original = port._readShardBytes;
  const open = fs.openSync;
  const bundle = port._queryBundlePlan(
    JSON.parse(readFileSync(port.filePath, "utf8")),
  );
  let indexReadOpens = 0;
  let bundleReadOpens = 0;
  let directoryChecks = 0;
  const checkDirectories = port._checkDirectories;
  port._checkDirectories = function (...args) {
    directoryChecks++;
    return checkDirectories.apply(this, args);
  };
  fs.openSync = function (file, flags, ...args) {
    const fd = open(file, flags, ...args);
    const reading =
      typeof flags === "number"
        ? (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) === 0
        : flags === "r" || flags === "rs";
    if (
      reading &&
      typeof file === "string" &&
      /^query-[a-f0-9]{2}-[a-f0-9]{64}\.json$/u.test(
        file.split(/[\\/]/u).at(-1),
      )
    ) {
      indexReadOpens++;
      if (bundle && file === bundle.file) bundleReadOpens++;
    }
    return fd;
  };
  syncBuiltinESMExports();
  port._readShardBytes = function (...args) {
    const bytes = original.apply(this, args);
    authorityReads++;
    authorityBytes += bytes.length;
    return bytes;
  };
  const eventLoop = monitorEventLoopDelay({ resolution: 1 });
  eventLoop.enable();
  await new Promise(setImmediate);
  const started = performance.now();
  let entries;
  let durationMs;
  try {
    if (mode === "baseline") {
      // The original business list path: authority query, full sort, category
      // filter, then limit. Compare exactly the same public entry projection.
      entries = (await port.query())
        .filter((row) => !["deleted", "purged"].includes(row.state))
        .sort(compareMemoryRows)
        .filter((row) => row.category === category)
        .slice(0, limit)
        .map((row) => publicEntry(row));
    } else {
      entries = await new CliCanonicalMemoryService({
        runtime: { memoryPort: port },
      }).list({ category, limit });
    }
    durationMs = performance.now() - started;
    await new Promise(setImmediate);
  } finally {
    port._readShardBytes = original;
    port._checkDirectories = checkDirectories;
    fs.openSync = open;
    syncBuiltinESMExports();
    eventLoop.disable();
  }
  return {
    durationMs,
    count: entries.length,
    rowsDigest: digest(entries),
    authorityReads,
    authorityBytes,
    indexReadOpens,
    bundleReadOpens,
    directoryChecks,
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
    rssBytes: process.memoryUsage().rss,
    heapUsedBytes: process.memoryUsage().heapUsed,
    eventLoopDelayMaxMs: eventLoop.max / 1e6,
  };
}

if (process.argv.includes("--help")) {
  process.stdout.write(
    "Usage: node memory-query-index-benchmark.mjs [--counts 1000,10000,100000] [--samples 11] [--modes baseline,cold,hot,rebuild,corrupt] [--cache-mode validate-disk|verified-memory] [--index-layout bundle|individual] [--output file.json]\nLocal fixture measurement; no paid model requests. Use --samples 100 for the gap-review sampling requirement.\n",
  );
} else if (option("--worker", null)) {
  const result = await measure(
    new SegmentedMemoryPort({
      filePath: option("--file", null),
      queryIndexCacheMode: option("--cache-mode", "validate-disk"),
      queryIndexLayout: option("--index-layout", "bundle"),
    }),
    option("--worker", null),
  );
  process.stdout.write(JSON.stringify(result));
} else {
  const samples = Number(option("--samples", "11"));
  assert.ok(Number.isSafeInteger(samples) && samples > 0 && samples <= 200);
  const modes = option("--modes", "baseline,cold,hot,rebuild,corrupt").split(
    ",",
  );
  assert.ok(
    modes.length > 0 &&
      new Set(modes).size === modes.length &&
      modes.every((mode) =>
        ["baseline", "cold", "hot", "rebuild", "corrupt"].includes(mode),
      ),
  );
  const output = option("--output", null);
  // Claim a fresh report before running a long measurement. Never overwrite a
  // previous baseline or silently discard completed groups after interruption.
  if (output) writeFileSync(output, "{}\n", { flag: "wx" });
  const counts = option("--counts", "1000,10000,100000").split(",").map(Number);
  assert.ok(
    counts.every(
      (count) => Number.isSafeInteger(count) && count > 0 && count <= 100000,
    ),
  );
  // Windows may expose TEMP through an 8.3 alias (and other hosts through a
  // symlink). Match the store's native physical-path authority checks.
  const temporaryRoot = realpathSync.native(tmpdir());
  const root = mkdtempSync(join(temporaryRoot, "cc-memory-query-benchmark-"));
  const report = {
    schema: "chainlesschain.memory-query-index-measurement/v1",
    measuredAt: new Date().toISOString(),
    sourceHead: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    workingTree: execFileSync(
      "git",
      ["status", "--porcelain", "--untracked-files=all"],
      { encoding: "utf8" },
    ).trim()
      ? "includes-uncommitted-implementation"
      : "clean",
    implementationSha256: sourceDigests(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    samples,
    modes,
    complete: false,
    cacheMode: option("--cache-mode", "validate-disk"),
    indexLayout: option("--index-layout", "bundle"),
    counts,
    query: { category, limit },
    performanceThresholds: null,
    boundary:
      "Local measurement, not approved SLO or release matrix. Cold means a fresh Node process; OS filesystem caches are not flushed. Fixture setup is excluded. Rebuild removes all derived indexes; corrupt replaces their bytes with invalid data. Both keep authority unchanged.",
    tiers: [],
  };
  const save = () => {
    if (!output) return;
    const temporary = `${output}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, {
      flag: "wx",
    });
    renameSync(temporary, output);
  };
  save();
  try {
    for (const count of counts) {
      const filePath = join(root, `authority-${count}.json`);
      const port = new SegmentedMemoryPort({
        filePath,
        queryIndexCacheMode: option("--cache-mode", "validate-disk"),
        queryIndexLayout: option("--index-layout", "bundle"),
      });
      const state = createDurableMemoryFixture(count);
      Object.entries(state.records).forEach(([id, record], index) => {
        state.records[id] = normalizeMemoryRecord({
          ...record,
          digest: undefined,
          category: `category-${index % 32}`,
        });
        const event = {
          ...state.events[index],
          recordDigest: state.records[id].digest,
        };
        delete event.digest;
        event.digest = canonicalDigest(event, "chainlesschain.memory-event/v1");
        state.events[index] = event;
      });
      state.digest = stateDigest(state);
      await port.importSnapshot(state);
      const expected = Object.values(state.records)
        .sort(compareMemoryRows)
        .filter((row) => row.category === category)
        .slice(0, limit)
        .map((row) => publicEntry(row));
      const expectedDigest = digest(expected);
      const checks = (result) => {
        assert.equal(result.rowsDigest, expectedDigest);
        assert.equal(result.count, expected.length);
        return result;
      };
      const worker = (mode) => {
        const child = spawnSync(
          process.execPath,
          [
            script,
            "--worker",
            mode,
            "--file",
            filePath,
            "--cache-mode",
            option("--cache-mode", "validate-disk"),
            "--index-layout",
            option("--index-layout", "bundle"),
          ],
          {
            encoding: "utf8",
            cwd: process.cwd(),
            timeout: 120000,
            maxBuffer: 1024 * 1024,
            windowsHide: true,
          },
        );
        assert.equal(child.status, 0, child.stderr || child.error?.message);
        return checks(JSON.parse(child.stdout));
      };
      // Warm the persistent reader once, outside all measured groups. Every
      // cold/rebuild sample still uses a newly spawned process.
      checks(await measure(port, "indexed"));
      const indexFiles = readdirSync(port.shardDirectory).filter((name) =>
        /^query-[a-f0-9]{2}-[a-f0-9]{64}\.json$/u.test(name),
      );
      const indexBytes = indexFiles.reduce(
        (sum, name) =>
          sum + readFileSync(join(port.shardDirectory, name)).length,
        0,
      );
      const manifest = JSON.parse(readFileSync(filePath));
      const tier = {
        count,
        authorityBytes: manifest.totalBytes,
        indexBytes,
        indexCount: indexFiles.length,
        expectedDigest,
        groups: {},
      };
      report.tiers.push(tier);
      for (const mode of modes) {
        assert.deepEqual(
          sourceDigests(),
          report.implementationSha256,
          "implementation changed during measurement",
        );
        const values = [];
        const summarize = () => ({
          complete: values.length === samples,
          latency: summarizeDurations(values.map((value) => value.durationMs)),
          authorityReads: [
            ...new Set(values.map((value) => value.authorityReads)),
          ],
          authorityBytes: [
            ...new Set(values.map((value) => value.authorityBytes)),
          ],
          peakRssBytes: Math.max(...values.map((value) => value.peakRssBytes)),
          samples: values,
        });
        for (let index = 0; index < samples; index++) {
          if (mode === "rebuild")
            for (const name of indexFiles)
              rmSync(join(port.shardDirectory, name));
          if (mode === "corrupt")
            for (const name of indexFiles)
              writeFileSync(
                join(port.shardDirectory, name),
                "corrupted derived index\n",
              );
          values.push(
            mode === "hot"
              ? checks(await measure(port, "indexed"))
              : worker(mode === "baseline" ? "baseline" : "indexed"),
          );
          tier.groups[mode] = summarize();
          save();
          if ((index + 1) % 10 === 0 || index + 1 === samples)
            process.stderr.write(`${count} ${mode}: ${index + 1}/${samples}\n`);
        }
      }
      assert.deepEqual(
        sourceDigests(),
        report.implementationSha256,
        "implementation changed during measurement",
      );
      process.stderr.write(
        `${count}: ${JSON.stringify(Object.fromEntries(Object.entries(tier.groups).map(([name, result]) => [name, result.latency])))}\n`,
      );
    }
    assert.deepEqual(
      sourceDigests(),
      report.implementationSha256,
      "implementation changed during measurement",
    );
    report.complete = true;
    if (output) save();
    else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    if (
      resolve(root).startsWith(`${temporaryRoot}${sep}`) &&
      basename(root).startsWith("cc-memory-query-benchmark-")
    )
      rmSync(root, { recursive: true, force: true });
  }
}
