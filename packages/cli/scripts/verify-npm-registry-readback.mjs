#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NPM_RELEASE_AUTHORITY } from "./verify-npm-release-provenance.mjs";

const BUFFER_BYTES = 1024 * 1024;
const MAX_JSON_BYTES = 4 * 1024 * 1024;

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

function inspectFile(file) {
  const resolved = path.resolve(file);
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error(`release tarball is not a non-empty file: ${resolved}`);
  }
  const sha256 = crypto.createHash("sha256");
  const sha512 = crypto.createHash("sha512");
  const handle = fs.openSync(resolved, "r");
  const buffer = Buffer.allocUnsafe(BUFFER_BYTES);
  let bytes = 0;
  try {
    for (;;) {
      const read = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (read === 0) break;
      const chunk = buffer.subarray(0, read);
      sha256.update(chunk);
      sha512.update(chunk);
      bytes += read;
    }
  } finally {
    fs.closeSync(handle);
  }
  if (bytes !== stat.size) {
    throw new Error(`release tarball changed while hashing: ${resolved}`);
  }
  return {
    path: resolved,
    artifact: path.basename(resolved),
    bytes,
    sha256: sha256.digest("hex"),
    sha512: sha512.digest("hex"),
  };
}

function filesAreByteIdentical(left, right, bytes) {
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
  return compared === bytes;
}

export function verifyNpmRegistryReadback(options) {
  const manifest = assertObject(options?.manifest, "release manifest");
  const provenance = assertObject(options?.provenance, "npm provenance");
  const source = inspectFile(options.sourceTarball);
  const registry = inspectFile(options.registryTarball);
  const packageName = NPM_RELEASE_AUTHORITY.packageName;
  const expectedVersion = options.version || manifest.version;
  const expectedCommit = options.commit || manifest.commit;

  assertExact(manifest.schema, 2, "release manifest schema");
  assertExact(manifest.package, packageName, "release manifest package");
  assertExact(manifest.version, expectedVersion, "release manifest version");
  assertExact(manifest.commit, expectedCommit, "release manifest commit");
  assertExact(
    manifest.provenance,
    "npm --provenance",
    "release provenance contract",
  );

  for (const [label, inspected] of [
    ["source artifact", source],
    ["registry artifact", registry],
  ]) {
    assertExact(inspected.artifact, manifest.artifact, `${label} name`);
    assertExact(inspected.bytes, manifest.bytes, `${label} byte length`);
    assertExact(inspected.sha256, manifest.sha256, `${label} sha256`);
    assertExact(inspected.sha512, manifest.sha512, `${label} sha512`);
  }
  if (!filesAreByteIdentical(source.path, registry.path, manifest.bytes)) {
    throw new Error(
      "registry tarball is not byte-identical to the immutable artifact",
    );
  }

  assertExact(provenance.schema, 1, "npm provenance schema");
  assertExact(provenance.package, packageName, "npm provenance package");
  assertExact(provenance.version, expectedVersion, "npm provenance version");
  assertExact(provenance.commit, expectedCommit, "npm provenance commit");
  assertExact(provenance.sha512, manifest.sha512, "npm provenance sha512");
  assertExact(
    provenance.repository,
    NPM_RELEASE_AUTHORITY.repository,
    "npm provenance repository",
  );
  assertExact(
    provenance.workflow,
    NPM_RELEASE_AUTHORITY.workflow,
    "npm provenance workflow",
  );
  assertExact(
    provenance.ref,
    `refs/tags/v-npm-${expectedVersion.replaceAll(".", "-")}`,
    "npm provenance ref",
  );
  if (!Number.isSafeInteger(provenance.runId) || provenance.runId <= 0) {
    throw new Error("npm provenance run id is invalid");
  }
  assertExact(
    manifest.workflowRun,
    `${NPM_RELEASE_AUTHORITY.repository}/actions/runs/${provenance.runId}`,
    "attested workflow run",
  );

  return {
    schema: 1,
    verifiedAt: new Date().toISOString(),
    package: packageName,
    version: expectedVersion,
    commit: expectedCommit,
    ref: provenance.ref,
    publishRunId: provenance.runId,
    publishAttempt: provenance.attempt,
    artifact: manifest.artifact,
    bytes: manifest.bytes,
    sha256: manifest.sha256,
    sha512: manifest.sha512,
    byteIdentical: true,
  };
}

function readBoundedJson(file, label) {
  const resolved = path.resolve(file);
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_JSON_BYTES) {
    throw new Error(`${label} size is outside the accepted range`);
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

function main() {
  const [
    sourceTarball,
    registryTarball,
    manifestPath,
    provenancePath,
    ...extra
  ] = process.argv.slice(2);
  if (
    !sourceTarball ||
    !registryTarball ||
    !manifestPath ||
    !provenancePath ||
    extra.length > 0
  ) {
    throw new Error(
      "usage: verify-npm-registry-readback.mjs <source.tgz> <registry.tgz> <manifest.json> <provenance.json>",
    );
  }
  const result = verifyNpmRegistryReadback({
    sourceTarball,
    registryTarball,
    manifest: readBoundedJson(manifestPath, "release manifest"),
    provenance: readBoundedJson(provenancePath, "npm provenance"),
    version: process.env.CC_RELEASE_VERSION || null,
    commit: process.env.CC_RELEASE_COMMIT || null,
  });
  const output = path.resolve(
    process.env.CC_NPM_READBACK_OUTPUT || "npm-registry-readback.json",
  );
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Verified byte-identical npm readback for ${result.package}@${result.version} from run ${result.publishRunId}\n`,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`npm registry readback error: ${error.message}\n`);
    process.exitCode = 1;
  }
}
