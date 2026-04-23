/**
 * Phase 6: pkg-runner
 *
 * Spawn @yao-pkg/pkg with the synthesized config and capture output.
 *
 * Phase 1 implementation: prefer the locally-installed binary at
 * node_modules/.bin/pkg (or @yao-pkg/pkg/lib-es5/bin.js). If pkg is not
 * installed, throw a clear error pointing at `npm install -D @yao-pkg/pkg`.
 *
 * We deliberately avoid bundling pkg as a runtime dep — it's a dev tool and
 * users who never run `cc pack` should not pay its install cost.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PackError, EXIT } from "./errors.js";

/**
 * @param {object} ctx
 * @param {string} ctx.cliRoot
 * @param {string} ctx.pkgConfigFile     synthesized package.json path
 * @param {string} ctx.outputPath        absolute final output path (no ext)
 * @param {string[]} ctx.targets
 * @param {object} [ctx.logger]
 * @returns {{ outputs: string[] }}
 */
export function runPkg(ctx) {
  const { cliRoot, pkgConfigFile, outputPath, targets, logger } = ctx;
  const log = logger?.log || (() => {});

  const pkgBin = locatePkgBinary(cliRoot);
  if (!pkgBin) {
    throw new PackError(
      "@yao-pkg/pkg not found in node_modules. Install it as a devDependency:\n" +
        "    npm install -D @yao-pkg/pkg --workspace packages/cli",
      EXIT.PKG,
    );
  }

  // Use --output to control the produced filename; pkg auto-appends platform
  // suffix only when multiple targets are passed.
  const args = [
    pkgBin.script,
    pkgConfigFile,
    "--targets",
    targets.join(","),
    "--output",
    outputPath,
  ];

  log(`  [pkg] Running: ${pkgBin.runtime} ${args.join(" ")}`);
  const res = spawnSync(pkgBin.runtime, args, {
    cwd: path.dirname(pkgConfigFile),
    stdio: "inherit",
    windowsHide: true,
  });

  if (res.status !== 0) {
    throw new PackError(
      `pkg exited with code ${res.status}. See output above for details.`,
      EXIT.PKG,
    );
  }

  const outputs = collectOutputs(outputPath, targets);
  if (outputs.length === 0) {
    throw new PackError(
      `pkg reported success but no output file found at ${outputPath}*`,
      EXIT.PKG,
    );
  }
  return { outputs };
}

/**
 * Locate a runnable pkg binary. Tries:
 *   1. node_modules/.bin/pkg / pkg.cmd
 *   2. node_modules/@yao-pkg/pkg/lib-es5/bin.js (run via current node)
 *   3. node_modules/pkg/lib-es5/bin.js (legacy vercel/pkg fallback)
 */
function locatePkgBinary(cliRoot) {
  const yaoBin = path.join(
    cliRoot,
    "node_modules",
    "@yao-pkg",
    "pkg",
    "lib-es5",
    "bin.js",
  );
  if (fs.existsSync(yaoBin)) {
    return { runtime: process.execPath, script: yaoBin };
  }

  const legacyBin = path.join(
    cliRoot,
    "node_modules",
    "pkg",
    "lib-es5",
    "bin.js",
  );
  if (fs.existsSync(legacyBin)) {
    return { runtime: process.execPath, script: legacyBin };
  }

  return null;
}

/**
 * For a single target, pkg writes to the exact --output path (with .exe on
 * Windows). For multiple targets it suffixes -<platform>-<arch>.
 */
function collectOutputs(outputPath, targets) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) return [];
  const base = path.basename(outputPath);
  const all = fs.readdirSync(dir);
  return all
    .filter(
      (name) =>
        name === base ||
        name.startsWith(base + "-") ||
        name === base + ".exe" ||
        name.startsWith(base + "-"),
    )
    .map((name) => path.join(dir, name))
    .filter((p) => fs.statSync(p).isFile());
}
