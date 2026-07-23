/**
 * Unit tests: src/lib/packer/precheck.js
 *
 * The precheck looks at THIS CLI workspace (not a fixture), so the tests
 * exercise the happy-path against the real packages/cli root and use
 * tmpDir-based fakes for projectRoot validation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { _deps, precheck } from "../../src/lib/packer/precheck.js";
import { PackError } from "../../src/lib/packer/errors.js";

describe("precheck", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pre-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  // These four cases exercise base-mode precheck against the real repo (so
  // git/node_modules state is authentic). We pass `projectMode: false`
  // explicitly so the auto-detect doesn't try to validate whatever
  // `.chainlesschain/config.json` happens to sit at cwd — that's
  // project-mode territory and covered in packer-precheck-project-mode.test.js.

  it("succeeds when projectRoot exists and node_modules present", () => {
    // Use the real packages/cli root (we're running inside it)
    const r = precheck({
      projectRoot: process.cwd(),
      allowDirty: true,
      projectMode: false,
    });
    expect(r.cliRoot).toMatch(/packages[/\\]cli$/);
    expect(typeof r.dirty).toBe("boolean");
  });

  it("throws PackError when projectRoot does not exist", () => {
    expect(() =>
      precheck({
        projectRoot: path.join(tmpDir, "no-such"),
        allowDirty: true,
        projectMode: false,
      }),
    ).toThrow(PackError);
  });

  it("returns gitCommit metadata when in a git repo", () => {
    // process.cwd() is the chainlesschain repo, which IS a git repo.
    const r = precheck({
      projectRoot: process.cwd(),
      allowDirty: true,
      projectMode: false,
    });
    if (r.gitCommit !== null) {
      expect(typeof r.gitCommit).toBe("string");
      expect(r.gitCommit.length).toBeGreaterThan(0);
    }
  });

  it("routes git metadata probes through literal brokered argv", () => {
    const original = _deps.execFileSync;
    const execFileSync = vi.fn((_file, args) => {
      if (args[0] === "status") return "";
      if (args.includes("--show-toplevel")) return `${process.cwd()}\n`;
      return "abc123\n";
    });
    _deps.execFileSync = execFileSync;

    try {
      const result = precheck({
        projectRoot: process.cwd(),
        allowDirty: true,
        projectMode: false,
      });
      expect(result.gitCommit).toBe("abc123");
      expect(execFileSync).toHaveBeenNthCalledWith(
        1,
        "git",
        ["rev-parse", "--show-toplevel"],
        expect.objectContaining({
          origin: "packer:precheck-git",
          scope: "pack",
          policy: "allow",
          shell: false,
          cwd: process.cwd(),
        }),
      );
      expect(execFileSync.mock.calls.map((call) => call[1])).toEqual([
        ["rev-parse", "--show-toplevel"],
        ["rev-parse", "--short", "HEAD"],
        ["status", "--porcelain"],
      ]);
    } finally {
      _deps.execFileSync = original;
    }
  });

  it("throws when the projectRoot git tree is dirty and !allowDirty", () => {
    // Deterministic (was best-effort: skipped whenever the CLI repo happened to
    // be clean, i.e. always in CI). Init a REAL git repo in tmpDir with one
    // commit (so rev-parse HEAD succeeds — an unborn HEAD would throw and leave
    // dirty=false), then dirty it with an untracked file and point precheck at
    // it. -c user.* avoids a dependency on global git identity.
    execSync("git init -q", { cwd: tmpDir });
    execSync(
      "git -c user.email=t@example.com -c user.name=t commit --allow-empty -q -m init",
      { cwd: tmpDir },
    );
    fs.writeFileSync(path.join(tmpDir, "dirty.txt"), "uncommitted");

    expect(() =>
      precheck({ projectRoot: tmpDir, allowDirty: false, projectMode: false }),
    ).toThrow(/dirty/i);

    // The same dirty tree is tolerated with allowDirty:true (and reported).
    const r = precheck({
      projectRoot: tmpDir,
      allowDirty: true,
      projectMode: false,
    });
    expect(r.dirty).toBe(true);
  });
});
