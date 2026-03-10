/**
 * Debugging Strategies Handler Unit Tests (v2.0 + Systematic)
 *
 * Tests: diagnose, bisect, trace, hypothesis, rubber-duck,
 *        root-cause, red-flags, defense, session
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const handler = require("../skills/builtin/debugging-strategies/handler.js");

describe("DebuggingStrategies Handler", () => {
  beforeEach(() => {
    handler._sessionStore.clear();
  });

  describe("init", () => {
    it("should initialize", async () => {
      await expect(
        handler.init({ name: "debugging-strategies" }),
      ).resolves.toBeUndefined();
    });
  });

  // ── Original Modes ────────────────────────────────────────────

  describe("diagnose (default)", () => {
    it("should classify TypeError", async () => {
      const result = await handler.execute(
        { input: "TypeError: Cannot read property 'foo' of undefined" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.method).toBe("diagnose");
      expect(result.result.classification).toBe("Type Error");
      expect(result.output).toContain("Diagnostic Checklist");
    });

    it("should classify connection errors", async () => {
      const result = await handler.execute(
        { input: "ECONNREFUSED localhost:5432" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.classification).toBe("Connection Error");
    });

    it("should handle unknown errors", async () => {
      const result = await handler.execute(
        { input: "Something went wrong" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.classification).toBe("Unknown");
    });
  });

  describe("bisect", () => {
    it("should generate bisect strategy", async () => {
      const result = await handler.execute(
        { input: "bisect Login button stopped working after merge" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.method).toBe("bisect");
      expect(result.output).toContain("git bisect");
    });
  });

  describe("trace", () => {
    it("should generate trace template", async () => {
      handler._deps.fs = {
        statSync: vi.fn(() => {
          throw new Error("not found");
        }),
      };
      handler._deps.path = require("path");

      const result = await handler.execute(
        { input: "trace src/auth/login.js" },
        { projectRoot: "/project" },
      );

      expect(result.success).toBe(true);
      expect(result.result.method).toBe("trace");
      expect(result.output).toContain("Trace Points");
    });
  });

  describe("hypothesis", () => {
    it("should generate hypothesis table", async () => {
      const result = await handler.execute(
        { input: "hypothesis Memory leak in WebSocket handler" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.method).toBe("hypothesis");
      expect(result.output).toContain("Hypothesis Table");
      expect(result.result.classification).toBe("Memory Error");
    });
  });

  describe("rubber-duck", () => {
    it("should generate rubber duck prompts", async () => {
      const result = await handler.execute(
        { input: "rubber-duck The sorting algorithm returns wrong order" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.method).toBe("rubber-duck");
      expect(result.output).toContain("What should this code do");
    });
  });

  // ── New Modes ─────────────────────────────────────────────────

  describe("root-cause", () => {
    it("should generate 4-phase root cause analysis", async () => {
      const result = await handler.execute(
        {
          input:
            "root-cause Database query returns empty results after migration",
        },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.method).toBe("root-cause");
      expect(result.result.phases).toBe(4);
      expect(result.output).toContain("Phase 1: Investigation");
      expect(result.output).toContain("Phase 2: Pattern Analysis");
      expect(result.output).toContain("Phase 3: Hypothesis Testing");
      expect(result.output).toContain("Phase 4: Implementation");
      expect(result.output).toContain("3-Fix Threshold");
    });

    it("should classify the error category", async () => {
      const result = await handler.execute(
        { input: "root-cause SQLITE_CONSTRAINT error when inserting record" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.classification).toBe("Database Error");
    });
  });

  describe("red-flags", () => {
    it("should detect 'quick fix' red flag", async () => {
      const result = await handler.execute(
        {
          input:
            "red-flags Let me apply a quick fix for now and investigate later",
        },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.method).toBe("red-flags");
      expect(result.result.rating).toBe("danger");
      expect(result.result.flagCount).toBeGreaterThan(0);
    });

    it("should detect 'just try' red flag", async () => {
      const result = await handler.execute(
        { input: "red-flags Let me try changing the timeout value" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.flags).toContain("Trial-and-Error Debugging");
    });

    it("should rate good approach as good", async () => {
      const result = await handler.execute(
        {
          input:
            "red-flags I reproduced the bug consistently and traced the data flow to find the null pointer",
        },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.rating).toBe("good");
      expect(result.result.flagCount).toBe(0);
    });
  });

  describe("defense", () => {
    it("should generate multi-layer validation", async () => {
      const result = await handler.execute(
        { input: "defense TypeError in user input processing" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.method).toBe("defense");
      expect(result.result.layers.length).toBe(4);
      expect(result.output).toContain("Input Validation Layer");
      expect(result.output).toContain("Business Logic Layer");
      expect(result.output).toContain("Data Access Layer");
      expect(result.output).toContain("Output/Response Layer");
    });

    it("should highlight priority layers for error type", async () => {
      const result = await handler.execute(
        { input: "defense SQLITE_ERROR in data processing" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.priorityLayers).toContain("data");
    });
  });

  // ── Session Tracking ──────────────────────────────────────────

  describe("session", () => {
    it("should start a debug session", async () => {
      const result = await handler.execute(
        { input: "session start Login fails intermittently" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.method).toBe("session");
      expect(result.result.subcommand).toBe("start");
      expect(handler._sessionStore.size).toBe(1);
    });

    it("should log entries to active session", async () => {
      await handler.execute({ input: "session start Test problem" }, {});

      const result = await handler.execute(
        { input: "session log Checked the database connection" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.subcommand).toBe("log");
      const session = Array.from(handler._sessionStore.values())[0];
      expect(session.logs.length).toBe(1);
    });

    it("should record hypotheses", async () => {
      await handler.execute({ input: "session start Test" }, {});

      const result = await handler.execute(
        { input: "session hypothesis The cache is stale" },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.result.subcommand).toBe("hypothesis");
    });

    it("should generate session summary", async () => {
      await handler.execute({ input: "session start Test" }, {});
      await handler.execute({ input: "session log Step 1" }, {});
      await handler.execute({ input: "session hypothesis Cache is stale" }, {});

      const result = await handler.execute({ input: "session summary" }, {});

      expect(result.success).toBe(true);
      expect(result.result.subcommand).toBe("summary");
      expect(result.output).toContain("Debug Session Summary");
    });

    it("should show help without subcommand", async () => {
      const result = await handler.execute({ input: "session" }, {});

      expect(result.success).toBe(true);
      expect(result.output).toContain("Subcommands");
    });
  });

  // ── Enhanced Error Categories ─────────────────────────────────

  describe("enhanced error categories", () => {
    it("should classify async errors", async () => {
      const result = await handler.execute(
        { input: "UnhandledPromiseRejection in worker thread" },
        {},
      );
      expect(result.result.classification).toBe("Promise/Async Error");
    });

    it("should classify import errors", async () => {
      const result = await handler.execute(
        { input: "Cannot find module './utils/helper'" },
        {},
      );
      expect(result.result.classification).toBe("Import Error");
    });

    it("should classify database errors", async () => {
      const result = await handler.execute(
        { input: "SQLITE_BUSY database is locked" },
        {},
      );
      expect(result.result.classification).toBe("Database Error");
    });

    it("should classify build errors", async () => {
      const result = await handler.execute(
        { input: "vite build failed with compilation errors" },
        {},
      );
      expect(result.result.classification).toBe("Build Error");
    });
  });

  describe("no input", () => {
    it("should show usage when no input", async () => {
      const result = await handler.execute({ input: "" }, {});
      expect(result.success).toBe(false);
      expect(result.output).toContain("Usage");
    });
  });
});
