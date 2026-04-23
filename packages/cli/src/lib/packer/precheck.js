/**
 * Phase 1: precheck — confirm the project root, npm install, and git state
 * are in shape before we attempt to bundle.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { PackError, EXIT } from "./errors.js";

/**
 * @param {object} ctx
 * @param {string} ctx.projectRoot       absolute path
 * @param {boolean} ctx.allowDirty       allow uncommitted changes
 * @returns {{cliRoot:string, repoRoot:string, gitCommit:string|null, dirty:boolean}}
 */
export function precheck(ctx) {
  const { projectRoot, allowDirty } = ctx;

  // Locate this CLI package root (packages/cli) — relative to this file.
  const cliRoot = path.resolve(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\//, "")),
    "..",
    "..",
    "..",
  );
  const cliPkgPath = path.join(cliRoot, "package.json");
  if (!fs.existsSync(cliPkgPath)) {
    throw new PackError(
      `CLI package.json not found at ${cliPkgPath}`,
      EXIT.PRECHECK,
    );
  }

  const nodeModulesPath = path.join(cliRoot, "node_modules");
  if (!fs.existsSync(nodeModulesPath)) {
    throw new PackError(
      `node_modules missing in ${cliRoot}. Run 'npm install' first.`,
      EXIT.PRECHECK,
    );
  }

  // The "project root" the user is bundling. Often === cliRoot during dev,
  // but a downstream consumer running `cc pack` from their own project
  // produces a bundle named after their project.
  if (!projectRoot || !fs.existsSync(projectRoot)) {
    throw new PackError(`Invalid projectRoot: ${projectRoot}`, EXIT.PRECHECK);
  }

  // Walk up from projectRoot to find the git repo root (if any). Pack does
  // not require git, but if the dir IS a git repo we want the commit/dirty
  // flag for the manifest.
  let gitCommit = null;
  let dirty = false;
  let repoRoot = null;
  try {
    repoRoot = execSync("git rev-parse --show-toplevel", {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    gitCommit = execSync("git rev-parse --short HEAD", {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const status = execSync("git status --porcelain", {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    dirty = status.trim().length > 0;
  } catch (_e) {
    // Not a git repo — fine, leave the metadata null
  }

  if (dirty && !allowDirty) {
    throw new PackError(
      "Working tree is dirty. Commit/stash your changes or pass --allow-dirty.",
      EXIT.PRECHECK,
    );
  }

  return { cliRoot, repoRoot, gitCommit, dirty };
}
