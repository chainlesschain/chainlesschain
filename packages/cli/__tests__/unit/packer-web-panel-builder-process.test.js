import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  _deps,
  ensureWebPanel,
} from "../../src/lib/packer/web-panel-builder.js";

const originalDeps = { ..._deps };
let cliRoot;

beforeEach(() => {
  cliRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-web-panel-"));
  _deps.spawnSync = vi.fn(() => ({ status: 0, stdout: "", stderr: "" }));
});

afterEach(() => {
  Object.assign(_deps, originalDeps);
  fs.rmSync(cliRoot, { recursive: true, force: true });
});

describe("packer web panel process execution", () => {
  it("routes the web panel build through the broker", () => {
    const distDir = path.join(cliRoot, "src", "assets", "web-panel");
    _deps.spawnSync.mockImplementation(() => {
      fs.mkdirSync(distDir, { recursive: true });
      fs.writeFileSync(path.join(distDir, "index.html"), "<main></main>");
      fs.writeFileSync(path.join(distDir, "app.js"), "// bundle");
      return { status: 0, stdout: "", stderr: "" };
    });

    expect(ensureWebPanel({ cliRoot, skipBuild: false })).toEqual({
      distDir,
      rebuilt: true,
      assetCount: 2,
    });
    expect(_deps.spawnSync).toHaveBeenCalledWith(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["run", "build:web-panel"],
      expect.objectContaining({
        origin: "packer:web-panel-build",
        scope: "pack",
        policy: "allow",
        shell: false,
        cwd: cliRoot,
        stdio: "inherit",
      }),
    );
  });

  it("surfaces npm startup errors", () => {
    _deps.spawnSync.mockReturnValue({
      status: null,
      error: new Error("npm missing"),
    });

    expect(() => ensureWebPanel({ cliRoot, skipBuild: false })).toThrow(
      /Failed to start 'npm run build:web-panel': npm missing/,
    );
  });
});
