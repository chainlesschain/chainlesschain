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
  compareCodePointOrder,
  loadContract,
  readProducerAtCommit,
  sha256,
  verifyAuditArtifact,
} from "../../scripts/claude-code-increment-audit.mjs";
import {
  AX_TRANSCRIPT_PRODUCER_PATHS,
  AX_TRANSCRIPT_PROFILE_VERSION,
  AX_TRANSCRIPT_TEST_IDS,
  AX_TRANSCRIPT_THRESHOLDS,
} from "../../scripts/ax-transcript-audit-fragment.mjs";
import {
  BROWSER_EVIDENCE_PRODUCER_PATHS,
  BROWSER_EVIDENCE_PROFILE_VERSION,
  BROWSER_EVIDENCE_TEST_IDS,
  BROWSER_EVIDENCE_THRESHOLDS,
} from "../../scripts/ide-roadmap-browser-evidence.mjs";
import {
  PROFILE_VERSION as INPUT_PROFILE_VERSION,
  SOURCE_PATHS as INPUT_PRODUCER_PATHS,
  TEST_IDS as INPUT_TEST_IDS,
  THRESHOLDS as INPUT_THRESHOLDS,
} from "../../scripts/ide-input-performance-profile.mjs";
import {
  DIAGNOSTIC_PRODUCER_PATHS,
  DIAGNOSTIC_TEST_IDS,
  DIAGNOSTICS_PROFILE,
} from "../../scripts/ide-roadmap-accessibility-performance.mjs";
import {
  PRODUCER_PATHS as SESSION_UX_PRODUCER_PATHS,
  PROFILE_VERSION as SESSION_UX_PROFILE_VERSION,
  TEST_IDS as SESSION_UX_TEST_IDS,
  THRESHOLDS as SESSION_UX_THRESHOLDS,
} from "../../scripts/session-ux-audit-fragment.mjs";
import {
  EVIDENCE_PRODUCER_PATHS as SECURITY_PRODUCER_PATHS,
  PROFILE_VERSION as SECURITY_PROFILE_VERSION,
  THRESHOLDS as SECURITY_THRESHOLDS,
  validateSecurityMap,
} from "../../scripts/verify-claude-security-map.mjs";
import {
  AUDIT_PRODUCER_PATHS as PLUGIN_PRODUCER_PATHS,
  AUDIT_PROFILE_VERSION as PLUGIN_PROFILE_VERSION,
  AUDIT_TEST_IDS as PLUGIN_TEST_IDS,
  AUDIT_THRESHOLDS as PLUGIN_THRESHOLDS,
} from "../../scripts/verify-ide-roadmap-marketplace-supply-chain.mjs";
import {
  PRODUCER_FILES as MCP_PRODUCER_PATHS,
  PROFILE_VERSION as MCP_PROFILE_VERSION,
  TEST_IDS as MCP_TEST_IDS,
  THRESHOLDS as MCP_THRESHOLDS,
} from "../../scripts/verify-mcp-lifecycle-increments.mjs";
import {
  RC_DEFAULT_PRODUCER_FILES,
  RC_DEFAULT_PROFILE_VERSION,
  RC_DEFAULT_TEST_IDS,
  RC_DEFAULT_THRESHOLDS,
} from "../../scripts/verify-rc-default-audit.mjs";
import {
  PRODUCERS as SESSION_RUNTIME_PRODUCER_PATHS,
  REQUIRED_PROFILE_VERSION as SESSION_RUNTIME_PROFILE_VERSION,
  REQUIRED_THRESHOLDS as SESSION_RUNTIME_THRESHOLDS,
  TEST_IDS as SESSION_RUNTIME_TEST_IDS,
} from "../../scripts/verify-session-runtime-retention.mjs";
import {
  REQUIRED_THRESHOLDS as XSESSION_THRESHOLDS,
  SESSION_MESSAGE_FABRIC_PROFILE as XSESSION_PROFILE_VERSION,
  SOURCE_FILES as XSESSION_PRODUCER_PATHS,
  TEST_IDS as XSESSION_TEST_IDS,
} from "../../scripts/verify-session-message-fabric.mjs";
import {
  SOURCE_RUN_SCHEMA,
  verifySourceRuns,
} from "../../scripts/verify-claude-code-increment-source-runs.mjs";
import {
  createSourceTopology,
  writeJson,
} from "./claude-code-increment-source-fixture.js";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../../..");
const roots = [];
const producerDigestCache = new Map();
let canonicalContractCache;

function canonicalContract() {
  canonicalContractCache ||= loadContract().value;
  return canonicalContractCache;
}

function producerProfile(profileVersion, thresholds, testIds, producerPaths) {
  return {
    profileVersion,
    thresholds,
    testIds: [...testIds],
    producerPaths: [...producerPaths].sort(compareCodePointOrder),
  };
}

function expectedProducerProfiles() {
  const securityMap = validateSecurityMap().map;
  return {
    "RC-DEFAULT": producerProfile(
      RC_DEFAULT_PROFILE_VERSION,
      RC_DEFAULT_THRESHOLDS,
      RC_DEFAULT_TEST_IDS,
      RC_DEFAULT_PRODUCER_FILES,
    ),
    "SEC-DELTA": producerProfile(
      SECURITY_PROFILE_VERSION,
      SECURITY_THRESHOLDS,
      [...new Set(securityMap.rows.map((row) => row.testId))].sort(
        compareCodePointOrder,
      ),
      [
        ...new Set([
          ...SECURITY_PRODUCER_PATHS,
          ...securityMap.rows.map((row) => row.producer.path),
        ]),
      ],
    ),
    XSESSION: producerProfile(
      XSESSION_PROFILE_VERSION,
      XSESSION_THRESHOLDS,
      XSESSION_TEST_IDS,
      XSESSION_PRODUCER_PATHS,
    ),
    "AX-TRANSCRIPT": producerProfile(
      AX_TRANSCRIPT_PROFILE_VERSION,
      AX_TRANSCRIPT_THRESHOLDS,
      AX_TRANSCRIPT_TEST_IDS,
      AX_TRANSCRIPT_PRODUCER_PATHS,
    ),
    "SESSION-UX": producerProfile(
      SESSION_UX_PROFILE_VERSION,
      SESSION_UX_THRESHOLDS,
      SESSION_UX_TEST_IDS,
      SESSION_UX_PRODUCER_PATHS,
    ),
    "DIAG-SCALE": producerProfile(
      DIAGNOSTICS_PROFILE.profileVersion,
      DIAGNOSTICS_PROFILE.thresholds,
      DIAGNOSTIC_TEST_IDS,
      DIAGNOSTIC_PRODUCER_PATHS,
    ),
    "IDE-INPUT-PERF": producerProfile(
      INPUT_PROFILE_VERSION,
      INPUT_THRESHOLDS,
      INPUT_TEST_IDS,
      INPUT_PRODUCER_PATHS,
    ),
    "MCP-LIFECYCLE": producerProfile(
      MCP_PROFILE_VERSION,
      MCP_THRESHOLDS,
      MCP_TEST_IDS,
      MCP_PRODUCER_PATHS,
    ),
    "SESSION-RUNTIME": producerProfile(
      SESSION_RUNTIME_PROFILE_VERSION,
      SESSION_RUNTIME_THRESHOLDS,
      SESSION_RUNTIME_TEST_IDS,
      SESSION_RUNTIME_PRODUCER_PATHS,
    ),
    "PLUGIN-SOURCE": producerProfile(
      PLUGIN_PROFILE_VERSION,
      PLUGIN_THRESHOLDS,
      PLUGIN_TEST_IDS,
      PLUGIN_PRODUCER_PATHS,
    ),
    "BROWSER-EVIDENCE": producerProfile(
      BROWSER_EVIDENCE_PROFILE_VERSION,
      BROWSER_EVIDENCE_THRESHOLDS,
      BROWSER_EVIDENCE_TEST_IDS,
      BROWSER_EVIDENCE_PRODUCER_PATHS,
    ),
  };
}

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
      maxBuffer: 128 * 1024 * 1024,
    }),
  );
  producerDigestCache.set(cacheKey, value);
  return value;
}

function producerBytes(headSha, producerPath) {
  return execFileSync(
    "git",
    ["cat-file", "blob", `${headSha}:${producerPath}`],
    {
      cwd: REPOSITORY_ROOT,
      encoding: null,
    },
  );
}

function fragment({
  commitmentId,
  headSha,
  operatingSystem,
  profile = canonicalContract().lockedProfiles[commitmentId],
  disposition = "required",
  outcome = "passed",
  source,
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
    profileVersion: profile.profileVersion,
    thresholds: structuredClone(profile.thresholds),
    measurements: {
      observationCount: 1,
      passed: outcome === "passed",
    },
    testIds: [...profile.testIds],
    producerDigests: Object.fromEntries(
      profile.producerPaths.map((producerPath) => [
        producerPath,
        producerDigest(headSha, producerPath),
      ]),
    ),
    disposition,
    source,
    outcome,
    ...overrides,
  };
}

function refreshSourceAttestation(fixture) {
  const attestation = verifySourceRuns({
    plan: fixture.sourceTopology.plan,
    fragmentsDirectory: fixture.evidenceDirectory,
  });
  writeJson(fixture.sourceRunsPath, attestation);
  return attestation;
}

function buildFixture({
  mutate,
  omit,
  advisories = [],
  refreshAfterMutation = false,
} = {}) {
  const root = tempDirectory("evidence");
  const outputRoot = path.join(root, "output");
  const headSha = currentHead();
  const contract = structuredClone(canonicalContract());
  for (const profile of Object.values(contract.lockedProfiles)) {
    profile.producerPaths = ["package.json"];
  }
  contract.lockedProfiles["BROWSER-EVIDENCE"].producerPaths = [
    ".github/workflows/ide-extensions.yml",
    "package.json",
  ].sort(compareCodePointOrder);
  const contractPath = path.join(root, "contract.json");
  writeJson(contractPath, contract);
  const sourceTopology = createSourceTopology({
    root,
    headSha,
    browserWorkflowDigest: producerDigest(
      headSha,
      ".github/workflows/ide-extensions.yml",
    ),
    aggregatorWorkflowBytes: producerBytes(
      headSha,
      ".github/workflows/claude-code-increment-audit.yml",
    ),
    fragmentFactory: ({
      commitmentId,
      headSha: fragmentHead,
      operatingSystem,
      source,
    }) =>
      fragment({
        commitmentId,
        headSha: fragmentHead,
        operatingSystem,
        profile: contract.lockedProfiles[commitmentId],
        source,
      }),
  });
  const evidenceDirectory = sourceTopology.fragmentsDirectory;
  const sourceRunsPath = path.join(root, "source-runs.json");
  const fixture = {
    contract,
    contractPath,
    evidenceDirectory,
    headSha,
    outputRoot,
    root,
    sourceRunsPath,
    sourceTopology,
  };
  for (let index = 0; index < advisories.length; index += 1) {
    const advisory = advisories[index];
    const requiredPath = sourceTopology.fragmentPaths.get(
      `${advisory.commitmentId}/${advisory.operatingSystem}`,
    );
    const required = JSON.parse(fs.readFileSync(requiredPath, "utf8"));
    writeJson(
      path.join(path.dirname(requiredPath), `advisory-${index}.json`),
      fragment({
        commitmentId: advisory.commitmentId,
        headSha,
        operatingSystem: advisory.operatingSystem,
        profile: contract.lockedProfiles[advisory.commitmentId],
        disposition: "advisory",
        outcome: advisory.outcome || "passed",
        source: required.source,
        overrides: {
          profileVersion:
            advisory.profileVersion ||
            `${contract.lockedProfiles[advisory.commitmentId].profileVersion}-advisory`,
          measurements: { observationCount: 50_000, passed: true },
        },
      }),
    );
  }
  refreshSourceAttestation(fixture);
  if (omit) fs.rmSync(sourceTopology.fragmentPaths.get(omit));
  if (mutate) {
    const filePath = sourceTopology.fragmentPaths.get(mutate.cell);
    writeJson(
      filePath,
      mutate.apply(JSON.parse(fs.readFileSync(filePath, "utf8"))),
    );
  }
  if (refreshAfterMutation) refreshSourceAttestation(fixture);
  return fixture;
}

function aggregateFixture(fixture, options = {}) {
  return aggregateAuditFragments({
    fragmentsDirectory: fixture.evidenceDirectory,
    sourceRunsPath: fixture.sourceRunsPath,
    releaseCommit: fixture.headSha,
    outputRoot: fixture.outputRoot,
    repositoryRoot: REPOSITORY_ROOT,
    contractPath: fixture.contractPath,
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
  it("retries a transient exact-commit producer blob read", () => {
    let blobAttempts = 0;
    const execGit = (_command, args) => {
      if (args[1] === "-t") return "blob\n";
      blobAttempts += 1;
      if (blobAttempts === 1) throw new Error("transient Git read failure");
      return Buffer.from("producer bytes", "utf8");
    };
    const waits = [];

    expect(
      readProducerAtCommit("repository", "a".repeat(40), "package.json", {
        execGit,
        wait: (_array, _index, _expected, timeout) => waits.push(timeout),
      }),
    ).toEqual(Buffer.from("producer bytes", "utf8"));
    expect(blobAttempts).toBe(2);
    expect(waits).toEqual([25]);
  });

  it("locks the canonical 12-commitment by three-OS contract", () => {
    const contract = loadContract();
    expect(contract.path).toBe(DEFAULT_CONTRACT_PATH);
    expect(contract.value.contractVersion).toBe("2026-08-21.2");
    expect(contract.value.requiredCommitments).toEqual(REQUIRED_COMMITMENTS);
    expect(contract.value.requiredOperatingSystems).toEqual(
      REQUIRED_OPERATING_SYSTEMS,
    );
    expect(contract.value.profilePolicy).toEqual({
      requireSameProfileVersionAcrossOperatingSystems: true,
      requireSameThresholdsAcrossOperatingSystems: true,
    });
    expect(contract.value.sourcePolicy.requireGitHubActions).toBe(true);
    expect(Object.keys(contract.value.lockedProfiles)).toEqual(
      REQUIRED_COMMITMENTS,
    );
  });

  it("keeps locked profiles aligned with their canonical producers", async () => {
    const contract = canonicalContract();
    for (const [commitmentId, expectedProfile] of Object.entries(
      expectedProducerProfiles(),
    )) {
      expect(contract.lockedProfiles[commitmentId]).toEqual(expectedProfile);
    }

    const locationProfile = contract.lockedProfiles["LOCATION-DRAIN"];
    expect(locationProfile.profileVersion).toBe("location-drain-v1");
    expect(locationProfile.testIds).toHaveLength(6);
    expect(locationProfile.producerPaths).toHaveLength(14);
    expect(Object.keys(locationProfile.thresholds)).toEqual([
      "requiredOperatingSystems",
      "requiredTargets",
      "minimumTrajectoriesPerCell",
      "requiredRemoteResourceKinds",
      "requiredUnsupportedSigtermCells",
      "minimumGracefulSigtermCells",
      "minimumSourceFencedDrainCells",
      "maximumUnexpectedUnsupportedSigtermCells",
      "maximumStaleAuthorityAcceptances",
      "maximumSecretTransfers",
      "maximumOrphanProcesses",
    ]);

    const locationProducer =
      await import("../../scripts/verify-ide-roadmap-execution-location.mjs");
    if (
      locationProducer.PROFILE_VERSION &&
      locationProducer.THRESHOLDS &&
      locationProducer.TEST_IDS &&
      locationProducer.PRODUCER_PATHS
    ) {
      expect(locationProfile).toEqual(
        producerProfile(
          locationProducer.PROFILE_VERSION,
          locationProducer.THRESHOLDS,
          locationProducer.TEST_IDS,
          locationProducer.PRODUCER_PATHS,
        ),
      );
    }
  });

  it("rejects missing or extra locked profile keys", () => {
    const root = tempDirectory("contract-keys");
    const missing = structuredClone(canonicalContract());
    delete missing.lockedProfiles["RC-DEFAULT"];
    const missingPath = path.join(root, "missing.json");
    writeJson(missingPath, missing);
    expect(() => loadContract(missingPath)).toThrow(
      /audit contract lockedProfiles keys must be exactly/u,
    );

    const extra = structuredClone(canonicalContract());
    extra.lockedProfiles["UNSCOPED"] = extra.lockedProfiles["RC-DEFAULT"];
    const extraPath = path.join(root, "extra.json");
    writeJson(extraPath, extra);
    expect(() => loadContract(extraPath)).toThrow(
      /audit contract lockedProfiles keys must be exactly/u,
    );
  });

  it("uses locale-independent default code-point ordering", () => {
    expect(["z", "ä", "a", "Z", "A"].sort(compareCodePointOrder)).toEqual([
      "A",
      "Z",
      "a",
      "z",
      "ä",
    ]);

    const fixture = buildFixture({
      advisories: [
        {
          commitmentId: "RC-DEFAULT",
          operatingSystem: "linux",
          profileVersion: "a",
        },
        {
          commitmentId: "RC-DEFAULT",
          operatingSystem: "linux",
          profileVersion: "Z",
        },
      ],
    });
    expect(
      aggregateFixture(fixture).manifest.advisoryRows.map(
        (row) => row.profileVersion,
      ),
    ).toEqual(["Z", "a"]);
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
      sourceRuns: {
        file: "source-runs.json",
        schema: SOURCE_RUN_SCHEMA,
        sha256: expect.stringMatching(/^sha256:/u),
      },
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
      contractPath: fixture.contractPath,
    });
    expect(verified.manifestDigest).toBe(aggregate.manifestDigest);
    expect(verified.manifest.summary.requiredRowCount).toBe(36);
    expect(
      fs.readFileSync(
        path.join(aggregate.artifactDirectory, "source-runs.json"),
      ),
    ).toEqual(fs.readFileSync(fixture.sourceRunsPath));
  });

  it("excludes unbound support fragments and rejects authoritative claims", () => {
    function addAccessibilitySupportFragment(fixture, artifactName) {
      const accessibilityPath = fixture.sourceTopology.fragmentPaths.get(
        "AX-TRANSCRIPT/linux",
      );
      const accessibility = JSON.parse(
        fs.readFileSync(accessibilityPath, "utf8"),
      );
      const runtimePath = fixture.sourceTopology.fragmentPaths.get(
        "SESSION-RUNTIME/linux",
      );
      const support = JSON.parse(fs.readFileSync(runtimePath, "utf8"));
      support.disposition = "advisory";
      support.source = {
        workflowId: accessibility.source.workflowId,
        runId: accessibility.source.runId,
        jobId: accessibility.source.jobId,
        artifactName,
      };
      writeJson(
        path.join(
          path.dirname(accessibilityPath),
          "session-runtime-retention.json",
        ),
        support,
      );
    }

    const unbound = buildFixture();
    addAccessibilitySupportFragment(unbound, "session-runtime-retention.json");
    const aggregate = aggregateFixture(unbound);
    expect(aggregate.manifest.summary).toMatchObject({
      requiredRowCount: 36,
      advisoryRowCount: 0,
    });
    expect(() =>
      verifyAuditArtifact({
        artifactDirectory: aggregate.artifactDirectory,
        releaseCommit: unbound.headSha,
        repositoryRoot: REPOSITORY_ROOT,
        contractPath: unbound.contractPath,
      }),
    ).not.toThrow();

    const claimed = buildFixture();
    const accessibilityPath = claimed.sourceTopology.fragmentPaths.get(
      "AX-TRANSCRIPT/linux",
    );
    addAccessibilitySupportFragment(
      claimed,
      path.basename(path.dirname(accessibilityPath)),
    );
    expect(() => aggregateFixture(claimed)).toThrow(
      /unattested fragment SESSION-RUNTIME\/linux claims an authoritative artifact/u,
    );
  });

  it("rejects a re-signed source-run attestation that changes row provenance", () => {
    const fixture = buildFixture();
    const aggregate = aggregateFixture(fixture);
    const embeddedPath = path.join(
      aggregate.artifactDirectory,
      "source-runs.json",
    );
    const sourceRuns = JSON.parse(fs.readFileSync(embeddedPath, "utf8"));
    sourceRuns.cells[0].artifactId = "999999999";
    writeJson(embeddedPath, sourceRuns);
    rewriteManifest(aggregate.artifactDirectory, (manifest) => {
      manifest.sourceRuns.sha256 = sha256(fs.readFileSync(embeddedPath));
    });

    expect(() =>
      verifyAuditArtifact({
        artifactDirectory: aggregate.artifactDirectory,
        releaseCommit: fixture.headSha,
        repositoryRoot: REPOSITORY_ROOT,
        contractPath: fixture.contractPath,
      }),
    ).toThrow();

    const browserFixture = buildFixture();
    const browserAggregate = aggregateFixture(browserFixture);
    const browserSourcePath = path.join(
      browserAggregate.artifactDirectory,
      "source-runs.json",
    );
    const browserSourceRuns = JSON.parse(
      fs.readFileSync(browserSourcePath, "utf8"),
    );
    for (const cell of browserSourceRuns.cells.filter(
      (candidate) => candidate.commitmentId === "BROWSER-EVIDENCE",
    )) {
      cell.workflowProvenance.executedWorkflowSha = "c".repeat(40);
    }
    writeJson(browserSourcePath, browserSourceRuns);
    rewriteManifest(browserAggregate.artifactDirectory, (manifest) => {
      manifest.sourceRuns.sha256 = sha256(fs.readFileSync(browserSourcePath));
    });
    expect(() =>
      verifyAuditArtifact({
        artifactDirectory: browserAggregate.artifactDirectory,
        releaseCommit: browserFixture.headSha,
        repositoryRoot: REPOSITORY_ROOT,
        contractPath: browserFixture.contractPath,
      }),
    ).toThrow(/workflow provenance digest/u);
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
    const duplicateSource =
      duplicate.sourceTopology.fragmentPaths.get("RC-DEFAULT/linux");
    fs.copyFileSync(
      duplicateSource,
      path.join(path.dirname(duplicateSource), "duplicate.json"),
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
      refreshAfterMutation: true,
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
      refreshAfterMutation: true,
    });
    expect(() => aggregateFixture(drift)).toThrow(
      /thresholds differ across operating systems/u,
    );

    const locked = buildFixture();
    const contract = structuredClone(locked.contract);
    contract.lockedProfiles["RC-DEFAULT"].thresholds = {
      ...contract.lockedProfiles["RC-DEFAULT"].thresholds,
      passiveRemoteStateWritesMaximum: 1,
    };
    const contractPath = path.join(locked.root, "locked-contract.json");
    writeJson(contractPath, contract);
    expect(() => aggregateFixture(locked, { contractPath })).toThrow(
      /relaxes or changes its locked thresholds/u,
    );
  });

  it("rejects locked required test or producer coverage shrinkage", () => {
    const fixture = buildFixture();
    const contract = structuredClone(fixture.contract);
    contract.lockedProfiles["RC-DEFAULT"].testIds = [
      "RC-DEFAULT/expected-release-test",
    ];
    const testLockPath = path.join(fixture.root, "test-lock-contract.json");
    writeJson(testLockPath, contract);
    expect(() =>
      aggregateFixture(fixture, { contractPath: testLockPath }),
    ).toThrow(/locked required test IDs/u);

    contract.lockedProfiles["RC-DEFAULT"].testIds = [
      ...fixture.contract.lockedProfiles["RC-DEFAULT"].testIds,
    ];
    contract.lockedProfiles["RC-DEFAULT"].producerPaths = [
      ...new Set([
        ...fixture.contract.lockedProfiles["RC-DEFAULT"].producerPaths,
        "package-lock.json",
      ]),
    ].sort(compareCodePointOrder);
    const producerLockPath = path.join(
      fixture.root,
      "producer-lock-contract.json",
    );
    writeJson(producerLockPath, contract);
    expect(() =>
      aggregateFixture(fixture, { contractPath: producerLockPath }),
    ).toThrow(/locked producer path set/u);
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
        contractPath: first.contractPath,
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
        contractPath: second.contractPath,
      }),
    ).toThrow(/required row contains advisory/u);
  });
});
