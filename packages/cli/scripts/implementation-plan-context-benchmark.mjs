#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { CLISkillLoader } from "../src/lib/skill-loader.js";
import { ContextSourceLedger } from "../src/lib/context-source-ledger.js";
import { executeTool } from "../src/runtime/agent-core.js";
import {
  applyToolSearchDeferral,
  describeMcpToolContext,
  executeToolSearch,
} from "../src/runtime/mcp-tool-search.js";

const { values } = parseArgs({ options: { output: { type: "string" } } });
assert.ok(values.output, "--output is required");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-context-fixture-"));
const report = {
  schema: "chainlesschain.implementation-plan-context-measurement/v1",
  measuredAt: new Date().toISOString(),
  scales: [50, 200, 500],
  costBasis: "estimated",
  providerUsageMeasured: false,
  qualityEvaluationCompleted: false,
  tiers: [],
};
try {
  for (const count of report.scales) {
    const directory = path.join(root, String(count));
    fs.mkdirSync(directory);
    for (let i = 0; i < count; i++) {
      const skill = path.join(directory, `skill-${i}`);
      fs.mkdirSync(skill);
      fs.writeFileSync(
        path.join(skill, "SKILL.md"),
        `---\nname: skill-${i}\ndescription: Use for fixture operation ${i}. Selection key target${i}.\n---\n\nKeep fixture constraint CEDAR_27. ${"Workflow reference detail. ".repeat(120)}\n`,
      );
    }
    const ledger = new ContextSourceLedger();
    const loader = new CLISkillLoader({
      contextLedger: ledger,
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
    const before = loader.getCacheLedger();
    assert.equal(before.bodies.resident, 0);
    const context = {
      cwd: directory,
      skillLoader: loader,
      hermeticExecution: true,
      sessionId: `fixture-${count}`,
    };
    const page = await executeTool("list_skills", {}, context);
    assert.equal(page.count, 20);
    assert.equal(page.totalCount, count);
    assert.equal(page.hasMore, true);
    const match = await executeTool(
      "list_skills",
      {
        query: `target${count - 1}`,
      },
      context,
    );
    assert.equal(match.count, 1);
    assert.equal(match.skills[0].id, `skill-${count - 1}`);
    assert.equal(loader.getCacheLedger().bodies.resident, 0);
    const estimate = (value) =>
      Math.ceil(Buffer.byteLength(JSON.stringify(value), "utf8") / 4);
    const fullMetadataTokens = estimate(
      skills.map((s) => ({
        id: s.id,
        category: s.category,
        source: s.source,
        hasHandler: s.hasHandler,
        description: (s.description || "").substring(0, 80),
      })),
    );
    const pagedMetadataTokens = estimate(page.skills);
    const materialized = loader.materializeSkill(skills.at(-1), {
      sessionId: `fixture-${count}`,
      loadedBecause: "benchmark-selection",
      bodyIncluded: true,
    });
    assert.ok(materialized.body.includes("CEDAR_27"));
    const after = loader.getCacheLedger();
    assert.equal(after.bodies.resident, 1);
    const defs = Array.from({ length: count }, (_, i) => ({
      type: "function",
      function: {
        name: `mcp__fixture__operation_${i}`,
        description: `Fixture operation ${i}.`,
        parameters: {
          type: "object",
          properties: Object.fromEntries(
            Array.from({ length: 35 }, (_, j) => [
              `field_${j}`,
              {
                type: "string",
                description: "Exact fixture argument contract.",
              },
            ]),
          ),
          required: ["field_0"],
        },
      },
    }));
    const mcp = {
      extraToolDefinitions: defs,
      externalToolExecutors: Object.fromEntries(
        defs.map((def) => [
          def.function.name,
          {
            kind: "mcp",
            serverName: "fixture",
            toolName: def.function.name.replace("mcp__fixture__", ""),
          },
        ]),
      ),
      externalToolDescriptors: {},
    };
    const { registry } = applyToolSearchDeferral(mcp);
    const selected = executeToolSearch(registry, {
      query: "select:mcp__fixture__operation_7",
    });
    assert.equal(selected.count, 1);
    assert.deepEqual(selected.tools[0].parameters.required, ["field_0"]);
    const tools = describeMcpToolContext(mcp);
    report.tiers.push({
      count,
      skillDescriptors: before.descriptors.resident,
      skillDescriptorEstimatedTokens: before.descriptors.estimatedTokens,
      fullMetadataTokens,
      pagedMetadataTokens,
      metadataTokenEstimator: "utf8-bytes/4",
      directoryReductionPct:
        100 * (1 - pagedMetadataTokens / fullMetadataTokens),
      omittedDescriptorSearchPassed: true,
      bodiesBefore: before.bodies.resident,
      bodiesAfter: after.bodies.resident,
      lazyEstimatedTokensAvoided: after.savings.estimatedTokensAvoided,
      recordedSourceTokens: ledger.getTokenReport({
        sessionId: `fixture-${count}`,
      }),
      mcpSentTokens: tools.sentTokens,
      mcpFullTokens: tools.fullTokens,
      mcpSavedTokens: tools.savedTokens,
      exactSchemaSelection: true,
    });
  }
  fs.mkdirSync(path.dirname(path.resolve(values.output)), { recursive: true });
  fs.writeFileSync(values.output, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      scales: report.scales,
      bodyLoadsPerScale: report.tiers.map((row) => row.bodiesAfter),
      schemaSelectionPassed: true,
      costBasis: report.costBasis,
      qualityEvaluationCompleted: false,
    }),
  );
} finally {
  const resolved = path.resolve(root);
  assert.ok(
    resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
      path.basename(resolved).startsWith("cc-context-fixture-"),
  );
  fs.rmSync(resolved, { recursive: true, force: true });
}
