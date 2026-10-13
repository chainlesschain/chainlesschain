import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { inspectNativePreflight } from "../scripts/verify01-native-preflight.mjs";
import {
  readNativeReviewBundle,
  inspectNativeReviewAdmission,
} from "../scripts/verify01-native-review-admission.mjs";
import { parseReviewTests } from "../scripts/verify01-review-runtime.mjs";
import { VERIFY01_REVIEW_SPECS } from "../scripts/verify01-review-specs.mjs";
import { evalDigest } from "../src/lib/eval/evidence.js";
import { outcomeDigest } from "../src/lib/eval/outcomes.js";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const planDir = fileURLToPath(
  new URL(
    "../../../docs/research/cli/verify01-plan-2026-10-13-volcengine/",
    import.meta.url,
  ),
);
const bundle = readNativeReviewBundle(planDir);
const win = {
  platform: "win32",
  arch: "x64",
  node: "v22.12.0",
  osRelease: "10.0.26100",
};
const mac = {
  platform: "darwin",
  arch: "arm64",
  node: "v22.12.0",
  osRelease: "24.6.0",
};
const windowsIds = [1, 2, 3, 10, 11, 12, 19, 20, 21, 28, 29, 30].map(
  (n) => `verify-${String(n).padStart(2, "0")}`,
);
const macIds = [7, 8, 9, 16, 17, 18, 25, 26, 27, 34, 35, 36].map(
  (n) => `verify-${String(n).padStart(2, "0")}`,
);
const blobs = new Map();
function readFrozenBlob(commit, file) {
  assert.equal(commit, "b2aa3aba082873570e85dce39b00754e5504ff37");
  if (!blobs.has(file))
    blobs.set(
      file,
      execFileSync("git", ["-C", repository, "show", `${commit}:${file}`], {
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      }),
    );
  return Buffer.from(blobs.get(file));
}
const inspect = (options = {}) =>
  inspectNativePreflight(bundle, { host: win, readFrozenBlob, ...options });
const codes = (task) => task.blockers.map((blocker) => blocker.code);

test("actual Volcengine plan covers Windows12/macOS12 and leaves all first-runs unassessed", () => {
  const before = JSON.stringify(bundle);
  const report = inspect();
  assert.equal(report.schema, "chainlesschain.verify01-native-preflight/v1");
  assert.equal(report.plannedTasks, 36);
  assert.equal(report.selectedTasks, 24);
  assert.deepEqual(report.perPlatform, [
    { platform: "win32", selectedTasks: 12, readyTasks: 0 },
    { platform: "darwin", selectedTasks: 12, readyTasks: 0 },
  ]);
  for (const [platform, ids] of [
    ["win32", windowsIds],
    ["darwin", macIds],
  ]) {
    assert.deepEqual(
      report.tasks
        .filter((row) => row.target.platform === platform)
        .map((row) => row.sampleId),
      ids,
    );
    assert.deepEqual(
      inspect({ platforms: [platform] }).tasks.map((row) => row.sampleId),
      ids,
    );
  }
  assert.ok(
    report.tasks.every((row) => row.stratum === `${row.target.id}-volcengine`),
  );
  assert.equal(report.firstRuns.planned, 9);
  assert.equal(report.firstRuns.observations, 0);
  assert.equal(report.firstRuns.status, "NOT_ASSESSED");
  assert.equal(report.firstRuns.sampleIds.length, 9);
  assert.equal(report.readyTasks, 0);
  assert.equal(report.fullReviewPackReady, false);
  assert.equal(report.executionStatus, "NOT_RUN");
  assert.equal(report.formalSample, false);
  assert.equal(report.observationsCreated, false);
  assert.equal(report.providerAssessed, false);
  assert.equal(report.hostAttested, false);
  assert.equal(report.hostBasis, "operator-input");
  assert.equal(JSON.stringify(bundle), before);
  assert.ok(report.tasks.every((row) => row.observedTestCounts === null));
});

test("frozen source and current reviewer digests bind the report without reading working tree candidates", () => {
  const seen = new Set();
  const report = inspect({
    readFrozenBlob(commit, file) {
      assert.ok(!seen.has(file), "one immutable blob read per source path");
      seen.add(file);
      return readFrozenBlob(commit, file);
    },
  });
  assert.equal(report.projectCommit, bundle.catalog.projectCommit);
  assert.equal(report.planDigest, bundle.expectedPlanDigest);
  assert.equal(report.catalogDigest, outcomeDigest(bundle.catalog));
  assert.equal(report.specsDigest, outcomeDigest(VERIFY01_REVIEW_SPECS));
  assert.equal(report.frozenTestSupport.length, 3);
  for (const source of report.frozenSources)
    assert.equal(
      source.digest,
      evalDigest(readFrozenBlob(report.projectCommit, source.path)),
    );
  for (const source of report.currentSources)
    assert.equal(
      source.digest,
      evalDigest(
        fs.readFileSync(new URL(`../../../${source.path}`, import.meta.url)),
      ),
    );
  for (const row of report.tasks) {
    assert.equal(
      row.targetDigest,
      bundle.bindings.comparisons[row.stratum].declared.environmentDigest,
    );
    assert.ok(
      !row.baselines.some(
        (baseline) => baseline.status === "SOURCE_REVIEW_REQUIRED",
      ),
    );
  }
});

test("portability uses each target, independent of inspecting host", () => {
  for (const host of [
    win,
    mac,
    { ...win, platform: "linux", osRelease: "6.8.0" },
  ]) {
    const report = inspect({
      host,
      sampleIds: ["verify-16", "verify-17", "verify-21"],
    });
    const [settings, journal, memory] = report.tasks;
    assert.equal(
      settings.baselines[0].status,
      "KNOWN_GUARD_INACTIVE_ON_TARGET",
    );
    assert.equal(settings.baselines[0].guards[0].activeOnTarget, false);
    assert.equal(settings.baselines[0].guards[0].line, 286);
    assert.ok(!codes(settings).includes("BASELINE_PLATFORM_UNSUPPORTED"));
    assert.equal(
      journal.baselines[0].status,
      "ENTIRE_BASELINE_SKIPPED_ON_TARGET",
    );
    assert.equal(journal.baselines[0].guards[0].scope, "suite");
    assert.equal(journal.baselines[0].guards[0].line, 12);
    assert.equal(
      journal.implementationPortability.status,
      "UNSUPPORTED_ON_TARGET",
    );
    assert.equal(journal.implementationPortability.guard.line, 74);
    assert.ok(codes(journal).includes("BASELINE_PLATFORM_UNSUPPORTED"));
    assert.ok(codes(journal).includes("IMPLEMENTATION_PLATFORM_UNSUPPORTED"));
    assert.equal(memory.baselines[0].status, "KNOWN_PARTIAL_BASELINE_SKIP");
    assert.equal(memory.baselines[0].guards[0].scope, "test");
    assert.equal(memory.baselines[0].guards[0].line, 49);
    assert.ok(!codes(memory).includes("BASELINE_PLATFORM_UNSUPPORTED"));
  }
});

test("changed source bytes require review even when guard text remains unchanged", () => {
  for (const file of [
    "packages/cli/__tests__/unit/process-ownership-journal.test.js",
    "packages/cli/src/lib/process-execution-broker/process-ownership-journal.js",
    "packages/cli/__tests__/unit/segmented-memory-port.test.js",
    "packages/cli/__tests__/unit/model-capabilities.test.js",
  ]) {
    const report = inspect({
      sampleIds: ["verify-01", "verify-17", "verify-21"],
      readFrozenBlob(commit, source) {
        const bytes = readFrozenBlob(commit, source);
        return source === file
          ? Buffer.concat([bytes, Buffer.from("\n// changed\n")])
          : bytes;
      },
    });
    assert.ok(
      report.tasks.some((row) =>
        codes(row).includes("FROZEN_SOURCE_REVIEW_REQUIRED"),
      ),
      file,
    );
    assert.equal(report.fullReviewPackReady, false);
  }
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(1024 * 1024 + 1), "text"])
    assert.throws(
      () => inspect({ sampleIds: ["verify-01"], readFrozenBlob: () => bytes }),
      /bounded nonempty frozen source/,
    );
});

test("runtime mismatches remain separate from static portability and unconditional prerequisites", () => {
  for (const [host, id] of [
    [win, "verify-01"],
    [mac, "verify-16"],
  ]) {
    const matching = inspect({ host, sampleIds: [id] }).tasks[0];
    assert.ok(!codes(matching).includes("FROZEN_RUNTIME_MISMATCH"));
    assert.equal(matching.status, "NOT_READY");
    for (const code of [
      "TRUSTED_TOOLCHAIN_NOT_IMPLEMENTED",
      "LOCKED_TEST_SUPPORT_NOT_IMPLEMENTED",
      "PROTECTED_STORAGE_NOT_IMPLEMENTED",
      "FULL_NATIVE_EXECUTION_NOT_OBSERVED",
    ])
      assert.ok(codes(matching).includes(code));
    for (const change of [
      { node: "v22.22.2" },
      { arch: "wrong" },
      { platform: "linux" },
      { osRelease: "10.0.19045" },
      { osRelease: "25.0.0" },
    ])
      assert.ok(
        codes(
          inspect({ host: { ...host, ...change }, sampleIds: [id] }).tasks[0],
        ).includes("FROZEN_RUNTIME_MISMATCH"),
      );
  }
  for (const key of [
    "fullReviewPackReady",
    "capabilityBytes",
    "capabilities",
    "readyTasks",
    "receipts",
  ])
    assert.throws(
      () => inspect({ [key]: true }),
      /unsupported inspection option/,
    );
});

test("selection rejects first-runs, duplicate IDs, unsupported or foreign platforms", () => {
  for (const options of [
    { sampleIds: [] },
    { sampleIds: ["verify-01", "verify-01"] },
    { sampleIds: ["unknown"] },
    { sampleIds: ["first-run-win32-cli"] },
    { sampleIds: ["verify-04"] },
    { platforms: ["win32"], sampleIds: ["verify-17"] },
    { platforms: [] },
    { platforms: ["linux"] },
    { platforms: ["win32", "win32"] },
  ])
    assert.throws(() => inspect(options));
});

test("preflight shares authenticated target resolution including unselected matrix rows", () => {
  for (const change of ["target", "duplicate", "prefix", "unselected"]) {
    const altered = structuredClone(bundle);
    if (change === "target") altered.bindings.matrix[0].os = "Windows 10";
    if (change === "duplicate")
      altered.bindings.matrix.push({ ...altered.bindings.matrix[0] });
    if (change === "prefix")
      altered.bindings.matrix.unshift({
        ...altered.bindings.matrix[0],
        id: "win32",
      });
    if (change === "unselected")
      altered.bindings.matrix.find((row) => row.id === "darwin-cli").arch =
        "x64";
    assert.throws(
      () =>
        inspectNativePreflight(altered, {
          platforms: ["win32"],
          host: win,
          readFrozenBlob,
        }),
      /frozen runtime target/,
    );
  }
  const legacy = inspectNativeReviewAdmission(readNativeReviewBundle(), {
    host: win,
  });
  assert.equal(
    legacy.schema,
    "chainlesschain.verify01-native-review-admission/v1",
  );
  assert.equal(legacy.selectedTasks, 12);
  assert.equal(legacy.fullReviewPackReady, false);
});

test("static partial skips do not broaden the existing execution parser acceptance", () => {
  const run = (passed, pending) => ({
    status: 0,
    stdout: JSON.stringify({
      success: true,
      numTotalTests: passed + pending,
      numPassedTests: passed,
      numFailedTests: 0,
      numPendingTests: pending,
      numTodoTests: 0,
      testResults: [
        {
          assertionResults: [
            ...Array.from({ length: passed }, () => ({ status: "passed" })),
            ...Array.from({ length: pending }, () => ({ status: "pending" })),
          ],
        },
      ],
    }),
  });
  assert.equal(parseReviewTests(run(1, 1), { baseline: true }).passed, 1);
  assert.throws(
    () => parseReviewTests(run(0, 2), { baseline: true }),
    /regression failed/,
  );
  assert.throws(() => parseReviewTests(run(1, 1)), /skipped, pending/);
  assert.throws(
    () => parseReviewTests(run(1, 1), { mutant: true }),
    /skipped, pending/,
  );
});

test("CLI requires explicit plan and emits only NOT_READY read-only report", () => {
  const script = fileURLToPath(
    new URL("../scripts/verify01-native-preflight.mjs", import.meta.url),
  );
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
  const missing = run();
  assert.equal(missing.status, 1, missing.stderr);
  assert.match(missing.stderr, /explicit --plan-dir required/);
  const valid = run("--plan-dir", planDir);
  assert.equal(valid.status, 2, valid.stderr);
  const report = JSON.parse(valid.stdout);
  assert.equal(report.selectedTasks, 24);
  assert.equal(report.sourceReadBasis, "frozen-git-blobs");
  assert.equal(report.hostBasis, "local-runtime-observation");
  assert.equal(report.host.node, process.version);
  assert.equal(report.fullReviewPackReady, false);
  assert.equal(report.firstRuns.status, "NOT_ASSESSED");
});
