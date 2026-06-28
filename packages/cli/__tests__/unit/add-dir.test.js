/**
 * `/add-dir` helper — resolve + validate an extra working root, and render the
 * current root list. Pure with fs/os injected, so it's deterministic.
 */
import { describe, it, expect } from "vitest";
import path from "path";
import { resolveAddDir, formatAddDirRoots } from "../../src/repl/add-dir.js";

const CWD = path.resolve("/proj");
const HOME = path.resolve("/home/alice");

// Fake fs where only the listed absolute dirs exist (all as directories),
// plus one path that exists but is a file.
function makeDeps({ dirs = [], files = [] } = {}) {
  const dset = new Set(dirs.map((d) => path.resolve(d)));
  const fset = new Set(files.map((f) => path.resolve(f)));
  return {
    existsSync: (p) => dset.has(path.resolve(p)) || fset.has(path.resolve(p)),
    statSync: (p) => ({ isDirectory: () => dset.has(path.resolve(p)) }),
    homedir: () => HOME,
  };
}

describe("resolveAddDir", () => {
  it("rejects empty input with a usage hint", () => {
    const r = resolveAddDir("  ", { cwd: CWD, deps: makeDeps() });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/usage/);
  });

  it("rejects a non-existent path", () => {
    const r = resolveAddDir("../lib", { cwd: CWD, deps: makeDeps() });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no such directory/);
  });

  it("rejects a path that exists but is a file", () => {
    const file = path.resolve("/proj/notes.txt");
    const r = resolveAddDir("notes.txt", {
      cwd: CWD,
      deps: makeDeps({ files: [file] }),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not a directory/);
  });

  it("resolves a relative directory against cwd", () => {
    const lib = path.resolve("/lib");
    const r = resolveAddDir("../lib", {
      cwd: CWD,
      deps: makeDeps({ dirs: [lib] }),
    });
    expect(r.ok).toBe(true);
    expect(r.alreadyPresent).toBe(false);
    expect(r.dir).toBe(lib);
  });

  it("expands a leading ~ to the home directory", () => {
    const sub = path.join(HOME, "work");
    const r = resolveAddDir("~/work", {
      cwd: CWD,
      deps: makeDeps({ dirs: [sub] }),
    });
    expect(r.ok).toBe(true);
    expect(r.dir).toBe(path.resolve(sub));
  });

  it("flags the primary cwd as already present", () => {
    const r = resolveAddDir(".", { cwd: CWD, deps: makeDeps({ dirs: [CWD] }) });
    expect(r.ok).toBe(true);
    expect(r.alreadyPresent).toBe(true);
  });

  it("flags a dir already in the existing roots as already present", () => {
    const lib = path.resolve("/lib");
    const r = resolveAddDir("../lib", {
      cwd: CWD,
      existing: [lib],
      deps: makeDeps({ dirs: [lib] }),
    });
    expect(r.ok).toBe(true);
    expect(r.alreadyPresent).toBe(true);
  });
});

describe("formatAddDirRoots", () => {
  it("lists the primary root and a hint when there are no extras", () => {
    const out = formatAddDirRoots(CWD, []);
    expect(out).toMatch(/Working roots \(1\):/);
    expect(out).toMatch(/\(primary\)/);
    expect(out).toMatch(/\/add-dir <dir>/);
  });

  it("lists every extra root with a header count", () => {
    const a = path.resolve("/lib");
    const b = path.resolve("/shared");
    const out = formatAddDirRoots(CWD, [a, b]);
    expect(out).toMatch(/Working roots \(3\):/);
    expect(out).toContain(a);
    expect(out).toContain(b);
  });
});
