import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const sendRaw = vi.fn();
const execute = vi.fn();
let embedded = true;

vi.mock("../../src/stores/ws.js", () => ({
  useWsStore: () => ({ sendRaw, execute }),
}));
vi.mock("../../src/composables/useShellMode.js", () => ({
  useShellMode: () => ({ isEmbedded: embedded }),
}));
vi.mock("../../src/utils/parsers.js", () => ({
  parseSkillOutput: (out) => out?.parsed || [],
}));

import { useSkillsStore } from "../../src/stores/skills.js";

describe("skills store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    sendRaw.mockReset();
    execute.mockReset();
    embedded = true;
  });

  describe("categories", () => {
    it('always includes "all" and dedups category + executionMode', () => {
      const s = useSkillsStore();
      s.allSkills = [
        { name: "a", category: "dev", executionMode: "local" },
        { name: "b", category: "dev", executionMode: "remote" },
        { name: "c" }, // no category / executionMode
      ];
      expect(s.categories).toEqual(["all", "dev", "local", "remote"]);
    });
  });

  describe("filteredSkills", () => {
    const skills = [
      { name: "Alpha", category: "dev", executionMode: "local", description: "first" },
      { name: "Beta", category: "ops", executionMode: "remote", title: "Second tool" },
    ];

    it("returns all when category=all and no query", () => {
      const s = useSkillsStore();
      s.allSkills = skills;
      expect(s.filteredSkills).toHaveLength(2);
    });

    it("filters by category OR executionMode", () => {
      const s = useSkillsStore();
      s.allSkills = skills;
      s.selectedCategory = "remote"; // matches executionMode
      expect(s.filteredSkills.map((x) => x.name)).toEqual(["Beta"]);
      s.selectedCategory = "dev"; // matches category
      expect(s.filteredSkills.map((x) => x.name)).toEqual(["Alpha"]);
    });

    it("search matches name / description / title case-insensitively", () => {
      const s = useSkillsStore();
      s.allSkills = skills;
      s.searchQuery = "ALPHA"; // name
      expect(s.filteredSkills.map((x) => x.name)).toEqual(["Alpha"]);
      s.searchQuery = "second"; // title
      expect(s.filteredSkills.map((x) => x.name)).toEqual(["Beta"]);
      s.searchQuery = "first"; // description
      expect(s.filteredSkills.map((x) => x.name)).toEqual(["Alpha"]);
    });

    it("combines category and search filters", () => {
      const s = useSkillsStore();
      s.allSkills = skills;
      s.selectedCategory = "dev";
      s.searchQuery = "beta"; // Beta is not in dev
      expect(s.filteredSkills).toHaveLength(0);
    });

    it("does not throw when skills lack name/description/title during search", () => {
      const s = useSkillsStore();
      s.allSkills = [{ category: "x" }];
      s.searchQuery = "foo";
      expect(() => s.filteredSkills).not.toThrow();
      expect(s.filteredSkills).toHaveLength(0);
    });
  });

  describe("loadSkills (embedded shell)", () => {
    it("populates allSkills from a well-formed skill.list reply", async () => {
      sendRaw.mockResolvedValue({ ok: true, result: { skills: [{ name: "x" }] } });
      const s = useSkillsStore();
      await s.loadSkills();
      expect(s.allSkills).toEqual([{ name: "x" }]);
      expect(s.loading).toBe(false);
      expect(execute).not.toHaveBeenCalled(); // must NOT fall back to ws.execute
    });

    it("sets allSkills empty when the reply is malformed", async () => {
      sendRaw.mockResolvedValue({ ok: false, error: "boom" });
      const s = useSkillsStore();
      await s.loadSkills();
      expect(s.allSkills).toEqual([]);
      expect(s.loading).toBe(false);
    });
  });
});
