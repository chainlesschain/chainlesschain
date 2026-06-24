/**
 * isWithinDir — directory-boundary check (sibling-prefix traversal guard).
 *
 * The bug this guards against: a bare `target.startsWith(base)` admits a sibling
 * directory whose name extends the base name (base ".../foo" admits
 * ".../foo-evil/x"). isWithinDir requires equality or base+separator, blocking
 * that bypass while still allowing legitimate in-dir paths and the dir itself.
 */

import { describe, it, expect } from "vitest";

const path = require("path");
const { isWithinDir } = require("../path-boundary.js");

describe("isWithinDir", () => {
  const base = path.resolve("/srv/app/base");

  it("allows a path inside the base dir", () => {
    expect(isWithinDir(base, path.resolve(base, "src/app.js"))).toBe(true);
  });

  it("allows the base dir itself", () => {
    expect(isWithinDir(base, base)).toBe(true);
  });

  it("blocks a sibling dir whose name extends the base name", () => {
    // ".../base-evil/x" — the sibling-prefix bypass
    const sibling = path.resolve(base, "..", "base-evil", "x.js");
    expect(isWithinDir(base, sibling)).toBe(false);
  });

  it("blocks a parent-directory escape", () => {
    const escape = path.resolve(base, "..", "..", "..", "etc", "passwd");
    expect(isWithinDir(base, escape)).toBe(false);
  });

  it("handles a base dir that already ends with a separator", () => {
    const baseSep = base + path.sep;
    expect(isWithinDir(baseSep, path.resolve(base, "a.txt"))).toBe(true);
    expect(
      isWithinDir(baseSep, path.resolve(base, "..", "base-evil", "x")),
    ).toBe(false);
  });

  it("returns false for non-string inputs", () => {
    expect(isWithinDir(base, null)).toBe(false);
    expect(isWithinDir(undefined, base)).toBe(false);
  });
});
