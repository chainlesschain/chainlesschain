import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensurePluginTables,
  installPlugin,
  installPluginSkills,
  removePluginSkills,
  getPluginSkills,
} from "../../src/lib/plugin-manager.js";

describe("Plugin Skills Integration", () => {
  let db;
  let tempDir;

  beforeEach(() => {
    db = new MockDatabase();
    tempDir = mkdtempSync(join(tmpdir(), "cc-pluginskill-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ─── ensurePluginTables creates plugin_skills ─────────

  describe("ensurePluginTables", () => {
    it("creates plugin_skills table", () => {
      ensurePluginTables(db);
      expect(db.tables.has("plugin_skills")).toBe(true);
    });
  });

  // ─── installPluginSkills ──────────────────────────────

  describe("installPluginSkills", () => {
    it("returns empty when no skills declared", () => {
      const result = installPluginSkills(db, "test-plugin", tempDir, []);
      expect(result.installed).toEqual([]);
    });

    it("returns empty when skills is null", () => {
      const result = installPluginSkills(db, "test-plugin", tempDir, null);
      expect(result.installed).toEqual([]);
    });

    it("installs skills from plugin source directory", () => {
      // Create a mock plugin with skills
      const skillSrc = join(tempDir, "skills", "my-skill");
      mkdirSync(skillSrc, { recursive: true });
      writeFileSync(
        join(skillSrc, "SKILL.md"),
        "---\nname: my-skill\n---",
        "utf-8",
      );
      writeFileSync(
        join(skillSrc, "handler.js"),
        "export default {};",
        "utf-8",
      );

      const result = installPluginSkills(db, "test-plugin", tempDir, [
        { name: "my-skill", path: "skills/my-skill" },
      ]);

      expect(result.installed).toEqual(["my-skill"]);
    });

    it("records skill in database", () => {
      const skillSrc = join(tempDir, "skills", "db-skill");
      mkdirSync(skillSrc, { recursive: true });
      writeFileSync(
        join(skillSrc, "SKILL.md"),
        "---\nname: db-skill\n---",
        "utf-8",
      );

      installPluginSkills(db, "test-plugin", tempDir, [
        { name: "db-skill", path: "skills/db-skill" },
      ]);

      const skills = getPluginSkills(db, "test-plugin");
      expect(skills).toHaveLength(1);
      expect(skills[0].skill_name).toBe("db-skill");
    });

    it("skips skills with non-existent source directory", () => {
      const result = installPluginSkills(db, "test-plugin", tempDir, [
        { name: "missing-skill", path: "skills/nonexistent" },
      ]);

      expect(result.installed).toEqual([]);
    });

    it("installs multiple skills from one plugin", () => {
      const skill1 = join(tempDir, "skills", "skill-a");
      const skill2 = join(tempDir, "skills", "skill-b");
      mkdirSync(skill1, { recursive: true });
      mkdirSync(skill2, { recursive: true });
      writeFileSync(
        join(skill1, "SKILL.md"),
        "---\nname: skill-a\n---",
        "utf-8",
      );
      writeFileSync(
        join(skill2, "SKILL.md"),
        "---\nname: skill-b\n---",
        "utf-8",
      );

      const result = installPluginSkills(db, "test-plugin", tempDir, [
        { name: "skill-a", path: "skills/skill-a" },
        { name: "skill-b", path: "skills/skill-b" },
      ]);

      expect(result.installed).toEqual(["skill-a", "skill-b"]);
    });
  });

  // ─── getPluginSkills ──────────────────────────────────

  describe("getPluginSkills", () => {
    it("returns empty array for plugin with no skills", () => {
      ensurePluginTables(db);
      expect(getPluginSkills(db, "no-skills")).toEqual([]);
    });

    it("returns skills for a plugin", () => {
      const skillSrc = join(tempDir, "skills", "test-skill");
      mkdirSync(skillSrc, { recursive: true });
      writeFileSync(join(skillSrc, "SKILL.md"), "skill", "utf-8");

      installPluginSkills(db, "my-plugin", tempDir, [
        { name: "test-skill", path: "skills/test-skill" },
      ]);

      const skills = getPluginSkills(db, "my-plugin");
      expect(skills).toHaveLength(1);
      expect(skills[0].skill_name).toBe("test-skill");
      expect(skills[0].skill_path).toBeTruthy();
    });
  });

  // ─── removePluginSkills ───────────────────────────────

  describe("removePluginSkills", () => {
    it("returns empty array when plugin has no skills", () => {
      ensurePluginTables(db);
      const result = removePluginSkills(db, "no-skills");
      expect(result.removed).toEqual([]);
    });

    it("removes skills and cleans up DB records", () => {
      const skillSrc = join(tempDir, "skills", "rem-skill");
      mkdirSync(skillSrc, { recursive: true });
      writeFileSync(join(skillSrc, "SKILL.md"), "skill", "utf-8");

      installPluginSkills(db, "my-plugin", tempDir, [
        { name: "rem-skill", path: "skills/rem-skill" },
      ]);

      // Verify skill exists in DB
      expect(getPluginSkills(db, "my-plugin")).toHaveLength(1);

      const result = removePluginSkills(db, "my-plugin");
      expect(result.removed).toEqual(["rem-skill"]);

      // DB records should be gone
      expect(getPluginSkills(db, "my-plugin")).toEqual([]);
    });

    it("removes multiple skills from one plugin", () => {
      const skill1 = join(tempDir, "skills", "s1");
      const skill2 = join(tempDir, "skills", "s2");
      mkdirSync(skill1, { recursive: true });
      mkdirSync(skill2, { recursive: true });
      writeFileSync(join(skill1, "SKILL.md"), "skill", "utf-8");
      writeFileSync(join(skill2, "SKILL.md"), "skill", "utf-8");

      installPluginSkills(db, "my-plugin", tempDir, [
        { name: "s1", path: "skills/s1" },
        { name: "s2", path: "skills/s2" },
      ]);

      const result = removePluginSkills(db, "my-plugin");
      expect(result.removed).toHaveLength(2);
      expect(result.removed).toContain("s1");
      expect(result.removed).toContain("s2");
    });
  });
});
