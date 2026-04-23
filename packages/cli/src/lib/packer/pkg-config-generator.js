/**
 * Phase 5: pkg-config-generator
 *
 * Produce a transient pkg config (written next to a temp entry script) that
 * tells @yao-pkg/pkg which scripts to compile and which assets to embed.
 *
 * The pkg config used here is the standard "pkg" key shape:
 *   {
 *     "scripts": ["src/**\/*.js"],
 *     "assets":  ["src/assets/web-panel/**\/*", "templates/**\/*", "prebuilds/**\/*"],
 *     "targets": ["node20-win-x64"],
 *     "outputPath": "dist"
 *   }
 *
 * We do NOT mutate the real packages/cli/package.json — we write a synthesized
 * package.json into the build temp dir that re-exports the bin and adds the
 * "pkg" key. pkg is invoked against that file.
 */

import fs from "node:fs";
import path from "node:path";

/**
 * @param {object} ctx
 * @param {string} ctx.cliRoot                packages/cli/
 * @param {string} ctx.tempDir                build temp dir
 * @param {string} ctx.distDir                web-panel dist absolute path
 * @param {string|null} ctx.prebuildsDir      prebuilds/ absolute path or null
 * @param {string} ctx.templatesDir           templates/ absolute path
 * @param {string[]} ctx.targets
 * @param {string} ctx.outputPath             absolute output path (no ext)
 * @param {boolean} ctx.compress
 * @returns {{ pkgConfigDir: string, pkgConfigFile: string, entryScript: string }}
 */
export function generatePkgConfig(ctx) {
  const {
    cliRoot,
    tempDir,
    distDir,
    prebuildsDir,
    templatesDir,
    targets,
    outputPath,
    compress,
  } = ctx;

  const pkgConfigDir = path.join(tempDir, "pkg-config");
  fs.mkdirSync(pkgConfigDir, { recursive: true });

  // Read the real CLI package.json to inherit version/dependencies
  const realPkg = JSON.parse(
    fs.readFileSync(path.join(cliRoot, "package.json"), "utf-8"),
  );

  const entryScript = path.join(pkgConfigDir, "pack-entry.js");
  fs.writeFileSync(
    entryScript,
    [
      "#!/usr/bin/env node",
      "// pkg entry — minimal shim that delegates to the real CLI bin.",
      "// CC_PACK_MODE flips the WS layer to allow chat/agent over execute.",
      "process.env.CC_PACK_MODE = '1';",
      `import('${path
        .join(cliRoot, "bin", "chainlesschain.js")
        .replace(/\\/g, "/")}');`,
      "",
    ].join("\n"),
    "utf-8",
  );

  const assets = [
    `${posixify(distDir)}/**/*`,
    `${posixify(templatesDir)}/**/*`,
  ];
  if (prebuildsDir) assets.push(`${posixify(prebuildsDir)}/**/*`);

  const synthesizedPkg = {
    name: realPkg.name + "-pack",
    version: realPkg.version,
    bin: "pack-entry.js",
    type: "module",
    pkg: {
      scripts: [
        // Glob covers the entire CLI source tree, since dependencies are
        // resolved from cliRoot/node_modules.
        `${posixify(cliRoot)}/src/**/*.js`,
        `${posixify(cliRoot)}/src/**/*.cjs`,
        `${posixify(cliRoot)}/bin/**/*.js`,
      ],
      assets,
      targets,
      outputPath: path.dirname(outputPath),
      compress: compress ? "GZip" : "None",
    },
  };

  const pkgConfigFile = path.join(pkgConfigDir, "package.json");
  fs.writeFileSync(
    pkgConfigFile,
    JSON.stringify(synthesizedPkg, null, 2),
    "utf-8",
  );

  return { pkgConfigDir, pkgConfigFile, entryScript };
}

function posixify(p) {
  return p.replace(/\\/g, "/");
}
