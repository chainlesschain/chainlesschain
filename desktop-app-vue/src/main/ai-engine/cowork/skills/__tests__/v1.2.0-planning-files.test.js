/**
 * Unit tests for planning-with-files skill handler (v1.2.0)
 * Heavy fs usage - test with temp directories
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/planning-with-files/handler.js");

describe("planning-with-files handler", () => {
  let tempDir;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "planning-test-"));
  });

  afterEach(() => {
    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* cleanup */
    }
  });

  describe("execute() - create action", () => {
    it("should create planning files", async () => {
      const result = await handler.execute(
        { input: "create Build a REST API with authentication" },
        { projectRoot: tempDir, cwd: tempDir },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("create");
    });

    it("should create .planning directory", async () => {
      await handler.execute(
        { input: "create Implement user dashboard" },
        { projectRoot: tempDir, cwd: tempDir },
        {},
      );
      const planDir = path.join(tempDir, ".planning");
      expect(fs.existsSync(planDir)).toBe(true);
    });

    it("should create task_plan.md file", async () => {
      await handler.execute(
        { input: "create Design database schema" },
        { projectRoot: tempDir, cwd: tempDir },
        {},
      );
      const planFile = path.join(tempDir, ".planning", "task_plan.md");
      expect(fs.existsSync(planFile)).toBe(true);
      const content = fs.readFileSync(planFile, "utf8");
      expect(content).toContain("database schema");
    });

    it("should create findings.md file", async () => {
      await handler.execute(
        { input: "create Test project setup" },
        { projectRoot: tempDir, cwd: tempDir },
        {},
      );
      const file = path.join(tempDir, ".planning", "findings.md");
      expect(fs.existsSync(file)).toBe(true);
    });

    it("should create progress.md file", async () => {
      await handler.execute(
        { input: "create Setup CI pipeline" },
        { projectRoot: tempDir, cwd: tempDir },
        {},
      );
      const file = path.join(tempDir, ".planning", "progress.md");
      expect(fs.existsSync(file)).toBe(true);
    });
  });

  describe("execute() - status action", () => {
    it("should return plan status", async () => {
      // First create a plan
      await handler.execute(
        { input: "create My project plan" },
        { projectRoot: tempDir, cwd: tempDir },
        {},
      );
      const result = await handler.execute(
        { input: "status" },
        { projectRoot: tempDir, cwd: tempDir },
        {},
      );
      expect(result.success).toBe(true);
    });

    it("should indicate no plan when none exists", async () => {
      const result = await handler.execute(
        { input: "status" },
        { projectRoot: tempDir, cwd: tempDir },
        {},
      );
      // Should handle gracefully
      expect(result).toBeDefined();
    });
  });

  describe("execute() - finding action", () => {
    it("should add a finding", async () => {
      // Create plan first
      await handler.execute(
        { input: "create Test plan" },
        { projectRoot: tempDir, cwd: tempDir },
        {},
      );
      const result = await handler.execute(
        { input: "finding Found that API endpoint is rate limited" },
        { projectRoot: tempDir, cwd: tempDir },
        {},
      );
      expect(result.success).toBe(true);
    });
  });

  describe("execute() - progress action", () => {
    it("should update progress", async () => {
      await handler.execute(
        { input: "create Test plan" },
        { projectRoot: tempDir, cwd: tempDir },
        {},
      );
      const result = await handler.execute(
        { input: "progress Completed database setup" },
        { projectRoot: tempDir, cwd: tempDir },
        {},
      );
      expect(result.success).toBe(true);
    });
  });

  describe("execute() - recover action", () => {
    it("should recover plan state from files", async () => {
      await handler.execute(
        { input: "create Recovery test plan" },
        { projectRoot: tempDir, cwd: tempDir },
        {},
      );
      const result = await handler.execute(
        { input: "recover" },
        { projectRoot: tempDir, cwd: tempDir },
        {},
      );
      expect(result.success).toBe(true);
    });
  });

  describe("execute() - update action", () => {
    it("should update plan phase", async () => {
      await handler.execute(
        { input: "create Multi-phase project" },
        { projectRoot: tempDir, cwd: tempDir },
        {},
      );
      const result = await handler.execute(
        { input: "update phase 1 done" },
        { projectRoot: tempDir, cwd: tempDir },
        {},
      );
      expect(result).toBeDefined();
    });
  });

  describe("execute() - default behavior", () => {
    it("should default to status on empty input", async () => {
      const result = await handler.execute(
        { input: "" },
        { projectRoot: tempDir, cwd: tempDir },
        {},
      );
      expect(result).toBeDefined();
    });

    it("should default to status on missing input", async () => {
      const result = await handler.execute(
        {},
        { projectRoot: tempDir, cwd: tempDir },
        {},
      );
      expect(result).toBeDefined();
    });
  });
});
