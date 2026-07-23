import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _deps, runPkg } from "../../src/lib/packer/pkg-runner.js";

const originalDeps = { ..._deps };
let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pkg-runner-"));
  _deps.spawnSync = vi.fn(() => ({ status: 0, stdout: "", stderr: "" }));
});

afterEach(() => {
  Object.assign(_deps, originalDeps);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createFixture() {
  const cliRoot = path.join(tmpDir, "cli");
  const pkgRoot = path.join(cliRoot, "node_modules", "@yao-pkg", "pkg");
  const buildDir = path.join(tmpDir, "build");
  fs.mkdirSync(pkgRoot, { recursive: true });
  fs.mkdirSync(buildDir, { recursive: true });
  fs.writeFileSync(path.join(cliRoot, "package.json"), '{"name":"fixture"}');
  fs.writeFileSync(
    path.join(pkgRoot, "package.json"),
    '{"name":"@yao-pkg/pkg","bin":{"pkg":"bin.js"}}',
  );
  const script = path.join(pkgRoot, "bin.js");
  fs.writeFileSync(script, "// fixture");
  const pkgConfigFile = path.join(buildDir, "package.json");
  fs.writeFileSync(pkgConfigFile, '{"name":"packed-app"}');
  const outputPath = path.join(buildDir, "packed-app");
  fs.writeFileSync(outputPath, "binary");
  return { cliRoot, script, pkgConfigFile, outputPath };
}

describe("packer pkg process execution", () => {
  it("routes pkg through the broker with literal argv", () => {
    const fixture = createFixture();
    const targets = ["node18-win-x64"];

    const result = runPkg({ ...fixture, targets });

    expect(_deps.spawnSync).toHaveBeenCalledWith(
      process.execPath,
      [
        fixture.script,
        fixture.pkgConfigFile,
        "--targets",
        "node18-win-x64",
        "--output",
        fixture.outputPath,
      ],
      expect.objectContaining({
        origin: "packer:pkg",
        scope: "pack",
        policy: "allow",
        shell: false,
        cwd: path.dirname(fixture.pkgConfigFile),
        stdio: "inherit",
      }),
    );
    expect(result.outputs).toEqual([
      { path: fixture.outputPath, target: "node18-win-x64" },
    ]);
  });

  it("surfaces pkg startup errors", () => {
    const fixture = createFixture();
    _deps.spawnSync.mockReturnValue({
      status: null,
      error: new Error("runtime missing"),
    });

    expect(() => runPkg({ ...fixture, targets: ["node18-win-x64"] })).toThrow(
      /Failed to start pkg: runtime missing/,
    );
  });
});
