/**
 * Unit tests for remotion-video skill handler (v1.2.0)
 * Pure logic handler - generates React/Remotion code
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/remotion-video/handler.js");

describe("remotion-video handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("execute() - create action", () => {
    it("should create a project structure", async () => {
      const result = await handler.execute(
        { input: "create MyVideoProject" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("create");
      expect(result.structure).toBeDefined();
      expect(result.files).toBeDefined();
    });

    it("should include package.json in project files", async () => {
      const result = await handler.execute(
        { input: "create TestProject" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.structure).toContain("package.json");
    });

    it("should include Remotion components in project", async () => {
      const result = await handler.execute(
        { input: "create DemoVideo" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      const text = JSON.stringify(result);
      expect(text).toMatch(/Root|Composition|remotion/i);
    });
  });

  describe("execute() - template action", () => {
    it("should list available templates when unknown name", async () => {
      const result = await handler.execute(
        { input: "template unknown-template-name" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.available).toBeDefined();
      expect(result.available.length).toBe(6);
    });

    it("should return intro template", async () => {
      const result = await handler.execute({ input: "template intro" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.templateName).toBe("intro");
      expect(result.code).toBeDefined();
    });

    it("should return explainer template", async () => {
      const result = await handler.execute(
        { input: "template explainer" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.templateName).toBe("explainer");
    });

    it("should return slideshow template", async () => {
      const result = await handler.execute(
        { input: "template slideshow" },
        {},
        {},
      );
      expect(result.success).toBe(true);
    });

    it("should return social template", async () => {
      const result = await handler.execute(
        { input: "template social" },
        {},
        {},
      );
      expect(result.success).toBe(true);
    });

    it("should return caption template", async () => {
      const result = await handler.execute(
        { input: "template caption" },
        {},
        {},
      );
      expect(result.success).toBe(true);
    });

    it("should return chart template", async () => {
      const result = await handler.execute({ input: "template chart" }, {}, {});
      expect(result.success).toBe(true);
    });
  });

  describe("execute() - preview action", () => {
    it("should return preview instructions", async () => {
      const result = await handler.execute(
        { input: "preview my-project" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("preview");
      expect(result.command).toBeDefined();
    });
  });

  describe("execute() - render action", () => {
    it("should return render instructions", async () => {
      const result = await handler.execute(
        { input: "render MyComposition" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("render");
      expect(result.command).toBeDefined();
    });
  });

  describe("execute() - add-scene action", () => {
    it("should generate scene code", async () => {
      const result = await handler.execute(
        { input: "add-scene FadeInTitle" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("add-scene");
      expect(result.code).toContain("FadeInTitle");
    });
  });

  describe("execute() - default behavior", () => {
    it("should default to create on empty input", async () => {
      const result = await handler.execute({ input: "" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("create");
    });

    it("should default to create on missing input", async () => {
      const result = await handler.execute({}, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("create");
    });
  });

  describe("template code quality", () => {
    it("templates should generate valid React/JSX code", async () => {
      const templates = [
        "intro",
        "explainer",
        "slideshow",
        "social",
        "caption",
        "chart",
      ];
      for (const name of templates) {
        const result = await handler.execute(
          { input: `template ${name}` },
          {},
          {},
        );
        expect(result.success).toBe(true);
        expect(result.code).toMatch(
          /import|export|const|return|React|remotion/i,
        );
      }
    });
  });
});
