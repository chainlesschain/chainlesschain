import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("uuid", () => ({ v4: vi.fn(() => "test-uuid-001") }));

let mockRunStmt, mockAllStmt, mockDb;
let SkillServiceProtocol, getSkillServiceProtocol, SKILL_STATUS;

beforeEach(async () => {
  mockRunStmt = { run: vi.fn() };
  mockAllStmt = { all: vi.fn(() => []) };
  mockDb = {
    exec: vi.fn(),
    prepare: vi.fn((sql) => {
      if (sql.includes("INSERT") || sql.includes("UPDATE")) {
        return mockRunStmt;
      }
      if (sql.includes("SELECT")) {
        return mockAllStmt;
      }
      return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
    }),
  };
  const mod =
    await import("../../../src/main/marketplace/skill-service-protocol.js");
  SkillServiceProtocol = mod.SkillServiceProtocol;
  getSkillServiceProtocol = mod.getSkillServiceProtocol;
  SKILL_STATUS = mod.SKILL_STATUS;
});

describe("SkillServiceProtocol", () => {
  let protocol;
  beforeEach(() => {
    protocol = new SkillServiceProtocol({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with defaults", () => {
      expect(protocol.initialized).toBe(false);
      expect(protocol._skills).toBeInstanceOf(Map);
    });
  });

  describe("initialize()", () => {
    it("should set initialized to true", async () => {
      await protocol.initialize();
      expect(protocol.initialized).toBe(true);
    });
  });

  describe("_ensureTables()", () => {
    it("should create tables", () => {
      protocol._ensureTables();
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain(
        "CREATE TABLE IF NOT EXISTS skill_service_registry",
      );
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS skill_invocations");
    });
  });

  describe("publishSkill()", () => {
    it("should throw if name is missing", async () => {
      await expect(protocol.publishSkill({})).rejects.toThrow(
        "Skill name is required",
      );
    });
    it("should publish skill", async () => {
      const skill = await protocol.publishSkill({ name: "test-skill" });
      expect(skill.name).toBe("test-skill");
      expect(skill.status).toBe("published");
    });
    it("should persist to DB", async () => {
      await protocol.publishSkill({ name: "test" });
      expect(mockRunStmt.run).toHaveBeenCalled();
    });
  });

  describe("listSkills()", () => {
    it("should return from in-memory", async () => {
      const p = new SkillServiceProtocol(null);
      p._skills.set("s1", { id: "s1", status: "published" });
      const skills = await p.listSkills();
      expect(skills).toHaveLength(1);
    });
  });

  describe("invokeRemote()", () => {
    it("should throw if skillId is missing", async () => {
      await expect(protocol.invokeRemote({})).rejects.toThrow(
        "Skill ID is required",
      );
    });
  });

  describe("composePipeline()", () => {
    it("should throw if name is missing", async () => {
      await expect(protocol.composePipeline({})).rejects.toThrow(
        "Pipeline name is required",
      );
    });
  });

  describe("close()", () => {
    it("should reset state", async () => {
      protocol._skills.set("s1", {});
      await protocol.close();
      expect(protocol._skills.size).toBe(0);
      expect(protocol.initialized).toBe(false);
    });
  });

  describe("getSingleton", () => {
    it("should return instance", () => {
      const instance = getSkillServiceProtocol();
      expect(instance).toBeInstanceOf(SkillServiceProtocol);
    });
  });
});
