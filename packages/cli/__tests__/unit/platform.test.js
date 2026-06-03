import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";

describe("platform", () => {
  let platformModule;

  beforeEach(async () => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getPlatform returns os.platform()", async () => {
    const { getPlatform } = await import("../../src/lib/platform.js");
    expect(getPlatform()).toBe(os.platform());
  });

  it("getArch returns normalized architecture", async () => {
    const { getArch } = await import("../../src/lib/platform.js");
    const result = getArch();
    expect(["x64", "arm64"]).toContain(result);
  });

  it("getBinaryName generates correct name for version", async () => {
    const { getBinaryName } = await import("../../src/lib/platform.js");
    const name = getBinaryName("1.0.0");
    expect(name).toContain("1.0.0");
    expect(name).toContain("chainlesschain");
  });

  it("isWindows returns boolean", async () => {
    const { isWindows } = await import("../../src/lib/platform.js");
    expect(typeof isWindows()).toBe("boolean");
  });

  it("isMac returns boolean", async () => {
    const { isMac } = await import("../../src/lib/platform.js");
    expect(typeof isMac()).toBe("boolean");
  });

  it("isLinux returns boolean", async () => {
    const { isLinux } = await import("../../src/lib/platform.js");
    expect(typeof isLinux()).toBe("boolean");
  });

  it("getBinaryExtension returns platform-specific extension", async () => {
    const { getBinaryExtension } = await import("../../src/lib/platform.js");
    const ext = getBinaryExtension();
    expect([".exe", ".dmg", ".deb", ""]).toContain(ext);
  });
});
