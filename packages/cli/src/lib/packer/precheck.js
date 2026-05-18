/**
 * Phase 1: precheck — confirm the project root, npm install, and git state
 * are in shape before we attempt to bundle.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PackError, EXIT } from "./errors.js";

const WINDOWS_RESERVED = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

/**
 * Sanitize a project name for safe use as a filesystem directory segment.
 *
 * Rules:
 *   - Lowercase; replace any char outside [a-z0-9_-] with '-'
 *   - Collapse consecutive dashes; strip leading/trailing dashes
 *   - Windows reserved names get '-proj' appended
 *   - Truncate to 64 characters
 *   - Empty result after sanitization → PackError
 *
 * @param {string} rawName   raw value from config.json "name" field
 * @returns {string}         safe directory name
 */
export function sanitizeProjectName(rawName) {
  let name = String(rawName || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (WINDOWS_RESERVED.has(name.toUpperCase())) {
    name = name + "-proj";
  }

  name = name.slice(0, 64);

  if (!name) {
    throw new PackError(
      `Project name "${rawName}" cannot be sanitized to a valid filesystem segment. ` +
        'Use only ASCII letters, digits, hyphens, and underscores in the "name" field.',
      EXIT.PRECHECK,
    );
  }

  return name;
}

/**
 * @param {object} ctx
 * @param {string} ctx.projectRoot                  absolute path
 * @param {boolean} ctx.allowDirty                  allow uncommitted changes
 * @param {boolean|undefined} [ctx.projectMode]     tri-state: true = force
 *                                                  project-mode (fail if no
 *                                                  config), false = force
 *                                                  CLI-only, undefined =
 *                                                  auto-detect from the
 *                                                  presence of
 *                                                  projectRoot/.chainlesschain/config.json
 * @param {string|null} [ctx.projectConfigOverride] absolute or projectRoot-
 *                                                  relative path to an
 *                                                  alternate config.json
 *                                                  (takes precedence over
 *                                                  the default location)
 * @returns {{
 *   cliRoot:string,
 *   repoRoot:string|null,
 *   gitCommit:string|null,
 *   dirty:boolean,
 *   projectMode:boolean,
 *   projectConfigPath:string|null,
 * }}
 */
export function precheck(ctx) {
  const { projectRoot, allowDirty } = ctx;

  // Locate this CLI package root (packages/cli) — relative to this file.
  // fileURLToPath handles Windows (C:/...) and POSIX absolute paths uniformly;
  // the old `new URL(import.meta.url).pathname.replace(/^\//, "")` dropped the
  // leading "/" on POSIX, making the path relative, which then caused
  // path.resolve to prepend cwd → doubled prefix on Linux CI.
  const cliRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
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

  const { projectMode, projectConfigPath, projectName } = resolveProjectMode({
    projectRoot,
    projectMode: ctx.projectMode,
    projectConfigOverride: ctx.projectConfigOverride || null,
  });

  return {
    cliRoot,
    repoRoot,
    gitCommit,
    dirty,
    projectMode,
    projectConfigPath,
    projectName,
  };
}

/**
 * Decide whether this pack invocation runs in project mode and where the
 * bundled config.json lives. Separated out for unit-testability.
 *
 * Matrix:
 *   projectMode === true  + config exists  → project mode, use config
 *   projectMode === true  + config missing → PackError
 *   projectMode === false                  → CLI-only, ignore any config
 *   projectMode === undefined + exists     → project mode (auto-detect)
 *   projectMode === undefined + missing    → CLI-only
 *
 * @param {object} ctx
 * @param {string} ctx.projectRoot
 * @param {boolean|undefined} ctx.projectMode
 * @param {string|null} ctx.projectConfigOverride
 * @returns {{projectMode:boolean, projectConfigPath:string|null}}
 */
export function resolveProjectMode(ctx) {
  const { projectRoot, projectMode, projectConfigOverride } = ctx;

  if (projectMode === false) {
    return { projectMode: false, projectConfigPath: null, projectName: null };
  }

  const candidatePath = projectConfigOverride
    ? path.isAbsolute(projectConfigOverride)
      ? projectConfigOverride
      : path.resolve(projectRoot, projectConfigOverride)
    : path.join(projectRoot, ".chainlesschain", "config.json");

  const exists = fs.existsSync(candidatePath);

  if (projectMode === true) {
    if (!exists) {
      throw new PackError(
        `--project mode requires a config.json at ${candidatePath}. ` +
          "Run 'cc init' first, or pass --project-config-override <path>.",
        EXIT.PRECHECK,
      );
    }
    const { name: projectName } = validateProjectConfig(candidatePath);
    return { projectMode: true, projectConfigPath: candidatePath, projectName };
  }

  // Auto-detect
  if (exists) {
    const { name: projectName } = validateProjectConfig(candidatePath);
    return { projectMode: true, projectConfigPath: candidatePath, projectName };
  }
  return { projectMode: false, projectConfigPath: null, projectName: null };
}

/**
 * Minimal Phase-0 schema check. Confirms the file parses as JSON and has a
 * non-empty `name` field (required by the §4.1 naming rule). Returns the
 * sanitized project name so callers can propagate it without re-reading.
 *
 * @returns {{ name: string }}
 */
function validateProjectConfig(configPath) {
  let raw;
  try {
    raw = fs.readFileSync(configPath, "utf-8");
  } catch (e) {
    throw new PackError(
      `Cannot read project config ${configPath}: ${e.message}`,
      EXIT.PRECHECK,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new PackError(
      `Project config ${configPath} is not valid JSON: ${e.message}`,
      EXIT.PRECHECK,
    );
  }
  if (!parsed || typeof parsed.name !== "string" || !parsed.name.trim()) {
    throw new PackError(
      `Project config ${configPath} is missing required field "name".`,
      EXIT.PRECHECK,
    );
  }
  const name = sanitizeProjectName(parsed.name.trim());
  return { name };
}
