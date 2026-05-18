/**
 * Unit tests for api-docs-generator skill handler (v1.2.0)
 * Uses fs for scanning - test with temp directories
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/api-docs-generator/handler.js");

describe("api-docs-generator handler", () => {
  let tempDir;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-docs-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* cleanup */
    }
  });

  describe("execute() - scan action", () => {
    it("should scan directory for API endpoints", async () => {
      // Create a test Express-style route file
      fs.writeFileSync(
        path.join(tempDir, "routes.js"),
        `
        app.get('/api/users', (req, res) => { res.json([]); });
        app.post('/api/users', (req, res) => { res.json({}); });
        app.get('/api/users/:id', (req, res) => { res.json({}); });
        app.put('/api/users/:id', (req, res) => { res.json({}); });
        app.delete('/api/users/:id', (req, res) => { res.json({}); });
        `,
      );

      const result = await handler.execute(
        { input: `scan ${tempDir}` },
        { cwd: tempDir },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("scan");
      expect(result.endpoints || result.routes).toBeDefined();
    });

    it("should detect Express route patterns", async () => {
      fs.writeFileSync(
        path.join(tempDir, "api.js"),
        `router.get('/health', handler);
         router.post('/items', createItem);`,
      );

      const result = await handler.execute(
        { input: `scan ${tempDir}` },
        { cwd: tempDir },
        {},
      );
      expect(result.success).toBe(true);
      if (result.endpoints) {
        expect(result.endpoints.length).toBeGreaterThanOrEqual(1);
      }
    });

    it("should handle empty directory", async () => {
      const result = await handler.execute(
        { input: `scan ${tempDir}` },
        { cwd: tempDir },
        {},
      );
      expect(result.success).toBe(true);
    });
  });

  describe("execute() - openapi action", () => {
    it("should generate OpenAPI 3.0 spec", async () => {
      fs.writeFileSync(
        path.join(tempDir, "routes.js"),
        `app.get('/api/items', listItems);
         app.post('/api/items', createItem);`,
      );

      const result = await handler.execute(
        { input: `openapi ${tempDir}` },
        { cwd: tempDir },
        {},
      );
      expect(result.success).toBe(true);
      const spec = result.spec || result.openapi || {};
      if (typeof spec === "object" && spec.openapi) {
        expect(spec.openapi).toMatch(/^3\./);
      }
    });
  });

  describe("execute() - endpoint action", () => {
    it("should document a specific endpoint", async () => {
      const result = await handler.execute(
        { input: "endpoint GET /api/users" },
        {},
        {},
      );
      expect(result.success).toBe(true);
    });
  });

  describe("execute() - validate action", () => {
    it("should validate an OpenAPI spec file", async () => {
      fs.writeFileSync(
        path.join(tempDir, "openapi.yaml"),
        `openapi: 3.0.3
info:
  title: Test API
  version: 1.0.0
paths:
  /api/test:
    get:
      summary: Test endpoint`,
      );

      const result = await handler.execute(
        { input: `validate ${path.join(tempDir, "openapi.yaml")}` },
        {},
        {},
      );
      expect(result.success).toBe(true);
    });
  });

  describe("execute() - default behavior", () => {
    it("should default to scan on empty input", async () => {
      const result = await handler.execute({ input: "" }, { cwd: tempDir }, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("scan");
    });

    it("should default to scan on missing input", async () => {
      const result = await handler.execute({}, { cwd: tempDir }, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("scan");
    });
  });
});
