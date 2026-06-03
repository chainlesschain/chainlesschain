/**
 * Post-pack ASAR surgery: inject walker-dropped packages back into app.asar
 * at top-level node_modules/, preserving electron-builder's original unpack
 * decisions for native-binary directories.
 *
 * Why this exists (issue #8 / desktop_release_npm_workspace_hoisting.md):
 *   electron-builder's prod-dep walker independently drops 4 packages from
 *   its file manifest, even on a flat dev tree:
 *
 *     - call-bind-apply-helpers (only nested under call-bind/node_modules/)
 *     - side-channel-list, side-channel-map, side-channel-weakmap (only
 *       nested under side-channel/node_modules/)
 *
 *   `dunder-proto`'s `require('call-bind-apply-helpers')` from inside the
 *   asar walks `\node_modules\dunder-proto\node_modules\<x>\` (no) →
 *   `\node_modules\<x>\` (NOT in asar — only nested under call-bind/) → ENOENT.
 *
 *   asarUnpack glob doesn't fix this — it can only mark files-already-in-walker's-manifest
 *   for unpacking, not add new top-level entries (issue #6 empirical refutation).
 *
 *   So: surgery on the asar after walker is done. Extract → inject → repack.
 *
 * Unpack-decision preservation (2026-05-06):
 *   `@electron/asar.createPackageWithOptions`'s `unpack` glob is matched
 *   against the ABSOLUTE filename via `minimatch(filename, glob, { matchBase: true })`.
 *   Patterns containing '/' bypass matchBase and try literal match against
 *   the absolute path — on Windows the backslash separator means `**\/*.node`
 *   never matches `C:\stage\node_modules\foo\native.node`. A naive `**\/*.node`
 *   loses ALL unpacked files because of this bug.
 *
 *   Fix: scan the physical app.asar.unpacked/ tree BEFORE we delete it,
 *   collect every IMMEDIATE PARENT DIRECTORY of a file found, normalize to
 *   POSIX-style relative paths, pass that set as a brace-expanded `unpackDir`
 *   glob to the repack call. This preserves electron-builder's own auto-unpack
 *   decisions (native binaries + their package dirs like koffi, chromadb,
 *   classic-level, onnxruntime-node, etc.) as well as anything copied in via
 *   extraResources/asarUnpack — both ground-truth as physical files on disk.
 *
 * @electron/asar in-process cache:
 *   `asar.listPackage` and `extractAll` populate a per-archive-path metadata
 *   cache. After we delete + repack at the same path, that cache is stale.
 *   Call `asar.uncache(asarPath)` before listPackage to force a fresh read,
 *   otherwise the post-repack verification gate sees the pre-injection header
 *   and fails. Production builds were unaffected (each is a fresh process)
 *   but tests in a long-lived vitest process reproduced reliably.
 *
 * Integrity caveat:
 *   Electron's `EnableEmbeddedAsarIntegrityValidation` fuse is macOS-only
 *   today (per Electron docs). On Windows, post-surgery hash mismatch is
 *   not enforced at startup. When the fuse becomes Windows-enforced we'll
 *   need a Phase 2 follow-up: either patch electron.exe's embedded hash, or
 *   keep integrity off via @electron/fuses post-build patch.
 */

const fs = require("fs");
const path = require("path");
const asar = require("@electron/asar");

const WALKER_DROPPED_PKGS = [
  "call-bind-apply-helpers",
  "side-channel-list",
  "side-channel-map",
  "side-channel-weakmap",
];

// Defensive: if the wrapper's chainlesschain top-level link detach didn't
// run (e.g. wrapper version updated mid-build, original asar still contains
// `node_modules/chainlesschain/...` with thousands of repo-root files like
// .chainlesschain/agent-scripts), strip the entire subtree from stage
// before repack. Nothing in src/{main,renderer} actually requires it.
const STAGE_STRIP_PATHS = [path.join("node_modules", "chainlesschain")];

const tag = "[asar-surgery]";

function isAsarBuild(appOutDir) {
  return fs.existsSync(path.join(appOutDir, "resources", "app.asar"));
}

/**
 * Walk a physical `app.asar.unpacked/` directory tree and collect the
 * IMMEDIATE PARENT DIRECTORY of every file found, normalized to POSIX-style
 * relative paths suitable for `unpackDir` glob.
 *
 * Why parent dirs and not individual files: `unpackDir` matches directories,
 * and electron-builder's auto-unpack heuristic typically puts ALL files of a
 * native-deps package into .unpacked/ (e.g. all of `node_modules/koffi/`),
 * not just .node files. Capturing parent dirs round-trips electron-builder's
 * decisions whether they came from header `unpacked: true` markers or from
 * extraResources/asarUnpack copying files in directly.
 *
 * Returns a sorted array of forward-slash relative paths (e.g.
 * "node_modules/koffi", "node_modules/@img/sharp-win32-x64/lib").
 */
function collectUnpackedDirsFromDisk(unpackedRoot) {
  if (!fs.existsSync(unpackedRoot)) return [];

  const dirs = new Set();
  function walk(absDir) {
    const entries = fs.readdirSync(absDir, { withFileTypes: true });
    let hasFile = false;
    for (const ent of entries) {
      const full = path.join(absDir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile() || ent.isSymbolicLink()) {
        hasFile = true;
      }
    }
    if (hasFile) {
      const rel = path.relative(unpackedRoot, absDir).split(path.sep).join("/");
      // rel === "" means files at the root of .unpacked — unusual, but handle.
      dirs.add(rel || ".");
    }
  }
  walk(unpackedRoot);
  return [...dirs].sort();
}

/**
 * Build a brace-expanded `unpackDir` glob from a list of relative paths.
 * Empty input → returns null (nothing to unpack).
 *
 * Example: ["node_modules/koffi", "node_modules/chromadb"] →
 *   "{node_modules/koffi,node_modules/chromadb}"
 *
 * minimatch handles brace expansion natively, so this single string can
 * match multiple distinct directory paths.
 */
function buildUnpackDirGlob(paths) {
  if (!paths.length) return null;
  if (paths.length === 1) return paths[0];
  return "{" + paths.join(",") + "}";
}

/**
 * Run ASAR surgery on the given appOutDir. No-op if not an asar build.
 *
 * @param {object} ctx
 * @param {string} ctx.appOutDir - e.g. <project>/out/build/win-unpacked
 * @param {string} ctx.sourceNm - absolute path to desktop-app-vue/node_modules
 */
async function runSurgery({ appOutDir, sourceNm }) {
  if (!isAsarBuild(appOutDir)) {
    console.log(
      `${tag} no app.asar found in ${appOutDir}/resources/ — asar:false layout, skipping`,
    );
    return;
  }

  const asarPath = path.join(appOutDir, "resources", "app.asar");
  const unpackedDir = path.join(appOutDir, "resources", "app.asar.unpacked");
  const stage = path.join(appOutDir, "resources", ".asar-stage");

  const start = Date.now();

  // STEP 1: Snapshot original electron-builder unpack decisions by walking
  // the physical app.asar.unpacked/ tree BEFORE we delete it. Drives the
  // repack's unpackDir glob so files originally unpacked stay unpacked.
  console.log(`${tag} scanning ${unpackedDir} for unpack decisions`);
  const originalUnpackedDirs = collectUnpackedDirsFromDisk(unpackedDir);
  const unpackDirGlob = buildUnpackDirGlob(originalUnpackedDirs);
  console.log(`${tag} original unpacked dirs: ${originalUnpackedDirs.length}`);
  if (originalUnpackedDirs.length) {
    for (const d of originalUnpackedDirs) console.log(`${tag}   - ${d}`);
  }

  // STEP 2: Extract original asar to staging.
  console.log(`${tag} extracting ${asarPath} → ${stage}`);
  if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
  asar.extractAll(asarPath, stage);

  // STEP 3: Merge existing app.asar.unpacked/ files into stage. Files in
  // .unpacked/ are NOT inside the asar (only header markers point at them),
  // so extractAll alone misses them.
  if (fs.existsSync(unpackedDir)) {
    console.log(`${tag} merging ${unpackedDir} → ${stage}`);
    fs.cpSync(unpackedDir, stage, {
      recursive: true,
      preserveTimestamps: true,
    });
  }

  // STEP 4: Inject the 4 walker-dropped packages into stage's top-level
  // node_modules/.
  const stageNm = path.join(stage, "node_modules");
  if (!fs.existsSync(stageNm)) fs.mkdirSync(stageNm, { recursive: true });

  for (const pkgName of WALKER_DROPPED_PKGS) {
    const src = path.join(sourceNm, pkgName);
    const dst = path.join(stageNm, pkgName);

    if (!fs.existsSync(src)) {
      throw new Error(
        `${tag} source missing: ${src} — desktop-app-vue/node_modules must contain all prod deps before packaging`,
      );
    }

    if (fs.existsSync(dst)) {
      fs.rmSync(dst, { recursive: true, force: true });
    }

    fs.cpSync(src, dst, {
      recursive: true,
      dereference: true,
      preserveTimestamps: true,
    });
    console.log(`${tag} injected node_modules/${pkgName}`);
  }

  // STEP 5: Defensive strip — remove paths that should never ship even if
  // they leaked into the original asar (e.g. chainlesschain repo-root link
  // when the wrapper detach didn't run).
  for (const rel of STAGE_STRIP_PATHS) {
    const target = path.join(stage, rel);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
      console.log(`${tag} stripped from stage: ${rel}`);
    }
  }

  // STEP 6: Delete original asar + .unpacked/ — repack will recreate.
  fs.rmSync(asarPath, { force: true });
  if (fs.existsSync(unpackedDir)) {
    fs.rmSync(unpackedDir, { recursive: true, force: true });
  }

  // STEP 7: Repack with unpackDir matching electron-builder's original decisions.
  console.log(
    `${tag} repacking stage → ${asarPath} (unpackDir: ${unpackDirGlob || "<none>"})`,
  );
  const repackOpts = {};
  if (unpackDirGlob) repackOpts.unpackDir = unpackDirGlob;
  await asar.createPackageWithOptions(stage, asarPath, repackOpts);

  // STEP 8: Verification gate — the 4 walker-dropped packages MUST appear
  // at top-level in the new asar header. asar.listPackage uses OS-native
  // path separator, so check both '/' and '\' forms.
  //
  // CRITICAL: @electron/asar has an in-process filesystem cache keyed by
  // archive path (lib/disk.js readFilesystemSync). STEP 2's extractAll
  // populated that cache with the PRE-surgery header; createPackageWithOptions
  // does NOT update it. Without an explicit uncache, listPackage returns
  // the stale entries (no walker-dropped pkgs) → verification ALWAYS fails,
  // regardless of process freshness. Surfaced by asar-surgery.test.js (#8).
  asar.uncache(asarPath);
  const entries = asar.listPackage(asarPath, {});
  const missing = [];
  for (const pkgName of WALKER_DROPPED_PKGS) {
    const posix = `/node_modules/${pkgName}/package.json`;
    const win = `\\node_modules\\${pkgName}\\package.json`;
    if (!entries.includes(posix) && !entries.includes(win)) {
      missing.push(pkgName);
    }
  }
  if (missing.length) {
    throw new Error(
      `${tag} repack VERIFICATION FAILED — top-level entries not in new asar: ${missing.join(", ")}`,
    );
  }
  console.log(
    `${tag} verification passed — ${WALKER_DROPPED_PKGS.length} walker-dropped packages confirmed at top-level`,
  );

  // STEP 9: Sanity-check chainlesschain bloat is gone (defensive strip should have worked).
  const chainBloat = entries.filter(
    (e) =>
      e.startsWith("\\node_modules\\chainlesschain\\") ||
      e.startsWith("/node_modules/chainlesschain/"),
  );
  if (chainBloat.length > 5) {
    // <= 5 would just be package.json + a few entries; >5 means the strip didn't catch full bloat
    console.warn(
      `${tag} WARNING: ${chainBloat.length} chainlesschain entries still in asar after strip — investigate STAGE_STRIP_PATHS`,
    );
  }

  // STEP 10: Cleanup stage.
  fs.rmSync(stage, { recursive: true, force: true });

  const elapsed = Math.round((Date.now() - start) / 1000);
  console.log(`${tag} done in ${elapsed}s`);
}

module.exports = {
  runSurgery,
  WALKER_DROPPED_PKGS,
  STAGE_STRIP_PATHS,
  collectUnpackedDirsFromDisk,
  buildUnpackDirGlob,
};
