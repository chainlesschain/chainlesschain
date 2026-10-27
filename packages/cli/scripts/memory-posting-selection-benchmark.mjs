#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  compareMemoryRows,
  compileQueryIndex,
  encodeQueryIndex,
  matchesListQuery,
  mergeQueryRows,
  normalizeListQuery,
  selectQueryRows,
} from "../src/lib/context-memory-kernel/memory-query-index.js";
import { eagerSelectQueryRows } from "../__tests__/fixtures/memory-query-eager-selection-v1.mjs";

const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const take = (iterator, count) => {
  const rows = [];
  for (const row of iterator) {
    rows.push(row);
    if (rows.length >= count) break;
  }
  return rows;
};
const summarize = (samples) => {
  const ordered = [...samples].sort((a, b) => a - b);
  return {
    sampleCount: ordered.length,
    p50Ms: ordered[Math.ceil(ordered.length * 0.5) - 1],
    p95Ms: ordered[Math.ceil(ordered.length * 0.95) - 1],
    maxMs: ordered.at(-1),
  };
};

export function createMemoryPostingFixture(count) {
  assert.ok(Number.isSafeInteger(count) && count >= 100 && count <= 100000);
  const records = Object.fromEntries(
    Array.from({ length: count }, (_, i) => {
      const memoryId = `record-${String(i).padStart(6, "0")}`;
      return [
        memoryId,
        {
          memoryId,
          category: i % 1000 === 1 ? "selective" : "general",
          scope: "project",
          scopeId: `project-${i % 8}`,
          state: i % 19 === 0 ? "deleted" : "active",
          importance: i % 11,
          updatedAt: "2026-10-27T00:00:00.000Z",
          tags: ["all", `tag-${i % 64}`],
          allowedSinks: i % 2 ? ["provider.local"] : ["*", "provider.local"],
        },
      ];
    }),
  );
  const buckets = new Map();
  for (const [id, record] of Object.entries(records)) {
    const bucket = createHash("sha256").update(id).digest("hex").slice(0, 2);
    if (!buckets.has(bucket)) buckets.set(bucket, {});
    buckets.get(bucket)[id] = record;
  }
  const shards = [...buckets].map(([bucket, records]) => {
    const state = { digest: digest(JSON.stringify(records)), records };
    return {
      bucket,
      index: compileQueryIndex(encodeQueryIndex(state), {
        digest: state.digest,
        recordCount: Object.keys(records).length,
      }),
    };
  });
  return {
    shards,
    rows: shards.flatMap((shard) => shard.index.rows).sort(compareMemoryRows),
  };
}

export function runMemoryPostingSelectionBenchmark({
  counts = [1000, 10000, 100000],
  samples = 100,
} = {}) {
  assert.ok(Array.isArray(counts) && counts.length > 0 && counts.length <= 10);
  assert.ok(Number.isSafeInteger(samples) && samples >= 1 && samples <= 1000);
  const report = {
    schema: "chainlesschain.memory-posting-selection-measurement/v1",
    measuredAt: new Date().toISOString(),
    fixtureId: "memory-posting-selection-v1",
    baselineCommit: "6b76d4fd5486f44c8cc662512edbb8db45b64266",
    sourceDigests: Object.fromEntries(
      [
        "src/lib/context-memory-kernel/memory-query-index.js",
        "__tests__/fixtures/memory-query-eager-selection-v1.mjs",
        "scripts/memory-posting-selection-benchmark.mjs",
      ].map((name) => [
        name,
        digest(readFileSync(new URL(`../${name}`, import.meta.url))),
      ]),
    ),
    environment: {
      node: process.version,
      icu: process.versions.icu,
      platform: process.platform,
      arch: process.arch,
      cpu: cpus()[0]?.model ?? null,
    },
    samplesPerCase: samples,
    measurementScope:
      "in-memory posting selection and page merge across hash shards only",
    fullStoreSloVerified: false,
    providerCalls: 0,
    notes: [
      "Both algorithms use the same compiled metadata, matching, order and cursor; each result is checked against a full scan.",
      "Records are split by the production SHA-256 two-hex bucket rule across up to 256 compiled indexes.",
      "Fixture setup, index compilation, file IO, locking, authoritative shard validation and kernel ranking are excluded from timings.",
      "The reference retains the eager union algorithm at the baseline commit; it is used only in this offline benchmark.",
      "Samples alternate execution order after warmup; no hardware-independent timing gate is claimed.",
    ],
    tiers: [],
  };
  for (const count of counts) {
    const index = createMemoryPostingFixture(count);
    const cases = [
      {
        id: "selective-category-broad-sink",
        options: { category: "selective", sink: "provider.local" },
      },
      {
        id: "selective-category-broad-tags-scopes",
        options: {
          category: "selective",
          tags: ["all", "tag-1", "tag-2"],
          scopeAdmissions: Array.from({ length: 8 }, (_, i) => ({
            scope: "project",
            scopeId: `project-${i}`,
          })),
        },
      },
      {
        id: "sparse-tag-union-with-cursor",
        options: { tags: ["tag-1", "tag-2"], sink: "provider.local" },
        after: index.rows[Math.floor(index.rows.length / 2)],
      },
      {
        id: "empty-admissions",
        options: {
          scopeAdmissions: [],
          tags: ["all", "tag-1"],
          sink: "provider.local",
        },
      },
      { id: "unfiltered-page", options: {} },
    ];
    const tier = {
      recordCount: count,
      shardCount: index.shards.length,
      fixtureDigest: digest(JSON.stringify(index.rows)),
      cases: [],
    };
    for (const item of cases) {
      const query = normalizeListQuery(item.options),
        after = item.after || null,
        limit = 20;
      const expected = index.rows
        .filter(
          (row) =>
            matchesListQuery(row, query) &&
            (!after || compareMemoryRows(row, after) > 0),
        )
        .slice(0, limit);
      const expectedDigest = digest(JSON.stringify(expected));
      const run = (algorithm) => {
        const heads = [];
        for (const shard of index.shards) {
          const iterator = algorithm(shard.index, query, after);
          const next = iterator.next();
          if (!next.done)
            heads.push({ bucket: shard.bucket, iterator, row: next.value });
        }
        return take(mergeQueryRows(heads), limit).map(({ row }) => row);
      };
      assert.deepEqual(run(eagerSelectQueryRows), expected);
      assert.deepEqual(run(selectQueryRows), expected);
      for (let warmup = 0; warmup < 5; warmup++) {
        run(eagerSelectQueryRows);
        run(selectQueryRows);
      }
      const eager = [],
        selective = [];
      const measure = (algorithm, values) => {
        const started = performance.now();
        const rows = run(algorithm);
        values.push(performance.now() - started);
        assert.equal(digest(JSON.stringify(rows)), expectedDigest);
      };
      for (let sample = 0; sample < samples; sample++) {
        if (sample % 2) {
          measure(selectQueryRows, selective);
          measure(eagerSelectQueryRows, eager);
        } else {
          measure(eagerSelectQueryRows, eager);
          measure(selectQueryRows, selective);
        }
      }
      tier.cases.push({
        id: item.id,
        query,
        after,
        limit,
        resultCount: expected.length,
        resultDigest: expectedDigest,
        fullScanEqual: true,
        eager: summarize(eager),
        selective: summarize(selective),
      });
    }
    report.tiers.push(tier);
  }
  return report;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({ options: { output: { type: "string" } } });
  const report = runMemoryPostingSelectionBenchmark();
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (values.output) {
    mkdirSync(dirname(resolve(values.output)), { recursive: true });
    writeFileSync(values.output, json);
  } else process.stdout.write(json);
}
