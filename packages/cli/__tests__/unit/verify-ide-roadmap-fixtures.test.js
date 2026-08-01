import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  IDE_ROADMAP_MANIFEST_VERSION,
  IDE_ROADMAP_SCHEMA_VERSION,
  REQUIRED_RELEASE_EVIDENCE_FIELDS,
  verifyIdeRoadmapFixtures,
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
    cases: [
      {
        id: "example-case",
        priority: "P0-S",
        required: true,
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
      manifestVersion: "1.1.0",
      caseCount: 7,
      testFileCount: 25,
    });
    expect(result.cases.map((entry) => entry.id)).toEqual([
      "s0-plan-ceiling",
      "s0-authority-failures",
      "s0-skill-mcp",
      "s0-subtree-preflight",
      "s0-persistence-replay",
      "s0-semantic-handoff",
      "p0-host-evidence",
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
      /manifestVersion must equal supported version "1\.1\.0"/,
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
});
