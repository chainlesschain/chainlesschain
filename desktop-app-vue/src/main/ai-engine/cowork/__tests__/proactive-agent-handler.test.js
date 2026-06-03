/**
 * Proactive Agent Handler Unit Tests (v2.0 + Planning)
 *
 * Tests: plan (spec/research/steps/execute/list/status),
 *        quality (build/test/lint/debt/all), backlog (add/list/prioritize/remove),
 *        original triggers (watch, threshold, periodic, pattern, list, stop, status)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const handler = require("../skills/builtin/proactive-agent/handler.js");

describe("ProactiveAgent Handler", () => {
  beforeEach(() => {
    handler._planStore.clear();
    handler._backlogStore.clear();
    // Stop all watchers to prevent leaks
    for (const [id, entry] of handler._watchers) {
      if (entry._handle) {
        if (typeof entry._handle.close === "function") {
          entry._handle.close();
        } else {
          clearInterval(entry._handle);
        }
      }
    }
    handler._watchers.clear();
  });

  afterEach(() => {
    for (const [id, entry] of handler._watchers) {
      if (entry._handle) {
        if (typeof entry._handle.close === "function") {
          entry._handle.close();
        } else {
          clearInterval(entry._handle);
        }
      }
    }
    handler._watchers.clear();
  });

  describe("init", () => {
    it("should initialize", async () => {
      await expect(
        handler.init({ name: "proactive-agent" }),
      ).resolves.toBeUndefined();
    });
  });

  // ── Plan Mode ─────────────────────────────────────────────────

  describe("plan spec", () => {
    it("should create a new plan with spec", async () => {
      const result = await handler.execute(
        { input: "plan spec Build user authentication system" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.id).toMatch(/^P\d+/);
      expect(result.result.phase).toBe(1);
      expect(result.result.phaseName).toBe("spec");
      expect(result.result.title).toContain("Build user authentication");
      expect(handler._planStore.size).toBe(1);
    });

    it("should fail without description", async () => {
      const result = await handler.execute({ input: "plan spec" }, {});
      expect(result.success).toBe(false);
    });
  });

  describe("plan research", () => {
    it("should advance plan to phase 2", async () => {
      // Create plan first
      await handler.execute({ input: "plan spec Test feature" }, {});
      const planId = Array.from(handler._planStore.keys())[0];

      const result = await handler.execute(
        { input: `plan research ${planId}` },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.phase).toBe(2);
      expect(result.result.phaseName).toBe("research");
    });

    it("should fail with unknown plan ID", async () => {
      const result = await handler.execute({ input: "plan research PXXX" }, {});
      expect(result.success).toBe(false);
    });
  });

  describe("plan steps", () => {
    it("should advance plan to phase 3", async () => {
      await handler.execute({ input: "plan spec Test" }, {});
      const planId = Array.from(handler._planStore.keys())[0];

      const result = await handler.execute(
        { input: `plan steps ${planId}` },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.phase).toBe(3);
    });
  });

  describe("plan execute", () => {
    it("should advance plan to phase 4", async () => {
      await handler.execute({ input: "plan spec Test" }, {});
      const planId = Array.from(handler._planStore.keys())[0];

      const result = await handler.execute(
        { input: `plan execute ${planId}` },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.phase).toBe(4);
      expect(result.result.status).toBe("executing");
    });
  });

  describe("plan list", () => {
    it("should list all plans", async () => {
      await handler.execute({ input: "plan spec Feature A" }, {});
      await handler.execute({ input: "plan spec Feature B" }, {});

      const result = await handler.execute({ input: "plan list" }, {});

      expect(result.success).toBe(true);
      expect(result.result.plans.length).toBe(2);
    });

    it("should show empty message when no plans", async () => {
      const result = await handler.execute({ input: "plan list" }, {});
      expect(result.success).toBe(true);
      expect(result.result.plans.length).toBe(0);
    });
  });

  // ── Quality Agents ────────────────────────────────────────────

  describe("quality checks", () => {
    it("should run build check", async () => {
      handler._deps.fs = {
        existsSync: vi.fn().mockReturnValue(true),
        readdirSync: vi.fn().mockReturnValue([]),
        readFileSync: vi.fn().mockReturnValue(""),
      };
      handler._deps.path = require("path");

      const result = await handler.execute(
        { input: "quality build" },
        { workspacePath: "/project" },
      );

      expect(result.success).toBe(true);
      expect(result.result.check).toBe("build");
    });

    it("should run debt check and find TODO markers", async () => {
      handler._deps.fs = {
        existsSync: vi.fn().mockReturnValue(true),
        readdirSync: vi.fn((dir) => {
          if (dir.endsWith("src")) {
            return [
              { name: "app.js", isFile: () => true, isDirectory: () => false },
            ];
          }
          return [];
        }),
        readFileSync: vi
          .fn()
          .mockReturnValue(
            "// TODO fix this\n// FIXME broken\n// HACK workaround",
          ),
      };
      handler._deps.path = require("path");

      const result = await handler.execute(
        { input: "quality debt" },
        { projectRoot: "/project" },
      );

      expect(result.success).toBe(true);
      expect(result.result.check).toBe("debt");
      expect(result.result.total).toBeGreaterThan(0);
    });

    it("should run all quality checks", async () => {
      handler._deps.fs = {
        existsSync: vi.fn().mockReturnValue(false),
        readdirSync: vi.fn().mockReturnValue([]),
        readFileSync: vi.fn().mockReturnValue(""),
      };
      handler._deps.path = require("path");

      const result = await handler.execute(
        { input: "quality all" },
        { workspacePath: "/project" },
      );

      expect(result.success).toBe(true);
      expect(result.result.check).toBe("all");
      expect(result.result.build).toBeDefined();
      expect(result.result.test).toBeDefined();
      expect(result.result.lint).toBeDefined();
      expect(result.result.debt).toBeDefined();
    });
  });

  // ── Backlog ───────────────────────────────────────────────────

  describe("backlog", () => {
    it("should add items", async () => {
      const result = await handler.execute(
        { input: "backlog add Implement dark mode" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.id).toMatch(/^B\d+/);
      expect(handler._backlogStore.size).toBe(1);
    });

    it("should list items", async () => {
      await handler.execute({ input: "backlog add Idea 1" }, {});
      await handler.execute({ input: "backlog add Idea 2" }, {});

      const result = await handler.execute({ input: "backlog list" }, {});
      expect(result.success).toBe(true);
      expect(result.result.items.length).toBe(2);
    });

    it("should prioritize items", async () => {
      await handler.execute({ input: "backlog add Idea 1" }, {});
      await handler.execute({ input: "backlog add Idea 2" }, {});

      const result = await handler.execute({ input: "backlog prioritize" }, {});
      expect(result.success).toBe(true);
      expect(result.result.items.length).toBe(2);
    });

    it("should remove items", async () => {
      await handler.execute({ input: "backlog add Test" }, {});
      const id = Array.from(handler._backlogStore.keys())[0];

      const result = await handler.execute(
        { input: `backlog remove ${id}` },
        {},
      );
      expect(result.success).toBe(true);
      expect(handler._backlogStore.size).toBe(0);
    });

    it("should fail to remove non-existent item", async () => {
      const result = await handler.execute(
        { input: "backlog remove BXXX" },
        {},
      );
      expect(result.success).toBe(false);
    });
  });

  // ── Original Triggers ─────────────────────────────────────────

  describe("list (default action)", () => {
    it("should return empty watcher list", async () => {
      const result = await handler.execute({ input: "" }, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("list");
      expect(result.watchers).toEqual([]);
    });
  });

  describe("threshold", () => {
    it("should create threshold monitor", async () => {
      const result = await handler.execute(
        { input: 'threshold cpu --above 90 --action "alert"' },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe("threshold");
      expect(result.metric).toBe("cpu");
      expect(handler._watchers.size).toBe(1);
    });
  });

  describe("stop", () => {
    it("should stop all watchers", async () => {
      await handler.execute(
        { input: 'threshold cpu --above 90 --action "alert"' },
        {},
      );

      const result = await handler.execute({ input: "stop all" }, {});
      expect(result.success).toBe(true);
      expect(handler._watchers.size).toBe(0);
    });
  });
});
