/**
 * prepare-web-shell-vendor.js — Phase 1.4 packaging prep (2026-04-30).
 *
 * Standalone, idempotent helper that copies the CLI runtime closure and
 * web-panel assets the embedded web-shell/Desktop PTY policy loader need:
 *
 *   <root>/packages/cli/src      → <buildPath>/packages/cli/src
 *   <root>/packages/cli/package.json
 *                                → <buildPath>/packages/cli/package.json
 *   <root>/packages/cli/node_modules
 *                                → <buildPath>/packages/cli/node_modules
 *   <root>/packages/web-panel/dist → <buildPath>/packages/web-panel/dist
 *
 * After this runs, the existing relative-path constants in the Desktop
 * web-shell loaders and terminal/policy-aware-pty-manager resolve correctly:
 * `../../../../packages/cli/...` from `<buildPath>/dist/main/<loader>/` lands
 * at `<buildPath>/packages/cli/...`.
 *
 * Excluded from the cli/src copy:
 *   - assets/web-panel/  — duplicates web-panel/dist (cc pack bundle).
 *                          Web-shell explicitly passes staticDir to
 *                          web-ui-server so the bundled fallback is
 *                          unreachable; saves ~3.4 MB.
 *
 * `packages/cli/node_modules` must be a standalone production install created
 * by `npm run prepare:cli-prod-deps`; relying on repo-root hoisting breaks once
 * the CLI source is moved outside app.asar.
 *
 * ─────────────────────────────────────────────────────────────────────
 * HOW TO WIRE THIS INTO PACKAGING (Phase 1.4 next-session checklist)
 * ─────────────────────────────────────────────────────────────────────
 *
 * 1. forge.config.js, inside `packageAfterCopy` AFTER the existing
 *    `copyMissing(rootNodeModules, buildNodeModules)` block (so node_modules
 *    is settled first):
 *
 *        const {
 *          vendorWebShellInto,
 *          verifyVendoredPluginBinRuntime,
 *        } =
 *          require("./scripts/prepare-web-shell-vendor.js");
 *        // CRITICAL: vendor target is the PARENT of buildPath, NOT buildPath.
 *        // The web-shell loaders' REL constants (`../../../../packages/...`)
 *        // resolve 4-up from `<buildPath>/dist/main/web-shell/` = parent of
 *        // buildPath = Resources/. If we vendor into buildPath itself, 4-up
 *        // overshoots and lands at <Resources>/packages/... (empty), so the
 *        // loaders ENOENT at startup.
 *        const path = require("path");
 *        const vendorTarget = path.join(buildPath, "..");
 *        vendorWebShellInto(vendorTarget);
 *        await verifyVendoredPluginBinRuntime(vendorTarget);
 *
 * 2. Keep packagerConfig.asar focused on native modules. The CLI runtime lives
 *    under Resources/packages, outside app.asar, so a packages/** unpack glob
 *    is neither needed nor sufficient:
 *
 *        asar: {
 *          unpack: "*.{node,dll,dylib,so,exe}",
 *        },
 *
 * 3. After `npm run make:win`, verify the produced bundle:
 *
 *        out/.../Resources/packages/cli/src/lib/web-ui-server.js
 *        out/.../Resources/packages/cli/src/lib/plugin-runtime/bin.js
 *        out/.../Resources/packages/cli/package.json
 *        out/.../Resources/packages/cli/node_modules/semver/package.json
 *        out/.../Resources/packages/web-panel/dist/index.html
 *
 *    These must exist as real files. Because the vendor target is now
 *    Resources/ (outside the app.asar staging dir), these files are
 *    automatically OUTSIDE asar — no asar unpack glob needed for them.
 *    (The unpack glob still matters for any future native-module needs.)
 *
 * 4. Launch the installed app and check the main-process log for:
 *
 *        [WebShell] HTTP: http://127.0.0.1:NNNN/
 *        [WebShell] WS:   ws://127.0.0.1:MMMM/
 *
 *    If you see ENOENT on web-ui-server.js, the unpack glob did not
 *    match — adjust to a more permissive pattern.
 * ─────────────────────────────────────────────────────────────────────
 */

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLI_ROOT = path.join(REPO_ROOT, "packages", "cli");
const CLI_SRC = path.join(REPO_ROOT, "packages", "cli", "src");
const CLI_PACKAGE_JSON = path.join(CLI_ROOT, "package.json");
const CLI_NODE_MODULES = path.join(CLI_ROOT, "node_modules");
const WEB_PANEL_DIST = path.join(REPO_ROOT, "packages", "web-panel", "dist");

/** Names ignored at every directory level during the cli/src copy. */
const CLI_SRC_EXCLUDES = new Set([
  "__tests__",
  "node_modules",
  ".git",
  ".cache",
  "coverage",
]);

/**
 * Top-level subpaths under packages/cli/src that we deliberately drop.
 * Use POSIX separators here — we normalise before comparing.
 */
const CLI_SRC_TOP_LEVEL_DROP = new Set([
  "assets/web-panel", // duplicate of web-panel/dist (cc pack bundle)
]);

/** Match electron-builder's extraResources exclusions for CLI runtime deps. */
const CLI_NODE_MODULES_EXCLUDES = new Set([
  ".bin",
  ".cache",
  ".git",
  ".vite",
  ".vite-temp",
  "__tests__",
]);

/** @typedef {{ files: number, bytes: number, skipped: number }} CopyStats */

/**
 * Recursively copy `src` into `dst`, applying excludes. Returns counters.
 *
 * @param {string} src
 * @param {string} dst
 * @param {{
 *   dryRun?: boolean,
 *   relRoot?: string,
 *   excludedNames?: Set<string>,
 *   droppedPaths?: Set<string>,
 *   excludeEntry?: (entry: import("fs").Dirent, rel: string) => boolean,
 *   rejectSpecialEntries?: boolean,
 * }} [options]
 * @returns {CopyStats}
 */
function copyTree(src, dst, options = {}) {
  const {
    dryRun = false,
    relRoot = "",
    excludedNames = CLI_SRC_EXCLUDES,
    droppedPaths = CLI_SRC_TOP_LEVEL_DROP,
    excludeEntry,
    rejectSpecialEntries = false,
  } = options;
  const stats = { files: 0, bytes: 0, skipped: 0 };

  if (!fs.existsSync(src)) {
    throw new Error(`source does not exist: ${src}`);
  }

  if (!dryRun) {
    fs.mkdirSync(dst, { recursive: true });
  }

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const name = entry.name;
    const rel = relRoot ? `${relRoot}/${name}` : name;
    if (
      excludedNames.has(name) ||
      droppedPaths.has(rel) ||
      excludeEntry?.(entry, rel)
    ) {
      stats.skipped++;
      continue;
    }

    const srcPath = path.join(src, name);
    const dstPath = path.join(dst, name);

    if (entry.isDirectory()) {
      const sub = copyTree(srcPath, dstPath, {
        dryRun,
        relRoot: rel,
        excludedNames,
        droppedPaths,
        excludeEntry,
        rejectSpecialEntries,
      });
      stats.files += sub.files;
      stats.bytes += sub.bytes;
      stats.skipped += sub.skipped;
    } else if (entry.isFile()) {
      const sourceStat = fs.statSync(srcPath);
      const size = sourceStat.size;
      stats.files++;
      stats.bytes += size;
      if (!dryRun) {
        fs.copyFileSync(srcPath, dstPath);
        fs.chmodSync(dstPath, sourceStat.mode);
      }
    } else {
      if (rejectSpecialEntries) {
        throw new Error(
          `runtime dependency tree contains a non-file entry at ${srcPath}; ` +
            "run `npm run prepare:cli-prod-deps` to create a standalone install",
        );
      }
      // Symlinks, sockets, etc. — don't try to copy from source-only trees.
      stats.skipped++;
    }
  }

  return stats;
}

function copyFileWithStats(src, dst, { dryRun = false } = {}) {
  if (!fs.existsSync(src)) {
    throw new Error(`source does not exist: ${src}`);
  }
  const bytes = fs.statSync(src).size;
  if (!dryRun) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    fs.chmodSync(dst, fs.statSync(src).mode);
  }
  return { files: 1, bytes, skipped: 0 };
}

/**
 * Vendor the CLI ESM package boundary, source, standalone production
 * dependencies, and web-panel assets into `buildPath`. Idempotent — subsequent
 * runs overwrite files in place.
 *
 * @param {string} buildPath
 *   Absolute path of the desktop-app-vue copy that forge stages before asar.
 *   (In packageAfterCopy this is the second hook arg.)
 * @param {{
 *   dryRun?: boolean,
 *   log?: (msg: string) => void,
 *   includeRuntimeDependencies?: boolean,
 *   cliNodeModulesSource?: string,
 * }} [options]
 * @returns {{
 *   cli: CopyStats,
 *   cliPackage: CopyStats,
 *   cliNodeModules: CopyStats,
 *   webPanel: CopyStats,
 *   totalFiles: number,
 *   totalBytes: number,
 * }}
 */
function vendorWebShellInto(buildPath, options = {}) {
  const {
    dryRun = false,
    log = console.log,
    includeRuntimeDependencies = true,
    cliNodeModulesSource = CLI_NODE_MODULES,
  } = options;

  if (!buildPath || typeof buildPath !== "string") {
    throw new TypeError("vendorWebShellInto: buildPath must be a string");
  }
  if (!fs.existsSync(CLI_SRC)) {
    throw new Error(`cli source not found at ${CLI_SRC}`);
  }
  if (!fs.existsSync(CLI_PACKAGE_JSON)) {
    throw new Error(`cli package.json not found at ${CLI_PACKAGE_JSON}`);
  }
  if (includeRuntimeDependencies && !fs.existsSync(cliNodeModulesSource)) {
    throw new Error(
      `cli production dependencies not found at ${cliNodeModulesSource}. ` +
        "Run `npm run prepare:cli-prod-deps` first.",
    );
  }
  if (!fs.existsSync(path.join(WEB_PANEL_DIST, "index.html"))) {
    throw new Error(
      `web-panel dist not found at ${WEB_PANEL_DIST}. ` +
        "Run `npm run build` in packages/web-panel first.",
    );
  }

  const cliRootDst = path.join(buildPath, "packages", "cli");
  const cliDst = path.join(cliRootDst, "src");
  const cliPackageDst = path.join(cliRootDst, "package.json");
  const cliNodeModulesDst = path.join(cliRootDst, "node_modules");
  const webPanelDst = path.join(buildPath, "packages", "web-panel", "dist");

  log(`[vendor] ${dryRun ? "(dry-run) " : ""}cli  : ${CLI_SRC} -> ${cliDst}`);
  const cli = copyTree(CLI_SRC, cliDst, { dryRun });
  log(
    `[vendor] ${dryRun ? "(dry-run) " : ""}cli  : ${cli.files} files, ${formatBytes(cli.bytes)}, skipped ${cli.skipped}`,
  );

  log(
    `[vendor] ${dryRun ? "(dry-run) " : ""}pkg  : ${CLI_PACKAGE_JSON} -> ${cliPackageDst}`,
  );
  const cliPackage = copyFileWithStats(CLI_PACKAGE_JSON, cliPackageDst, {
    dryRun,
  });

  let cliNodeModules = { files: 0, bytes: 0, skipped: 0 };
  if (includeRuntimeDependencies) {
    log(
      `[vendor] ${dryRun ? "(dry-run) " : ""}deps : ${cliNodeModulesSource} -> ${cliNodeModulesDst}`,
    );
    cliNodeModules = copyTree(cliNodeModulesSource, cliNodeModulesDst, {
      dryRun,
      excludedNames: CLI_NODE_MODULES_EXCLUDES,
      droppedPaths: new Set(),
      excludeEntry: (entry) =>
        entry.isFile() && entry.name.endsWith(".test.js"),
      rejectSpecialEntries: true,
    });
    log(
      `[vendor] ${dryRun ? "(dry-run) " : ""}deps : ${cliNodeModules.files} files, ${formatBytes(cliNodeModules.bytes)}, skipped ${cliNodeModules.skipped}`,
    );
  }

  log(
    `[vendor] ${dryRun ? "(dry-run) " : ""}panel: ${WEB_PANEL_DIST} -> ${webPanelDst}`,
  );
  const webPanel = copyTree(WEB_PANEL_DIST, webPanelDst, { dryRun });
  log(
    `[vendor] ${dryRun ? "(dry-run) " : ""}panel: ${webPanel.files} files, ${formatBytes(webPanel.bytes)}, skipped ${webPanel.skipped}`,
  );

  const totalFiles =
    cli.files + cliPackage.files + cliNodeModules.files + webPanel.files;
  const totalBytes =
    cli.bytes + cliPackage.bytes + cliNodeModules.bytes + webPanel.bytes;
  log(
    `[vendor] ${dryRun ? "(dry-run) " : ""}TOTAL: ${totalFiles} files, ${formatBytes(totalBytes)}`,
  );

  return {
    cli,
    cliPackage,
    cliNodeModules,
    webPanel,
    totalFiles,
    totalBytes,
  };
}

/**
 * Exercise the exact ESM entry that the packaged Desktop PTY policy loader
 * imports. This is intentionally a real dynamic import, not a path-only check.
 *
 * @param {string} buildPath Resources/ directory containing packages/cli
 * @returns {Promise<{ modulePath: string, exportName: string }>}
 */
async function verifyVendoredPluginBinRuntime(buildPath) {
  const cliRoot = path.join(buildPath, "packages", "cli");
  const packagePath = path.join(cliRoot, "package.json");
  const modulePath = path.join(
    cliRoot,
    "src",
    "lib",
    "plugin-runtime",
    "bin.js",
  );
  const exportName = "collectWorkspacePluginBinSandboxPolicy";

  try {
    const cliPackage = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    if (cliPackage.type !== "module") {
      throw new Error(`${packagePath} must declare "type": "module"`);
    }
    const pluginBin = await import(pathToFileURL(modulePath).href);
    if (typeof pluginBin?.[exportName] !== "function") {
      throw new TypeError(`${exportName} export is unavailable`);
    }
  } catch (cause) {
    const error = new Error(
      `vendored CLI Plugin-bin runtime import failed at ${modulePath}: ${cause.message}`,
      { cause },
    );
    error.code = "ERR_FORGE_VENDOR_RUNTIME_IMPORT";
    throw error;
  }

  return { modulePath, exportName };
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

module.exports = {
  vendorWebShellInto,
  verifyVendoredPluginBinRuntime,
  REPO_ROOT,
  CLI_ROOT,
  CLI_SRC,
  CLI_PACKAGE_JSON,
  CLI_NODE_MODULES,
  WEB_PANEL_DIST,
};

// CLI entry point — run with: node scripts/prepare-web-shell-vendor.js [--dry-run] [--target=<path>]
if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const targetArg = args.find((a) => a.startsWith("--target="));
  const target = targetArg
    ? path.resolve(targetArg.slice("--target=".length))
    : path.join(__dirname, "..", ".web-shell-vendor");

  void (async () => {
    console.log(`[vendor] target: ${target}`);
    console.log(`[vendor] dryRun: ${dryRun}`);
    try {
      vendorWebShellInto(target, { dryRun });
      if (!dryRun) {
        await verifyVendoredPluginBinRuntime(target);
      }
      console.log("[vendor] DONE");
    } catch (err) {
      console.error(`[vendor] FAIL: ${err.message}`);
      process.exitCode = 1;
    }
  })();
}
