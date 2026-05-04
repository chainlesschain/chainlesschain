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

  // ---------------------------------------------------------------------
  // Copy packages/cli + packages/web-panel/dist into resources/packages/
  // so web-shell loaders can resolve the sibling-app paths they expect:
  //   __dirname + "../../../../packages/cli/src/lib/web-ui-server.js"
  // (web-ui-loader.js, ws-cli-loader.js).
  //
  // Done here in afterPack instead of via electron-builder.yml `extraResources`
  // because v5.0.3.17 saw NSIS Setup.exe install failures (exit 2 / 闪退)
  // when extraResources copied ~50 MB of cli sources — apparently triggered
  // some NSIS path-length or file-count edge case. afterPack copy lands in
  // appOutDir/resources/packages/ which NSIS just zips wholesale, no
  // glob-walking gymnastics on the NSIS side.
  // ---------------------------------------------------------------------
  const repoRoot = path.resolve(__dirname, "..", "..");
  const targetResources = path.join(appOutDir, "resources");
  const targetPackages = path.join(targetResources, "packages");

  function copyTree(src, dest, label) {
    if (!fs.existsSync(src)) {
      throw new Error(`${tag} source not found: ${src} (${label})`);
    }
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true, dereference: false });
    console.log(
      `${tag} copied ${label} → ${path.relative(targetResources, dest)}`,
    );
  }

  copyTree(
    path.join(repoRoot, "packages", "cli", "src"),
    path.join(targetPackages, "cli", "src"),
    "packages/cli/src",
  );
  copyTree(
    path.join(repoRoot, "packages", "cli", "bin"),
    path.join(targetPackages, "cli", "bin"),
    "packages/cli/bin",
  );
  fs.mkdirSync(path.join(targetPackages, "cli"), { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, "packages", "cli", "package.json"),
    path.join(targetPackages, "cli", "package.json"),
  );
  console.log(`${tag} copied packages/cli/package.json`);

  copyTree(
    path.join(repoRoot, "packages", "web-panel", "dist"),
    path.join(targetPackages, "web-panel", "dist"),
    "packages/web-panel/dist",
  );
  fs.mkdirSync(path.join(targetPackages, "web-panel"), { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, "packages", "web-panel", "package.json"),
    path.join(targetPackages, "web-panel", "package.json"),
  );
  console.log(`${tag} copied packages/web-panel/package.json`);

  // Final sanity: paths that web-shell loaders specifically need.
  const REQUIRED_PATHS = [
    path.join(targetPackages, "cli", "src", "gateways", "ws", "ws-server.js"),
    path.join(targetPackages, "cli", "src", "lib", "web-ui-server.js"),
    path.join(targetPackages, "web-panel", "dist", "index.html"),
  ];
  const missingPaths = REQUIRED_PATHS.filter((p) => !fs.existsSync(p));
  if (missingPaths.length) {
    throw new Error(
      `${tag} required web-shell paths missing: ${missingPaths.map((p) => path.relative(targetResources, p)).join(", ")}`,
    );
  }
  console.log(`${tag} web-shell required paths all present`);

  const elapsed = Math.round((Date.now() - start) / 1000);
  console.log(
    `${tag} done in ${elapsed}s — sanity check passed (${SANITY_CHECK_PKGS.length} key packages verified at top-level)`,
  );
};
