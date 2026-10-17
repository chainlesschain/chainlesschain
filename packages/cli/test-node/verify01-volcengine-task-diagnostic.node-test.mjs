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

test("iteration exhaustion preserves paid usage while remaining a failed trace", () => {
  const events = transcript({ cost: 0.036069908 });
  events[events.length - 1] = {
    ...events.at(-1),
    subtype: "error_max_turns",
    is_error: true,
    num_turns: 20,
    result: "Iteration budget exhausted",
  };
  const result = inspect(events);
  assert.equal(result.pass, false);
  assert.equal(result.terminal.terminalVerified, false);
  assert.equal(result.failureCategory, "iteration-budget-exhausted");
  assert.equal(result.modelUsageRecordCount, 1);
  assert.equal(result.estimatedCostUSD, 0.036069908);
  assert.equal(result.actualBilledCostUSD, null);
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

test("identifies pre-execution scope denials without admitting result-only traces", () => {
  const decision = {
    version: 1,
    id: "denied-write:perm:exact-file-mutation-scope",
    tool: "write_file",
    decision: "deny",
    via: "exact-file-mutation-scope",
    reason: "non-canonical-path",
  };
  const denied = {
    type: "tool_result",
    id: "denied-write",
    tool: "write_file",
    is_error: true,
    error: "absolute mutation path refused",
    result: { error: "absolute mutation path refused", policy: decision },
    permission_decision_id: decision.id,
    permission_decision: decision,
  };
  const inspectDenial = (denial) => {
    const events = transcript();
    events.splice(2, 0, denial);
    return inspect(events);
  };
  const legacy = inspectDenial(denied);
  assert.equal(legacy.pass, false);
  assert.equal(legacy.settled, false);
  assert.equal(legacy.failureCategory, "tool-settlement-unverified");
  assert.deepEqual(legacy.preExecutionDenials, [
    {
      id: "denied-write",
      tool: "write_file",
      reason: "non-canonical-path",
      executionStarted: null,
    },
  ]);
  const explicit = inspectDenial({ ...denied, execution_started: false });
  assert.equal(explicit.pass, false);
  assert.equal(explicit.delivered, true); // Only the later successful write counts.
  assert.equal(explicit.preExecutionDenials[0].executionStarted, false);
  assert.deepEqual(
    inspectDenial({ ...denied, permission_decision_id: "unrelated" })
      .preExecutionDenials,
    [],
  );
  assert.deepEqual(
    inspectDenial({ ...denied, is_error: false }).preExecutionDenials,
    [],
  );
  assert.deepEqual(
    inspectDenial({ ...denied, id: "write-1" }).preExecutionDenials,
    [],
  );
  assert.deepEqual(
    inspectDenial({ ...denied, execution_started: true }).preExecutionDenials,
    [],
  );
});

test("partial usage survives timeout or provider failure without a complete-cost claim", () => {
  const partial = transcript().slice(0, -1);
  partial.push({
    type: "token_usage",
    provider: DIAGNOSTIC.provider,
    model: DIAGNOSTIC.model,
    usage: { input_tokens: 7, output_tokens: 2, cache_read_input_tokens: 5 },
  });
  const timeout = inspect(partial);
  assert.equal(timeout.pass, false);
  assert.equal(timeout.usageComplete, false);
  assert.deepEqual(timeout.observedUsage, {
    input_tokens: 19,
    output_tokens: 6,
    cache_read_input_tokens: 5,
  });
  assert.equal(timeout.failureCategory, "missing-terminal");
  assert.equal(timeout.estimatedCostUSD, null);
  assert.equal(timeout.actualBilledCostUSD, null);
  const failed = inspect([
    transcript()[0],
    { type: "result", subtype: "error", is_error: true, error: "fetch failed" },
  ]);
  assert.deepEqual(failed.observedUsage, {});
  assert.equal(failed.failureCategory, "provider-fetch-failed");
  assert.equal(failed.estimatedCostUSD, null);
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
  assert.match(prompt, /repository-relative paths for every mutation/u);
  assert.match(prompt, /at most 14 model turns/u);
  const retryPrompt = taskPrompt(
    {
      taskId: "verify-04",
      prompt: "Frozen task",
      sourcePaths: ["source.js"],
      expectedFiles,
    },
    { baselineTests: ["baseline.test.js"] },
  );
  assert.match(retryPrompt, /Historical diagnostic feedback/u);
  assert.match(retryPrompt, /not a first-attempt or formal sample/u);
  assert.match(retryPrompt, /requestInputTokens/u);
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
  assert.match(workflow, /feature\/cli-ide-gap-20261011/u);
  assert.match(workflow, /feature\/verify01-native-long-evidence-20261013/u);
  assert.match(
    workflow,
    /feature\/verify01-volcengine-v3-acceptance-20261013/u,
  );
  assert.doesNotMatch(workflow, /branches: \["?\*\*/u);
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
