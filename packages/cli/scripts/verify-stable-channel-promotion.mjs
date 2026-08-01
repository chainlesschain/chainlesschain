#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function stableVersion(value, label) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value || ""));
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
  return /^[0-9a-f]{64}$/i.test(String(value || ""));
}

function isEd25519SignatureValue(value) {
  return /^[A-Za-z0-9+/]{86}==$/.test(String(value || ""));
}

function releaseIdentity(manifest, label) {
  if (manifest?.schema !== 1 || manifest?.channel !== "stable") {
    throw new Error(`${label} must be a schema-1 stable channel manifest`);
  }
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
  if (!latest || typeof latest.commit !== "string" || !latest.commit.trim()) {
    throw new Error(`${label} must identify the exact release commit`);
  }
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
    typeof latest.sbom.format !== "string" ||
    !latest.sbom.format.trim()
  ) {
    throw new Error(`${label} must contain complete signed SBOM metadata`);
  }
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
    version: String(latest.cliVersion),
    parsedVersion: stableVersion(latest.cliVersion, label),
    commit: latest.commit,
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
  const [currentPath, candidatePath] = process.argv.slice(2);
  if (!currentPath || !candidatePath) {
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
