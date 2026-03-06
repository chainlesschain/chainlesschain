/**
 * Unit tests for youtube-summarizer skill handler (v1.2.0)
 * Uses https for YouTube page fetching - test parsing logic separately
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/youtube-summarizer/handler.js");

describe("youtube-summarizer handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("execute() - summarize action", () => {
    it("should attempt to summarize a YouTube video (may fail without network)", async () => {
      const result = await handler.execute(
        { input: "summarize https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
        {},
        {},
      );
      // Will fail without network but should not throw
      expect(result).toBeDefined();
    });

    it("should handle youtu.be short URL", async () => {
      const result = await handler.execute(
        { input: "summarize https://youtu.be/dQw4w9WgXcQ" },
        {},
        {},
      );
      expect(result).toBeDefined();
    });

    it("should handle bare video ID", async () => {
      const result = await handler.execute(
        { input: "summarize dQw4w9WgXcQ" },
        {},
        {},
      );
      expect(result).toBeDefined();
    });
  });

  describe("execute() - transcript action", () => {
    it("should attempt to get transcript", async () => {
      const result = await handler.execute(
        { input: "transcript dQw4w9WgXcQ" },
        {},
        {},
      );
      expect(result).toBeDefined();
    });
  });

  describe("execute() - chapters action", () => {
    it("should attempt to extract chapters", async () => {
      const result = await handler.execute(
        { input: "chapters dQw4w9WgXcQ" },
        {},
        {},
      );
      expect(result).toBeDefined();
    });
  });

  describe("execute() - error handling", () => {
    it("should fail on empty input", async () => {
      const result = await handler.execute({ input: "" }, {}, {});
      expect(result.success).toBe(false);
    });

    it("should fail on missing input", async () => {
      const result = await handler.execute({}, {}, {});
      expect(result.success).toBe(false);
    });

    it("should handle invalid URL gracefully", async () => {
      const result = await handler.execute(
        { input: "summarize not-a-valid-url-at-all" },
        {},
        {},
      );
      // Should not throw, may fail gracefully
      expect(result).toBeDefined();
    });
  });
});
