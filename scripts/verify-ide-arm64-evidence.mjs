#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  canonicalJson,
  IDE_JOURNEY_EVIDENCE_SCHEMA,
  IDE_JOURNEY_EVIDENCE_VERSION,
  sha256Buffer,
} from "./ide-journey-evidence.mjs";

export const IDE_ARM64_VALIDATION_SCHEMA =
  "chainlesschain.ide-arm64-validation.v1";
export const IDE_ARM64_REQUIRED_ARCHITECTURE = "arm64";
export const IDE_ARM64_MINIMUM_VSCODE_VERSION = "1.85.2";
export const IDE_ARM64_JETBRAINS_VERSIONS_BY_OS = Object.freeze({
  darwin: Object.freeze(["2024.2", "2025.2"]),
  linux: Object.freeze(["2024.2", "2025.2"]),
  // JetBrains did not publish Windows ARM64 distributions for 2024.2/2025.2.
  // This exact unified IDEA release has a vendor windowsARM64 installer.
  win32: Object.freeze(["2026.2.0.1"]),
});
export const IDE_ARM64_JETBRAINS_WINDOWS_NATIVE_RELEASE = "2026.2.0.1";
export const IDE_ARM64_JETBRAINS_RELEASES_SOURCE =
  "https://data.services.jetbrains.com/products/releases?code=IIU&type=release";

const EXACT_COMMIT = /^[a-f0-9]{40}$/;
const EXACT_VSCODE_VERSION = /^\d+\.\d+\.\d+$/;
const OPERATING_SYSTEMS = Object.freeze(["darwin", "linux", "win32"]);
const VSCODE_JOURNEY_ID =
  "vscode-installed-vsix-real-dom-multiroot-multiwindow-control-workbench-restart";
const JETBRAINS_JOURNEY_ID = "jetbrains-chat-control-workbench-restart-rewind";

function sha256File(filePath) {
  return sha256Buffer(readFileSync(filePath));
}

function listEvidenceFiles(root, output = []) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) {
      listEvidenceFiles(candidate, output);
    } else if (entry.isFile() && entry.name === "journey-evidence.json") {
      output.push(candidate);
    }
  }
  return output;
}

function assertWithin(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes its evidence directory`);
  }
}

function verifyArtifact(evidenceDirectory, record) {
  if (
    !record ||
    typeof record.sha256 !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(record.sha256) ||
    !Number.isSafeInteger(record.bytes) ||
    record.bytes < 0
  ) {
    throw new Error("invalid IDE journey artifact record");
  }
  if (record.path === undefined) {
    if (
      record.kind !== "release-artifact" ||
      typeof record.name !== "string" ||
      !record.name ||
      path.basename(record.name) !== record.name
    ) {
      throw new Error("unverifiable IDE journey artifact record");
    }
    return false;
  }
  if (
    typeof record.path !== "string" ||
    !record.path ||
    record.path.includes("\\") ||
    record.path.includes("\0") ||
    path.posix.isAbsolute(record.path) ||
    record.path.split("/").some((segment) => segment === "..")
  ) {
    throw new Error("invalid IDE journey artifact path");
  }
  const artifactPath = path.resolve(
    evidenceDirectory,
    ...record.path.split("/"),
  );
  assertWithin(evidenceDirectory, artifactPath, "artifact path");
  const stat = statSync(artifactPath, { throwIfNoEntry: false });
  if (!stat?.isFile()) {
    throw new Error(`missing IDE journey artifact: ${record.path}`);
  }
  const realEvidenceDirectory = realpathSync(evidenceDirectory);
  const realArtifactPath = realpathSync(artifactPath);
  assertWithin(realEvidenceDirectory, realArtifactPath, "real artifact path");
  if (
    stat.size !== record.bytes ||
    sha256File(realArtifactPath) !== record.sha256
  ) {
    throw new Error(`IDE journey artifact digest mismatch: ${record.path}`);
  }
  return true;
}

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function classifyEvidence(value) {
  const host = value.host?.name;
  const operatingSystem = value.host?.operatingSystem;
  const version = value.host?.version;
  if (!OPERATING_SYSTEMS.includes(operatingSystem)) {
    throw new Error(
      `unexpected IDE ARM64 operating system: ${operatingSystem}`,
    );
  }
  if (host === "vscode") {
    if (
      value.journeyId !== VSCODE_JOURNEY_ID ||
      !EXACT_VSCODE_VERSION.test(version || "")
    ) {
      throw new Error("invalid VS Code ARM64 journey identity");
    }
    if (
      value.workspace?.rootCount !== 2 ||
      value.workspace?.layout !== "multi-root"
    ) {
      throw new Error(
        "VS Code ARM64 evidence must prove the ordered two-root journey",
      );
    }
    const slot =
      version === IDE_ARM64_MINIMUM_VSCODE_VERSION ? "minimum" : "stable";
    if (
      slot === "stable" &&
      compareVersions(version, IDE_ARM64_MINIMUM_VSCODE_VERSION) <= 0
    ) {
      throw new Error(`invalid VS Code stable ARM64 version: ${version}`);
    }
    return {
      key: `vscode:${operatingSystem}:${slot}`,
      host,
      operatingSystem,
      version,
      slot,
    };
  }
  if (host === "jetbrains") {
    const supportedVersions =
      IDE_ARM64_JETBRAINS_VERSIONS_BY_OS[operatingSystem] || [];
    if (
      value.journeyId !== JETBRAINS_JOURNEY_ID ||
      !supportedVersions.includes(version)
    ) {
      throw new Error("invalid JetBrains ARM64 journey identity");
    }
    return {
      key: `jetbrains:${operatingSystem}:${version}`,
      host,
      operatingSystem,
      version,
      slot: version,
    };
  }
  throw new Error(`unexpected IDE ARM64 host: ${host}`);
}

function requiredMatrixKeys() {
  const keys = [];
  for (const operatingSystem of OPERATING_SYSTEMS) {
    keys.push(`vscode:${operatingSystem}:stable`);
    keys.push(`vscode:${operatingSystem}:minimum`);
    for (const version of IDE_ARM64_JETBRAINS_VERSIONS_BY_OS[operatingSystem]) {
      keys.push(`jetbrains:${operatingSystem}:${version}`);
    }
  }
  return keys.sort();
}

function verifyEvidenceFile(filePath, releaseCommit) {
  const value = JSON.parse(readFileSync(filePath, "utf8"));
  const core = { ...value };
  delete core.evidenceDigest;
  const expectedDigest = sha256Buffer(canonicalJson(core));
  if (
    value.schema !== IDE_JOURNEY_EVIDENCE_SCHEMA ||
    value.schemaVersion !== IDE_JOURNEY_EVIDENCE_VERSION ||
    value.releaseCommit !== releaseCommit ||
    value.required !== true ||
    value.result !== "passed" ||
    value.evidenceComplete !== true ||
    value.host?.architecture !== IDE_ARM64_REQUIRED_ARCHITECTURE ||
    value.evidenceDigest !== expectedDigest ||
    !Array.isArray(value.artifacts) ||
    value.artifacts.length < 1 ||
    !Array.isArray(value.incidents) ||
    !String(value.host?.transport || "").startsWith("local-ide-bridge")
  ) {
    throw new Error(`invalid IDE ARM64 journey evidence: ${filePath}`);
  }
  const directory = path.dirname(filePath);
  let pathBackedArtifacts = 0;
  for (const record of value.artifacts) {
    if (verifyArtifact(directory, record)) pathBackedArtifacts += 1;
  }
  if (pathBackedArtifacts < 1) {
    throw new Error(
      `IDE ARM64 evidence has no re-verifiable artifact: ${filePath}`,
    );
  }
  return { value, matrix: classifyEvidence(value) };
}

function writeImmutableJson(destination, value) {
  const resolved = path.resolve(destination);
  mkdirSync(path.dirname(resolved), { recursive: true });
  if (existsSync(resolved)) {
    throw new Error(`aggregate destination already exists: ${resolved}`);
  }
  const temporary = `${resolved}.tmp-${process.pid}`;
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    linkSync(temporary, resolved);
    unlinkSync(temporary);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      unlinkSync(temporary);
    } catch {
      // Preserve the original immutable-publication error.
    }
    throw error;
  }
}

export function assertExactArm64Host({
  releaseCommit,
  expectedPlatform,
  expectedArchitecture = IDE_ARM64_REQUIRED_ARCHITECTURE,
  repositoryRoot = process.cwd(),
} = {}) {
  if (!EXACT_COMMIT.test(releaseCommit || "")) {
    throw new Error("--release-commit must be an exact 40-character SHA");
  }
  if (!OPERATING_SYSTEMS.includes(expectedPlatform)) {
    throw new Error(`unsupported expected platform: ${expectedPlatform}`);
  }
  if (expectedArchitecture !== IDE_ARM64_REQUIRED_ARCHITECTURE) {
    throw new Error(
      `unsupported expected architecture: ${expectedArchitecture}`,
    );
  }
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  const dirty = execFileSync(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    { cwd: repositoryRoot, encoding: "utf8" },
  ).trim();
  if (head !== releaseCommit || dirty) {
    throw new Error("IDE ARM64 validation requires the exact clean source SHA");
  }
  if (
    process.platform !== expectedPlatform ||
    process.arch !== expectedArchitecture
  ) {
    throw new Error(
      `IDE ARM64 runner mismatch: expected ${expectedPlatform}/${expectedArchitecture}, got ${process.platform}/${process.arch}`,
    );
  }
  return Object.freeze({
    releaseCommit,
    platform: process.platform,
    architecture: process.arch,
  });
}

export function verifyIdeArm64EvidenceSet({
  evidenceDir,
  releaseCommit,
  output,
} = {}) {
  if (!EXACT_COMMIT.test(releaseCommit || "")) {
    throw new Error("releaseCommit must be an exact 40-character SHA");
  }
  const root = path.resolve(evidenceDir || "");
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`IDE ARM64 evidence directory does not exist: ${root}`);
  }
  const files = listEvidenceFiles(root).sort();
  const expectedKeys = requiredMatrixKeys();
  if (files.length !== expectedKeys.length) {
    throw new Error(
      `IDE ARM64 matrix requires ${expectedKeys.length} evidence files, found ${files.length}`,
    );
  }
  const entries = [];
  const seen = new Set();
  for (const filePath of files) {
    const verified = verifyEvidenceFile(filePath, releaseCommit);
    if (seen.has(verified.matrix.key)) {
      throw new Error(
        `duplicate IDE ARM64 matrix entry: ${verified.matrix.key}`,
      );
    }
    seen.add(verified.matrix.key);
    entries.push({
      ...verified.matrix,
      evidenceDigest: verified.value.evidenceDigest,
      evidenceSha256: sha256File(filePath),
    });
  }
  const actualKeys = [...seen].sort();
  if (canonicalJson(actualKeys) !== canonicalJson(expectedKeys)) {
    const missing = expectedKeys.filter((key) => !seen.has(key));
    const unexpected = actualKeys.filter((key) => !expectedKeys.includes(key));
    throw new Error(
      `incomplete IDE ARM64 matrix: missing=${missing.join(",") || "none"}; unexpected=${unexpected.join(",") || "none"}`,
    );
  }
  entries.sort((left, right) => left.key.localeCompare(right.key));
  const core = {
    schema: IDE_ARM64_VALIDATION_SCHEMA,
    releaseCommit,
    result: "passed",
    required: true,
    architecture: IDE_ARM64_REQUIRED_ARCHITECTURE,
    operatingSystems: [...OPERATING_SYSTEMS].sort(),
    vscodeVersionsPerOs: 2,
    jetbrainsVersionsByOs: Object.fromEntries(
      OPERATING_SYSTEMS.map((operatingSystem) => [
        operatingSystem,
        [...IDE_ARM64_JETBRAINS_VERSIONS_BY_OS[operatingSystem]],
      ]),
    ),
    vendorSupportBoundaries: {
      jetbrainsWindowsArm64: {
        validatedNativeVersion: IDE_ARM64_JETBRAINS_WINDOWS_NATIVE_RELEASE,
        distributionKey: "windowsARM64",
        source: IDE_ARM64_JETBRAINS_RELEASES_SOURCE,
      },
    },
    evidenceCount: entries.length,
    matrix: entries,
  };
  const aggregate = {
    ...core,
    aggregateDigest: sha256Buffer(canonicalJson(core)),
  };
  if (output) writeImmutableJson(output, aggregate);
  return aggregate;
}

function parseArgs(argv) {
  const options = { assertHost: false };
  const fields = new Map([
    ["--evidence-dir", "evidenceDir"],
    ["--release-commit", "releaseCommit"],
    ["--expected-platform", "expectedPlatform"],
    ["--expected-arch", "expectedArchitecture"],
    ["--repository-root", "repositoryRoot"],
    ["--output", "output"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--assert-host") {
      options.assertHost = true;
      continue;
    }
    const field = fields.get(argument);
    if (!field || !argv[index + 1])
      throw new Error(`invalid argument: ${argument}`);
    options[field] = argv[index + 1];
    index += 1;
  }
  return options;
}

async function cli() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = options.assertHost
      ? assertExactArm64Host(options)
      : verifyIdeArm64EvidenceSet(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `CC_IDE_ARM64_VALIDATION_FAILED: ${error?.message || error}\n`,
    );
    process.exitCode = 1;
  }
}

const invoked = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invoked === import.meta.url) await cli();
