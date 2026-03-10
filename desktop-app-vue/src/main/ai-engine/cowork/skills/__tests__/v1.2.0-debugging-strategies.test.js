/**
 * Unit tests for debugging-strategies skill handler (v1.2.0 + v2.0.0)
 * Tests all 9 debugging modes: diagnose, bisect, trace, hypothesis, rubber-duck,
 * root-cause, red-flags, defense, session
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
    // Clear session store between tests
    handler._sessionStore.clear();
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

  describe("execute() - root-cause mode", () => {
    it("should generate 4-phase root cause analysis", async () => {
      const result = await handler.execute(
        { input: "root-cause TypeError: Cannot read property of null" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Root Cause Analysis");
      expect(result.output).toContain("Phase 1: Investigation");
      expect(result.output).toContain("Phase 2: Pattern Analysis");
      expect(result.output).toContain("Phase 3: Hypothesis Testing");
      expect(result.output).toContain("Phase 4: Implementation");
      expect(result.result.method).toBe("root-cause");
      expect(result.result.classification).toBe("Type Error");
      expect(result.result.phases).toBe(4);
    });

    it("should include 3-fix threshold rule", async () => {
      const result = await handler.execute(
        { input: "root-cause ECONNREFUSED on database" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("3-Fix Threshold");
      expect(result.result.classification).toBe("Connection Error");
    });
  });

  describe("execute() - red-flags mode", () => {
    it("should detect trial-and-error red flag", async () => {
      const result = await handler.execute(
        { input: "red-flags just try changing the port number" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.method).toBe("red-flags");
      expect(result.result.rating).toBe("warning");
      expect(result.result.flagCount).toBeGreaterThan(0);
      expect(result.result.flags).toContain("Trial-and-Error Debugging");
    });

    it("should detect danger-level red flags", async () => {
      const result = await handler.execute(
        {
          input:
            "red-flags quick fix for now, don't fully understand but it might work",
        },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.rating).toBe("danger");
      expect(result.result.flagCount).toBeGreaterThanOrEqual(2);
    });

    it("should report good rating when no flags detected", async () => {
      const result = await handler.execute(
        {
          input:
            "red-flags I systematically isolated the root cause using logging",
        },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.rating).toBe("good");
      expect(result.result.flagCount).toBe(0);
    });
  });

  describe("execute() - defense mode", () => {
    it("should generate multi-layer validation plan", async () => {
      const result = await handler.execute(
        { input: "defense TypeError in user input processing" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Defense in Depth");
      expect(result.output).toContain("Input Validation Layer");
      expect(result.output).toContain("Business Logic Layer");
      expect(result.output).toContain("Data Access Layer");
      expect(result.output).toContain("Output/Response Layer");
      expect(result.result.method).toBe("defense");
      expect(result.result.layers).toHaveLength(4);
    });

    it("should highlight priority layers based on error type", async () => {
      const result = await handler.execute(
        { input: "defense SQLITE constraint violation" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.classification).toBe("Database Error");
      expect(result.result.priorityLayers).toContain("data");
      expect(result.result.priorityLayers).toContain("input");
    });
  });

  describe("execute() - session mode", () => {
    it("should show help when no subcommand given", async () => {
      const result = await handler.execute({ input: "session" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.output).toContain("Debug Session Tracking");
      expect(result.output).toContain("Subcommands");
      expect(result.result.method).toBe("session");
      expect(result.result.subcommand).toBe("help");
    });

    it("should start a new session", async () => {
      const result = await handler.execute(
        { input: "session start Login page crashes on submit" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Debug Session Started");
      expect(result.result.method).toBe("session");
      expect(result.result.subcommand).toBe("start");
      expect(result.result.sessionId).toMatch(/^dbg-/);
    });

    it("should log entries to active session", async () => {
      // Start session first
      await handler.execute({ input: "session start Test problem" }, {}, {});
      // Log an entry
      const result = await handler.execute(
        { input: "session log Added console.log to login handler" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Step 1");
      expect(result.result.subcommand).toBe("log");
      expect(result.result.stepIndex).toBe(1);
    });

    it("should record hypotheses", async () => {
      await handler.execute({ input: "session start Test problem" }, {}, {});
      const result = await handler.execute(
        { input: "session hypothesis The auth token is expired" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("H1");
      expect(result.output).toContain("PENDING");
      expect(result.result.subcommand).toBe("hypothesis");
      expect(result.result.hypothesisIndex).toBe(1);
    });

    it("should generate session summary with timeline", async () => {
      await handler.execute({ input: "session start Test problem" }, {}, {});
      await handler.execute(
        { input: "session log Checked error logs" },
        {},
        {},
      );
      await handler.execute(
        { input: "session hypothesis Might be a race condition" },
        {},
        {},
      );
      const result = await handler.execute(
        { input: "session summary" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("Debug Session Summary");
      expect(result.output).toContain("Timeline");
      expect(result.result.subcommand).toBe("summary");
      expect(result.result.logCount).toBe(1);
      expect(result.result.hypothesisCount).toBe(1);
    });

    it("should fail to log without active session", async () => {
      const result = await handler.execute(
        { input: "session log Some entry" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("No active session");
    });

    it("should fail to start session without problem description", async () => {
      const result = await handler.execute({ input: "session start" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.output).toContain("Error");
    });

    it("should show 3-fix threshold warning after 3+ log entries", async () => {
      await handler.execute({ input: "session start Complex bug" }, {}, {});
      await handler.execute({ input: "session log Step 1" }, {}, {});
      await handler.execute({ input: "session log Step 2" }, {}, {});
      await handler.execute({ input: "session log Step 3" }, {}, {});
      const result = await handler.execute(
        { input: "session summary" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain("3-Fix Threshold Warning");
      expect(result.result.logCount).toBe(3);
    });
  });

  describe("execute() - new error categories", () => {
    it("should classify Promise/Async errors", async () => {
      const result = await handler.execute(
        { input: "diagnose UnhandledPromiseRejection in worker" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.classification).toBe("Promise/Async Error");
    });

    it("should classify Import errors", async () => {
      const result = await handler.execute(
        { input: "diagnose Cannot find module './utils'" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.classification).toBe("Import Error");
    });

    it("should classify Database errors", async () => {
      const result = await handler.execute(
        { input: "diagnose SQLITE_BUSY database is locked" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.classification).toBe("Database Error");
    });

    it("should classify Network errors", async () => {
      const result = await handler.execute(
        { input: "diagnose ECONNRESET by peer" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.classification).toBe("Network Error");
    });

    it("should classify Build errors", async () => {
      const result = await handler.execute(
        { input: "diagnose vite build failed during compilation" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.classification).toBe("Build Error");
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
