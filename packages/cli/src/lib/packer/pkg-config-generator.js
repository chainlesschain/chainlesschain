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
 * @param {string|null} [ctx.updateManifestUrl] Phase 5a OTA manifest URL;
 *                                            baked into BAKED.updateManifestUrl
 *                                            and surfaced via `cc pack check-update`
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
    updateManifestUrl = null,
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

  // ── Project mode: read pack.* from bundled config ─────────────────────────
  let projectBaked = null;
  if (project) {
    const bundledConfigPath = path.join(
      project.projectDir,
      ".chainlesschain",
      "config.json",
    );
    let packConfig = {};
    try {
      const raw = JSON.parse(fs.readFileSync(bundledConfigPath, "utf-8"));
      packConfig = raw.pack || {};
    } catch {
      /* already validated by Phase 3.5 — missing config falls back to defaults */
    }

    const resolvedEntry =
      typeof projectEntry === "string" && projectEntry.trim()
        ? projectEntry.trim()
        : typeof packConfig.entry === "string" && packConfig.entry.trim()
          ? packConfig.entry.trim()
          : "ui";

    projectBaked = {
      projectMode: true,
      projectName: project.projectName,
      projectEntry: resolvedEntry,
      projectConfigSha: project.configSha,
      projectAutoPersona:
        typeof packConfig.autoPersona === "string"
          ? packConfig.autoPersona
          : null,
      projectAllowedSubcommands: Array.isArray(packConfig.allowedSubcommands)
        ? packConfig.allowedSubcommands
        : ["ui", "chat", "agent", "skill"],
      // Absolute path to the bundled .chainlesschain/ inside the pkg snapshot FS.
      // At runtime, pkg surfaces assets at their original absolute paths.
      projectBundledDir: posixify(
        path.join(project.projectDir, ".chainlesschain"),
      ),
      forceRefreshOnLaunch: Boolean(forceRefreshOnLaunch),
    };
  }

  const pkgConfigDir = path.join(tempDir, "pkg-config");
  fs.mkdirSync(pkgConfigDir, { recursive: true });

  // Read the real CLI package.json to inherit version/dependencies
  const realPkg = JSON.parse(
    fs.readFileSync(path.join(cliRoot, "package.json"), "utf-8"),
  );

  // Phase 5a: bake OTA manifest URL + the exact CLI version shipped in this
  // artifact so `cc pack check-update` can compare against the manifest's
  // latest.cliVersion without relying on the unpacked CLI's VERSION constant.
  const bakedObj = {
    tokenMode: bakedTokenMode,
    host: bakedHost,
    wsPort: bakedWsPort,
    uiPort: bakedUiPort,
    packedCliVersion: realPkg.version || null,
    updateManifestUrl:
      typeof updateManifestUrl === "string" && updateManifestUrl
        ? updateManifestUrl
        : null,
    ...(projectBaked || {}),
  };

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
      "import fs from 'node:fs';",
      "import os from 'node:os';",
      "import path from 'node:path';",
      `import { ensureUtf8 } from '${ensureUtf8Path}';`,
      `import { createProgram } from '${indexPath}';`,
      "ensureUtf8();",
      "// Build-time defaults baked by the packer. Each is overridable at",
      "// runtime either via the matching env var or by passing the flag.",
      `const BAKED = Object.freeze(${JSON.stringify(bakedObj)});`,
      "// Expose BAKED on globalThis so downstream subcommands (e.g. `cc pack",
      "// check-update`) can read packedCliVersion / updateManifestUrl without",
      "// importing from the packer. No-op in CLI-only builds outside pkg.",
      "globalThis.BAKED = BAKED;",
      "// .env sidecar parser (per design §13 #4). Returns a flat KEY=VALUE",
      "// dict; missing file / unreadable -> {}. Skips blank lines, '#' comments,",
      "// and BOM. Strips matching single/double quote pairs but leaves inner",
      "// content untouched (no escape-sequence interpretation — power users who",
      "// need that can set the var from their shell, which wins anyway).",
      "function _loadDotenv(filePath) {",
      "  try {",
      "    if (!filePath || !fs.existsSync(filePath)) return {};",
      "    const body = fs.readFileSync(filePath, 'utf-8').replace(/^\\uFEFF/, '');",
      "    const out = {};",
      "    for (const rawLine of body.split(/\\r?\\n/)) {",
      "      const line = rawLine.trim();",
      "      if (!line || line.startsWith('#')) continue;",
      "      const eq = line.indexOf('=');",
      "      if (eq <= 0) continue;",
      "      const key = line.slice(0, eq).trim();",
      "      let val = line.slice(eq + 1).trim();",
      "      if (val.length >= 2 &&",
      "          ((val.startsWith('\"') && val.endsWith('\"')) ||",
      '           (val.startsWith("\'") && val.endsWith("\'")))) {',
      "        val = val.slice(1, -1);",
      "      }",
      "      out[key] = val;",
      "    }",
      "    return out;",
      "  } catch { return {}; }",
      "}",
      "// Schema-aware deep-merge: bundled (base) values fill in missing keys,",
      "// existing user values win. Used only for .chainlesschain/config.json so",
      "// new exe schema fields land without clobbering user edits.",
      "function _deepMerge(base, override) {",
      "  if (override === null || typeof override !== 'object' || Array.isArray(override)) return override;",
      "  if (base === null || typeof base !== 'object' || Array.isArray(base)) return override;",
      "  const out = { ...base };",
      "  for (const k of Object.keys(override)) {",
      "    out[k] = (k in base) ? _deepMerge(base[k], override[k]) : override[k];",
      "  }",
      "  return out;",
      "}",
      "// Merge-copy helper: copies src tree into dest, skipping files that",
      "// already exist (preserves user modifications). Used only in project mode.",
      "// Special case: top-level config.json gets deep-merged (user values win,",
      "// bundled supplies new schema fields).",
      "function copyRecursiveMerge(src, dest, rootSrc) {",
      "  if (rootSrc === undefined) rootSrc = src;",
      "  if (!fs.existsSync(src)) return;",
      "  fs.mkdirSync(dest, { recursive: true });",
      "  for (const e of fs.readdirSync(src, { withFileTypes: true })) {",
      "    const sp = path.join(src, e.name), dp = path.join(dest, e.name);",
      "    if (e.isDirectory()) { copyRecursiveMerge(sp, dp, rootSrc); }",
      "    else if (!fs.existsSync(dp)) { fs.copyFileSync(sp, dp); }",
      "    else {",
      "      const _rel = path.relative(rootSrc, sp).replace(/\\\\/g, '/');",
      "      if (_rel === 'config.json') {",
      "        try {",
      "          const _userCfg = JSON.parse(fs.readFileSync(dp, 'utf-8'));",
      "          const _newCfg  = JSON.parse(fs.readFileSync(sp, 'utf-8'));",
      "          const _merged  = _deepMerge(_newCfg, _userCfg);",
      "          fs.writeFileSync(dp, JSON.stringify(_merged, null, 2), 'utf-8');",
      "        } catch (err) { console.warn('[cc-pack] config.json merge failed, keeping existing:', dp, err && err.message); }",
      "      } else {",
      "        console.warn('[cc-pack] Keeping existing file (user-modified):', dp);",
      "      }",
      "    }",
      "  }",
      "}",
      "// ── Project mode: materialize bundled .chainlesschain/ to user-data dir ──",
      "// BAKED.projectMode is absent (falsy) in CLI-only builds — entire block skipped.",
      "if (BAKED.projectMode) {",
      "  // Per design §9: prefer %APPDATA% on Windows (Roaming, ~260-char-safe);",
      "  // fall back to ~ on other platforms or when APPDATA is unset.",
      "  const _baseDir = (process.platform === 'win32' && process.env.APPDATA)",
      "    ? process.env.APPDATA",
      "    : os.homedir();",
      "  // SHA-16 (64-bit entropy) per design §4.3 — prior SHA-8 had 32-bit entropy",
      "  // which is too narrow for multi-project + multi-version coexistence.",
      "  const _userDataDir = path.join(",
      "    _baseDir, '.chainlesschain-projects',",
      "    `${BAKED.projectName}-${BAKED.projectConfigSha.slice(0, 16)}`,",
      "  );",
      "  const _markerFile = path.join(_userDataDir, '.chainlesschain', '.pack-version');",
      "  const _lockFile   = path.join(_userDataDir, '.chainlesschain', '.materialize.lock');",
      "  const _needsMaterialize =",
      "    BAKED.forceRefreshOnLaunch ||",
      "    !fs.existsSync(_markerFile) ||",
      "    fs.readFileSync(_markerFile, 'utf8').trim() !== BAKED.projectConfigSha;",
      "  // Concurrent-materialize protection: only the first instance acquires the",
      "  // lock and does the copy. Other instances skip silently — the marker file",
      "  // will already be written by the time they get to use the dir.",
      "  let _lockFd = null;",
      "  if (_needsMaterialize) {",
      "    try {",
      "      fs.mkdirSync(path.dirname(_lockFile), { recursive: true });",
      "      _lockFd = fs.openSync(_lockFile, 'wx');",
      "    } catch { /* another instance holds the lock */ }",
      "  }",
      "  if (_needsMaterialize && _lockFd !== null) {",
      "    copyRecursiveMerge(BAKED.projectBundledDir, path.join(_userDataDir, '.chainlesschain'));",
      "    fs.mkdirSync(path.dirname(_markerFile), { recursive: true });",
      "    fs.writeFileSync(_markerFile, BAKED.projectConfigSha, 'utf8');",
      "  }",
      "  if (_lockFd !== null) {",
      "    try { fs.closeSync(_lockFd); fs.unlinkSync(_lockFile); } catch { /* best-effort */ }",
      "  }",
      "  process.env.CC_PROJECT_ROOT = _userDataDir;",
      "  if (BAKED.projectAllowedSubcommands) {",
      "    process.env.CC_PROJECT_ALLOWED_SUBCOMMANDS = BAKED.projectAllowedSubcommands.join(',');",
      "  }",
      "  // Phase 3b: expose the baked auto-persona via env so downstream",
      "  // consumers (skill-loader / persona resolver) can pick it up.",
      "  if (BAKED.projectAutoPersona) {",
      "    process.env.CC_PACK_AUTO_PERSONA = BAKED.projectAutoPersona;",
      "  }",
      "}",
      "// Phase 3f: .env sidecar loader (per design §13 #4 + §9 LLM API keys).",
      "// Priority (highest to lowest): explicit process.env (set in shell),",
      "// <CC_PROJECT_ROOT>/.env, <exePath dir>/.env. We snapshot the original",
      "// process.env keys before reading so neither .env can mask a user's",
      "// shell-level export. The userDataDir .env wins over exePath dir when",
      "// both define the same key because we apply it second.",
      "{",
      "  const _origEnvKeys = new Set(Object.keys(process.env));",
      "  const _exeEnv = _loadDotenv(path.join(path.dirname(process.execPath), '.env'));",
      "  const _userEnv = process.env.CC_PROJECT_ROOT",
      "    ? _loadDotenv(path.join(process.env.CC_PROJECT_ROOT, '.env'))",
      "    : {};",
      "  for (const _k of Object.keys(_exeEnv)) {",
      "    if (!_origEnvKeys.has(_k)) process.env[_k] = _exeEnv[_k];",
      "  }",
      "  for (const _k of Object.keys(_userEnv)) {",
      "    if (!_origEnvKeys.has(_k)) process.env[_k] = _userEnv[_k];",
      "  }",
      "}",
      "// Double-click from Explorer arrives with no subcommand — without",
      "// this default, commander prints help and exits, which looks like",
      "// a black console 'flash and close'. In project mode the baked",
      "// entry subcommand is used instead of the CLI-only 'ui' fallback.",
      "const _rest = process.argv.slice(2);",
      "const _hasSub = _rest.some((a) => a && !a.startsWith('-'));",
      "const _argSet = new Set(_rest);",
      "const _hasFlag = (...names) => names.some((n) => _argSet.has(n));",
      "// Phase 3f: --version --json short-circuit (per design §13 #3). Plain",
      "// --version goes through commander; the --json combo emits a structured",
      "// payload with cli + (in project mode) project name/sha. We intercept",
      "// before commander.parse so the JSON is the only thing on stdout.",
      "if (_hasFlag('-v', '--version') && _hasFlag('--json')) {",
      "  const _vOut = { cli: BAKED.packedCliVersion || 'unknown' };",
      "  if (BAKED.projectMode) {",
      "    _vOut.project = { name: BAKED.projectName, sha: BAKED.projectConfigSha };",
      "  }",
      "  console.log(JSON.stringify(_vOut));",
      "  process.exit(0);",
      "}",
      "// Commander short-circuits --version / --help before running any",
      "// command — don't pollute their stdout with the token banner and",
      "// baked defaults they'd never see anyway.",
      "const _shortCircuits = _hasFlag('-v', '--version', '-h', '--help');",
      "if (!_hasSub && !_shortCircuits) {",
      "  const _entryCmd = BAKED.projectMode ? BAKED.projectEntry : 'ui';",
      "  for (const _p of _entryCmd.split(/\\s+/).filter(Boolean)) process.argv.push(_p);",
      "  if (_entryCmd.split(/\\s+/)[0] === 'ui') {",
      "    if (!_hasFlag('-p', '--port'))",
      "      process.argv.push('--port', process.env.CC_PACK_UI_PORT || BAKED.uiPort);",
      "    if (!_hasFlag('--ws-port'))",
      "      process.argv.push('--ws-port', process.env.CC_PACK_WS_PORT || BAKED.wsPort);",
      "    if (!_hasFlag('-H', '--host'))",
      "      process.argv.push('--host', process.env.CC_PACK_HOST || BAKED.host);",
      "    if (!_hasFlag('--token') && BAKED.tokenMode) {",
      "      let tok = process.env.CC_PACK_TOKEN || BAKED.tokenMode;",
      "      if (tok === 'auto') {",
      "        tok = crypto.randomBytes(16).toString('hex');",
      "        console.log('');",
      "        console.log('  \\u2139  Access token (auto-generated this run):');",
      "        console.log('     ' + tok);",
      "        console.log('     set CC_PACK_TOKEN=<value> to pin a stable token.');",
      "        console.log('');",
      "      }",
      "      process.argv.push('--token', tok);",
      "    }",
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
  // Project mode: bundle the collected .chainlesschain/ snapshot as an asset.
  // At runtime, pkg surfaces it at its original absolute path in the snapshot FS.
  if (project) assets.push(`${posixify(project.projectDir)}/**/*`);

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

  return {
    pkgConfigDir,
    pkgConfigFile,
    entryScript,
    projectMeta: projectBaked,
  };
}

function posixify(p) {
  return p.replace(/\\/g, "/");
}
