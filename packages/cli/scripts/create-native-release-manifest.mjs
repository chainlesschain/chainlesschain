#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertStrictSemver,
  nativePackageManagerContract,
} from "./native-release-contract.mjs";

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

export function createNativeReleaseManifest(options) {
  const files = walk(path.resolve(options.artifactsDir)).filter((file) =>
    file.endsWith(".pack-manifest.json"),
  );
  if (files.length === 0) throw new Error("no native pack manifests found");
  const sidecars = files.map((file) => ({
    file,
    value: JSON.parse(fs.readFileSync(file, "utf8")),
  }));
  const versions = new Set(sidecars.map(({ value }) => value.cliVersion));
  const commits = new Set(sidecars.map(({ value }) => value.gitCommit));
  if (versions.size !== 1)
    throw new Error("native artifacts disagree on cliVersion");
  if (commits.size !== 1)
    throw new Error("native artifacts disagree on gitCommit");
  if (![...versions][0] || ![...commits][0]) {
    throw new Error("native artifacts require cliVersion and gitCommit");
  }
  assertStrictSemver([...versions][0], "native artifact cliVersion");
  if (sidecars.some(({ value }) => value.gitDirty || !value.signed)) {
    throw new Error("native artifacts must be clean and signed");
  }
  const commit = [...commits][0];
  if (options.expectedCommit && commit !== options.expectedCommit) {
    throw new Error(
      `native artifact commit ${commit} does not match release SHA ${options.expectedCommit}`,
    );
  }
  const baseUrl = String(options.baseUrl || "").replace(/\/$/, "");
  if (!/^https:\/\//.test(baseUrl)) throw new Error("baseUrl must be HTTPS");
  const artifacts = sidecars
    .map(({ file, value: item }) => {
      const target = item.target || item.targets?.[0];
      if (!target || !item.artifact || !item.signature?.file) {
        throw new Error(`incomplete signed artifact metadata: ${file}`);
      }
      const artifactPath = path.resolve(path.dirname(file), item.artifact);
      const signaturePath = path.resolve(
        path.dirname(file),
        item.signature.file,
      );
      if (
        path.dirname(artifactPath) !== path.resolve(path.dirname(file)) ||
        path.dirname(signaturePath) !== path.resolve(path.dirname(file))
      ) {
        throw new Error(`artifact metadata must use local basenames: ${file}`);
      }
      if (!fs.existsSync(artifactPath) || !fs.existsSync(signaturePath)) {
        throw new Error(`artifact or signature bundle is missing: ${target}`);
      }
      const bytes = fs.readFileSync(artifactPath);
      const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      if (item.sha256 !== sha256 || item.bytes !== bytes.length) {
        throw new Error(`artifact digest metadata mismatch: ${target}`);
      }
      return {
        target,
        url: `${baseUrl}/${encodeURIComponent(item.artifact)}`,
        sha256,
        bytes: bytes.length,
        signature: `${baseUrl}/${encodeURIComponent(item.signature.file)}`,
        platformSignature: item.signature.platform || null,
      };
    })
    .sort((a, b) => a.target.localeCompare(b.target));
  const targets = artifacts.map((item) => item.target);
  if (new Set(targets).size !== targets.length) {
    throw new Error("native release contains duplicate targets");
  }
  const requiredTargets = options.requiredTargets || [];
  const missingTargets = requiredTargets.filter(
    (target) => !targets.includes(target),
  );
  if (
    missingTargets.length > 0 ||
    (targets.length !== requiredTargets.length && requiredTargets.length > 0)
  ) {
    throw new Error(
      `native release target matrix mismatch; missing: ${missingTargets.join(", ") || "none"}`,
    );
  }
  if (options.sbomUrl) {
    for (const [label, digest] of [
      ["SBOM digest", options.sbomSha256],
      ["SBOM repository lock digest", options.sbomLockSha256],
      ["SBOM runtime refs digest", options.sbomRuntimeRefsSha256],
    ]) {
      if (!SHA256_PATTERN.test(String(digest || ""))) {
        throw new Error(`${label} must be a lowercase SHA-256`);
      }
    }
  }
  return {
    schema: 1,
    minimumUpdaterSchema: 1,
    channel: options.channel || "stable",
    latest: {
      cliVersion: [...versions][0],
      publishedAt: options.publishedAt || new Date().toISOString(),
      releaseNotes: options.releaseNotes || null,
      commit,
      packageManager: nativePackageManagerContract(),
      ...(options.sbomUrl
        ? {
            sbom: {
              url: options.sbomUrl,
              sha256: options.sbomSha256 || null,
              format: "cyclonedx-json",
              lockSha256: options.sbomLockSha256,
              runtimeRefsSha256: options.sbomRuntimeRefsSha256,
            },
          }
        : {}),
      artifacts,
    },
  };
}

function main() {
  const [artifactsDir, output, baseUrl] = process.argv.slice(2);
  if (!artifactsDir || !output || !baseUrl) {
    throw new Error(
      "usage: create-native-release-manifest.mjs <artifacts-dir> <output.json> <https-base-url>",
    );
  }
  const manifest = createNativeReleaseManifest({
    artifactsDir,
    baseUrl,
    channel: process.env.CC_RELEASE_CHANNEL || "stable",
    releaseNotes: process.env.CC_RELEASE_NOTES_URL || null,
    sbomUrl: process.env.CC_RELEASE_SBOM_URL || null,
    sbomSha256: process.env.CC_RELEASE_SBOM_SHA256 || null,
    sbomLockSha256: process.env.CC_RELEASE_SBOM_LOCK_SHA256 || null,
    sbomRuntimeRefsSha256:
      process.env.CC_RELEASE_SBOM_RUNTIME_REFS_SHA256 || null,
    expectedCommit: process.env.GITHUB_SHA || null,
    requiredTargets: String(process.env.CC_RELEASE_REQUIRED_TARGETS || "")
      .split(",")
      .map((target) => target.trim())
      .filter(Boolean),
  });
  fs.writeFileSync(
    path.resolve(output),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(
    `created ${output} with ${manifest.latest.artifacts.length} artifacts\n`,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`native release manifest failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
