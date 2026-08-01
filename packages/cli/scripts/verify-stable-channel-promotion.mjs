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

function releaseIdentity(manifest, label) {
  if (manifest?.schema !== 1 || manifest?.channel !== "stable") {
    throw new Error(`${label} must be a schema-1 stable channel manifest`);
  }
  const latest = manifest.latest;
  if (!latest || typeof latest.commit !== "string" || !latest.commit.trim()) {
    throw new Error(`${label} must identify the exact release commit`);
  }
  if (!Array.isArray(latest.artifacts) || latest.artifacts.length === 0) {
    throw new Error(`${label} must contain signed release artifacts`);
  }
  const artifacts = latest.artifacts
    .map((artifact) => ({
      target: artifact?.target,
      url: artifact?.url,
      sha256: artifact?.sha256,
      signature: artifact?.signature,
    }))
    .sort((left, right) =>
      String(left.target).localeCompare(String(right.target)),
    );
  for (const artifact of artifacts) {
    if (
      !artifact.target ||
      !/^https:\/\//.test(String(artifact.url || "")) ||
      !/^[0-9a-f]{64}$/i.test(String(artifact.sha256 || "")) ||
      !/^https:\/\//.test(String(artifact.signature || ""))
    ) {
      throw new Error(`${label} contains an incomplete signed artifact`);
    }
  }
  return {
    version: String(latest.cliVersion),
    parsedVersion: stableVersion(latest.cliVersion, label),
    commit: latest.commit,
    artifacts,
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
      JSON.stringify(candidate.artifacts) !== JSON.stringify(current.artifacts)
    ) {
      throw new Error(
        `stable channel ${candidate.version} already points to different release bytes`,
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
