/**
 * Unit tests for cursor-rules-generator skill handler (v1.2.0)
 * Uses fs for convention detection - test with temp directories
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/cursor-rules-generator/handler.js");

describe("cursor-rules-generator handler", () => {
  let tempDir;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-rules-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* cleanup */
    }
  });

  describe("execute() - generate action", () => {
    it("should generate rules for a project", async () => {
      // Create minimal project structure
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          dependencies: { react: "^18.0.0", typescript: "^5.0.0" },
        }),
      );
      fs.writeFileSync(path.join(tempDir, "tsconfig.json"), "{}");

      const result = await handler.execute(
        { input: `generate ${tempDir}` },
        { cwd: tempDir },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("generate");
    });

    it("should detect TypeScript projects", async () => {
      fs.writeFileSync(path.join(tempDir, "tsconfig.json"), "{}");
      fs.writeFileSync(path.join(tempDir, "package.json"), "{}");

      const result = await handler.execute(
        { input: `generate ${tempDir}` },
        { cwd: tempDir },
        {},
      );
      expect(result.success).toBe(true);
      const text = JSON.stringify(result).toLowerCase();
      expect(text).toMatch(/typescript/);
    });

    it("should detect npm vs yarn vs pnpm", async () => {
      fs.writeFileSync(path.join(tempDir, "package-lock.json"), "{}");
      fs.writeFileSync(path.join(tempDir, "package.json"), "{}");

      const result = await handler.execute(
        { input: `generate ${tempDir}` },
        { cwd: tempDir },
        {},
      );
      expect(result.success).toBe(true);
    });
  });

  describe("execute() - detect action", () => {
    it("should detect project conventions", async () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          dependencies: { vue: "^3.0.0", "ant-design-vue": "^4.0.0" },
        }),
      );

      const result = await handler.execute(
        { input: `detect ${tempDir}` },
        { cwd: tempDir },
        {},
      );
      expect(result.success).toBe(true);
    });
  });

  describe("execute() - export action", () => {
    it("should export rules in specific format", async () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), "{}");

      const result = await handler.execute(
        { input: `export ${tempDir}` },
        { cwd: tempDir },
        {},
      );
      expect(result.success).toBe(true);
    });
  });

  describe("execute() - default behavior", () => {
    it("should default to generate on empty input", async () => {
      const result = await handler.execute({ input: "" }, { cwd: tempDir }, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("generate");
    });

    it("should default to generate on missing input", async () => {
      const result = await handler.execute({}, { cwd: tempDir }, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("generate");
    });
  });
});
