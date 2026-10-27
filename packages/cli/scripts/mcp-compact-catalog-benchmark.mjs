#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  applyToolSearchDeferral,
  executeToolSearch,
  projectMcpToolDefinitions,
  describeMcpToolContext,
  searchDeferredTools,
  TOOL_SEARCH_DEFAULTS,
} from "../src/runtime/mcp-tool-search.js";
import {
  loadMcpSearchFixture,
  buildMcpSearchBenchmarkWiring,
} from "./mcp-tool-search-benchmark.mjs";

const digest = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export function runCompactCatalogBenchmark({ sizes = [200, 1000, 5000] } = {}) {
  const fixture = loadMcpSearchFixture();
  assert.ok(
    Array.isArray(sizes) &&
      sizes.length > 0 &&
      sizes.length <= 10 &&
      sizes.every(
        (size) =>
          Number.isSafeInteger(size) &&
          size >= fixture.tools.length &&
          size <= 10000,
      ),
    "Invalid catalog sizes",
  );
  const report = {
    schema: "chainlesschain.mcp-compact-catalog-benchmark/v1",
    measuredAt: new Date().toISOString(),
    fixtureId: fixture.fixtureId,
    fixtureDigest: digest(
      readFileSync(
        new URL(
          "../__tests__/fixtures/mcp-tool-search-multilingual-v1.json",
          import.meta.url,
        ),
      ),
    ),
    sourceDigests: Object.fromEntries(
      ["mcp-tool-search.js", "agent-core.js", "headless-runner.js"].map(
        (name) => [
          name,
          digest(
            readFileSync(new URL(`../src/runtime/${name}`, import.meta.url)),
          ),
        ],
      ),
    ),
    environment: {
      node: process.version,
      icu: process.versions.icu,
      platform: process.platform,
      arch: process.arch,
    },
    costBasis: "estimated-extra-tool-definitions",
    providerCalls: 0,
    providerUsageMeasured: false,
    billingVerified: false,
    taskQualityVerified: false,
    notes: [
      "Only the MCP tool-definition component is estimated; built-ins, messages, returned schemas, cache billing and real provider usage are excluded.",
      "Compact mode retains the complete host capability ceiling, and exposes full schemas only after discovery.",
      "Loaded schemas accumulate; compact mode does not evict them or promise a constant size across a long session.",
      "The fixed bilingual search fixture is reused. This is not a live task or quality evaluation.",
    ],
    tiers: [],
  };
  for (const toolCount of sizes) {
    const stubs = buildMcpSearchBenchmarkWiring(fixture, toolCount);
    const compact = buildMcpSearchBenchmarkWiring(fixture, toolCount);
    applyToolSearchDeferral(stubs);
    const { registry } = applyToolSearchDeferral(compact, {
      catalogMode: "compact",
    });
    const snapshot = (mcp) => {
      const context = describeMcpToolContext(mcp, {
        config: TOOL_SEARCH_DEFAULTS,
      });
      return {
        visibleExtraToolCount: projectMcpToolDefinitions(
          mcp.extraToolDefinitions,
          mcp.externalToolExecutors,
        ).length,
        estimatedExtraToolTokens: context.sentTokens,
        fullInventoryTokens: context.fullTokens,
        loadedSchemaCount: mcp.toolSearchRegistry.loaded.size,
      };
    };
    const initialStubs = snapshot(stubs),
      initialCompact = snapshot(compact);
    assert.equal(initialCompact.visibleExtraToolCount, 1);
    const directory = executeToolSearch(registry, { query: "servers:" });
    assert.equal(registry.loaded.size, 0);
    for (const item of fixture.queries) {
      assert.deepEqual(
        searchDeferredTools(registry, item.query).results.map(
          (hit) => hit.name,
        ),
        searchDeferredTools(stubs.toolSearchRegistry, item.query).results.map(
          (hit) => hit.name,
        ),
      );
    }
    const selectedNames = fixture.tools
      .slice(0, 5)
      .map((tool) => `mcp__${tool.server}__${tool.tool}`);
    const loaded = executeToolSearch(registry, {
      query: `select:${selectedNames.join(",")}`,
      max_results: 5,
    });
    assert.equal(loaded.count, 5);
    const afterFiveSchemas = snapshot(compact);
    assert.equal(afterFiveSchemas.visibleExtraToolCount, 6);
    assert.equal(
      compact.extraToolDefinitions.length,
      stubs.extraToolDefinitions.length,
    );
    report.tiers.push({
      toolCount,
      initialStubs,
      initialCompact,
      afterFiveSchemas,
      estimatedInitialReductionRatio:
        1 -
        initialCompact.estimatedExtraToolTokens /
          initialStubs.estimatedExtraToolTokens,
      firstDirectoryPageSize: directory.servers.length,
      serverCount: directory.totalServers,
      lexicalResultsUnchanged: true,
      hostDefinitionCount: compact.extraToolDefinitions.length,
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
      sizes: { type: "string", default: "200,1000,5000" },
    },
  });
  const report = runCompactCatalogBenchmark({
    sizes: values.sizes.split(",").map(Number),
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (values.output) {
    mkdirSync(dirname(resolve(values.output)), { recursive: true });
    writeFileSync(values.output, json);
  } else process.stdout.write(json);
}
