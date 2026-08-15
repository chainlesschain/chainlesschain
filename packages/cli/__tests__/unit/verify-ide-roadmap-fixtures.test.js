import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  IDE_ROADMAP_MANIFEST_VERSION,
  IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA,
  IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA_VERSION,
  IDE_ROADMAP_SCHEMA_VERSION,
  REQUIRED_RELEASE_EVIDENCE_FIELDS,
  createIdeRoadmapRuntimeEvidenceDigest,
  verifyIdeRoadmapFixtures,
  verifyIdeRoadmapRuntimeEvidence,
} from "../../scripts/verify-ide-roadmap-fixtures.mjs";

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
      verificationScope: "structural-envelope-only",
      releaseReadiness: "unsupported-without-trusted-provenance",
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
  const evidence = {
    schema: IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA,
    schemaVersion: IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA_VERSION,
    manifestVersion: IDE_ROADMAP_MANIFEST_VERSION,
    caseId: roadmapCase.id,
    releaseCommit: corpus.manifest.baselineCommit,
    generatedAt: "2026-08-09T00:01:00.000Z",
    runs,
  };
  evidence.evidenceDigest = createIdeRoadmapRuntimeEvidenceDigest(evidence);
  const directory = runtimeEvidenceDirectory(corpus);
  const filePath = path.join(directory, `${roadmapCase.id}.json`);
  writeJson(filePath, evidence);
  return { directory, evidence, filePath };
}

function rewriteRuntimeEvidence(runtime) {
  runtime.evidence.evidenceDigest = createIdeRoadmapRuntimeEvidenceDigest(
    runtime.evidence,
  );
  writeJson(runtime.filePath, runtime.evidence);
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
      manifestVersion: "1.3.0",
      caseCount: 9,
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
      /manifestVersion must equal supported version "1\.3\.0"/,
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

  it("requires explicit structural-only runtime policy and status metadata", () => {
    const policyCorpus = createCorpus();
    policyCorpus.manifest.runtimeEvidence.releaseReadiness = "advisory";
    writeManifest(policyCorpus);
    expect(() =>
      verifyIdeRoadmapFixtures({ repoRoot: policyCorpus.root }),
    ).toThrow(
      /runtimeEvidence\.releaseReadiness must equal "unsupported-without-trusted-provenance"/,
    );

    const scopeCorpus = createCorpus();
    scopeCorpus.manifest.runtimeEvidence.verificationScope = "release-ready";
    writeManifest(scopeCorpus);
    expect(() =>
      verifyIdeRoadmapFixtures({ repoRoot: scopeCorpus.root }),
    ).toThrow(
      /runtimeEvidence\.verificationScope must equal "structural-envelope-only"/,
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

  it("fails closed when structural evidence is asked to assert release readiness", () => {
    const corpus = createCorpus();
    const runtime = createRuntimeEvidence(corpus);

    expect(() =>
      verifyIdeRoadmapRuntimeEvidence({
        repoRoot: corpus.root,
        evidenceDir: runtime.directory,
        releaseCommit: corpus.manifest.baselineCommit,
        requireReleaseReady: true,
      }),
    ).toThrow(
      /release-readiness verification is unsupported until evidence is bound to trusted CI provenance/,
    );
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
