/**
 * electron-builder afterPack hook — NUCLEAR OPTION (with prune + platform filter).
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
 * NUCLEAR FIX: REPLACE the entire `appOutDir/resources/app/node_modules/`
 * with a verbatim copy of `desktop-app-vue/node_modules/`. Whatever
 * electron-builder did is overwritten wholesale.
 *
 * v5.0.3.21+ refinement (slow-install fix):
 *   The "几百 MB" trade-off was ~2.35 GB / 124k files in practice. With
 *   asar:false (now active) those 124k files ship loose into the NSIS
 *   installer, which is the dominant cause of slow installs (per-file NTFS
 *   metadata + Defender scan + LZMA dict reset). We can't drop nuclear-
 *   replace without re-introducing the walker bugs, BUT we can skip:
 *
 *     (1) Top-level devDependencies declared in package.json (~216 MB,
 *         ~16.5k files). Pure dev — nothing in src/main requires them at
 *         runtime. Transitive deps that npm hoisted to top-level remain;
 *         only the devDeps we explicitly listed are filtered out.
 *
 *     (2) Per-platform native binaries for non-target platforms (~190 MB
 *         on Windows). E.g. @nomicfoundation/edr-linux-* and
 *         @nomicfoundation/edr-darwin-* are useless inside a Windows
 *         installer.
 *
 *   Both filters are applied via fs.cpSync's `filter` callback, so the
 *   source tree is untouched (dev unaffected).
 */

const fs = require("fs");
const path = require("path");

// Read declared devDependencies once. These are top-level packages that the
// runtime (src/main) does not require — Vite bundles renderer-side ones
// (vue, ant-design-vue, pinia, etc.) into dist/, and tools like electron,
// electron-builder, vitest, hardhat are obviously not runtime deps.
const SOURCE_PKG = require(path.resolve(__dirname, "..", "package.json"));
const DEV_DEP_SET = new Set(Object.keys(SOURCE_PKG.devDependencies || {}));

// Override: a few packages are listed in devDependencies but are actually
// required by built dist/main code at runtime. Verified by grepping dist/
// for `require("<pkg>")` against the devDep keyset (2026-05-05). These
// MUST stay in the bundled node_modules even though they're "dev" by the
// package.json classification.
//
//   better-sqlite3  fallback when better-sqlite3-multiple-ciphers (the
//                   encrypted, prod-listed variant) fails to load. Also
//                   directly required (no fallback) by file-integrity.js
//                   and identity-context-manager.js.
//   electron        Resolved to Electron's built-in module at runtime, not
//                   from node_modules — but keep the npm copy as cheap
//                   insurance against unusual module-resolution paths.
//   jsdom           Required by file-ipc.js for Word document preview.
//                   No fallback.
//   glob            In devDependencies but also reachable through the prod
//                   chain transitively (npm dedupe hoists one copy to
//                   top-level, used by both). Verified via package-lock.json
//                   BFS — see scripts/find-renderer-only-deps.js companion
//                   probe. Filtering this would break prod transitives.
const RUNTIME_OVERRIDE_KEEP = new Set([
  "better-sqlite3",
  "electron",
  "jsdom",
  "glob",
]);

// Per-platform native binaries to drop when building for a different platform.
// Keys are the package paths under node_modules/. Values are the platform
// they target (matched against context.electronPlatformName: "win32" |
// "darwin" | "linux"). Anything not matching the build target is dropped.
//
// Keep this list explicit — generic regex matching could swallow unrelated
// packages whose name happens to contain a platform substring.
const PER_PLATFORM_NATIVES = {
  "@nomicfoundation/edr-linux-x64-gnu": "linux",
  "@nomicfoundation/edr-linux-x64-musl": "linux",
  "@nomicfoundation/edr-linux-arm64-gnu": "linux",
  "@nomicfoundation/edr-linux-arm64-musl": "linux",
  "@nomicfoundation/edr-darwin-x64": "darwin",
  "@nomicfoundation/edr-darwin-arm64": "darwin",
  "@nomicfoundation/edr-win32-x64-msvc": "win32",
  "@nomicfoundation/solidity-analyzer-linux-x64-gnu": "linux",
  "@nomicfoundation/solidity-analyzer-linux-x64-musl": "linux",
  "@nomicfoundation/solidity-analyzer-linux-arm64-gnu": "linux",
  "@nomicfoundation/solidity-analyzer-linux-arm64-musl": "linux",
  "@nomicfoundation/solidity-analyzer-darwin-x64": "darwin",
  "@nomicfoundation/solidity-analyzer-darwin-arm64": "darwin",
  "@nomicfoundation/solidity-analyzer-win32-x64-msvc": "win32",
};

/**
 * Given a path relative to node_modules/ (forward-slash normalized), return
 * the top-level package name: "foo", "foo/sub" or "@scope/pkg".
 * Returns null for the empty string (root of node_modules itself).
 */
function topLevelPkg(relUnix) {
  if (!relUnix) return null;
  const parts = relUnix.split("/");
  if (parts[0].startsWith("@")) {
    if (parts.length < 2) return null; // bare scope dir
    return parts[0] + "/" + parts[1];
  }
  return parts[0];
}

exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName } = context;
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

  console.log(
    `${tag} replacing ${targetNm} with verbatim copy of ${sourceNm} (platform=${electronPlatformName})`,
  );
  const start = Date.now();

  if (fs.existsSync(targetNm)) {
    fs.rmSync(targetNm, { recursive: true, force: true });
  }

  // Track skipped packages for reporting. We only count each top-level
  // package once (not every file inside it).
  const skippedDevDeps = new Set();
  const skippedForeignPlatforms = new Set();

  // dereference: true is REQUIRED on Windows — npm workspaces install
  // `@chainlesschain/{core-mtc,session-core}` (declared as `file:../packages/*`
  // in package.json) as directory symlinks, and cpSync with dereference:false
  // tries to recreate them at the destination, which Windows rejects with
  // EPERM unless the user has Developer Mode or admin privileges. For a
  // shippable installer we want the actual package contents inlined anyway —
  // a symlink pointing back to the user's source tree obviously can't ship.
  // Verified safe (2026-05-05): packages/{core-mtc,session-core} have no
  // nested node_modules/, so no risk of dereference recursion bloat.
  fs.cpSync(sourceNm, targetNm, {
    recursive: true,
    dereference: true,
    preserveTimestamps: true,
    filter: (src) => {
      // src is absolute. Normalize to forward-slash relative path.
      const rel = path.relative(sourceNm, src).split(path.sep).join("/");
      const top = topLevelPkg(rel);
      if (!top) return true; // root + scope dirs (handled by their children)

      // Only act at the top-level package boundary. Once we descend into a
      // package, copy everything inside it.
      const isPkgRoot = rel === top;

      if (DEV_DEP_SET.has(top) && !RUNTIME_OVERRIDE_KEEP.has(top)) {
        if (isPkgRoot) skippedDevDeps.add(top);
        return false;
      }

      const targetPlatform = PER_PLATFORM_NATIVES[top];
      if (targetPlatform && targetPlatform !== electronPlatformName) {
        if (isPkgRoot) skippedForeignPlatforms.add(top);
        return false;
      }

      return true;
    },
  });

  // Sanity check the 10 known-problematic packages survived at top-level.
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
  console.log(
    `${tag} skipped ${skippedDevDeps.size} devDependencies + ${skippedForeignPlatforms.size} foreign-platform natives`,
  );
  if (skippedDevDeps.size) {
    console.log(`${tag}   devDeps: ${[...skippedDevDeps].sort().join(", ")}`);
  }
  if (skippedForeignPlatforms.size) {
    console.log(
      `${tag}   foreign natives: ${[...skippedForeignPlatforms].sort().join(", ")}`,
    );
  }
};
