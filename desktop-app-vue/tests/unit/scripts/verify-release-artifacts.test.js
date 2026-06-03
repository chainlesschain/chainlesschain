/**
 * verify-release-artifacts unit tests.
 *
 * Stages a fake electron-builder output directory (tmp) with various
 * combinations of installer + blockmap + latest*.yml and asserts the
 * verifier flags exactly the right gaps. No real build is required.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verify } from "../../../scripts/verify-release-artifacts.js";

let dir;

function touch(rel, body = "x") {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, "utf-8");
  return full;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-release-"));
});

afterEach(() => {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("verify-release-artifacts", () => {
  it("returns exitCode 2 when buildDir does not exist", () => {
    const result = verify(path.join(dir, "missing"));
    expect(result.ok).toBe(false);
    expect(result.summary.exitCode).toBe(2);
    expect(result.errors[0]).toMatch(/Build directory not found/);
  });

  it("ok=true when NSIS installer + blockmap + latest.yml all present", () => {
    touch("ChainlessChain-Setup-1.0.0.exe");
    touch("ChainlessChain-Setup-1.0.0.exe.blockmap", "BLOCKMAP-DATA");
    touch("latest.yml", "version: 1.0.0\n");
    const result = verify(dir);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.summary.nsis).toBe(1);
    expect(result.summary.hasLatestYml).toBe(true);
  });

  it("flags missing blockmap for NSIS installer", () => {
    touch("ChainlessChain-Setup-1.0.0.exe");
    touch("latest.yml", "version: 1.0.0\n");
    const result = verify(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /Missing blockmap/.test(e))).toBe(true);
  });

  it("flags empty blockmap (zero bytes) for NSIS", () => {
    touch("ChainlessChain-Setup-1.0.0.exe");
    touch("ChainlessChain-Setup-1.0.0.exe.blockmap", "");
    touch("latest.yml", "version: 1.0.0\n");
    const result = verify(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /Empty blockmap/.test(e))).toBe(true);
  });

  it("flags missing latest.yml when NSIS installer present", () => {
    touch("ChainlessChain-Setup-1.0.0.exe");
    touch("ChainlessChain-Setup-1.0.0.exe.blockmap", "BLOCKMAP");
    // no latest.yml
    const result = verify(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /Missing latest\.yml/.test(e))).toBe(true);
  });

  it("flags missing latest-mac.yml when dmg present", () => {
    touch("ChainlessChain-1.0.0.dmg");
    touch("ChainlessChain-1.0.0.dmg.blockmap", "BLOCKMAP");
    const result = verify(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /Missing latest-mac\.yml/.test(e))).toBe(
      true,
    );
  });

  it("flags missing latest-linux.yml when AppImage present", () => {
    touch("ChainlessChain-1.0.0.AppImage");
    touch("ChainlessChain-1.0.0.AppImage.blockmap", "BLOCKMAP");
    const result = verify(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /Missing latest-linux\.yml/.test(e))).toBe(
      true,
    );
  });

  it("warns (not errors) on portable .exe", () => {
    touch("ChainlessChain-Portable-1.0.0.exe");
    const result = verify(dir);
    // Portable alone shouldn't trip NSIS rule
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => /portable/.test(w))).toBe(true);
    expect(result.summary.portable).toBe(1);
    expect(result.summary.nsis).toBe(0);
  });

  it("counts mixed-platform artifacts correctly", () => {
    touch("ChainlessChain-Setup-1.0.0.exe");
    touch("ChainlessChain-Setup-1.0.0.exe.blockmap", "B");
    touch("ChainlessChain-1.0.0.dmg");
    touch("ChainlessChain-1.0.0.dmg.blockmap", "B");
    touch("ChainlessChain-1.0.0.AppImage");
    touch("ChainlessChain-1.0.0.AppImage.blockmap", "B");
    touch("latest.yml", "v: 1");
    touch("latest-mac.yml", "v: 1");
    touch("latest-linux.yml", "v: 1");
    const result = verify(dir);
    expect(result.ok).toBe(true);
    expect(result.summary).toMatchObject({
      nsis: 1,
      dmg: 1,
      appImage: 1,
      hasLatestYml: true,
      hasLatestMacYml: true,
      hasLatestLinuxYml: true,
    });
  });

  it("walks nested directories", () => {
    touch("nested/sub/ChainlessChain-Setup-1.0.0.exe");
    touch("nested/sub/ChainlessChain-Setup-1.0.0.exe.blockmap", "B");
    touch("latest.yml", "v: 1");
    const result = verify(dir);
    expect(result.ok).toBe(true);
    expect(result.summary.nsis).toBe(1);
  });
});
