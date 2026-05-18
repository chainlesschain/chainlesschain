import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-tech-uuid-001"),
}));

let mockRunStmt, mockAllStmt, mockDb;
let TechLearningEngine,
  getTechLearningEngine,
  PROFILE_STATUS,
  PRACTICE_STATUS,
  SUPPORTED_MANIFESTS;

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
    await import("../../../src/main/ai-engine/autonomous/tech-learning-engine.js");
  TechLearningEngine = mod.TechLearningEngine;
  getTechLearningEngine = mod.getTechLearningEngine;
  PROFILE_STATUS = mod.PROFILE_STATUS;
  PRACTICE_STATUS = mod.PRACTICE_STATUS;
  SUPPORTED_MANIFESTS = mod.SUPPORTED_MANIFESTS;
});

describe("Constants", () => {
  it("should define PROFILE_STATUS", () => {
    expect(PROFILE_STATUS.DETECTED).toBe("detected");
    expect(PROFILE_STATUS.COMPLETE).toBe("complete");
  });

  it("should define PRACTICE_STATUS", () => {
    expect(PRACTICE_STATUS.EXTRACTED).toBe("extracted");
    expect(PRACTICE_STATUS.PROMOTED).toBe("promoted");
  });

  it("should define SUPPORTED_MANIFESTS", () => {
    expect(SUPPORTED_MANIFESTS).toContain("package.json");
    expect(SUPPORTED_MANIFESTS).toContain("pom.xml");
  });
});

describe("TechLearningEngine", () => {
  let engine;

  beforeEach(() => {
    engine = new TechLearningEngine({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with defaults", () => {
      expect(engine.initialized).toBe(false);
      expect(engine._profiles).toBeInstanceOf(Map);
      expect(engine._practices).toBeInstanceOf(Map);
      expect(engine._autoPromoteConfidence).toBe(0.85);
    });
  });

  describe("initialize()", () => {
    it("should set initialized to true", async () => {
      await engine.initialize();
      expect(engine.initialized).toBe(true);
    });
  });

  describe("_ensureTables()", () => {
    it("should create tables", () => {
      engine._ensureTables();
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS tech_stack_profiles");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS learned_practices");
    });
  });

  describe("detectStack()", () => {
    it("should throw if projectPath is missing", async () => {
      await expect(engine.detectStack({})).rejects.toThrow(
        "Project path is required",
      );
    });

    it("should detect stack for a project", async () => {
      const profile = await engine.detectStack({
        projectPath: "/home/project",
      });
      expect(profile.project_path).toBe("/home/project");
      expect(profile.languages).toBeInstanceOf(Array);
      expect(profile.frameworks).toBeInstanceOf(Array);
      expect(profile.status).toBe("complete");
    });

    it("should persist to DB", async () => {
      await engine.detectStack({ projectPath: "/path" });
      expect(mockRunStmt.run).toHaveBeenCalled();
    });
  });

  describe("getProfiles()", () => {
    it("should return profiles from memory", async () => {
      const m = new TechLearningEngine(null);
      m._profiles.set("p1", { id: "p1" });
      const profiles = await m.getProfiles();
      expect(profiles).toHaveLength(1);
    });
  });

  describe("extractPractices()", () => {
    it("should throw if profileId is missing", async () => {
      await expect(engine.extractPractices({})).rejects.toThrow(
        "Profile ID is required",
      );
    });

    it("should throw if profile not found", async () => {
      await expect(
        engine.extractPractices({ profileId: "nonexistent" }),
      ).rejects.toThrow("Profile not found");
    });

    it("should extract practices for a profile", async () => {
      engine._profiles.set("p1", { id: "p1" });
      const practices = await engine.extractPractices({ profileId: "p1" });
      expect(practices).toBeInstanceOf(Array);
      expect(practices.length).toBeGreaterThan(0);
    });
  });

  describe("synthesizeSkill()", () => {
    it("should throw if practiceId is missing", async () => {
      await expect(engine.synthesizeSkill({})).rejects.toThrow(
        "Practice ID is required",
      );
    });

    it("should throw if practice not found", async () => {
      await expect(
        engine.synthesizeSkill({ practiceId: "nonexistent" }),
      ).rejects.toThrow("Practice not found");
    });

    it("should synthesize skill from practice", async () => {
      engine._practices.set("pr1", {
        id: "pr1",
        title: "Test Practice",
        description: "desc",
        confidence: 0.9,
      });
      const skill = await engine.synthesizeSkill({ practiceId: "pr1" });
      expect(skill.name).toContain("skill-");
    });
  });

  describe("close()", () => {
    it("should reset state", async () => {
      engine._profiles.set("p1", {});
      await engine.close();
      expect(engine._profiles.size).toBe(0);
      expect(engine.initialized).toBe(false);
    });
  });

  describe("getTechLearningEngine singleton", () => {
    it("should return an instance", () => {
      const instance = getTechLearningEngine();
      expect(instance).toBeInstanceOf(TechLearningEngine);
    });
  });
});
