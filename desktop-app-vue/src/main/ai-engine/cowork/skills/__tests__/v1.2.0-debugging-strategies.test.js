/**
 * Unit tests for debugging-strategies skill handler (v1.2.0)
 * Tests all 5 debugging modes: diagnose, bisect, trace, hypothesis, rubber-duck
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/debugging-strategies/handler.js");

describe("debugging-strategies handler", () => {
  let tempDir;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "debug-test-"));
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
      await expect(
        handler.init({ name: "debugging-strategies" }),
      ).resolves.not.toThrow();
    });
  });

  describe("execute() - diagnose mode", () => {
    it("should diagnose a TypeError", async () => {
      const result = await handler.execute(
        {
          input: "diagnose TypeError: Cannot read property 'map' of undefined",
        },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Systematic Diagnosis");
      expect(result.output).toContain("Type Error");
      expect(result.result.method).toBe("diagnose");
      expect(result.result.classification).toBe("Type Error");
    });

    it("should default to diagnose when no mode specified", async () => {
      const result = await handler.execute(
        { input: "Something is broken in the login flow" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.method).toBe("diagnose");
    });

    it("should classify connection errors", async () => {
      const result = await handler.execute(
        { input: "diagnose ECONNREFUSED on port 5432" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.classification).toBe("Connection Error");
    });

    it("should classify permission errors", async () => {
      const result = await handler.execute(
        { input: "diagnose EACCES permission denied" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.classification).toBe("Permission Error");
    });

    it("should handle unknown error types", async () => {
      const result = await handler.execute(
        { input: "diagnose Something weird happened" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.classification).toBe("Unknown");
    });
  });

  describe("execute() - bisect mode", () => {
    it("should generate bisect strategy", async () => {
      const result = await handler.execute(
        { input: "bisect Feature broke between v1.2 and v1.5" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Binary Search");
      expect(result.output).toContain("git bisect");
      expect(result.result.method).toBe("bisect");
    });
  });

  describe("execute() - trace mode", () => {
    it("should generate trace analysis", async () => {
      const result = await handler.execute(
        { input: "trace some-module.js" },
        { projectRoot: tempDir },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Execution Trace");
      expect(result.output).toContain("TRACE");
      expect(result.result.method).toBe("trace");
    });

    it("should detect file info when file exists", async () => {
      const testFile = path.join(tempDir, "test.js");
      fs.writeFileSync(testFile, "function hello() {\n  return 'world';\n}\n");

      const result = await handler.execute(
        { input: "trace test.js" },
        { projectRoot: tempDir },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.fileFound).toBe(true);
    });

    it("should handle non-existent file gracefully", async () => {
      const result = await handler.execute(
        { input: "trace nonexistent.js" },
        { projectRoot: tempDir },
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.fileFound).toBe(false);
    });
  });

  describe("execute() - hypothesis mode", () => {
    it("should generate hypothesis table", async () => {
      const result = await handler.execute(
        { input: "hypothesis Memory leak in long-running process" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Hypothesis-Driven");
      expect(result.output).toContain("Hypothesis Table");
      expect(result.output).toContain("CONFIRMED");
      expect(result.result.method).toBe("hypothesis");
    });
  });

  describe("execute() - rubber-duck mode", () => {
    it("should generate rubber duck questions", async () => {
      const result = await handler.execute(
        { input: "rubber-duck Why does the login fail intermittently?" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Rubber Duck");
      expect(result.output).toContain("What should this code do");
      expect(result.output).toContain("What actually happens");
      expect(result.result.method).toBe("rubber-duck");
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
      const result = await handler.execute({ input: "bisect" }, {}, {});
      expect(result.success).toBe(false);
    });
  });
});
