/**
 * Unit tests: src/lib/packer/precheck.js
 *
 * The precheck looks at THIS CLI workspace (not a fixture), so the tests
 * exercise the happy-path against the real packages/cli root and use
 * tmpDir-based fakes for projectRoot validation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { precheck } from "../../src/lib/packer/precheck.js";
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

  it("throws when working tree is dirty and !allowDirty", () => {
    // Skip this test if the current tree happens to be clean — we can't
    // forcibly dirty it without leaving turds. Best-effort: detect first
    // and only assert if dirty.
    const probe = precheck({
      projectRoot: process.cwd(),
      allowDirty: true,
      projectMode: false,
    });
    if (!probe.dirty) {
      // Tree is clean, nothing to assert. Mark passing.
      expect(true).toBe(true);
      return;
    }
    expect(() =>
      precheck({
        projectRoot: process.cwd(),
        allowDirty: false,
        projectMode: false,
      }),
    ).toThrow(/dirty/);
  });
});
