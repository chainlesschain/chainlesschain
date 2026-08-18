import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGGREGATE_SCHEMA,
  EVIDENCE_SCHEMA,
  REQUIRED_TARGETS,
  compareVersions,
  parseArgs,
  validateEvidence,
  verifyEvidenceDirectory,
} from "../../scripts/native-signed-install-gate.mjs";

const identity = Object.freeze({
  repository: "chainlesschain/chainlesschain",
  releaseCommit: "a".repeat(40),
  currentTag: "cli-v1.2.3",
  previousTag: "cli-v1.2.2",
  expectedVersion: "1.2.3",
});
const previousSha256 = "1".repeat(64);
const currentSha256 = "2".repeat(64);
const roots = [];

function execution(overrides = {}) {
  const runId = String(overrides.runId || "123456");
  const runAttempt = Number(overrides.runAttempt || 2);
  return {
    provider: "github-actions",
    repository: identity.repository,
    workflow: "CLI Native Release",
    eventName: "push",
    runId,
    runAttempt,
    runUrl: `https://github.com/${identity.repository}/actions/runs/${runId}/attempts/${runAttempt}`,
    ...overrides,
  };
}

function evidence(targetName, overrides = {}) {
  const target = REQUIRED_TARGETS[targetName];
  const signature = { kind: target.signature, verified: true };
  const value = {
    schema: EVIDENCE_SCHEMA,
    status: "passed",
    ...identity,
    target: targetName,
    runner: {
      platform: target.platform,
      architecture: target.arch,
      node: "v22.14.0",
    },
    execution: execution(),
    startedAt: "2026-08-18T00:00:00.000Z",
    completedAt: "2026-08-18T00:10:00.000Z",
    previousVersion: "1.2.2",
    currentBaseUrl:
      "https://github.com/chainlesschain/chainlesschain/releases/download/cli-v1.2.3",
    previousBaseUrl:
      "https://github.com/chainlesschain/chainlesschain/releases/download/cli-v1.2.2",
    freshInstall: {
      passed: true,
      version: "1.2.3",
      sha256: currentSha256,
      signature,
    },
    upgrade: {
      passed: true,
      fromVersion: "1.2.2",
      toVersion: "1.2.3",
      previousSha256,
      currentSha256,
      backupSha256: previousSha256,
      signature,
    },
    rollback: {
      passed: true,
      crashPhase: "target-committed",
      restoredVersion: "1.2.2",
      restoredSha256: previousSha256,
      journalRetired: true,
      signature,
    },
  };
  return { ...value, ...overrides };
}

function evidenceDirectory(overrides = new Map()) {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "cc-native-install-gate-test-"),
  );
  roots.push(root);
  for (const target of Object.keys(REQUIRED_TARGETS)) {
    const directory = path.join(root, target);
    mkdirSync(directory);
    writeFileSync(
      path.join(directory, "evidence.json"),
      `${JSON.stringify(overrides.get(target) || evidence(target))}\n`,
      "utf8",
    );
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("native signed install release gate", () => {
  it("compares strict stable versions and rejects a non-older baseline tag", () => {
    expect(compareVersions("1.2.2", "1.2.3")).toBe(-1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    expect(() =>
      validateEvidence(evidence("node22-linux-x64"), {
        ...identity,
        previousTag: identity.currentTag,
      }),
    ).toThrow(/must differ/u);
  });

  it("parses a single explicit argument value and rejects duplicates", () => {
    expect(
      parseArgs(["--target", "node22-linux-x64", "--output", "out.json"]),
    ).toEqual({
      target: "node22-linux-x64",
      output: "out.json",
    });
    expect(() =>
      parseArgs([
        "--target",
        "node22-linux-x64",
        "--target",
        "node22-linux-arm64",
      ]),
    ).toThrow(/Duplicate argument/u);
  });

  it("accepts exact signed install, upgrade, and rollback evidence", () => {
    expect(validateEvidence(evidence("node22-macos-arm64"), identity)).toBe(
      true,
    );
  });

  it("binds fresh and upgraded bytes to one exact candidate", () => {
    const value = evidence("node22-linux-x64");
    value.freshInstall = {
      ...value.freshInstall,
      sha256: "3".repeat(64),
    };
    expect(() => validateEvidence(value, identity)).toThrow(
      /transaction evidence is invalid/u,
    );
  });

  it("rejects extra signature claims and a forged workflow identity", () => {
    const signatureValue = evidence("node22-win-x64");
    signatureValue.freshInstall = {
      ...signatureValue.freshInstall,
      signature: {
        ...signatureValue.freshInstall.signature,
        timestamped: true,
      },
    };
    expect(() => validateEvidence(signatureValue, identity)).toThrow(
      /transaction evidence is invalid/u,
    );

    const workflowValue = evidence("node22-win-x64", {
      execution: execution({ workflow: "Untrusted Workflow" }),
    });
    expect(() => validateEvidence(workflowValue, identity)).toThrow(
      /GitHub execution identity is invalid/u,
    );
  });

  it("aggregates exactly one trusted six-target workflow attempt", () => {
    const root = evidenceDirectory();
    const outputRoot = mkdtempSync(
      path.join(os.tmpdir(), "cc-native-install-output-"),
    );
    roots.push(outputRoot);
    const output = path.join(outputRoot, "aggregate.json");
    const result = verifyEvidenceDirectory({
      ...identity,
      verifyEvidenceDir: root,
      output,
    });

    expect(result).toMatchObject({
      schema: AGGREGATE_SCHEMA,
      status: "passed",
      totals: {
        targets: 6,
        signedFreshInstalls: 6,
        signedUpgrades: 6,
        crashRollbacks: 6,
      },
    });
    expect(result.targets.map(({ target }) => target)).toEqual(
      Object.keys(REQUIRED_TARGETS).sort(),
    );
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(result);
  });

  it("rejects a six-target matrix mixed across workflow attempts", () => {
    const changedTarget = "node22-macos-x64";
    const mixed = evidence(changedTarget, {
      execution: execution({ runId: "654321" }),
    });
    const root = evidenceDirectory(new Map([[changedTarget, mixed]]));
    const output = path.join(root, "..", `native-install-${Date.now()}.json`);
    roots.push(output);

    expect(() =>
      verifyEvidenceDirectory({
        ...identity,
        verifyEvidenceDir: root,
        output,
      }),
    ).toThrow(/one workflow attempt/u);
    roots.pop();
  });
});
