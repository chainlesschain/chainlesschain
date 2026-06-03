/**
 * Unit tests for api-design skill handler (v1.2.0)
 * Tests all 5 API design modes: design, review, openapi, versioning, errors
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/api-design/handler.js");

describe("api-design handler", () => {
  let tempDir;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-design-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // cleanup
    }
  });

  describe("init()", () => {
    it("should initialize without errors", async () => {
      await expect(handler.init({ name: "api-design" })).resolves.not.toThrow();
    });
  });

  describe("execute() - design mode", () => {
    it("should generate API design for a resource", async () => {
      const result = await handler.execute(
        { input: "design User management API" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("API Design");
      expect(result.output).toContain("GET");
      expect(result.output).toContain("POST");
      expect(result.output).toContain("PUT");
      expect(result.output).toContain("DELETE");
      expect(result.result.method).toBe("design");
      expect(result.result.endpointCount).toBe(5);
    });

    it("should default to design mode", async () => {
      const result = await handler.execute(
        { input: "Product catalog API" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.method).toBe("design");
    });

    it("should include pagination in list response", async () => {
      const result = await handler.execute({ input: "design Orders" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.output).toContain("pagination");
    });
  });

  describe("execute() - review mode", () => {
    it("should review Express routes from file", async () => {
      const routeFile = path.join(tempDir, "routes.js");
      fs.writeFileSync(
        routeFile,
        `
const express = require("express");
const router = express.Router();
router.get("/users", handler1);
router.post("/users", handler2);
router.get("/users/:id", handler3);
router.delete("/users/:id", handler4);
`,
      );

      const result = await handler.execute(
        { input: `review routes.js` },
        { projectRoot: tempDir },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("API Review");
      expect(result.result.method).toBe("review");
      expect(result.result.endpointCount).toBe(4);
    });

    it("should detect uppercase in paths", async () => {
      const routeFile = path.join(tempDir, "api.js");
      fs.writeFileSync(
        routeFile,
        `app.get("/Users", handler);\napp.post("/createUser", handler2);`,
      );

      const result = await handler.execute(
        { input: "review api.js" },
        { projectRoot: tempDir },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.issueCount).toBeGreaterThan(0);
    });

    it("should detect verbs in paths", async () => {
      const routeFile = path.join(tempDir, "bad-api.js");
      fs.writeFileSync(routeFile, `app.post("/createOrder", handler);`);

      const result = await handler.execute(
        { input: "review bad-api.js" },
        { projectRoot: tempDir },
        {},
      );
      expect(result.success).toBe(true);
      const verbIssues = result.result.issues.filter((i) =>
        i.message.includes("Verb"),
      );
      expect(verbIssues.length).toBeGreaterThan(0);
    });

    it("should handle non-existent file", async () => {
      const result = await handler.execute(
        { input: "review nonexistent.js" },
        { projectRoot: tempDir },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.endpointCount).toBe(0);
    });
  });

  describe("execute() - openapi mode", () => {
    it("should generate OpenAPI spec", async () => {
      const result = await handler.execute(
        { input: "openapi Product catalog" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("openapi: 3.0.3");
      expect(result.output).toContain("paths:");
      expect(result.output).toContain("components:");
      expect(result.result.method).toBe("openapi");
    });
  });

  describe("execute() - versioning mode", () => {
    it("should generate versioning strategy", async () => {
      const result = await handler.execute(
        { input: "versioning Payment API v2 migration" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("URL Path Versioning");
      expect(result.output).toContain("Header Versioning");
      expect(result.output).toContain("Migration Checklist");
      expect(result.result.method).toBe("versioning");
    });
  });

  describe("execute() - errors mode", () => {
    it("should generate error design", async () => {
      const result = await handler.execute(
        { input: "errors Authentication service" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Error Response Format");
      expect(result.output).toContain("VALIDATION_ERROR");
      expect(result.output).toContain("UNAUTHORIZED");
      expect(result.output).toContain("RESOURCE_NOT_FOUND");
      expect(result.result.method).toBe("errors");
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
  });
});
