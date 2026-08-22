import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_MAP_PATH,
  FRAGMENT_SCHEMA,
  REQUIRED_DELTA_IDS,
  produceEvidence,
  validateSecurityMap,
  verifyEvidenceSet,
} from "../../scripts/verify-claude-security-map.mjs";

const RELEASE_COMMIT = "a".repeat(40);
const roots = [];

function tempDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-security-map-"));
  roots.push(directory);
  return directory;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function passingReport(filePath, { failedTestId = null } = {}) {
  const map = JSON.parse(fs.readFileSync(DEFAULT_MAP_PATH, "utf8"));
  const byProducer = new Map();
  for (const row of map.rows) {
    if (!byProducer.has(row.producer.path))
      byProducer.set(row.producer.path, new Set());
    byProducer.get(row.producer.path).add(row.testId);
  }
  const assertions = [...byProducer.values()].flatMap((ids) => [...ids]);
  const failed = failedTestId ? 1 : 0;
  const report = {
    success: !failedTestId,
    numPassedTests: assertions.length - failed,
    numFailedTests: failed,
    testResults: [...byProducer].map(([producer, ids]) => ({
      name: path.resolve(path.dirname(DEFAULT_MAP_PATH), "..", "..", producer),
      status: [...ids].includes(failedTestId) ? "failed" : "passed",
      assertionResults: [...ids].map((title) => ({
        title,
        status: title === failedTestId ? "failed" : "passed",
        duration: 1,
      })),
    })),
  };
  writeJson(filePath, report);
  return report;
}

function actionsSource(platform, workflow = "ide-roadmap-safety.yml") {
  return {
    workflowId: `owner/repo/.github/workflows/${workflow}@refs/heads/main`,
    runId: "123456",
    jobId: `security_${platform}`,
    artifactName: `claude-security-map-${platform}`,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Claude Code 2.1.221-2.1.238 security map", () => {
  it("verifies every 2.1.221-2.1.238 security delta with a digest-bound producer", () => {
    const validated = validateSecurityMap();
    expect(validated.map.rows).toHaveLength(REQUIRED_DELTA_IDS.length);
    expect(new Set(validated.map.rows.map((row) => row.id)).size).toBe(
      REQUIRED_DELTA_IDS.length,
    );
    expect(
      validated.map.rows.every((row) =>
        row.producer.sha256.startsWith("sha256:"),
      ),
    ).toBe(true);
  });

  it("keeps reverted Cygwin symlink and input redirection changes out of parity success", () => {
    const rows = validateSecurityMap().map.rows.filter(
      (row) =>
        row.id.includes("cygwin-symlink") ||
        row.id.includes("input-redirection"),
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        disposition: "upstream-reverted",
        revertedBy: "2.1.233",
        paritySuccess: false,
      });
    }
  });

  it("audits every non-applicable product boundary without claiming parity", () => {
    const rows = validateSecurityMap().map.rows.filter(
      (row) => row.disposition === "not-applicable+reason",
    );
    expect(rows.map((row) => row.id).sort()).toEqual([
      "cc-2.1.223-workflow-dynamic-import-bash",
      "cc-2.1.227-allowed-non-write-users",
      "cc-2.1.228-remote-resume-history-isolation",
      "cc-2.1.229-self-hosted-server-hooks",
    ]);
    for (const row of rows) {
      expect(row.reason.length).toBeGreaterThanOrEqual(24);
      expect(row.productBoundary.length).toBeGreaterThanOrEqual(12);
      expect(row.paritySuccess).toBeUndefined();
    }
  });

  it("rejects missing non-applicability reasons and stale producer digests", () => {
    const directory = tempDirectory();
    const map = structuredClone(validateSecurityMap().map);
    const row = map.rows.find(
      (candidate) => candidate.disposition === "not-applicable+reason",
    );
    delete row.reason;
    const missingReason = path.join(directory, "missing-reason.json");
    writeJson(missingReason, map);
    expect(() => validateSecurityMap(missingReason)).toThrow(/reason/);

    row.reason = "This is a complete and auditable non-applicability reason.";
    row.producer.sha256 = `sha256:${"0".repeat(64)}`;
    const staleDigest = path.join(directory, "stale-digest.json");
    writeJson(staleDigest, map);
    expect(() => validateSecurityMap(staleDigest)).toThrow(/producer digest/);
  });

  it("aggregates exact-head canonical required fragments from all operating systems", () => {
    const directory = tempDirectory();
    for (const [platform, osName] of [
      ["linux", "linux"],
      ["darwin", "macos"],
      ["win32", "windows"],
    ]) {
      const cell = path.join(directory, osName);
      const reportPath = path.join(
        cell,
        `claude-security-map-tests-${osName}.json`,
      );
      passingReport(reportPath);
      const evidence = produceEvidence({
        releaseCommit: RELEASE_COMMIT,
        platform,
        testReport: reportPath,
        disposition: "required",
        source: actionsSource(osName),
        verifyGitHead: false,
      });
      expect(evidence.schema).toBe(FRAGMENT_SCHEMA);
      expect(evidence.outcome).toBe("passed");
      writeJson(path.join(cell, `fragment-${osName}.json`), evidence);
    }
    const unrelated = {
      ...JSON.parse(
        fs.readFileSync(path.join(directory, "linux", "fragment-linux.json")),
      ),
      commitmentId: "RC-DEFAULT",
    };
    writeJson(
      path.join(directory, "linux", "rc-default-fragment.json"),
      unrelated,
    );
    const aggregate = verifyEvidenceSet({
      evidenceDir: directory,
      releaseCommit: RELEASE_COMMIT,
      verifyGitHead: false,
    });
    expect(aggregate).toMatchObject({
      commitmentId: "SEC-DELTA",
      headSha: RELEASE_COMMIT,
      requiredOperatingSystems: ["linux", "macos", "windows"],
      requiredFragmentCount: 3,
      result: "passed",
    });

    fs.rmSync(path.join(directory, "macos", "fragment-macos.json"));
    expect(() =>
      verifyEvidenceSet({
        evidenceDir: directory,
        releaseCommit: RELEASE_COMMIT,
        verifyGitHead: false,
      }),
    ).toThrow();
  });

  it("writes a failed fragment and fails closed when a mapped test did not pass", () => {
    const directory = tempDirectory();
    const reportPath = path.join(directory, "failed-report.json");
    const failedTestId = validateSecurityMap().map.rows[0].testId;
    passingReport(reportPath, { failedTestId });
    const output = path.join(directory, "failed-fragment.json");
    expect(() =>
      produceEvidence({
        releaseCommit: RELEASE_COMMIT,
        platform: "linux",
        testReport: reportPath,
        output,
        disposition: "required",
        source: actionsSource("linux"),
        verifyGitHead: false,
      }),
    ).toThrow(/did not pass/);
    expect(JSON.parse(fs.readFileSync(output, "utf8"))).toMatchObject({
      outcome: "failed",
      measurements: { failedMappedRows: 1 },
    });
  });

  it("binds all three workflows to mapped tests and canonical fragments", () => {
    for (const workflow of [
      "cli-ci.yml",
      "cli-strict-sandbox.yml",
      "ide-roadmap-safety.yml",
    ]) {
      const source = fs.readFileSync(
        path.resolve(
          import.meta.dirname,
          "../../../../.github/workflows",
          workflow,
        ),
        "utf8",
      );
      expect(source).toContain("run-claude-security-map-tests.mjs");
      expect(source).toContain("verify-claude-security-map.mjs");
      expect(source).toContain("claude-security-map-");
    }
  });
});
