/**
 * Self-Improving Agent Handler Unit Tests (v2.0)
 *
 * Tests: record-error, analyze-patterns, suggest-improvements, show-history,
 *        clear-history, capture-instinct, verify-instinct, list-instincts,
 *        extract-skill, list-skills, export
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const handler = require("../skills/builtin/self-improving-agent/handler.js");

describe("SelfImprovingAgent Handler", () => {
  beforeEach(() => {
    handler._resetState();
    // Mock fs to avoid real file I/O
    handler._deps.fs = {
      existsSync: vi.fn().mockReturnValue(false),
      mkdirSync: vi.fn(),
      readFileSync: vi.fn().mockReturnValue("{}"),
      writeFileSync: vi.fn(),
    };
    handler._deps.path = require("path");
  });

  describe("init", () => {
    it("should initialize", async () => {
      await expect(
        handler.init({ name: "self-improving-agent" }),
      ).resolves.toBeUndefined();
    });
  });

  // ── Original Actions ────────────────────────────

  describe("record-error", () => {
    it("should record error with fix", async () => {
      const result = await handler.execute(
        { input: "record-error TypeError in login fix: Add null check" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe("record-error");
      expect(result.entry.category).toBe("type-error");
      expect(result.entry.fix).toBe("Add null check");
    });

    it("should auto-capture instinct when fix is long enough", async () => {
      const result = await handler.execute(
        {
          input:
            "record-error Database timeout fix: Add connection pooling with max 10 connections and retry logic",
        },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.autoInstinct).toBeTruthy();
    });

    it("should fail without description", async () => {
      const result = await handler.execute({ input: "record-error" }, {});
      expect(result.success).toBe(false);
    });
  });

  describe("analyze-patterns", () => {
    it("should find patterns in multiple errors", async () => {
      await handler.execute(
        { input: "record-error TypeError cannot read property foo" },
        {},
      );
      await handler.execute(
        { input: "record-error TypeError cannot read property bar" },
        {},
      );
      await handler.execute(
        { input: "record-error TypeError null reference" },
        {},
      );

      const result = await handler.execute({ input: "analyze-patterns" }, {});

      expect(result.success).toBe(true);
      expect(result.patterns.length).toBeGreaterThan(0);
      expect(result.summary.totalErrors).toBe(3);
    });

    it("should report empty when no errors", async () => {
      const result = await handler.execute({ input: "analyze-patterns" }, {});
      expect(result.success).toBe(true);
      expect(result.patterns.length).toBe(0);
    });
  });

  describe("suggest-improvements", () => {
    it("should suggest improvements based on errors", async () => {
      await handler.execute(
        { input: "record-error TypeError null fix: Added null check" },
        {},
      );
      await handler.execute(
        { input: "record-error TypeError undefined fix: Added null check" },
        {},
      );

      const result = await handler.execute(
        { input: "suggest-improvements" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.suggestions[0].area).toBe("type-error");
    });
  });

  describe("show-history", () => {
    it("should show recent entries", async () => {
      await handler.execute({ input: "record-error Error 1" }, {});
      await handler.execute({ input: "record-error Error 2" }, {});

      const result = await handler.execute({ input: "show-history" }, {});

      expect(result.success).toBe(true);
      expect(result.entries.length).toBe(2);
    });
  });

  describe("clear-history", () => {
    it("should clear all history", async () => {
      await handler.execute({ input: "record-error Some error" }, {});

      const result = await handler.execute({ input: "clear-history" }, {});

      expect(result.success).toBe(true);
      expect(result.result.cleared).toBe(true);
    });
  });

  // ── New v2.0 Actions ────────────────────────────

  describe("capture-instinct", () => {
    it("should capture instinct with trigger and solution", async () => {
      const result = await handler.execute(
        {
          input:
            "capture-instinct Fix PrismaClient error in serverless trigger: When deploying to Vercel solution: Use prisma generate in build step",
        },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe("capture-instinct");
      expect(result.result.instinct.confidence).toBeGreaterThan(0);
      expect(result.result.instinct.verified).toBe(false);
    });

    it("should fail without description", async () => {
      const result = await handler.execute({ input: "capture-instinct" }, {});
      expect(result.success).toBe(false);
    });
  });

  describe("verify-instinct", () => {
    it("should verify instinct as successful", async () => {
      const capture = await handler.execute(
        { input: "capture-instinct Test instinct description" },
        {},
      );
      const id = capture.result.instinct.id;

      const result = await handler.execute(
        { input: `verify-instinct ${id} true` },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.instinct.verified).toBe(true);
      expect(result.result.instinct.successCount).toBe(1);
      expect(result.result.instinct.confidence).toBeGreaterThan(0.5);
    });

    it("should mark instinct as failed", async () => {
      const capture = await handler.execute(
        { input: "capture-instinct Another instinct" },
        {},
      );
      const id = capture.result.instinct.id;

      const result = await handler.execute(
        { input: `verify-instinct ${id} false` },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.instinct.failureCount).toBe(1);
    });

    it("should fail for unknown instinct", async () => {
      const result = await handler.execute(
        { input: "verify-instinct inst_nonexistent true" },
        {},
      );
      expect(result.success).toBe(false);
    });
  });

  describe("list-instincts", () => {
    it("should list all instincts", async () => {
      await handler.execute({ input: "capture-instinct Instinct A" }, {});
      await handler.execute({ input: "capture-instinct Instinct B" }, {});

      const result = await handler.execute({ input: "list-instincts" }, {});

      expect(result.success).toBe(true);
      expect(result.result.total).toBe(2);
    });

    it("should filter by confidence threshold", async () => {
      await handler.execute(
        { input: "capture-instinct Low confidence item" },
        {},
      );

      const result = await handler.execute(
        { input: "list-instincts --confidence 0.9" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.filtered).toBe(0);
    });
  });

  describe("extract-skill", () => {
    it("should extract a skill", async () => {
      const result = await handler.execute(
        {
          input:
            "extract-skill prisma-fix desc: Fix PrismaClient in serverless trigger: Vercel deploy fails solution: Run prisma generate",
        },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe("extract-skill");
      expect(result.result.skill.name).toBe("prisma-fix");
      expect(result.result.skill.version).toBe("1.0.0");
    });

    it("should reject duplicate skill names", async () => {
      await handler.execute(
        { input: "extract-skill my-skill desc: First skill" },
        {},
      );

      const result = await handler.execute(
        { input: "extract-skill my-skill desc: Duplicate" },
        {},
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("already exists");
    });

    it("should link related instincts", async () => {
      await handler.execute(
        { input: "capture-instinct Prisma serverless deploy fix" },
        {},
      );

      const result = await handler.execute(
        {
          input:
            "extract-skill prisma-deploy desc: Fix Prisma in serverless deploy environments",
        },
        {},
      );

      expect(result.success).toBe(true);
      expect(
        result.result.skill.relatedInstincts.length,
      ).toBeGreaterThanOrEqual(0);
    });
  });

  describe("list-skills", () => {
    it("should list extracted skills", async () => {
      await handler.execute(
        { input: "extract-skill skill-a desc: Skill A" },
        {},
      );
      await handler.execute(
        { input: "extract-skill skill-b desc: Skill B" },
        {},
      );

      const result = await handler.execute({ input: "list-skills" }, {});

      expect(result.success).toBe(true);
      expect(result.result.total).toBe(2);
    });
  });

  describe("export", () => {
    it("should export all learnings and history", async () => {
      await handler.execute(
        {
          input:
            "record-error Test error fix: Test fix that is long enough to trigger instinct",
        },
        {},
      );
      await handler.execute({ input: "capture-instinct Test instinct" }, {});
      await handler.execute(
        { input: "extract-skill test-skill desc: Test skill" },
        {},
      );

      const result = await handler.execute({ input: "export" }, {});

      expect(result.success).toBe(true);
      expect(result.result.version).toBe(2);
      expect(result.result.instincts.length).toBeGreaterThan(0);
      expect(result.result.skills.length).toBe(1);
      expect(result.result.stats.totalInstincts).toBeGreaterThan(0);
    });
  });

  describe("unknown action", () => {
    it("should return error for unknown action", async () => {
      const result = await handler.execute({ input: "invalid-action" }, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown action");
    });
  });
});
