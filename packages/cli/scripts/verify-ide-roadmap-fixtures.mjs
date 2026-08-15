import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const IDE_ROADMAP_SCHEMA_VERSION = 1;
export const IDE_ROADMAP_MANIFEST_VERSION = "1.3.0";
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
  if (runtimeEvidence.verificationScope !== "structural-envelope-only") {
    issues.push(
      'runtimeEvidence.verificationScope must equal "structural-envelope-only"',
    );
  }
  if (
    runtimeEvidence.releaseReadiness !==
    "unsupported-without-trusted-provenance"
  ) {
    issues.push(
      'runtimeEvidence.releaseReadiness must equal "unsupported-without-trusted-provenance"',
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
  const { evidenceDigest: _ignored, ...core } = evidence;
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

function validateRuntimeRun({
  run,
  runIndex,
  document,
  documentLabel,
  roadmapCase,
  releaseCommit,
  seenRunIds,
  cellCounts,
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
  for (const artifact of artifacts) {
    const digest = run.artifactDigests?.[artifact];
    if (typeof digest !== "string" || !SHA256_PATTERN.test(digest)) {
      issues.push(
        `${label}.artifactDigests[${JSON.stringify(artifact)}] must be a lowercase SHA-256 digest`,
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
}

export function verifyIdeRoadmapRuntimeEvidence({
  repoRoot = DEFAULT_REPO_ROOT,
  manifestPath = IDE_ROADMAP_MANIFEST_PATH,
  evidenceDir,
  releaseCommit,
  caseIds = [],
  requireReleaseReady = false,
} = {}) {
  const contract = verifyIdeRoadmapFixtures({ repoRoot, manifestPath });
  const issues = [];
  if (requireReleaseReady) {
    issues.push(
      "release-readiness verification is unsupported until evidence is bound to trusted CI provenance, the checked-out release commit, and complete version/transport/hardware/network/sample dimensions",
    );
  }
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
  for (const { label, value: document } of documents) {
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

  return Object.freeze({
    schema: IDE_ROADMAP_RUNTIME_EVIDENCE_SCHEMA,
    manifestVersion: contract.manifestVersion,
    releaseCommit: exactReleaseCommit,
    releaseCommitAuthority: "caller-asserted-unverified",
    artifactDigestAuthority: "envelope-asserted-unverified",
    scope: "selected-cases",
    releaseReady: null,
    selectedCaseIds: Object.freeze([...selectedIds]),
    evidenceFileCount: selectedDocumentCount,
    runCount: [...caseRunCounts.values()].reduce(
      (total, count) => total + count,
      0,
    ),
  });
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

function parseCliArgs(argv) {
  const options = {
    contractOnly: false,
    caseIds: [],
    requireReleaseReady: false,
  };
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
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  const runtimeRequested =
    Boolean(options.evidenceDir) ||
    Boolean(options.releaseCommit) ||
    options.caseIds.length > 0 ||
    options.requireReleaseReady;
  if (options.contractOnly && runtimeRequested) {
    throw new Error(
      "--contract-only may not be combined with runtime evidence options",
    );
  }
  return { ...options, runtimeRequested };
}

if (isDirectExecution()) {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    if (options.runtimeRequested) {
      const result = verifyIdeRoadmapRuntimeEvidence(options);
      console.log(
        `Verified IDE roadmap runtime evidence ${result.manifestVersion} for ` +
          `${result.selectedCaseIds.length} case(s), ${result.runCount} run(s), ` +
          `caller-asserted release ${result.releaseCommit}. ` +
          "Structural envelope audit only; trusted provenance and release readiness were not verified.",
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
