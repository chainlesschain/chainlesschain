/**
 * project-instructions — lazy subtree-instruction discovery (module 99 §5.3).
 * Real temp monorepo tree; a package's cc.md/CLAUDE.md below the cwd is injected
 * only when a tool first accesses that subtree, deduped and excludes-aware.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  resolveSubtreeInstructions,
  SubtreeInstructionLoader,
} from "../../src/lib/project-instructions.js";

let root;

function write(rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
  return abs;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-subtree-"));
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
});

afterEach(() => {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("resolveSubtreeInstructions", () => {
  it("returns a package's cc.md when a tool accesses a file in that subtree", () => {
    const pkgDoc = write("packages/web/cc.md", "# web package rules");
    write("packages/web/src/app.js", "x");
    const found = resolveSubtreeInstructions({
      repoRoot: root,
      baseDir: root,
      accessedPath: path.join(root, "packages/web/src/app.js"),
    });
    expect(found.map((f) => f.path)).toEqual([pkgDoc]);
    expect(found[0].scope).toBe("project");
  });

  it("injects every intermediate subtree doc, shallowest-first", () => {
    const a = write("packages/cc.md", "packages");
    const b = write("packages/web/CLAUDE.md", "web");
    const found = resolveSubtreeInstructions({
      repoRoot: root,
      baseDir: root,
      accessedPath: "packages/web/src/deep/x.js",
    });
    expect(found.map((f) => f.path)).toEqual([a, b]);
  });

  it("works for a not-yet-created file (about to be written)", () => {
    const doc = write("packages/api/cc.md", "api");
    const found = resolveSubtreeInstructions({
      repoRoot: root,
      baseDir: root,
      accessedPath: "packages/api/brand-new.ts", // does not exist yet
    });
    expect(found.map((f) => f.path)).toEqual([doc]);
  });

  it("skips files already loaded at startup", () => {
    const doc = write("packages/web/cc.md", "web");
    const found = resolveSubtreeInstructions({
      repoRoot: root,
      baseDir: root,
      accessedPath: "packages/web/src/app.js",
      alreadyLoaded: [doc],
    });
    expect(found).toEqual([]);
  });

  it("never reaches back above baseDir (ancestors were loaded at startup)", () => {
    write("cc.md", "root doc"); // ancestor of the cwd
    write("packages/web/x.js", "x");
    const found = resolveSubtreeInstructions({
      repoRoot: root,
      baseDir: path.join(root, "packages/web"),
      accessedPath: path.join(root, "cc.md"), // above baseDir
    });
    expect(found).toEqual([]);
  });

  it("honors instructionExcludes (a vendor subtree doc never injects)", () => {
    write("packages/vendor/cc.md", "vendored");
    const found = resolveSubtreeInstructions({
      repoRoot: root,
      baseDir: root,
      accessedPath: "packages/vendor/lib.js",
      instructionExcludes: ["vendor"],
    });
    expect(found).toEqual([]);
  });

  it("returns [] for an empty accessedPath or an out-of-repo path", () => {
    write("packages/web/cc.md", "web");
    expect(
      resolveSubtreeInstructions({ repoRoot: root, baseDir: root }),
    ).toEqual([]);
    expect(
      resolveSubtreeInstructions({
        repoRoot: root,
        baseDir: root,
        accessedPath: path.join(os.tmpdir(), "elsewhere", "x.js"),
      }),
    ).toEqual([]);
  });
});

describe("SubtreeInstructionLoader", () => {
  it("injects a subtree once — a second access to it is a no-op", () => {
    write("packages/web/cc.md", "web");
    const loader = new SubtreeInstructionLoader({
      repoRoot: root,
      baseDir: root,
    });
    const first = loader.onAccess("packages/web/src/a.js");
    expect(first.map((f) => path.basename(f.path))).toEqual(["cc.md"]);
    const second = loader.onAccess("packages/web/src/b.js");
    expect(second).toEqual([]); // same subtree already injected
    expect(loader.loadedFiles()).toHaveLength(1);
  });

  it("accumulates distinct subtrees as they are first touched", () => {
    write("packages/web/cc.md", "web");
    write("packages/api/CLAUDE.md", "api");
    const loader = new SubtreeInstructionLoader({
      repoRoot: root,
      baseDir: root,
    });
    expect(loader.onAccess("packages/web/x.js")).toHaveLength(1);
    expect(loader.onAccess("packages/api/y.js")).toHaveLength(1);
    expect(loader.onAccess("packages/web/z.js")).toEqual([]); // web already in
    expect(
      loader
        .loadedFiles()
        .map((p) => path.basename(p))
        .sort(),
    ).toEqual(["CLAUDE.md", "cc.md"]);
  });

  it("respects a startup-loaded set passed to the constructor", () => {
    const doc = write("packages/web/cc.md", "web");
    const loader = new SubtreeInstructionLoader({
      repoRoot: root,
      baseDir: root,
      alreadyLoaded: [doc],
    });
    expect(loader.onAccess("packages/web/x.js")).toEqual([]);
  });
});
