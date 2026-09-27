import os from "node:os";

// WSL1's stat fallback reports ctime as birthtime. Creating an index or child
// directory changes that value without replacing the object. It supplies no
// creation-time identity; keep device/inode and the caller's no-link, physical
// containment and descriptor checks. WSL2 and other platforms retain birthtime.
export function artifactPhysicalIdentity(
  stat,
  { platform = process.platform, kernelRelease = os.release() } = {},
) {
  const birthtimeMs = Number(stat.birthtimeMs);
  const wsl1CtimeFallback =
    platform === "linux" &&
    /^4\.4\..*-Microsoft$/iu.test(kernelRelease) &&
    birthtimeMs === Number(stat.ctimeMs);
  return Object.freeze({
    birthtimeMs: wsl1CtimeFallback ? null : birthtimeMs,
    dev: String(stat.dev),
    ino: String(stat.ino),
  });
}
