import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_CONTRACT_PATH,
  FRAGMENT_SCHEMA,
  MANIFEST_SCHEMA,
  REQUIRED_COMMITMENTS,
  REQUIRED_OPERATING_SYSTEMS,
  aggregateAuditFragments,
  artifactName,
  loadContract,
  sha256,
  verifyAuditArtifact,
} from "../../scripts/claude-code-increment-audit.mjs";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../../..");
const roots = [];
const producerDigestCache = new Map();

function tempDirectory(label = "fixture") {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), `cc-increment-audit-${label}-`),
  );
  roots.push(directory);
  return directory;
}

function currentHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
  }).trim();
}

function producerDigest(headSha, producerPath = "package.json") {
  const cacheKey = `${headSha}:${producerPath}`;
  if (producerDigestCache.has(cacheKey)) {
    return producerDigestCache.get(cacheKey);
  }
  const value = sha256(
    execFileSync("git", ["cat-file", "blob", `${headSha}:${producerPath}`], {
      cwd: REPOSITORY_ROOT,
      encoding: null,
    }),
  );
  producerDigestCache.set(cacheKey, value);
  return value;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function profileVersion(commitmentId) {
  return `${commitmentId.toLowerCase()}/v1`;
}

function thresholds(commitmentId) {
  return {
    maximumFailureCount: 0,
    requiredSampleCount: commitmentId === "DIAG-SCALE" ? 10_000 : 1,
  };
}

function fragment({
  commitmentId,
  headSha,
  operatingSystem,
  disposition = "required",
  outcome = "passed",
  overrides = {},
}) {
  return {
    schema: FRAGMENT_SCHEMA,
    commitmentId,
    headSha,
    os: operatingSystem,
    runtime: {
      name: "node+java",
      version: `${process.version};21.0.8`,
      arch: process.arch,
    },
    profileVersion: profileVersion(commitmentId),
    thresholds: thresholds(commitmentId),
    measurements: {
      observationCount: 1,
      passed: outcome === "passed",
    },
    testIds: [`${commitmentId}/repository-contract`],
    producerDigests: {
      "package.json": producerDigest(headSha),
    },
    disposition,
    source: {
      workflowId:
        "chainlesschain/chainlesschain/.github/workflows/test.yml@refs/heads/main",
      runId: "32476551305",
      jobId: `audit-${operatingSystem}`,
      artifactName: `${commitmentId.toLowerCase()}-${operatingSystem}-evidence-1`,
    },
    outcome,
    ...overrides,
  };
}

function buildFixture({ mutate, omit, advisories = [] } = {}) {
  const root = tempDirectory("evidence");
  const evidenceDirectory = path.join(root, "evidence");
  const outputRoot = path.join(root, "output");
  const headSha = currentHead();
  for (const commitmentId of REQUIRED_COMMITMENTS) {
    for (const operatingSystem of REQUIRED_OPERATING_SYSTEMS) {
      const cell = `${commitmentId}/${operatingSystem}`;
      if (omit === cell) continue;
      let value = fragment({ commitmentId, headSha, operatingSystem });
      if (mutate?.cell === cell) value = mutate.apply(value);
      writeJson(
        path.join(evidenceDirectory, `${commitmentId}-${operatingSystem}.json`),
        value,
      );
    }
  }
  for (let index = 0; index < advisories.length; index += 1) {
    const advisory = advisories[index];
    writeJson(
      path.join(evidenceDirectory, `advisory-${index}.json`),
      fragment({
        commitmentId: advisory.commitmentId,
        headSha,
        operatingSystem: advisory.operatingSystem,
        disposition: "advisory",
        outcome: advisory.outcome || "passed",
        overrides: {
          profileVersion: `${profileVersion(advisory.commitmentId)}-advisory`,
          measurements: { observationCount: 50_000, passed: true },
        },
      }),
    );
  }
  return { evidenceDirectory, headSha, outputRoot, root };
}

function aggregateFixture(fixture, options = {}) {
  return aggregateAuditFragments({
    fragmentsDirectory: fixture.evidenceDirectory,
    releaseCommit: fixture.headSha,
    outputRoot: fixture.outputRoot,
    repositoryRoot: REPOSITORY_ROOT,
    ...options,
  });
}

function rewriteManifest(artifactDirectory, mutate) {
  const manifestPath = path.join(artifactDirectory, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  mutate(manifest);
  writeJson(manifestPath, manifest);
  fs.writeFileSync(
    path.join(artifactDirectory, "manifest.sha256"),
    `${sha256(fs.readFileSync(manifestPath))}\n`,
    "utf8",
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Claude Code increment unified audit", () => {
  it("locks the canonical 12-commitment by three-OS contract", () => {
    const contract = loadContract();
    expect(contract.path).toBe(DEFAULT_CONTRACT_PATH);
    expect(contract.value.requiredCommitments).toEqual(REQUIRED_COMMITMENTS);
    expect(contract.value.requiredOperatingSystems).toEqual(
      REQUIRED_OPERATING_SYSTEMS,
    );
    expect(contract.value.profilePolicy).toEqual({
      requireSameProfileVersionAcrossOperatingSystems: true,
      requireSameThresholdsAcrossOperatingSystems: true,
    });
    expect(contract.value.sourcePolicy.requireGitHubActions).toBe(true);
  });

  it("runs the contract verifier when either implementation or policy changes", () => {
    const workflow = fs.readFileSync(
      path.join(REPOSITORY_ROOT, ".github/workflows/cli-ci.yml"),
      "utf8",
    );
    expect(
      workflow.match(
        /tests\/fixtures\/claude-code-increment-audit-contract\.json/gu,
      ),
    ).toHaveLength(2);
    expect(workflow).toContain('      - "packages/cli/**"');
  });

  it("aggregates and independently verifies 36 exact-head required rows", () => {
    const fixture = buildFixture({
      advisories: [
        {
          commitmentId: "DIAG-SCALE",
          operatingSystem: "linux",
          outcome: "failed",
        },
      ],
    });
    const aggregate = aggregateFixture(fixture);
    expect(path.basename(aggregate.artifactDirectory)).toBe(
      artifactName(fixture.headSha),
    );
    expect(aggregate.manifest).toMatchObject({
      schema: MANIFEST_SCHEMA,
      artifactName: artifactName(fixture.headSha),
      headSha: fixture.headSha,
      result: "passed",
      summary: {
        requiredCommitmentCount: 12,
        requiredRowCount: 36,
        advisoryRowCount: 1,
        failedAdvisoryRowCount: 1,
      },
    });
    expect(
      aggregate.manifest.requiredRows.every(
        (row) => row.disposition === "required" && row.outcome === "passed",
      ),
    ).toBe(true);
    expect(aggregate.manifest.advisoryRows[0].disposition).toBe("advisory");
    expect(aggregate.manifest.requiredRows[0]).toEqual(
      expect.objectContaining({
        runtime: expect.any(Object),
        profileVersion: expect.any(String),
        thresholds: expect.any(Object),
        measurements: expect.any(Object),
        testIds: expect.any(Array),
        producerDigests: expect.any(Object),
        source: expect.any(Object),
        fragmentDigest: expect.stringMatching(/^sha256:/u),
      }),
    );

    const verified = verifyAuditArtifact({
      artifactDirectory: aggregate.artifactDirectory,
      releaseCommit: fixture.headSha,
      repositoryRoot: REPOSITORY_ROOT,
    });
    expect(verified.manifestDigest).toBe(aggregate.manifestDigest);
    expect(verified.manifest.summary.requiredRowCount).toBe(36);
  });

  it("rejects stale-head and failed required fragments", () => {
    const stale = buildFixture({
      mutate: {
        cell: "RC-DEFAULT/linux",
        apply: (value) => ({ ...value, headSha: "b".repeat(40) }),
      },
    });
    expect(() => aggregateFixture(stale)).toThrow(/stale head/u);

    const failed = buildFixture({
      mutate: {
        cell: "SEC-DELTA/macos",
        apply: (value) => ({ ...value, outcome: "failed" }),
      },
    });
    expect(() => aggregateFixture(failed)).toThrow(/did not pass/u);
  });

  it("does not let advisory evidence satisfy a missing required OS cell", () => {
    const fixture = buildFixture({
      omit: "XSESSION/windows",
      advisories: [{ commitmentId: "XSESSION", operatingSystem: "windows" }],
    });
    expect(() => aggregateFixture(fixture)).toThrow(
      /missing required audit cells: XSESSION\/windows/u,
    );
  });

  it("rejects duplicate cells, local provenance, and producer digest drift", () => {
    const duplicate = buildFixture();
    fs.copyFileSync(
      path.join(duplicate.evidenceDirectory, "RC-DEFAULT-linux.json"),
      path.join(duplicate.evidenceDirectory, "duplicate.json"),
    );
    expect(() => aggregateFixture(duplicate)).toThrow(
      /duplicate required audit cell/u,
    );

    const local = buildFixture({
      mutate: {
        cell: "RC-DEFAULT/macos",
        apply: (value) => ({
          ...value,
          source: { ...value.source, runId: "local" },
        }),
      },
    });
    expect(() => aggregateFixture(local)).toThrow(/GitHub run id/u);

    const drift = buildFixture({
      mutate: {
        cell: "PLUGIN-SOURCE/windows",
        apply: (value) => ({
          ...value,
          producerDigests: { "package.json": `sha256:${"0".repeat(64)}` },
        }),
      },
    });
    expect(() => aggregateFixture(drift)).toThrow(/producer digest drift/u);
  });

  it("rejects cross-OS threshold drift and a locked profile change", () => {
    const drift = buildFixture({
      mutate: {
        cell: "DIAG-SCALE/windows",
        apply: (value) => ({
          ...value,
          thresholds: { ...value.thresholds, requiredSampleCount: 9_999 },
        }),
      },
    });
    expect(() => aggregateFixture(drift)).toThrow(
      /thresholds differ across operating systems/u,
    );

    const locked = buildFixture();
    const contract = structuredClone(loadContract().value);
    contract.lockedProfiles["RC-DEFAULT"] = {
      profileVersion: profileVersion("RC-DEFAULT"),
      thresholds: { ...thresholds("RC-DEFAULT"), maximumFailureCount: 1 },
    };
    const contractPath = path.join(locked.root, "locked-contract.json");
    writeJson(contractPath, contract);
    expect(() => aggregateFixture(locked, { contractPath })).toThrow(
      /relaxes or changes its locked thresholds/u,
    );
  });

  it("rehashes copied fragments and rejects manifest disposition tampering", () => {
    const first = buildFixture();
    const aggregate = aggregateFixture(first);
    const fragmentPath = path.join(
      aggregate.artifactDirectory,
      ...aggregate.manifest.requiredRows[0].fragmentFile.split("/"),
    );
    const copied = JSON.parse(fs.readFileSync(fragmentPath, "utf8"));
    copied.measurements.observationCount = 2;
    writeJson(fragmentPath, copied);
    expect(() =>
      verifyAuditArtifact({
        artifactDirectory: aggregate.artifactDirectory,
        releaseCommit: first.headSha,
        repositoryRoot: REPOSITORY_ROOT,
      }),
    ).toThrow(/digest drift/u);

    const second = buildFixture();
    const secondAggregate = aggregateFixture(second);
    rewriteManifest(secondAggregate.artifactDirectory, (manifest) => {
      manifest.requiredRows[0].disposition = "advisory";
    });
    expect(() =>
      verifyAuditArtifact({
        artifactDirectory: secondAggregate.artifactDirectory,
        releaseCommit: second.headSha,
        repositoryRoot: REPOSITORY_ROOT,
      }),
    ).toThrow(/required row contains advisory/u);
  });
});
