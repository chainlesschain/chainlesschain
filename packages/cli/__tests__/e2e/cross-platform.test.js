import { describe, it, expect } from "vitest";
import { platform } from "node:os";
import {
  getBinaryName,
  getBinaryExtension,
  getPlatform,
  getArch,
} from "../../src/lib/platform.js";
import { getElectronUserDataDir } from "../../src/lib/paths.js";

describe("E2E: cross-platform", () => {
  const currentPlatform = platform();

  it("getPlatform returns current OS", () => {
    expect(getPlatform()).toBe(currentPlatform);
  });

  it("getArch returns valid architecture", () => {
    const arch = getArch();
    expect(["x64", "arm64"]).toContain(arch);
  });

  it("getBinaryName includes version and platform identifier", () => {
    const name = getBinaryName("1.2.3");
    expect(name).toContain("1.2.3");

    if (currentPlatform === "win32") {
      expect(name).toContain("win32");
      expect(name).toContain(".exe");
    } else if (currentPlatform === "darwin") {
      expect(name).toContain("darwin");
      expect(name).toContain(".dmg");
    } else if (currentPlatform === "linux") {
      expect(name).toContain("linux");
      expect(name).toContain(".deb");
    }
  });

  it("getBinaryExtension matches platform", () => {
    const ext = getBinaryExtension();
    if (currentPlatform === "win32") expect(ext).toBe(".exe");
    else if (currentPlatform === "darwin") expect(ext).toBe(".dmg");
    else if (currentPlatform === "linux") expect(ext).toBe(".deb");
  });

  it("getElectronUserDataDir returns platform-appropriate path", () => {
    const dir = getElectronUserDataDir();
    expect(dir).toContain("chainlesschain-desktop-vue");

    if (currentPlatform === "win32") {
      expect(dir).toMatch(/AppData|APPDATA/i);
    } else if (currentPlatform === "darwin") {
      expect(dir).toContain("Application Support");
    } else if (currentPlatform === "linux") {
      expect(dir).toMatch(/\.config/);
    }
  });
});
