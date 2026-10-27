#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CLISkillLoader } from "../src/lib/skill-loader.js";
import { routeSkillDescriptors } from "../src/lib/skill-retrieval-router.js";

const fixtureUrl = new URL(
  "../__tests__/fixtures/skill-search-multilingual-v1.json",
  import.meta.url,
);
const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const estimate = (value) =>
  Math.ceil(Buffer.byteLength(JSON.stringify(value), "utf8") / 4);

export function loadSkillSearchFixture() {
  return JSON.parse(fs.readFileSync(fixtureUrl, "utf8"));
}

export function buildSkillSearchDescriptors(
  count,
  fixture = loadSkillSearchFixture(),
) {
  assert.ok(Number.isSafeInteger(count) && count >= 26 && count <= 10000);
  return [
    ...Array.from({ length: count - fixture.skills.length }, (_, index) => ({
      id: `a-housekeeping-${String(index).padStart(5, "0")}`,
      description: "Routine housekeeping and maintenance",
    })),
    ...fixture.skills,
  ];
}

export async function runSkillSearchBenchmark({
  sizes = [50, 200, 500],
  repetitions = 8,
} = {}) {
  assert.ok(Array.isArray(sizes) && sizes.length > 0 && sizes.length <= 10);
  assert.ok(
    Number.isSafeInteger(repetitions) && repetitions >= 1 && repetitions <= 100,
  );
  // Import the production tool path only when running, not when reading fixtures.
  const { executeTool } = await import("../src/runtime/agent-core.js");
  const fixture = loadSkillSearchFixture();
  const report = {
    schema: "chainlesschain.skill-search-measurement/v1",
    measuredAt: new Date().toISOString(),
    fixtureId: fixture.fixtureId,
    fixtureDigest: digest(fs.readFileSync(fixtureUrl)),
    sourceDigests: Object.fromEntries(
      [
        "src/lib/bm25-search.js",
        "src/lib/skill-search-tokenizer.js",
        "src/lib/skill-retrieval-router.js",
        "src/lib/skill-loader.js",
        "src/runtime/agent-core.js",
        "scripts/skill-search-benchmark.mjs",
      ].map((name) => [
        name,
        digest(fs.readFileSync(new URL(`../${name}`, import.meta.url))),
      ]),
    ),
    environment: {
      node: process.version,
      icu: process.versions.icu,
      platform: process.platform,
      arch: process.arch,
    },
    costBasis: "estimated-skill-directory-json-utf8-bytes-divided-by-four",
    providerCalls: 0,
    providerUsageMeasured: false,
    billingVerified: false,
    taskQualityVerified: false,
    notes: [
      "A fixed synthetic descriptor corpus, not real task or invocation quality.",
      "Latency samples repeat fixed queries with a fresh lexical index, excluding discovery and tool dispatch.",
      "Directory token estimates exclude tool wrappers, routing evidence, messages, bodies and provider billing.",
      "Body-cache residency proves instruction materialization only; discovery still reads files to verify content identity.",
    ],
    tiers: [],
  };
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-skill-search-benchmark-"),
  );
  try {
    for (const count of sizes) {
      const descriptors = buildSkillSearchDescriptors(count, fixture);
      const directory = path.join(root, String(count));
      fs.mkdirSync(directory);
      for (const item of descriptors) {
        const skillDir = path.join(directory, item.id);
        fs.mkdirSync(skillDir);
        fs.writeFileSync(
          path.join(skillDir, "SKILL.md"),
          `---\nname: ${item.id}\ndescription: ${item.description}\n---\n\nPreserve ${fixture.bodyMarker}. ${"Reference workflow detail. ".repeat(120)}\n`,
          "utf8",
        );
      }
      const loader = new CLISkillLoader({
        contextLedger: null,
        executionAuthority: {
          readGeneration: () => 1,
          acquireLease: () => ({ generation: 1 }),
          assertGeneration: () => {},
          revoke: () => 2,
        },
      });
      loader.getLayerPaths = () => [
        { layer: "workspace", path: directory, exists: true },
      ];
      const skills = loader.loadAll();
      assert.equal(skills.length, count);
      const bodiesBeforeSearch = loader.getCacheLedger().bodies.resident;
      assert.equal(bodiesBeforeSearch, 0);
      const context = {
        cwd: directory,
        skillLoader: loader,
        hermeticExecution: true,
        skillOutcomeIndex: null,
      };
      const firstPage = await executeTool("list_skills", {}, context);
      assert.equal(firstPage.count, 20);
      assert.ok(
        fixture.skills.every(
          (item) => !firstPage.skills.some((s) => s.id === item.id),
        ),
      );
      const cases = [];
      for (const item of fixture.queries) {
        const routed = routeSkillDescriptors({ skills, query: item.query });
        const listed = await executeTool(
          "list_skills",
          { query: item.query, limit: 5 },
          context,
        );
        assert.deepEqual(
          listed.skills.map((s) => s.id),
          routed.candidates.map((s) => s.id),
        );
        assert.equal(routed.selected?.id ?? null, item.expectedId);
        if (item.expectedId === null) assert.equal(routed.candidates.length, 0);
        cases.push({
          query: item.query,
          expectedId: item.expectedId,
          selectedId: routed.selected?.id ?? null,
          candidateIds: routed.candidates.map((s) => s.id),
        });
      }
      const bodiesAfterSearch = loader.getCacheLedger().bodies.resident;
      assert.equal(bodiesAfterSearch, 0);
      const samples = [];
      for (let repeat = 0; repeat < repetitions; repeat++) {
        for (const item of fixture.queries) {
          const startedAt = performance.now();
          routeSkillDescriptors({ skills, query: item.query });
          samples.push(performance.now() - startedAt);
        }
      }
      samples.sort((a, b) => a - b);
      const selected = skills.find((s) => s.id === "repairTests");
      const materialized = loader.materializeSkill(selected, {
        loadedBecause: "benchmark-selection",
        bodyIncluded: true,
      });
      assert.ok(materialized.body.includes(fixture.bodyMarker));
      const bodiesAfterSelection = loader.getCacheLedger().bodies.resident;
      assert.equal(bodiesAfterSelection, 1);
      const fullDirectory = skills.map((s) => ({
        id: s.id,
        category: s.category,
        source: s.source,
        hasHandler: s.hasHandler,
        description: (s.description || "").substring(0, 80),
      }));
      const positiveCases = cases.filter((item) => item.expectedId !== null);
      const negativeCases = cases.filter((item) => item.expectedId === null);
      report.tiers.push({
        skillCount: count,
        caseCount: cases.length,
        positiveCases: positiveCases.length,
        negativeCases: negativeCases.length,
        recallAt5:
          positiveCases.filter((item) =>
            item.candidateIds.includes(item.expectedId),
          ).length / positiveCases.length,
        wrongSelectionCount: positiveCases.filter(
          (item) => item.selectedId !== item.expectedId,
        ).length,
        negativeSelectionCount: negativeCases.filter(
          (item) => item.selectedId !== null,
        ).length,
        firstPageCount: firstPage.count,
        fullDirectoryEstimatedTokens: estimate(fullDirectory),
        firstPageEstimatedTokens: estimate(firstPage.skills),
        omittedSkillsSearchPassed: true,
        bodiesBeforeSearch,
        bodiesAfterSearch,
        bodiesAfterSelection,
        latency: {
          sampleCount: samples.length,
          p50Ms: samples[Math.ceil(samples.length * 0.5) - 1],
          p95Ms: samples[Math.ceil(samples.length * 0.95) - 1],
          maxMs: samples.at(-1),
        },
        cases,
      });
    }
  } finally {
    const resolved = path.resolve(root);
    assert.ok(
      path.dirname(resolved) === path.resolve(os.tmpdir()) &&
        path.basename(resolved).startsWith("cc-skill-search-benchmark-"),
    );
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  return report;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({ options: { output: { type: "string" } } });
  const report = await runSkillSearchBenchmark();
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (values.output) {
    fs.mkdirSync(path.dirname(path.resolve(values.output)), {
      recursive: true,
    });
    fs.writeFileSync(values.output, json);
  } else process.stdout.write(json);
}
