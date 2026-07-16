/**
 * workspace-roots — pure multi-root helpers for the LSP layer (P2 LSP slice).
 * Root selection keys the shared language-server pool; a wrong pick silently
 * spawns the wrong project's server, so containment (deepest-wins) and the
 * out-of-root fallback are pinned here.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  workspaceRootsFor,
  pickRootForFile,
  mergeWorkspaceSymbolResults,
} from "../../src/lib/lsp/workspace-roots.js";

const R = (...parts) => path.resolve(path.join(path.sep, ...parts));

describe("workspaceRootsFor", () => {
  it("puts cwd first, resolves and dedupes additional directories", () => {
    const cwd = R("proj", "app");
    const roots = workspaceRootsFor(cwd, [
      R("proj", "lib"),
      R("proj", "app"), // duplicate of cwd → dropped
      R("proj", "lib"), // duplicate of itself → dropped
    ]);
    expect(roots).toEqual([R("proj", "app"), R("proj", "lib")]);
  });

  it("ignores non-string / empty entries and a null list", () => {
    const cwd = R("proj");
    expect(workspaceRootsFor(cwd, null)).toEqual([R("proj")]);
    expect(workspaceRootsFor(cwd, [null, "", 42])).toEqual([R("proj")]);
  });

  it("never returns empty (falls back to process.cwd())", () => {
    const roots = workspaceRootsFor(undefined, []);
    expect(roots).toEqual([path.resolve(process.cwd())]);
  });
});

describe("pickRootForFile", () => {
  const roots = [R("work", "app"), R("work", "lib"), R("work", "lib", "core")];

  it("picks the containing root", () => {
    expect(pickRootForFile(R("work", "lib", "x.ts"), roots)).toBe(
      R("work", "lib"),
    );
  });

  it("deepest containing root wins for nested roots", () => {
    expect(pickRootForFile(R("work", "lib", "core", "y.ts"), roots)).toBe(
      R("work", "lib", "core"),
    );
  });

  it("falls back to the first root (cwd) for out-of-root files", () => {
    expect(pickRootForFile(R("elsewhere", "z.ts"), roots)).toBe(
      R("work", "app"),
    );
  });

  it("a file AT a root resolves to that root (no separator suffix trap)", () => {
    expect(pickRootForFile(R("work", "lib"), roots)).toBe(R("work", "lib"));
    // …and a SIBLING with the root as a name prefix must NOT match it.
    expect(pickRootForFile(R("work", "library", "a.ts"), roots)).toBe(
      R("work", "app"),
    );
  });

  it("handles missing file / empty roots defensively", () => {
    expect(pickRootForFile(null, roots)).toBe(roots[0]);
    expect(pickRootForFile(R("a"), [])).toBe(path.resolve(process.cwd()));
  });
});

describe("mergeWorkspaceSymbolResults", () => {
  const roots = [R("a"), R("b")];

  it("concatenates symbols in root order and stamps each with its root", () => {
    const merged = mergeWorkspaceSymbolResults(
      [
        { available: true, symbols: [{ name: "foo" }] },
        { available: true, symbols: [{ name: "bar" }, { name: "baz" }] },
      ],
      roots,
    );
    expect(merged.available).toBe(true);
    expect(merged.symbols).toEqual([
      { name: "foo", root: R("a") },
      { name: "bar", root: R("b") },
      { name: "baz", root: R("b") },
    ]);
  });

  it("is available when ANY root answered; unavailable roots are skipped", () => {
    const merged = mergeWorkspaceSymbolResults(
      [
        { available: false, reason: "no server" },
        { available: true, symbols: [{ name: "only" }] },
      ],
      roots,
    );
    expect(merged.available).toBe(true);
    expect(merged.symbols).toEqual([{ name: "only", root: R("b") }]);
  });

  it("folds every reason when all roots are unavailable", () => {
    const merged = mergeWorkspaceSymbolResults(
      [
        { available: false, reason: "no server" },
        { available: false, reason: "quarantined" },
      ],
      roots,
    );
    expect(merged.available).toBe(false);
    expect(merged.reason).toContain(`${R("a")}: no server`);
    expect(merged.reason).toContain(`${R("b")}: quarantined`);
  });

  it("handles empty input", () => {
    expect(mergeWorkspaceSymbolResults([], [])).toEqual({
      available: false,
      reason: "language server unavailable",
    });
  });
});
