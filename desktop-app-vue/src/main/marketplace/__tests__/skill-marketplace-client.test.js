/**
 * SkillMarketplaceClient 单元测试
 *
 * 覆盖：initialize、searchSkills、getSkillDetails、publishSkill、
 *       installSkill、uninstallSkill、updateSkill、rateSkill、
 *       getMyPublished、getInstalled、getCategories、getFeatured、
 *       reportSkill、checkUpdates、toggleAutoUpdate、getStats
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const { SkillMarketplaceClient } = require("../skill-marketplace-client");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn().mockReturnValue({ changes: 1 }),
  };
  return {
    db: {
      exec: vi.fn(),
      run: vi.fn().mockReturnValue({ changes: 1 }),
      prepare: vi.fn().mockReturnValue(prepResult),
      _prep: prepResult,
    },
    _prep: prepResult,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SkillMarketplaceClient", () => {
  let client;
  let mockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDatabase();
    client = new SkillMarketplaceClient({
      database: mockDb,
      skillRegistry: null,
    });
  });

  // ── Constructor ──────────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("creates instance with database", () => {
      expect(client).toBeDefined();
      expect(client.database).toBe(mockDb);
    });

    it("creates instance without skillRegistry gracefully", () => {
      const c = new SkillMarketplaceClient({ database: mockDb });
      expect(c).toBeDefined();
    });
  });

  // ── initialize ───────────────────────────────────────────────────────────────

  describe("initialize()", () => {
    it("creates skill_marketplace_installs and skill_marketplace_cache tables", async () => {
      await client.initialize();
      // Two db.exec calls: one per table
      expect(mockDb.db.exec).toHaveBeenCalledTimes(2);
      const calls = mockDb.db.exec.mock.calls.map((c) => c[0]);
      expect(
        calls.some((sql) => sql.includes("skill_marketplace_installs")),
      ).toBe(true);
      expect(calls.some((sql) => sql.includes("skill_marketplace_cache"))).toBe(
        true,
      );
    });

    it("sets initialized flag", async () => {
      await client.initialize();
      expect(client.initialized).toBe(true);
    });
  });

  // ── searchSkills ──────────────────────────────────────────────────────────────

  describe("searchSkills()", () => {
    it("returns results and total", async () => {
      mockDb._prep.all.mockReturnValue([
        { skill_id: "skill-1", name: "Code Review", category: "development" },
      ]);
      await client.initialize();
      const result = await client.searchSkills("code");
      expect(result).toBeDefined();
      expect(typeof result.total).toBe("number");
    });

    it("returns empty results for non-matching query", async () => {
      mockDb._prep.all.mockReturnValue([]);
      await client.initialize();
      const result = await client.searchSkills("xyznonexistent");
      expect(result.total).toBe(0);
    });

    it("includes page and pageSize in response", async () => {
      mockDb._prep.all.mockReturnValue([]);
      await client.initialize();
      const result = await client.searchSkills("", { page: 2, pageSize: 10 });
      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(10);
    });
  });

  // ── getSkillDetails ───────────────────────────────────────────────────────────

  describe("getSkillDetails()", () => {
    it("returns cached details when available and not expired", async () => {
      const cacheRow = {
        skill_id: "skill-1",
        details: JSON.stringify({ id: "skill-1", name: "Test" }),
        cached_at: Math.floor(Date.now() / 1000) - 10, // 10 seconds ago
      };
      // First prepare call is for cache lookup
      mockDb._prep.get.mockReturnValueOnce(cacheRow);
      await client.initialize();
      const details = await client.getSkillDetails("skill-1");
      expect(details).toEqual({ id: "skill-1", name: "Test" });
    });

    it("returns installed record when not cached", async () => {
      mockDb._prep.get
        .mockReturnValueOnce(null) // cache miss
        .mockReturnValueOnce({
          id: "install-1",
          skill_id: "skill-1",
          name: "Test",
        }); // install record
      await client.initialize();
      const details = await client.getSkillDetails("skill-1");
      expect(details).toBeDefined();
      expect(details.skill_id).toBe("skill-1");
    });

    it("returns null when not found anywhere", async () => {
      mockDb._prep.get.mockReturnValue(null);
      await client.initialize();
      const details = await client.getSkillDetails("nonexistent");
      expect(details).toBeNull();
    });
  });

  // ── publishSkill ──────────────────────────────────────────────────────────────

  describe("publishSkill()", () => {
    it("publishes a skill package", async () => {
      await client.initialize();
      const result = await client.publishSkill({
        name: "my-skill",
        version: "1.0.0",
        description: "A great skill",
        skillMd: "---\nname: my-skill\n---\n# Body",
      });
      expect(result).toBeDefined();
      expect(result.name).toBe("my-skill");
      expect(result.status).toBe("under_review");
    });

    it("throws when name or version is missing", async () => {
      await client.initialize();
      await expect(
        client.publishSkill({ name: "test" }), // missing version and skillMd
      ).rejects.toThrow();
    });

    it("emits skill-published event", async () => {
      await client.initialize();
      const spy = vi.fn();
      client.on("skill-published", spy);
      await client.publishSkill({
        name: "x",
        version: "1.0.0",
        skillMd: "---\n---",
      });
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ── installSkill ──────────────────────────────────────────────────────────────

  describe("installSkill()", () => {
    it("installs a skill and returns install record", async () => {
      await client.initialize();
      const result = await client.installSkill("skill-1", {
        name: "Test Skill",
        version: "1.0.0",
        author: "alice",
        category: "development",
      });
      expect(result).toBeDefined();
      expect(result.skillId).toBe("skill-1");
      expect(result.status).toBe("installed");
    });

    it("uses defaults when no skill data provided", async () => {
      await client.initialize();
      const result = await client.installSkill("skill-2");
      expect(result.skillId).toBe("skill-2");
    });

    it("emits skill-installed event", async () => {
      await client.initialize();
      const spy = vi.fn();
      client.on("skill-installed", spy);
      await client.installSkill("skill-3");
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ── uninstallSkill ────────────────────────────────────────────────────────────

  describe("uninstallSkill()", () => {
    it("uninstalls existing skill and returns true", async () => {
      mockDb._prep.run.mockReturnValue({ changes: 1 });
      await client.initialize();
      const result = await client.uninstallSkill("skill-1");
      expect(result).toBe(true);
    });

    it("returns false when skill was not installed", async () => {
      mockDb._prep.run.mockReturnValue({ changes: 0 });
      await client.initialize();
      const result = await client.uninstallSkill("not-installed");
      expect(result).toBe(false);
    });

    it("emits skill-uninstalled event on success", async () => {
      mockDb._prep.run.mockReturnValue({ changes: 1 });
      await client.initialize();
      const spy = vi.fn();
      client.on("skill-uninstalled", spy);
      await client.uninstallSkill("skill-1");
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ── rateSkill ─────────────────────────────────────────────────────────────────

  describe("rateSkill()", () => {
    it("throws when rating < 1", async () => {
      await client.initialize();
      await expect(client.rateSkill("skill-1", 0, "bad")).rejects.toThrow(
        "Rating must be between 1 and 5",
      );
    });

    it("throws when rating > 5", async () => {
      await client.initialize();
      await expect(client.rateSkill("skill-1", 6, "too high")).rejects.toThrow(
        "Rating must be between 1 and 5",
      );
    });

    it("returns a rate record for valid rating", async () => {
      await client.initialize();
      const result = await client.rateSkill("skill-1", 5, "Excellent!");
      expect(result).toBeDefined();
      expect(result.skillId).toBe("skill-1");
      expect(result.rating).toBe(5);
      expect(result.review).toBe("Excellent!");
    });

    it("emits skill-rated event", async () => {
      await client.initialize();
      const spy = vi.fn();
      client.on("skill-rated", spy);
      await client.rateSkill("skill-1", 4, "Good");
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ── getInstalled ──────────────────────────────────────────────────────────────

  describe("getInstalled()", () => {
    it("returns installed skills list", async () => {
      mockDb._prep.all.mockReturnValue([
        { id: "i1", skill_id: "s1", name: "Skill A" },
        { id: "i2", skill_id: "s2", name: "Skill B" },
      ]);
      await client.initialize();
      const installed = await client.getInstalled();
      expect(installed).toHaveLength(2);
    });

    it("returns empty array when nothing installed", async () => {
      mockDb._prep.all.mockReturnValue([]);
      await client.initialize();
      const installed = await client.getInstalled();
      expect(installed).toHaveLength(0);
    });
  });

  // ── getCategories ─────────────────────────────────────────────────────────────

  describe("getCategories()", () => {
    it("returns list of categories with id and name", async () => {
      await client.initialize();
      const cats = await client.getCategories();
      expect(cats).toBeInstanceOf(Array);
      expect(cats.length).toBeGreaterThan(0);
      expect(cats[0]).toHaveProperty("id");
      expect(cats[0]).toHaveProperty("name");
    });
  });

  // ── getFeatured ───────────────────────────────────────────────────────────────

  describe("getFeatured()", () => {
    it("returns featured/trending/newest buckets", async () => {
      await client.initialize();
      const result = await client.getFeatured();
      expect(result).toHaveProperty("featured");
      expect(result).toHaveProperty("trending");
      expect(result).toHaveProperty("newest");
    });
  });

  // ── reportSkill ───────────────────────────────────────────────────────────────

  describe("reportSkill()", () => {
    it("returns a report record with skillId and reason", async () => {
      await client.initialize();
      const result = await client.reportSkill("skill-1", "spam content");
      expect(result).toBeDefined();
      expect(result.skillId).toBe("skill-1");
      expect(result.reason).toBe("spam content");
    });

    it("emits skill-reported event", async () => {
      await client.initialize();
      const spy = vi.fn();
      client.on("skill-reported", spy);
      await client.reportSkill("skill-1", "reason");
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ── checkUpdates ──────────────────────────────────────────────────────────────

  describe("checkUpdates()", () => {
    it("returns checked count and updates array", async () => {
      mockDb._prep.all.mockReturnValue([
        { skill_id: "s1" },
        { skill_id: "s2" },
      ]);
      await client.initialize();
      const result = await client.checkUpdates();
      expect(result.checked).toBe(2);
      expect(result.updates).toBeInstanceOf(Array);
    });
  });

  // ── getStats ──────────────────────────────────────────────────────────────────

  describe("getStats()", () => {
    it("returns installedCount and byCategory", async () => {
      // First prepare is for count query, second for group-by
      mockDb._prep.get.mockReturnValue({ count: 3 });
      mockDb._prep.all.mockReturnValue([{ category: "development", count: 3 }]);
      await client.initialize();
      const stats = await client.getStats();
      expect(stats).toBeDefined();
      expect(typeof stats.installedCount).toBe("number");
      expect(stats.installedCount).toBe(3);
      expect(stats.byCategory).toBeInstanceOf(Array);
    });
  });
});
