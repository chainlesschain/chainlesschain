import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DIAGNOSTIC,
  changedFiles,
  inspectModelTrace,
  modelEnvironment,
  redactDiagnostic,
  taskPrompt,
} from "../scripts/verify01-volcengine-task-diagnostic.mjs";

const workspace = path.resolve("task-workspace");
const expectedFiles = ["packages/cli/__tests__/verify-04.test.js"];
function transcript({
  cost = 0.012,
  pathName = expectedFiles[0],
  tool = "write_file",
} = {}) {
  return [
    {
      type: "system",
      subtype: "init",
      provider: DIAGNOSTIC.provider,
      model: DIAGNOSTIC.model,
      permission_mode: "acceptEdits",
      tools: ["read_file", "write_file"],
    },
    {
      type: "token_usage",
      provider: DIAGNOSTIC.provider,
      model: DIAGNOSTIC.model,
      usage: { input_tokens: 12, output_tokens: 4 },
    },
    {
      type: "tool_use",
      id: "write-1",
      tool,
      args: { path: pathName, content: "candidate" },
    },
    {
      type: "tool_result",
      id: "write-1",
      tool,
      is_error: false,
      error: null,
      result: { success: true },
    },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "Finished; tests not run",
      usage: {
        input_tokens: 12,
        output_tokens: 4,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      total_cost_usd: cost,
    },
  ];
}
const inspect = (events) =>
  inspectModelTrace(
    events.map((event) => JSON.stringify(event)).join("\n"),
    expectedFiles,
    workspace,
  );

test("retains known estimates but never treats missing cost as zero", () => {
  const known = inspect(transcript());
  assert.equal(known.pass, true);
  assert.equal(known.modelUsageRecordCount, 1);
  assert.equal(known.estimatedCostUSD, 0.012);
  assert.equal(known.actualBilledCostUSD, null);
  const unknown = inspect(transcript({ cost: null }));
  assert.equal(unknown.pass, true); // Behavioral acceptance and billing are separate.
  assert.equal(unknown.estimatedCostUSD, null);
  assert.equal(unknown.actualBilledCostUSD, null);
});

test("rejects shell tools, out-of-scope writes, incorrect IDs and fallback identity", () => {
  assert.equal(inspect(transcript({ tool: "run_shell" })).pass, false);
  assert.equal(
    inspect(transcript({ pathName: "../../outside.js" })).pass,
    false,
  );
  assert.equal(
    inspect(transcript({ pathName: "packages/cli/src/main.js" })).pass,
    false,
  );
  const id = transcript();
  id[3].id = "unrelated";
  assert.equal(inspect(id).pass, false);
  const identity = transcript();
  identity[1].model = "different-model";
  assert.equal(inspect(identity).pass, false);
  const surface = transcript();
  surface[0].tools.push("run_shell");
  assert.equal(inspect(surface).pass, false);
  const fallback = transcript();
  fallback.splice(1, 0, { type: "system", subtype: "provider_fallback" });
  assert.equal(inspect(fallback).pass, false);
});

test("rejects malformed or duplicate terminal output and preserves unknown cost", () => {
  assert.equal(inspect([...transcript(), transcript().at(-1)]).pass, false);
  const parsed = inspectModelTrace("broken\n", expectedFiles, workspace);
  assert.equal(parsed.pass, false);
  assert.equal(parsed.estimatedCostUSD, null);
});

test("the model child receives only its credential, fixed provider and exact write scope", () => {
  const env = modelEnvironment({
    root: "/tmp/task",
    profile: "/tmp/task/profile",
    expectedFiles,
    key: "test-key",
    input: {
      PATH: "/bin",
      GITHUB_TOKEN: "secret",
      NODE_OPTIONS: "bad",
      OPENAI_API_KEY: "other",
      CC_FALLBACK_MODEL: "other",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost",
    },
  });
  assert.equal(env.VOLCENGINE_API_KEY, "test-key");
  assert.equal(env.HOME, path.join("/tmp/task", "user-home"));
  assert.notEqual(env.HOME, env.CHAINLESSCHAIN_HOME);
  assert.equal(env.CC_MAX_RETRIES, "0");
  assert.deepEqual(
    JSON.parse(env.CC_FORMAL_QUALITY_EVAL_ALLOWED_FILES),
    expectedFiles,
  );
  for (const name of [
    "GITHUB_TOKEN",
    "NODE_OPTIONS",
    "OPENAI_API_KEY",
    "CC_FALLBACK_MODEL",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
  ])
    assert.equal(env[name], undefined);
});

test("redacts literal and JSON-escaped key bytes and detects unexpected workspace changes", () => {
  const secret = 'key"with\\escapes';
  assert.equal(
    redactDiagnostic(secret + " " + JSON.stringify(secret), secret),
    '[redacted] "[redacted]"',
  );
  assert.deepEqual(
    changedFiles(
      { source: { digest: "old" } },
      { source: { digest: "new" }, candidate: { digest: "bytes" } },
    ),
    ["candidate", "source"],
  );
});

test("prompt discloses constrained task and independent checker without injecting an answer", () => {
  const prompt = taskPrompt(
    { prompt: "Frozen task", sourcePaths: ["source.js"], expectedFiles },
    { baselineTests: ["baseline.test.js"] },
  );
  assert.match(prompt, /Frozen task/u);
  assert.match(prompt, /do not claim that tests passed/u);
  assert.match(prompt, /implementation defect/u);
  assert.match(prompt, /at most 20 model turns/u);
});

test("workflow requires explicit dispatch or a branch-scoped paid-run marker, and always uploads", () => {
  const workflow = fs.readFileSync(
    new URL(
      "../../../.github/workflows/verify01-volcengine-task-diagnostic.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /^ {2}(pull_request|schedule|workflow_run):/mu);
  assert.match(workflow, /branches: \[feature\/cli-ide-gap-20261011\]/u);
  assert.match(
    workflow,
    /contains\(github\.event\.head_commit\.message, '\[volcengine-task-diagnostic\]'\)/u,
  );
  assert.match(workflow, /runs-on: ubuntu-24\.04/u);
  assert.match(workflow, /node-version: "22\.12\.0"/u);
  assert.match(workflow, /secrets\.CC_LLM_API_KEY/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(workflow, /if: always\(\)/u);
});
