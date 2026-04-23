/**
 * Phase 7: manifest-writer
 *
 * Emit a sidecar `<artifact>.pack-manifest.json` next to each produced
 * executable, plus a SHA-256 of the artifact bytes. Schema mirrors §6.3
 * of the design doc.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * @param {object} ctx
 * @param {string[]} ctx.outputs            artifact paths
 * @param {string} ctx.cliRoot
 * @param {string|null} ctx.gitCommit
 * @param {boolean} ctx.gitDirty
 * @param {string[]} ctx.targets
 * @param {object}  ctx.ports               { ws, ui }
 * @param {boolean} ctx.includeDb
 * @param {boolean} ctx.includeModels
 * @param {string[]} ctx.commands
 * @returns {Array<{artifact:string, manifestPath:string, sha256:string}>}
 */
export function writeManifests(ctx) {
  const cliPkg = JSON.parse(
    fs.readFileSync(path.join(ctx.cliRoot, "package.json"), "utf-8"),
  );
  const rootPkg = readRootPackage(ctx.cliRoot);
  const productVersion = rootPkg?.productVersion || "vDev";

  const out = [];
  for (const artifact of ctx.outputs) {
    const sha256 = sha256File(artifact);
    const manifest = {
      schema: 1,
      productVersion,
      cliVersion: cliPkg.version,
      buildTime: new Date().toISOString(),
      gitCommit: ctx.gitCommit,
      gitDirty: ctx.gitDirty,
      buildHost: process.platform,
      nodeVersion: process.version,
      pkgVersion: lookupPkgVersion(ctx.cliRoot),
      targets: ctx.targets,
      ports: ctx.ports,
      includeDb: ctx.includeDb,
      includeModels: ctx.includeModels,
      commands: ctx.commands || [],
      sha256,
      signed: false,
    };
    const manifestPath = artifact + ".pack-manifest.json";
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
    out.push({ artifact, manifestPath, sha256 });
  }
  return out;
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function readRootPackage(cliRoot) {
  // packages/cli -> ../../package.json
  const rootPkgPath = path.resolve(cliRoot, "..", "..", "package.json");
  try {
    return JSON.parse(fs.readFileSync(rootPkgPath, "utf-8"));
  } catch {
    return null;
  }
}

function lookupPkgVersion(cliRoot) {
  for (const candidate of [
    path.join(cliRoot, "node_modules", "@yao-pkg", "pkg", "package.json"),
    path.join(cliRoot, "node_modules", "pkg", "package.json"),
  ]) {
    try {
      const pkg = JSON.parse(fs.readFileSync(candidate, "utf-8"));
      return `${pkg.name}@${pkg.version}`;
    } catch {
      /* not installed via this path */
    }
  }
  return null;
}
