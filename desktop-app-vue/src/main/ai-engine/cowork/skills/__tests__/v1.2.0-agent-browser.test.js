/**
 * Unit tests for agent-browser skill handler (v1.2.0)
 * Browser engine is optional - tests degraded mode
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/agent-browser/handler.js");

describe("agent-browser handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("execute() - parsing commands", () => {
    it("should parse open command", async () => {
      const result = await handler.execute(
        { input: "open https://example.com" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.command).toBe("open");
      expect(result.url).toContain("example.com");
    });

    it("should parse snapshot command", async () => {
      const result = await handler.execute({ input: "snapshot" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.command).toBe("snapshot");
    });

    it("should parse click command with @ref", async () => {
      const result = await handler.execute({ input: "click @e1" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.command).toBe("click");
    });

    it("should parse fill command", async () => {
      const result = await handler.execute(
        { input: 'fill @e2 "test input"' },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.command).toBe("fill");
    });

    it("should parse type command", async () => {
      const result = await handler.execute(
        { input: 'type @e3 "hello world"' },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.command).toBe("type");
    });

    it("should parse screenshot command", async () => {
      const result = await handler.execute({ input: "screenshot" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.command).toBe("screenshot");
    });

    it("should parse extract command", async () => {
      const result = await handler.execute({ input: "extract links" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.command).toBe("extract");
    });
  });

  describe("execute() - session management", () => {
    it("should save and load session", async () => {
      // First open a URL to set session state
      await handler.execute({ input: "open https://example.com" }, {}, {});
      const save = await handler.execute(
        { input: "session-save my-session" },
        {},
        {},
      );
      expect(save.success).toBe(true);
      expect(save.command).toBe("session-save");

      const load = await handler.execute(
        { input: "session-load my-session" },
        {},
        {},
      );
      expect(load.success).toBe(true);
      expect(load.command).toBe("session-load");
    });

    it("should fail loading non-existent session", async () => {
      const result = await handler.execute(
        { input: "session-load nonexistent" },
        {},
        {},
      );
      expect(result.success).toBe(false);
    });
  });

  describe("execute() - default behavior", () => {
    it("should default to snapshot on empty input", async () => {
      const result = await handler.execute({ input: "" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.command).toBe("snapshot");
    });

    it("should default to snapshot on missing input", async () => {
      const result = await handler.execute({}, {}, {});
      expect(result.success).toBe(true);
      expect(result.command).toBe("snapshot");
    });

    it("should handle unknown command", async () => {
      const result = await handler.execute(
        { input: "unknowncommand foo bar" },
        {},
        {},
      );
      expect(result.success).toBe(false);
    });
  });

  describe("execute() - graceful degradation", () => {
    it("should work without browser engine", async () => {
      const result = await handler.execute(
        { input: "navigate https://example.com" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.command).toBe("open");
    });
  });
});
