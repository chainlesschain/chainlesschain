#!/usr/bin/env node

/**
 * Create and verify an immutable release attestation for one VSIX.
 *
 * The hashes cover the raw .vsix bytes. Package and VSIX manifest identities
 * are read from the same archive and recorded so a later publish job cannot
 * accidentally substitute a rebuilt or stale extension.
 *
 * Usage:
 *   node scripts/vsix-release-artifact.mjs create <file.vsix> <manifest.json>
 *   node scripts/vsix-release-artifact.mjs verify <file.vsix> <manifest.json>
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  listZipEntries,
  parseVsixManifest,
  readZipEntry,
} from "./verify-vsix.mjs";

const SCHEMA = 1;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const AUTHORITY_ENTRIES = ["extension/package.json", "extension.vsixmanifest"];
const TOP_LEVEL_FIELDS = [
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
];
const IDENTITY_FIELDS = ["id", "publisher", "version"];
const SCRIPT_FILE = fileURLToPath(import.meta.url);
const EXTENSION_ROOT = path.dirname(path.dirname(SCRIPT_FILE));

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireNonEmptyString(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value
  ) {
    throw new Error(
      `${label} must be a non-empty string without outer whitespace`,
    );
  }
  return value;
}

function readArtifact(vsix) {
  if (typeof vsix !== "string" || !vsix) {
    throw new Error("VSIX path is required");
  }
  const file = path.resolve(vsix);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (error) {
    throw new Error(`cannot access VSIX ${file}: ${error.message}`);
  }
  if (!stat.isFile()) throw new Error(`VSIX is not a file: ${file}`);
  if (path.extname(file).toLowerCase() !== ".vsix") {
    throw new Error(`release artifact must have a .vsix extension: ${file}`);
  }
  const bytes = fs.readFileSync(file);
  if (bytes.length !== stat.size) {
    throw new Error(`VSIX size changed while reading: ${file}`);
  }
  return { file, bytes };
}

function hash(bytes, algorithm) {
  return crypto.createHash(algorithm).update(bytes).digest("hex");
}

function parseJsonObject(bytes, label) {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
  if (!isObject(value)) throw new Error(`${label} is not a JSON object`);
  return value;
}

function readRequiredEntry(archive, entries, name) {
  const entry = entries.get(name);
  if (!entry) throw new Error(`${name} is missing from VSIX`);
  try {
    return readZipEntry(archive, entry);
  } catch (error) {
    throw new Error(`cannot read ${name} from VSIX: ${error.message}`);
  }
}

function assertUniqueAuthorityEntries(archive) {
  const minimumOffset = Math.max(0, archive.length - 22 - 65535);
  let eocd = -1;
  for (let offset = archive.length - 22; offset >= minimumOffset; offset--) {
    if (archive.readUInt32LE(offset) === EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) return; // listZipEntries() reports the canonical parse error.

  const count = archive.readUInt16LE(eocd + 10);
  let offset = archive.readUInt32LE(eocd + 16);
  const authorityCounts = new Map(AUTHORITY_ENTRIES.map((name) => [name, 0]));
  for (let index = 0; index < count; index++) {
    if (
      offset < 0 ||
      offset + 46 > archive.length ||
      archive.readUInt32LE(offset) !== CENTRAL_SIGNATURE
    ) {
      return; // listZipEntries() reports the canonical parse error.
    }
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > archive.length) return;
    const name = archive.toString(
      "utf8",
      offset + 46,
      offset + 46 + nameLength,
    );
    if (authorityCounts.has(name)) {
      authorityCounts.set(name, authorityCounts.get(name) + 1);
    }
    offset = next;
  }
  for (const [name, entryCount] of authorityCounts) {
    if (entryCount > 1) throw new Error(`${name} is duplicated in VSIX`);
  }
}

/** Inspect release identity directly from the raw VSIX bytes. */
export function inspectVsixReleaseArtifact(vsix) {
  const { file, bytes } = readArtifact(vsix);
  let entries;
  try {
    entries = listZipEntries(bytes);
  } catch (error) {
    throw new Error(`cannot parse VSIX ${file}: ${error.message}`);
  }
  assertUniqueAuthorityEntries(bytes);

  const packaged = parseJsonObject(
    readRequiredEntry(bytes, entries, "extension/package.json"),
    "extension/package.json",
  );
  const manifest = parseVsixManifest(
    readRequiredEntry(bytes, entries, "extension.vsixmanifest").toString(
      "utf8",
    ),
  );

  const packageName = requireNonEmptyString(
    packaged.name,
    "extension/package.json name",
  );
  const publisher = requireNonEmptyString(
    packaged.publisher,
    "extension/package.json publisher",
  );
  const version = requireNonEmptyString(
    packaged.version,
    "extension/package.json version",
  );
  const identity = {
    id: requireNonEmptyString(
      manifest.id,
      "extension.vsixmanifest Identity Id",
    ),
    publisher: requireNonEmptyString(
      manifest.publisher,
      "extension.vsixmanifest Identity Publisher",
    ),
    version: requireNonEmptyString(
      manifest.version,
      "extension.vsixmanifest Identity Version",
    ),
  };

  const mismatches = [];
  if (identity.id !== packageName) mismatches.push("Id/name");
  if (identity.publisher !== publisher) mismatches.push("Publisher/publisher");
  if (identity.version !== version) mismatches.push("Version/version");
  if (mismatches.length > 0) {
    throw new Error(
      `VSIX package and vsixmanifest identity mismatch: ${mismatches.join(", ")}`,
    );
  }

  return {
    file,
    artifact: path.basename(file),
    bytes: bytes.length,
    sha256: hash(bytes, "sha256"),
    sha512: hash(bytes, "sha512"),
    package: packageName,
    publisher,
    version,
    vsixmanifestIdentity: identity,
  };
}

/**
 * Build a JSON-serializable release manifest. This function does not write it.
 */
export function createVsixReleaseArtifactManifest(options) {
  if (!isObject(options)) throw new Error("create options are required");
  const inspected = inspectVsixReleaseArtifact(
    options.vsix || options.artifact,
  );
  const commit = requireNonEmptyString(options.commit, "commit");
  const workflowRun = requireNonEmptyString(
    options.workflowRun,
    "workflow run",
  );

  const expectedPackage = options.packageName || options.package;
  if (expectedPackage && inspected.package !== expectedPackage) {
    throw new Error(
      `package mismatch: expected ${expectedPackage}, got ${inspected.package}`,
    );
  }
  if (options.publisher && inspected.publisher !== options.publisher) {
    throw new Error(
      `publisher mismatch: expected ${options.publisher}, got ${inspected.publisher}`,
    );
  }
  if (options.version && inspected.version !== options.version) {
    throw new Error(
      `version mismatch: expected ${options.version}, got ${inspected.version}`,
    );
  }

  return {
    schema: SCHEMA,
    artifact: inspected.artifact,
    bytes: inspected.bytes,
    sha256: inspected.sha256,
    sha512: inspected.sha512,
    package: inspected.package,
    publisher: inspected.publisher,
    version: inspected.version,
    vsixmanifestIdentity: inspected.vsixmanifestIdentity,
    commit,
    workflowRun,
    createdAt: new Date().toISOString(),
  };
}

function sameFields(value, expectedFields) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  return (
    actual.length === expectedFields.length &&
    actual.every((field, index) => field === expectedFields[index])
  );
}

function isLowerHex(value, length) {
  return (
    typeof value === "string" &&
    value.length === length &&
    /^[0-9a-f]+$/u.test(value)
  );
}

/** Strictly bind a VSIX, its identities, and its workflow provenance. */
export function verifyVsixReleaseArtifact(vsix, manifest, expected = {}) {
  if (!isObject(expected))
    throw new Error("verify expectations must be an object");

  const failures = [];
  const fail = (label) => {
    if (!failures.includes(label)) failures.push(label);
  };

  if (!sameFields(manifest, TOP_LEVEL_FIELDS)) fail("manifest fields");
  if (manifest?.schema !== SCHEMA) fail("manifest schema");
  if (
    typeof manifest?.artifact !== "string" ||
    !manifest.artifact ||
    path.basename(manifest.artifact) !== manifest.artifact ||
    path.extname(manifest.artifact).toLowerCase() !== ".vsix"
  ) {
    fail("artifact name");
  }
  if (!Number.isSafeInteger(manifest?.bytes) || manifest.bytes <= 0) {
    fail("byte length");
  }
  if (!isLowerHex(manifest?.sha256, 64)) fail("sha256");
  if (!isLowerHex(manifest?.sha512, 128)) fail("sha512");
  for (const field of [
    "package",
    "publisher",
    "version",
    "commit",
    "workflowRun",
  ]) {
    try {
      requireNonEmptyString(manifest?.[field], `manifest ${field}`);
    } catch {
      fail(field === "workflowRun" ? "workflow run" : field);
    }
  }
  if (!sameFields(manifest?.vsixmanifestIdentity, IDENTITY_FIELDS)) {
    fail("vsixmanifest identity fields");
  }
  for (const field of IDENTITY_FIELDS) {
    try {
      requireNonEmptyString(
        manifest?.vsixmanifestIdentity?.[field],
        `vsixmanifest identity ${field}`,
      );
    } catch {
      fail(`vsixmanifest identity ${field}`);
    }
  }
  if (
    typeof manifest?.createdAt !== "string" ||
    Number.isNaN(Date.parse(manifest.createdAt)) ||
    new Date(manifest.createdAt).toISOString() !== manifest.createdAt
  ) {
    fail("createdAt");
  }

  let inspected;
  try {
    inspected = inspectVsixReleaseArtifact(vsix);
  } catch (error) {
    fail(`VSIX metadata (${error.message})`);
  }
  if (inspected) {
    if (manifest?.artifact !== inspected.artifact) fail("artifact name");
    if (manifest?.bytes !== inspected.bytes) fail("byte length");
    if (manifest?.sha256 !== inspected.sha256) fail("sha256");
    if (manifest?.sha512 !== inspected.sha512) fail("sha512");
    if (manifest?.package !== inspected.package) fail("package");
    if (manifest?.publisher !== inspected.publisher) fail("publisher");
    if (manifest?.version !== inspected.version) fail("version");
    if (
      manifest?.vsixmanifestIdentity?.id !== inspected.vsixmanifestIdentity.id
    ) {
      fail("vsixmanifest identity id");
    }
    if (
      manifest?.vsixmanifestIdentity?.publisher !==
      inspected.vsixmanifestIdentity.publisher
    ) {
      fail("vsixmanifest identity publisher");
    }
    if (
      manifest?.vsixmanifestIdentity?.version !==
      inspected.vsixmanifestIdentity.version
    ) {
      fail("vsixmanifest identity version");
    }
  }

  const expectedPackage = expected.packageName || expected.package;
  if (expectedPackage && manifest?.package !== expectedPackage) fail("package");
  if (expected.publisher && manifest?.publisher !== expected.publisher) {
    fail("publisher");
  }
  if (expected.version && manifest?.version !== expected.version)
    fail("version");
  if (expected.commit && manifest?.commit !== expected.commit) fail("commit");
  if (expected.workflowRun && manifest?.workflowRun !== expected.workflowRun) {
    fail("workflow run");
  }

  if (failures.length > 0) {
    throw new Error(
      `VSIX release artifact verification failed: ${failures.join(", ")}`,
    );
  }
  return true;
}

// Symmetric aliases with packages/cli/scripts/npm-release-artifact.mjs.
export const createReleaseArtifactManifest = createVsixReleaseArtifactManifest;
export const verifyReleaseArtifact = verifyVsixReleaseArtifact;

function workflowRunFromEnvironment(env) {
  if (env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID) {
    return `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  }
  return env.CC_RELEASE_WORKFLOW_RUN || null;
}

export function releaseCommitFromEnvironment(env) {
  return env.CC_RELEASE_COMMIT || env.GITHUB_SHA || null;
}

function sourceIdentity() {
  const sourcePath = path.join(EXTENSION_ROOT, "package.json");
  let source;
  try {
    source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  } catch (error) {
    throw new Error(`cannot read extension package.json: ${error.message}`);
  }
  if (!isObject(source)) {
    throw new Error("extension package.json is not a JSON object");
  }
  return {
    packageName: requireNonEmptyString(source.name, "source package name"),
    publisher: requireNonEmptyString(source.publisher, "source publisher"),
    version: requireNonEmptyString(source.version, "source version"),
  };
}

function readManifest(manifestPath) {
  const file = path.resolve(manifestPath);
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`cannot read manifest ${file}: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`manifest is not valid JSON: ${error.message}`);
  }
}

function writeManifest(manifestPath, manifest) {
  const file = path.resolve(manifestPath);
  try {
    fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  } catch (error) {
    throw new Error(`cannot write manifest ${file}: ${error.message}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 3 || !["create", "verify"].includes(args[0])) {
    throw new Error(
      "usage: vsix-release-artifact.mjs create|verify <file.vsix> <manifest.json>",
    );
  }
  const [command, vsix, manifestPath] = args;
  const workflowRun = workflowRunFromEnvironment(process.env);
  const source = sourceIdentity();
  const expected = {
    packageName: process.env.CC_RELEASE_PACKAGE || source.packageName,
    publisher:
      process.env.CC_VSIX_PUBLISHER ||
      process.env.CC_RELEASE_PUBLISHER ||
      source.publisher,
    version: process.env.CC_RELEASE_VERSION || source.version,
    commit: releaseCommitFromEnvironment(process.env),
    workflowRun,
  };

  if (command === "create") {
    const manifest = createVsixReleaseArtifactManifest({
      vsix,
      ...expected,
      commit: expected.commit,
      workflowRun: expected.workflowRun,
    });
    writeManifest(manifestPath, manifest);
    process.stdout.write(`${manifest.sha256}  ${manifest.artifact}\n`);
    return;
  }

  const manifest = readManifest(manifestPath);
  verifyVsixReleaseArtifact(vsix, manifest, expected);
  process.stdout.write(`verified ${manifest.sha256}  ${manifest.artifact}\n`);
}

if (process.argv[1] && SCRIPT_FILE === path.resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`VSIX release artifact error: ${error.message}\n`);
    process.exitCode = 1;
  }
}
