/**
 * electron-builder afterPack hook — NUCLEAR OPTION.
 *
 * v5.0.3.4-14 saga: electron-builder's prod-dep walker creates a malformed
 * node_modules tree in the bundle (private nested copies, missing top-level
 * counterparts, etc.). Symptom: app crashes at startup with `Cannot find
 * module 'X'` where X varies (`call-bind-apply-helpers`, then `merge-descriptors`,
 * then probably more if we whack-mole package by package).
 *
 * Past attempts (all FAILED to fully fix):
 *   v5.0.3.7  — lockfile sync + robocopy fallback
 *   v5.0.3.8-11 — `npm install --workspaces=false` flat install pre-pack
 *   v5.0.3.12 — extraResources to app.asar.unpacked/
 *   v5.0.3.13 — asar: false (didn't help — dedupe is at file-selection time)
 *   v5.0.3.14 — afterPack hook promoting 7 hardcoded packages to top-level
 *               (call-bind-apply-helpers fixed; merge-descriptors still broken)
 *
 * Root cause: electron-builder's walker is fundamentally incompatible with
 * how `desktop-app-vue` resolves deps in dev. We can't enumerate every
 * affected package — there are too many transitive chains.
 *
 * NUCLEAR FIX: REPLACE the entire `appOutDir/resources/app/node_modules/`
 * with a verbatim copy of `desktop-app-vue/node_modules/` (which the CI
 * merge step has already populated with the complete prod tree). This
 * guarantees the bundled tree is byte-identical to the dev tree that the
 * user knows works. Whatever electron-builder did is overwritten wholesale.
 *
 * Trade-offs accepted (per user "几百MB没问题"):
 *   - Larger install size (devDeps included)
 *   - Slightly slower NSIS packaging (more files)
 *
 * Build-time trade-offs:
 *   - afterPack runs on each platform's runner, copying ~3-4 GB of files
 *   - Adds ~30-60s per platform to CI time
 */

const fs = require("fs");
const path = require("path");

exports.default = async function afterPack(context) {
  const { appOutDir } = context;
  const tag = "[after-pack:nuclear-replace]";

  const sourceNm = path.resolve(__dirname, "..", "node_modules");
  const targetAppRoot = path.join(appOutDir, "resources", "app");
  const targetNm = path.join(targetAppRoot, "node_modules");

  if (!fs.existsSync(sourceNm)) {
    throw new Error(
      `${tag} source not found: ${sourceNm}. CI merge step must populate desktop-app-vue/node_modules/ before electron-builder runs.`,
    );
  }

  if (!fs.existsSync(targetAppRoot)) {
    console.log(
      `${tag} ${targetAppRoot} not found — assuming asar:true layout, skipping`,
    );
    return;
  }

  console.log(`${tag} replacing ${targetNm} with verbatim copy of ${sourceNm}`);
  const start = Date.now();

  if (fs.existsSync(targetNm)) {
    fs.rmSync(targetNm, { recursive: true, force: true });
  }

  fs.cpSync(sourceNm, targetNm, {
    recursive: true,
    dereference: false,
    preserveTimestamps: true,
  });

  // Sanity check the 7 known-problematic packages survived at top-level.
  const SANITY_CHECK_PKGS = [
    "call-bind-apply-helpers",
    "dunder-proto",
    "get-proto",
    "math-intrinsics",
    "merge-descriptors",
    "side-channel-list",
    "side-channel-map",
    "side-channel-weakmap",
    "express",
    "qs",
  ];
  const missing = SANITY_CHECK_PKGS.filter(
    (pkg) => !fs.existsSync(path.join(targetNm, pkg, "package.json")),
  );
  if (missing.length) {
    throw new Error(
      `${tag} sanity check FAILED — missing top-level: ${missing.join(", ")}. Verify desktop-app-vue/node_modules/ has all prod deps before packaging.`,
    );
  }

  // NOTE: packages/cli + packages/web-panel/dist are NOT copied here.
  // electron-builder snapshots the file manifest BEFORE afterPack runs,
  // so new paths added at this stage get DROPPED by NSIS/Portable target
  // packaging. v5.0.3.18 confirmed: afterPack copied them successfully
  // to win-unpacked/resources/packages/ (visible in CI log) but the final
  // installer artifact had no resources/packages/ directory.
  //
  // Solution: declared via electron-builder.yml `extraResources`. Those
  // paths ARE in the manifest, so the contents reach the final installer.
  // node_modules nuclear-replace works in afterPack because electron-builder
  // walked node_modules/ itself, registering each path in the manifest;
  // afterPack just rewrites the file contents at registered paths.

  const elapsed = Math.round((Date.now() - start) / 1000);
  console.log(
    `${tag} done in ${elapsed}s — sanity check passed (${SANITY_CHECK_PKGS.length} key packages verified at top-level)`,
  );
};
