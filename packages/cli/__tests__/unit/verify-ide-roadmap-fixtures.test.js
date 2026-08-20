import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  IDE_ROADMAP_REMOTE_CONTAINER_IMAGE,
  IDE_ROADMAP_REMOTE_SSH_CONTAINER_CASE,
  IDE_ROADMAP_MANIFEST_VERSION,
  IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA,
  IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA_VERSION,
  IDE_ROADMAP_SCHEMA_VERSION,
  REQUIRED_RELEASE_EVIDENCE_FIELDS,
  bridgeIdeJourneyEvidenceToRoadmapRuntime,
  createIdeRoadmapRuntimeEvidenceDigest,
  verifyIdeRoadmapFixtures,
  verifyIdeRoadmapRuntimeEvidence,
} from "../../scripts/verify-ide-roadmap-fixtures.mjs";
import {
  canonicalJson as canonicalJourneyJson,
  sha256Buffer,
  writeIdeJourneyEvidence,
} from "../../../../scripts/ide-journey-evidence.mjs";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const temporaryRoots = [];

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ide-roadmap-"));
  temporaryRoots.push(root);
  return root;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256File(filePath) {
  return `sha256:${createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex")}`;
}

function sha512File(filePath) {
  return createHash("sha512").update(fs.readFileSync(filePath)).digest("hex");
}

function createCorpus() {
  const root = temporaryRoot();
  const fixtureRelative = "tests/fixtures/ide-roadmap/example-case.json";
  const fixturePath = path.join(root, ...fixtureRelative.split("/"));
  const testRelative = "packages/cli/__tests__/unit/example-case.test.js";
  const testPath = path.join(root, ...testRelative.split("/"));
  const manifestPath = path.join(
    root,
    "tests",
    "fixtures",
    "ide-roadmap",
    "manifest.json",
  );
  const fixture = {
    schemaVersion: IDE_ROADMAP_SCHEMA_VERSION,
    case: "example-case",
    expected: { mutationCount: 0 },
  };

  writeJson(fixturePath, fixture);
  fs.mkdirSync(path.dirname(testPath), { recursive: true });
  fs.writeFileSync(testPath, "export {};\n", "utf8");

  const manifest = {
    schemaVersion: IDE_ROADMAP_SCHEMA_VERSION,
    manifestVersion: IDE_ROADMAP_MANIFEST_VERSION,
    baselineCommit: "a".repeat(40),
    releaseEvidence: {
      commitSource: "git-head-at-run",
      requiredFields: [...REQUIRED_RELEASE_EVIDENCE_FIELDS],
    },
    runtimeEvidence: {
      schema: IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA,
      evidenceSource: "external-ci-artifacts",
      verificationScope: "trusted-ci-provenance-and-artifact-bytes",
      releaseReadiness: "selected-complete-matrix-only",
      trustedProvider: "github-actions",
      trustedWorkflow: ".github/workflows/ide-extensions.yml",
    },
    cases: [
      {
        id: "example-case",
        priority: "P0-S",
        required: true,
        evidenceStatus: "external-evidence-required",
        evidenceNotes:
          "Runtime evidence is supplied by exact-commit CI artifacts.",
        fixture: fixtureRelative,
        fixtureDigest: sha256File(fixturePath),
        seed: 2026080199,
        minimumIndependentRuns: 1,
        matrix: {
          hosts: ["cli"],
          operatingSystems: ["windows"],
          transports: ["local"],
        },
        expectedOutcome: { mutationCount: 0 },
        testFiles: [testRelative],
        requiredArtifacts: ["exact-commit"],
      },
    ],
  };
  writeJson(manifestPath, manifest);
  return {
    root,
    fixture,
    fixturePath,
    manifest,
    manifestPath,
    testRelative,
  };
}

function runtimeEvidenceDirectory(corpus) {
  const directory = path.join(corpus.root, "runtime-evidence");
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function runtimeRun(corpus, coordinates, runIndex) {
  const roadmapCase = corpus.manifest.cases[0];
  const runId = `${roadmapCase.id}-${coordinates.host}-${coordinates.operatingSystem}-${coordinates.transport}-${runIndex}`;
  const artifacts = [...roadmapCase.requiredArtifacts];
  return {
    runId,
    caseId: roadmapCase.id,
    manifestVersion: IDE_ROADMAP_MANIFEST_VERSION,
    releaseCommit: corpus.manifest.baselineCommit,
    host: coordinates.host,
    hostVersion: "1.2.3",
    cliVersion: "0.200.0",
    operatingSystem: coordinates.operatingSystem,
    transport: coordinates.transport,
    startedAt: "2026-08-09T00:00:00.000Z",
    finishedAt: "2026-08-09T00:00:01.000Z",
    result: "passed",
    observedOutcome: structuredClone(roadmapCase.expectedOutcome),
    artifacts,
    artifactDigests: Object.fromEntries(
      artifacts.map((artifact) => [
        artifact,
        `sha256:${createHash("sha256")
          .update(`${runId}:${artifact}`)
          .digest("hex")}`,
      ]),
    ),
  };
}

function createRuntimeEvidence(corpus, options = {}) {
  const roadmapCase = corpus.manifest.cases[0];
  const directory = runtimeEvidenceDirectory(corpus);
  const runs = [];
  for (const host of roadmapCase.matrix.hosts) {
    for (const operatingSystem of roadmapCase.matrix.operatingSystems) {
      for (const transport of roadmapCase.matrix.transports) {
        if (
          options.includeCell &&
          !options.includeCell({ host, operatingSystem, transport })
        ) {
          continue;
        }
        const runCount =
          options.runsPerCell ?? roadmapCase.minimumIndependentRuns;
        for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
          runs.push(
            runtimeRun(corpus, { host, operatingSystem, transport }, runIndex),
          );
        }
      }
    }
  }
  const trustedProvenance = {
    provider: "github-actions",
    repository: "chainlesschain/chainlesschain",
    workflowRef:
      "chainlesschain/chainlesschain/.github/workflows/ide-extensions.yml@refs/heads/main",
    workflowSha: corpus.manifest.baselineCommit,
    runId: "123456",
    runAttempt: "1",
    job: "example-case",
    artifactName: "example-case-evidence-1",
    eventName: "push",
  };
  const journeyEvidenceDigest = `sha256:${createHash("sha256")
    .update("journey-evidence")
    .digest("hex")}`;
  if (options.trusted) {
    for (const run of runs) {
      run.provenance = structuredClone(trustedProvenance);
      run.journeyEvidenceDigest = journeyEvidenceDigest;
      run.artifactFiles = {};
      for (const artifact of run.artifacts) {
        const relative = path.posix.join(
          "artifacts",
          run.runId,
          `${artifact}.json`,
        );
        const artifactPath = path.join(directory, ...relative.split("/"));
        writeJson(artifactPath, {
          artifact,
          releaseCommit: run.releaseCommit,
          runId: run.runId,
        });
        run.artifactDigests[artifact] = sha256File(artifactPath);
        run.artifactFiles[artifact] = relative;
      }
    }
  }
  const evidence = {
    schema: IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA,
    schemaVersion: IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA_VERSION,
    manifestVersion: IDE_ROADMAP_MANIFEST_VERSION,
    caseId: roadmapCase.id,
    releaseCommit: corpus.manifest.baselineCommit,
    generatedAt: "2026-08-09T00:01:00.000Z",
    ...(options.trusted
      ? {
          provenance: trustedProvenance,
          journeyEvidenceDigest,
        }
      : {}),
    runs,
  };
  evidence.evidenceDigest = createIdeRoadmapRuntimeEvidenceDigest(evidence);
  const filePath = path.join(directory, `${roadmapCase.id}.json`);
  writeJson(filePath, evidence);
  return { directory, evidence, filePath, trustedProvenance };
}

function rewriteRuntimeEvidence(runtime) {
  runtime.evidence.evidenceDigest = createIdeRoadmapRuntimeEvidenceDigest(
    runtime.evidence,
  );
  writeJson(runtime.filePath, runtime.evidence);
}

function createRemoteSshRuntimeCorpus() {
  const corpus = createCorpus();
  const roadmapCase = corpus.manifest.cases[0];
  corpus.fixture.case = IDE_ROADMAP_REMOTE_SSH_CONTAINER_CASE;
  corpus.fixture.expectedOutcome = {
    missingRequiredArtifactsFail: true,
    credentialLeakCount: 0,
    wrongCommitBindingCount: 0,
    evidenceReplacementCount: 0,
    orderedWorkspaceRootsBound: true,
    workspaceRootCount: 2,
    remoteTransportExercised: true,
  };
  roadmapCase.id = IDE_ROADMAP_REMOTE_SSH_CONTAINER_CASE;
  roadmapCase.matrix = {
    hosts: ["vscode"],
    operatingSystems: ["linux"],
    transports: ["remote-ssh-container"],
  };
  roadmapCase.expectedOutcome = structuredClone(corpus.fixture.expectedOutcome);
  roadmapCase.requiredArtifacts = [
    "exact-commit",
    "host-environment",
    "remote-environment",
    "outcome-observations",
    "redacted-diagnostics",
    "artifact-digests",
    "candidate-vsix",
    "candidate-manifest",
    "journey-evidence",
  ];
  rewriteFixture(corpus);

  const runtimeDirectory = runtimeEvidenceDirectory(corpus);
  const sourceDirectory = path.join(corpus.root, "remote-source");
  fs.mkdirSync(sourceDirectory);
  const writeSourceJson = (name, value) => {
    const filePath = path.join(sourceDirectory, `${name}.json`);
    writeJson(filePath, value);
    return filePath;
  };
  const releaseCommit = corpus.manifest.baselineCommit;
  const containerHostname = "cc-roadmap-ssh-1234567890abcdef";
  const markerDigest = sha256Buffer("container-marker\n");
  const candidateVsix = path.join(sourceDirectory, "chainlesschain-ide.vsix");
  fs.writeFileSync(candidateVsix, "synthetic candidate bytes", "utf8");
  const candidateVersion = "0.37.53";
  const provenance = {
    provider: "github-actions",
    repository: "chainlesschain/chainlesschain",
    workflowRef:
      "chainlesschain/chainlesschain/.github/workflows/ide-extensions.yml@refs/heads/main",
    workflowSha: releaseCommit,
    runId: "123456",
    runAttempt: "1",
    job: "vscode-remote-ssh-container",
    artifactName: "vscode-remote-ssh-container-evidence-1",
    eventName: "push",
  };
  const candidateManifest = path.join(sourceDirectory, "manifest.json");
  writeJson(candidateManifest, {
    schema: 1,
    artifact: "chainlesschain-ide.vsix",
    bytes: fs.statSync(candidateVsix).size,
    sha256: sha256File(candidateVsix).slice("sha256:".length),
    sha512: sha512File(candidateVsix),
    package: "chainlesschain-ide",
    publisher: "chainlesschain",
    version: candidateVersion,
    vsixmanifestIdentity: {
      id: "chainlesschain-ide",
      publisher: "chainlesschain",
      version: candidateVersion,
    },
    commit: releaseCommit,
    workflowRun:
      "https://github.com/chainlesschain/chainlesschain/actions/runs/123456",
    createdAt: "2026-08-09T00:00:00.000Z",
  });
  const exactCommit = writeSourceJson("exact-commit", {
    releaseCommit,
    gitHead: releaseCommit,
  });
  const hostEnvironment = writeSourceJson("host-environment", {
    schema: "chainlesschain.ide-host-environment.v1",
    operatingSystem: "linux",
    architecture: "x64",
    vscodeVersion: "1.96.4",
    containerHostname,
    containerMarkerDigest: markerDigest,
    containerImageRef: IDE_ROADMAP_REMOTE_CONTAINER_IMAGE,
    dockerImageId: `sha256:${"c".repeat(64)}`,
  });
  const remoteEnvironment = writeSourceJson("remote-environment", {
    schema: "chainlesschain.remote-ssh-container-observation.v2",
    remoteName: "ssh-remote",
    remoteAuthority: `ssh-remote+${containerHostname}`,
    workspaceUriPresentation: "remote-extension-host-native-file",
    workspaceSchemes: ["file", "file"],
    workspaceAuthorities: ["", ""],
    orderedWorkspacePaths: [
      "/home/cc-roadmap/workspace-primary",
      "/home/cc-roadmap/workspace-secondary",
    ],
    extensionHostPid: 123,
    extensionHostCwd: "/home/cc-roadmap",
    extensionPath:
      "/home/cc-roadmap/.vscode-server/extensions/chainlesschain.chainlesschain-ide-0.37.53",
    extensionVersion: candidateVersion,
    candidateVsixSha256: sha256File(candidateVsix),
    candidateVsixBytes: fs.statSync(candidateVsix).size,
    containerHostname,
    containerMarkerDigest: markerDigest,
    releaseCommit,
    journeyPassed: true,
    hostJourneyStages: [
      "installed-vsix-discovered",
      "vsix-activated",
      "commands-verified",
      "bridge-verified",
      "view-command-dispatched",
      "phase-completed",
    ],
  });
  const outcomeObservations = writeSourceJson("outcome-observations", {
    schema: "chainlesschain.ide-roadmap-outcome-observations.v1",
    ...corpus.fixture.expectedOutcome,
  });
  const diagnostics = writeSourceJson("redacted-diagnostics", {
    schema: "chainlesschain.ide-redacted-diagnostics.v1",
    records: [],
    journeyFailureDigest: null,
  });
  const artifactDigests = writeSourceJson("artifact-digests", {
    targetVsix: sha256File(candidateVsix),
  });
  const remoteSshPayload = path.join(
    sourceDirectory,
    "remote-ssh-0.120.0.vsix.gz",
  );
  const remoteSshVsix = path.join(sourceDirectory, "remote-ssh-0.120.0.vsix");
  fs.writeFileSync(remoteSshPayload, "synthetic transport", "utf8");
  fs.writeFileSync(remoteSshVsix, "synthetic decoded vsix", "utf8");
  const remoteSshTrust = {
    id: "ms-vscode-remote.remote-ssh",
    version: "0.120.0",
    source:
      "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/ms-vscode-remote/vsextensions/remote-ssh/0.120.0/vspackage",
    transportSha256: sha256File(remoteSshPayload),
    sha256: sha256File(remoteSshVsix),
  };
  const journeyDirectory = path.join(runtimeDirectory, "journey");
  const journeyResult = writeIdeJourneyEvidence({
    artifactDir: journeyDirectory,
    journeyId:
      "vscode-installed-vsix-remote-ssh-container-host-api-multiroot-control",
    host: "vscode",
    hostVersion: "1.96.4",
    operatingSystem: "linux",
    architecture: "x64",
    cliVersion: "0.200.0",
    extensionVersion: candidateVersion,
    transport: "remote-ssh-container",
    remoteWorkspaceFolders: [
      "/home/cc-roadmap/workspace-primary",
      "/home/cc-roadmap/workspace-secondary",
    ],
    result: "passed",
    startedAt: "2026-08-09T00:00:00.000Z",
    finishedAt: "2026-08-09T00:00:01.000Z",
    sourceRoots: [diagnostics],
    artifactPaths: [remoteSshPayload, remoteSshVsix],
    roadmapArtifactPaths: {
      "exact-commit": exactCommit,
      "host-environment": hostEnvironment,
      "remote-environment": remoteEnvironment,
      "outcome-observations": outcomeObservations,
      "redacted-diagnostics": diagnostics,
      "artifact-digests": artifactDigests,
      "candidate-vsix": candidateVsix,
      "candidate-manifest": candidateManifest,
    },
    dependencies: [remoteSshTrust],
    repoRoot: corpus.root,
    releaseCommit,
    requireTrustedProvenance: true,
    ciProvenance: provenance,
  });
  const inspectVsix = (candidatePath) => ({
    file: candidatePath,
    artifact: "chainlesschain-ide.vsix",
    bytes: fs.statSync(candidatePath).size,
    sha256: sha256File(candidatePath).slice("sha256:".length),
    sha512: sha512File(candidatePath),
    package: "chainlesschain-ide",
    publisher: "chainlesschain",
    version: candidateVersion,
    vsixmanifestIdentity: {
      id: "chainlesschain-ide",
      publisher: "chainlesschain",
      version: candidateVersion,
    },
  });
  const envelopePath = path.join(
    runtimeDirectory,
    "roadmap-runtime-evidence.json",
  );
  const trustedProvenance = { ...provenance, releaseCommit };
  bridgeIdeJourneyEvidenceToRoadmapRuntime({
    repoRoot: corpus.root,
    manifestPath: corpus.manifestPath,
    journeyEvidencePath: journeyResult.destination,
    output: envelopePath,
    trustedProvenance,
    inspectVsix,
    remoteSshTrust,
  });
  return {
    corpus,
    runtimeDirectory,
    journeyPath: journeyResult.destination,
    envelopePath,
    trustedProvenance,
    inspectVsix,
    remoteSshTrust,
  };
}

function resealRemoteSshJourneyArtifact(runtime, artifactName) {
  const journey = JSON.parse(fs.readFileSync(runtime.journeyPath, "utf8"));
  const binding = journey.roadmapArtifacts[artifactName];
  const artifactPath = path.join(
    path.dirname(runtime.journeyPath),
    ...binding.path.split("/"),
  );
  binding.sha256 = sha256File(artifactPath);
  binding.bytes = fs.statSync(artifactPath).size;
  const record = journey.artifacts.find(
    (artifact) => artifact.path === binding.path,
  );
  record.sha256 = binding.sha256;
  record.bytes = binding.bytes;
  const bundleCore = journey.artifacts
    .map(({ kind, name = null, path: artifactRecordPath, sha256, bytes }) => ({
      kind,
      name,
      path: artifactRecordPath,
      sha256,
      bytes,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  journey.artifactBundleDigest = sha256Buffer(canonicalJourneyJson(bundleCore));
  const journeyCore = { ...journey };
  delete journeyCore.evidenceDigest;
  journey.evidenceDigest = sha256Buffer(canonicalJourneyJson(journeyCore));
  writeJson(runtime.journeyPath, journey);

  const envelope = JSON.parse(fs.readFileSync(runtime.envelopePath, "utf8"));
  envelope.journeyEvidenceDigest = journey.evidenceDigest;
  envelope.runs[0].journeyEvidenceDigest = journey.evidenceDigest;
  envelope.runs[0].artifactDigests[artifactName] = binding.sha256;
  envelope.runs[0].artifactDigests["journey-evidence"] = sha256File(
    runtime.journeyPath,
  );
  envelope.evidenceDigest = createIdeRoadmapRuntimeEvidenceDigest(envelope);
  writeJson(runtime.envelopePath, envelope);
  return { artifactPath, journey, envelope };
}

function writeManifest(corpus) {
  writeJson(corpus.manifestPath, corpus.manifest);
}

function rewriteFixture(corpus) {
  writeJson(corpus.fixturePath, corpus.fixture);
  corpus.manifest.cases[0].fixtureDigest = sha256File(corpus.fixturePath);
  writeManifest(corpus);
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("IDE roadmap fixture contract", () => {
  it("verifies the repository corpus and directly consumes every fixture", () => {
    const result = verifyIdeRoadmapFixtures({ repoRoot: REPOSITORY_ROOT });

    expect(result).toMatchObject({
      schemaVersion: 1,
      manifestVersion: "1.9.40",
      caseCount: 15,
      releaseReadiness: { status: "not-evaluated" },
    });
    expect(result.cases.map((entry) => entry.id)).toEqual([
      "s0-plan-ceiling",
      "s0-authority-failures",
      "s0-skill-mcp",
      "s0-subtree-preflight",
      "s0-persistence-replay",
      "s0-semantic-handoff",
      "s0-live-provider-trajectory",
      "p0-host-local-evidence",
      "p0-host-remote-evidence",
      "q4a-vscode-remote-ssh-container",
      "q3-production-delivery-live",
      "p1-dynamic-workflow",
      "p1-execution-location",
      "p1-marketplace-supply-chain",
      "p2-accessibility-performance",
    ]);
  });

  it("rejects unsupported manifest schema and contract versions", () => {
    const corpus = createCorpus();
    corpus.manifest.schemaVersion = 2;
    corpus.manifest.manifestVersion = "2.0.0";
    writeManifest(corpus);

    expect(() => verifyIdeRoadmapFixtures({ repoRoot: corpus.root })).toThrow(
      /schemaVersion must equal supported version 1/,
    );
    expect(() => verifyIdeRoadmapFixtures({ repoRoot: corpus.root })).toThrow(
/manifestVersion must equal supported version "1\.9\.40"/,
    );
  });

  it("rejects duplicate case identifiers", () => {
    const corpus = createCorpus();
    corpus.manifest.cases.push(structuredClone(corpus.manifest.cases[0]));
    writeManifest(corpus);

    expect(() => verifyIdeRoadmapFixtures({ repoRoot: corpus.root })).toThrow(
      /id duplicates "example-case"/,
    );
  });

  it("rejects fixture paths outside the fixture corpus", () => {
    const corpus = createCorpus();
    const outsideRelative = "tests/fixtures/outside.json";
    const outsidePath = path.join(corpus.root, ...outsideRelative.split("/"));
    writeJson(outsidePath, corpus.fixture);
    corpus.manifest.cases[0].fixture = outsideRelative;
    corpus.manifest.cases[0].fixtureDigest = sha256File(outsidePath);
    writeManifest(corpus);

    expect(() => verifyIdeRoadmapFixtures({ repoRoot: corpus.root })).toThrow(
      /fixture must stay within tests.*ide-roadmap/,
    );
  });

  it("rejects fixture digest drift", () => {
    const corpus = createCorpus();
    corpus.manifest.cases[0].fixtureDigest = `sha256:${"0".repeat(64)}`;
    writeManifest(corpus);

    expect(() => verifyIdeRoadmapFixtures({ repoRoot: corpus.root })).toThrow(
      /fixtureDigest does not match/,
    );
  });

  it("rejects fixture case and schema mismatches", () => {
    const corpus = createCorpus();
    corpus.fixture.case = "another-case";
    corpus.fixture.schemaVersion = 2;
    rewriteFixture(corpus);

    expect(() => verifyIdeRoadmapFixtures({ repoRoot: corpus.root })).toThrow(
      /fixture\.schemaVersion must equal 1/,
    );
    expect(() => verifyIdeRoadmapFixtures({ repoRoot: corpus.root })).toThrow(
      /fixture\.case must equal "example-case"/,
    );
  });

  it("rejects fixture and manifest expected-outcome drift", () => {
    const corpus = createCorpus();
    corpus.fixture.expectedOutcome = { mutationCount: 1 };
    rewriteFixture(corpus);

    expect(() => verifyIdeRoadmapFixtures({ repoRoot: corpus.root })).toThrow(
      /fixture\.expectedOutcome must equal cases\[0\]\.expectedOutcome/,
    );
  });

  it("rejects missing and duplicate test files", () => {
    const missingCorpus = createCorpus();
    missingCorpus.manifest.cases[0].testFiles = [
      "packages/cli/__tests__/unit/missing.test.js",
    ];
    writeManifest(missingCorpus);

    expect(() =>
      verifyIdeRoadmapFixtures({ repoRoot: missingCorpus.root }),
    ).toThrow(/testFiles\[0\] does not exist/);

    const duplicateCorpus = createCorpus();
    duplicateCorpus.manifest.cases[0].testFiles.push(
      duplicateCorpus.testRelative,
    );
    writeManifest(duplicateCorpus);

    expect(() =>
      verifyIdeRoadmapFixtures({ repoRoot: duplicateCorpus.root }),
    ).toThrow(/testFiles contains duplicate value/);
  });

  it("requires every matrix dimension", () => {
    const corpus = createCorpus();
    corpus.manifest.cases[0].matrix.operatingSystems = [];
    writeManifest(corpus);

    expect(() => verifyIdeRoadmapFixtures({ repoRoot: corpus.root })).toThrow(
      /matrix\.operatingSystems must be a non-empty array/,
    );
  });

  it("requires non-empty artifact contracts", () => {
    const corpus = createCorpus();
    corpus.manifest.cases[0].requiredArtifacts = [];
    writeManifest(corpus);

    expect(() => verifyIdeRoadmapFixtures({ repoRoot: corpus.root })).toThrow(
      /requiredArtifacts must be a non-empty array/,
    );
  });

  it("requires the complete release evidence field contract", () => {
    const corpus = createCorpus();
    corpus.manifest.releaseEvidence.requiredFields =
      corpus.manifest.releaseEvidence.requiredFields.filter(
        (field) => field !== "artifactDigests",
      );
    writeManifest(corpus);

    expect(() => verifyIdeRoadmapFixtures({ repoRoot: corpus.root })).toThrow(
      /requiredFields is missing "artifactDigests"/,
    );
  });

  it("requires the versioned trusted runtime policy and status metadata", () => {
    const policyCorpus = createCorpus();
    policyCorpus.manifest.runtimeEvidence.releaseReadiness = "advisory";
    writeManifest(policyCorpus);
    expect(() =>
      verifyIdeRoadmapFixtures({ repoRoot: policyCorpus.root }),
    ).toThrow(/releaseReadiness must equal "selected-complete-matrix-only"/);

    const scopeCorpus = createCorpus();
    scopeCorpus.manifest.runtimeEvidence.verificationScope = "release-ready";
    writeManifest(scopeCorpus);
    expect(() =>
      verifyIdeRoadmapFixtures({ repoRoot: scopeCorpus.root }),
    ).toThrow(
      /verificationScope must equal "trusted-ci-provenance-and-artifact-bytes"/,
    );

    const statusCorpus = createCorpus();
    delete statusCorpus.manifest.cases[0].evidenceStatus;
    writeManifest(statusCorpus);
    expect(() =>
      verifyIdeRoadmapFixtures({ repoRoot: statusCorpus.root }),
    ).toThrow(/evidenceStatus must be one of/);
  });

  it("verifies complete scoped runtime evidence without claiming whole-release readiness", () => {
    const corpus = createCorpus();
    const runtime = createRuntimeEvidence(corpus);

    const result = verifyIdeRoadmapRuntimeEvidence({
      repoRoot: corpus.root,
      evidenceDir: runtime.directory,
      releaseCommit: corpus.manifest.baselineCommit,
      caseIds: ["example-case"],
    });

    expect(result).toMatchObject({
      scope: "selected-cases",
      releaseReady: null,
      releaseCommitAuthority: "caller-asserted-unverified",
      artifactDigestAuthority: "envelope-asserted-unverified",
      selectedCaseIds: ["example-case"],
      evidenceFileCount: 1,
      runCount: 1,
    });
  });

  it("fails closed when untrusted evidence is asked to assert release readiness", () => {
    const corpus = createCorpus();
    const runtime = createRuntimeEvidence(corpus);

    expect(() =>
      verifyIdeRoadmapRuntimeEvidence({
        repoRoot: corpus.root,
        evidenceDir: runtime.directory,
        releaseCommit: corpus.manifest.baselineCommit,
        requireReleaseReady: true,
      }),
    ).toThrow(/caller-supplied GitHub Actions provenance|trustedProvenance/u);
  });

  it("asserts scoped readiness only after exact checkout, provenance, and bytes agree", () => {
    const corpus = createCorpus();
    const runtime = createRuntimeEvidence(corpus, { trusted: true });
    const execFileSync = (_command, args) =>
      args[0] === "rev-parse" ? `${corpus.manifest.baselineCommit}\n` : "";

    const result = verifyIdeRoadmapRuntimeEvidence({
      repoRoot: corpus.root,
      evidenceDir: runtime.directory,
      releaseCommit: corpus.manifest.baselineCommit,
      caseIds: ["example-case"],
      requireReleaseReady: true,
      trustedProvenance: runtime.trustedProvenance,
      execFileSync,
    });

    expect(result).toMatchObject({
      releaseReady: true,
      verificationMode: "release-ready",
      releaseCommitAuthority: "exact-clean-checkout+github-actions",
      artifactDigestAuthority: "path-bytes-rehashed",
      provenanceAuthority: "github-actions-context-matched",
      selectedCaseIds: ["example-case"],
    });
  });

  it("never lets pull-request provenance self-assert release readiness", () => {
    const corpus = createCorpus();
    const runtime = createRuntimeEvidence(corpus, { trusted: true });
    runtime.trustedProvenance.eventName = "pull_request";
    runtime.trustedProvenance.workflowRef =
      "chainlesschain/chainlesschain/.github/workflows/ide-extensions.yml@refs/pull/123/merge";
    runtime.evidence.provenance = structuredClone(runtime.trustedProvenance);
    for (const run of runtime.evidence.runs) {
      run.provenance = structuredClone(runtime.trustedProvenance);
    }
    rewriteRuntimeEvidence(runtime);

    expect(() =>
      verifyIdeRoadmapRuntimeEvidence({
        repoRoot: corpus.root,
        evidenceDir: runtime.directory,
        releaseCommit: corpus.manifest.baselineCommit,
        caseIds: ["example-case"],
        requireReleaseReady: true,
        trustedProvenance: runtime.trustedProvenance,
        execFileSync: (_command, args) =>
          args[0] === "rev-parse" ? `${corpus.manifest.baselineCommit}\n` : "",
      }),
    ).toThrow(/may assert release readiness only/u);

    const advisory = verifyIdeRoadmapRuntimeEvidence({
      repoRoot: corpus.root,
      evidenceDir: runtime.directory,
      releaseCommit: corpus.manifest.baselineCommit,
      caseIds: ["example-case"],
    });
    expect(advisory).toMatchObject({
      releaseReady: null,
      verificationMode: "advisory",
    });
  });

  it("rejects self-consistent provenance from a stale workflow SHA", () => {
    const corpus = createCorpus();
    const runtime = createRuntimeEvidence(corpus, { trusted: true });
    const staleWorkflowSha = "b".repeat(40);
    runtime.trustedProvenance.workflowSha = staleWorkflowSha;
    runtime.evidence.provenance.workflowSha = staleWorkflowSha;
    for (const run of runtime.evidence.runs) {
      run.provenance.workflowSha = staleWorkflowSha;
    }
    rewriteRuntimeEvidence(runtime);

    expect(() =>
      verifyIdeRoadmapRuntimeEvidence({
        repoRoot: corpus.root,
        evidenceDir: runtime.directory,
        releaseCommit: corpus.manifest.baselineCommit,
        caseIds: ["example-case"],
        requireReleaseReady: true,
        trustedProvenance: runtime.trustedProvenance,
        execFileSync: (_command, args) =>
          args[0] === "rev-parse" ? `${corpus.manifest.baselineCommit}\n` : "",
      }),
    ).toThrow(/workflowSha must equal the exact release commit/u);
  });

  it("rejects trusted evidence after artifact bytes or producer identity change", () => {
    const tamperedCorpus = createCorpus();
    const tamperedRuntime = createRuntimeEvidence(tamperedCorpus, {
      trusted: true,
    });
    const artifactPath = path.join(
      tamperedRuntime.directory,
      ...tamperedRuntime.evidence.runs[0].artifactFiles["exact-commit"].split(
        "/",
      ),
    );
    fs.appendFileSync(artifactPath, "tamper", "utf8");
    const exactCheckout = (_command, args) =>
      args[0] === "rev-parse"
        ? `${tamperedCorpus.manifest.baselineCommit}\n`
        : "";
    expect(() =>
      verifyIdeRoadmapRuntimeEvidence({
        repoRoot: tamperedCorpus.root,
        evidenceDir: tamperedRuntime.directory,
        releaseCommit: tamperedCorpus.manifest.baselineCommit,
        caseIds: ["example-case"],
        requireReleaseReady: true,
        trustedProvenance: tamperedRuntime.trustedProvenance,
        execFileSync: exactCheckout,
      }),
    ).toThrow(/artifact byte digest mismatch/u);

    const jobCorpus = createCorpus();
    const jobRuntime = createRuntimeEvidence(jobCorpus, { trusted: true });
    expect(() =>
      verifyIdeRoadmapRuntimeEvidence({
        repoRoot: jobCorpus.root,
        evidenceDir: jobRuntime.directory,
        releaseCommit: jobCorpus.manifest.baselineCommit,
        caseIds: ["example-case"],
        requireReleaseReady: true,
        trustedProvenance: {
          ...jobRuntime.trustedProvenance,
          job: "different-job",
        },
        execFileSync: (_command, args) =>
          args[0] === "rev-parse"
            ? `${jobCorpus.manifest.baselineCommit}\n`
            : "",
      }),
    ).toThrow(/job does not match trusted workflow context/u);
  });

  it("rejects dirty checkout authority and artifact path escape", () => {
    const dirtyCorpus = createCorpus();
    const dirtyRuntime = createRuntimeEvidence(dirtyCorpus, { trusted: true });
    expect(() =>
      verifyIdeRoadmapRuntimeEvidence({
        repoRoot: dirtyCorpus.root,
        evidenceDir: dirtyRuntime.directory,
        releaseCommit: dirtyCorpus.manifest.baselineCommit,
        caseIds: ["example-case"],
        requireReleaseReady: true,
        trustedProvenance: dirtyRuntime.trustedProvenance,
        execFileSync: (_command, args) =>
          args[0] === "rev-parse"
            ? `${dirtyCorpus.manifest.baselineCommit}\n`
            : " M tracked-file\n",
      }),
    ).toThrow(/requires a clean checkout/u);

    const escapeCorpus = createCorpus();
    const escapeRuntime = createRuntimeEvidence(escapeCorpus, {
      trusted: true,
    });
    escapeRuntime.evidence.runs[0].artifactFiles["exact-commit"] =
      "../outside.json";
    rewriteRuntimeEvidence(escapeRuntime);
    expect(() =>
      verifyIdeRoadmapRuntimeEvidence({
        repoRoot: escapeCorpus.root,
        evidenceDir: escapeRuntime.directory,
        releaseCommit: escapeCorpus.manifest.baselineCommit,
        caseIds: ["example-case"],
        requireReleaseReady: true,
        trustedProvenance: escapeRuntime.trustedProvenance,
        execFileSync: (_command, args) =>
          args[0] === "rev-parse"
            ? `${escapeCorpus.manifest.baselineCommit}\n`
            : "",
      }),
    ).toThrow(/normalized repository-relative path|escapes/u);
  });

  it("rejects 99 of 100 independent runs", () => {
    const corpus = createCorpus();
    corpus.manifest.cases[0].minimumIndependentRuns = 100;
    writeManifest(corpus);
    const runtime = createRuntimeEvidence(corpus, { runsPerCell: 99 });

    expect(() =>
      verifyIdeRoadmapRuntimeEvidence({
        repoRoot: corpus.root,
        evidenceDir: runtime.directory,
        releaseCommit: corpus.manifest.baselineCommit,
        caseIds: ["example-case"],
      }),
    ).toThrow(/has 99\/100 independent runs/);
  });

  it("rejects a missing Cartesian matrix cell", () => {
    const corpus = createCorpus();
    corpus.manifest.cases[0].matrix.hosts.push("vscode");
    writeManifest(corpus);
    const runtime = createRuntimeEvidence(corpus, {
      includeCell: ({ host }) => host === "cli",
    });

    expect(() =>
      verifyIdeRoadmapRuntimeEvidence({
        repoRoot: corpus.root,
        evidenceDir: runtime.directory,
        releaseCommit: corpus.manifest.baselineCommit,
        caseIds: ["example-case"],
      }),
    ).toThrow(/host="vscode".*has 0\/1 independent runs/);
  });

  it("rejects duplicate run identifiers", () => {
    const corpus = createCorpus();
    corpus.manifest.cases[0].minimumIndependentRuns = 2;
    writeManifest(corpus);
    const runtime = createRuntimeEvidence(corpus);
    runtime.evidence.runs[1].runId = runtime.evidence.runs[0].runId;
    rewriteRuntimeEvidence(runtime);

    expect(() =>
      verifyIdeRoadmapRuntimeEvidence({
        repoRoot: corpus.root,
        evidenceDir: runtime.directory,
        releaseCommit: corpus.manifest.baselineCommit,
        caseIds: ["example-case"],
      }),
    ).toThrow(/runId duplicates/);
  });

  it("rejects an observed outcome that differs from the manifest contract", () => {
    const corpus = createCorpus();
    const runtime = createRuntimeEvidence(corpus);
    runtime.evidence.runs[0].observedOutcome.mutationCount = 1;
    rewriteRuntimeEvidence(runtime);

    expect(() =>
      verifyIdeRoadmapRuntimeEvidence({
        repoRoot: corpus.root,
        evidenceDir: runtime.directory,
        releaseCommit: corpus.manifest.baselineCommit,
        caseIds: ["example-case"],
      }),
    ).toThrow(/observedOutcome does not match manifest expectedOutcome/);
  });

  it("rejects missing required artifacts and missing artifact digests", () => {
    const artifactCorpus = createCorpus();
    const artifactRuntime = createRuntimeEvidence(artifactCorpus);
    artifactRuntime.evidence.runs[0].artifacts = [];
    rewriteRuntimeEvidence(artifactRuntime);
    expect(() =>
      verifyIdeRoadmapRuntimeEvidence({
        repoRoot: artifactCorpus.root,
        evidenceDir: artifactRuntime.directory,
        releaseCommit: artifactCorpus.manifest.baselineCommit,
        caseIds: ["example-case"],
      }),
    ).toThrow(/artifacts is missing required artifact "exact-commit"/);

    const digestCorpus = createCorpus();
    const digestRuntime = createRuntimeEvidence(digestCorpus);
    delete digestRuntime.evidence.runs[0].artifactDigests["exact-commit"];
    rewriteRuntimeEvidence(digestRuntime);
    expect(() =>
      verifyIdeRoadmapRuntimeEvidence({
        repoRoot: digestCorpus.root,
        evidenceDir: digestRuntime.directory,
        releaseCommit: digestCorpus.manifest.baselineCommit,
        caseIds: ["example-case"],
      }),
    ).toThrow(/missing a valid digest for required artifact "exact-commit"/);
  });

  it("rejects a missing or stale evidence-envelope digest", () => {
    const corpus = createCorpus();
    const runtime = createRuntimeEvidence(corpus);
    runtime.evidence.evidenceDigest = `sha256:${"0".repeat(64)}`;
    writeJson(runtime.filePath, runtime.evidence);

    expect(() =>
      verifyIdeRoadmapRuntimeEvidence({
        repoRoot: corpus.root,
        evidenceDir: runtime.directory,
        releaseCommit: corpus.manifest.baselineCommit,
        caseIds: ["example-case"],
      }),
    ).toThrow(/evidenceDigest does not match its envelope/);
  });

  it("reparses trusted journey bytes and rejects a self-consistent semantic tamper", () => {
    const runtime = createRemoteSshRuntimeCorpus();
    const exactCheckout = (_command, args) =>
      args[0] === "rev-parse"
        ? `${runtime.corpus.manifest.baselineCommit}\n`
        : "";
    const verify = () =>
      verifyIdeRoadmapRuntimeEvidence({
        repoRoot: runtime.corpus.root,
        manifestPath: runtime.corpus.manifestPath,
        evidenceDir: runtime.runtimeDirectory,
        releaseCommit: runtime.corpus.manifest.baselineCommit,
        caseIds: [IDE_ROADMAP_REMOTE_SSH_CONTAINER_CASE],
        requireReleaseReady: true,
        trustedProvenance: runtime.trustedProvenance,
        execFileSync: exactCheckout,
        inspectVsix: runtime.inspectVsix,
        remoteSshTrust: runtime.remoteSshTrust,
      });

    expect(verify()).toMatchObject({
      releaseReady: true,
      verificationMode: "release-ready",
      selectedCaseIds: [IDE_ROADMAP_REMOTE_SSH_CONTAINER_CASE],
    });

    const journey = JSON.parse(fs.readFileSync(runtime.journeyPath, "utf8"));
    const remoteBinding = journey.roadmapArtifacts["remote-environment"];
    const remotePath = path.join(
      path.dirname(runtime.journeyPath),
      ...remoteBinding.path.split("/"),
    );
    const remote = JSON.parse(fs.readFileSync(remotePath, "utf8"));
    remote.journeyPassed = false;
    writeJson(remotePath, remote);
    remoteBinding.sha256 = sha256File(remotePath);
    remoteBinding.bytes = fs.statSync(remotePath).size;
    const remoteRecord = journey.artifacts.find(
      (artifact) => artifact.path === remoteBinding.path,
    );
    remoteRecord.sha256 = remoteBinding.sha256;
    remoteRecord.bytes = remoteBinding.bytes;
    const bundleCore = journey.artifacts
      .map(({ kind, name = null, path: artifactPath, sha256, bytes }) => ({
        kind,
        name,
        path: artifactPath,
        sha256,
        bytes,
      }))
      .sort((left, right) => left.path.localeCompare(right.path));
    journey.artifactBundleDigest = sha256Buffer(
      canonicalJourneyJson(bundleCore),
    );
    const journeyCore = { ...journey };
    delete journeyCore.evidenceDigest;
    journey.evidenceDigest = sha256Buffer(canonicalJourneyJson(journeyCore));
    writeJson(runtime.journeyPath, journey);

    const envelope = JSON.parse(fs.readFileSync(runtime.envelopePath, "utf8"));
    envelope.journeyEvidenceDigest = journey.evidenceDigest;
    envelope.runs[0].journeyEvidenceDigest = journey.evidenceDigest;
    envelope.runs[0].artifactDigests["remote-environment"] =
      remoteBinding.sha256;
    envelope.runs[0].artifactDigests["journey-evidence"] = sha256File(
      runtime.journeyPath,
    );
    envelope.evidenceDigest = createIdeRoadmapRuntimeEvidenceDigest(envelope);
    writeJson(runtime.envelopePath, envelope);

    expect(verify).toThrow(
      /claims do not match rederived artifact state|cannot be rederived from journey artifact bytes/u,
    );
  });

  it("accepts a filesystem alias above the runtime evidence root", () => {
    const aliasContainer = temporaryRoot();
    const canonicalTemp = path.join(aliasContainer, "canonical-temp");
    const aliasTemp = path.join(aliasContainer, "alias-temp");
    fs.mkdirSync(canonicalTemp);
    fs.symlinkSync(
      canonicalTemp,
      aliasTemp,
      process.platform === "win32" ? "junction" : "dir",
    );
    const previousTemp = Object.fromEntries(
      ["TMPDIR", "TMP", "TEMP"].map((name) => [name, process.env[name]]),
    );
    Object.assign(process.env, {
      TMPDIR: aliasTemp,
      TMP: aliasTemp,
      TEMP: aliasTemp,
    });

    try {
      const runtime = createRemoteSshRuntimeCorpus();
      expect(path.resolve(runtime.runtimeDirectory)).not.toBe(
        fs.realpathSync(runtime.runtimeDirectory),
      );
      expect(
        verifyIdeRoadmapRuntimeEvidence({
          repoRoot: runtime.corpus.root,
          manifestPath: runtime.corpus.manifestPath,
          evidenceDir: runtime.runtimeDirectory,
          releaseCommit: runtime.corpus.manifest.baselineCommit,
          caseIds: [IDE_ROADMAP_REMOTE_SSH_CONTAINER_CASE],
          requireReleaseReady: true,
          trustedProvenance: runtime.trustedProvenance,
          execFileSync: (_command, args) =>
            args[0] === "rev-parse"
              ? `${runtime.corpus.manifest.baselineCommit}\n`
              : "",
          inspectVsix: runtime.inspectVsix,
          remoteSshTrust: runtime.remoteSshTrust,
        }),
      ).toMatchObject({
        releaseReady: true,
        verificationMode: "release-ready",
      });
    } finally {
      for (const [name, value] of Object.entries(previousTemp)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("rejects an envelope that replaces the journey evidence digest", () => {
    const runtime = createRemoteSshRuntimeCorpus();
    const envelope = JSON.parse(fs.readFileSync(runtime.envelopePath, "utf8"));
    const substitutedDigest = `sha256:${"f".repeat(64)}`;
    envelope.journeyEvidenceDigest = substitutedDigest;
    envelope.runs[0].journeyEvidenceDigest = substitutedDigest;
    envelope.evidenceDigest = createIdeRoadmapRuntimeEvidenceDigest(envelope);
    writeJson(runtime.envelopePath, envelope);

    expect(() =>
      verifyIdeRoadmapRuntimeEvidence({
        repoRoot: runtime.corpus.root,
        manifestPath: runtime.corpus.manifestPath,
        evidenceDir: runtime.runtimeDirectory,
        releaseCommit: runtime.corpus.manifest.baselineCommit,
        caseIds: [IDE_ROADMAP_REMOTE_SSH_CONTAINER_CASE],
        requireReleaseReady: true,
        trustedProvenance: runtime.trustedProvenance,
        execFileSync: (_command, args) =>
          args[0] === "rev-parse"
            ? `${runtime.corpus.manifest.baselineCommit}\n`
            : "",
        inspectVsix: runtime.inspectVsix,
        remoteSshTrust: runtime.remoteSshTrust,
      }),
    ).toThrow(/journey-evidence identity, result, evidenceDigest/u);
  });

  it("aggregate cross-validates the candidate manifest against release identity", () => {
    const runtime = createRemoteSshRuntimeCorpus();
    const journey = JSON.parse(fs.readFileSync(runtime.journeyPath, "utf8"));
    const binding = journey.roadmapArtifacts["candidate-manifest"];
    const manifestPath = path.join(
      path.dirname(runtime.journeyPath),
      ...binding.path.split("/"),
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.commit = "d".repeat(40);
    writeJson(manifestPath, manifest);
    resealRemoteSshJourneyArtifact(runtime, "candidate-manifest");

    expect(() =>
      verifyIdeRoadmapRuntimeEvidence({
        repoRoot: runtime.corpus.root,
        manifestPath: runtime.corpus.manifestPath,
        evidenceDir: runtime.runtimeDirectory,
        releaseCommit: runtime.corpus.manifest.baselineCommit,
        caseIds: [IDE_ROADMAP_REMOTE_SSH_CONTAINER_CASE],
        requireReleaseReady: true,
        trustedProvenance: runtime.trustedProvenance,
        execFileSync: (_command, args) =>
          args[0] === "rev-parse"
            ? `${runtime.corpus.manifest.baselineCommit}\n`
            : "",
        inspectVsix: runtime.inspectVsix,
        remoteSshTrust: runtime.remoteSshTrust,
      }),
    ).toThrow(/candidate-manifest does not bind the target VSIX bytes/u);
  });

  it("rejects uppercase or whitespace-padded release commits", () => {
    const corpus = createCorpus();
    const runtime = createRuntimeEvidence(corpus);
    for (const releaseCommit of [
      corpus.manifest.baselineCommit.toUpperCase(),
      ` ${corpus.manifest.baselineCommit}`,
      `${corpus.manifest.baselineCommit} `,
    ]) {
      expect(() =>
        verifyIdeRoadmapRuntimeEvidence({
          repoRoot: corpus.root,
          evidenceDir: runtime.directory,
          releaseCommit,
          caseIds: ["example-case"],
        }),
      ).toThrow(/exact lowercase 40-character Git OID/);
    }
  });
});
