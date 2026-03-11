import { platform, arch } from "node:os";

export function getPlatform() {
  return platform();
}

export function getArch() {
  const a = arch();
  if (a === "arm64") return "arm64";
  if (a === "x64" || a === "x86_64") return "x64";
  return a;
}

export function isWindows() {
  return getPlatform() === "win32";
}

export function isMac() {
  return getPlatform() === "darwin";
}

export function isLinux() {
  return getPlatform() === "linux";
}

export function getBinaryName(version) {
  const p = getPlatform();
  const a = getArch();
  const ext = getBinaryExtension();
  return `chainlesschain-${version}-${p}-${a}${ext}`;
}

export function getBinaryExtension() {
  const p = getPlatform();
  if (p === "win32") return ".exe";
  if (p === "darwin") return ".dmg";
  if (p === "linux") return ".deb";
  return "";
}
