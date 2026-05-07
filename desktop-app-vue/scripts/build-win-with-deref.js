#!/usr/bin/env node
/**
 * Wrapper around `electron-builder --win` that handles the workspace-symlink
 * trap unique to `asar: true` mode.
 *
 * Why this exists:
 *   `desktop-app-vue/package.json` declares `@chainlesschain/{core-mtc, session-core}`
 *   as `file:../packages/*`. npm installs them as **directory symlinks** (junctions
 *   on Windows) at `desktop-app-vue/node_modules/@chainlesschain/`. With
 *   `asar: false`, electron-builder's loose-file copy is lenient. With
 *   `asar: true`, the asar packer rejects them with `<file> must be under
 *   desktop-app-vue/` because the symlink's realpath escapes the app root.
 *
 *   This wrapper temporarily replaces those symlinks with verbatim copies,
 *   runs electron-builder, then restores the symlinks in `finally` so dev
 *   mode keeps working immediately after.
 *
 * Critical Windows gotcha (issue #6 attempt 2026-05-05 + memory):
 *   `fs.symlinkSync(target, path, 'dir')` requires SeCreateSymbolicLinkPrivilege
 *   (admin or Developer Mode). On regular accounts → EPERM. Must pass
 *   `'junction'` (which is what npm itself uses for workspace links on Windows).
 *
 * Top-level `chainlesschain` symlink trap (2026-05-06):
 *   `desktop-app-vue/package.json` also declares `"chainlesschain": "file:.."`
 *   which npm installs as `node_modules/chainlesschain` → repo root. With
 *   `asar: true`, electron-builder's walker follows that symlink and tries to
 *   pack the entire repo (including `config/docker/data/ollama/models/blobs/<sha256>`
 *   — 4.2 GB+ Ollama model blobs → "file size cannot be larger than 4.2GB").
 *   YAML `!node_modules/chainlesschain/**` exclusion doesn't help because the
 *   walker dereferences first then evaluates the file's REAL path
 *   (`<repo>/config/...`) against the patterns — that path doesn't match any
 *   `node_modules/...` glob. Nothing in src/{main,renderer} actually
 *   `require("chainlesschain")` (the dep is dead weight from a long-ago
 *   declaration), so we just detach the symlink for the build and re-create
 *   it in `finally` so dev mode keeps working. Same junction-on-Windows rule
 *   as the @chainlesschain/* paths.
 *
 * Failure semantics:
 *   - If electron-builder fails, the wrapper still restores symlinks before
 *     re-throwing, so the dev tree isn't left in a broken state.
 *   - If symlink restoration itself fails, we log loudly but don't mask the
 *     original build failure.
 *   - If the wrapper is killed mid-execution (SIGINT, terminal close), the
 *     dev tree is left with verbatim copies. Re-running `npm install` in
 *     desktop-app-vue/ restores the symlinks.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const APP_ROOT = path.resolve(__dirname, "..");
const SCOPE_DIR = path.join(APP_ROOT, "node_modules", "@chainlesschain");

// Workspace packages that need dereferencing for asar:true.
// Each entry: { name, sourcePath } — sourcePath is what the symlink points to,
// which we copy verbatim into the symlink's place.
const WORKSPACE_PKGS = [
  {
    name: "core-mtc",
    sourcePath: path.resolve(APP_ROOT, "..", "packages", "core-mtc"),
  },
  {
    name: "session-core",
    sourcePath: path.resolve(APP_ROOT, "..", "packages", "session-core"),
  },
];

// Top-level node_modules symlinks that point OUTSIDE the app dir and need
// to be detached (not copied) during the build, restored in finally.
// `chainlesschain: file:..` declared in package.json — see header comment.
const TOP_LEVEL_DETACH_LINKS = [
  {
    name: "chainlesschain",
    linkPath: path.join(APP_ROOT, "node_modules", "chainlesschain"),
  },
];

const tag = "[build-win-with-deref]";

/**
 * Returns true iff the path is a symlink OR a Windows junction.
 *
 * Node 22 has BOTH limitations on Windows (verified 2026-05-06):
 *   - `lstat.isSymbolicLink()` returns FALSE for junctions (different reparse
 *     tag: IO_REPARSE_TAG_MOUNT_POINT vs IO_REPARSE_TAG_SYMLINK).
 *   - `readlinkSync` throws `EINVAL` for junctions created via
 *     `fs.symlinkSync(target, path, 'junction')` (the case after this script's
 *     own restore step), even though it works for npm's original junctions.
 *
 * On Windows we therefore use `realpathSync` — it resolves both symlinks and
 * junctions and returns a path that differs from the input only when a link
 * was followed.
 *
 * On macOS (and any POSIX with implicit prefix-symlinks like `/var → /private/var`)
 * realpath comparison FALSE-POSITIVES on every plain dir under such prefixes
 * (e.g. anything under `os.tmpdir()` resolves to `/private/var/...`). POSIX
 * has no junction equivalent, so `lstat.isSymbolicLink()` is reliable there.
 */
function isSymlink(p) {
  if (!fs.existsSync(p)) return false;
  if (process.platform === "win32") {
    try {
      const real = fs.realpathSync(p);
      return path.resolve(real) !== path.resolve(p);
    } catch {
      return false;
    }
  }
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Dereference a single workspace symlink in-place.
 * Records the original symlink target so we can restore later.
 *
 * @param pkg { name, sourcePath }
 * @param scopeDir override for SCOPE_DIR (test-only — production uses module default)
 */
function dereferenceOne(pkg, scopeDir = SCOPE_DIR) {
  const link = path.join(scopeDir, pkg.name);

  if (!isSymlink(link)) {
    console.log(
      `${tag} ${pkg.name}: not a symlink (already dereferenced or missing) — skipping`,
    );
    return null;
  }

  // Read original target before unlinking, so we can junction back to it later.
  // realpathSync handles both symlinks AND junctions (vs readlinkSync which
  // throws EINVAL on some junction forms — see isSymlink comment).
  const originalTarget = fs.realpathSync(link);

  if (!fs.existsSync(pkg.sourcePath)) {
    throw new Error(
      `${tag} source path missing: ${pkg.sourcePath} — cannot dereference ${pkg.name}`,
    );
  }

  // Replace symlink with copy. Filter out the package's own node_modules/
  // (mostly its devDep tree — vitest etc.) since at runtime the package
  // resolves prod deps through desktop-app-vue/node_modules/ ancestor walk.
  // Shipping the local node_modules/ would balloon the asar with test deps.
  fs.unlinkSync(link);
  fs.cpSync(pkg.sourcePath, link, {
    recursive: true,
    dereference: true,
    preserveTimestamps: true,
    filter: (src) => {
      const rel = path.relative(pkg.sourcePath, src).split(path.sep).join("/");
      // Top-level node_modules/ of the workspace package — drop entirely.
      if (rel === "node_modules" || rel.startsWith("node_modules/")) {
        return false;
      }
      return true;
    },
  });

  console.log(
    `${tag} dereferenced ${pkg.name}: ${originalTarget} → verbatim copy`,
  );
  return { name: pkg.name, originalTarget };
}

/**
 * Detach a top-level node_modules symlink (no verbatim copy — the contents
 * shouldn't be packed at all). Records the original target so we can recreate
 * the symlink in finally. Returns null if the link is already missing.
 */
function detachTopLevelLinkOne(entry) {
  if (!isSymlink(entry.linkPath)) {
    console.log(
      `${tag} top-level ${entry.name}: not a symlink — skipping detach`,
    );
    return null;
  }
  // realpathSync handles both symlinks AND junctions (see isSymlink comment).
  const originalTarget = fs.realpathSync(entry.linkPath);
  fs.unlinkSync(entry.linkPath);
  console.log(
    `${tag} detached top-level ${entry.name} symlink: ${originalTarget}`,
  );
  return { ...entry, originalTarget };
}

/**
 * Restore one workspace symlink. Uses 'junction' on Windows (per memory:
 * 'dir' fails EPERM on non-admin without Developer Mode).
 *
 * @param record { name, originalTarget }
 * @param scopeDir override for SCOPE_DIR (test-only)
 */
function restoreOne(record, scopeDir = SCOPE_DIR) {
  const link = path.join(scopeDir, record.name);

  // Remove the verbatim copy.
  if (fs.existsSync(link)) {
    fs.rmSync(link, { recursive: true, force: true });
  }

  // Recreate the symlink. On Windows, 'junction' doesn't need elevated privs.
  // On posix, 'junction' is silently treated as 'dir'.
  const linkType = process.platform === "win32" ? "junction" : "dir";
  fs.symlinkSync(record.originalTarget, link, linkType);

  console.log(
    `${tag} restored ${record.name} symlink (${linkType}) → ${record.originalTarget}`,
  );
}

/**
 * Restore a top-level node_modules symlink (recreate at its original location
 * pointing to its original target). Same junction-on-Windows rule as
 * `restoreOne`.
 */
function restoreTopLevelLinkOne(record) {
  if (fs.existsSync(record.linkPath)) {
    fs.rmSync(record.linkPath, { recursive: true, force: true });
  }
  const linkType = process.platform === "win32" ? "junction" : "dir";
  fs.symlinkSync(record.originalTarget, record.linkPath, linkType);
  console.log(
    `${tag} restored top-level ${record.name} symlink (${linkType}) → ${record.originalTarget}`,
  );
}

async function main() {
  // Forward all args after the script name to electron-builder.
  // Default to `--win --config electron-builder.yml --publish never` so this
  // wrapper is a drop-in for the previous direct electron-builder invocation.
  const forwardedArgs = process.argv.slice(2);
  const ebArgs = forwardedArgs.length
    ? forwardedArgs
    : ["--win", "--config", "electron-builder.yml", "--publish", "never"];

  const restoreList = [];
  const topLevelRestoreList = [];

  try {
    console.log(
      `${tag} dereferencing ${WORKSPACE_PKGS.length} workspace symlinks before electron-builder run...`,
    );
    for (const pkg of WORKSPACE_PKGS) {
      const record = dereferenceOne(pkg);
      if (record) restoreList.push(record);
    }

    console.log(
      `${tag} detaching ${TOP_LEVEL_DETACH_LINKS.length} top-level symlinks (point outside app, walker would follow)...`,
    );
    for (const entry of TOP_LEVEL_DETACH_LINKS) {
      const record = detachTopLevelLinkOne(entry);
      if (record) topLevelRestoreList.push(record);
    }

    console.log(`${tag} invoking electron-builder ${ebArgs.join(" ")}`);
    // Spawn electron-builder's cli.js directly via Node, NOT via the
    // node_modules/.bin/electron-builder.cmd shim. Node 20+ rejects
    // .cmd/.bat spawns without shell:true (security hardening for
    // CVE-2024-27980), failing with EINVAL. Going through cli.js sidesteps
    // the shim entirely. stdio:'inherit' streams output to our terminal.
    const ebCli = path.join(
      APP_ROOT,
      "node_modules",
      "electron-builder",
      "cli.js",
    );
    if (!fs.existsSync(ebCli)) {
      throw new Error(
        `${tag} electron-builder cli.js not found at ${ebCli} — run \`npm install\` in desktop-app-vue/ first`,
      );
    }
    const result = spawnSync(process.execPath, [ebCli, ...ebArgs], {
      cwd: APP_ROOT,
      stdio: "inherit",
      shell: false,
      env: process.env,
    });

    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(
        `${tag} electron-builder exited with code ${result.status}`,
      );
    }

    console.log(`${tag} electron-builder completed successfully`);

    // ASAR surgery (B4 / issue #8) is handled in scripts/electron-after-pack.js
    // — that hook runs DURING electron-builder (after files are placed but
    // BEFORE the NSIS installer is generated), so the installer ships the
    // post-surgery asar. Calling surgery here would be too late: Setup.exe
    // would already have been built from the pre-surgery win-unpacked/.
  } finally {
    // Always restore symlinks, even if electron-builder failed. This keeps
    // the dev tree in a usable state for the next `npm run dev`.
    if (restoreList.length) {
      console.log(
        `${tag} restoring ${restoreList.length} workspace symlinks...`,
      );
      for (const record of restoreList) {
        try {
          restoreOne(record);
        } catch (restoreErr) {
          // Log but don't throw — original build error (if any) takes priority.
          console.error(
            `${tag} FAILED to restore ${record.name}: ${restoreErr.message}\n` +
              `${tag} run \`cd desktop-app-vue && npm install\` to recreate the symlink manually.`,
          );
        }
      }
    }
    if (topLevelRestoreList.length) {
      console.log(
        `${tag} restoring ${topLevelRestoreList.length} top-level symlinks...`,
      );
      for (const record of topLevelRestoreList) {
        try {
          restoreTopLevelLinkOne(record);
        } catch (restoreErr) {
          console.error(
            `${tag} FAILED to restore top-level ${record.name}: ${restoreErr.message}\n` +
              `${tag} run \`cd desktop-app-vue && npm install\` to recreate the symlink manually.`,
          );
        }
      }
    }
  }
}

// Only auto-run when invoked as a CLI. When required as a module (by tests
// or composing scripts), expose the helpers without spawning electron-builder.
if (require.main === module) {
  main().catch((err) => {
    console.error(`${tag} fatal: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  isSymlink,
  dereferenceOne,
  detachTopLevelLinkOne,
  restoreOne,
  restoreTopLevelLinkOne,
  WORKSPACE_PKGS,
  TOP_LEVEL_DETACH_LINKS,
  // Test-only: allow tests to override SCOPE_DIR / APP_ROOT-derived paths
  // by passing absolute paths into helpers. The helpers themselves accept
  // explicit `pkg`/`entry`/`record` args, so no runtime override needed.
};
