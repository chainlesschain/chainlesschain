/**
 * Unit tests: src/commands/pack.js — defaultPkgTarget()
 *
 * Host-aware default for `cc pack --targets`. The value flows straight
 * into @yao-pkg/pkg's target list, so a wrong shape is not "cosmetically
 * wrong" — it crashes pkg. Tests assert the current host's string is
 * well-formed AND that the branch matrix covers every supported (os, arch).
 */

import { describe, it, expect, afterEach } from "vitest";
import { Command } from "commander";
import {
  defaultPkgTarget,
  registerPackCommand,
} from "../../src/commands/pack.js";

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

  it("returns a well-formed node22-<os>-<arch> string on the current host", () => {
    const t = defaultPkgTarget();
    expect(t).toMatch(/^node22-(win|macos|linux)-(x64|arm64)$/);
  });

  it("win32 + x64 → node22-win-x64", () => {
    setPlatformArch("win32", "x64");
    expect(defaultPkgTarget()).toBe("node22-win-x64");
  });

  it("linux + x64 → node22-linux-x64", () => {
    setPlatformArch("linux", "x64");
    expect(defaultPkgTarget()).toBe("node22-linux-x64");
  });

  it("linux + arm64 → node22-linux-arm64", () => {
    setPlatformArch("linux", "arm64");
    expect(defaultPkgTarget()).toBe("node22-linux-arm64");
  });

  it("darwin + x64 → node22-macos-x64", () => {
    setPlatformArch("darwin", "x64");
    expect(defaultPkgTarget()).toBe("node22-macos-x64");
  });

  it("darwin + arm64 → node22-macos-arm64 (Apple Silicon)", () => {
    setPlatformArch("darwin", "arm64");
    expect(defaultPkgTarget()).toBe("node22-macos-arm64");
  });

  it("unknown platform falls back to node22-win-x64 (safe default)", () => {
    setPlatformArch("freebsd", "x64");
    expect(defaultPkgTarget()).toBe("node22-win-x64");
  });

  it("unknown arch falls back to node22-win-x64 (safe default)", () => {
    setPlatformArch("linux", "ppc64");
    expect(defaultPkgTarget()).toBe("node22-win-x64");
  });

  it("keeps generated help identical across host platforms", () => {
    const helpFor = (platform, arch) => {
      setPlatformArch(platform, arch);
      const program = new Command().name("chainlesschain");
      registerPackCommand(program);
      return program.commands
        .find((command) => command.name() === "pack")
        .helpInformation();
    };

    const windowsHelp = helpFor("win32", "x64");
    const linuxHelp = helpFor("linux", "x64");

    expect(linuxHelp).toBe(windowsHelp);
    expect(linuxHelp).not.toContain('default: "node22-');
  });
});
