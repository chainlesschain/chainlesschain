// Only resolve the platform/architecture needed to admit helper assets. Loading
// pkg's config module also loads pkg-fetch, whose Linux host probe runs ldd at
// import time. Target admission must remain free of subprocess side effects.
// Keep these token aliases aligned with the installed pkg parser via the
// differential tests. Linux, Alpine and linuxstatic need the same static ELF.
// ARM32 hosts require an explicit supported target architecture: unlike pkg,
// admission never invokes uname to infer a different ABI from the kernel.
const PLATFORMS = new Set([
  "alpine",
  "freebsd",
  "linux",
  "linuxstatic",
  "macos",
  "win",
]);
const ARCHITECTURES = new Set([
  "x64",
  "x86",
  "armv7",
  "arm64",
  "ppc64",
  "s390x",
  "riscv64",
  "loong64",
]);
const PLATFORM_ALIASES = new Map([
  ["darwin", "macos"],
  ["lin", "linux"],
  ["mac", "macos"],
  ["osx", "macos"],
  ["win32", "win"],
  ["windows", "win"],
]);
const ARCHITECTURE_ALIASES = new Map([
  ["ia32", "x86"],
  ["x86_64", "x64"],
]);

export function linuxSubreaperTargetArchitectures(
  targets,
  { platform = process.platform, arch = process.arch } = {},
) {
  if (
    !Array.isArray(targets) ||
    targets.length === 0 ||
    targets.some(
      (target) =>
        typeof target !== "string" || !target.trim().replace(/-/g, ""),
    )
  ) {
    throw new Error("Standalone builds require explicit nonempty pkg targets");
  }
  const architectures = new Set();
  for (const rawTarget of targets) {
    const target = rawTarget.trim();
    let targetPlatform = PLATFORM_ALIASES.get(platform) || platform;
    let targetArch = ARCHITECTURE_ALIASES.get(arch) || arch;
    if (target !== "host") {
      for (const token of target.split("-")) {
        if (!token || token === "latest" || token.startsWith("node")) continue;
        const resolvedPlatform = PLATFORM_ALIASES.get(token) || token;
        if (PLATFORMS.has(resolvedPlatform)) {
          targetPlatform = resolvedPlatform;
          continue;
        }
        const resolvedArch = ARCHITECTURE_ALIASES.get(token) || token;
        if (ARCHITECTURES.has(resolvedArch)) {
          targetArch = resolvedArch;
          continue;
        }
        throw new Error(`Unknown token '${token}' in '${target}'`);
      }
    }
    if (!["linux", "alpine", "linuxstatic"].includes(targetPlatform)) continue;
    if (targetArch !== "x64" && targetArch !== "arm64") {
      throw new Error(
        `Unsupported standalone Linux process supervision architecture: ${targetArch}`,
      );
    }
    architectures.add(targetArch);
  }
  return [...architectures];
}
