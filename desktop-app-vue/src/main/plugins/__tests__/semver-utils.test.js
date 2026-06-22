import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import semver from "../semver-utils.js";
const {
  parseVersion,
  parseRange,
  compareVersions,
  satisfies,
  gt,
  gte,
  lt,
  lte,
  eq,
  valid,
  clean,
} = semver;

describe("semver-utils", () => {
  describe("parseVersion", () => {
    it("parses major.minor.patch", () => {
      expect(parseVersion("1.2.3")).toMatchObject({
        major: 1,
        minor: 2,
        patch: 3,
        prerelease: null,
        build: null,
      });
    });

    it("strips a leading v or = prefix", () => {
      expect(parseVersion("v1.2.3")).toMatchObject({ major: 1, patch: 3 });
      expect(parseVersion("=1.2.3")).toMatchObject({ major: 1, patch: 3 });
    });

    it("captures prerelease and build metadata", () => {
      expect(parseVersion("1.2.3-beta.1+exp.sha.5")).toMatchObject({
        prerelease: "beta.1",
        build: "exp.sha.5",
      });
    });

    it("keeps the raw input", () => {
      expect(parseVersion("v1.2.3").raw).toBe("v1.2.3");
    });

    it("returns null for invalid / partial / non-string input", () => {
      for (const bad of ["1.2", "1", "abc", "1.2.x", "", null, undefined, 123]) {
        expect(parseVersion(bad)).toBeNull();
      }
    });
  });

  describe("compareVersions", () => {
    it("orders by major, then minor, then patch", () => {
      expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
      expect(compareVersions("1.2.0", "1.1.9")).toBe(1);
      expect(compareVersions("1.1.2", "1.1.1")).toBe(1);
      expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
      expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
    });

    it("ranks a release above its prereleases", () => {
      expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBe(1);
      expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBe(-1);
    });

    it("orders prerelease identifiers numerically, not lexically (regression)", () => {
      // localeCompare would put alpha.10 < alpha.2 ("1" < "2"); semver says
      // alpha.10 > alpha.2.
      expect(compareVersions("1.0.0-alpha.2", "1.0.0-alpha.10")).toBe(-1);
      expect(compareVersions("1.0.0-alpha.10", "1.0.0-alpha.2")).toBe(1);
    });

    it("orders prerelease alphanumerics and field counts per spec", () => {
      expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
      expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1); // fewer fields ranks lower
      expect(compareVersions("1.0.0-alpha.1", "1.0.0-alpha.1")).toBe(0);
      // numeric identifiers rank below alphanumeric
      expect(compareVersions("1.0.0-1", "1.0.0-alpha")).toBe(-1);
    });

    it("ignores build metadata in ordering", () => {
      expect(compareVersions("1.0.0+build.1", "1.0.0+build.999")).toBe(0);
    });

    it("only ever returns -1, 0 or 1", () => {
      for (const [a, b] of [
        ["1.0.0-alpha.10", "1.0.0-alpha.2"],
        ["3.0.0", "1.0.0"],
        ["1.0.0", "1.0.0"],
      ]) {
        expect([-1, 0, 1]).toContain(compareVersions(a, b));
      }
    });

    it("throws on an unparseable version", () => {
      expect(() => compareVersions("nope", "1.0.0")).toThrow();
      expect(() => compareVersions("1.0.0", "nope")).toThrow();
    });
  });

  describe("parseRange", () => {
    it("treats *, x and empty as any", () => {
      for (const r of ["*", "x", "", "   "]) {
        expect(parseRange(r)).toMatchObject({ type: "any", valid: true });
      }
      expect(parseRange(null)).toMatchObject({ type: "any", valid: true });
    });

    it("parses comparator operators", () => {
      expect(parseRange(">=1.0.0")).toMatchObject({ type: ">=", version: "1.0.0" });
      expect(parseRange(">1.0.0")).toMatchObject({ type: ">", version: "1.0.0" });
      expect(parseRange("<=1.0.0")).toMatchObject({ type: "<=", version: "1.0.0" });
      expect(parseRange("<1.0.0")).toMatchObject({ type: "<", version: "1.0.0" });
      expect(parseRange("=1.0.0")).toMatchObject({ type: "=", version: "1.0.0" });
    });

    it("computes caret upper bounds per the leftmost non-zero rule", () => {
      expect(parseRange("^1.2.3")).toMatchObject({ min: "1.2.3", max: "2.0.0" });
      expect(parseRange("^0.2.3")).toMatchObject({ min: "0.2.3", max: "0.3.0" });
      expect(parseRange("^0.0.3")).toMatchObject({ min: "0.0.3", max: "0.0.4" });
    });

    it("computes tilde upper bound at the next minor", () => {
      expect(parseRange("~1.2.3")).toMatchObject({ min: "1.2.3", max: "1.3.0" });
    });

    it("expands x-ranges", () => {
      expect(parseRange("1.2.x")).toMatchObject({ min: "1.2.0", max: "1.3.0" });
      expect(parseRange("1.x")).toMatchObject({ min: "1.0.0", max: "2.0.0" });
    });

    it("treats a bare exact version as =", () => {
      expect(parseRange("1.2.3")).toMatchObject({ type: "=", valid: true });
    });

    it("flags invalid operator operands and unknown ranges", () => {
      expect(parseRange(">=bad")).toMatchObject({ type: ">=", valid: false });
      expect(parseRange("^bad")).toMatchObject({ valid: false });
      expect(parseRange("not-a-range")).toMatchObject({ valid: false });
    });
  });

  describe("satisfies", () => {
    it("any range matches any valid version", () => {
      expect(satisfies("9.9.9", "*")).toBe(true);
    });

    it("honors each comparator operator", () => {
      expect(satisfies("1.0.0", ">=1.0.0")).toBe(true);
      expect(satisfies("0.9.9", ">=1.0.0")).toBe(false);
      expect(satisfies("1.0.1", ">1.0.0")).toBe(true);
      expect(satisfies("1.0.0", ">1.0.0")).toBe(false);
      expect(satisfies("1.0.0", "<=1.0.0")).toBe(true);
      expect(satisfies("1.0.1", "<1.0.1")).toBe(false);
      expect(satisfies("1.0.0", "=1.0.0")).toBe(true);
      expect(satisfies("1.0.1", "=1.0.0")).toBe(false);
    });

    it("respects caret bounds", () => {
      expect(satisfies("1.2.3", "^1.2.3")).toBe(true);
      expect(satisfies("1.9.9", "^1.2.3")).toBe(true);
      expect(satisfies("2.0.0", "^1.2.3")).toBe(false);
      expect(satisfies("1.2.2", "^1.2.3")).toBe(false);
      expect(satisfies("0.2.9", "^0.2.3")).toBe(true);
      expect(satisfies("0.3.0", "^0.2.3")).toBe(false);
    });

    it("respects tilde and x-range bounds", () => {
      expect(satisfies("1.2.9", "~1.2.3")).toBe(true);
      expect(satisfies("1.3.0", "~1.2.3")).toBe(false);
      expect(satisfies("1.2.9", "1.2.x")).toBe(true);
      expect(satisfies("1.3.0", "1.2.x")).toBe(false);
    });

    it("returns false (never throws) for an unparseable version (regression)", () => {
      expect(satisfies("not-a-version", ">=1.0.0")).toBe(false);
      expect(satisfies("garbage", "^1.0.0")).toBe(false);
      expect(satisfies("garbage", "*")).toBe(false);
    });

    it("returns false for an invalid range", () => {
      expect(satisfies("1.0.0", "not-a-range")).toBe(false);
    });
  });

  describe("comparator helpers", () => {
    it("gt / gte / lt / lte / eq", () => {
      expect(gt("1.0.1", "1.0.0")).toBe(true);
      expect(gt("1.0.0", "1.0.0")).toBe(false);
      expect(gte("1.0.0", "1.0.0")).toBe(true);
      expect(lt("1.0.0", "1.0.1")).toBe(true);
      expect(lte("1.0.0", "1.0.0")).toBe(true);
      expect(eq("1.0.0", "1.0.0")).toBe(true);
      expect(eq("1.0.0", "1.0.1")).toBe(false);
    });
  });

  describe("valid / clean", () => {
    it("valid mirrors parseVersion", () => {
      expect(valid("1.2.3")).toBe(true);
      expect(valid("v1.2.3")).toBe(true);
      expect(valid("nope")).toBe(false);
    });

    it("clean normalizes away the prefix but keeps prerelease/build", () => {
      expect(clean("v1.2.3")).toBe("1.2.3");
      expect(clean("=1.2.3-beta.1")).toBe("1.2.3-beta.1");
      expect(clean("1.2.3+build.7")).toBe("1.2.3+build.7");
      expect(clean("nope")).toBeNull();
    });
  });
});
