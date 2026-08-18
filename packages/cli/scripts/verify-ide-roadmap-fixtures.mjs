import { createHash } from "node:crypto";
import { execFileSync as nodeExecFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  IDE_JOURNEY_EVIDENCE_SCHEMA,
  IDE_JOURNEY_EVIDENCE_VERSION,
  canonicalJson as canonicalJourneyJson,
  isStrictSemver,
  sha256Buffer,
} from "../../../scripts/ide-journey-evidence.mjs";
import { inspectVsixReleaseArtifact } from "../../vscode-extension/scripts/vsix-release-artifact.mjs";

export const IDE_ROADMAP_SCHEMA_VERSION = 1;
export const IDE_ROADMAP_MANIFEST_VERSION = "1.9.39";
export const IDE_ROADMAP_MANIFEST_PATH =
  "tests/fixtures/ide-roadmap/manifest.json";
export const IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA =
  "chainlesschain.ide-roadmap-runtime-evidence.v1";
export const IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA_VERSION = 1;

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
  "artifactFiles",
  "provenance",
]);

export const IDE_ROADMAP_TRUSTED_PROVIDER = "github-actions";
export const IDE_ROADMAP_TRUSTED_WORKFLOW =
  ".github/workflows/ide-extensions.yml";
export const IDE_ROADMAP_REMOTE_SSH_CONTAINER_CASE =
  "q4a-vscode-remote-ssh-container";
export const IDE_ROADMAP_REMOTE_SSH_JOURNEY =
  "vscode-installed-vsix-remote-ssh-container-host-api-multiroot-control";
export const IDE_ROADMAP_REMOTE_SSH_VERSION = "0.120.0";
export const IDE_ROADMAP_REMOTE_SSH_SOURCE =
  "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/ms-vscode-remote/vsextensions/remote-ssh/0.120.0/vspackage";
export const IDE_ROADMAP_REMOTE_SSH_SHA256 =
  "sha256:0fd6262ca183b486f6c067cb3516dccea2f87f32c049b642ff9eb77b0cea195d";
export const IDE_ROADMAP_REMOTE_SSH_TRANSPORT_SHA256 =
  "sha256:4caa944dc6c81c8e1a345f3aefed2c0b8efacfe91ba46dff04cb6da2238b949e";
export const IDE_ROADMAP_REMOTE_CONTAINER_IMAGE =
  "ubuntu@sha256:019e8eb29a85e74d64925745884f2ec79aa27e3feab36353d24656f4d6b89467";
export const IDE_ROADMAP_REMOTE_SSH_TRUST = Object.freeze({
  id: "ms-vscode-remote.remote-ssh",
  version: IDE_ROADMAP_REMOTE_SSH_VERSION,
  source: IDE_ROADMAP_REMOTE_SSH_SOURCE,
  transportSha256: IDE_ROADMAP_REMOTE_SSH_TRANSPORT_SHA256,
  sha256: IDE_ROADMAP_REMOTE_SSH_SHA256,
});

const FIXTURE_ROOT = "tests/fixtures/ide-roadmap";
const MATRIX_DIMENSIONS = Object.freeze([
  "hosts",
  "operatingSystems",
  "transports",
]);
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const GIT_OID_PATTERN = /^[0-9a-f]{40}$/;
const SHA_OR_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const POSITIVE_INTEGER_TEXT = /^[1-9]\d*$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const JOB_PATTERN = /^[A-Za-z0-9_-]+$/;
const CREDENTIAL_TOKEN_PATTERN =
  /\b(?:(?:ovsxat_|github_pat_|gh[pousr]_|npm_)[A-Za-z0-9._-]{8,}|glpat-[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|sk-[A-Za-z0-9._-]{8,}|AKIA[0-9A-Z]{16})\b/gu;
const CANDIDATE_MANIFEST_FIELDS = Object.freeze([
  "artifact",
  "bytes",
  "commit",
  "createdAt",
  "package",
  "publisher",
  "schema",
  "sha256",
  "sha512",
  "version",
  "vsixmanifestIdentity",
  "workflowRun",
]);
const TEST_FILE_PATTERN =
  /(?:\.(?:test|spec)\.(?:[cm]?[jt]sx?)|(?:Test|Tests|Spec)\.(?:java|kt))$/;
const EVIDENCE_STATUSES = new Set(["pending", "external-evidence-required"]);
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

export class IdeRoadmapRuntimeEvidenceError extends Error {
  constructor(issues) {
    super(
      `IDE roadmap runtime evidence verification failed:\n${issues
        .map((issue) => `- ${issue}`)
        .join("\n")}`,
    );
    this.name = "IdeRoadmapRuntimeEvidenceError";
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

function sha512File(filePath) {
  return createHash("sha512").update(fs.readFileSync(filePath)).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256Json(value) {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(value))
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

function validateRuntimeEvidenceContract(runtimeEvidence, issues) {
  if (!isRecord(runtimeEvidence)) {
    issues.push("runtimeEvidence must be an object");
    return;
  }
  if (runtimeEvidence.schema !== IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA) {
    issues.push(
      `runtimeEvidence.schema must equal ${JSON.stringify(IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA)}`,
    );
  }
  if (runtimeEvidence.evidenceSource !== "external-ci-artifacts") {
    issues.push(
      'runtimeEvidence.evidenceSource must equal "external-ci-artifacts"',
    );
  }
  if (
    runtimeEvidence.verificationScope !==
    "trusted-ci-provenance-and-artifact-bytes"
  ) {
    issues.push(
      'runtimeEvidence.verificationScope must equal "trusted-ci-provenance-and-artifact-bytes"',
    );
  }
  if (runtimeEvidence.releaseReadiness !== "selected-complete-matrix-only") {
    issues.push(
      'runtimeEvidence.releaseReadiness must equal "selected-complete-matrix-only"',
    );
  }
  if (runtimeEvidence.trustedProvider !== IDE_ROADMAP_TRUSTED_PROVIDER) {
    issues.push(
      `runtimeEvidence.trustedProvider must equal ${JSON.stringify(IDE_ROADMAP_TRUSTED_PROVIDER)}`,
    );
  }
  if (runtimeEvidence.trustedWorkflow !== IDE_ROADMAP_TRUSTED_WORKFLOW) {
    issues.push(
      `runtimeEvidence.trustedWorkflow must equal ${JSON.stringify(IDE_ROADMAP_TRUSTED_WORKFLOW)}`,
    );
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
  if (!EVIDENCE_STATUSES.has(entry.evidenceStatus)) {
    issues.push(
      `${label}.evidenceStatus must be one of ${[...EVIDENCE_STATUSES]
        .map((value) => JSON.stringify(value))
        .join(", ")}`,
    );
  }
  if (
    typeof entry.evidenceNotes !== "string" ||
    entry.evidenceNotes.trim() === ""
  ) {
    issues.push(`${label}.evidenceNotes must be a non-empty string`);
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
    if (
      fixture.expectedOutcome != null &&
      canonicalJson(fixture.expectedOutcome) !==
        canonicalJson(entry.expectedOutcome)
    ) {
      issues.push(
        `${label}.fixture.expectedOutcome must equal ${label}.expectedOutcome`,
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
    priority: entry.priority,
    required: entry.required,
    evidenceStatus: entry.evidenceStatus,
    evidenceNotes: entry.evidenceNotes,
    fixture: entry.fixture,
    minimumIndependentRuns: entry.minimumIndependentRuns,
    matrix: isRecord(entry.matrix)
      ? Object.fromEntries(
          MATRIX_DIMENSIONS.map((dimension) => [
            dimension,
            Array.isArray(entry.matrix[dimension])
              ? [...entry.matrix[dimension]]
              : [],
          ]),
        )
      : null,
    expectedOutcome: isRecord(entry.expectedOutcome)
      ? structuredClone(entry.expectedOutcome)
      : null,
    requiredArtifacts: Array.isArray(entry.requiredArtifacts)
      ? [...entry.requiredArtifacts]
      : [],
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
  validateRuntimeEvidenceContract(manifest.runtimeEvidence, issues);

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
    requiredCaseCount: cases.filter((entry) => entry.required).length,
    releaseReadiness: Object.freeze({
      status: "not-evaluated",
      evidenceSchema: IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA,
    }),
    cases: Object.freeze(
      cases.map((entry) =>
        Object.freeze({
          ...entry,
          matrix: entry.matrix
            ? Object.freeze(
                Object.fromEntries(
                  Object.entries(entry.matrix).map(([key, value]) => [
                    key,
                    Object.freeze(value),
                  ]),
                ),
              )
            : null,
          expectedOutcome: entry.expectedOutcome
            ? Object.freeze(entry.expectedOutcome)
            : null,
          requiredArtifacts: Object.freeze(entry.requiredArtifacts),
        }),
      ),
    ),
  });
}

export function createIdeRoadmapRuntimeEvidenceDigest(evidence) {
  if (!isRecord(evidence)) {
    throw new TypeError("runtime evidence must be an object");
  }
  const core = { ...evidence };
  delete core.evidenceDigest;
  return sha256Json(core);
}

function validateExactString(value, label, issues) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value !== value.trim()
  ) {
    issues.push(
      `${label} must be a non-empty string without surrounding whitespace`,
    );
    return null;
  }
  return value;
}

function validateTimestamp(value, label, issues) {
  const exact = validateExactString(value, label, issues);
  if (!exact) return null;
  const milliseconds = Date.parse(exact);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== exact
  ) {
    issues.push(`${label} must be an exact ISO-8601 UTC timestamp`);
    return null;
  }
  return milliseconds;
}

function matrixCellKey(host, operatingSystem, transport) {
  return `${host}\u0000${operatingSystem}\u0000${transport}`;
}

function matrixCellLabel(host, operatingSystem, transport) {
  return `host=${JSON.stringify(host)}, operatingSystem=${JSON.stringify(
    operatingSystem,
  )}, transport=${JSON.stringify(transport)}`;
}

function expectedMatrixCells(entry) {
  const cells = [];
  for (const host of entry.matrix.hosts) {
    for (const operatingSystem of entry.matrix.operatingSystems) {
      for (const transport of entry.matrix.transports) {
        cells.push({
          host,
          operatingSystem,
          transport,
          key: matrixCellKey(host, operatingSystem, transport),
        });
      }
    }
  }
  return cells;
}

function listRuntimeEvidenceFiles(directory, issues) {
  const root = path.resolve(directory);
  if (!fs.existsSync(root)) {
    issues.push(`runtime evidence directory does not exist: ${root}`);
    return [];
  }
  if (!fs.statSync(root).isDirectory()) {
    issues.push(`runtime evidence path must be a directory: ${root}`);
    return [];
  }
  const realRoot = fs.realpathSync(root);
  const files = [];
  const visit = (current) => {
    for (const entry of fs
      .readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const candidate = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        issues.push(
          `runtime evidence may not contain symbolic links: ${path.relative(root, candidate)}`,
        );
        continue;
      }
      if (entry.isDirectory()) {
        const realDirectory = fs.realpathSync(candidate);
        if (!isWithin(realRoot, realDirectory)) {
          issues.push(
            `runtime evidence directory escapes its root: ${path.relative(root, candidate)}`,
          );
          continue;
        }
        visit(candidate);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        const realFile = fs.realpathSync(candidate);
        if (!isWithin(realRoot, realFile)) {
          issues.push(
            `runtime evidence file escapes its root: ${path.relative(root, candidate)}`,
          );
          continue;
        }
        files.push(candidate);
      }
    }
  };
  visit(root);
  return files;
}

function validateEvidenceArtifactFile({
  evidenceRoot,
  documentPath,
  relativePath,
  expectedDigest,
  label,
  issues,
}) {
  const portable = validatePortableRelativePath(relativePath, label, issues);
  if (!portable) return null;
  const documentDirectory = path.dirname(documentPath);
  const candidate = path.resolve(documentDirectory, ...portable.split("/"));
  const root = path.resolve(evidenceRoot);
  const canonicalRoot = fs.realpathSync(root);
  const canonicalDocumentDirectory = fs.realpathSync(documentDirectory);
  const canonicalCandidate = path.resolve(
    canonicalDocumentDirectory,
    ...portable.split("/"),
  );
  if (!isWithin(canonicalRoot, canonicalCandidate)) {
    issues.push(`${label} escapes the runtime evidence directory`);
    return null;
  }
  let cursor = documentDirectory;
  for (const segment of portable.split("/")) {
    cursor = path.join(cursor, segment);
    const stats = fs.lstatSync(cursor, { throwIfNoEntry: false });
    if (!stats) {
      issues.push(`${label} does not exist: ${portable}`);
      return null;
    }
    if (stats.isSymbolicLink()) {
      issues.push(`${label} may not traverse a symbolic link: ${portable}`);
      return null;
    }
  }
  const stats = fs.statSync(candidate, { throwIfNoEntry: false });
  if (!stats?.isFile()) {
    issues.push(`${label} must identify a regular file: ${portable}`);
    return null;
  }
  const realCandidate = fs.realpathSync(candidate);
  if (!isWithin(canonicalRoot, realCandidate)) {
    issues.push(`${label} resolves outside the runtime evidence directory`);
    return null;
  }
  const actualDigest = sha256File(realCandidate);
  if (actualDigest !== expectedDigest) {
    issues.push(`${label} artifact byte digest mismatch`);
    return null;
  }
  return realCandidate;
}

function validateTrustedProvenance(value, label, issues) {
  if (!isRecord(value)) {
    issues.push(`${label} must be an object`);
    return null;
  }
  const provenance = {
    provider: validateExactString(value.provider, `${label}.provider`, issues),
    repository: validateExactString(
      value.repository,
      `${label}.repository`,
      issues,
    ),
    workflowRef: validateExactString(
      value.workflowRef,
      `${label}.workflowRef`,
      issues,
    ),
    workflowSha: validateExactString(
      value.workflowSha,
      `${label}.workflowSha`,
      issues,
    ),
    runId: validateExactString(value.runId, `${label}.runId`, issues),
    runAttempt: validateExactString(
      value.runAttempt,
      `${label}.runAttempt`,
      issues,
    ),
    job: validateExactString(value.job, `${label}.job`, issues),
    artifactName: validateExactString(
      value.artifactName,
      `${label}.artifactName`,
      issues,
    ),
    eventName: validateExactString(
      value.eventName,
      `${label}.eventName`,
      issues,
    ),
  };
  if (provenance.provider !== IDE_ROADMAP_TRUSTED_PROVIDER) {
    issues.push(
      `${label}.provider must equal ${JSON.stringify(IDE_ROADMAP_TRUSTED_PROVIDER)}`,
    );
  }
  if (!REPOSITORY_PATTERN.test(provenance.repository || "")) {
    issues.push(`${label}.repository must be an exact owner/repository`);
  }
  const expectedPrefix = provenance.repository
    ? `${provenance.repository}/${IDE_ROADMAP_TRUSTED_WORKFLOW}@`
    : "";
  if (!expectedPrefix || !provenance.workflowRef?.startsWith(expectedPrefix)) {
    issues.push(
      `${label}.workflowRef must bind ${IDE_ROADMAP_TRUSTED_WORKFLOW}`,
    );
  }
  if (!SHA_OR_OID_PATTERN.test(provenance.workflowSha || "")) {
    issues.push(`${label}.workflowSha must be an exact lowercase Git SHA`);
  }
  if (!POSITIVE_INTEGER_TEXT.test(provenance.runId || "")) {
    issues.push(`${label}.runId must be a positive integer string`);
  }
  if (!POSITIVE_INTEGER_TEXT.test(provenance.runAttempt || "")) {
    issues.push(`${label}.runAttempt must be a positive integer string`);
  }
  if (!JOB_PATTERN.test(provenance.job || "")) {
    issues.push(`${label}.job must be an exact GitHub Actions job id`);
  }
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(provenance.artifactName || "")
  ) {
    issues.push(`${label}.artifactName must be an exact artifact name`);
  }
  if (
    !["pull_request", "push", "workflow_dispatch"].includes(
      provenance.eventName,
    )
  ) {
    issues.push(`${label}.eventName is not trusted for this workflow`);
  }
  return provenance;
}

function trustedWorkflowExecutionRef(provenance) {
  const prefix = `${provenance?.repository || ""}/${IDE_ROADMAP_TRUSTED_WORKFLOW}@`;
  return provenance?.workflowRef?.startsWith(prefix)
    ? provenance.workflowRef.slice(prefix.length)
    : null;
}

function assertReleaseReadyEvent(provenance, label, issues) {
  const executionRef = trustedWorkflowExecutionRef(provenance);
  const versionText = executionRef?.startsWith("refs/tags/ide-vscode-v")
    ? executionRef.slice("refs/tags/ide-vscode-v".length)
    : null;
  const exactVscodeTag = Boolean(versionText && isStrictSemver(versionText));
  const trustedPush =
    provenance?.eventName === "push" &&
    (executionRef === "refs/heads/main" || exactVscodeTag);
  const trustedTagDispatch =
    provenance?.eventName === "workflow_dispatch" && exactVscodeTag;
  if (!trustedPush && !trustedTagDispatch) {
    issues.push(
      `${label} may assert release readiness only for a trusted main push or exact ide-vscode semver tag run`,
    );
  }
  return { executionRef, exactVscodeTag };
}

function assertTrustedProvenanceMatches(actual, expected, label, issues) {
  if (!expected) {
    issues.push(
      `${label} cannot be trusted without caller-supplied GitHub Actions provenance`,
    );
    return;
  }
  for (const field of [
    "provider",
    "repository",
    "workflowRef",
    "workflowSha",
    "runId",
    "runAttempt",
    "job",
    "artifactName",
    "eventName",
  ]) {
    if (actual?.[field] !== expected[field]) {
      issues.push(`${label}.${field} does not match trusted workflow context`);
    }
  }
}

function verifyExactCleanCheckout({
  repoRoot,
  releaseCommit,
  execFileSync = nodeExecFileSync,
  issues,
}) {
  try {
    const head = String(
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ).trim();
    const dirty = String(
      execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ).trim();
    if (head !== releaseCommit) {
      issues.push("checked-out Git HEAD does not match the release commit");
    }
    if (dirty) {
      issues.push("release-readiness verification requires a clean checkout");
    }
  } catch (error) {
    issues.push(
      `could not establish exact clean checkout authority: ${error.message}`,
    );
  }
}

function validateRuntimeRun({
  run,
  runIndex,
  document,
  documentLabel,
  roadmapCase,
  releaseCommit,
  seenRunIds,
  cellCounts,
  evidenceRoot,
  documentPath,
  documentProvenance,
  trustedProvenance,
  requireReleaseReady,
  inspectVsix,
  remoteSshTrust,
  issues,
}) {
  const label = `${documentLabel}.runs[${runIndex}]`;
  if (!isRecord(run)) {
    issues.push(`${label} must be an object`);
    return;
  }

  const runId = validateExactString(run.runId, `${label}.runId`, issues);
  if (runId) {
    if (seenRunIds.has(runId)) {
      issues.push(`${label}.runId duplicates ${JSON.stringify(runId)}`);
    } else {
      seenRunIds.add(runId);
    }
  }
  if (run.caseId !== roadmapCase.id) {
    issues.push(`${label}.caseId must equal ${JSON.stringify(roadmapCase.id)}`);
  }
  if (run.manifestVersion !== IDE_ROADMAP_MANIFEST_VERSION) {
    issues.push(
      `${label}.manifestVersion must equal ${JSON.stringify(IDE_ROADMAP_MANIFEST_VERSION)}`,
    );
  }
  if (run.releaseCommit !== releaseCommit) {
    issues.push(
      `${label}.releaseCommit does not match the requested release commit`,
    );
  }
  if (run.releaseCommit !== document.releaseCommit) {
    issues.push(`${label}.releaseCommit does not match its evidence envelope`);
  }
  if (
    requireReleaseReady &&
    run.journeyEvidenceDigest !== document.journeyEvidenceDigest
  ) {
    issues.push(
      `${label}.journeyEvidenceDigest does not match its evidence envelope`,
    );
  }
  if (
    requireReleaseReady &&
    canonicalJson(run.provenance) !== canonicalJson(documentProvenance)
  ) {
    issues.push(`${label}.provenance does not match its evidence envelope`);
  }
  if (trustedProvenance) {
    assertTrustedProvenanceMatches(
      run.provenance,
      trustedProvenance,
      `${label}.provenance`,
      issues,
    );
  }
  validateExactString(run.hostVersion, `${label}.hostVersion`, issues);
  validateExactString(run.cliVersion, `${label}.cliVersion`, issues);

  const host = validateExactString(run.host, `${label}.host`, issues);
  const operatingSystem = validateExactString(
    run.operatingSystem,
    `${label}.operatingSystem`,
    issues,
  );
  const transport = validateExactString(
    run.transport,
    `${label}.transport`,
    issues,
  );
  const coordinateValid =
    host &&
    operatingSystem &&
    transport &&
    roadmapCase.matrix.hosts.includes(host) &&
    roadmapCase.matrix.operatingSystems.includes(operatingSystem) &&
    roadmapCase.matrix.transports.includes(transport);
  if (host && !roadmapCase.matrix.hosts.includes(host)) {
    issues.push(
      `${label}.host is outside the declared matrix: ${JSON.stringify(host)}`,
    );
  }
  if (
    operatingSystem &&
    !roadmapCase.matrix.operatingSystems.includes(operatingSystem)
  ) {
    issues.push(
      `${label}.operatingSystem is outside the declared matrix: ${JSON.stringify(operatingSystem)}`,
    );
  }
  if (transport && !roadmapCase.matrix.transports.includes(transport)) {
    issues.push(
      `${label}.transport is outside the declared matrix: ${JSON.stringify(transport)}`,
    );
  }
  if (coordinateValid) {
    const key = matrixCellKey(host, operatingSystem, transport);
    cellCounts.set(key, (cellCounts.get(key) || 0) + 1);
  }

  const startedAt = validateTimestamp(
    run.startedAt,
    `${label}.startedAt`,
    issues,
  );
  const finishedAt = validateTimestamp(
    run.finishedAt,
    `${label}.finishedAt`,
    issues,
  );
  if (startedAt !== null && finishedAt !== null && finishedAt < startedAt) {
    issues.push(`${label}.finishedAt must not precede startedAt`);
  }
  if (run.result !== "passed") {
    issues.push(`${label}.result must equal "passed"`);
  }
  if (
    canonicalJson(run.observedOutcome) !==
    canonicalJson(roadmapCase.expectedOutcome)
  ) {
    issues.push(
      `${label}.observedOutcome does not match manifest expectedOutcome`,
    );
  }

  const artifacts = validateStringArray(
    run.artifacts,
    `${label}.artifacts`,
    issues,
  );
  const artifactSet = new Set(artifacts);
  if (!isRecord(run.artifactDigests)) {
    issues.push(`${label}.artifactDigests must be an object`);
  }
  if (!isRecord(run.artifactFiles)) {
    if (requireReleaseReady) {
      issues.push(`${label}.artifactFiles must be an object`);
    }
  }
  const verifiedArtifactPaths = new Map();
  for (const artifact of artifacts) {
    const digest = run.artifactDigests?.[artifact];
    if (typeof digest !== "string" || !SHA256_PATTERN.test(digest)) {
      issues.push(
        `${label}.artifactDigests[${JSON.stringify(artifact)}] must be a lowercase SHA-256 digest`,
      );
    }
    const artifactFile = run.artifactFiles?.[artifact];
    if (artifactFile !== undefined) {
      const verified = validateEvidenceArtifactFile({
        evidenceRoot,
        documentPath,
        relativePath: artifactFile,
        expectedDigest: digest,
        label: `${label}.artifactFiles[${JSON.stringify(artifact)}]`,
        issues,
      });
      if (verified) verifiedArtifactPaths.set(artifact, verified);
    } else if (requireReleaseReady) {
      issues.push(
        `${label}.artifactFiles is missing path-backed bytes for ${JSON.stringify(artifact)}`,
      );
    }
  }
  for (const requiredArtifact of roadmapCase.requiredArtifacts) {
    if (!artifactSet.has(requiredArtifact)) {
      issues.push(
        `${label}.artifacts is missing required artifact ${JSON.stringify(requiredArtifact)}`,
      );
    }
    const digest = run.artifactDigests?.[requiredArtifact];
    if (typeof digest !== "string" || !SHA256_PATTERN.test(digest)) {
      issues.push(
        `${label}.artifactDigests is missing a valid digest for required artifact ${JSON.stringify(requiredArtifact)}`,
      );
    }
  }
  if (roadmapCase.id === IDE_ROADMAP_REMOTE_SSH_CONTAINER_CASE) {
    validateRemoteSshTrustedRuntimeRun({
      run,
      document,
      documentProvenance,
      roadmapCase,
      evidenceRoot,
      verifiedArtifactPaths,
      trustedProvenance,
      inspectVsix,
      remoteSshTrust,
      issues,
      label,
    });
  }
}

function writeImmutableJson(destination, value) {
  const resolved = path.resolve(destination);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  if (fs.existsSync(resolved)) {
    throw new Error(`immutable output already exists: ${resolved}`);
  }
  const temporary = `${resolved}.tmp-${process.pid}`;
  let descriptor = null;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.linkSync(temporary, resolved);
    fs.unlinkSync(temporary);
  } catch (error) {
    if (descriptor !== null) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(temporary);
    } catch {
      // Preserve the immutable-publication failure.
    }
    throw error;
  }
}

function portableRelativePath(fromDirectory, target, label) {
  // Hosted macOS exposes the temporary directory through /var while its
  // canonical path is rooted at /private/var. Artifact verification returns
  // canonical paths, so compare both sides in the same filesystem namespace
  // before emitting the portable path stored in the evidence envelope.
  const canonicalDirectory = fs.realpathSync(path.resolve(fromDirectory));
  const canonicalTarget = fs.realpathSync(path.resolve(target));
  const relative = path.relative(canonicalDirectory, canonicalTarget);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay below the runtime envelope directory`);
  }
  return relative.split(path.sep).join("/");
}

function validateCandidateManifestBinding({
  candidateManifestPath,
  candidateVsixPath,
  releaseCommit,
  extensionVersion,
  provenance,
  remoteEnvironment,
  inspectVsix = inspectVsixReleaseArtifact,
  label,
  issues,
}) {
  const manifest = readJson(
    candidateManifestPath,
    `${label}.candidate-manifest`,
    issues,
  );
  if (!isRecord(manifest)) return null;
  const actualFields = Object.keys(manifest).sort();
  const expectedFields = [...CANDIDATE_MANIFEST_FIELDS].sort();
  if (canonicalJson(actualFields) !== canonicalJson(expectedFields)) {
    issues.push(`${label}.candidate-manifest has unexpected fields`);
  }
  const vsixStats = fs.statSync(candidateVsixPath, { throwIfNoEntry: false });
  const expectedWorkflowRun = `https://github.com/${provenance?.repository}/actions/runs/${provenance?.runId}`;
  if (
    manifest.schema !== 1 ||
    manifest.artifact !== "chainlesschain-ide.vsix" ||
    manifest.package !== "chainlesschain-ide" ||
    manifest.publisher !== "chainlesschain" ||
    !isStrictSemver(manifest.version) ||
    manifest.version !== extensionVersion ||
    manifest.commit !== releaseCommit ||
    manifest.workflowRun !== expectedWorkflowRun ||
    !Number.isSafeInteger(manifest.bytes) ||
    manifest.bytes <= 0 ||
    manifest.bytes !== vsixStats?.size ||
    manifest.sha256 !== sha256File(candidateVsixPath).slice("sha256:".length) ||
    manifest.sha512 !== sha512File(candidateVsixPath) ||
    manifest.vsixmanifestIdentity?.id !== manifest.package ||
    manifest.vsixmanifestIdentity?.publisher !== manifest.publisher ||
    manifest.vsixmanifestIdentity?.version !== manifest.version
  ) {
    issues.push(
      `${label}.candidate-manifest does not bind the target VSIX bytes, identity, version, commit, and workflow run`,
    );
  }
  validateTimestamp(
    manifest.createdAt,
    `${label}.candidate-manifest.createdAt`,
    issues,
  );
  let inspected = null;
  try {
    inspected = inspectVsix(candidateVsixPath);
  } catch (error) {
    issues.push(
      `${label}.candidate-vsix cannot be inspected: ${error.message}`,
    );
  }
  if (
    inspected &&
    (inspected.bytes !== manifest.bytes ||
      inspected.sha256 !== manifest.sha256 ||
      inspected.sha512 !== manifest.sha512 ||
      inspected.package !== manifest.package ||
      inspected.publisher !== manifest.publisher ||
      inspected.version !== manifest.version ||
      canonicalJson(inspected.vsixmanifestIdentity) !==
        canonicalJson(manifest.vsixmanifestIdentity))
  ) {
    issues.push(
      `${label}.candidate-vsix package identity differs from its candidate manifest`,
    );
  }
  const executionRef = trustedWorkflowExecutionRef(provenance);
  if (
    executionRef?.startsWith("refs/tags/ide-vscode-v") &&
    executionRef !== `refs/tags/ide-vscode-v${manifest.version}`
  ) {
    issues.push(
      `${label}.candidate version does not match its exact release tag`,
    );
  }
  const expectedVsixDigest = `sha256:${manifest.sha256}`;
  if (
    remoteEnvironment &&
    (remoteEnvironment.extensionVersion !== manifest.version ||
      remoteEnvironment.candidateVsixSha256 !== expectedVsixDigest ||
      remoteEnvironment.candidateVsixBytes !== manifest.bytes)
  ) {
    issues.push(
      `${label}.remote-environment does not bind the exact candidate VSIX bytes and version`,
    );
  }
  return manifest;
}

function verifyRemoteSshRuntimeIdentity(
  remoteEnvironment,
  hostEnvironment,
  journey,
  remoteSshTrust = IDE_ROADMAP_REMOTE_SSH_TRUST,
) {
  const issues = [];
  if (!isRecord(remoteEnvironment)) {
    issues.push("remote-environment artifact must be an object");
  } else {
    if (
      remoteEnvironment.schema !==
      "chainlesschain.remote-ssh-container-observation.v2"
    ) {
      issues.push(
        'remote-environment.schema must equal "chainlesschain.remote-ssh-container-observation.v2"',
      );
    }
    if (remoteEnvironment.remoteName !== "ssh-remote") {
      issues.push('remote-environment.remoteName must equal "ssh-remote"');
    }
    if (
      remoteEnvironment.remoteAuthority !==
      `ssh-remote+${remoteEnvironment.containerHostname}`
    ) {
      issues.push(
        "remote-environment authority is not bound to its container hostname",
      );
    }
    if (
      remoteEnvironment.workspaceUriPresentation !==
        "remote-extension-host-native-file" ||
      !Array.isArray(remoteEnvironment.workspaceSchemes) ||
      remoteEnvironment.workspaceSchemes.length !== 2 ||
      remoteEnvironment.workspaceSchemes.some((scheme) => scheme !== "file") ||
      !Array.isArray(remoteEnvironment.workspaceAuthorities) ||
      remoteEnvironment.workspaceAuthorities.length !== 2 ||
      remoteEnvironment.workspaceAuthorities.some(
        (authority) => authority !== "",
      )
    ) {
      issues.push(
        "remote-environment must prove two native file roots inside the remote extension host",
      );
    }
    if (
      canonicalJson(remoteEnvironment.orderedWorkspacePaths) !==
      canonicalJson([
        "/home/cc-roadmap/workspace-primary",
        "/home/cc-roadmap/workspace-secondary",
      ])
    ) {
      issues.push(
        "remote-environment ordered workspace paths do not match the scoped journey",
      );
    }
    if (
      !Number.isSafeInteger(remoteEnvironment.extensionHostPid) ||
      remoteEnvironment.extensionHostPid < 1 ||
      typeof remoteEnvironment.extensionHostCwd !== "string" ||
      (remoteEnvironment.extensionHostCwd !== "/home/cc-roadmap" &&
        !remoteEnvironment.extensionHostCwd.startsWith("/home/cc-roadmap/")) ||
      typeof remoteEnvironment.extensionPath !== "string" ||
      remoteEnvironment.extensionPath !==
        `/home/cc-roadmap/.vscode-server/extensions/chainlesschain.chainlesschain-ide-${journey.extensionVersion}` ||
      !isStrictSemver(journey.extensionVersion) ||
      remoteEnvironment.extensionVersion !== journey.extensionVersion
    ) {
      issues.push(
        "remote-environment does not prove a process and installed extension inside the SSH container",
      );
    }
    if (
      hostEnvironment?.schema !== "chainlesschain.ide-host-environment.v1" ||
      hostEnvironment?.operatingSystem !== "linux" ||
      hostEnvironment?.architecture !== "x64" ||
      hostEnvironment?.vscodeVersion !== journey.host?.version ||
      hostEnvironment?.containerHostname !==
        remoteEnvironment.containerHostname ||
      hostEnvironment?.containerMarkerDigest !==
        remoteEnvironment.containerMarkerDigest ||
      hostEnvironment?.containerImageRef !==
        IDE_ROADMAP_REMOTE_CONTAINER_IMAGE ||
      typeof hostEnvironment?.dockerImageId !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(hostEnvironment.dockerImageId)
    ) {
      issues.push(
        "host and remote environment do not share the pinned container identity",
      );
    }
    if (
      typeof remoteEnvironment.containerHostname !== "string" ||
      !remoteEnvironment.containerHostname.startsWith("cc-roadmap-ssh-") ||
      typeof remoteEnvironment.containerMarkerDigest !== "string" ||
      !SHA256_PATTERN.test(remoteEnvironment.containerMarkerDigest)
    ) {
      issues.push("remote-environment container identity is incomplete");
    }
  }
  const dependency = journey.dependencies?.find(
    (entry) => entry.id === remoteSshTrust.id,
  );
  if (
    !dependency ||
    dependency.version !== remoteSshTrust.version ||
    dependency.source !== remoteSshTrust.source ||
    dependency.transportSha256 !== remoteSshTrust.transportSha256 ||
    dependency.sha256 !== remoteSshTrust.sha256
  ) {
    issues.push("journey does not bind the pinned official Remote-SSH VSIX");
  }
  const releaseArtifacts = Array.isArray(journey.artifacts)
    ? journey.artifacts.filter(
        (artifact) => artifact.kind === "release-artifact",
      )
    : [];
  if (
    !releaseArtifacts.some(
      (artifact) =>
        artifact.name === "remote-ssh-0.120.0.vsix" &&
        artifact.sha256 === remoteSshTrust.sha256,
    ) ||
    !releaseArtifacts.some(
      (artifact) =>
        artifact.name === "remote-ssh-0.120.0.vsix.gz" &&
        artifact.sha256 === remoteSshTrust.transportSha256,
    )
  ) {
    issues.push(
      "journey artifacts do not contain the pinned Remote-SSH transport and decoded bytes",
    );
  }
  if (issues.length > 0) throw new IdeRoadmapRuntimeEvidenceError(issues);
  return remoteEnvironment;
}

function countCredentialLeaks(artifactPaths) {
  return [...new Set(artifactPaths || [])].reduce((count, artifactPath) => {
    const stats = fs.statSync(artifactPath, { throwIfNoEntry: false });
    if (
      !stats?.isFile() ||
      stats.size > 1024 * 1024 ||
      ![".json", ".log", ".txt", ".yaml", ".yml"].includes(
        path.extname(artifactPath).toLowerCase(),
      )
    ) {
      return count;
    }
    const matches = fs
      .readFileSync(artifactPath, "utf8")
      .match(new RegExp(CREDENTIAL_TOKEN_PATTERN.source, "gu"));
    return count + (matches?.length || 0);
  }, 0);
}

function deriveRemoteSshObservedOutcome({
  journey,
  exactCommitObservation,
  remoteEnvironment,
  outcomeObservations,
  credentialArtifactPaths,
  issues,
  label,
}) {
  if (
    outcomeObservations?.schema !==
    "chainlesschain.ide-roadmap-outcome-observations.v1"
  ) {
    issues.push(`${label}.outcome-observations has an invalid schema`);
  }
  const credentialLeakCount = countCredentialLeaks(credentialArtifactPaths);
  const wrongCommitBindingCount =
    exactCommitObservation?.releaseCommit === journey.releaseCommit &&
    exactCommitObservation?.gitHead === journey.releaseCommit &&
    remoteEnvironment?.releaseCommit === journey.releaseCommit
      ? 0
      : 1;
  const orderedWorkspaceRootsBound =
    outcomeObservations?.orderedWorkspaceRootsBound === true &&
    canonicalJson(remoteEnvironment?.orderedWorkspacePaths) ===
      canonicalJson([
        "/home/cc-roadmap/workspace-primary",
        "/home/cc-roadmap/workspace-secondary",
      ]);
  const workspaceRootCount = Array.isArray(
    remoteEnvironment?.orderedWorkspacePaths,
  )
    ? remoteEnvironment.orderedWorkspacePaths.length
    : 0;
  const remoteTransportExercised =
    remoteEnvironment?.remoteName === "ssh-remote" &&
    remoteEnvironment?.journeyPassed === true &&
    Array.isArray(remoteEnvironment?.hostJourneyStages) &&
    remoteEnvironment.hostJourneyStages.includes("bridge-verified") &&
    remoteEnvironment.hostJourneyStages.includes("phase-completed");
  const observedOutcome = {
    missingRequiredArtifactsFail:
      outcomeObservations?.missingRequiredArtifactsFail === true,
    credentialLeakCount,
    wrongCommitBindingCount,
    evidenceReplacementCount: Number.isSafeInteger(
      outcomeObservations?.evidenceReplacementCount,
    )
      ? outcomeObservations.evidenceReplacementCount
      : -1,
    orderedWorkspaceRootsBound,
    workspaceRootCount,
    remoteTransportExercised,
  };
  const claimedObservation = {
    credentialLeakCount: outcomeObservations?.credentialLeakCount,
    wrongCommitBindingCount: outcomeObservations?.wrongCommitBindingCount,
    workspaceRootCount: outcomeObservations?.workspaceRootCount,
    remoteTransportExercised: outcomeObservations?.remoteTransportExercised,
  };
  const derivedObservation = {
    credentialLeakCount,
    wrongCommitBindingCount,
    workspaceRootCount,
    remoteTransportExercised,
  };
  if (canonicalJson(claimedObservation) !== canonicalJson(derivedObservation)) {
    issues.push(
      `${label}.outcome-observations claims do not match rederived artifact state`,
    );
  }
  return observedOutcome;
}

function validateRemoteSshTrustedRuntimeRun({
  run,
  document,
  documentProvenance,
  roadmapCase,
  evidenceRoot,
  verifiedArtifactPaths,
  trustedProvenance,
  inspectVsix,
  remoteSshTrust,
  issues,
  label,
}) {
  const journeyPath = verifiedArtifactPaths.get("journey-evidence");
  if (!journeyPath) {
    issues.push(
      `${label} cannot rederive state without journey-evidence bytes`,
    );
    return;
  }
  const journey = readJson(journeyPath, `${label}.journey-evidence`, issues);
  if (!isRecord(journey)) return;
  const journeyCore = { ...journey };
  delete journeyCore.evidenceDigest;
  const calculatedJourneyDigest = sha256Buffer(
    canonicalJourneyJson(journeyCore),
  );
  if (
    journey.schema !== IDE_JOURNEY_EVIDENCE_SCHEMA ||
    journey.schemaVersion !== IDE_JOURNEY_EVIDENCE_VERSION ||
    journey.manifestVersion !== IDE_ROADMAP_MANIFEST_VERSION ||
    journey.journeyId !== IDE_ROADMAP_REMOTE_SSH_JOURNEY ||
    journey.required !== true ||
    journey.result !== "passed" ||
    journey.evidenceComplete !== true ||
    journey.evidenceDigest !== calculatedJourneyDigest ||
    journey.evidenceDigest !== document.journeyEvidenceDigest ||
    journey.evidenceDigest !== run.journeyEvidenceDigest
  ) {
    issues.push(
      `${label}.journey-evidence identity, result, evidenceDigest, or envelope binding is invalid`,
    );
  }
  const journeyProvenance = validateTrustedProvenance(
    journey.provenance,
    `${label}.journey-evidence.provenance`,
    issues,
  );
  if (
    canonicalJson(journeyProvenance) !== canonicalJson(documentProvenance) ||
    canonicalJson(journeyProvenance) !== canonicalJson(run.provenance)
  ) {
    issues.push(
      `${label}.journey-evidence provenance differs from its runtime envelope`,
    );
  }
  if (trustedProvenance) {
    assertTrustedProvenanceMatches(
      journeyProvenance,
      trustedProvenance,
      `${label}.journey-evidence.provenance`,
      issues,
    );
  }
  if (
    journey.releaseCommit !== run.releaseCommit ||
    journey.host?.name !== run.host ||
    journey.host?.version !== run.hostVersion ||
    journey.host?.operatingSystem !== run.operatingSystem ||
    journey.host?.transport !== run.transport ||
    journey.cliVersion !== run.cliVersion ||
    journey.startedAt !== run.startedAt ||
    journey.finishedAt !== run.finishedAt ||
    journey.workspace?.layout !== "multi-root" ||
    journey.workspace?.rootCount !== 2 ||
    journey.workspace?.orderedRootsDigest !==
      sha256Buffer(
        canonicalJourneyJson([
          "/home/cc-roadmap/workspace-primary",
          "/home/cc-roadmap/workspace-secondary",
        ]),
      )
  ) {
    issues.push(
      `${label}.journey-evidence coordinates differ from the scoped runtime run`,
    );
  }
  if (!Array.isArray(journey.artifacts) || journey.artifacts.length === 0) {
    issues.push(`${label}.journey-evidence artifacts must be non-empty`);
    return;
  }
  const journeyVerifiedPaths = new Map();
  const seenJourneyArtifactPaths = new Set();
  for (const [index, artifact] of journey.artifacts.entries()) {
    const artifactLabel = `${label}.journey-evidence.artifacts[${index}]`;
    if (
      !isRecord(artifact) ||
      typeof artifact.path !== "string" ||
      !SHA256_PATTERN.test(artifact.sha256 || "") ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes < 0
    ) {
      issues.push(`${artifactLabel} is not a path-backed artifact record`);
      continue;
    }
    if (seenJourneyArtifactPaths.has(artifact.path)) {
      issues.push(`${artifactLabel}.path duplicates another journey artifact`);
      continue;
    }
    seenJourneyArtifactPaths.add(artifact.path);
    const verified = validateEvidenceArtifactFile({
      evidenceRoot,
      documentPath: journeyPath,
      relativePath: artifact.path,
      expectedDigest: artifact.sha256,
      label: `${artifactLabel}.path`,
      issues,
    });
    if (verified) {
      journeyVerifiedPaths.set(artifact.path, verified);
      if (fs.statSync(verified).size !== artifact.bytes) {
        issues.push(`${artifactLabel}.bytes differs from the artifact file`);
      }
    }
  }
  const bundleCore = journey.artifacts
    .filter((artifact) => isRecord(artifact) && artifact.path)
    .map(({ kind, name = null, path: artifactPath, sha256, bytes }) => ({
      kind,
      name,
      path: artifactPath,
      sha256,
      bytes,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (
    journey.artifactBundleDigest !==
    sha256Buffer(canonicalJourneyJson(bundleCore))
  ) {
    issues.push(
      `${label}.journey-evidence artifactBundleDigest is inconsistent`,
    );
  }
  const semanticPaths = new Map();
  for (const requiredArtifact of roadmapCase.requiredArtifacts) {
    if (requiredArtifact === "journey-evidence") continue;
    const binding = journey.roadmapArtifacts?.[requiredArtifact];
    const journeyArtifactPath = binding?.path
      ? journeyVerifiedPaths.get(binding.path)
      : null;
    const envelopeArtifactPath = verifiedArtifactPaths.get(requiredArtifact);
    if (
      !journeyArtifactPath ||
      !envelopeArtifactPath ||
      journeyArtifactPath !== envelopeArtifactPath ||
      binding.sha256 !== sha256File(journeyArtifactPath) ||
      binding.bytes !== fs.statSync(journeyArtifactPath).size
    ) {
      issues.push(
        `${label}.journey-evidence does not exactly bind runtime artifact ${JSON.stringify(requiredArtifact)}`,
      );
      continue;
    }
    semanticPaths.set(requiredArtifact, journeyArtifactPath);
  }
  const readSemanticJson = (name) => {
    const artifactPath = semanticPaths.get(name);
    return artifactPath
      ? readJson(artifactPath, `${label}.${name}`, issues)
      : null;
  };
  const exactCommitObservation = readSemanticJson("exact-commit");
  const hostEnvironment = readSemanticJson("host-environment");
  const remoteEnvironment = readSemanticJson("remote-environment");
  const outcomeObservations = readSemanticJson("outcome-observations");
  try {
    verifyRemoteSshRuntimeIdentity(
      remoteEnvironment,
      hostEnvironment,
      journey,
      remoteSshTrust,
    );
  } catch (error) {
    if (error instanceof IdeRoadmapRuntimeEvidenceError) {
      issues.push(
        ...error.issues.map((issue) => `${label}.journey-evidence: ${issue}`),
      );
    } else {
      issues.push(
        `${label}.remote identity validation failed: ${error.message}`,
      );
    }
  }
  const candidateManifestPath = semanticPaths.get("candidate-manifest");
  const candidateVsixPath = semanticPaths.get("candidate-vsix");
  if (!candidateManifestPath || !candidateVsixPath) {
    issues.push(`${label} lacks path-backed candidate manifest or VSIX bytes`);
  } else {
    validateCandidateManifestBinding({
      candidateManifestPath,
      candidateVsixPath,
      releaseCommit: run.releaseCommit,
      extensionVersion: journey.extensionVersion,
      provenance: journeyProvenance,
      remoteEnvironment,
      inspectVsix,
      label,
      issues,
    });
  }
  const observedOutcome = deriveRemoteSshObservedOutcome({
    journey,
    exactCommitObservation,
    remoteEnvironment,
    outcomeObservations,
    credentialArtifactPaths: [...journeyVerifiedPaths.values()],
    issues,
    label,
  });
  if (
    canonicalJson(observedOutcome) !== canonicalJson(run.observedOutcome) ||
    canonicalJson(observedOutcome) !==
      canonicalJson(roadmapCase.expectedOutcome)
  ) {
    issues.push(
      `${label}.observedOutcome cannot be rederived from journey artifact bytes`,
    );
  }
}

export function bridgeIdeJourneyEvidenceToRoadmapRuntime({
  repoRoot = DEFAULT_REPO_ROOT,
  manifestPath = IDE_ROADMAP_MANIFEST_PATH,
  journeyEvidencePath,
  caseId = IDE_ROADMAP_REMOTE_SSH_CONTAINER_CASE,
  output,
  trustedProvenance,
  inspectVsix = inspectVsixReleaseArtifact,
  remoteSshTrust = IDE_ROADMAP_REMOTE_SSH_TRUST,
} = {}) {
  const contract = verifyIdeRoadmapFixtures({ repoRoot, manifestPath });
  const roadmapCase = contract.cases.find((entry) => entry.id === caseId);
  if (!roadmapCase) throw new Error(`unknown roadmap case: ${caseId}`);
  if (!journeyEvidencePath || !output) {
    throw new Error("journeyEvidencePath and output are required");
  }
  const journeyPath = path.resolve(journeyEvidencePath);
  const outputPath = path.resolve(output);
  const evidenceRoot = path.dirname(outputPath);
  if (!isWithin(evidenceRoot, journeyPath)) {
    throw new Error("journey evidence must stay below the envelope directory");
  }
  const issues = [];
  const journey = readJson(journeyPath, "journey evidence", issues);
  if (!isRecord(journey)) {
    throw new IdeRoadmapRuntimeEvidenceError(
      issues.length > 0 ? issues : ["journey evidence must be an object"],
    );
  }
  const core = { ...journey };
  delete core.evidenceDigest;
  if (
    journey.schema !== IDE_JOURNEY_EVIDENCE_SCHEMA ||
    journey.schemaVersion !== IDE_JOURNEY_EVIDENCE_VERSION ||
    journey.manifestVersion !== contract.manifestVersion ||
    journey.journeyId !== IDE_ROADMAP_REMOTE_SSH_JOURNEY ||
    journey.releaseCommit !== trustedProvenance?.releaseCommit ||
    journey.required !== true ||
    journey.result !== "passed" ||
    journey.evidenceComplete !== true ||
    journey.evidenceDigest !== sha256Buffer(canonicalJourneyJson(core))
  ) {
    issues.push(
      "journey evidence identity, digest, result, or release commit is invalid",
    );
  }
  const normalizedProvenance = validateTrustedProvenance(
    journey.provenance,
    "journey.provenance",
    issues,
  );
  const expectedProvenance = trustedProvenance
    ? validateTrustedProvenance(trustedProvenance, "trustedProvenance", issues)
    : null;
  assertTrustedProvenanceMatches(
    normalizedProvenance,
    expectedProvenance,
    "journey.provenance",
    issues,
  );
  if (
    journey.host?.name !== "vscode" ||
    journey.host?.operatingSystem !== "linux" ||
    journey.host?.transport !== "remote-ssh-container" ||
    journey.workspace?.layout !== "multi-root" ||
    journey.workspace?.rootCount !== 2
  ) {
    issues.push(
      "journey host coordinates do not match the scoped Remote-SSH cell",
    );
  }
  if (!Array.isArray(journey.artifacts) || journey.artifacts.length === 0) {
    issues.push("journey artifacts must be a non-empty array");
  }
  const verifiedPaths = new Map();
  for (const [index, artifact] of (journey.artifacts || []).entries()) {
    if (
      !isRecord(artifact) ||
      typeof artifact.path !== "string" ||
      typeof artifact.sha256 !== "string" ||
      !SHA256_PATTERN.test(artifact.sha256) ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes < 0
    ) {
      issues.push(`journey.artifacts[${index}] is not path-backed`);
      continue;
    }
    const verified = validateEvidenceArtifactFile({
      evidenceRoot,
      documentPath: journeyPath,
      relativePath: artifact.path,
      expectedDigest: artifact.sha256,
      label: `journey.artifacts[${index}].path`,
      issues,
    });
    if (verified) {
      verifiedPaths.set(artifact.path, verified);
      if (fs.statSync(verified).size !== artifact.bytes) {
        issues.push(
          `journey.artifacts[${index}].bytes does not match its file`,
        );
      }
    }
  }
  const bundleCore = (journey.artifacts || [])
    .filter((artifact) => artifact.path)
    .map(({ kind, name = null, path: artifactPath, sha256, bytes }) => ({
      kind,
      name,
      path: artifactPath,
      sha256,
      bytes,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (
    journey.artifactBundleDigest !==
    sha256Buffer(canonicalJourneyJson(bundleCore))
  ) {
    issues.push(
      "journey artifactBundleDigest does not bind its artifact records",
    );
  }
  const artifactDigests = {};
  const artifactFiles = {};
  for (const requiredArtifact of roadmapCase.requiredArtifacts) {
    if (requiredArtifact === "journey-evidence") {
      artifactDigests[requiredArtifact] = sha256File(journeyPath);
      artifactFiles[requiredArtifact] = portableRelativePath(
        path.dirname(outputPath),
        journeyPath,
        requiredArtifact,
      );
      continue;
    }
    const binding = journey.roadmapArtifacts?.[requiredArtifact];
    const verified = binding?.path ? verifiedPaths.get(binding.path) : null;
    if (
      !verified ||
      binding.sha256 !== sha256File(verified) ||
      binding.bytes !== fs.statSync(verified).size
    ) {
      issues.push(
        `journey is missing verified bytes for roadmap artifact ${JSON.stringify(requiredArtifact)}`,
      );
      continue;
    }
    artifactDigests[requiredArtifact] = binding.sha256;
    artifactFiles[requiredArtifact] = portableRelativePath(
      path.dirname(outputPath),
      verified,
      requiredArtifact,
    );
  }
  const hostBinding = journey.roadmapArtifacts?.["host-environment"];
  let hostEnvironment = null;
  if (hostBinding?.path && verifiedPaths.has(hostBinding.path)) {
    hostEnvironment = JSON.parse(
      fs.readFileSync(verifiedPaths.get(hostBinding.path), "utf8"),
    );
  }
  const remoteBinding = journey.roadmapArtifacts?.["remote-environment"];
  let remoteEnvironment = null;
  if (remoteBinding?.path && verifiedPaths.has(remoteBinding.path)) {
    remoteEnvironment = verifyRemoteSshRuntimeIdentity(
      JSON.parse(
        fs.readFileSync(verifiedPaths.get(remoteBinding.path), "utf8"),
      ),
      hostEnvironment,
      journey,
      remoteSshTrust,
    );
  }
  const outcomeBinding = journey.roadmapArtifacts?.["outcome-observations"];
  let outcomeObservations = null;
  if (outcomeBinding?.path && verifiedPaths.has(outcomeBinding.path)) {
    outcomeObservations = JSON.parse(
      fs.readFileSync(verifiedPaths.get(outcomeBinding.path), "utf8"),
    );
  }
  const exactCommitBinding = journey.roadmapArtifacts?.["exact-commit"];
  let exactCommitObservation = null;
  if (exactCommitBinding?.path && verifiedPaths.has(exactCommitBinding.path)) {
    exactCommitObservation = JSON.parse(
      fs.readFileSync(verifiedPaths.get(exactCommitBinding.path), "utf8"),
    );
  }
  const candidateManifestBinding =
    journey.roadmapArtifacts?.["candidate-manifest"];
  const candidateVsixBinding = journey.roadmapArtifacts?.["candidate-vsix"];
  const candidateManifestPath = candidateManifestBinding?.path
    ? verifiedPaths.get(candidateManifestBinding.path)
    : null;
  const candidateVsixPath = candidateVsixBinding?.path
    ? verifiedPaths.get(candidateVsixBinding.path)
    : null;
  if (!candidateManifestPath || !candidateVsixPath) {
    issues.push(
      "journey is missing its path-backed candidate manifest or VSIX",
    );
  } else {
    validateCandidateManifestBinding({
      candidateManifestPath,
      candidateVsixPath,
      releaseCommit: journey.releaseCommit,
      extensionVersion: journey.extensionVersion,
      provenance: normalizedProvenance,
      remoteEnvironment,
      inspectVsix,
      label: "journey",
      issues,
    });
  }
  const observedOutcome = deriveRemoteSshObservedOutcome({
    journey,
    exactCommitObservation,
    remoteEnvironment,
    outcomeObservations,
    credentialArtifactPaths: [...verifiedPaths.values()],
    issues,
    label: "journey",
  });
  if (
    canonicalJson(observedOutcome) !==
    canonicalJson(roadmapCase.expectedOutcome)
  ) {
    issues.push(
      "derived Remote-SSH observedOutcome does not match the manifest contract",
    );
  }
  if (issues.length > 0) throw new IdeRoadmapRuntimeEvidenceError(issues);

  const runId = [
    normalizedProvenance.runId,
    normalizedProvenance.runAttempt,
    normalizedProvenance.job,
    journey.evidenceDigest.slice("sha256:".length, "sha256:".length + 16),
  ].join(".");
  const run = {
    runId,
    caseId,
    manifestVersion: contract.manifestVersion,
    releaseCommit: journey.releaseCommit,
    host: journey.host.name,
    hostVersion: journey.host.version,
    cliVersion: journey.cliVersion,
    operatingSystem: journey.host.operatingSystem,
    transport: journey.host.transport,
    startedAt: journey.startedAt,
    finishedAt: journey.finishedAt,
    result: "passed",
    observedOutcome,
    artifacts: [...roadmapCase.requiredArtifacts],
    artifactDigests,
    artifactFiles,
    journeyEvidenceDigest: journey.evidenceDigest,
    provenance: normalizedProvenance,
  };
  const envelopeCore = {
    schema: IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA,
    schemaVersion: IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA_VERSION,
    manifestVersion: contract.manifestVersion,
    caseId,
    releaseCommit: journey.releaseCommit,
    generatedAt: new Date().toISOString(),
    journeyEvidenceDigest: journey.evidenceDigest,
    provenance: normalizedProvenance,
    runs: [run],
  };
  const envelope = {
    ...envelopeCore,
    evidenceDigest: createIdeRoadmapRuntimeEvidenceDigest(envelopeCore),
  };
  writeImmutableJson(outputPath, envelope);
  return Object.freeze(envelope);
}

export function verifyIdeRoadmapRuntimeEvidence({
  repoRoot = DEFAULT_REPO_ROOT,
  manifestPath = IDE_ROADMAP_MANIFEST_PATH,
  evidenceDir,
  releaseCommit,
  caseIds = [],
  requireReleaseReady = false,
  trustedProvenance = null,
  execFileSync = nodeExecFileSync,
  inspectVsix = inspectVsixReleaseArtifact,
  remoteSshTrust = IDE_ROADMAP_REMOTE_SSH_TRUST,
  output = null,
} = {}) {
  const contract = verifyIdeRoadmapFixtures({ repoRoot, manifestPath });
  const issues = [];
  const exactReleaseCommit =
    typeof releaseCommit === "string" ? releaseCommit : "";
  if (!GIT_OID_PATTERN.test(exactReleaseCommit)) {
    issues.push(
      "releaseCommit must be an exact lowercase 40-character Git OID",
    );
  }
  if (!evidenceDir) {
    issues.push("runtime evidence directory is required");
  }
  let normalizedTrustedProvenance = null;
  if (trustedProvenance) {
    normalizedTrustedProvenance = validateTrustedProvenance(
      trustedProvenance,
      "trustedProvenance",
      issues,
    );
  }
  if (requireReleaseReady) {
    assertReleaseReadyEvent(
      normalizedTrustedProvenance,
      "trustedProvenance",
      issues,
    );
    if (normalizedTrustedProvenance?.workflowSha !== exactReleaseCommit) {
      issues.push(
        "trustedProvenance.workflowSha must equal the exact release commit",
      );
    }
    verifyExactCleanCheckout({
      repoRoot: path.resolve(repoRoot),
      releaseCommit: exactReleaseCommit,
      execFileSync,
      issues,
    });
  }

  const caseMap = new Map(contract.cases.map((entry) => [entry.id, entry]));
  let requestedIds = [];
  if (!Array.isArray(caseIds)) {
    issues.push("caseIds must be an array when provided");
  } else if (caseIds.length > 0) {
    requestedIds = validateStringArray(caseIds, "caseIds", issues);
  }
  for (const caseId of requestedIds) {
    if (!caseMap.has(caseId)) {
      issues.push(`unknown roadmap case ${JSON.stringify(caseId)}`);
    }
  }
  const files = evidenceDir
    ? listRuntimeEvidenceFiles(evidenceDir, issues)
    : [];
  const documents = [];
  for (const filePath of files) {
    const label = path.relative(path.resolve(evidenceDir), filePath);
    const value = readJson(filePath, label, issues);
    if (
      isRecord(value) &&
      value.schema === IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA
    ) {
      documents.push({ filePath, label, value });
    }
  }
  if (documents.length === 0) {
    issues.push(
      `no ${IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA} documents were found`,
    );
  }

  const discoveredIds = [
    ...new Set(documents.map((entry) => entry.value.caseId).filter(Boolean)),
  ];
  const selectedIds = requestedIds.length > 0 ? requestedIds : discoveredIds;
  const selectedSet = new Set(selectedIds);
  const selectedCases = selectedIds
    .map((caseId) => caseMap.get(caseId))
    .filter(Boolean);
  if (requestedIds.length === 0 && selectedCases.length === 0) {
    issues.push("runtime evidence did not select any known roadmap case");
  }

  const seenRunIds = new Set();
  const caseRunCounts = new Map(selectedCases.map((entry) => [entry.id, 0]));
  const caseCellCounts = new Map(
    selectedCases.map((entry) => [entry.id, new Map()]),
  );
  let selectedDocumentCount = 0;
  for (const { filePath, label, value: document } of documents) {
    if (!caseMap.has(document.caseId)) {
      issues.push(`${label}.caseId is not declared by the manifest`);
      continue;
    }
    if (!selectedSet.has(document.caseId)) continue;
    selectedDocumentCount += 1;
    const roadmapCase = caseMap.get(document.caseId);
    if (
      document.schemaVersion !== IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA_VERSION
    ) {
      issues.push(
        `${label}.schemaVersion must equal ${IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA_VERSION}`,
      );
    }
    if (document.manifestVersion !== IDE_ROADMAP_MANIFEST_VERSION) {
      issues.push(
        `${label}.manifestVersion must equal ${JSON.stringify(IDE_ROADMAP_MANIFEST_VERSION)}`,
      );
    }
    if (document.releaseCommit !== exactReleaseCommit) {
      issues.push(
        `${label}.releaseCommit does not match the requested release commit`,
      );
    }
    const documentProvenance = document.provenance
      ? validateTrustedProvenance(
          document.provenance,
          `${label}.provenance`,
          issues,
        )
      : null;
    if (requireReleaseReady || normalizedTrustedProvenance) {
      if (!documentProvenance) {
        issues.push(`${label}.provenance is required for trusted verification`);
      }
      assertTrustedProvenanceMatches(
        documentProvenance,
        normalizedTrustedProvenance,
        `${label}.provenance`,
        issues,
      );
    }
    if (
      (requireReleaseReady &&
        typeof document.journeyEvidenceDigest !== "string") ||
      (requireReleaseReady &&
        !SHA256_PATTERN.test(document.journeyEvidenceDigest))
    ) {
      issues.push(
        `${label}.journeyEvidenceDigest must be a lowercase SHA-256 digest`,
      );
    }
    validateTimestamp(document.generatedAt, `${label}.generatedAt`, issues);
    if (
      typeof document.evidenceDigest !== "string" ||
      !SHA256_PATTERN.test(document.evidenceDigest)
    ) {
      issues.push(`${label}.evidenceDigest must be a lowercase SHA-256 digest`);
    } else {
      const actualDigest = createIdeRoadmapRuntimeEvidenceDigest(document);
      if (document.evidenceDigest !== actualDigest) {
        issues.push(`${label}.evidenceDigest does not match its envelope`);
      }
    }
    if (!Array.isArray(document.runs) || document.runs.length === 0) {
      issues.push(`${label}.runs must be a non-empty array`);
      continue;
    }
    caseRunCounts.set(
      roadmapCase.id,
      (caseRunCounts.get(roadmapCase.id) || 0) + document.runs.length,
    );
    for (const [runIndex, run] of document.runs.entries()) {
      validateRuntimeRun({
        run,
        runIndex,
        document,
        documentLabel: label,
        roadmapCase,
        releaseCommit: exactReleaseCommit,
        seenRunIds,
        cellCounts: caseCellCounts.get(roadmapCase.id),
        evidenceRoot: path.resolve(evidenceDir),
        documentPath: filePath,
        documentProvenance,
        trustedProvenance: normalizedTrustedProvenance,
        requireReleaseReady,
        inspectVsix,
        remoteSshTrust,
        issues,
      });
    }
  }

  for (const roadmapCase of selectedCases) {
    const counts = caseCellCounts.get(roadmapCase.id);
    for (const cell of expectedMatrixCells(roadmapCase)) {
      const actual = counts.get(cell.key) || 0;
      if (actual < roadmapCase.minimumIndependentRuns) {
        issues.push(
          `${roadmapCase.id} matrix cell ${matrixCellLabel(
            cell.host,
            cell.operatingSystem,
            cell.transport,
          )} has ${actual}/${roadmapCase.minimumIndependentRuns} independent runs`,
        );
      }
    }
  }

  if (issues.length > 0) {
    throw new IdeRoadmapRuntimeEvidenceError(issues);
  }

  const result = {
    schema: IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA,
    manifestVersion: contract.manifestVersion,
    releaseCommit: exactReleaseCommit,
    releaseCommitAuthority: requireReleaseReady
      ? "exact-clean-checkout+github-actions"
      : "caller-asserted-unverified",
    artifactDigestAuthority: requireReleaseReady
      ? "path-bytes-rehashed"
      : "envelope-asserted-unverified",
    provenanceAuthority: requireReleaseReady
      ? "github-actions-context-matched"
      : normalizedTrustedProvenance
        ? "github-actions-context-matched-advisory"
        : "unverified",
    verificationMode: requireReleaseReady ? "release-ready" : "advisory",
    scope: "selected-cases",
    releaseReady: requireReleaseReady ? true : null,
    selectedCaseIds: Object.freeze([...selectedIds]),
    evidenceFileCount: selectedDocumentCount,
    runCount: [...caseRunCounts.values()].reduce(
      (total, count) => total + count,
      0,
    ),
  };
  if (output) {
    const aggregate = {
      ...result,
      aggregateDigest: sha256Json(result),
    };
    writeImmutableJson(output, aggregate);
  }
  return Object.freeze(result);
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

function parseCliArgs(argv) {
  let trustedContextSupplied = false;
  const options = {
    contractOnly: false,
    caseIds: [],
    requireReleaseReady: false,
    trustedProvenance: { provider: IDE_ROADMAP_TRUSTED_PROVIDER },
  };
  const trustedFields = new Map([
    ["--trusted-repository", "repository"],
    ["--trusted-workflow-ref", "workflowRef"],
    ["--trusted-workflow-sha", "workflowSha"],
    ["--trusted-run-id", "runId"],
    ["--trusted-run-attempt", "runAttempt"],
    ["--trusted-job", "job"],
    ["--trusted-artifact-name", "artifactName"],
    ["--trusted-event-name", "eventName"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--contract-only") {
      options.contractOnly = true;
    } else if (argument === "--verify-runtime-evidence-dir") {
      options.evidenceDir = argv[++index];
      if (!options.evidenceDir) {
        throw new Error("--verify-runtime-evidence-dir requires a path");
      }
    } else if (argument === "--release-commit") {
      options.releaseCommit = argv[++index];
      if (!options.releaseCommit) {
        throw new Error("--release-commit requires a value");
      }
    } else if (argument === "--case") {
      const caseId = argv[++index];
      if (!caseId) throw new Error("--case requires a case identifier");
      options.caseIds.push(caseId);
    } else if (argument === "--require-release-ready") {
      options.requireReleaseReady = true;
    } else if (argument === "--bridge-journey-evidence") {
      options.journeyEvidencePath = argv[++index];
      if (!options.journeyEvidencePath) {
        throw new Error("--bridge-journey-evidence requires a path");
      }
    } else if (argument === "--bridge-case") {
      options.bridgeCaseId = argv[++index];
      if (!options.bridgeCaseId) {
        throw new Error("--bridge-case requires a case identifier");
      }
    } else if (argument === "--output") {
      options.output = argv[++index];
      if (!options.output) throw new Error("--output requires a path");
    } else if (trustedFields.has(argument)) {
      const value = argv[++index];
      if (!value) throw new Error(`${argument} requires a value`);
      options.trustedProvenance[trustedFields.get(argument)] = value;
      trustedContextSupplied = true;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  const runtimeRequested =
    Boolean(options.evidenceDir) ||
    Boolean(options.releaseCommit) ||
    options.caseIds.length > 0 ||
    options.requireReleaseReady ||
    Boolean(options.output);
  const bridgeRequested = Boolean(options.journeyEvidencePath);
  if (trustedContextSupplied) {
    options.trustedProvenance.releaseCommit = options.releaseCommit;
  } else {
    options.trustedProvenance = null;
  }
  if (options.contractOnly && runtimeRequested) {
    throw new Error(
      "--contract-only may not be combined with runtime evidence options",
    );
  }
  if (bridgeRequested && options.evidenceDir) {
    throw new Error(
      "--bridge-journey-evidence may not be combined with --verify-runtime-evidence-dir",
    );
  }
  return { ...options, runtimeRequested, bridgeRequested };
}

if (isDirectExecution()) {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    if (options.bridgeRequested) {
      const result = bridgeIdeJourneyEvidenceToRoadmapRuntime({
        ...options,
        caseId: options.bridgeCaseId,
      });
      console.log(
        `Bridged trusted IDE journey ${result.caseId} at release ${result.releaseCommit}.`,
      );
    } else if (options.runtimeRequested) {
      const result = verifyIdeRoadmapRuntimeEvidence(options);
      console.log(
        `Verified IDE roadmap runtime evidence ${result.manifestVersion} for ` +
          `${result.selectedCaseIds.length} case(s), ${result.runCount} run(s), ` +
          `${result.releaseCommitAuthority} release ${result.releaseCommit}; ` +
          `releaseReady=${String(result.releaseReady)}.`,
      );
    } else {
      const result = verifyIdeRoadmapFixtures();
      console.log(
        `Verified IDE roadmap manifest contract ${result.manifestVersion}: ` +
          `${result.caseCount} cases and ${result.testFileCount} referenced test files. ` +
          "Contract only; runtime evidence and release readiness were not evaluated.",
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
