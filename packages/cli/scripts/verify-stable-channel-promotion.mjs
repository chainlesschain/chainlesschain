#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNativePackageManagerContract,
  assertStrictSemver,
  TRUSTED_NATIVE_RELEASE_REPOSITORY,
} from "./native-release-contract.mjs";

function stableVersion(value, label) {
  assertStrictSemver(value, `${label} version`);
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(
    String(value || ""),
  );
  if (!match) throw new Error(`${label} must use a stable x.y.z version`);
  return match.slice(1).map((part) => BigInt(part));
}

function compareVersion(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

function canonicalManifestIdentity(manifest) {
  return JSON.stringify(canonicalValue(manifest));
}

function isHttpsUrl(value) {
  return /^https:\/\//.test(String(value || ""));
}

function isSha256(value) {
  return /^[0-9a-f]{64}$/u.test(String(value || ""));
}

function isEd25519SignatureValue(value) {
  return /^[A-Za-z0-9+/]{86}==$/.test(String(value || ""));
}

export function resolveStableManifestSigningIdentity(manifest) {
  if (manifest?.schema !== 1 || manifest?.channel !== "stable") {
    throw new Error(
      "stable signing identity selector must be a schema-1 stable channel manifest",
    );
  }
  const version = String(manifest.latest?.cliVersion || "");
  stableVersion(version, "stable signing identity selector");
  const commit = String(manifest.latest?.commit || "");
  if (!/^[0-9a-f]{40}$/u.test(commit)) {
    throw new Error(
      "stable signing identity selector must contain an exact lowercase 40-character commit",
    );
  }
  const tag = `cli-v${version}`;
  const ref = `refs/tags/${tag}`;
  return {
    repository: TRUSTED_NATIVE_RELEASE_REPOSITORY,
    version,
    tag,
    ref,
    commit,
    identity: `https://github.com/${TRUSTED_NATIVE_RELEASE_REPOSITORY}/.github/workflows/cli-native-release.yml@${ref}`,
  };
}

function releaseIdentity(manifest, label) {
  const signingIdentity = resolveStableManifestSigningIdentity(manifest);
  if (
    !Number.isSafeInteger(manifest.minimumUpdaterSchema) ||
    manifest.minimumUpdaterSchema < 1
  ) {
    throw new Error(`${label} must declare a valid minimumUpdaterSchema`);
  }
  if (
    manifest.signature?.algorithm !== "ed25519" ||
    !/^[0-9a-f]{32}$/i.test(String(manifest.signature?.keyId || "")) ||
    !isEd25519SignatureValue(manifest.signature?.value)
  ) {
    throw new Error(
      `${label} must contain a complete Ed25519 signature envelope`,
    );
  }
  const latest = manifest.latest;
  if (
    typeof latest.publishedAt !== "string" ||
    !Number.isFinite(Date.parse(latest.publishedAt))
  ) {
    throw new Error(`${label} must declare a valid publishedAt timestamp`);
  }
  if (latest.releaseNotes !== null && !isHttpsUrl(latest.releaseNotes)) {
    throw new Error(`${label} must use an HTTPS releaseNotes URL`);
  }
  if (
    !latest.sbom ||
    !isHttpsUrl(latest.sbom.url) ||
    !isSha256(latest.sbom.sha256) ||
    !isSha256(latest.sbom.lockSha256) ||
    !isSha256(latest.sbom.runtimeRefsSha256) ||
    typeof latest.sbom.format !== "string" ||
    !latest.sbom.format.trim()
  ) {
    throw new Error(`${label} must contain complete signed SBOM metadata`);
  }
  assertNativePackageManagerContract(latest.packageManager);
  if (!Array.isArray(latest.artifacts) || latest.artifacts.length === 0) {
    throw new Error(`${label} must contain signed release artifacts`);
  }
  const artifacts = latest.artifacts
    .map((artifact) => ({
      target: artifact?.target,
      url: artifact?.url,
      sha256: artifact?.sha256,
      bytes: artifact?.bytes,
      signature: artifact?.signature,
      platformSignature: artifact?.platformSignature,
    }))
    .sort((left, right) =>
      String(left.target).localeCompare(String(right.target)),
    );
  for (const artifact of artifacts) {
    if (
      !artifact.target ||
      !isHttpsUrl(artifact.url) ||
      !isSha256(artifact.sha256) ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes < 1 ||
      !isHttpsUrl(artifact.signature) ||
      typeof artifact.platformSignature !== "string" ||
      !artifact.platformSignature.trim()
    ) {
      throw new Error(`${label} contains an incomplete signed artifact`);
    }
  }
  if (
    new Set(artifacts.map((artifact) => artifact.target)).size !==
    artifacts.length
  ) {
    throw new Error(`${label} contains duplicate artifact targets`);
  }
  return {
    version: signingIdentity.version,
    parsedVersion: stableVersion(signingIdentity.version, label),
    commit: signingIdentity.commit,
    manifestIdentity: canonicalManifestIdentity(manifest),
  };
}

export function verifyStableChannelPromotion(
  currentManifest,
  candidateManifest,
) {
  const candidate = releaseIdentity(candidateManifest, "candidate manifest");
  if (!currentManifest) {
    return { action: "initialize", version: candidate.version };
  }
  const current = releaseIdentity(currentManifest, "current manifest");
  const order = compareVersion(candidate.parsedVersion, current.parsedVersion);
  if (order < 0) {
    throw new Error(
      `refusing stable channel downgrade ${current.version} -> ${candidate.version}`,
    );
  }
  if (order === 0) {
    if (
      candidate.commit !== current.commit ||
      candidate.manifestIdentity !== current.manifestIdentity
    ) {
      throw new Error(
        `stable channel ${candidate.version} already points to a different signed manifest identity`,
      );
    }
    return { action: "idempotent", version: candidate.version };
  }
  return {
    action: "promote",
    fromVersion: current.version,
    version: candidate.version,
  };
}

function readManifest(file, label) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  } catch (error) {
    throw new Error(`${label} could not be read: ${error.message}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--signing-identity") {
    if (args.length !== 2) {
      throw new Error(
        "usage: verify-stable-channel-promotion.mjs --signing-identity <stable-manifest>",
      );
    }
    const manifest = readManifest(args[1], "stable signing identity selector");
    process.stdout.write(
      `${JSON.stringify(resolveStableManifestSigningIdentity(manifest))}\n`,
    );
    return;
  }
  const [currentPath, candidatePath, ...extra] = args;
  if (!currentPath || !candidatePath || extra.length) {
    throw new Error(
      "usage: verify-stable-channel-promotion.mjs <current-manifest|-> <candidate-manifest>",
    );
  }
  const current =
    currentPath === "-" ? null : readManifest(currentPath, "current manifest");
  const candidate = readManifest(candidatePath, "candidate manifest");
  const result = verifyStableChannelPromotion(current, candidate);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `stable channel promotion rejected: ${error.message}\n`,
    );
    process.exitCode = 1;
  }
}
