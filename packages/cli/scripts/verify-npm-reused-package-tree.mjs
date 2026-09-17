#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const TREE_PATTERN = /^[0-9a-f]{40,64}$/u;
const IMMUTABLE_NPM_TAG = /^refs\/tags\/v-npm-\d+-\d+-\d+$/u;
const PACKAGE_PATH = /^packages\/[a-z0-9][a-z0-9-]*$/u;
const MAX_EVIDENCE_BYTES = 1024 * 1024;

function requiredString(value, label) {
  if (!value || typeof value !== "string") {
    throw new Error(`${label} is required`);
  }
  return value;
}

function defaultGit(args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const detail = String(
      error?.stderr || error?.message || "git failed",
    ).trim();
    throw new Error(`git ${args[0]} failed: ${detail}`);
  }
}

export function verifyNpmReusedPackageTree(
  evidence,
  currentCommitValue,
  packagePathValue,
  git = defaultGit,
) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error("npm provenance evidence must be an object");
  }
  if (evidence.anchorMode !== "trusted-reuse") {
    throw new Error("npm provenance evidence is not a trusted reuse anchor");
  }
  const anchorCommit = requiredString(
    evidence.commit,
    "provenance anchor commit",
  ).toLowerCase();
  const anchorRef = requiredString(evidence.ref, "provenance anchor ref");
  const currentCommit = requiredString(
    currentCommitValue,
    "current commit",
  ).toLowerCase();
  const packagePath = requiredString(packagePathValue, "package path");
  if (!COMMIT_PATTERN.test(anchorCommit)) {
    throw new Error("provenance anchor commit must be a full Git SHA");
  }
  if (!COMMIT_PATTERN.test(currentCommit)) {
    throw new Error("current commit must be a full Git SHA");
  }
  if (!IMMUTABLE_NPM_TAG.test(anchorRef)) {
    throw new Error("provenance anchor ref must be an immutable v-npm tag");
  }
  if (!PACKAGE_PATH.test(packagePath)) {
    throw new Error("package path must name one direct packages/ child");
  }

  git(["fetch", "--force", "--no-tags", "--depth=1", "origin", anchorRef]);
  const fetchedCommit = git([
    "rev-parse",
    "--verify",
    "FETCH_HEAD^{commit}",
  ]).toLowerCase();
  if (fetchedCommit !== anchorCommit) {
    throw new Error(
      `signed npm provenance commit ${anchorCommit} does not match ${anchorRef} at ${fetchedCommit}`,
    );
  }

  const anchorTree = git([
    "rev-parse",
    "--verify",
    `${anchorCommit}:${packagePath}`,
  ]).toLowerCase();
  const currentTree = git([
    "rev-parse",
    "--verify",
    `${currentCommit}:${packagePath}`,
  ]).toLowerCase();
  if (!TREE_PATTERN.test(anchorTree) || !TREE_PATTERN.test(currentTree)) {
    throw new Error("package tree identity is not a valid Git object id");
  }
  if (anchorTree !== currentTree) {
    throw new Error(
      `${packagePath} changed since signed npm provenance anchor ${anchorRef}; bump the package version before release`,
    );
  }

  return {
    ...evidence,
    reuse: {
      packagePath,
      anchorCommit,
      anchorRef,
      anchorTree,
      currentCommit,
      currentTree,
    },
  };
}

function readEvidence(file) {
  const resolved = path.resolve(file);
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_EVIDENCE_BYTES) {
    throw new Error(
      "npm provenance evidence size is outside the accepted range",
    );
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

async function main() {
  const [evidencePath, currentCommit, packagePath, ...extra] =
    process.argv.slice(2);
  if (!evidencePath || !currentCommit || !packagePath || extra.length > 0) {
    throw new Error(
      "usage: verify-npm-reused-package-tree.mjs <provenance-evidence.json> <current-commit> <package-path>",
    );
  }
  const verified = verifyNpmReusedPackageTree(
    readEvidence(evidencePath),
    currentCommit,
    packagePath,
  );
  fs.writeFileSync(
    path.resolve(evidencePath),
    `${JSON.stringify(verified, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(
    `Verified unchanged ${verified.reuse.packagePath} tree ${verified.reuse.currentTree} against ${verified.reuse.anchorRef}\n`,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main().catch((error) => {
    process.stderr.write(`npm package reuse error: ${error.message}\n`);
    process.exitCode = 1;
  });
}
