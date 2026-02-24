/**
 * MultimodalOutput 单元测试 — v3.2
 *
 * 覆盖：initialize、generateOutput（MARKDOWN/JSON/事件/duration）、
 *       getTemplates、registerTemplate、getSupportedFormats、
 *       getStats、getConfig/configure、常量
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ─────────────────────────────────────────────────────────────
vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────
const { MultimodalOutput, OUTPUT_FORMAT } = require("../multimodal-output");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    exec: vi.fn(),
    run: vi.fn(),
    prepare: vi.fn().mockReturnValue(prepResult),
    saveToFile: vi.fn(),
    _prep: prepResult,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("MultimodalOutput", () => {
  let mo;

  beforeEach(() => {
    mo = new MultimodalOutput();
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should set initialized=true after first call", async () => {
      expect(mo.initialized).toBe(false);
      await mo.initialize();
      expect(mo.initialized).toBe(true);
    });

    it("should be idempotent on double initialize", async () => {
      await mo.initialize();
      await mo.initialize(); // second call must no-op
      expect(mo.initialized).toBe(true);
    });

    it("should work with no parameters (pure in-memory init)", async () => {
      await expect(mo.initialize()).resolves.not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // generateOutput — validation
  // ─────────────────────────────────────────────────────────────────────────
  describe("generateOutput() - validation", () => {
    it("should throw if not initialized", async () => {
      await expect(
        mo.generateOutput({ format: OUTPUT_FORMAT.MARKDOWN, content: "hello" }),
      ).rejects.toThrow("MultimodalOutput not initialized");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // generateOutput — MARKDOWN format
  // ─────────────────────────────────────────────────────────────────────────
  describe("generateOutput() - MARKDOWN format", () => {
    beforeEach(async () => {
      await mo.initialize();
    });

    it("should return object with format 'markdown'", async () => {
      const result = await mo.generateOutput({
        format: OUTPUT_FORMAT.MARKDOWN,
        content: "# Hello\nThis is content",
      });

      expect(result.format).toBe("markdown");
    });

    it("should return non-empty content string", async () => {
      const result = await mo.generateOutput({
        format: OUTPUT_FORMAT.MARKDOWN,
        content: "# Hello\nThis is content",
      });

      expect(typeof result.content).toBe("string");
      expect(result.content.length).toBeGreaterThan(0);
    });

    it("should include the source content text in output", async () => {
      const result = await mo.generateOutput({
        format: OUTPUT_FORMAT.MARKDOWN,
        content: "unique-content-xyz-for-test",
      });

      expect(result.content).toContain("unique-content-xyz-for-test");
    });

    it("should include title in markdown output when provided", async () => {
      const result = await mo.generateOutput({
        format: OUTPUT_FORMAT.MARKDOWN,
        content: "body text here",
        title: "My Report Title",
      });

      expect(result.content).toContain("My Report Title");
    });

    it("should include generatedAt timestamp", async () => {
      const result = await mo.generateOutput({
        format: OUTPUT_FORMAT.MARKDOWN,
        content: "some content",
      });

      expect(typeof result.generatedAt).toBe("string");
      expect(result.generatedAt.length).toBeGreaterThan(0);
    });

    it("should include metadata object in result", async () => {
      const result = await mo.generateOutput({
        format: OUTPUT_FORMAT.MARKDOWN,
        content: "some content",
      });

      expect(result).toHaveProperty("metadata");
      expect(typeof result.metadata).toBe("object");
    });

    it("should render structured sections object as markdown", async () => {
      const result = await mo.generateOutput({
        format: OUTPUT_FORMAT.MARKDOWN,
        content: {
          sections: [
            { title: "Introduction", text: "This is the intro." },
            { title: "Details", text: "More details here." },
          ],
        },
      });

      expect(result.content).toContain("Introduction");
      expect(result.content).toContain("Details");
    });

    it("should use default MARKDOWN format when format is not specified", async () => {
      const result = await mo.generateOutput({
        content: "default format test",
      });

      expect(result.format).toBe("markdown");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // generateOutput — JSON format
  // ─────────────────────────────────────────────────────────────────────────
  describe("generateOutput() - JSON format", () => {
    beforeEach(async () => {
      await mo.initialize();
    });

    it("should return object with format 'json'", async () => {
      const result = await mo.generateOutput({
        format: OUTPUT_FORMAT.JSON,
        content: { key: "value", count: 42 },
      });

      expect(result.format).toBe("json");
    });

    it("should serialize content to a JSON string", async () => {
      const result = await mo.generateOutput({
        format: OUTPUT_FORMAT.JSON,
        content: { key: "value" },
      });

      expect(typeof result.content).toBe("string");
      // Must be valid JSON
      expect(() => JSON.parse(result.content)).not.toThrow();
    });

    it("should preserve data in serialized JSON content", async () => {
      const data = { name: "Alice", score: 99 };
      const result = await mo.generateOutput({
        format: OUTPUT_FORMAT.JSON,
        content: data,
      });

      const parsed = JSON.parse(result.content);
      expect(parsed.name).toBe("Alice");
      expect(parsed.score).toBe(99);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // generateOutput — common result shape
  // ─────────────────────────────────────────────────────────────────────────
  describe("generateOutput() - common result shape", () => {
    beforeEach(async () => {
      await mo.initialize();
    });

    it("content should always be a string regardless of format", async () => {
      for (const fmt of [OUTPUT_FORMAT.MARKDOWN, OUTPUT_FORMAT.JSON]) {
        const result = await mo.generateOutput({
          format: fmt,
          content: "test",
        });
        expect(typeof result.content).toBe("string");
      }
    });

    it("duration should be a number >= 0", async () => {
      const result = await mo.generateOutput({
        format: OUTPUT_FORMAT.MARKDOWN,
        content: "duration test",
      });

      expect(typeof result.duration).toBe("number");
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("template field should be null when no template is specified", async () => {
      const result = await mo.generateOutput({
        format: OUTPUT_FORMAT.MARKDOWN,
        content: "no template",
      });

      expect(result.template).toBeNull();
    });

    it("template field should reflect the template name when specified", async () => {
      const result = await mo.generateOutput({
        format: OUTPUT_FORMAT.MARKDOWN,
        content: "with template",
        template: "api-docs",
      });

      expect(result.template).toBe("api-docs");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // generateOutput — event emission
  // ─────────────────────────────────────────────────────────────────────────
  describe("generateOutput() - events", () => {
    beforeEach(async () => {
      await mo.initialize();
    });

    it('should emit "output:generated" event after successful generation', async () => {
      const handler = vi.fn();
      mo.on("output:generated", handler);

      await mo.generateOutput({
        format: OUTPUT_FORMAT.MARKDOWN,
        content: "event test content",
      });

      expect(handler).toHaveBeenCalledOnce();
    });

    it('should include format and elapsed in "output:generated" payload', async () => {
      let payload;
      mo.on("output:generated", (p) => {
        payload = p;
      });

      await mo.generateOutput({
        format: OUTPUT_FORMAT.JSON,
        content: { x: 1 },
      });

      expect(payload).toHaveProperty("format", "json");
      expect(payload).toHaveProperty("elapsed");
      expect(typeof payload.elapsed).toBe("number");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getTemplates
  // ─────────────────────────────────────────────────────────────────────────
  describe("getTemplates()", () => {
    beforeEach(async () => {
      await mo.initialize();
    });

    it("should return a non-null object", () => {
      const templates = mo.getTemplates();
      expect(templates).not.toBeNull();
      expect(typeof templates).toBe("object");
    });

    it("should include built-in 'api-docs' template", () => {
      const templates = mo.getTemplates();
      expect(templates).toHaveProperty("api-docs");
    });

    it("should include built-in 'technical-report' template", () => {
      const templates = mo.getTemplates();
      expect(templates).toHaveProperty("technical-report");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // registerTemplate
  // ─────────────────────────────────────────────────────────────────────────
  describe("registerTemplate()", () => {
    beforeEach(async () => {
      await mo.initialize();
    });

    it("should make a custom template available via getTemplates()", () => {
      const customTemplate = {
        name: "My Custom Template",
        format: OUTPUT_FORMAT.MARKDOWN,
        sections: ["title", "body"],
      };

      mo.registerTemplate("my-custom", customTemplate);

      const templates = mo.getTemplates();
      expect(templates).toHaveProperty("my-custom");
    });

    it("registered template should match the original object", () => {
      const customTemplate = { name: "Test Template", format: "markdown" };
      mo.registerTemplate("test-tmpl", customTemplate);

      const templates = mo.getTemplates();
      expect(templates["test-tmpl"]).toMatchObject(customTemplate);
    });

    it("registered template should be usable in generateOutput()", async () => {
      mo.registerTemplate("simple", {
        name: "Simple",
        format: OUTPUT_FORMAT.MARKDOWN,
      });

      const result = await mo.generateOutput({
        format: OUTPUT_FORMAT.MARKDOWN,
        content: "using registered template",
        template: "simple",
      });

      expect(result.template).toBe("simple");
      expect(result.format).toBe("markdown");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getSupportedFormats
  // ─────────────────────────────────────────────────────────────────────────
  describe("getSupportedFormats()", () => {
    beforeEach(async () => {
      await mo.initialize();
    });

    it("should return an array", () => {
      const formats = mo.getSupportedFormats();
      expect(Array.isArray(formats)).toBe(true);
    });

    it("should contain 'markdown'", () => {
      expect(mo.getSupportedFormats()).toContain("markdown");
    });

    it("should contain 'json'", () => {
      expect(mo.getSupportedFormats()).toContain("json");
    });

    it("should contain 'html'", () => {
      expect(mo.getSupportedFormats()).toContain("html");
    });

    it("should contain 'csv'", () => {
      expect(mo.getSupportedFormats()).toContain("csv");
    });

    it("should contain 'chart'", () => {
      expect(mo.getSupportedFormats()).toContain("chart");
    });

    it("should contain 'slides'", () => {
      expect(mo.getSupportedFormats()).toContain("slides");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getStats
  // ─────────────────────────────────────────────────────────────────────────
  describe("getStats()", () => {
    beforeEach(async () => {
      await mo.initialize();
    });

    it("should return stats object with required fields", () => {
      const stats = mo.getStats();
      expect(stats).toHaveProperty("totalGenerated");
      expect(stats).toHaveProperty("formatDistribution");
    });

    it("should start with totalGenerated = 0", () => {
      expect(mo.getStats().totalGenerated).toBe(0);
    });

    it("should increment totalGenerated after each generateOutput()", async () => {
      await mo.generateOutput({
        format: OUTPUT_FORMAT.MARKDOWN,
        content: "first",
      });
      expect(mo.getStats().totalGenerated).toBe(1);

      await mo.generateOutput({
        format: OUTPUT_FORMAT.JSON,
        content: { x: 1 },
      });
      expect(mo.getStats().totalGenerated).toBe(2);
    });

    it("should track format distribution after generateOutput()", async () => {
      await mo.generateOutput({
        format: OUTPUT_FORMAT.MARKDOWN,
        content: "md content",
      });

      const stats = mo.getStats();
      expect(stats.formatDistribution.markdown).toBeGreaterThanOrEqual(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getConfig / configure
  // ─────────────────────────────────────────────────────────────────────────
  describe("getConfig() / configure()", () => {
    beforeEach(async () => {
      await mo.initialize();
    });

    it("should return config object with known default keys", () => {
      const config = mo.getConfig();
      expect(config).toHaveProperty("defaultFormat");
      expect(config).toHaveProperty("maxOutputSizeKB");
    });

    it("should apply updates via configure()", () => {
      mo.configure({ maxOutputSizeKB: 1024 });
      expect(mo.getConfig().maxOutputSizeKB).toBe(1024);
    });

    it("configure() should return the updated config object", () => {
      const returned = mo.configure({ cssTheme: "dark" });
      expect(returned.cssTheme).toBe("dark");
    });

    it("configure() should not overwrite unrelated fields", () => {
      const before = mo.getConfig();
      mo.configure({ maxOutputSizeKB: 999 });
      const after = mo.getConfig();
      expect(after.defaultFormat).toBe(before.defaultFormat);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Constants
  // ─────────────────────────────────────────────────────────────────────────
  describe("OUTPUT_FORMAT constant", () => {
    it("should have MARKDOWN value of 'markdown'", () => {
      expect(OUTPUT_FORMAT.MARKDOWN).toBe("markdown");
    });

    it("should have HTML value of 'html'", () => {
      expect(OUTPUT_FORMAT.HTML).toBe("html");
    });

    it("should have JSON value of 'json'", () => {
      expect(OUTPUT_FORMAT.JSON).toBe("json");
    });

    it("should have CHART value of 'chart'", () => {
      expect(OUTPUT_FORMAT.CHART).toBe("chart");
    });

    it("should have SLIDES value of 'slides'", () => {
      expect(OUTPUT_FORMAT.SLIDES).toBe("slides");
    });

    it("should have CSV value of 'csv'", () => {
      expect(OUTPUT_FORMAT.CSV).toBe("csv");
    });
  });
});
