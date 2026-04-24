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
 * @param {object}  [ctx.runtime]             defaults baked into the entry
 * @param {string}  [ctx.runtime.token]       'auto' = regenerate each run,
 *                                            '' = no auth, any other string
 *                                            is hardcoded.
 * @param {string}  [ctx.runtime.bindHost]    default --host for `ui`
 * @param {number}  [ctx.runtime.wsPort]      default --ws-port
 * @param {number}  [ctx.runtime.uiPort]      default --port
 * @param {object|null} [ctx.project]         project-mode payload from
 *                                            project-assets-collector. When
 *                                            present, the entry script
 *                                            materializes the bundled
 *                                            .chainlesschain/ to a user-data
 *                                            dir and chdirs into it.
 * @param {string}  [ctx.project.projectDir]  tempDir/project absolute path
 * @param {string}  [ctx.project.projectName]
 * @param {string}  [ctx.project.configSha]
 * @param {string}  [ctx.projectEntry]        default subcommand for project
 *                                            mode (e.g. 'ui', 'chat'). If
 *                                            omitted, reads from the bundled
 *                                            config's `pack.entry` field.
 * @param {boolean} [ctx.forceRefreshOnLaunch] re-materialize every launch
 * @returns {{ pkgConfigDir: string, pkgConfigFile: string, entryScript: string, projectMeta: object|null }}
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
    runtime = {},
    project = null,
    projectEntry,
    forceRefreshOnLaunch = false,
  } = ctx;

  const bakedTokenMode =
    typeof runtime.token === "string" ? runtime.token : "auto";
  const bakedHost =
    typeof runtime.bindHost === "string" && runtime.bindHost
      ? runtime.bindHost
      : "127.0.0.1";
  const bakedWsPort = Number.isFinite(runtime.wsPort)
    ? String(runtime.wsPort)
    : "18800";
  const bakedUiPort = Number.isFinite(runtime.uiPort)
    ? String(runtime.uiPort)
    : "18810";

  const pkgConfigDir = path.join(tempDir, "pkg-config");
  fs.mkdirSync(pkgConfigDir, { recursive: true });

  // Read the real CLI package.json to inherit version/dependencies
  const realPkg = JSON.parse(
    fs.readFileSync(path.join(cliRoot, "package.json"), "utf-8"),
  );

  // Inline the real bin's logic directly. We can't use `import('...')`
  // because pkg's snapshot bootstrap does not register a dynamic-import
  // callback (ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING). Static ESM
  // imports compile fine via yao-pkg's ESM mode.
  const entryScript = path.join(pkgConfigDir, "pack-entry.js");
  const ensureUtf8Path = posixify(
    path.join(cliRoot, "src", "lib", "ensure-utf8.js"),
  );
  const indexPath = posixify(path.join(cliRoot, "src", "index.js"));
  fs.writeFileSync(
    entryScript,
    [
      "#!/usr/bin/env node",
      "// pkg entry — inlines the real CLI bin (see bin/chainlesschain.js).",
      "// CC_PACK_MODE flips the WS layer to allow chat/agent over execute.",
      "process.env.CC_PACK_MODE = '1';",
      "import crypto from 'node:crypto';",
      `import { ensureUtf8 } from '${ensureUtf8Path}';`,
      `import { createProgram } from '${indexPath}';`,
      "ensureUtf8();",
      "// Build-time defaults baked by the packer. Each is overridable at",
      "// runtime either via the matching env var or by passing the flag.",
      `const BAKED = Object.freeze(${JSON.stringify({
        tokenMode: bakedTokenMode,
        host: bakedHost,
        wsPort: bakedWsPort,
        uiPort: bakedUiPort,
      })});`,
      "// Double-click from Explorer arrives with no subcommand — without",
      "// this default, commander prints help and exits, which looks like",
      "// a black console 'flash and close'. Launching `ui` (with browser",
      "// auto-open) gives the packed exe a sensible standalone behavior.",
      "const _rest = process.argv.slice(2);",
      "const _hasSub = _rest.some((a) => a && !a.startsWith('-'));",
      "const _argSet = new Set(_rest);",
      "const _hasFlag = (...names) => names.some((n) => _argSet.has(n));",
      "// Commander short-circuits --version / --help before running any",
      "// command — don't pollute their stdout with the token banner and",
      "// baked defaults they'd never see anyway.",
      "const _shortCircuits = _hasFlag('-v', '--version', '-h', '--help');",
      "if (!_hasSub && !_shortCircuits) {",
      "  process.argv.push('ui');",
      "  if (!_hasFlag('-p', '--port'))",
      "    process.argv.push('--port', process.env.CC_PACK_UI_PORT || BAKED.uiPort);",
      "  if (!_hasFlag('--ws-port'))",
      "    process.argv.push('--ws-port', process.env.CC_PACK_WS_PORT || BAKED.wsPort);",
      "  if (!_hasFlag('-H', '--host'))",
      "    process.argv.push('--host', process.env.CC_PACK_HOST || BAKED.host);",
      "  if (!_hasFlag('--token') && BAKED.tokenMode) {",
      "    let tok = process.env.CC_PACK_TOKEN || BAKED.tokenMode;",
      "    if (tok === 'auto') {",
      "      tok = crypto.randomBytes(16).toString('hex');",
      "      console.log('');",
      "      console.log('  \\u2139  Access token (auto-generated this run):');",
      "      console.log('     ' + tok);",
      "      console.log('     set CC_PACK_TOKEN=<value> to pin a stable token.');",
      "      console.log('');",
      "    }",
      "    process.argv.push('--token', tok);",
      "  }",
      "}",
      "// When launched from Explorer, Node exits as soon as the event loop",
      "// drains. If something throws before the UI server starts listening,",
      "// we want the user to see the error — pause on fatal errors.",
      "process.on('uncaughtException', (err) => {",
      "  console.error('\\n[cc-pack] Fatal error:', err && err.stack || err);",
      "  if (process.stdin.isTTY) {",
      "    console.error('\\nPress any key to exit...');",
      "    try { process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.once('data', () => process.exit(1)); } catch { process.exit(1); }",
      "  } else { process.exit(1); }",
      "});",
      "const program = createProgram();",
      "program.parse(process.argv);",
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
