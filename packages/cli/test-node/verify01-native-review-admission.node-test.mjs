import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  readNativeReviewBundle,
  inspectNativeReviewAdmission,
  assertNativeReviewReady,
} from "../scripts/verify01-native-review-admission.mjs";
import { generateReviewPack } from "../scripts/verify01-review-pack.mjs";
import { evalDigest } from "../src/lib/eval/evidence.js";

const bundle = readNativeReviewBundle();
// Operator input fixture, not an attestation that this test runs on Windows 11.
const host = {
  platform: "win32",
  arch: "x64",
  node: "v22.12.0",
  osRelease: "10.0.26100",
};

test("native admission selects the 12 frozen Windows task samples without reallocating the population", () => {
  const report = inspectNativeReviewAdmission(bundle, { host });
  assert.deepEqual(
    report.tasks.map((row) => row.sampleId),
    [
      "verify-01",
      "verify-02",
      "verify-03",
      "verify-10",
      "verify-11",
      "verify-12",
      "verify-19",
      "verify-20",
      "verify-21",
      "verify-28",
      "verify-29",
      "verify-30",
    ],
  );
  assert.equal(report.plannedTasks, 36);
  assert.equal(report.selectedTasks, 12);
  assert.equal(report.readyTasks, 0);
  assert.equal(report.executionStatus, "NOT_RUN");
  assert.equal(report.observationsCreated, false);
  assert.ok(
    report.tasks.every((row) =>
      row.blockers.some(
        (item) => item.code === "TRUSTED_TOOLCHAIN_NOT_IMPLEMENTED",
      ),
    ),
  );
});

test("matching runtime never admits unimplemented toolchain or silently replaces the forks pool", () => {
  const forks = inspectNativeReviewAdmission(bundle, {
    host,
    sampleIds: ["verify-01"],
  });
  assert.equal(forks.requestedPool, "forks");
  assert.equal(forks.poolDiffersFromDockerPack, false);
  assert.deepEqual(
    forks.tasks[0].requiredCapabilities.map((row) => row.id),
    ["scratch-environment", "esm", "child-pipe-stdio", "child-fork-ipc"],
  );
  const threads = inspectNativeReviewAdmission(bundle, {
    host,
    sampleIds: ["verify-01"],
    pool: "threads",
  });
  assert.equal(threads.poolDiffersFromDockerPack, true);
  assert.deepEqual(
    threads.tasks[0].requiredCapabilities.map((row) => row.id),
    ["scratch-environment", "esm", "worker-threads"],
  );
  assert.equal(threads.fullReviewPackReady, false);
  assert.ok(
    !threads.tasks[0].blockers.some(
      (item) => item.code === "FROZEN_RUNTIME_MISMATCH",
    ),
  );
  assert.throws(
    () => inspectNativeReviewAdmission(bundle, { host, pool: "automatic" }),
    /explicit forks or threads/,
  );
});

test("Windows 10 and a newer Node retain the actual frozen target mismatch", () => {
  const report = inspectNativeReviewAdmission(bundle, {
    host: { ...host, node: "v22.22.2", osRelease: "10.0.19045" },
  });
  assert.ok(
    report.tasks.every((row) =>
      row.blockers.some((item) => item.code === "FROZEN_RUNTIME_MISMATCH"),
    ),
  );
  assert.equal(report.host.node, "v22.22.2");
  assert.equal(report.tasks[0].target.node, "v22.12.0");
});

test("foreign platforms and Linux-only journal baseline remain separate explicit blockers", () => {
  let reads = 0;
  const report = inspectNativeReviewAdmission(bundle, {
    host,
    sampleIds: ["verify-17"],
    readFrozenBlob(commit, file) {
      reads++;
      assert.equal(commit, bundle.catalog.projectCommit);
      assert.equal(
        file,
        "packages/cli/__tests__/unit/process-ownership-journal.test.js",
      );
      return Buffer.from(
        'describe.skipIf(process.platform !== "linux")("synthetic baseline",()=>{});',
      );
    },
  });
  assert.equal(reads, 1);
  assert.equal(report.tasks[0].stratum, "darwin-vscode-openai");
  assert.ok(
    report.tasks[0].blockers.some(
      (row) => row.code === "SAMPLE_PLATFORM_MISMATCH",
    ),
  );
  assert.ok(
    report.tasks[0].blockers.some(
      (row) => row.code === "BASELINE_PLATFORM_UNSUPPORTED",
    ),
  );
  assert.equal(report.tasks[0].platformBaseline.supportedPlatform, "linux");
  assert.throws(
    () =>
      inspectNativeReviewAdmission(bundle, {
        host,
        sampleIds: ["verify-17"],
        readFrozenBlob: () => Buffer.from("changed baseline"),
      }),
    /independent specification review/,
  );
});

test("incomplete capability reports remain incomplete despite a caller's supported declarations", () => {
  const bytes = Buffer.from(
    JSON.stringify({
      schema: "chainlesschain.windows-native-evaluator-capabilities/v1",
      formalSample: false,
      providerAssessed: false,
      fullReviewPackAssessed: false,
      diagnosticCompleted: false,
      platform: host.platform,
      architecture: host.arch,
      nodeVersion: host.node,
      osRelease: host.osRelease,
      validation: { capabilities: { esm: "supported" } },
    }),
  );
  const options = {
    host,
    capabilityBytes: bytes,
    capabilityDigest: evalDigest(bytes),
  };
  const report = inspectNativeReviewAdmission(bundle, options);
  assert.equal(report.capabilityCapture.status, "INCOMPLETE");
  assert.ok(
    report.tasks.every((row) =>
      row.requiredCapabilities.every(
        (capability) => capability.observed === "INCOMPLETE",
      ),
    ),
  );
  assert.throws(
    () =>
      inspectNativeReviewAdmission(bundle, {
        ...options,
        capabilityDigest: "sha256:" + "0".repeat(64),
      }),
    /byte binding/,
  );
  assert.throws(
    () =>
      inspectNativeReviewAdmission(bundle, {
        ...options,
        host: { ...host, node: "v22.22.2" },
      }),
    /different host/,
  );
});

test("input validation cannot substitute first-install samples, missing IDs, or a forged complete report", () => {
  for (const sampleIds of [
    [],
    ["verify-01", "verify-01"],
    ["unknown"],
    ["first-run-win32-cli"],
  ])
    assert.throws(() =>
      inspectNativeReviewAdmission(bundle, { host, sampleIds }),
    );
  const bytes = Buffer.from(
    JSON.stringify({
      schema: "chainlesschain.windows-native-evaluator-capabilities/v1",
      formalSample: false,
      providerAssessed: false,
      fullReviewPackAssessed: false,
      diagnosticCompleted: true,
      platform: host.platform,
      architecture: host.arch,
      nodeVersion: host.node,
      osRelease: host.osRelease,
    }),
  );
  assert.throws(
    () =>
      inspectNativeReviewAdmission(bundle, {
        host,
        capabilityBytes: bytes,
        capabilityDigest: evalDigest(bytes),
      }),
    /manifest|digest/,
  );
  assert.throws(
    () => assertNativeReviewReady(bundle, { host }),
    (error) =>
      error.code === "VERIFY01_NATIVE_REVIEW_NOT_READY" &&
      error.admission.fullReviewPackReady === false,
  );
});

test("explicit Windows generation fails before creating scripts and rejects Docker bindings", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-native-admission-test-"),
  );
  try {
    const outputDir = path.join(root, "uncreated");
    assert.throws(
      () =>
        generateReviewPack({
          backend: "windows-native",
          outputDir,
          nativeAdmission: { host },
        }),
      (error) => error.code === "VERIFY01_NATIVE_REVIEW_NOT_READY",
    );
    assert.equal(fs.existsSync(outputDir), false);
    assert.throws(
      () =>
        generateReviewPack({
          backend: "windows-native",
          outputDir,
          imageId: "sha256:" + "a".repeat(64),
        }),
      /cannot accept a Docker/,
    );
    assert.throws(
      () => generateReviewPack({ backend: "fallback", outputDir }),
      /unsupported review backend/,
    );
  } finally {
    assert.equal(fs.realpathSync.native(root), path.resolve(root));
    fs.rmSync(root, { recursive: true });
  }
});

test("real CLI exposes Windows admission without generating a Docker pack or starting a native task", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("../scripts/verify01-review-pack.mjs", import.meta.url),
      ),
      "--backend",
      "windows-native",
    ],
    { encoding: "utf8", timeout: 30000, windowsHide: true },
  );
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.backend, "windows-native");
  assert.equal(report.selectedTasks, 12);
  assert.equal(report.executionStatus, "NOT_RUN");
  assert.equal(report.providerAssessed, false);
});
