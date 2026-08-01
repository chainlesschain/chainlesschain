#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function hashFile(file, algorithm) {
  return crypto
    .createHash(algorithm)
    .update(fs.readFileSync(file))
    .digest("hex");
}

export function createReleaseArtifactManifest(options) {
  const tarball = path.resolve(options.tarball);
  if (!fs.statSync(tarball).isFile()) throw new Error(`not a file: ${tarball}`);
  const manifest = {
    schema: 1,
    package: options.packageName || "chainlesschain",
    version: options.version,
    commit: options.commit,
    workflowRun: options.workflowRun || null,
    artifact: path.basename(tarball),
    bytes: fs.statSync(tarball).size,
    sha256: hashFile(tarball, "sha256"),
    sha512: hashFile(tarball, "sha512"),
    createdAt: new Date().toISOString(),
    provenance: "npm --provenance",
  };
  if (!manifest.version) throw new Error("version is required");
  if (!manifest.commit) throw new Error("commit is required");
  return manifest;
}

export function verifyReleaseArtifact(tarball, manifest, expected = {}) {
  const file = path.resolve(tarball);
  const failures = [];
  if (manifest?.schema !== 1) failures.push("manifest schema");
  if (manifest?.package !== (expected.packageName || "chainlesschain")) {
    failures.push("package name");
  }
  if (expected.version && manifest?.version !== expected.version) {
    failures.push("version");
  }
  if (expected.commit && manifest?.commit !== expected.commit) {
    failures.push("commit");
  }
  if (manifest?.provenance !== "npm --provenance") {
    failures.push("provenance contract");
  }
  const bytes = fs.statSync(file).size;
  if (path.basename(file) !== manifest.artifact) failures.push("artifact name");
  if (bytes !== manifest.bytes) failures.push("byte length");
  if (hashFile(file, "sha256") !== manifest.sha256) failures.push("sha256");
  if (hashFile(file, "sha512") !== manifest.sha512) failures.push("sha512");
  if (failures.length > 0) {
    throw new Error(
      `release artifact verification failed: ${failures.join(", ")}`,
    );
  }
  return true;
}

function writeManifest(output, manifest) {
  fs.writeFileSync(
    path.resolve(output),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

function main() {
  const [command, tarball, manifestPath] = process.argv.slice(2);
  if (!command || !tarball || !manifestPath) {
    throw new Error(
      "usage: npm-release-artifact.mjs create|verify <tarball> <manifest.json>",
    );
  }
  if (command === "create") {
    const manifest = createReleaseArtifactManifest({
      tarball,
      packageName: process.env.CC_RELEASE_PACKAGE || "chainlesschain",
      version: process.env.CC_RELEASE_VERSION,
      commit: process.env.GITHUB_SHA || process.env.CC_RELEASE_COMMIT,
      workflowRun:
        process.env.GITHUB_SERVER_URL &&
        process.env.GITHUB_REPOSITORY &&
        process.env.GITHUB_RUN_ID
          ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
          : null,
    });
    writeManifest(manifestPath, manifest);
    process.stdout.write(`${manifest.sha256}  ${manifest.artifact}\n`);
    return;
  }
  if (command === "verify") {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(manifestPath), "utf8"),
    );
    verifyReleaseArtifact(tarball, manifest, {
      packageName: process.env.CC_RELEASE_PACKAGE || "chainlesschain",
      version: process.env.CC_RELEASE_VERSION || null,
      commit: process.env.GITHUB_SHA || process.env.CC_RELEASE_COMMIT || null,
    });
    process.stdout.write(`verified ${manifest.sha256}  ${manifest.artifact}\n`);
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`npm release artifact error: ${error.message}\n`);
    process.exitCode = 1;
  }
}
