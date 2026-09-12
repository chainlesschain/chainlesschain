import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadPluginEvalDefinition,
  parsePluginEvalRuntimeMetrics,
  PLUGIN_EVAL_REPORT_SCHEMA,
  PLUGIN_EVAL_SUITE_SCHEMA,
  renderPluginEvalHtml,
  runPluginEval,
} from "../../src/lib/eval/plugin-suite.js";

let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-plugin-eval-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writePlugin({
  name = "eval-helper",
  version = "1.2.3",
  expectation = "should_trigger",
  minPassRateDelta = 0,
  prompt = "Use the eval helper and create result.txt.",
} = {}) {
  fs.mkdirSync(path.join(root, "skills", "assist"), { recursive: true });
  fs.mkdirSync(path.join(root, "evals"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "plugin.json"),
    JSON.stringify({
      name,
      version,
      skills: [{ name: "assist", path: "skills/assist" }],
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "skills", "assist", "SKILL.md"),
    "# Assist\n\nCreate result.txt with exactly candidate.\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "evals", "suite.json"),
    JSON.stringify({
      schema: PLUGIN_EVAL_SUITE_SCHEMA,
      plugin: { name, version },
      thresholds: { minPassRateDelta },
      tasks: [
        {
          id: "plugin-benefit",
          description: "candidate should produce the expected result",
          prompt,
          expectation,
          assertions: [
            { type: "file_equals", path: "result.txt", value: "candidate" },
          ],
          expectedFiles: ["result.txt"],
        },
      ],
    }),
    "utf8",
  );
  return { name, version };
}

function resultStream({ triggered = false, cost = 0.01 } = {}) {
  return `${JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "done",
    num_turns: 1,
    total_cost_usd: cost,
    usage: { input_tokens: 10, output_tokens: 3 },
    tool_calls: triggered
      ? [
          {
            tool: "run_skill",
            args: { skill_name: "assist", input: "create result" },
          },
        ]
      : [],
  })}\n`;
}

function fakeAgent({
  writeForControl = false,
  writeForCandidate = true,
  trigger = true,
} = {}) {
  return async ({ cwd }) => {
    const candidate = fs.existsSync(
      path.join(
        cwd,
        ".chainlesschain",
        "plugins",
        "eval-helper",
        "1.2.3",
        "plugin.json",
      ),
    );
    if ((candidate && writeForCandidate) || (!candidate && writeForControl)) {
      fs.writeFileSync(path.join(cwd, "result.txt"), "candidate", "utf8");
    }
    return {
      ok: true,
      output: resultStream({ triggered: candidate && trigger }),
    };
  };
}

describe("plugin eval suite contract", () => {
  it("binds exact plugin and suite payload identities", () => {
    writePlugin();
    const first = loadPluginEvalDefinition(root);
    const second = loadPluginEvalDefinition(root);

    expect(first.identity).toMatchObject({
      name: "eval-helper",
      version: "1.2.3",
      skills: ["assist"],
    });
    expect(first.suiteDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.payload.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(second.suiteDigest).toBe(first.suiteDigest);
    expect(second.payload.digest).toBe(first.payload.digest);

    fs.appendFileSync(
      path.join(root, "skills", "assist", "SKILL.md"),
      "change",
    );
    expect(loadPluginEvalDefinition(root).payload.digest).not.toBe(
      first.payload.digest,
    );
  });

  it("rejects a suite for another plugin version", () => {
    writePlugin();
    const suitePath = path.join(root, "evals", "suite.json");
    const suite = JSON.parse(fs.readFileSync(suitePath, "utf8"));
    suite.plugin.version = "9.9.9";
    fs.writeFileSync(suitePath, JSON.stringify(suite), "utf8");

    expect(() => loadPluginEvalDefinition(root)).toThrow(
      /identity must match/u,
    );
  });

  it("accepts multiline prompts, fixtures, and exact assertion values", () => {
    writePlugin();
    const suitePath = path.join(root, "evals", "suite.json");
    const suite = JSON.parse(fs.readFileSync(suitePath, "utf8"));
    suite.tasks[0].prompt = "Read input.txt.\nThen create result.txt.";
    suite.tasks[0].fixtures = [
      { path: "input.txt", content: "first line\nsecond line\n" },
    ];
    suite.tasks[0].assertions[0].value = "candidate\nwith newline\n";
    fs.writeFileSync(suitePath, JSON.stringify(suite), "utf8");

    const definition = loadPluginEvalDefinition(root);
    expect(definition.tasks[0]).toMatchObject({
      prompt: "Read input.txt.\nThen create result.txt.",
      assertions: [
        {
          type: "file_equals",
          path: "result.txt",
          value: "candidate\nwith newline\n",
        },
      ],
    });
    expect(definition.tasks[0].fixtures[0].bytes.toString("utf8")).toBe(
      "first line\nsecond line\n",
    );
  });

  it.each(["../outside.txt", ".chainlesschain/override.json", "C:/escape.txt"])(
    "rejects unsafe task paths: %s",
    (unsafePath) => {
      writePlugin();
      const suitePath = path.join(root, "evals", "suite.json");
      const suite = JSON.parse(fs.readFileSync(suitePath, "utf8"));
      suite.tasks[0].assertions[0].path = unsafePath;
      fs.writeFileSync(suitePath, JSON.stringify(suite), "utf8");
      expect(() => loadPluginEvalDefinition(root)).toThrow(
        /must stay inside|must be relative/u,
      );
    },
  );

  it("runs a disabled control and a snapshot-bound candidate as separate arms", async () => {
    writePlugin({ minPassRateDelta: 1 });
    const definition = loadPluginEvalDefinition(root);
    const agent = fakeAgent();
    const report = await runPluginEval(definition, {
      controlRunAgent: agent,
      candidateRunAgent: agent,
      provider: "fixture-provider",
      model: "fixture-model",
    });

    expect(report).toMatchObject({
      schema: PLUGIN_EVAL_REPORT_SCHEMA,
      scope: "local-plugin-eval",
      productionAttested: false,
      status: "PASS",
      passed: true,
      selection: {
        provider: "fixture-provider",
        model: "fixture-model",
        dryRun: false,
      },
      comparison: { passRateDelta: 1, outcome: "gain" },
      arms: {
        control: {
          effectivePassed: 0,
          triggerRate: 0,
          totalCostUsd: 0.01,
        },
        candidate: {
          effectivePassed: 1,
          triggerRate: 1,
          totalCostUsd: 0.01,
        },
      },
    });
    expect(report.plugin.payloadDigest).toBe(definition.payload.digest);
    expect(report.suite.digest).toBe(definition.suiteDigest);
    expect(report.arms.candidate.results[0]).toMatchObject({
      artifactCheckPassed: true,
      executionSucceeded: true,
      pluginTriggered: true,
      activationPassed: true,
      effectivePass: true,
    });
  });

  it("reports a neutral result when the configured gain is not met", async () => {
    writePlugin({ expectation: "optional", minPassRateDelta: 0.5 });
    const definition = loadPluginEvalDefinition(root);
    const agent = fakeAgent({ writeForControl: true, trigger: false });
    const report = await runPluginEval(definition, {
      controlRunAgent: agent,
      candidateRunAgent: agent,
    });

    expect(report.status).toBe("FAIL");
    expect(report.comparison).toEqual({ passRateDelta: 0, outcome: "neutral" });
    expect(report.reasons).toContain("minimum_gain_not_met");
  });

  it("reports candidate degradation independently from artifact details", async () => {
    writePlugin({ expectation: "optional" });
    const definition = loadPluginEvalDefinition(root);
    const agent = fakeAgent({
      writeForControl: true,
      writeForCandidate: false,
    });
    const report = await runPluginEval(definition, {
      controlRunAgent: agent,
      candidateRunAgent: agent,
    });

    expect(report.status).toBe("FAIL");
    expect(report.comparison).toEqual({
      passRateDelta: -1,
      outcome: "regression",
    });
    expect(report.reasons).toContain("candidate_tasks_failed");
  });

  it("requires evidence for should_trigger and accepts should_not_trigger", async () => {
    writePlugin({ expectation: "should_trigger" });
    const required = loadPluginEvalDefinition(root);
    const noTriggerAgent = fakeAgent({ trigger: false });
    const failed = await runPluginEval(required, {
      controlRunAgent: noTriggerAgent,
      candidateRunAgent: noTriggerAgent,
    });
    expect(failed.status).toBe("FAIL");
    expect(failed.arms.candidate.results[0]).toMatchObject({
      pluginTriggered: false,
      activationPassed: false,
      effectivePass: false,
    });

    fs.rmSync(path.join(root, "evals", "suite.json"));
    writePlugin({ expectation: "should_not_trigger" });
    const forbidden = loadPluginEvalDefinition(root);
    const passed = await runPluginEval(forbidden, {
      controlRunAgent: noTriggerAgent,
      candidateRunAgent: noTriggerAgent,
    });
    expect(passed.status).toBe("PASS");
    expect(passed.arms.candidate.results[0].activationPassed).toBe(true);
  });

  it("never turns a dry-run into effect evidence", async () => {
    writePlugin({ expectation: "optional" });
    const definition = loadPluginEvalDefinition(root);
    const agent = fakeAgent({ writeForControl: true });
    const report = await runPluginEval(definition, {
      controlRunAgent: agent,
      candidateRunAgent: agent,
      dryRun: true,
    });
    expect(report).toMatchObject({
      status: "INSUFFICIENT_EVIDENCE",
      passed: false,
      reasons: expect.arrayContaining(["dry_run"]),
    });
  });

  it("parses bounded usage and direct plugin attribution from one terminal", () => {
    const metrics = parsePluginEvalRuntimeMetrics(
      `${JSON.stringify({
        type: "result",
        tool_calls: [
          {
            tool: "plugin_tool",
            plugin: "eval-helper",
            pluginVersion: "1.2.3",
          },
        ],
        usage: { input_tokens: 7, output_tokens: 2, invalid: -1 },
        total_cost_usd: 0.02,
        num_turns: 1,
      })}\n`,
      { name: "eval-helper", version: "1.2.3", skills: [] },
    );
    expect(metrics).toMatchObject({
      available: true,
      pluginTriggered: true,
      usage: { input_tokens: 7, output_tokens: 2 },
      totalCostUsd: 0.02,
      turns: 1,
      toolCallCount: 1,
    });
    expect(parsePluginEvalRuntimeMetrics("not-json", {})).toEqual({
      available: false,
      pluginTriggered: null,
    });
  });

  it("escapes plugin-controlled content in the standalone HTML report", async () => {
    writePlugin({
      expectation: "optional",
      prompt: "<script>alert(1)</script>",
    });
    const definition = loadPluginEvalDefinition(root);
    const agent = fakeAgent({ writeForControl: true });
    const report = await runPluginEval(definition, {
      controlRunAgent: agent,
      candidateRunAgent: agent,
    });
    report.arms.candidate.results[0].detail = "<img src=x onerror=alert(1)>";
    const html = renderPluginEvalHtml(report);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
  });
});
