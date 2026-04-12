/**
 * Unit tests for learning-hooks.js — fire-and-forget hook integration
 * that wires TrajectoryStore into the REPL lifecycle.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  TrajectoryStore,
  _deps as trajDeps,
} from "../../src/lib/learning/trajectory-store.js";
import {
  onUserPromptSubmit,
  onPostToolUse,
  onResponseComplete,
  onSessionEnd,
  createLearningContext,
} from "../../src/lib/learning/learning-hooks.js";

describe("learning-hooks", () => {
  let db;
  let store;
  let idCounter;

  beforeEach(() => {
    db = new MockDatabase();
    idCounter = 0;
    trajDeps.generateId = vi.fn(() => `traj-${++idCounter}`);
    store = new TrajectoryStore(db);
  });

  function makeCtx(overrides = {}) {
    return {
      trajectoryStore: store,
      currentTrajectoryId: null,
      enabled: true,
      sessionId: "sess-1",
      ...overrides,
    };
  }

  // ── onUserPromptSubmit ─���────────────────────���─────

  describe("onUserPromptSubmit", () => {
    it("starts a trajectory and sets currentTrajectoryId", () => {
      const ctx = makeCtx();
      onUserPromptSubmit(ctx, "fix the bug");

      expect(ctx.currentTrajectoryId).toBe("traj-1");
      const traj = store.getTrajectory("traj-1");
      expect(traj).toBeTruthy();
      expect(traj.userIntent).toBe("fix the bug");
      expect(traj.sessionId).toBe("sess-1");
    });

    it("no-ops when ctx is null", () => {
      onUserPromptSubmit(null, "hello"); // should not throw
    });

    it("no-ops when disabled", () => {
      const ctx = makeCtx({ enabled: false });
      onUserPromptSubmit(ctx, "hello");
      expect(ctx.currentTrajectoryId).toBeNull();
    });

    it("no-ops when trajectoryStore is missing", () => {
      const ctx = makeCtx({ trajectoryStore: null });
      onUserPromptSubmit(ctx, "hello");
      expect(ctx.currentTrajectoryId).toBeNull();
    });

    it("swallows errors from trajectoryStore", () => {
      const brokenStore = {
        startTrajectory: () => {
          throw new Error("DB locked");
        },
      };
      const ctx = makeCtx({ trajectoryStore: brokenStore });
      onUserPromptSubmit(ctx, "hello"); // should not throw
      expect(ctx.currentTrajectoryId).toBeNull();
    });
  });

  // ── onPostToolUse ─────────────────────────────────

  describe("onPostToolUse", () => {
    it("appends a tool call to current trajectory", () => {
      const ctx = makeCtx();
      onUserPromptSubmit(ctx, "test");
      onPostToolUse(ctx, {
        tool: "read_file",
        args: { path: "foo.js" },
        result: "contents",
        durationMs: 50,
        status: "completed",
      });

      const traj = store.getTrajectory(ctx.currentTrajectoryId);
      expect(traj.toolChain).toHaveLength(1);
      expect(traj.toolChain[0].tool).toBe("read_file");
      expect(traj.toolCount).toBe(1);
    });

    it("appends multiple tool calls in order", () => {
      const ctx = makeCtx();
      onUserPromptSubmit(ctx, "test");
      onPostToolUse(ctx, { tool: "read_file", args: {}, result: "ok", durationMs: 10, status: "completed" });
      onPostToolUse(ctx, { tool: "edit_file", args: {}, result: "ok", durationMs: 20, status: "completed" });
      onPostToolUse(ctx, { tool: "run_shell", args: {}, result: "ok", durationMs: 30, status: "completed" });

      const traj = store.getTrajectory(ctx.currentTrajectoryId);
      expect(traj.toolChain).toHaveLength(3);
      expect(traj.toolChain.map((t) => t.tool)).toEqual(["read_file", "edit_file", "run_shell"]);
    });

    it("no-ops when no currentTrajectoryId", () => {
      const ctx = makeCtx();
      // No onUserPromptSubmit called → no trajectory started
      onPostToolUse(ctx, { tool: "t1", args: {} }); // should not throw
    });

    it("no-ops when ctx is null", () => {
      onPostToolUse(null, { tool: "t1" }); // should not throw
    });

    it("swallows errors from trajectoryStore", () => {
      const brokenStore = {
        appendToolCall: () => {
          throw new Error("DB error");
        },
      };
      const ctx = makeCtx({ trajectoryStore: brokenStore, currentTrajectoryId: "t1" });
      onPostToolUse(ctx, { tool: "t1", args: {} }); // should not throw
    });
  });

  // ── onResponseComplete ───────────��────────────────

  describe("onResponseComplete", () => {
    it("completes the trajectory and resets currentTrajectoryId", () => {
      const ctx = makeCtx();
      onUserPromptSubmit(ctx, "build project");
      onPostToolUse(ctx, { tool: "run_shell", args: {}, result: "ok", durationMs: 100, status: "completed" });

      const result = onResponseComplete(ctx, {
        finalResponse: "Build successful",
        tags: ["build"],
      });

      expect(result).toBeTruthy();
      expect(result.finalResponse).toBe("Build successful");
      expect(result.completedAt).toBeTruthy();
      expect(ctx.currentTrajectoryId).toBeNull();
    });

    it("returns null when ctx is null", () => {
      expect(onResponseComplete(null, {})).toBeNull();
    });

    it("returns null when no currentTrajectoryId", () => {
      const ctx = makeCtx();
      expect(onResponseComplete(ctx, { finalResponse: "done" })).toBeNull();
    });

    it("resets currentTrajectoryId even on error", () => {
      const brokenStore = {
        completeTrajectory: () => {
          throw new Error("fail");
        },
      };
      const ctx = makeCtx({ trajectoryStore: brokenStore, currentTrajectoryId: "t1" });
      const result = onResponseComplete(ctx, {});
      expect(result).toBeNull();
      expect(ctx.currentTrajectoryId).toBeNull();
    });
  });

  // ── onSessionEnd ──────────────────────────────────

  describe("onSessionEnd", () => {
    it("no-ops gracefully (placeholder for P3)", () => {
      const ctx = makeCtx();
      onSessionEnd(ctx); // should not throw
    });

    it("no-ops when ctx is null", () => {
      onSessionEnd(null); // should not throw
    });

    it("no-ops when disabled", () => {
      const ctx = makeCtx({ enabled: false });
      onSessionEnd(ctx); // should not throw
    });
  });

  // ── createLearningContext ─────────────────────────

  describe("createLearningContext", () => {
    it("returns null when db is null", () => {
      expect(createLearningContext(null, "s1")).toBeNull();
    });

    it("returns null when explicitly disabled", () => {
      expect(createLearningContext(db, "s1", { enabled: false })).toBeNull();
    });

    it("creates a valid context with defaults", () => {
      const ctx = createLearningContext(db, "sess-42");
      expect(ctx).toBeTruthy();
      expect(ctx.enabled).toBe(true);
      expect(ctx.sessionId).toBe("sess-42");
      expect(ctx.currentTrajectoryId).toBeNull();
      // Duck-type check (require() in createLearningContext loads separate CJS instance)
      expect(typeof ctx.trajectoryStore.startTrajectory).toBe("function");
      expect(typeof ctx.trajectoryStore.appendToolCall).toBe("function");
      expect(typeof ctx.trajectoryStore.completeTrajectory).toBe("function");
    });

    it("creates context with enabled: true by default", () => {
      const ctx = createLearningContext(db, "s1", {});
      expect(ctx).toBeTruthy();
      expect(ctx.enabled).toBe(true);
    });
  });

  // ── Full lifecycle integration ────────────────────

  describe("full lifecycle", () => {
    it("tracks a complete user turn: submit → tools → complete", () => {
      const ctx = makeCtx();

      // User submits prompt
      onUserPromptSubmit(ctx, "refactor auth module");
      expect(ctx.currentTrajectoryId).toBe("traj-1");

      // Agent uses tools
      onPostToolUse(ctx, { tool: "read_file", args: { path: "auth.js" }, result: "code", durationMs: 10, status: "completed" });
      onPostToolUse(ctx, { tool: "edit_file", args: { path: "auth.js" }, result: "ok", durationMs: 20, status: "completed" });
      onPostToolUse(ctx, { tool: "run_shell", args: { cmd: "npm test" }, result: "pass", durationMs: 3000, status: "completed" });

      // Agent responds
      const traj = onResponseComplete(ctx, { finalResponse: "Refactored auth module" });
      expect(traj.toolCount).toBe(3);
      expect(traj.userIntent).toBe("refactor auth module");
      expect(traj.complexityLevel).toBe("moderate");

      // Ready for next turn
      expect(ctx.currentTrajectoryId).toBeNull();

      // Next turn
      onUserPromptSubmit(ctx, "add tests");
      expect(ctx.currentTrajectoryId).toBe("traj-2");
    });
  });
});
