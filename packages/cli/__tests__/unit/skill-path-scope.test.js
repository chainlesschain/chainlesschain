import { describe, it, expect } from "vitest";
import {
  normalizeSkillPaths,
  relCwdForCwd,
  skillAppliesToCwd,
  filterSkillsByRelCwd,
} from "../../src/lib/skill-path-scope.js";
import { parseSkillMd } from "../../src/lib/skill-loader.js";
import path from "node:path";

describe("skill-path-scope", () => {
  describe("normalizeSkillPaths", () => {
    it("normalizes string, array, aliases; null when absent/empty", () => {
      expect(normalizeSkillPaths({ paths: "packages/cli/**" })).toEqual([
        "packages/cli/**",
      ]);
      expect(normalizeSkillPaths({ paths: [" a/** ", "", "b/**"] })).toEqual([
        "a/**",
        "b/**",
      ]);
      // aliases: globs / pathScope
      expect(normalizeSkillPaths({ globs: "x/**" })).toEqual(["x/**"]);
      expect(normalizeSkillPaths({ pathScope: "y/**" })).toEqual(["y/**"]);
      // no scope → null (applies everywhere)
      expect(normalizeSkillPaths({})).toBeNull();
      expect(normalizeSkillPaths({ paths: [] })).toBeNull();
      expect(normalizeSkillPaths({ paths: ["  ", ""] })).toBeNull();
      expect(normalizeSkillPaths(null)).toBeNull();
    });

    it("reads a paths: frontmatter list off a SKILL.md via parseSkillMd", () => {
      const md = [
        "---",
        "name: cli-only",
        "paths:",
        "  - packages/cli/**",
        "  - packages/core-*/**",
        "---",
        "body",
      ].join("\n");
      const { data } = parseSkillMd(md);
      expect(normalizeSkillPaths(data)).toEqual([
        "packages/cli/**",
        "packages/core-*/**",
      ]);
    });
  });

  describe("relCwdForCwd", () => {
    const root = path.join(path.sep, "repo");
    it("returns forward-slashed cwd relative to root", () => {
      expect(relCwdForCwd(path.join(root, "packages", "cli"), root)).toBe(
        "packages/cli",
      );
    });
    it("root itself, outside-root, and missing args resolve to '' (all apply)", () => {
      expect(relCwdForCwd(root, root)).toBe("");
      expect(relCwdForCwd(path.join(path.sep, "elsewhere"), root)).toBe("");
      expect(relCwdForCwd(null, root)).toBe("");
      expect(relCwdForCwd(root, null)).toBe("");
    });
  });

  describe("skillAppliesToCwd", () => {
    const scoped = { id: "cli", paths: ["packages/cli/**"] };
    const global = { id: "any", paths: null };
    it("an unscoped skill applies everywhere", () => {
      expect(skillAppliesToCwd(global, "android-app")).toBe(true);
      expect(skillAppliesToCwd(global, "")).toBe(true);
    });
    it("a scoped skill applies inside/at its subtree and the root, not a sibling", () => {
      expect(skillAppliesToCwd(scoped, "packages/cli")).toBe(true);
      expect(skillAppliesToCwd(scoped, "packages/cli/src")).toBe(true);
      expect(skillAppliesToCwd(scoped, "")).toBe(true); // at root everything is in play
      expect(skillAppliesToCwd(scoped, "android-app")).toBe(false);
      expect(skillAppliesToCwd(scoped, "packages/core-db")).toBe(false);
    });
  });

  describe("filterSkillsByRelCwd", () => {
    const skills = [
      { id: "a", paths: null },
      { id: "b", paths: ["packages/cli/**"] },
      { id: "c", paths: ["android-app/**"] },
    ];
    it("keeps unscoped + in-scope skills, drops out-of-scope ones", () => {
      expect(
        filterSkillsByRelCwd(skills, "packages/cli").map((s) => s.id),
      ).toEqual(["a", "b"]);
      expect(
        filterSkillsByRelCwd(skills, "android-app").map((s) => s.id),
      ).toEqual(["a", "c"]);
      // at root every skill applies
      expect(filterSkillsByRelCwd(skills, "").map((s) => s.id)).toEqual([
        "a",
        "b",
        "c",
      ]);
    });
    it("passes through a non-array unchanged", () => {
      expect(filterSkillsByRelCwd(null, "x")).toBeNull();
    });
  });
});
