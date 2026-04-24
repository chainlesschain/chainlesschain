/**
 * Unit tests: src/commands/pack.js — defaultPkgTarget()
 *
 * Host-aware default for `cc pack --targets`. The value flows straight
 * into @yao-pkg/pkg's target list, so a wrong shape is not "cosmetically
 * wrong" — it crashes pkg. Tests assert the current host's string is
 * well-formed AND that the branch matrix covers every supported (os, arch).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { defaultPkgTarget } from "../../src/commands/pack.js";

describe("defaultPkgTarget", () => {
  const origPlatform = process.platform;
  const origArch = process.arch;

  function setPlatformArch(platform, arch) {
    Object.defineProperty(process, "platform", {
      value: platform,
      configurable: true,
    });
    Object.defineProperty(process, "arch", {
      value: arch,
      configurable: true,
    });
  }

  afterEach(() => {
    setPlatformArch(origPlatform, origArch);
  });

  it("returns a well-formed node20-<os>-<arch> string on the current host", () => {
    const t = defaultPkgTarget();
    expect(t).toMatch(/^node20-(win|macos|linux)-(x64|arm64)$/);
  });

  it("win32 + x64 → node20-win-x64", () => {
    setPlatformArch("win32", "x64");
    expect(defaultPkgTarget()).toBe("node20-win-x64");
  });

  it("linux + x64 → node20-linux-x64", () => {
    setPlatformArch("linux", "x64");
    expect(defaultPkgTarget()).toBe("node20-linux-x64");
  });

  it("linux + arm64 → node20-linux-arm64", () => {
    setPlatformArch("linux", "arm64");
    expect(defaultPkgTarget()).toBe("node20-linux-arm64");
  });

  it("darwin + x64 → node20-macos-x64", () => {
    setPlatformArch("darwin", "x64");
    expect(defaultPkgTarget()).toBe("node20-macos-x64");
  });

  it("darwin + arm64 → node20-macos-arm64 (Apple Silicon)", () => {
    setPlatformArch("darwin", "arm64");
    expect(defaultPkgTarget()).toBe("node20-macos-arm64");
  });

  it("unknown platform falls back to node20-win-x64 (safe default)", () => {
    setPlatformArch("freebsd", "x64");
    expect(defaultPkgTarget()).toBe("node20-win-x64");
  });

  it("unknown arch falls back to node20-win-x64 (safe default)", () => {
    setPlatformArch("linux", "ppc64");
    expect(defaultPkgTarget()).toBe("node20-win-x64");
  });
});
