import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  DEFAULT_NATIVE_BUDGETS,
  VOLCENGINE_BUDGET_BASELINE,
  nativeExecutionBudgets,
  loadVolcengineBudgetRetry,
} from "../scripts/verify01-native-execution-budgets.mjs";
import { nativeProviderCells } from "../scripts/verify01-native-round-matrix.mjs";
import {
  BROKER,
  diagnosticJsonUsage,
  createVolcengineDiagnosticBroker,
} from "../scripts/verify01-volcengine-diagnostic-broker.mjs";
import {
  nativeTaskPrompt,
  nativeCliAdapterSource,
} from "../scripts/verify01-native-task-campaign.mjs";
import { adapterArgv } from "../../jetbrains-plugin/scripts/verify01-native-task-adapter.mjs";
import {
  nativeProviderProfile,
  assertNativeProviderIdentity,
} from "../scripts/verify01-native-provider-profile.mjs";
import { assertFreshVolcengineBudgetRetry } from "../scripts/verify01-volcengine-fresh-round.mjs";

const plan = JSON.parse(
  fs.readFileSync(
    new URL(
      "../../../docs/research/cli/verify01-plan-2026-10-13-volcengine/plan.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
function fixture(t, outputTokens = 8192) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-native-budget-"));
  assert.ok(root.startsWith(path.resolve(os.tmpdir()) + path.sep));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rows = plan.samples.map((row) => ({
    sampleId: row.id,
    accepted: true,
    generationPassed: true,
  }));
  Object.assign(
    rows.find((row) => row.sampleId === "verify-06"),
    {
      accepted: false,
      generationPassed: false,
      modelFailure: "iteration-budget-exhausted",
    },
  );
  Object.assign(
    rows.find((row) => row.sampleId === "verify-07"),
    {
      accepted: false,
      generationPassed: false,
      modelError:
        "Independent change review requires at least two remaining model requests; only 1 remain.",
    },
  );
  Object.assign(
    rows.find((row) => row.sampleId === "verify-04"),
    {
      accepted: false,
      generationPassed: false,
      broker: { errorCode: "DIAGNOSTIC_OUTPUT_TRUNCATED" },
    },
  );
  const baseline = {
    runId: 41563424430,
    executionSource: "e7788a09316abb6f637932ae09254a441168742e",
    provider: "volcengine",
    model: BROKER.model,
    completeEvidence: true,
    samples: rows,
  };
  const bytes = Buffer.from(JSON.stringify(baseline));
  const file = path.join(root, VOLCENGINE_BUDGET_BASELINE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  const manifest = {
    volcengineBudgetRetry: {
      id: "volcengine-public139-budget40-20261103",
      baselineRunId: baseline.runId,
      baselineSource: baseline.executionSource,
      baselineResultsPath: VOLCENGINE_BUDGET_BASELINE,
      baselineResultsDigest:
        "sha256:" + createHash("sha256").update(bytes).digest("hex"),
      modelTurns: 40,
      physicalRequests: 48,
      outputTokens,
      reviewChanges: true,
      selectedSampleIds:
        outputTokens === 8192
          ? ["verify-06", "verify-07"]
          : ["verify-04", "verify-06", "verify-07"],
    },
  };
  return { root, manifest, baseline };
}

test("expanded budget selection binds the original results and excludes accepted and unrelated failures", (t) => {
  for (const outputTokens of [8192, 16384]) {
    const { root, manifest } = fixture(t, outputTokens);
    const selected = loadVolcengineBudgetRetry(manifest, {
      repositoryRoot: root,
      plan,
    });
    assert.equal(selected.budgets.modelTurns, 40);
    assert.equal(selected.budgets.physicalRequests, 48);
    assert.equal(
      selected.selectedSampleIds.length,
      outputTokens === 8192 ? 2 : 3,
    );
    const rows = [
      ["win32", "windows-latest"],
      ["linux", "ubuntu-24.04"],
      ["darwin", "macos-15"],
    ].flatMap(([platform, os]) =>
      ["cli", "vscode", "jetbrains"].map((entry) => ({
        group: `${platform}-${entry}`,
        os,
        entry,
      })),
    );
    const cells = nativeProviderCells(rows, plan, undefined, "volcengine", {
      isolateAllSamples: true,
      sampleIdsByGroup: selected.sampleIdsByGroup,
    });
    assert.deepEqual(
      cells.map((row) => row.sample_ids).sort(),
      selected.selectedSampleIds,
    );
    assert.ok(cells.every((row) => row.sample_count === 1));
    const extra = structuredClone(manifest);
    extra.volcengineBudgetRetry.selectedSampleIds.push("verify-01");
    assert.throws(() =>
      loadVolcengineBudgetRetry(extra, { repositoryRoot: root, plan }),
    );
    const wrong = structuredClone(manifest);
    wrong.volcengineBudgetRetry.baselineResultsDigest =
      "sha256:" + "0".repeat(64);
    assert.throws(() =>
      loadVolcengineBudgetRetry(wrong, { repositoryRoot: root, plan }),
    );
  }
  assert.equal(nativeExecutionBudgets(null), DEFAULT_NATIVE_BUDGETS);
  const { manifest } = fixture(t);
  assert.throws(() => nativeExecutionBudgets(manifest, "openai"));
  manifest.volcengineBudgetRetry.modelTurns = 41;
  assert.throws(() => nativeExecutionBudgets(manifest));
});

test("retry dispatch retains review, public package proof, and a source-bound failed-sample selection", (t) => {
  const { root, manifest } = fixture(t);
  const original = JSON.parse(
    fs.readFileSync(
      new URL(
        "../../../docs/research/cli/verify01-package-sets/2026-11-03-volcengine-139.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const declared = { ...original, ...manifest };
  delete declared.freshVolcengineRound;
  const proofBytes = fs.readFileSync(
    new URL("../../../" + original.publicGeneratorProof.path, import.meta.url),
  );
  const proofFile = path.join(root, original.publicGeneratorProof.path);
  fs.mkdirSync(path.dirname(proofFile), { recursive: true });
  fs.writeFileSync(proofFile, proofBytes);
  declared.publicGeneratorProof.digest =
    "sha256:" + createHash("sha256").update(proofBytes).digest("hex");
  const options = {
    provider: "volcengine",
    packageSet: "latest",
    packageBinding: {
      bytes: Buffer.from(JSON.stringify(declared)),
      versions: declared.versions,
    },
    hosts: "all",
    entries: "all",
    sampleIds: undefined,
    revisionBinding: null,
    runAttempt: 1,
    credentialPresent: true,
    repositoryRoot: root,
    reviewChanges: true,
  };
  assert.equal(
    assertFreshVolcengineBudgetRetry(options, plan).selectedSampleIds.length,
    2,
  );
  for (const changed of [
    { reviewChanges: false },
    { runAttempt: 2 },
    { credentialPresent: false },
    { sampleIds: ["verify-01"] },
  ]) {
    assert.throws(() =>
      assertFreshVolcengineBudgetRetry({ ...options, ...changed }, plan),
    );
  }
});

test("independent acceptance binds the expanded broker policy and rejects a substituted turn allowance", (t) => {
  const { manifest } = fixture(t, 16384);
  manifest.versions = {
    cli: "0.166.139",
    vscode: "0.37.175",
    jetbrains: "0.4.192",
    vscodeHost: "1.132.0",
    jetbrainsHost: "2025.2",
  };
  const hash = (value) =>
    "sha256:" + createHash("sha256").update(value).digest("hex");
  const bytes = Buffer.from(JSON.stringify(manifest));
  const packages = {
    bytes,
    versions: manifest.versions,
    packageSetDigest: hash(bytes),
  };
  const budgets = nativeExecutionBudgets(manifest);
  const profile = nativeProviderProfile("volcengine", { budgets });
  const sourceSha = "a".repeat(40);
  const project = {
    revisionBinding: null,
    projectCommit: plan.commitSha,
    planDigest: "sha256:" + "b".repeat(64),
  };
  const summary = {
    executionSourceCommit: sourceSha,
    cohortKind: "volcengine-native-diagnostic",
    projectCommit: project.projectCommit,
    planDigest: project.planDigest,
    versions: packages.versions,
    packageSetDigest: packages.packageSetDigest,
    executionBudgets: budgets,
    modelTransport: {
      provider: "volcengine",
      model: BROKER.model,
      endpoint: profile.policy.endpoint,
      policyDigest: hash(JSON.stringify(profile.policy)),
      defaultThinkingPreserved: false,
      formalSample: false,
    },
  };
  summary.executionIdentityDigest = hash(
    JSON.stringify({
      sourceSha,
      taskPlanDigest: summary.planDigest,
      versions: summary.versions,
      packageSetDigest: summary.packageSetDigest,
      modelTransport: summary.modelTransport,
    }),
  );
  assertNativeProviderIdentity(
    summary,
    "volcengine",
    sourceSha,
    packages,
    project,
  );
  assert.throws(() =>
    assertNativeProviderIdentity(
      { ...summary, executionBudgets: { ...budgets, modelTurns: 20 } },
      "volcengine",
      sourceSha,
      packages,
      project,
    ),
  );
  assert.throws(() =>
    assertNativeProviderIdentity(
      {
        ...summary,
        modelTransport: {
          ...summary.modelTransport,
          policyDigest: hash(JSON.stringify(BROKER)),
        },
      },
      "volcengine",
      sourceSha,
      packages,
      project,
    ),
  );
});

test("CLI and both IDE launch paths carry the explicitly expanded turn count while old defaults remain", (t) => {
  const { root } = fixture(t);
  const cli = path.join(root, "offline-cli.cjs");
  fs.writeFileSync(cli, "console.log(JSON.stringify(process.argv.slice(2)))");
  for (const [name, source, expected] of [
    ["vscode40", nativeCliAdapterSource(cli, { maxTurns: 40 }), "40"],
    ["jetbrains40", adapterArgv(cli, undefined, { maxTurns: 40 }), "40"],
    ["jetbrains20", adapterArgv(cli), "20"],
  ]) {
    const launcher = path.join(root, name + ".cjs");
    fs.writeFileSync(launcher, source);
    const result = spawnSync(
      process.execPath,
      [launcher, "agent", "--max-turns", "20"],
      { encoding: "utf8", windowsHide: true },
    );
    assert.equal(result.status, 0, result.stderr);
    const args = JSON.parse(result.stdout);
    assert.equal(args[args.lastIndexOf("--max-turns") + 1], expected);
    assert.ok(args.includes("--no-mcp"));
  }
  const task = {
    prompt: "offline",
    sourcePaths: [],
    expectedFiles: ["test.js"],
  };
  assert.match(
    nativeTaskPrompt(
      task,
      { baselineTests: [] },
      { id: "verify-06", kind: "task", stratum: "linux-jetbrains-volcengine" },
      { modelTurns: 40 },
    ),
    /You have 40 model turns/u,
  );
});

test("the expanded broker admits 48 bounded requests and validates increased output without changing the default cap", async (t) => {
  const { root, manifest } = fixture(t, 16384);
  const budgets = nativeExecutionBudgets(manifest);
  const response = JSON.stringify({
    id: "offline-budget-response",
    model: BROKER.model,
    service_tier: "default",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "offline" },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 9000,
      total_tokens: 9100,
      prompt_tokens_details: { cached_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 0 },
    },
  });
  assert.throws(() => diagnosticJsonUsage(response), /OUTPUT_LIMIT/u);
  assert.equal(
    diagnosticJsonUsage(response, { maximumAnswerTokens: 16384 }).usage
      .completion_tokens,
    9000,
  );
  const broker = await createVolcengineDiagnosticBroker({
    outputDir: path.join(root, "broker"),
    key: "offline-not-a-real-key",
    executionBudgets: budgets,
    allowedTaskIds: ["verify-06"],
    maximumRequestsPerTask: 48,
    allowTextOnlyRequests: true,
    requestImpl: async (body) => {
      assert.equal(body.max_tokens, 16384);
      return { status: 200, raw: Buffer.from(response) };
    },
  });
  try {
    broker.beginTask("verify-06");
    const reply = await fetch(broker.baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + broker.childKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: BROKER.model,
        messages: [{ role: "user", content: "offline" }],
        stream: false,
      }),
    });
    assert.equal(reply.status, 200);
    await reply.text();
    assert.equal(broker.taskStatus("verify-06").usageCompleteRequests, 1);
    assert.equal(BROKER.maximumAnswerTokens, 8192);
    await assert.rejects(
      createVolcengineDiagnosticBroker({
        outputDir: path.join(root, "default-too-large"),
        key: "offline",
        allowedTaskIds: ["verify-06"],
        maximumRequestsPerTask: 48,
      }),
      /TASK_POLICY/u,
    );
  } finally {
    await broker.close();
  }
});
