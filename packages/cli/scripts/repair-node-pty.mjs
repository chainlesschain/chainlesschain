import { chmodSync, lstatSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";

const require = createRequire(import.meta.url);

/**
 * Repair node-pty 1.1.0's non-executable macOS spawn-helper.
 *
 * The helper is invoked by the native addon with posix_spawnp. The published
 * npm tarball records it as mode 0644, so fresh macOS installs cannot create a
 * real PTY. Keep the mutation scoped to a regular file inside the resolved
 * node-pty package and verify the resulting executable bits.
 */
export function repairMacNodePtySpawnHelper({
  platform = process.platform,
  arch = process.arch,
  packageJsonPath,
  resolvePackageJson = () => require.resolve("node-pty/package.json"),
  lstat = lstatSync,
  stat = statSync,
  chmod = chmodSync,
  realpath = realpathSync,
} = {}) {
  if (platform !== "darwin") {
    return { status: "not-applicable" };
  }

  let resolvedPackageJson = packageJsonPath;
  try {
    resolvedPackageJson ||= resolvePackageJson();
  } catch {
    return { status: "node-pty-unavailable" };
  }

  const packageRoot = realpath(dirname(resolvedPackageJson));
  const helperPath = join(
    packageRoot,
    "prebuilds",
    `darwin-${arch}`,
    "spawn-helper",
  );
  let helper;
  try {
    helper = lstat(helperPath);
  } catch {
    return { status: "helper-unavailable", helperPath };
  }

  const relativeHelper = relative(packageRoot, resolve(helperPath));
  if (
    helper.isSymbolicLink() ||
    !helper.isFile() ||
    relativeHelper === ".." ||
    relativeHelper.startsWith(`..${sep}`)
  ) {
    return { status: "unsafe-helper", helperPath };
  }

  const originalMode = helper.mode & 0o777;
  if ((originalMode & 0o111) !== 0) {
    return { status: "already-executable", helperPath, mode: originalMode };
  }

  chmod(helperPath, originalMode | 0o111);
  const repairedMode = stat(helperPath).mode & 0o777;
  if ((repairedMode & 0o111) === 0) {
    throw new Error(
      `node-pty spawn-helper is still not executable: ${helperPath}`,
    );
  }

  return { status: "repaired", helperPath, mode: repairedMode };
}
