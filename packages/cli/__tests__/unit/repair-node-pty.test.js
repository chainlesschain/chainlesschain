import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { repairMacNodePtySpawnHelper } from "../../scripts/repair-node-pty.mjs";

function createPackageFixture(root) {
  const packageRoot = join(root, "node-pty");
  const helperPath = join(
    packageRoot,
    "prebuilds",
    "darwin-arm64",
    "spawn-helper",
  );
  mkdirSync(join(packageRoot, "prebuilds", "darwin-arm64"), {
    recursive: true,
  });
  writeFileSync(join(packageRoot, "package.json"), '{"name":"node-pty"}\n');
  writeFileSync(helperPath, "helper\n");
  return { packageJsonPath: join(packageRoot, "package.json"), helperPath };
}

function createModeSeams(initialMode) {
  let mode = initialMode;
  return {
    lstat: () => ({
      isFile: () => true,
      isSymbolicLink: () => false,
      mode,
    }),
    stat: () => ({ mode }),
    chmod: (_path, nextMode) => {
      mode = nextMode;
    },
    getMode: () => mode,
  };
}

describe("node-pty postinstall repair", () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cc-node-pty-repair-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("repairs missing executable bits on the macOS helper", () => {
    const fixture = createPackageFixture(root);
    const mode = createModeSeams(0o644);
    const result = repairMacNodePtySpawnHelper({
      platform: "darwin",
      arch: "arm64",
      packageJsonPath: fixture.packageJsonPath,
      ...mode,
    });

    expect(result.status).toBe("repaired");
    expect(mode.getMode() & 0o111).toBe(0o111);
  });

  it("is idempotent when the helper is already executable", () => {
    const fixture = createPackageFixture(root);
    const mode = createModeSeams(0o755);
    const result = repairMacNodePtySpawnHelper({
      platform: "darwin",
      arch: "arm64",
      packageJsonPath: fixture.packageJsonPath,
      ...mode,
    });

    expect(result.status).toBe("already-executable");
    expect(result.mode).toBe(0o755);
  });

  it("does not mutate node-pty on non-macOS hosts", () => {
    expect(repairMacNodePtySpawnHelper({ platform: "linux" })).toEqual({
      status: "not-applicable",
    });
  });

  it("rejects a symlinked helper instead of chmodding its target", () => {
    const fixture = createPackageFixture(root);
    const result = repairMacNodePtySpawnHelper({
      platform: "darwin",
      arch: "arm64",
      packageJsonPath: fixture.packageJsonPath,
      lstat: () => ({
        isFile: () => false,
        isSymbolicLink: () => true,
        mode: 0o777,
      }),
    });

    expect(result.status).toBe("unsafe-helper");
  });
});
