import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const IDE_ROADMAP_SCHEMA_VERSION = 1;
export const IDE_ROADMAP_MANIFEST_VERSION = "1.1.2";
export const IDE_ROADMAP_MANIFEST_PATH =
  "tests/fixtures/ide-roadmap/manifest.json";

export const REQUIRED_RELEASE_EVIDENCE_FIELDS = Object.freeze([
  "manifestVersion",
  "releaseCommit",
  "hostVersion",
  "cliVersion",
  "operatingSystem",
  "transport",
  "startedAt",
  "finishedAt",
  "result",
  "artifactDigests",
]);

const FIXTURE_ROOT = "tests/fixtures/ide-roadmap";
const MATRIX_DIMENSIONS = Object.freeze([
  "hosts",
  "operatingSystems",
  "transports",
]);
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const GIT_OID_PATTERN = /^[0-9a-f]{40}$/;
const TEST_FILE_PATTERN = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/;
const DEFAULT_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export class IdeRoadmapFixtureContractError extends Error {
  constructor(issues) {
    super(
      `IDE roadmap fixture contract verification failed:\n${issues
        .map((issue) => `- ${issue}`)
        .join("\n")}`,
    );
    this.name = "IdeRoadmapFixtureContractError";
    this.issues = Object.freeze([...issues]);
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isWithin(boundary, candidate) {
  const relative = path.relative(boundary, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function sha256File(filePath) {
  return `sha256:${createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex")}`;
}

function readJson(filePath, label, issues) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    issues.push(`${label} is not valid JSON: ${error.message}`);
    return null;
  }
}

function validatePortableRelativePath(value, label, issues) {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`${label} must be a non-empty repository-relative path`);
    return null;
  }
  if (
    path.isAbsolute(value) ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.includes("\\") ||
    value === "." ||
    value === ".." ||
    value.startsWith("../") ||
    path.posix.normalize(value) !== value
  ) {
    issues.push(
      `${label} must be a normalized repository-relative path using forward slashes`,
    );
    return null;
  }
  return value;
}

function resolveExistingFile({
  repoRoot,
  boundary,
  relativePath,
  label,
  issues,
}) {
  const portablePath = validatePortableRelativePath(
    relativePath,
    label,
    issues,
  );
  if (!portablePath) return null;

  const absolutePath = path.resolve(repoRoot, ...portablePath.split("/"));
  if (!isWithin(boundary, absolutePath)) {
    issues.push(
      `${label} must stay within ${path.relative(repoRoot, boundary)}`,
    );
    return null;
  }
  if (!fs.existsSync(absolutePath)) {
    issues.push(`${label} does not exist: ${portablePath}`);
    return null;
  }
  if (!fs.statSync(absolutePath).isFile()) {
    issues.push(`${label} must identify a file: ${portablePath}`);
    return null;
  }

  const realBoundary = fs.realpathSync(boundary);
  const realFile = fs.realpathSync(absolutePath);
  if (!isWithin(realBoundary, realFile)) {
    issues.push(
      `${label} resolves outside its allowed boundary: ${portablePath}`,
    );
    return null;
  }
  return absolutePath;
}

function validateStringArray(value, label, issues) {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(`${label} must be a non-empty array`);
    return [];
  }

  const seen = new Set();
  const valid = [];
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      issues.push(`${label}[${index}] must be a non-empty string`);
      return;
    }
    if (entry !== entry.trim()) {
      issues.push(`${label}[${index}] may not have surrounding whitespace`);
      return;
    }
    if (seen.has(entry)) {
      issues.push(`${label} contains duplicate value ${JSON.stringify(entry)}`);
      return;
    }
    seen.add(entry);
    valid.push(entry);
  });
  return valid;
}

function validateReleaseEvidence(releaseEvidence, issues) {
  if (!isRecord(releaseEvidence)) {
    issues.push("releaseEvidence must be an object");
    return;
  }
  if (releaseEvidence.commitSource !== "git-head-at-run") {
    issues.push('releaseEvidence.commitSource must equal "git-head-at-run"');
  }

  const fields = validateStringArray(
    releaseEvidence.requiredFields,
    "releaseEvidence.requiredFields",
    issues,
  );
  const fieldSet = new Set(fields);
  for (const field of REQUIRED_RELEASE_EVIDENCE_FIELDS) {
    if (!fieldSet.has(field)) {
      issues.push(
        `releaseEvidence.requiredFields is missing ${JSON.stringify(field)}`,
      );
    }
  }
}

function validateCase({
  entry,
  index,
  repoRoot,
  fixtureBoundary,
  seenCaseIds,
  uniqueTestFiles,
  issues,
}) {
  const label = `cases[${index}]`;
  if (!isRecord(entry)) {
    issues.push(`${label} must be an object`);
    return null;
  }

  if (typeof entry.id !== "string" || entry.id.trim() === "") {
    issues.push(`${label}.id must be a non-empty string`);
  } else if (seenCaseIds.has(entry.id)) {
    issues.push(`${label}.id duplicates ${JSON.stringify(entry.id)}`);
  } else {
    seenCaseIds.add(entry.id);
  }
  if (typeof entry.priority !== "string" || entry.priority.trim() === "") {
    issues.push(`${label}.priority must be a non-empty string`);
  }
  if (typeof entry.required !== "boolean") {
    issues.push(`${label}.required must be a boolean`);
  }
  if (!Number.isSafeInteger(entry.seed) || entry.seed < 0) {
    issues.push(`${label}.seed must be a non-negative safe integer`);
  }
  if (
    !Number.isSafeInteger(entry.minimumIndependentRuns) ||
    entry.minimumIndependentRuns < 1
  ) {
    issues.push(`${label}.minimumIndependentRuns must be a positive integer`);
  }
  if (!isRecord(entry.expectedOutcome)) {
    issues.push(`${label}.expectedOutcome must be an object`);
  }

  if (!isRecord(entry.matrix)) {
    issues.push(`${label}.matrix must be an object`);
  } else {
    for (const dimension of MATRIX_DIMENSIONS) {
      validateStringArray(
        entry.matrix[dimension],
        `${label}.matrix.${dimension}`,
        issues,
      );
    }
  }

  validateStringArray(
    entry.requiredArtifacts,
    `${label}.requiredArtifacts`,
    issues,
  );

  const fixturePath = resolveExistingFile({
    repoRoot,
    boundary: fixtureBoundary,
    relativePath: entry.fixture,
    label: `${label}.fixture`,
    issues,
  });
  let fixture = null;
  if (fixturePath) {
    fixture = readJson(fixturePath, `${label}.fixture`, issues);
  }

  if (typeof entry.fixtureDigest !== "string") {
    issues.push(`${label}.fixtureDigest must be a string`);
  } else if (!SHA256_PATTERN.test(entry.fixtureDigest)) {
    issues.push(`${label}.fixtureDigest must be a lowercase SHA-256 digest`);
  } else if (fixturePath) {
    const actualDigest = sha256File(fixturePath);
    if (entry.fixtureDigest !== actualDigest) {
      issues.push(
        `${label}.fixtureDigest does not match ${entry.fixture}: expected ${entry.fixtureDigest}, actual ${actualDigest}`,
      );
    }
  }

  if (fixture) {
    if (fixture.schemaVersion !== IDE_ROADMAP_SCHEMA_VERSION) {
      issues.push(
        `${label}.fixture.schemaVersion must equal ${IDE_ROADMAP_SCHEMA_VERSION}`,
      );
    }
    if (fixture.case !== entry.id) {
      issues.push(
        `${label}.fixture.case must equal ${JSON.stringify(entry.id)}`,
      );
    }
  }

  const testFiles = validateStringArray(
    entry.testFiles,
    `${label}.testFiles`,
    issues,
  );
  for (const [testIndex, testFile] of testFiles.entries()) {
    const testLabel = `${label}.testFiles[${testIndex}]`;
    if (!TEST_FILE_PATTERN.test(testFile)) {
      issues.push(`${testLabel} must identify a test or spec file`);
    }
    const resolvedTest = resolveExistingFile({
      repoRoot,
      boundary: repoRoot,
      relativePath: testFile,
      label: testLabel,
      issues,
    });
    if (resolvedTest) uniqueTestFiles.add(testFile);
  }

  return {
    id: entry.id,
    fixture: entry.fixture,
    testFileCount: testFiles.length,
  };
}

export function verifyIdeRoadmapFixtures({
  repoRoot = DEFAULT_REPO_ROOT,
  manifestPath = IDE_ROADMAP_MANIFEST_PATH,
} = {}) {
  const issues = [];
  const absoluteRepoRoot = path.resolve(repoRoot);
  if (!fs.existsSync(absoluteRepoRoot)) {
    throw new IdeRoadmapFixtureContractError([
      `repository root does not exist: ${absoluteRepoRoot}`,
    ]);
  }
  if (!fs.statSync(absoluteRepoRoot).isDirectory()) {
    throw new IdeRoadmapFixtureContractError([
      `repository root must be a directory: ${absoluteRepoRoot}`,
    ]);
  }

  const fixtureBoundary = path.resolve(
    absoluteRepoRoot,
    ...FIXTURE_ROOT.split("/"),
  );
  const absoluteManifestPath = path.isAbsolute(manifestPath)
    ? manifestPath
    : path.resolve(absoluteRepoRoot, ...manifestPath.split("/"));
  if (!isWithin(absoluteRepoRoot, absoluteManifestPath)) {
    throw new IdeRoadmapFixtureContractError([
      "manifest path must stay within the repository root",
    ]);
  }
  if (!fs.existsSync(absoluteManifestPath)) {
    throw new IdeRoadmapFixtureContractError([
      `manifest does not exist: ${absoluteManifestPath}`,
    ]);
  }
  if (!fs.existsSync(fixtureBoundary)) {
    throw new IdeRoadmapFixtureContractError([
      `fixture root does not exist: ${fixtureBoundary}`,
    ]);
  }
  if (!fs.statSync(absoluteManifestPath).isFile()) {
    throw new IdeRoadmapFixtureContractError([
      `manifest must be a file: ${absoluteManifestPath}`,
    ]);
  }
  if (!fs.statSync(fixtureBoundary).isDirectory()) {
    throw new IdeRoadmapFixtureContractError([
      `fixture root must be a directory: ${fixtureBoundary}`,
    ]);
  }

  const realRepoRoot = fs.realpathSync(absoluteRepoRoot);
  const realFixtureBoundary = fs.realpathSync(fixtureBoundary);
  const realManifestPath = fs.realpathSync(absoluteManifestPath);
  if (!isWithin(realRepoRoot, realFixtureBoundary)) {
    throw new IdeRoadmapFixtureContractError([
      "fixture root resolves outside the repository root",
    ]);
  }
  if (!isWithin(realRepoRoot, realManifestPath)) {
    throw new IdeRoadmapFixtureContractError([
      "manifest resolves outside the repository root",
    ]);
  }

  const manifest = readJson(absoluteManifestPath, "manifest", issues);
  if (!isRecord(manifest)) {
    if (issues.length === 0) issues.push("manifest must be an object");
    throw new IdeRoadmapFixtureContractError(issues);
  }

  if (manifest.schemaVersion !== IDE_ROADMAP_SCHEMA_VERSION) {
    issues.push(
      `manifest.schemaVersion must equal supported version ${IDE_ROADMAP_SCHEMA_VERSION}`,
    );
  }
  if (manifest.manifestVersion !== IDE_ROADMAP_MANIFEST_VERSION) {
    issues.push(
      `manifest.manifestVersion must equal supported version ${JSON.stringify(IDE_ROADMAP_MANIFEST_VERSION)}`,
    );
  }
  if (
    typeof manifest.baselineCommit !== "string" ||
    !GIT_OID_PATTERN.test(manifest.baselineCommit)
  ) {
    issues.push(
      "manifest.baselineCommit must be a lowercase 40-character Git OID",
    );
  }
  validateReleaseEvidence(manifest.releaseEvidence, issues);

  if (!Array.isArray(manifest.cases) || manifest.cases.length === 0) {
    issues.push("manifest.cases must be a non-empty array");
  }

  const seenCaseIds = new Set();
  const uniqueTestFiles = new Set();
  const cases = Array.isArray(manifest.cases)
    ? manifest.cases
        .map((entry, index) =>
          validateCase({
            entry,
            index,
            repoRoot: absoluteRepoRoot,
            fixtureBoundary,
            seenCaseIds,
            uniqueTestFiles,
            issues,
          }),
        )
        .filter(Boolean)
    : [];

  if (issues.length > 0) {
    throw new IdeRoadmapFixtureContractError(issues);
  }

  return Object.freeze({
    schemaVersion: manifest.schemaVersion,
    manifestVersion: manifest.manifestVersion,
    baselineCommit: manifest.baselineCommit,
    caseCount: cases.length,
    testFileCount: uniqueTestFiles.size,
    cases: Object.freeze(cases.map((entry) => Object.freeze(entry))),
  });
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  try {
    const result = verifyIdeRoadmapFixtures();
    console.log(
      `Verified IDE roadmap fixture contract ${result.manifestVersion}: ` +
        `${result.caseCount} cases and ${result.testFileCount} referenced test files.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
