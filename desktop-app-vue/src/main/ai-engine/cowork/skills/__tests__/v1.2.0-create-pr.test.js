/**
 * Unit tests for create-pr skill handler (v1.2.0)
 * Tests all 4 modes: create, draft, template, changelog
 * Note: git commands may not return data in test environment
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestProcessContext } from "./helpers/bundled-skill-process.js";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/create-pr/handler.js");

describe("create-pr handler", () => {
  let context;

  beforeEach(() => {
    vi.clearAllMocks();
    context = {
      cwd: process.cwd(),
      ...createTestProcessContext(
        "create-pr",
        vi.fn(() => ""),
      ),
    };
  });

  describe("init()", () => {
    it("should initialize without errors", async () => {
      await expect(handler.init({ name: "create-pr" })).resolves.not.toThrow();
    });
  });

  describe("execute() - create mode", () => {
    it("should generate PR content from branch name", async () => {
      const result = await handler.execute(
        { input: "create feature/user-auth" },
        context,
        context,
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Pull Request");
      expect(result.output).toContain("Testing");
      expect(result.output).toContain("Checklist");
      expect(result.result.method).toBe("create");
    });

    it("should default to create mode on empty mode", async () => {
      const result = await handler.execute(
        { input: "feature/add-caching" },
        context,
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.method).toBe("create");
    });

    it("should generate title from branch name", async () => {
      const result = await handler.execute(
        { input: "create feature/add-dark-mode" },
        context,
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("add dark mode");
    });

    it("should work with no description (auto-detect)", async () => {
      const result = await handler.execute({ input: "create" }, context, {});
      expect(result.success).toBe(true);
      expect(result.result.method).toBe("create");
    });

    it("should work from params.input", async () => {
      const result = await handler.execute(
        { params: { input: "create fix/login-bug" } },
        context,
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.branch).toBe("fix/login-bug");
    });
  });

  describe("execute() - draft mode", () => {
    it("should generate draft PR", async () => {
      const result = await handler.execute(
        { input: "draft Add caching to API endpoints" },
        context,
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Draft PR");
      expect(result.output).toContain("not ready for review");
      expect(result.output).toContain("Open Questions");
      expect(result.result.method).toBe("draft");
    });

    it("should fail draft with no description", async () => {
      const result = await handler.execute({ input: "draft" }, context, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("No description");
    });
  });

  describe("execute() - template mode", () => {
    it("should generate PR template", async () => {
      const result = await handler.execute({ input: "template" }, context, {});
      expect(result.success).toBe(true);
      expect(result.output).toContain("PR Template");
      expect(result.output).toContain("Summary");
      expect(result.output).toContain("Type of Change");
      expect(result.output).toContain("Bug fix");
      expect(result.output).toContain("New feature");
      expect(result.result.method).toBe("template");
    });

    it("should work without any extra args", async () => {
      const result = await handler.execute({ input: "template" }, context, {});
      expect(result.success).toBe(true);
    });
  });

  describe("execute() - changelog mode", () => {
    it("should generate changelog", async () => {
      const result = await handler.execute({ input: "changelog" }, context, {});
      expect(result.success).toBe(true);
      expect(result.output).toContain("Changelog");
      expect(result.result.method).toBe("changelog");
    });

    it("should accept version range", async () => {
      const result = await handler.execute(
        { input: "changelog v1.0.0..v1.1.0" },
        context,
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.method).toBe("changelog");
    });
  });

  describe("execute() - error handling", () => {
    it("should handle empty input gracefully (defaults to create)", async () => {
      const result = await handler.execute({ input: "" }, context, {});
      // create mode works with no description (auto-detect)
      expect(result.success).toBe(true);
      expect(result.result.method).toBe("create");
    });

    it("should include message on success", async () => {
      const result = await handler.execute({ input: "template" }, context, {});
      expect(result.success).toBe(true);
      expect(result.message).toContain("template");
    });
  });
});
