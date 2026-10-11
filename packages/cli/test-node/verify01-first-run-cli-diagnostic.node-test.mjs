import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runCaptured,
  createStageLedger,
  costAccounting,
  agentArguments,
  assessArtifact,
  runFirstRunDiagnostic,
} from "../scripts/verify01-first-run-cli-diagnostic.mjs";
import { modelEnvironment } from "../scripts/verify01-volcengine-task-diagnostic.mjs";
import { PRICING_SEMANTIC_MUTANTS } from "../scripts/verify01-review-pricing-diagnostic.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
function temporary(t) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-first-run-offline-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function options(root, extra = {}) {
  return {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    },
    deadline: Date.now() + 10000,
    outputPrefix: path.join(root, "child"),
    ...extra,
  };
}

test("live diagnostic rejects missing confirmation before creating artifacts or launching a child", async (t) => {
  const root = temporary(t);
  const outputDir = path.join(root, "must-not-exist");
  await assert.rejects(
    runFirstRunDiagnostic({ outputDir, key: "fixture-only" }),
    /confirm-live/u,
  );
  assert.equal(fs.existsSync(outputDir), false);
});

test("keyless preparation builds the actual frozen review pack without model calls", async (t) => {
  const root = temporary(t);
  const pack = path.join(root, "pack");
  const report = path.join(root, "prepared.json");
  const result = await runCaptured(
    process.execPath,
    [
      path.join(
        repository,
        "packages/cli/scripts/verify01-first-run-cli-diagnostic.mjs",
      ),
      "--checker-mode",
      "prepare",
      "--pack-root",
      pack,
      "--image-id",
      "sha256:" + "a".repeat(64),
      "--report",
      report,
    ],
    options(root, { deadline: Date.now() + 30000 }),
  );
  assert.equal(result.ok, true, result.stderr);
  assert.ok(fs.existsSync(report));
  const spec = JSON.parse(
    fs
      .readFileSync(path.join(pack, "verify-04-check.mjs"), "utf8")
      .match(/\nconst spec = (.+);\nconst receipt =/u)[1],
  );
  assert.equal(spec.taskId, "verify-04");
  assert.deepEqual(spec.expectedFiles, [
    "packages/cli/__tests__/verify-04.test.js",
  ]);
  assert.ok(spec.mutants.length > 0);
  const review = JSON.parse(
    fs.readFileSync(path.join(pack, "review.json"), "utf8"),
  );
  assert.equal(
    review.projectCommit,
    "b2aa3aba082873570e85dce39b00754e5504ff37",
  );
});

test("process evidence redacts split credentials from both streams", async (t) => {
  const root = temporary(t);
  const secret = "test-secret-PRIVATE-value";
  const result = await runCaptured(
    process.execPath,
    [
      "-e",
      "const k=process.env.VOLCENGINE_API_KEY;process.stdout.write(k.slice(0,7));setTimeout(()=>{process.stdout.write(k.slice(7));process.stderr.write(JSON.stringify(k));},20)",
    ],
    options(root, {
      env: { ...options(root).env, VOLCENGINE_API_KEY: secret },
      secret,
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.stdout, "[redacted]");
  for (const file of fs.readdirSync(root))
    assert.ok(!fs.readFileSync(path.join(root, file), "utf8").includes(secret));
});

test("keyless child does not inherit the parent provider environment", async (t) => {
  const root = temporary(t);
  const previous = process.env.VOLCENGINE_API_KEY;
  process.env.VOLCENGINE_API_KEY = "must-not-inherit";
  try {
    const result = await runCaptured(
      process.execPath,
      [
        "-e",
        "console.log(JSON.stringify({key:process.env.VOLCENGINE_API_KEY??null,hook:process.env.NODE_OPTIONS??null}))",
      ],
      options(root),
    );
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(result.stdout), { key: null, hook: null });
  } finally {
    if (previous === undefined) delete process.env.VOLCENGINE_API_KEY;
    else process.env.VOLCENGINE_API_KEY = previous;
  }
});

test("timeout and output limit preserve failed execution receipts", async (t) => {
  const root = temporary(t);
  const timed = await runCaptured(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    options(root, { deadline: Date.now() + 150 }),
  );
  assert.equal(timed.ok, false);
  assert.equal(timed.timedOut, true);
  const limited = await runCaptured(
    process.execPath,
    ["-e", "process.stdout.write('x'.repeat(20000))"],
    options(root, { outputPrefix: path.join(root, "limit"), maxBytes: 512 }),
  );
  assert.equal(limited.ok, false);
  assert.equal(limited.outputLimit, true);
  assert.ok(fs.statSync(path.join(root, "limit.stdout.log")).size <= 512);
});

test("cancellation stops running children and refuses later launches", async (t) => {
  const root = temporary(t);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 100);
  const result = await runCaptured(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    options(root, { signal: controller.signal }),
  );
  clearTimeout(timer);
  assert.equal(result.aborted, true);
  assert.equal(result.ok, false);
  await assert.rejects(
    runCaptured(
      process.execPath,
      ["-e", "process.exit(0)"],
      options(root, {
        signal: controller.signal,
        outputPrefix: path.join(root, "forbidden"),
      }),
    ),
    /abort/iu,
  );
  assert.equal(fs.existsSync(path.join(root, "forbidden.process.json")), false);
});

test("stage ledger preserves failed attempts and skips later stages without inventing execution", (t) => {
  const root = temporary(t);
  const ledger = createStageLedger(root);
  ledger.record("install", { executed: true, passed: true });
  ledger.record("configure", {
    executed: true,
    passed: false,
    error: "bad config",
  });
  ledger.skipRemaining("configure failed");
  assert.deepEqual(
    ledger.stages.map(({ executed }) => executed),
    [true, true, false, false, false],
  );
  assert.equal(ledger.stages.length, 5);
  assert.throws(() => ledger.record("install", {}), /exactly once/u);
  for (const row of ledger.stages)
    assert.match(row.receipt.digest, /^sha256:[a-f0-9]{64}$/u);
});

test("artifact acceptance requires the tool prerequisite and all four distinct semantic kills", () => {
  const semantic = PRICING_SEMANTIC_MUTANTS.map((mutant) => ({
    mutant: mutant.name,
    outcome: "killed",
  }));
  const frozen = { pass: true, sourceRestored: true };
  assert.equal(
    assessArtifact({ toolPassed: true, frozen, semantic }).passed,
    true,
  );
  const failedTool = assessArtifact({ toolPassed: false, frozen, semantic });
  assert.equal(failedTool.passed, false);
  assert.equal(failedTool.checkerPassed, true);
  for (const outcome of ["survived", "not-established", "not-run"]) {
    assert.equal(
      assessArtifact({
        toolPassed: true,
        frozen,
        semantic: [{ ...semantic[0], outcome }, ...semantic.slice(1)],
      }).passed,
      false,
    );
  }
  assert.equal(
    assessArtifact({
      toolPassed: true,
      frozen,
      semantic: [semantic[0], semantic[0], semantic[0], semantic[0]],
    }).passed,
    false,
  );
  assert.equal(
    assessArtifact({
      toolPassed: true,
      frozen: { pass: true, sourceRestored: false },
      semantic,
    }).passed,
    false,
  );
});

test("tool estimate never substitutes for unknown authentication or journey cost", () => {
  for (const value of [null, 0, 0.12]) {
    const cost = costAccounting(value);
    assert.equal(cost.toolEstimatedCostUSD, value);
    assert.equal(cost.authenticationEstimatedCostUSD, null);
    assert.equal(cost.totalJourneyEstimatedCostUSD, null);
    assert.equal(cost.billingVerified, false);
    assert.equal(cost.budgetVerified, false);
    assert.equal(cost.hardQuotaVerified, false);
  }
});

test("agent receives exactly the frozen verify-04 prompt and fixed file-only tool surface", () => {
  const catalog = JSON.parse(
    fs.readFileSync(
      path.join(
        repository,
        "docs/research/cli/verify01-plan-2026-10-04/tasks.json",
      ),
      "utf8",
    ),
  );
  const task = catalog.tasks.find((row) => row.id === "verify-04");
  const args = agentArguments("cli.js", task);
  assert.equal(args[args.indexOf("-p") + 1], task.prompt);
  assert.equal(
    args[args.indexOf("--model") + 1],
    "deepseek-v4-flash-ga-260731",
  );
  assert.equal(args[args.indexOf("--max-turns") + 1], "20");
  assert.equal(args[args.indexOf("--max-budget-usd") + 1], "0.25");
  assert.equal(
    args[args.indexOf("--allowed-tools") + 1],
    "read_file,search_files,list_dir,write_file,edit_file,edit_file_hashed",
  );
  const env = modelEnvironment({
    root: "/tmp/first-run",
    profile: "/tmp/first-run/profile",
    expectedFiles: task.expectedFiles,
    key: "fixture",
    input: {
      PATH: "/bin",
      OPENAI_API_KEY: "excluded",
      NODE_OPTIONS: "excluded",
    },
  });
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.CC_MAX_RETRIES, "0");
  assert.equal(env.CHAINLESSCHAIN_HOME, "/tmp/first-run/profile");
});
