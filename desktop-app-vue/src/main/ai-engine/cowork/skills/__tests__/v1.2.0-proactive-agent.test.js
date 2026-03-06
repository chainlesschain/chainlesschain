/**
 * Unit tests for proactive-agent skill handler (v1.2.0)
 * Timer + fs based - test list/stop/status actions, cleanup watchers
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/proactive-agent/handler.js");

describe("proactive-agent handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Stop all watchers to prevent test leaks
    try {
      const list = await handler.execute({ input: "list" }, {}, {});
      if (list && list.watchers) {
        for (const w of list.watchers) {
          try {
            await handler.execute({ input: `stop ${w.id || w.name}` }, {}, {});
          } catch {
            /* cleanup */
          }
        }
      }
    } catch {
      /* cleanup */
    }
    if (handler.cleanup) {
      await handler.cleanup();
    }
  });

  describe("execute() - list action", () => {
    it("should list active watchers", async () => {
      const result = await handler.execute({ input: "list" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("list");
    });
  });

  describe("execute() - status action", () => {
    it("should return status for a known watcher", async () => {
      // Create a watcher first
      const create = await handler.execute(
        { input: "threshold cpu --above 50" },
        {},
        {},
      );
      const id = create.watcherId;
      expect(id).toBeDefined();

      const result = await handler.execute({ input: `status ${id}` }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("status");
    });

    it("should fail for unknown watcher", async () => {
      const result = await handler.execute(
        { input: "status unknown-id" },
        {},
        {},
      );
      expect(result.success).toBe(false);
    });
  });

  describe("execute() - threshold action", () => {
    it("should create threshold watcher for CPU", async () => {
      const result = await handler.execute(
        { input: "threshold cpu --above 80" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.watcherId).toBeDefined();
      expect(result.action).toBe("threshold");
    });

    it("should create threshold watcher for memory", async () => {
      const result = await handler.execute(
        { input: "threshold memory --above 90" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("threshold");
    });
  });

  describe("execute() - periodic action", () => {
    it("should create periodic task", async () => {
      const result = await handler.execute(
        { input: 'periodic 60s "check health"' },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("periodic");
      expect(result.watcherId).toBeDefined();
    });
  });

  describe("execute() - stop action", () => {
    it("should stop a watcher by ID", async () => {
      // First create a threshold watcher
      const create = await handler.execute(
        { input: "threshold cpu --above 95" },
        {},
        {},
      );
      const id = create.watcherId || create.id;
      if (id) {
        const result = await handler.execute({ input: `stop ${id}` }, {}, {});
        expect(result.success).toBe(true);
      }
    });

    it("should handle stopping non-existent watcher", async () => {
      const result = await handler.execute(
        { input: "stop nonexistent-id-12345" },
        {},
        {},
      );
      // Should fail gracefully
      expect(result).toBeDefined();
    });
  });

  describe("execute() - default behavior", () => {
    it("should default to list on empty input", async () => {
      const result = await handler.execute({ input: "" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("list");
    });

    it("should default to list on missing input", async () => {
      const result = await handler.execute({}, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("list");
    });
  });
});
