/**
 * Publish workspace packages to npm (ESM)
 * Mirrors Claude Code /publish behavior
 * @module lib/publish-workspace
 */

import { execSync } from "child_process";
import { logger } from "./logger.js";
import path from "path";
import fs from "fs";

/**
 * Get all workspace packages
 * @returns {Array<{name: string, path: string, version: string}>}
 */
export function getWorkspacePackages() {
  try {
    const rootPkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const packages = [];

    // Handle workspaces config
    const workspaces = rootPkg.workspaces?.packages || rootPkg.workspaces || [];
    for (const pattern of workspaces) {
      // Simple glob handling for basic patterns
      const dir = pattern.replace(/\*+/g, "");
      if (fs.existsSync(dir)) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const pkgPath = path.join(dir, entry.name);
            const pkgFile = path.join(pkgPath, "package.json");
            if (fs.existsSync(pkgFile)) {
              const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
              if (pkg.name && !pkg.private) {
                packages.push({
                  name: pkg.name,
                  path: pkgPath,
                  version: pkg.version,
                });
              }
            }
          }
        }
      }
    }

    return packages;
  } catch (err) {
    logger.error(`Failed to get workspace packages: ${err.message}`);
    return [];
  }
}

/**
 * Publish a single package
 * @param {Object} pkg Package info
 * @param {Object} options Publish options
 * @returns {boolean} success
 */
export function publishPackage(pkg, options = {}) {
  try {
    logger.info(`Publishing ${pkg.name}@${pkg.version}...`);
    let cmd = "npm publish";
    if (options.tag) cmd += ` --tag ${options.tag}`;
    if (options.access) cmd += ` --access ${options.access}`;

    execSync(cmd, {
      cwd: pkg.path,
      stdio: "inherit",
      encoding: "utf8",
    });
    logger.succeed(`Published ${pkg.name}@${pkg.version}`);
    return true;
  } catch (err) {
    logger.error(`Failed to publish ${pkg.name}: ${err.message}`);
    return false;
  }
}

/**
 * Publish all changed workspace packages
 * @param {Object} options Options
 * @returns {Promise<boolean>} success
 */
export async function publishWorkspace(options = {}) {
  const packages = getWorkspacePackages();
  if (packages.length === 0) {
    logger.info("No publishable packages found");
    return true;
  }

  logger.info(`Found ${packages.length} publishable packages`);
  let allSucceeded = true;

  for (const pkg of packages) {
    if (options.dryRun) {
      logger.info(`[dry-run] Would publish ${pkg.name}@${pkg.version}`);
      continue;
    }
    const ok = publishPackage(pkg, options);
    if (!ok) allSucceeded = false;
  }

  return allSucceeded;
}

export default { getWorkspacePackages, publishPackage, publishWorkspace };
