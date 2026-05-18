/**
 * prepare-web-shell-vendor.js — Phase 1.4 packaging prep (2026-04-30).
 *
 * Standalone, idempotent helper that copies the two source trees the
 * embedded web-shell needs INTO a target build directory:
 *
 *   <root>/packages/cli/src      → <buildPath>/packages/cli/src
 *   <root>/packages/web-panel/dist → <buildPath>/packages/web-panel/dist
 *
 * After this runs, the existing relative-path constants in
 * `desktop-app-vue/src/main/web-shell/{web-ui-loader,ws-cli-loader,
 *  handlers/skill-list-handler}.js` resolve correctly because the path
 * `../../../../packages/cli/...` from `<buildPath>/dist/main/web-shell/`
 * lands at `<buildPath>/packages/cli/...`. No code changes needed in the
 * loaders themselves.
 *
 * Excluded from the cli/src copy:
 *   - assets/web-panel/  — duplicates web-panel/dist (cc pack bundle).
 *                          Web-shell explicitly passes staticDir to
 *                          web-ui-server so the bundled fallback is
 *                          unreachable; saves ~3.4 MB.
 *
 * The 13 MB cli/src + 3.4 MB web-panel/dist totals ~16 MB net vendor.
 *
 * ─────────────────────────────────────────────────────────────────────
 * HOW TO WIRE THIS INTO PACKAGING (Phase 1.4 next-session checklist)
 * ─────────────────────────────────────────────────────────────────────
 *
 * 1. forge.config.js, inside `packageAfterCopy` AFTER the existing
 *    `copyMissing(rootNodeModules, buildNodeModules)` block (so node_modules
 *    is settled first):
 *
 *        const { vendorWebShellInto } =
 *          require("./scripts/prepare-web-shell-vendor.js");
 *        // CRITICAL: vendor target is the PARENT of buildPath, NOT buildPath.
 *        // The web-shell loaders' REL constants (`../../../../packages/...`)
 *        // resolve 4-up from `<buildPath>/dist/main/web-shell/` = parent of
 *        // buildPath = Resources/. If we vendor into buildPath itself, 4-up
 *        // overshoots and lands at <Resources>/packages/... (empty), so the
 *        // loaders ENOENT at startup.
 *        const path = require("path");
 *        vendorWebShellInto(path.join(buildPath, ".."));
 *
 * 2. forge.config.js packagerConfig.asar — extend the unpack glob so the
 *    vendored ESM files live as real files on disk (Electron's asar fs
 *    shim does NOT cover Node's URL-based ESM loader, so dynamic import
 *    via pathToFileURL of an in-asar path silently fails):
 *
 *        asar: {
 *          unpack: "{*.{node,dll,dylib,so,exe},packages/**}",
 *        },
 *
 * 3. After `npm run make:win`, verify the produced bundle:
 *
 *        out/build/.../Resources/packages/cli/src/lib/web-ui-server.js
 *        out/build/.../Resources/packages/web-panel/dist/index.html
 *
 *    Both must exist as real files. Because the vendor target is now
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

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLI_SRC = path.join(REPO_ROOT, "packages", "cli", "src");
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

/** @typedef {{ files: number, bytes: number, skipped: number }} CopyStats */

/**
 * Recursively copy `src` into `dst`, applying excludes. Returns counters.
 *
 * @param {string} src
 * @param {string} dst
 * @param {{ dryRun?: boolean, relRoot?: string }} [options]
 * @returns {CopyStats}
 */
function copyTree(src, dst, options = {}) {
  const { dryRun = false, relRoot = "" } = options;
  const stats = { files: 0, bytes: 0, skipped: 0 };

  if (!fs.existsSync(src)) {
    throw new Error(`source does not exist: ${src}`);
  }

  if (!dryRun) {
    fs.mkdirSync(dst, { recursive: true });
  }

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const name = entry.name;
    if (CLI_SRC_EXCLUDES.has(name)) {
      stats.skipped++;
      continue;
    }
    const rel = relRoot ? `${relRoot}/${name}` : name;
    if (CLI_SRC_TOP_LEVEL_DROP.has(rel)) {
      stats.skipped++;
      continue;
    }

    const srcPath = path.join(src, name);
    const dstPath = path.join(dst, name);

    if (entry.isDirectory()) {
      const sub = copyTree(srcPath, dstPath, { dryRun, relRoot: rel });
      stats.files += sub.files;
      stats.bytes += sub.bytes;
      stats.skipped += sub.skipped;
    } else if (entry.isFile()) {
      const size = fs.statSync(srcPath).size;
      stats.files++;
      stats.bytes += size;
      if (!dryRun) {
        fs.copyFileSync(srcPath, dstPath);
      }
    } else {
      // Symlinks, sockets, etc. — don't try to copy.
      stats.skipped++;
    }
  }

  return stats;
}

/**
 * Vendor the cli/src + web-panel/dist trees into `buildPath`. Idempotent —
 * subsequent runs overwrite files in place.
 *
 * @param {string} buildPath
 *   Absolute path of the desktop-app-vue copy that forge stages before asar.
 *   (In packageAfterCopy this is the second hook arg.)
 * @param {{ dryRun?: boolean, log?: (msg: string) => void }} [options]
 * @returns {{ cli: CopyStats, webPanel: CopyStats, totalBytes: number }}
 */
function vendorWebShellInto(buildPath, options = {}) {
  const { dryRun = false, log = console.log } = options;

  if (!buildPath || typeof buildPath !== "string") {
    throw new TypeError("vendorWebShellInto: buildPath must be a string");
  }
  if (!fs.existsSync(CLI_SRC)) {
    throw new Error(`cli source not found at ${CLI_SRC}`);
  }
  if (!fs.existsSync(path.join(WEB_PANEL_DIST, "index.html"))) {
    throw new Error(
      `web-panel dist not found at ${WEB_PANEL_DIST}. ` +
        "Run `npm run build` in packages/web-panel first.",
    );
  }

  const cliDst = path.join(buildPath, "packages", "cli", "src");
  const webPanelDst = path.join(buildPath, "packages", "web-panel", "dist");

  log(`[vendor] ${dryRun ? "(dry-run) " : ""}cli  : ${CLI_SRC} -> ${cliDst}`);
  const cli = copyTree(CLI_SRC, cliDst, { dryRun });
  log(
    `[vendor] ${dryRun ? "(dry-run) " : ""}cli  : ${cli.files} files, ${formatBytes(cli.bytes)}, skipped ${cli.skipped}`,
  );

  log(
    `[vendor] ${dryRun ? "(dry-run) " : ""}panel: ${WEB_PANEL_DIST} -> ${webPanelDst}`,
  );
  const webPanel = copyTree(WEB_PANEL_DIST, webPanelDst, { dryRun });
  log(
    `[vendor] ${dryRun ? "(dry-run) " : ""}panel: ${webPanel.files} files, ${formatBytes(webPanel.bytes)}, skipped ${webPanel.skipped}`,
  );

  const totalBytes = cli.bytes + webPanel.bytes;
  log(
    `[vendor] ${dryRun ? "(dry-run) " : ""}TOTAL: ${cli.files + webPanel.files} files, ${formatBytes(totalBytes)}`,
  );

  return { cli, webPanel, totalBytes };
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

module.exports = {
  vendorWebShellInto,
  REPO_ROOT,
  CLI_SRC,
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

  console.log(`[vendor] target: ${target}`);
  console.log(`[vendor] dryRun: ${dryRun}`);
  try {
    vendorWebShellInto(target, { dryRun });
    console.log("[vendor] DONE");
  } catch (err) {
    console.error(`[vendor] FAIL: ${err.message}`);
    process.exit(1);
  }
}
