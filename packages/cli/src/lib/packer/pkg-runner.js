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
import { createRequire } from "node:module";
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
  // Pair each produced artifact with the pkg target it came from. For a
  // single target build, pkg writes to the bare --output path; for multi
  // target it suffixes with "-<platformKey>". We match on the suffix
  // when possible and fall back to positional pairing.
  const rich = outputs.map((p) => {
    const base = path.basename(outputPath);
    const name = path.basename(p, path.extname(p));
    const suffix = name.startsWith(base + "-")
      ? name.slice(base.length + 1)
      : null;
    let target = null;
    if (suffix && targets.length > 1) {
      target = targets.find((t) => t.endsWith(suffix)) || null;
    }
    if (!target && targets.length === 1) target = targets[0];
    return { path: p, target };
  });
  return { outputs: rich };
}

/**
 * Locate a runnable pkg binary using node's resolution algorithm so we
 * find both local and monorepo-hoisted installs of @yao-pkg/pkg (or
 * legacy vercel/pkg) without hard-coding paths.
 */
function locatePkgBinary(cliRoot) {
  const req = createRequire(path.join(cliRoot, "package.json"));
  for (const pkgName of ["@yao-pkg/pkg", "pkg"]) {
    try {
      const pkgJson = req.resolve(`${pkgName}/package.json`);
      const moduleDir = path.dirname(pkgJson);
      const meta = JSON.parse(fs.readFileSync(pkgJson, "utf-8"));
      const binEntry = typeof meta.bin === "string" ? meta.bin : meta.bin?.pkg;
      if (binEntry) {
        const script = path.join(moduleDir, binEntry);
        if (fs.existsSync(script)) {
          return { runtime: process.execPath, script };
        }
      }
    } catch {
      /* not installed via this name */
    }
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
