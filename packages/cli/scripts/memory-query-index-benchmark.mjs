#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
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

async function measure(port, mode) {
  let authorityReads = 0;
  let authorityBytes = 0;
  const original = port._readShardBytes;
  port._readShardBytes = function (...args) {
    const bytes = original.apply(this, args);
    authorityReads++;
    authorityBytes += bytes.length;
    return bytes;
  };
  const started = performance.now();
  let entries;
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
  } finally {
    port._readShardBytes = original;
  }
  return {
    durationMs: performance.now() - started,
    count: entries.length,
    rowsDigest: digest(entries),
    authorityReads,
    authorityBytes,
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
  };
}

if (option("--worker", null)) {
  const result = await measure(
    new SegmentedMemoryPort({ filePath: option("--file", null) }),
    option("--worker", null),
  );
  process.stdout.write(JSON.stringify(result));
} else {
  const samples = Number(option("--samples", "11"));
  assert.ok(Number.isSafeInteger(samples) && samples > 0 && samples <= 30);
  const counts = option("--counts", "1000,10000,100000").split(",").map(Number);
  assert.ok(
    counts.every(
      (count) => Number.isSafeInteger(count) && count > 0 && count <= 100000,
    ),
  );
  const root = mkdtempSync(join(tmpdir(), "cc-memory-query-benchmark-"));
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
    implementationSha256: Object.fromEntries(
      [
        "segmented-memory-port.js",
        "durable-memory-port.js",
        "memory-query-index.js",
        "memory-service.js",
      ].map((name) => [
        name,
        createHash("sha256")
          .update(
            readFileSync(
              new URL(
                `../src/lib/context-memory-kernel/${name}`,
                import.meta.url,
              ),
            ),
          )
          .digest("hex"),
      ]),
    ),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    samples,
    counts,
    query: { category, limit },
    performanceThresholds: null,
    boundary:
      "Local measurement, not approved SLO or release matrix. Cold means a fresh Node process; OS filesystem caches are not flushed. Fixture setup is excluded. Rebuild removes all derived indexes only.",
    tiers: [],
  };
  try {
    for (const count of counts) {
      const filePath = join(root, `authority-${count}.json`);
      const port = new SegmentedMemoryPort({ filePath });
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
          [script, "--worker", mode, "--file", filePath],
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
      const groups = { baseline: [], cold: [], hot: [], rebuild: [] };
      for (let index = 0; index < samples; index++)
        groups.baseline.push(worker("baseline"));
      for (let index = 0; index < samples; index++)
        groups.cold.push(worker("indexed"));
      checks(await measure(port, "indexed"));
      for (let index = 0; index < samples; index++)
        groups.hot.push(checks(await measure(port, "indexed")));
      const indexFiles = readdirSync(port.shardDirectory).filter((name) =>
        /^query-[a-f0-9]{2}-[a-f0-9]{64}\.json$/u.test(name),
      );
      const indexBytes = indexFiles.reduce(
        (sum, name) =>
          sum + readFileSync(join(port.shardDirectory, name)).length,
        0,
      );
      for (let index = 0; index < samples; index++) {
        for (const name of indexFiles) rmSync(join(port.shardDirectory, name));
        groups.rebuild.push(worker("indexed"));
      }
      const manifest = JSON.parse(readFileSync(filePath));
      const tier = {
        count,
        authorityBytes: manifest.totalBytes,
        indexBytes,
        indexCount: indexFiles.length,
        expectedDigest,
        groups: Object.fromEntries(
          Object.entries(groups).map(([name, values]) => [
            name,
            {
              latency: summarizeDurations(
                values.map((value) => value.durationMs),
              ),
              authorityReads: [
                ...new Set(values.map((value) => value.authorityReads)),
              ],
              authorityBytes: [
                ...new Set(values.map((value) => value.authorityBytes)),
              ],
              peakRssBytes: Math.max(
                ...values.map((value) => value.peakRssBytes),
              ),
              samples: values,
            },
          ]),
        ),
      };
      report.tiers.push(tier);
      process.stderr.write(
        `${count}: ${JSON.stringify(Object.fromEntries(Object.entries(tier.groups).map(([name, result]) => [name, result.latency])))}\n`,
      );
    }
    const output = option("--output", null);
    if (output) writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    if (
      resolve(root).startsWith(`${resolve(tmpdir())}${sep}`) &&
      basename(root).startsWith("cc-memory-query-benchmark-")
    )
      rmSync(root, { recursive: true, force: true });
  }
}
