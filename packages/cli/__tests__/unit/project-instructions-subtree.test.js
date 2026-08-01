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
  SubtreeInstructionBoundaryError,
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
  it("discovers without marking files loaded", () => {
    const doc = write("packages/web/cc.md", "web");
    const loader = new SubtreeInstructionLoader({
      repoRoot: root,
      baseDir: root,
    });

    const first = loader.discover("packages/web/src/a.js");
    expect(first.map((f) => f.path)).toEqual([doc]);
    const expectedIdentity =
      path.sep === "\\" ? path.resolve(doc).toLowerCase() : path.resolve(doc);
    expect(first[0].identity).toBe(expectedIdentity);
    expect(loader.loadedFiles()).toEqual([]);
    expect(loader.discover("packages/web/src/b.js")).toEqual(first);
  });

  it("does not discover a file again after it is committed", () => {
    const doc = write("packages/web/cc.md", "web");
    const loader = new SubtreeInstructionLoader({
      repoRoot: root,
      baseDir: root,
    });

    const discovered = loader.discover("packages/web/src/a.js");
    expect(loader.commit(discovered)).toBe(1);
    expect(loader.discover("packages/web/src/b.js")).toEqual([]);
    expect(loader.loadedFiles()).toEqual([doc]);
    expect(loader.markLoaded(discovered)).toBe(0);
  });

  it("retries a discovery when reading fails and the caller does not commit", () => {
    const doc = write("packages/web/cc.md", "web");
    const loader = new SubtreeInstructionLoader({
      repoRoot: root,
      baseDir: root,
    });
    let attempts = 0;
    const readAndParse = (candidate) => {
      attempts++;
      if (attempts === 1) throw new Error("transient read failure");
      return fs.readFileSync(candidate.path, "utf-8");
    };

    const first = loader.discover("packages/web/src/a.js");
    expect(() => readAndParse(first[0])).toThrow("transient read failure");
    // No commit after the failed read: the same stable candidate must retry.
    const retry = loader.discover("packages/web/src/a.js");
    expect(retry).toEqual(first);
    expect(readAndParse(retry[0])).toBe("web");
    loader.commit(retry);
    expect(loader.discover("packages/web/src/a.js")).toEqual([]);
    expect(loader.loadedFiles()).toEqual([doc]);
  });

  it("discovers nested rules shallowest-first for a merged batch", () => {
    const packagesDoc = write("packages/cc.md", "packages");
    const webDoc = write("packages/web/CLAUDE.md", "web");
    const deepDoc = write("packages/web/deep/AGENTS.md", "deep");
    const loader = new SubtreeInstructionLoader({
      repoRoot: root,
      baseDir: root,
    });

    const source = loader.discover("packages/web/src/source.js");
    const target = loader.discover("packages/web/deep/target.js");
    expect(source.map((f) => f.path)).toEqual([packagesDoc, webDoc]);
    expect(target.map((f) => f.path)).toEqual([packagesDoc, webDoc, deepDoc]);
    const merged = [
      ...new Map(
        [...source, ...target].map((candidate) => [
          candidate.identity,
          candidate,
        ]),
      ).values(),
    ];
    expect(merged.map((f) => f.path)).toEqual([packagesDoc, webDoc, deepDoc]);
    expect(loader.commit(merged)).toBe(3);
  });

  it("fails closed with an explicit error when discovery leaves the project", () => {
    const loader = new SubtreeInstructionLoader({
      repoRoot: root,
      baseDir: root,
    });
    const outside = path.join(os.tmpdir(), "elsewhere", "x.js");

    expect(() => loader.discover(outside)).toThrow(
      SubtreeInstructionBoundaryError,
    );
    try {
      loader.discover(outside);
    } catch (error) {
      expect(error.code).toBe("ERR_SUBTREE_INSTRUCTION_BOUNDARY");
    }
    expect(loader.loadedFiles()).toEqual([]);
    // The legacy convenience remains fail-open for current callers.
    expect(loader.onAccess(outside)).toEqual([]);
  });
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
