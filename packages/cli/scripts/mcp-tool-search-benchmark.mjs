#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus, platform, arch } from "node:os";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import {
  applyToolSearchDeferral,
  describeMcpToolContext,
  searchDeferredTools,
} from "../src/runtime/mcp-tool-search.js";

const fixtureUrl = new URL(
  "../__tests__/fixtures/mcp-tool-search-multilingual-v1.json",
  import.meta.url,
);
const digest = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export function loadMcpSearchFixture() {
  return JSON.parse(readFileSync(fixtureUrl, "utf8"));
}

// Reproduce the previous keyword scorer against the SAME admitted registry.
// Neither comparator loads schemas or bypasses stale-entry filtering.
export function legacyMcpKeywordSearch(registry, query) {
  const terms = query
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  const required = terms
    .filter((term) => term.startsWith("+") && term.length > 1)
    .map((term) => term.slice(1));
  const scoring = terms.map((term) =>
    term.startsWith("+") ? term.slice(1) : term,
  );
  const entries = new Map(
    [...registry.deferred].filter(([, entry]) => entry.stale !== true),
  );
  const scored = [];
  for (const [name, entry] of entries) {
    const lowerName = name.toLowerCase();
    const description = String(
      entry.definition.function.description || "",
    ).toLowerCase();
    if (required.some((term) => !lowerName.includes(term))) continue;
    let score = 0;
    for (const term of scoring) {
      if (lowerName.includes(term)) score += 3;
      if (description.includes(term)) score += 1;
    }
    if (score > 0) scored.push({ name, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 5);
}

export function buildMcpSearchBenchmarkWiring(fixture, size) {
  const externalToolExecutors = Object.create(null);
  const externalToolDescriptors = Object.create(null);
  const extraToolDefinitions = [];
  for (let i = 0; i < size; i++) {
    const spec = fixture.tools[i] || {
      server: `inventory_${i}`,
      tool: "inspect_item",
      description: `Inspect unrelated inventory metadata item ${i}.`,
    };
    const name = `mcp__${spec.server}__${spec.tool}`;
    externalToolExecutors[name] = {
      kind: "mcp",
      serverName: spec.server,
      toolName: spec.tool,
    };
    externalToolDescriptors[name] = { name, kind: "mcp", source: spec.server };
    extraToolDefinitions.push({
      type: "function",
      function: {
        name,
        description: spec.description,
        parameters: {
          type: "object",
          properties: Object.fromEntries(
            Array.from({ length: 12 }, (_, j) => [
              `field_${j}`,
              {
                type: "string",
                description: `Synthetic parameter ${j} for admitted fixture operation.`,
              },
            ]),
          ),
          required: ["field_0"],
        },
      },
    });
  }
  return {
    extraToolDefinitions,
    externalToolExecutors,
    externalToolDescriptors,
  };
}

export function evaluateMcpSearchFixture(fixture, search) {
  const queries = fixture.queries.map((item) => {
    const ranked = search(item.query).map((result) => result.name);
    const relevant = new Set(item.relevant);
    const hits = ranked.filter((name) => relevant.has(name)).length;
    const first = ranked.findIndex((name) => relevant.has(name));
    return {
      id: item.id,
      group: item.group,
      query: item.query,
      relevant: item.relevant,
      ranked,
      recallAt5: relevant.size ? hits / relevant.size : null,
      precisionAmongReturned: ranked.length ? hits / ranked.length : 0,
      reciprocalRank: first < 0 ? 0 : 1 / (first + 1),
      falseRecall: relevant.size === 0 && ranked.length > 0,
    };
  });
  const positives = queries.filter((item) => item.relevant.length);
  const negatives = queries.filter((item) => !item.relevant.length);
  const mean = (items, key) =>
    items.length
      ? items.reduce((sum, item) => sum + item[key], 0) / items.length
      : 0;
  return {
    positiveQueryCount: positives.length,
    negativeQueryCount: negatives.length,
    recallAt5: mean(positives, "recallAt5"),
    mrr: mean(positives, "reciprocalRank"),
    precisionAmongReturned: mean(positives, "precisionAmongReturned"),
    negativeQueryFalseRecallCount: negatives.filter((item) => item.falseRecall)
      .length,
    queries,
  };
}

function latency(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    sampleCount: values.length,
    p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maxMs: sorted.at(-1),
  };
}

export function runMcpToolSearchBenchmark({
  sizes = [200, 1000, 5000],
  samples = 110,
} = {}) {
  const fixture = loadMcpSearchFixture();
  assert.ok(
    Number.isSafeInteger(samples) && samples >= 1 && samples <= 10000,
    "samples must be 1..10000",
  );
  assert.ok(
    Array.isArray(sizes) &&
      sizes.length >= 1 &&
      sizes.length <= 10 &&
      sizes.every(
        (size) =>
          Number.isSafeInteger(size) &&
          size >= fixture.tools.length &&
          size <= 10000,
      ),
    "sizes must cover the fixture and stay within 10000 tools",
  );
  const report = {
    schema: "chainlesschain.mcp-tool-search-benchmark/v1",
    measuredAt: new Date().toISOString(),
    fixtureId: fixture.fixtureId,
    fixtureDigest: digest(readFileSync(fixtureUrl)),
    sourceDigests: Object.fromEntries(
      ["mcp-tool-search.js", "mcp-tool-search-ranking.js"].map((file) => [
        file,
        digest(
          readFileSync(new URL(`../src/runtime/${file}`, import.meta.url)),
        ),
      ]),
    ),
    environment: {
      node: process.version,
      icu: process.versions.icu,
      platform: platform(),
      arch: arch(),
      cpu: cpus()[0]?.model || "unknown",
    },
    catalogMode: "per-tool-stubs",
    providerCalls: 0,
    providerUsageMeasured: false,
    billingVerified: false,
    taskQualityVerified: false,
    semanticRecallMeasured: false,
    notes: [
      "Synthetic bilingual metadata; no automatic translation or semantic retrieval.",
      "Recall@5 is the macro mean fraction of relevant tools retrieved, not a hit rate.",
      "Negative-query false recall is not a tool miscall rate; no tools are executed.",
      "Catalog token counts are estimates. Both scorers use the same stub catalog; no additional prompt or fee savings are attributed to ranking.",
      "Latency samples rotate through the fixed queries after warmup; process RSS is cumulative, not isolated per scorer.",
    ],
    tiers: [],
  };
  for (const size of sizes) {
    const mcp = buildMcpSearchBenchmarkWiring(fixture, size);
    const started = performance.now();
    const { registry } = applyToolSearchDeferral(mcp);
    const deferralMs = performance.now() - started;
    const catalogBefore = JSON.stringify(mcp.extraToolDefinitions);
    const current = (query) => searchDeferredTools(registry, query).results;
    const legacy = (query) => legacyMcpKeywordSearch(registry, query);
    const coldStarted = performance.now();
    current(fixture.queries[0].query);
    const coldQueryMs = performance.now() - coldStarted;
    const currentMetrics = evaluateMcpSearchFixture(fixture, current);
    const legacyMetrics = evaluateMcpSearchFixture(fixture, legacy);
    const currentTimes = [],
      legacyTimes = [];
    for (let i = 0; i < samples; i++) {
      const query = fixture.queries[i % fixture.queries.length].query;
      // Alternate the order so one scorer is not always measured second.
      for (const [run, values] of i % 2
        ? [
            [current, currentTimes],
            [legacy, legacyTimes],
          ]
        : [
            [legacy, legacyTimes],
            [current, currentTimes],
          ]) {
        const start = performance.now();
        run(query);
        values.push(performance.now() - start);
      }
    }
    assert.equal(registry.loaded.size, 0);
    assert.equal(JSON.stringify(mcp.extraToolDefinitions), catalogBefore);
    const context = describeMcpToolContext(mcp);
    report.tiers.push({
      toolCount: size,
      deferralMs,
      estimatedCatalogTokens: {
        full: context.fullTokens,
        stubs: context.sentTokens,
      },
      catalogUnchanged: true,
      schemasLoadedBySearchOnly: registry.loaded.size,
      current: {
        ...currentMetrics,
        coldQueryMs,
        latency: latency(currentTimes),
      },
      legacySubstring: { ...legacyMetrics, latency: latency(legacyTimes) },
      processRssBytesAfterTier: process.memoryUsage().rss,
    });
  }
  return report;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: {
      output: { type: "string" },
      samples: { type: "string", default: "110" },
      sizes: { type: "string", default: "200,1000,5000" },
    },
  });
  const report = runMcpToolSearchBenchmark({
    sizes: values.sizes.split(",").map(Number),
    samples: Number(values.samples),
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (values.output) {
    mkdirSync(dirname(resolve(values.output)), { recursive: true });
    writeFileSync(values.output, json);
  } else process.stdout.write(json);
}
