#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  GRAPH_PRODUCTION_CUTOVER_EVIDENCE_SCHEMA,
  GRAPH_PRODUCTION_EVIDENCE_ENVIRONMENT,
  GRAPH_PRODUCTION_EVIDENCE_REF,
  GRAPH_PRODUCTION_EVIDENCE_WORKFLOW,
  graphProductionCutoverEvidenceDigest,
  graphProductionExpectedIdentityBinding,
  normalizeGraphProductionCutoverEvidence,
} from "../src/lib/graph-kernel/production-cutover-evidence.js";
import {
  GRAPH_PRODUCTION_SOURCE_FRAGMENT_SCHEMA,
  normalizeGraphProductionSourceBundle,
} from "../src/lib/graph-kernel/production-source-evidence.js";
import {
  GRAPH_RUNTIME_SURFACE_MANIFEST_PATH,
  assertGraphProductionRuntimeSurfaceManifest,
  graphRuntimeEntryManifestDigest,
  graphRuntimeSurfaceManifestDigest,
  loadGraphRuntimeSurfaceManifest,
} from "../src/lib/graph-kernel/runtime-surface-manifest.js";

export const GRAPH_PRODUCTION_SOURCE_REGISTRY_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.github/graph-kernel-production-source-registry.json",
);
const EXPECTED_RECEIPT_COUNT = 69;
const MAX_RECEIPT_BYTES = 512 * 1024;
const MAX_TOTAL_RECEIPT_BYTES = 36 * 1024 * 1024;
const MAX_AGGREGATE_BYTES = 64 * 1024 * 1024;
const MAX_AUXILIARY_BYTES = 4 * 1024 * 1024;

function fail(message, details = {}) {
  const error = new Error(message);
  error.code = "CC_GRAPH_PRODUCTION_ASSEMBLY_INVALID";
  Object.assign(error, details);
  throw error;
}

function sameFileIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.mode === right.mode &&
    left.nlink === right.nlink
  );
}

export function assertStableFileIdentity(before, after, pathname) {
  if (!sameFileIdentity(before, after)) {
    fail(`${pathname} changed while it was being staged`, { pathname });
  }
}

function assertTrustedStat(stat, pathname, { directory = false } = {}) {
  if (
    (directory ? !stat.isDirectory() : !stat.isFile()) ||
    (!directory && stat.nlink !== 1)
  ) {
    fail(
      `${pathname} must be a regular, non-hardlinked ${directory ? "directory" : "file"}`,
    );
  }
  if (process.platform !== "win32") {
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
      fail(`${pathname} must be owned by the current aggregate runner`);
    }
    if ((stat.mode & 0o222) !== 0) {
      fail(`${pathname} must be read-only before trusted staging`);
    }
  }
}

function trustedDirectory(directory, field) {
  const raw = String(directory || "");
  if (!path.isAbsolute(raw) || raw.split(/[\\/]/u).includes("..")) {
    fail(`${field} must be an absolute directory`);
  }
  const resolved = path.resolve(directory);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink()) fail(`${field} must not be a symbolic link`);
  assertTrustedStat(stat, resolved, { directory: true });
  const real = fs.realpathSync(resolved);
  if (real !== resolved) fail(`${field} must already be canonical`);
  return real;
}

function privateStagingRoot(directory) {
  const raw = String(directory || "");
  if (!path.isAbsolute(raw) || raw.split(/[\\/]/u).includes("..")) {
    fail("--staging-root must be an absolute private runner directory");
  }
  const resolved = path.resolve(directory);
  if (fs.existsSync(resolved)) {
    const stat = fs.lstatSync(resolved);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      fs.realpathSync(resolved) !== resolved ||
      fs.readdirSync(resolved).length !== 0 ||
      (process.platform !== "win32" &&
        ((stat.mode & 0o077) !== 0 ||
          (typeof process.getuid === "function" &&
            stat.uid !== process.getuid())))
    ) {
      fail(
        "--staging-root must be an empty, canonical, runner-owned private directory",
      );
    }
    return resolved;
  }
  const parent = path.dirname(resolved);
  const parentStat = fs.lstatSync(parent);
  if (
    !parentStat.isDirectory() ||
    parentStat.isSymbolicLink() ||
    fs.realpathSync(parent) !== parent ||
    (process.platform !== "win32" &&
      ((parentStat.mode & 0o022) !== 0 ||
        (typeof process.getuid === "function" &&
          parentStat.uid !== process.getuid())))
  ) {
    fail("--staging-root parent must be a canonical real directory");
  }
  fs.mkdirSync(resolved, { recursive: false, mode: 0o700 });
  return privateStagingRoot(resolved);
}

function readStableFile(file, maximumBytes, field) {
  const pathStat = fs.lstatSync(file);
  if (pathStat.isSymbolicLink()) fail(`${field} must not be a symbolic link`);
  assertTrustedStat(pathStat, file);
  if (pathStat.size < 1 || pathStat.size > maximumBytes) {
    fail(`${field} exceeds its bounded size`);
  }
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const fd = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
  try {
    const openedBefore = fs.fstatSync(fd);
    if (!sameFileIdentity(pathStat, openedBefore)) {
      fail(`${field} was replaced before it could be opened safely`);
    }
    const bytes = Buffer.alloc(openedBefore.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(
        fd,
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (count === 0) fail(`${field} was truncated while being read`);
      offset += count;
    }
    const openedAfter = fs.fstatSync(fd);
    const pathAfter = fs.lstatSync(file);
    assertStableFileIdentity(openedBefore, openedAfter, file);
    assertStableFileIdentity(openedBefore, pathAfter, file);
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

function parseJson(bytes, field) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (cause) {
    fail(`${field} is not valid JSON`, { cause });
  }
}

export function loadTrustedJsonFile(
  file,
  { maximumBytes = MAX_AUXILIARY_BYTES, field = file } = {},
) {
  return parseJson(
    readStableFile(path.resolve(file), maximumBytes, field),
    field,
  );
}

export function loadTrustedGraphRuntimeSurfaceManifest() {
  const manifest = loadTrustedJsonFile(GRAPH_RUNTIME_SURFACE_MANIFEST_PATH, {
    field: "checked-in Graph runtime surface manifest",
  });
  assertGraphProductionRuntimeSurfaceManifest(manifest);
  return manifest;
}

export function stageGraphProductionSourceReceipts({
  sourceArtifacts,
  stagingRoot,
}) {
  const source = trustedDirectory(sourceArtifacts, "--source-artifacts");
  const privateRoot = privateStagingRoot(stagingRoot);
  const stage = fs.mkdtempSync(path.join(privateRoot, "graph-source-"));
  if (process.platform !== "win32") fs.chmodSync(stage, 0o700);
  const entries = fs.readdirSync(source, { withFileTypes: true });
  if (
    entries.length !== EXPECTED_RECEIPT_COUNT ||
    entries.some(
      (entry) =>
        !entry.isFile() || !/^[A-Za-z0-9._-]+\.json$/u.test(entry.name),
    )
  ) {
    fail(
      `the current-run source artifact directory must contain exactly ${EXPECTED_RECEIPT_COUNT} flat JSON receipt files`,
    );
  }
  let totalBytes = 0;
  return entries
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry, index) => {
      const input = path.join(source, entry.name);
      const bytes = readStableFile(input, MAX_RECEIPT_BYTES, entry.name);
      totalBytes += bytes.length;
      assertBoundedSourceReceiptBytes(totalBytes);
      const digest = createHash("sha256").update(bytes).digest("hex");
      const staged = path.join(
        stage,
        `${String(index).padStart(2, "0")}-${digest}.json`,
      );
      const fd = fs.openSync(
        staged,
        fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
        0o400,
      );
      try {
        fs.writeFileSync(fd, bytes);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      const stagedBytes = readStableFile(staged, MAX_RECEIPT_BYTES, staged);
      if (!bytes.equals(stagedBytes)) {
        fail(`${entry.name} changed during private staging`);
      }
      return parseJson(stagedBytes, entry.name);
    });
}

export function assertBoundedSourceReceiptBytes(byteLength) {
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0 ||
    byteLength > MAX_TOTAL_RECEIPT_BYTES
  ) {
    fail("current-run source receipt bundle exceeds the aggregate input limit");
  }
}

export function writeNewAggregateFile(serialized, outputPath) {
  const output = path.resolve(outputPath);
  const parentPath = path.dirname(output);
  const parentStat = fs.lstatSync(parentPath);
  const parent = fs.realpathSync(parentPath);
  if (
    parent !== parentPath ||
    !parentStat.isDirectory() ||
    parentStat.isSymbolicLink() ||
    fs.existsSync(output) ||
    (process.platform !== "win32" &&
      ((parentStat.mode & 0o022) !== 0 ||
        (typeof process.getuid === "function" &&
          parentStat.uid !== process.getuid())))
  ) {
    fail(
      "output must be a new file in a canonical runner-owned private directory",
    );
  }
  assertBoundedAggregateBytes(Buffer.byteLength(serialized, "utf8"));
  const outputFd = fs.openSync(
    output,
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
    0o600,
  );
  try {
    fs.writeFileSync(outputFd, serialized, "utf8");
    fs.fsyncSync(outputFd);
  } finally {
    fs.closeSync(outputFd);
  }
  return output;
}

export function assertBoundedAggregateBytes(byteLength) {
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0 ||
    byteLength > MAX_AGGREGATE_BYTES
  ) {
    fail("aggregate evidence exceeds the immutable artifact size limit");
  }
}

function fragmentsFromReceipts(receipts, manifest, registry) {
  const groups = new Map();
  for (const receipt of receipts) {
    const key = `${receipt?.payload?.surface}/${receipt?.payload?.entryId}`;
    const values = groups.get(key) || [];
    values.push(receipt);
    groups.set(key, values);
  }
  return manifest.surfaces.flatMap((surface) =>
    surface.entries.map((entry) => {
      const key = `${surface.originSurface}/${entry.id}`;
      return {
        schema: GRAPH_PRODUCTION_SOURCE_FRAGMENT_SCHEMA,
        surface: surface.originSurface,
        entryId: entry.id,
        registryDigest: registry.registryDigest,
        manifestDigest: graphRuntimeSurfaceManifestDigest(manifest),
        entryManifestDigest: graphRuntimeEntryManifestDigest(
          manifest,
          surface.originSurface,
          entry.id,
        ),
        receipts: groups.get(key) || [],
      };
    }),
  );
}

export function assembleGraphProductionCutoverEvidence(
  receipts,
  {
    sourceRegistry,
    expectedRegistryDigest,
    challenge,
    commitSha,
    repository,
    workflowRunId,
    workflowRunAttempt,
    jobsInventory,
    manifest = loadGraphRuntimeSurfaceManifest(),
    clock = Date.now,
  },
) {
  if (!Array.isArray(receipts) || receipts.length !== EXPECTED_RECEIPT_COUNT) {
    fail(
      `exactly ${EXPECTED_RECEIPT_COUNT} independently signed source receipts are required`,
    );
  }
  const sourceFragments = fragmentsFromReceipts(
    receipts,
    manifest,
    sourceRegistry,
  );
  const verificationOptions = {
    manifest,
    expectedCommitSha: commitSha,
    expectedRepository: repository,
    expectedEnvironment: GRAPH_PRODUCTION_EVIDENCE_ENVIRONMENT,
    expectedWorkflow: GRAPH_PRODUCTION_EVIDENCE_WORKFLOW,
    expectedWorkflowRunId: workflowRunId,
    expectedWorkflowRunAttempt: workflowRunAttempt,
    expectedRegistryDigest,
    expectedChallenge: challenge,
    jobsInventory,
    clock,
  };
  const sourceBundle = normalizeGraphProductionSourceBundle(
    { registry: sourceRegistry, fragments: sourceFragments },
    verificationOptions,
  );
  const provenance = {
    repository,
    workflow: GRAPH_PRODUCTION_EVIDENCE_WORKFLOW,
    ref: GRAPH_PRODUCTION_EVIDENCE_REF,
    environment: GRAPH_PRODUCTION_EVIDENCE_ENVIRONMENT,
    workflowRunId: Number(workflowRunId),
    workflowRunAttempt: Number(workflowRunAttempt),
    manifestDigest: sourceBundle.manifestDigest,
    sourceRegistryDigest: sourceBundle.registry.registryDigest,
    challenge,
  };
  provenance.expectedIdentityBinding = graphProductionExpectedIdentityBinding({
    commitSha,
    ...provenance,
  });
  const latestCollection = Math.max(
    ...sourceBundle.fragments.flatMap((fragment) =>
      fragment.receipts.map((receipt) =>
        Date.parse(receipt.payload.collectorEndedAt),
      ),
    ),
  );
  const unsigned = {
    schema: GRAPH_PRODUCTION_CUTOVER_EVIDENCE_SCHEMA,
    commitSha,
    manifestDigest: sourceBundle.manifestDigest,
    observedAt: new Date(latestCollection).toISOString(),
    provenance,
    sourceRegistry: sourceBundle.registry,
    sourceFragments: sourceBundle.fragments,
    entries: sourceBundle.entries,
    disabledEntries: sourceBundle.disabledEntries,
  };
  const candidate = {
    ...unsigned,
    evidenceDigest: graphProductionCutoverEvidenceDigest(unsigned),
  };
  return normalizeGraphProductionCutoverEvidence(
    candidate,
    verificationOptions,
  );
}

function parseArguments(argv) {
  const fields = {
    "--source-artifacts": "sourceArtifacts",
    "--staging-root": "stagingRoot",
    "--expected-registry-digest": "expectedRegistryDigest",
    "--challenge": "challenge",
    "--expected-commit": "commitSha",
    "--repository": "repository",
    "--workflow-run-id": "workflowRunId",
    "--workflow-run-attempt": "workflowRunAttempt",
    "--jobs-inventory": "jobsInventory",
    "--output": "output",
  };
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    const field = fields[argument];
    const value = argv[index + 1];
    if (!field || !value || value.startsWith("--")) {
      fail(`unknown or incomplete argument: ${argument}`);
    }
    options[field] = value;
    index += 1;
  }
  return options;
}

function usage() {
  return [
    "Usage:",
    "  node packages/cli/scripts/assemble-graph-production-cutover-evidence.mjs \\",
    "    --source-artifacts <current-run-read-only-directory> --staging-root <private-directory> \\",
    "    --expected-registry-digest <protected-pin> --challenge <hosted-job-challenge> \\",
    "    --expected-commit <sha> --repository <owner/repo> --workflow-run-id <id> \\",
    "    --workflow-run-attempt <attempt> --jobs-inventory <paginated-file> --output <file>",
    "",
    "The CLI accepts only current-run signed receipts. It has no clock, metric, timestamp, host, or signing-key override.",
  ].join("\n");
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  for (const field of [
    "sourceArtifacts",
    "stagingRoot",
    "expectedRegistryDigest",
    "challenge",
    "commitSha",
    "repository",
    "workflowRunId",
    "workflowRunAttempt",
    "jobsInventory",
    "output",
  ]) {
    if (!options[field]) fail(`${field} is required\n${usage()}`);
  }
  const receipts = stageGraphProductionSourceReceipts(options);
  const evidence = assembleGraphProductionCutoverEvidence(receipts, {
    ...options,
    sourceRegistry: loadTrustedJsonFile(GRAPH_PRODUCTION_SOURCE_REGISTRY_PATH, {
      field: "checked-in source registry",
    }),
    manifest: loadTrustedGraphRuntimeSurfaceManifest(),
    jobsInventory: loadTrustedJsonFile(options.jobsInventory, {
      field: "current-attempt Actions job inventory",
    }),
  });
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  const output = writeNewAggregateFile(serialized, options.output);
  process.stdout.write(`${output}\n`);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error?.code ? `${error.code}: ` : ""}${error?.message || error}\n`,
    );
    process.exitCode = 1;
  }
}
