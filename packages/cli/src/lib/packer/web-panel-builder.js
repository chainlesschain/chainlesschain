/**
 * Phase 2: web-panel-builder
 *
 * Ensures packages/cli/src/assets/web-panel/ (or packages/web-panel/dist)
 * has a built Vue panel ready to embed. If missing or stale, runs
 * `npm run build:web-panel` from the CLI package root.
 *
 * Stale = source files in packages/web-panel/src newer than dist/index.html.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PackError, EXIT } from "./errors.js";

/**
 * @param {object} ctx
 * @param {string} ctx.cliRoot              packages/cli absolute path
 * @param {boolean} ctx.skipBuild           reuse existing dist
 * @param {object} [ctx.logger]             optional logger.log(msg)
 * @returns {{distDir:string, rebuilt:boolean, assetCount:number}}
 */
export function ensureWebPanel(ctx) {
  const { cliRoot, skipBuild, logger } = ctx;
  const log = logger?.log || (() => {});

  const candidates = [
    path.join(cliRoot, "src", "assets", "web-panel"),
    path.resolve(cliRoot, "..", "web-panel", "dist"),
  ];

  let distDir = candidates.find((d) =>
    fs.existsSync(path.join(d, "index.html")),
  );

  // Decide if a rebuild is needed
  let rebuilt = false;
  let needsBuild = !distDir;
  if (distDir && !skipBuild) {
    needsBuild = isDistStale(distDir);
  }

  if (needsBuild && skipBuild) {
    throw new PackError(
      "web-panel/dist is missing or stale, but --skip-web-panel-build was passed.",
      EXIT.WEB_PANEL,
    );
  }

  if (needsBuild) {
    log("  [web-panel] Building Vue panel via 'npm run build:web-panel'...");
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const res = spawnSync(npmCmd, ["run", "build:web-panel"], {
      cwd: cliRoot,
      stdio: "inherit",
      windowsHide: true,
    });
    if (res.status !== 0) {
      throw new PackError(
        `'npm run build:web-panel' exited with code ${res.status}`,
        EXIT.WEB_PANEL,
      );
    }
    rebuilt = true;
    distDir = candidates.find((d) => fs.existsSync(path.join(d, "index.html")));
  }

  if (!distDir) {
    throw new PackError(
      "web-panel build did not produce dist/index.html in any expected location.",
      EXIT.WEB_PANEL,
    );
  }

  const assetCount = countAssets(distDir);
  if (assetCount < 2) {
    throw new PackError(
      `web-panel dist looks empty (only ${assetCount} files). Build may be broken.`,
      EXIT.WEB_PANEL,
    );
  }

  return { distDir, rebuilt, assetCount };
}

/**
 * dist is stale if any source file is newer than dist/index.html.
 * Source roots tried in order; missing roots are skipped.
 */
function isDistStale(distDir) {
  const indexHtml = path.join(distDir, "index.html");
  if (!fs.existsSync(indexHtml)) return true;
  const builtAt = fs.statSync(indexHtml).mtimeMs;

  const sourceRoots = [
    path.resolve(distDir, "..", "..", "..", "web-panel", "src"),
    path.resolve(distDir, "..", "src"),
  ];
  for (const root of sourceRoots) {
    if (!fs.existsSync(root)) continue;
    if (latestMTimeRecursive(root, builtAt) > builtAt) return true;
  }
  return false;
}

/**
 * Walk dir; return earliest mtime that exceeds threshold.
 * Short-circuits on first hit.
 */
function latestMTimeRecursive(dir, threshold) {
  let max = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      try {
        const st = fs.statSync(full);
        if (e.isDirectory()) {
          stack.push(full);
        } else if (st.mtimeMs > max) {
          max = st.mtimeMs;
          if (max > threshold) return max;
        }
      } catch {
        /* skip */
      }
    }
  }
  return max;
}

function countAssets(distDir) {
  let count = 0;
  const stack = [distDir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else count++;
    }
  }
  return count;
}
