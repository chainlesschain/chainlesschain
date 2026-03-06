/**
 * Unit tests for content-publisher skill handler (v1.2.0)
 * Pure logic handler - generates structured content for publishing
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/content-publisher/handler.js");

describe("content-publisher handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("execute() - infographic action", () => {
    it("should generate infographic content", async () => {
      const result = await handler.execute(
        { input: "infographic Top 5 JavaScript frameworks in 2026" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("infographic");
    });

    it("infographic should have structured sections", async () => {
      const result = await handler.execute(
        { input: "infographic Benefits of remote work" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.content).toBeDefined();
      expect(result.content.sections.length).toBeGreaterThan(0);
    });
  });

  describe("execute() - slides action", () => {
    it("should generate slide deck", async () => {
      const result = await handler.execute(
        { input: "slides Introduction to Machine Learning" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("slides");
      expect(result.slides).toBeDefined();
    });

    it("slides should have title and content slides", async () => {
      const result = await handler.execute(
        { input: "slides Cloud Native Architecture" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.slides.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("execute() - cover action", () => {
    it("should generate cover image spec", async () => {
      const result = await handler.execute(
        { input: "cover My Tech Blog Post Title" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("cover");
      expect(result.spec).toBeDefined();
    });
  });

  describe("execute() - comic action", () => {
    it("should generate comic strip content", async () => {
      const result = await handler.execute(
        { input: "comic A developer discovers a bug in production" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("comic");
      expect(result.panels).toBeDefined();
    });
  });

  describe("execute() - social action", () => {
    it("should generate social content with default platform", async () => {
      const result = await handler.execute(
        { input: "social Just released v2.0 of our open source project!" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("social");
      expect(result.posts).toBeDefined();
    });

    it("should format for LinkedIn with --platform flag", async () => {
      const result = await handler.execute(
        { input: "social Announcing our new AI platform --platform linkedin" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.platform).toBe("LinkedIn");
    });

    it("should format for WeChat with --platform flag", async () => {
      const result = await handler.execute(
        { input: "social Product launch announcement --platform wechat" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.platform).toBe("WeChat");
    });
  });

  describe("execute() - list-templates action", () => {
    it("should list all content templates", async () => {
      const result = await handler.execute({ input: "list-templates" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("list-templates");
      expect(result.templates).toBeDefined();
      expect(result.templates.length).toBe(5);
    });
  });

  describe("execute() - default behavior", () => {
    it("should list templates on empty input", async () => {
      const result = await handler.execute({ input: "" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("list-templates");
    });

    it("should list templates on missing input", async () => {
      const result = await handler.execute({}, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("list-templates");
    });
  });
});
