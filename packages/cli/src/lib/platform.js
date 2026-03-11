import { platform, arch } from "node:os";
import { BINARY_NAMES } from "../constants.js";

export function getPlatform() {
  return platform();
}

export function getArch() {
  const a = arch();
  if (a === "arm64") return "arm64";
  if (a === "x64" || a === "x86_64") return "x64";
  return a;
}

export function getBinaryName(version) {
  const p = getPlatform();
  const a = getArch();
  const platformBinaries = BINARY_NAMES[p];
  if (!platformBinaries) {
    throw new Error(`Unsupported platform: ${p}`);
  }
  const template = platformBinaries[a];
  if (!template) {
    throw new Error(`Unsupported architecture: ${a} on ${p}`);
  }
  return template.replace("{version}", version);
}

export function getBinaryExtension() {
  const p = getPlatform();
  switch (p) {
    case "win32":
      return ".exe";
    case "darwin":
      return ".dmg";
    case "linux":
      return ".deb";
    default:
      return "";
  }
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
