import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  IDE_ROADMAP_SAFETY_KILL_POINTS,
  runSafetyGate,
  verifyEvidenceSet,
} from "../../scripts/ide-roadmap-safety-gate.mjs";

const RELEASE_COMMIT = "a".repeat(40);
let tempDir;

function sha256Json(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function expandToFormalEvidence(source, operatingSystem) {
  const value = structuredClone(source);
  value.releaseCommit = RELEASE_COMMIT;
  value.operatingSystem = operatingSystem;
  value.runner.operatingSystem = operatingSystem;
  value.persistence.requiredRunsPerKillPoint = 100;
  value.persistence.samples = IDE_ROADMAP_SAFETY_KILL_POINTS.flatMap((point) =>
    Array.from({ length: 100 }, (_, iteration) => ({
      id: `${operatingSystem}-${point}-${iteration}`,
      point,
      iteration,
      pass: true,
    })),
  );
  value.persistence.sampleCount = value.persistence.samples.length;
  value.persistence.passCounts = Object.fromEntries(
    IDE_ROADMAP_SAFETY_KILL_POINTS.map((point) => [point, 100]),
  );
  value.persistence.failures = [];
  value.persistence.stateConsistencyRate = 1;
  value.persistence.capabilityWideningCount = 0;
  value.persistence.wrongApprovalBindingCount = 0;

  value.semanticHandoff.requiredRunsPerTransport = 100;
  value.semanticHandoff.samples = [
    "local-provider",
    "offline-fallback",
  ].flatMap((transport) =>
    Array.from({ length: 100 }, (_, iteration) => ({
      id: `${operatingSystem}-${transport}-${iteration}`,
      transport,
      iteration,
      pass: true,
    })),
  );
  value.semanticHandoff.sampleCount = value.semanticHandoff.samples.length;
  value.semanticHandoff.frozenFactRetentionRate = 1;
  value.semanticHandoff.silentLossCount = 0;
  value.semanticHandoff.degradedFailuresVisible = true;
  value.semanticHandoff.subagentsUseSameSchema = true;
  value.artifactDigests.persistenceSamples = `sha256:${sha256Json(value.persistence.samples)}`;
  value.artifactDigests.semanticSamples = `sha256:${sha256Json(value.semanticHandoff.samples)}`;
  value.result = "passed";
  delete value.validationError;
  return value;
}

describe("IDE roadmap formal safety gate", () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-safety-gate-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("performs a real killed-process recovery sample for every declared point", async () => {
    const output = path.join(tempDir, "mini-evidence.json");
    const evidence = await runSafetyGate({
      runs: 1,
      releaseCommit: RELEASE_COMMIT,
      verifyGitHead: false,
      output,
    });

    expect(evidence.result).toBe("passed");
    expect(evidence.persistence.sampleCount).toBe(
      IDE_ROADMAP_SAFETY_KILL_POINTS.length,
    );
    expect(evidence.persistence.stateConsistencyRate).toBe(1);
    expect(evidence.persistence.capabilityWideningCount).toBe(0);
    expect(evidence.persistence.wrongApprovalBindingCount).toBe(0);
    expect(evidence.persistence.samples.every((sample) => sample.pass)).toBe(
      true,
    );
    expect(evidence.semanticHandoff).toMatchObject({
      sampleCount: 2,
      frozenFactRetentionRate: 1,
      silentLossCount: 0,
      degradedFailuresVisible: true,
      subagentsUseSameSchema: true,
    });
    expect(fs.existsSync(output)).toBe(true);
  }, 120_000);

  it("accepts only a digest-bound 100-run Linux/macOS/Windows evidence set", async () => {
    const seed = await runSafetyGate({
      runs: 1,
      releaseCommit: RELEASE_COMMIT,
      verifyGitHead: false,
    });
    const evidenceDir = path.join(tempDir, "evidence");
    fs.mkdirSync(evidenceDir);
    for (const operatingSystem of ["linux", "macos", "windows"]) {
      writeJson(
        path.join(evidenceDir, `${operatingSystem}.json`),
        expandToFormalEvidence(seed, operatingSystem),
      );
    }
    const output = path.join(tempDir, "aggregate.json");
    const aggregate = verifyEvidenceSet({
      evidenceDir,
      releaseCommit: RELEASE_COMMIT,
      output,
    });
    expect(aggregate).toMatchObject({
      result: "passed",
      releaseCommit: RELEASE_COMMIT,
      operatingSystems: ["linux", "macos", "windows"],
      processKillSamples: 2_100,
      semanticSamples: 600,
      stateConsistencyRate: 1,
      frozenFactRetentionRate: 1,
    });

    const tampered = JSON.parse(
      fs.readFileSync(path.join(evidenceDir, "windows.json"), "utf8"),
    );
    tampered.persistence.samples[0].pass = false;
    writeJson(path.join(evidenceDir, "windows.json"), tampered);
    expect(() =>
      verifyEvidenceSet({ evidenceDir, releaseCommit: RELEASE_COMMIT }),
    ).toThrow(/sample evidence|sample digest/);
  }, 120_000);

  it("pins the workflow to exact commits and the formal 100-run contract", () => {
    const workflow = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../../.github/workflows/ide-roadmap-safety.yml",
      ),
      "utf8",
    );
    expect(workflow).toContain('IDE_ROADMAP_SAFETY_RUNS: "100"');
    expect(workflow).toContain("ref: ${{ env.IDE_ROADMAP_SAFETY_COMMIT }}");
    expect(workflow).toContain("--verify-evidence-dir");
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain("if-no-files-found: error");
  });
});
