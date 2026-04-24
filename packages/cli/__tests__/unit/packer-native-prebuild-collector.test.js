/**
 * Unit tests: src/lib/packer/native-prebuild-collector.js
 *
 * pkgTargetToPlatformKey is a pure mapper — exhaustively tested. The
 * collector itself is integration-tested via fake node_modules layouts
 * inside a tmp dir, with a mocked TARGET_MODULES set is not exposed,
 * so we verify the real default modules: any test that runs with
 * better-sqlite3 actually installed in this CLI workspace will collect
 * it (which is good) — those that don't supply a fake CLI root will
 * report missing required modules.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  collectPrebuilds,
  pkgTargetToPlatformKey,
} from "../../src/lib/packer/native-prebuild-collector.js";
import { PackError } from "../../src/lib/packer/errors.js";

describe("pkgTargetToPlatformKey", () => {
  it("maps node20-win-x64 -> win32-x64", () => {
    expect(pkgTargetToPlatformKey("node20-win-x64")).toBe("win32-x64");
  });
  it("maps node20-macos-arm64 -> darwin-arm64", () => {
    expect(pkgTargetToPlatformKey("node20-macos-arm64")).toBe("darwin-arm64");
  });
  it("maps node22-linux-x64 -> linux-x64", () => {
    expect(pkgTargetToPlatformKey("node22-linux-x64")).toBe("linux-x64");
  });
  it("maps node20-alpine-x64 -> linux-x64", () => {
    expect(pkgTargetToPlatformKey("node20-alpine-x64")).toBe("linux-x64");
  });
  it("returns null for malformed inputs", () => {
    expect(pkgTargetToPlatformKey("garbage")).toBeNull();
    expect(pkgTargetToPlatformKey("node20-win")).toBeNull();
    expect(pkgTargetToPlatformKey("node20-windows-x64")).toBeNull();
    expect(pkgTargetToPlatformKey("")).toBeNull();
  });
});

describe("collectPrebuilds", () => {
  let cliRoot;
  let tempDir;

  beforeEach(() => {
    cliRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-cli-"));
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-tmp-"));
  });

  afterEach(() => {
    for (const d of [cliRoot, tempDir]) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  });

  function writeFakeNodeFile(modName) {
    const moduleDir = path.join(cliRoot, "node_modules", modName);
    const releaseDir = path.join(moduleDir, "build", "Release");
    fs.mkdirSync(releaseDir, { recursive: true });
    // Module resolution (createRequire / fallback walk) requires package.json
    fs.writeFileSync(
      path.join(moduleDir, "package.json"),
      JSON.stringify({ name: modName, version: "0.0.0", main: "index.js" }),
    );
    fs.writeFileSync(path.join(moduleDir, "index.js"), "module.exports = {};");
    const file = path.join(releaseDir, `${modName}.node`);
    fs.writeFileSync(file, "fake-binary-content", "binary");
    return file;
  }

  it("returns empty result when no targets requested", () => {
    const r = collectPrebuilds({ cliRoot, targets: [], tempDir });
    expect(r.prebuildsDir).toBeNull();
    expect(r.collected).toEqual([]);
    expect(r.missing).toEqual([]);
  });

  it("collects better-sqlite3 .node when present", () => {
    writeFakeNodeFile("better-sqlite3");
    const r = collectPrebuilds({
      cliRoot,
      targets: ["node20-win-x64"],
      tempDir,
    });
    expect(r.collected.length).toBeGreaterThanOrEqual(1);
    const sqlite = r.collected.find((c) => c.module === "better-sqlite3");
    expect(sqlite).toBeDefined();
    expect(fs.existsSync(sqlite.to)).toBe(true);
    expect(path.basename(sqlite.to)).toBe("better-sqlite3.node");
    // win32-x64 directory created
    expect(
      fs.existsSync(
        path.join(r.prebuildsDir, "win32-x64", "better-sqlite3.node"),
      ),
    ).toBe(true);
  });

  it("reports the optional ciphers module as missing without erroring", () => {
    writeFakeNodeFile("better-sqlite3");
    const r = collectPrebuilds({
      cliRoot,
      targets: ["node20-win-x64"],
      tempDir,
    });
    const optMissing = r.missing.find(
      (m) => m.module === "better-sqlite3-multiple-ciphers",
    );
    expect(optMissing).toBeDefined();
    expect(optMissing.required).toBe(false);
  });

  it("no longer throws when natives are missing — reports them instead (sql.js fallback)", () => {
    const r = collectPrebuilds({
      cliRoot,
      targets: ["node20-win-x64"],
      tempDir,
    });
    expect(r.collected).toEqual([]);
    const bs = r.missing.find((m) => m.module === "better-sqlite3");
    expect(bs).toBeDefined();
    expect(bs.required).toBe(false);
  });

  it("throws PackError on malformed target", () => {
    writeFakeNodeFile("better-sqlite3");
    expect(() =>
      collectPrebuilds({
        cliRoot,
        targets: ["garbage-target"],
        tempDir,
      }),
    ).toThrow(/Unrecognized pkg target/);
  });

  it("handles multiple targets and creates per-target subdirs", () => {
    writeFakeNodeFile("better-sqlite3");
    const r = collectPrebuilds({
      cliRoot,
      targets: ["node20-win-x64", "node20-linux-x64"],
      tempDir,
    });
    expect(
      fs.existsSync(
        path.join(r.prebuildsDir, "win32-x64", "better-sqlite3.node"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(r.prebuildsDir, "linux-x64", "better-sqlite3.node"),
      ),
    ).toBe(true);
  });
});
