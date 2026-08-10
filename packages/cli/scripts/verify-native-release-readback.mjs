#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPackUpdateManifest } from "../src/lib/packer/pack-update-signature.js";
import {
  generatePackageManagerManifests,
  validatePackageManagerManifests,
  WINGET_MANIFEST_FILES,
} from "./generate-package-manager-manifests.mjs";
import {
  assertNativeReleaseIdentity,
  TRUSTED_NATIVE_RELEASE_REPOSITORY,
} from "./native-release-contract.mjs";

const BUFFER_BYTES = 1024 * 1024;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_BYTES = 4 * 1024 * 1024;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const ASSET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/u;
const COSIGN_ISSUER = "https://token.actions.githubusercontent.com";

export const NATIVE_RELEASE_TARGETS = Object.freeze({
  "node22-linux-x64": Object.freeze({
    artifact: "chainlesschain-node22-linux-x64",
    platformSignature: "sigstore-keyless",
  }),
  "node22-linux-arm64": Object.freeze({
    artifact: "chainlesschain-node22-linux-arm64",
    platformSignature: "sigstore-keyless",
  }),
  "node22-win-x64": Object.freeze({
    artifact: "chainlesschain-node22-win-x64.exe",
    platformSignature: "authenticode+sigstore",
  }),
  "node22-win-arm64": Object.freeze({
    artifact: "chainlesschain-node22-win-arm64.exe",
    platformSignature: "authenticode+sigstore",
  }),
  "node22-macos-x64": Object.freeze({
    artifact: "chainlesschain-node22-macos-x64",
    platformSignature: "codesign+notarized+sigstore",
  }),
  "node22-macos-arm64": Object.freeze({
    artifact: "chainlesschain-node22-macos-arm64",
    platformSignature: "codesign+notarized+sigstore",
  }),
});

export const NATIVE_STABLE_PRIMARY_ASSETS = Object.freeze([
  "install.sh",
  "install.ps1",
  "chainlesschain.rb",
  WINGET_MANIFEST_FILES.version,
  WINGET_MANIFEST_FILES.defaultLocale,
  WINGET_MANIFEST_FILES.installer,
  "cli-update-public-key.pem",
  "chainlesschain-cli-sbom.cdx.json",
  "chainlesschain-update.json",
]);

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function assertExact(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label} mismatch: expected ${expected}, received ${actual ?? "missing"}`,
    );
  }
}

function assertSafeAssetName(name, label = "release asset") {
  if (typeof name !== "string" || !ASSET_NAME_PATTERN.test(name)) {
    throw new Error(`${label} has an unsafe name: ${name ?? "missing"}`);
  }
  return name;
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be a string array`);
  }
  return value;
}

function sortUnique(values, label) {
  const sorted = [...values].sort();
  if (new Set(sorted).size !== sorted.length) {
    throw new Error(`${label} contains duplicates`);
  }
  return sorted;
}

function assertExactSet(actual, expected, label) {
  const left = sortUnique(actual, `${label} actual set`);
  const right = sortUnique(expected, `${label} expected set`);
  if (
    left.length !== right.length ||
    left.some((value, index) => value !== right[index])
  ) {
    const leftSet = new Set(left);
    const rightSet = new Set(right);
    const missing = right.filter((value) => !leftSet.has(value));
    const unexpected = left.filter((value) => !rightSet.has(value));
    throw new Error(
      `${label} mismatch; missing=${missing.join(",") || "none"}; unexpected=${unexpected.join(",") || "none"}`,
    );
  }
}

function listRegularFiles(directory, label) {
  const resolved = path.resolve(directory);
  const root = fs.lstatSync(resolved);
  if (!root.isDirectory() || root.isSymbolicLink()) {
    throw new Error(`${label} must be a non-symlink directory`);
  }
  const files = [];
  for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
    assertSafeAssetName(entry.name, label);
    const file = path.join(resolved, entry.name);
    const stat = fs.lstatSync(file);
    if (!entry.isFile() || !stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`${label} contains a non-regular asset: ${entry.name}`);
    }
    if (stat.size <= 0) {
      throw new Error(`${label} contains an empty asset: ${entry.name}`);
    }
    files.push(entry.name);
  }
  return { directory: resolved, files: files.sort() };
}

function inspectFile(file) {
  const resolved = path.resolve(file);
  const before = fs.lstatSync(resolved, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size <= 0n) {
    throw new Error(
      `release asset is not a non-empty regular file: ${resolved}`,
    );
  }
  const sha256 = crypto.createHash("sha256");
  const handle = fs.openSync(resolved, "r");
  const buffer = Buffer.allocUnsafe(BUFFER_BYTES);
  let bytes = 0n;
  try {
    for (;;) {
      const read = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (read === 0) break;
      sha256.update(buffer.subarray(0, read));
      bytes += BigInt(read);
    }
  } finally {
    fs.closeSync(handle);
  }
  const after = fs.lstatSync(resolved, { bigint: true });
  if (
    bytes !== before.size ||
    after.size !== before.size ||
    after.dev !== before.dev ||
    after.ino !== before.ino ||
    after.mtimeNs !== before.mtimeNs ||
    after.ctimeNs !== before.ctimeNs
  ) {
    throw new Error(`release asset changed while hashing: ${resolved}`);
  }
  if (bytes > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`release asset is too large to report safely: ${resolved}`);
  }
  return {
    artifact: path.basename(resolved),
    bytes: Number(bytes),
    sha256: sha256.digest("hex"),
  };
}

function readBoundedText(directory, name, label, maximum = MAX_TEXT_BYTES) {
  assertSafeAssetName(name, label);
  const file = path.join(directory, name);
  const stat = fs.lstatSync(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size <= 0 ||
    stat.size > maximum
  ) {
    throw new Error(`${label} size is outside the accepted range`);
  }
  return fs.readFileSync(file, "utf8");
}

function readBoundedJsonFile(file, label) {
  const resolved = path.resolve(file);
  const stat = fs.lstatSync(resolved);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size <= 0 ||
    stat.size > MAX_JSON_BYTES
  ) {
    throw new Error(`${label} size is outside the accepted range`);
  }
  return assertObject(JSON.parse(fs.readFileSync(resolved, "utf8")), label);
}

function readAssetJson(directory, name, label) {
  return readBoundedJsonFile(path.join(directory, name), label);
}

function expectedReleaseBase(repository, tag) {
  return `https://github.com/${repository}/releases/download/${tag}`;
}

export function nativeVersionedReleaseAssetNames() {
  const files = [];
  for (const { artifact } of Object.values(NATIVE_RELEASE_TARGETS)) {
    files.push(
      artifact,
      `${artifact}.sigstore.json`,
      `${artifact}.pack-manifest.json`,
    );
    if (artifact.includes("macos")) {
      files.push(
        `${artifact}.notarization.json`,
        `${artifact}.notarization-log.json`,
      );
    }
  }
  for (const primary of NATIVE_STABLE_PRIMARY_ASSETS) {
    files.push(primary, `${primary}.sigstore.json`);
  }
  files.push("SHA256SUMS", "SHA256SUMS.sigstore.json");
  return files.sort();
}

export function nativeStableReleaseAssetNames() {
  return NATIVE_STABLE_PRIMARY_ASSETS.flatMap((primary) => [
    primary,
    `${primary}.sigstore.json`,
  ]).sort();
}

function verifyReleaseMetadata(options) {
  const { metadata, inventory, repository, tag, expectedCommit, label } =
    options;
  assertExact(metadata.tag_name, tag, `${label} tag`);
  assertExact(metadata.draft, false, `${label} draft state`);
  assertExact(metadata.prerelease, false, `${label} prerelease state`);
  if (expectedCommit) {
    assertExact(
      metadata.target_commitish,
      expectedCommit,
      `${label} target commit`,
    );
  }
  const expectedHtmlUrl = `https://github.com/${repository}/releases/tag/${tag}`;
  assertExact(metadata.html_url, expectedHtmlUrl, `${label} public URL`);
  if (!Array.isArray(metadata.assets)) {
    throw new Error(`${label} assets must be an array`);
  }
  const assetNames = [];
  let githubDigestCoverage = 0;
  for (const rawAsset of metadata.assets) {
    const asset = assertObject(rawAsset, `${label} asset metadata`);
    const name = assertSafeAssetName(asset.name, `${label} asset`);
    assetNames.push(name);
    const inspected = inspectFile(path.join(inventory.directory, name));
    assertExact(asset.size, inspected.bytes, `${label} ${name} byte length`);
    assertExact(
      asset.browser_download_url,
      `${expectedReleaseBase(repository, tag)}/${encodeURIComponent(name)}`,
      `${label} ${name} download URL`,
    );
    if (asset.digest !== null && asset.digest !== undefined) {
      assertExact(
        asset.digest,
        `sha256:${inspected.sha256}`,
        `${label} ${name} GitHub digest`,
      );
      githubDigestCoverage += 1;
    }
  }
  assertExactSet(assetNames, inventory.files, `${label} downloaded asset set`);
  return { githubDigestCoverage };
}

function verifyChecksums(inventory) {
  const text = readBoundedText(inventory.directory, "SHA256SUMS", "SHA256SUMS");
  const records = new Map();
  for (const line of text.trimEnd().split(/\r?\n/u)) {
    const match =
      /^([0-9a-f]{64}) [ *](?:\.\/)?([A-Za-z0-9][A-Za-z0-9._+-]*)$/u.exec(line);
    if (!match) throw new Error(`SHA256SUMS contains an invalid line: ${line}`);
    const [, digest, name] = match;
    assertSafeAssetName(name, "SHA256SUMS asset");
    if (name === "SHA256SUMS" || name === "SHA256SUMS.sigstore.json") {
      throw new Error(`SHA256SUMS cannot recursively list ${name}`);
    }
    if (records.has(name)) {
      throw new Error(`SHA256SUMS contains a duplicate asset: ${name}`);
    }
    records.set(name, digest);
  }
  const expected = inventory.files.filter(
    (name) => name !== "SHA256SUMS" && name !== "SHA256SUMS.sigstore.json",
  );
  assertExactSet([...records.keys()], expected, "SHA256SUMS asset set");
  for (const [name, digest] of records) {
    assertExact(
      inspectFile(path.join(inventory.directory, name)).sha256,
      digest,
      `SHA256SUMS ${name}`,
    );
  }
  return records.size;
}

function signedPrimaryAssets(inventory) {
  const files = new Set(inventory.files);
  const primaries = [];
  for (const name of inventory.files) {
    if (!name.endsWith(".sigstore.json")) continue;
    const primary = name.slice(0, -".sigstore.json".length);
    if (!files.has(primary)) {
      throw new Error(`orphan Sigstore bundle has no primary asset: ${name}`);
    }
    readAssetJson(inventory.directory, name, `${name} Sigstore bundle`);
    primaries.push(primary);
  }
  return primaries.sort();
}

function verifyCosignEvidence(options) {
  const { evidence, repository, tag, commit, versioned, stable, readback } =
    options;
  assertExact(
    evidence.schema,
    "chainlesschain.cli-native-cosign-readback.v1",
    "Cosign evidence schema",
  );
  assertExact(evidence.repository, repository, "Cosign evidence repository");
  assertExact(evidence.ref, `refs/tags/${tag}`, "Cosign evidence ref");
  assertExact(
    evidence.workflowRepository,
    repository,
    "Cosign workflow repository",
  );
  assertExact(evidence.workflowRef, `refs/tags/${tag}`, "Cosign workflow ref");
  assertExact(evidence.workflowSha, commit, "Cosign workflow SHA");
  assertExact(evidence.workflowTrigger, "push", "Cosign workflow trigger");
  assertExact(evidence.issuer, COSIGN_ISSUER, "Cosign evidence issuer");
  assertExact(
    evidence.identity,
    `https://github.com/${repository}/.github/workflows/cli-native-release.yml@refs/tags/${tag}`,
    "Cosign evidence workflow identity",
  );
  const execution = assertObject(
    evidence.readbackExecution,
    "readback execution evidence",
  );
  for (const [field, expected] of Object.entries(readback)) {
    assertExact(execution[field], expected, `readback execution ${field}`);
  }
  const expectedVersioned = signedPrimaryAssets(versioned);
  assertExactSet(
    assertStringArray(evidence.versioned, "Cosign versioned evidence"),
    expectedVersioned,
    "Cosign versioned verification set",
  );
  if (stable) {
    const expectedStable = signedPrimaryAssets(stable);
    assertExactSet(
      assertStringArray(evidence.stable, "Cosign stable evidence"),
      expectedStable,
      "Cosign stable verification set",
    );
  } else {
    assertExactSet(
      assertStringArray(evidence.stable, "Cosign stable evidence"),
      [],
      "Cosign stable verification set",
    );
  }
  return (
    expectedVersioned.length + (stable ? signedPrimaryAssets(stable).length : 0)
  );
}

function verifyArtifactAndSidecar(options) {
  const {
    directory,
    manifestArtifact,
    target,
    expected,
    version,
    commit,
    baseUrl,
  } = options;
  assertExact(manifestArtifact.target, target, `${target} manifest target`);
  assertExact(
    manifestArtifact.url,
    `${baseUrl}/${encodeURIComponent(expected.artifact)}`,
    `${target} artifact URL`,
  );
  assertExact(
    manifestArtifact.signature,
    `${baseUrl}/${encodeURIComponent(`${expected.artifact}.sigstore.json`)}`,
    `${target} signature URL`,
  );
  assertExact(
    manifestArtifact.platformSignature,
    expected.platformSignature,
    `${target} platform signature`,
  );
  const inspected = inspectFile(path.join(directory, expected.artifact));
  assertExact(
    manifestArtifact.bytes,
    inspected.bytes,
    `${target} artifact bytes`,
  );
  assertExact(
    manifestArtifact.sha256,
    inspected.sha256,
    `${target} artifact sha256`,
  );

  const sidecar = readAssetJson(
    directory,
    `${expected.artifact}.pack-manifest.json`,
    `${target} pack manifest`,
  );
  assertExact(sidecar.cliVersion, version, `${target} pack version`);
  assertExact(sidecar.gitCommit, commit, `${target} pack commit`);
  assertExact(sidecar.gitDirty, false, `${target} pack dirty state`);
  assertExact(sidecar.target, target, `${target} pack target`);
  if (!Array.isArray(sidecar.targets) || sidecar.targets.length !== 1) {
    throw new Error(`${target} pack targets must contain exactly one target`);
  }
  assertExact(sidecar.targets[0], target, `${target} pack targets[0]`);
  assertExact(sidecar.artifact, expected.artifact, `${target} pack artifact`);
  assertExact(sidecar.bytes, inspected.bytes, `${target} pack bytes`);
  assertExact(sidecar.sha256, inspected.sha256, `${target} pack sha256`);
  assertExact(sidecar.signed, true, `${target} pack signed state`);
  assertExact(
    sidecar.signature?.type,
    "sigstore-bundle",
    `${target} pack signature type`,
  );
  assertExact(
    sidecar.signature?.file,
    `${expected.artifact}.sigstore.json`,
    `${target} pack signature file`,
  );
  assertExact(
    sidecar.signature?.platform,
    expected.platformSignature,
    `${target} pack platform signature`,
  );
  return inspected;
}

function verifyMacNotarization(directory, artifact) {
  const result = readAssetJson(
    directory,
    `${artifact}.notarization.json`,
    `${artifact} notarization result`,
  );
  const log = readAssetJson(
    directory,
    `${artifact}.notarization-log.json`,
    `${artifact} notarization log`,
  );
  if (!/^[0-9a-f-]{36}$/iu.test(String(result.id || ""))) {
    throw new Error(`${artifact} notarization result id is invalid`);
  }
  assertExact(result.status, "Accepted", `${artifact} notarization result`);
  assertExact(log.status, "Accepted", `${artifact} notarization log`);
  assertExact(log.jobId, result.id, `${artifact} notarization log job`);
}

function componentProperty(component, name) {
  const matches = Array.isArray(component?.properties)
    ? component.properties.filter((item) => item?.name === name)
    : [];
  if (matches.length !== 1 || typeof matches[0].value !== "string") {
    throw new Error(`SBOM component requires exactly one ${name} property`);
  }
  return matches[0].value;
}

function deterministicSbomSerial(options) {
  const digest = crypto
    .createHash("sha256")
    .update(
      `${options.commit}\n${options.lockSha256}\n${options.packageSha256}\n${options.rootRef}\n${options.runtimeRefsSha256}\n`,
    )
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function verifySbom(options) {
  const {
    directory,
    manifest,
    version,
    commit,
    baseUrl,
    expectedLockSha256,
    rebuiltSbomPath,
  } = options;
  const sbomName = "chainlesschain-cli-sbom.cdx.json";
  const sbomPath = path.join(directory, sbomName);
  const inspected = inspectFile(sbomPath);
  if (
    !rebuiltSbomPath ||
    path.resolve(rebuiltSbomPath) === path.resolve(sbomPath) ||
    !filesAreByteIdentical(sbomPath, rebuiltSbomPath)
  ) {
    throw new Error(
      "public SBOM is not byte-identical to an independent exact-lock rebuild",
    );
  }
  assertExact(manifest.latest.sbom?.format, "cyclonedx-json", "SBOM format");
  assertExact(manifest.latest.sbom?.url, `${baseUrl}/${sbomName}`, "SBOM URL");
  assertExact(manifest.latest.sbom?.sha256, inspected.sha256, "SBOM sha256");
  const sbom = readAssetJson(directory, sbomName, "CycloneDX SBOM");
  if (
    !Array.isArray(sbom.components) ||
    sbom.components.length === 0 ||
    !Array.isArray(sbom.dependencies) ||
    sbom.dependencies.length === 0
  ) {
    throw new Error("SBOM dependency graph is empty");
  }
  assertExact(sbom.bomFormat, "CycloneDX", "SBOM bomFormat");
  assertExact(sbom.metadata?.component?.name, "chainlesschain", "SBOM package");
  assertExact(sbom.metadata?.component?.version, version, "SBOM version");
  assertExact(
    sbom.metadata?.component?.purl,
    `pkg:npm/chainlesschain@${version}`,
    "SBOM package URL",
  );
  const root = sbom.metadata.component;
  const rootRef = `pkg:npm/chainlesschain@${version}`;
  assertExact(root["bom-ref"], rootRef, "SBOM root bom-ref");
  const sourceCommit = componentProperty(root, "chainlesschain:source.commit");
  const lockPath = componentProperty(root, "chainlesschain:lock.path");
  const lockSha256 = componentProperty(root, "chainlesschain:lock.sha256");
  const packageSha256 = componentProperty(
    root,
    "chainlesschain:package.sha256",
  );
  const workspacePath = componentProperty(
    root,
    "chainlesschain:workspace.path",
  );
  const runtimeRefsSha256 = componentProperty(
    root,
    "chainlesschain:runtime.refs.sha256",
  );
  const runtimeRefsCount = componentProperty(
    root,
    "chainlesschain:runtime.refs.count",
  );
  assertExact(sourceCommit, commit, "SBOM source commit");
  assertExact(lockPath, "package-lock.json", "SBOM lock path");
  assertExact(workspacePath, "packages/cli", "SBOM workspace path");
  assertExact(lockSha256, expectedLockSha256, "SBOM repository lock digest");
  assertExact(
    manifest.latest.sbom?.lockSha256,
    lockSha256,
    "signed SBOM lock digest",
  );
  if (!/^[0-9a-f]{64}$/u.test(packageSha256)) {
    throw new Error("SBOM package digest is invalid");
  }
  const componentRefs = sbom.components.map((component, index) => {
    if (
      component?.type !== "library" ||
      typeof component["bom-ref"] !== "string" ||
      component["bom-ref"] !== component.purl ||
      componentProperty(component, "chainlesschain:scope") !== "runtime"
    ) {
      throw new Error(`SBOM runtime component ${index} is invalid`);
    }
    return component["bom-ref"];
  });
  const sortedRefs = sortUnique(componentRefs, "SBOM runtime refs");
  const calculatedRuntimeRefsSha256 = crypto
    .createHash("sha256")
    .update(`${sortedRefs.join("\n")}\n`)
    .digest("hex");
  assertExact(
    runtimeRefsSha256,
    calculatedRuntimeRefsSha256,
    "SBOM runtime refs digest",
  );
  assertExact(
    runtimeRefsCount,
    String(sortedRefs.length),
    "SBOM runtime refs count",
  );
  assertExact(
    manifest.latest.sbom?.runtimeRefsSha256,
    runtimeRefsSha256,
    "signed SBOM runtime refs digest",
  );
  const allowedRefs = new Set([rootRef, ...sortedRefs]);
  const dependencyRefs = [];
  for (const dependency of sbom.dependencies) {
    if (
      !allowedRefs.has(dependency?.ref) ||
      !Array.isArray(dependency.dependsOn) ||
      dependency.dependsOn.some(
        (ref) => !allowedRefs.has(ref) || ref === rootRef,
      )
    ) {
      throw new Error("SBOM dependency graph contains an unknown runtime ref");
    }
    dependencyRefs.push(dependency.ref);
  }
  assertExactSet(
    dependencyRefs,
    [...allowedRefs],
    "SBOM dependency graph refs",
  );
  assertExact(
    sbom.serialNumber,
    deterministicSbomSerial({
      commit,
      lockSha256,
      packageSha256,
      rootRef,
      runtimeRefsSha256,
    }),
    "SBOM deterministic serialNumber",
  );
  assertExact(
    sbom.metadata?.timestamp,
    manifest.latest.publishedAt,
    "SBOM timestamp",
  );
  if (!/^urn:uuid:[0-9a-f-]{36}$/iu.test(String(sbom.serialNumber || ""))) {
    throw new Error("SBOM serialNumber must be a UUID URN");
  }
  return {
    ...inspected,
    lockSha256,
    packageSha256,
    runtimeRefsSha256,
    runtimeRefsCount: sortedRefs.length,
    serialNumber: sbom.serialNumber,
  };
}

function filesAreByteIdentical(left, right) {
  const leftInfo = inspectFile(left);
  const rightInfo = inspectFile(right);
  if (
    leftInfo.bytes !== rightInfo.bytes ||
    leftInfo.sha256 !== rightInfo.sha256
  ) {
    return false;
  }
  const leftHandle = fs.openSync(left, "r");
  const rightHandle = fs.openSync(right, "r");
  const leftBuffer = Buffer.allocUnsafe(BUFFER_BYTES);
  const rightBuffer = Buffer.allocUnsafe(BUFFER_BYTES);
  let compared = 0;
  try {
    for (;;) {
      const leftRead = fs.readSync(
        leftHandle,
        leftBuffer,
        0,
        leftBuffer.length,
        null,
      );
      const rightRead = fs.readSync(
        rightHandle,
        rightBuffer,
        0,
        rightBuffer.length,
        null,
      );
      if (leftRead !== rightRead) return false;
      if (leftRead === 0) break;
      if (
        !leftBuffer
          .subarray(0, leftRead)
          .equals(rightBuffer.subarray(0, rightRead))
      ) {
        return false;
      }
      compared += leftRead;
    }
  } finally {
    fs.closeSync(leftHandle);
    fs.closeSync(rightHandle);
  }
  return compared === leftInfo.bytes;
}

function verifyStableChannel(versioned, stable) {
  for (const primary of NATIVE_STABLE_PRIMARY_ASSETS) {
    for (const name of [primary, `${primary}.sigstore.json`]) {
      if (
        !filesAreByteIdentical(
          path.join(versioned.directory, name),
          path.join(stable.directory, name),
        )
      ) {
        throw new Error(
          `stable channel bytes differ from versioned asset: ${name}`,
        );
      }
    }
  }
}

export function verifyNativeReleaseReadback(options) {
  const repository = String(options?.repository || "");
  const tag = String(options?.tag || "");
  const commit = String(options?.commit || "");
  assertExact(
    repository,
    TRUSTED_NATIVE_RELEASE_REPOSITORY,
    "trusted native release repository",
  );
  if (!tag.startsWith("cli-v"))
    throw new Error("expected native tag is invalid");
  assertNativeReleaseIdentity(tag, tag.slice("cli-v".length));
  if (!COMMIT_PATTERN.test(commit)) {
    throw new Error("expected native release commit must be a full SHA-1");
  }
  const readback = {
    workflowRef: String(options?.readbackWorkflowRef || ""),
    workflowSha: String(options?.readbackWorkflowSha || ""),
    runId: String(options?.readbackRunId || ""),
    runAttempt: String(options?.readbackRunAttempt || ""),
    eventName: String(options?.readbackEventName || ""),
    callerWorkflowRef: String(options?.callerWorkflowRef || ""),
    callerWorkflowSha: String(options?.callerWorkflowSha || ""),
  };
  const workflowPrefix = `${repository}/.github/workflows/cli-native-release-readback.yml@`;
  const expectedWorkflowSuffix =
    readback.eventName === "push"
      ? `refs/tags/${tag}`
      : readback.eventName === "workflow_dispatch"
        ? "refs/heads/main"
        : null;
  const expectedCallerWorkflowRef =
    readback.eventName === "push"
      ? `${repository}/.github/workflows/cli-native-release.yml@refs/tags/${tag}`
      : readback.eventName === "workflow_dispatch"
        ? `${workflowPrefix}refs/heads/main`
        : null;
  if (
    !expectedWorkflowSuffix ||
    readback.workflowRef !== `${workflowPrefix}${expectedWorkflowSuffix}` ||
    !COMMIT_PATTERN.test(readback.workflowSha) ||
    readback.callerWorkflowRef !== expectedCallerWorkflowRef ||
    readback.callerWorkflowSha !== readback.workflowSha ||
    !/^[1-9]\d*$/u.test(readback.runId) ||
    !/^[1-9]\d*$/u.test(readback.runAttempt)
  ) {
    throw new Error("readback workflow execution identity is invalid");
  }
  if (!/^[0-9a-f]{64}$/u.test(String(options.expectedLockSha256 || ""))) {
    throw new Error("expected repository lock digest must be SHA-256");
  }

  const versioned = listRegularFiles(options.versionedDir, "versioned release");
  assertExactSet(
    versioned.files,
    nativeVersionedReleaseAssetNames(),
    "versioned native release asset set",
  );
  const stable = options.stableDir
    ? listRegularFiles(options.stableDir, "stable release")
    : null;
  if (stable) {
    assertExactSet(
      stable.files,
      nativeStableReleaseAssetNames(),
      "stable native release asset set",
    );
  }
  const release = assertObject(options.release, "versioned release metadata");
  const releaseMetadata = verifyReleaseMetadata({
    metadata: release,
    inventory: versioned,
    repository,
    tag,
    expectedCommit: commit,
    label: "versioned release",
  });
  let stableMetadata = null;
  if (stable) {
    stableMetadata = verifyReleaseMetadata({
      metadata: assertObject(options.stableRelease, "stable release metadata"),
      inventory: stable,
      repository,
      tag: "cli-stable",
      expectedCommit: null,
      label: "stable release",
    });
  } else if (options.stableRelease) {
    throw new Error(
      "stable release metadata was supplied without stable assets",
    );
  }

  const checksumEntries = verifyChecksums(versioned);
  const sigstoreVerificationCount = verifyCosignEvidence({
    evidence: assertObject(options.cosignEvidence, "Cosign evidence"),
    repository,
    tag,
    commit,
    versioned,
    stable,
    readback,
  });
  const manifest = readAssetJson(
    versioned.directory,
    "chainlesschain-update.json",
    "native update manifest",
  );
  const publicKey = readBoundedText(
    versioned.directory,
    "cli-update-public-key.pem",
    "native update public key",
    64 * 1024,
  );
  verifyPackUpdateManifest(manifest, publicKey);
  assertExact(manifest.schema, 1, "native update manifest schema");
  assertExact(manifest.minimumUpdaterSchema, 1, "minimum updater schema");
  assertExact(manifest.channel, "stable", "native update channel");
  const version = manifest.latest?.cliVersion;
  assertNativeReleaseIdentity(tag, version);
  assertExact(manifest.latest.commit, commit, "native update manifest commit");
  assertExact(
    manifest.latest.releaseNotes,
    `https://github.com/${repository}/releases/tag/${tag}`,
    "native release notes URL",
  );
  if (!Number.isFinite(Date.parse(manifest.latest.publishedAt))) {
    throw new Error("native update manifest publishedAt is invalid");
  }
  const baseUrl = expectedReleaseBase(repository, tag);
  if (!Array.isArray(manifest.latest.artifacts)) {
    throw new Error("native update manifest artifacts must be an array");
  }
  const manifestTargets = [];
  const targetEvidence = [];
  for (const [target, expected] of Object.entries(NATIVE_RELEASE_TARGETS)) {
    const matches = manifest.latest.artifacts.filter(
      (artifact) => artifact?.target === target,
    );
    if (matches.length !== 1) {
      throw new Error(`native update manifest requires exactly one ${target}`);
    }
    manifestTargets.push(target);
    const inspected = verifyArtifactAndSidecar({
      directory: versioned.directory,
      manifestArtifact: assertObject(matches[0], `${target} manifest artifact`),
      target,
      expected,
      version,
      commit,
      baseUrl,
    });
    if (target.includes("macos")) {
      verifyMacNotarization(versioned.directory, expected.artifact);
    }
    targetEvidence.push({
      target,
      artifact: expected.artifact,
      bytes: inspected.bytes,
      sha256: inspected.sha256,
      sigstoreVerified: true,
      declaredPlatformSignature: expected.platformSignature,
    });
  }
  assertExactSet(
    manifest.latest.artifacts.map((artifact) => artifact?.target),
    manifestTargets,
    "native update manifest target set",
  );
  const sbomEvidence = verifySbom({
    directory: versioned.directory,
    manifest,
    version,
    commit,
    baseUrl,
    expectedLockSha256: options.expectedLockSha256,
    rebuiltSbomPath: options.rebuiltSbomPath,
  });
  const publicPackageManagerMetadata = {
    homebrew: readBoundedText(
      versioned.directory,
      "chainlesschain.rb",
      "Homebrew formula",
    ),
    wingetVersion: readBoundedText(
      versioned.directory,
      WINGET_MANIFEST_FILES.version,
      "WinGet version manifest",
    ),
    wingetDefaultLocale: readBoundedText(
      versioned.directory,
      WINGET_MANIFEST_FILES.defaultLocale,
      "WinGet defaultLocale manifest",
    ),
    wingetInstaller: readBoundedText(
      versioned.directory,
      WINGET_MANIFEST_FILES.installer,
      "WinGet installer manifest",
    ),
  };
  validatePackageManagerManifests(publicPackageManagerMetadata, manifest);
  const regeneratedPackageManagerMetadata =
    generatePackageManagerManifests(manifest);
  for (const field of [
    "homebrew",
    "wingetVersion",
    "wingetDefaultLocale",
    "wingetInstaller",
  ]) {
    assertExact(
      publicPackageManagerMetadata[field],
      regeneratedPackageManagerMetadata[field],
      `public package-manager ${field}`,
    );
  }
  const packageManagerAssets = [
    "chainlesschain.rb",
    WINGET_MANIFEST_FILES.version,
    WINGET_MANIFEST_FILES.defaultLocale,
    WINGET_MANIFEST_FILES.installer,
  ]
    .map((name) => inspectFile(path.join(versioned.directory, name)))
    .sort((left, right) => left.artifact.localeCompare(right.artifact));
  if (stable) verifyStableChannel(versioned, stable);

  return {
    schema: "chainlesschain.cli-native-public-readback.v1",
    verifiedAt: new Date().toISOString(),
    repository,
    tag,
    version,
    commit,
    readbackWorkflow: readback,
    releaseUrl: release.html_url,
    stableChannelVerified: Boolean(stable),
    updateManifestEd25519Verified: true,
    sigstoreVerificationCount,
    checksumEntries,
    githubDigestCoverage: {
      versioned: releaseMetadata.githubDigestCoverage,
      stable: stableMetadata?.githubDigestCoverage ?? 0,
    },
    sbomVerified: true,
    sbom: sbomEvidence,
    packageManagerMetadataVerified: {
      homebrewFormula: true,
      wingetManifestSet: true,
      publicCatalogPublication: false,
    },
    packageManagerAssets,
    targets: targetEvidence,
    publicReadbackVerified: true,
    releaseEligible: false,
    boundary:
      "public readback verifies immutable GitHub assets, checksums, update-manifest Ed25519, workflow-identity Sigstore evidence, SBOM identity, and package-manager metadata; it does not prove signed install/upgrade/rollback or Homebrew/WinGet catalog publication",
  };
}

function main() {
  const [
    versionedDir,
    stableDirInput,
    releasePath,
    stableReleasePath,
    cosignEvidencePath,
    ...extra
  ] = process.argv.slice(2);
  if (
    !versionedDir ||
    !stableDirInput ||
    !releasePath ||
    !stableReleasePath ||
    !cosignEvidencePath ||
    extra.length > 0
  ) {
    throw new Error(
      "usage: verify-native-release-readback.mjs <versioned-dir> <stable-dir|-> <release.json> <stable-release.json|-> <cosign-evidence.json>",
    );
  }
  const stableEnabled = stableDirInput !== "-";
  if (stableEnabled !== (stableReleasePath !== "-")) {
    throw new Error(
      "stable asset directory and metadata must be enabled together",
    );
  }
  const result = verifyNativeReleaseReadback({
    versionedDir,
    stableDir: stableEnabled ? stableDirInput : null,
    release: readBoundedJsonFile(releasePath, "versioned release metadata"),
    stableRelease: stableEnabled
      ? readBoundedJsonFile(stableReleasePath, "stable release metadata")
      : null,
    cosignEvidence: readBoundedJsonFile(
      cosignEvidencePath,
      "Cosign verification evidence",
    ),
    repository: process.env.CC_NATIVE_RELEASE_REPOSITORY,
    tag: process.env.CC_NATIVE_RELEASE_TAG,
    commit: process.env.CC_NATIVE_RELEASE_COMMIT,
    expectedLockSha256: process.env.CC_NATIVE_RELEASE_LOCK_SHA256,
    rebuiltSbomPath: process.env.CC_NATIVE_RELEASE_REBUILT_SBOM,
    readbackWorkflowRef: process.env.CC_NATIVE_READBACK_WORKFLOW_REF,
    readbackWorkflowSha: process.env.CC_NATIVE_READBACK_WORKFLOW_SHA,
    readbackRunId: process.env.CC_NATIVE_READBACK_RUN_ID,
    readbackRunAttempt: process.env.CC_NATIVE_READBACK_RUN_ATTEMPT,
    readbackEventName: process.env.CC_NATIVE_READBACK_EVENT_NAME,
    callerWorkflowRef: process.env.CC_NATIVE_CALLER_WORKFLOW_REF,
    callerWorkflowSha: process.env.CC_NATIVE_CALLER_WORKFLOW_SHA,
  });
  const output = path.resolve(
    process.env.CC_NATIVE_READBACK_OUTPUT || "cli-native-public-readback.json",
  );
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  process.stdout.write(
    `Verified ${result.targets.length}-target native public readback for ${result.tag} at ${result.commit}\n`,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`native release readback error: ${error.message}\n`);
    process.exitCode = 1;
  }
}
