/**
 * Unit tests for frontend-design skill handler (v1.2.0)
 * Tests all 5 modes: component, layout, responsive, a11y, theme
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/frontend-design/handler.js");

describe("frontend-design handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("init()", () => {
    it("should initialize without errors", async () => {
      await expect(
        handler.init({ name: "frontend-design" }),
      ).resolves.not.toThrow();
    });
  });

  describe("execute() - component mode", () => {
    it("should generate component design", async () => {
      const result = await handler.execute(
        { input: "component Data table with sorting" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Component Design");
      expect(result.output).toContain("Props");
      expect(result.output).toContain("States");
      expect(result.output).toContain("Events");
      expect(result.result.method).toBe("component");
      expect(result.result.componentName).toBeDefined();
    });

    it("should default to component mode", async () => {
      const result = await handler.execute(
        { input: "Search bar with autocomplete" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.method).toBe("component");
    });

    it("should generate PascalCase component name", async () => {
      const result = await handler.execute(
        { input: "component dropdown menu" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.componentName).toBe("DropdownMenu");
    });
  });

  describe("execute() - layout mode", () => {
    it("should generate page layout", async () => {
      const result = await handler.execute(
        { input: "layout Dashboard with sidebar" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Page Layout");
      expect(result.output).toContain("Header");
      expect(result.output).toContain("Sidebar");
      expect(result.output).toContain("grid");
      expect(result.result.method).toBe("layout");
    });
  });

  describe("execute() - responsive mode", () => {
    it("should generate responsive design specs", async () => {
      const result = await handler.execute(
        { input: "responsive Navigation menu" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Breakpoints");
      expect(result.output).toContain("mobile");
      expect(result.output).toContain("tablet");
      expect(result.output).toContain("desktop");
      expect(result.output).toContain("@media");
      expect(result.result.method).toBe("responsive");
      expect(result.result.breakpoints).toContain("mobile");
    });
  });

  describe("execute() - a11y mode", () => {
    it("should generate accessibility audit", async () => {
      const result = await handler.execute(
        { input: "a11y Login form" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Accessibility Audit");
      expect(result.output).toContain("WCAG");
      expect(result.output).toContain("Semantic HTML");
      expect(result.output).toContain("Keyboard");
      expect(result.output).toContain("ARIA");
      expect(result.result.method).toBe("a11y");
      expect(result.result.categories).toContain("Semantic HTML");
    });
  });

  describe("execute() - theme mode", () => {
    it("should generate theme system design", async () => {
      const result = await handler.execute(
        { input: "theme Dark/light mode system" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Theme System");
      expect(result.output).toContain("Design Tokens");
      expect(result.output).toContain("Dark Mode");
      expect(result.output).toContain("--color-primary");
      expect(result.result.method).toBe("theme");
    });
  });

  describe("execute() - error handling", () => {
    it("should fail when no description provided", async () => {
      const result = await handler.execute({ input: "" }, {}, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("No description");
    });

    it("should fail on empty input", async () => {
      const result = await handler.execute({}, {}, {});
      expect(result.success).toBe(false);
    });

    it("should fail when mode only, no description", async () => {
      const result = await handler.execute({ input: "theme" }, {}, {});
      expect(result.success).toBe(false);
    });

    it("should include success message", async () => {
      const result = await handler.execute(
        { input: "component Button" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.message).toContain("component");
    });
  });
});
