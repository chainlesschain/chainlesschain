/**
 * Unified session lifecycle state machine (P0#4 "统一状态机" from
 * CLAUDE_CODE_IDE_GAP_ANALYSIS.md). Pure + deterministic: folds the three
 * divergent producer vocabularies (supervisor status / worker phase / IDE
 * connection) into one canonical lifecycle, encodes the legal transition graph,
 * and marks the recovery window that carries the dangerous-tool idempotency
 * guard ("危险工具恢复时不得静默重试").
 */
import { describe, it, expect } from "vitest";
import {
  SESSION_STATES,
  normalizeSessionState,
  deriveSessionState,
  canTransitionSessionState,
  isTerminalSessionState,
  isActiveSessionState,
  requiresIdempotencyGuard,
  describeSessionState,
} from "../../src/lib/session-lifecycle.js";

describe("normalizeSessionState", () => {
  it("maps each producer's vocabulary to the same canonical state", () => {
    // worker phase
    expect(normalizeSessionState("working")).toBe(SESSION_STATES.RUNNING);
    expect(normalizeSessionState("turn")).toBe(SESSION_STATES.RUNNING);
    expect(normalizeSessionState("idle")).toBe(SESSION_STATES.READY);
    expect(normalizeSessionState("needs_input")).toBe(
      SESSION_STATES.WAITING_APPROVAL,
    );
    expect(normalizeSessionState("waiting_permission")).toBe(
      SESSION_STATES.WAITING_APPROVAL,
    );
    // supervisor liveness — a running process that vanished is a failure.
    expect(normalizeSessionState("lost")).toBe(SESSION_STATES.FAILED);
    // IDE connection / transport
    expect(normalizeSessionState("connected")).toBe(SESSION_STATES.READY);
    expect(normalizeSessionState("reconnecting")).toBe(
      SESSION_STATES.RECOVERING,
    );
    expect(normalizeSessionState("resuming")).toBe(SESSION_STATES.RECOVERING);
    expect(normalizeSessionState("crashed")).toBe(SESSION_STATES.FAILED);
    expect(normalizeSessionState("cancelled")).toBe(SESSION_STATES.STOPPED);
  });

  it("is case/whitespace tolerant and null-safe", () => {
    expect(normalizeSessionState("  RUNNING ")).toBe(SESSION_STATES.RUNNING);
    expect(normalizeSessionState("waitingApproval")).toBe(
      SESSION_STATES.WAITING_APPROVAL,
    );
    expect(normalizeSessionState("bogus")).toBeNull();
    expect(normalizeSessionState("")).toBeNull();
    expect(normalizeSessionState(null)).toBeNull();
    expect(normalizeSessionState(42)).toBeNull();
  });
});

describe("deriveSessionState precedence", () => {
  it("1. terminal supervisor status absorbs every other axis", () => {
    // Even with an inner phase and a live-looking connection, a settled verdict wins.
    expect(
      deriveSessionState({
        status: "completed",
        phase: "working",
        connection: "running",
      }),
    ).toBe(SESSION_STATES.COMPLETED);
    expect(deriveSessionState({ status: "lost", phase: "idle" })).toBe(
      SESSION_STATES.FAILED,
    );
    expect(
      deriveSessionState({
        status: "stopped",
        cancelRequested: true,
        pendingApprovals: 3,
      }),
    ).toBe(SESSION_STATES.STOPPED);
  });

  it("2. active recovery outranks disconnect, cancel and approval", () => {
    expect(
      deriveSessionState({ status: "running", connection: "reconnecting" }),
    ).toBe(SESSION_STATES.RECOVERING);
    // explicit flag, even mid-cancel with a pending approval, still surfaces recovery.
    expect(
      deriveSessionState({
        status: "running",
        recovering: true,
        cancelRequested: true,
        pendingApprovals: 2,
      }),
    ).toBe(SESSION_STATES.RECOVERING);
  });

  it("3. a lost transport outranks the stale inner phase", () => {
    expect(
      deriveSessionState({
        status: "running",
        phase: "working",
        connection: "disconnected",
      }),
    ).toBe(SESSION_STATES.DISCONNECTED);
  });

  it("4. cancel-in-flight outranks approval and running", () => {
    expect(
      deriveSessionState({
        status: "running",
        cancelRequested: true,
        pendingApprovals: 1,
      }),
    ).toBe(SESSION_STATES.CANCELLING);
    expect(
      deriveSessionState({ status: "running", connection: "stopping" }),
    ).toBe(SESSION_STATES.CANCELLING);
  });

  it("5. a pending approval or a blocking phase → waitingApproval", () => {
    expect(deriveSessionState({ status: "running", pendingApprovals: 1 })).toBe(
      SESSION_STATES.WAITING_APPROVAL,
    );
    // even a phase the worker last marked idle is blocked when an approval is pending.
    expect(
      deriveSessionState({
        status: "running",
        phase: "idle",
        pendingApprovals: 2,
      }),
    ).toBe(SESSION_STATES.WAITING_APPROVAL);
    expect(
      deriveSessionState({ status: "running", phase: "waiting_permission" }),
    ).toBe(SESSION_STATES.WAITING_APPROVAL);
  });

  it("6. steady worker sub-phases map through", () => {
    expect(deriveSessionState({ status: "running", phase: "turn" })).toBe(
      SESSION_STATES.RUNNING,
    );
    expect(deriveSessionState({ status: "running", phase: "idle" })).toBe(
      SESSION_STATES.READY,
    );
    expect(deriveSessionState({ status: "running", phase: "starting" })).toBe(
      SESSION_STATES.STARTING,
    );
    expect(deriveSessionState({ connection: "connected" })).toBe(
      SESSION_STATES.READY,
    );
  });

  it("7. a running session with no legible phase is running, never idle", () => {
    expect(deriveSessionState({ status: "running", phase: "bogus" })).toBe(
      SESSION_STATES.RUNNING,
    );
    expect(deriveSessionState({ status: "running" })).toBe(
      SESSION_STATES.RUNNING,
    );
  });

  it("falls back to starting when nothing is legible", () => {
    expect(deriveSessionState({})).toBe(SESSION_STATES.STARTING);
    expect(deriveSessionState(null)).toBe(SESSION_STATES.STARTING);
    expect(deriveSessionState({ phase: "bogus", connection: "bogus" })).toBe(
      SESSION_STATES.STARTING,
    );
  });
});

describe("transition graph", () => {
  it("allows the normal running lifecycle", () => {
    expect(canTransitionSessionState("starting", "running")).toBe(true);
    expect(canTransitionSessionState("running", "waitingApproval")).toBe(true);
    expect(canTransitionSessionState("waitingApproval", "running")).toBe(true);
    expect(canTransitionSessionState("running", "completed")).toBe(true);
  });

  it("allows the disconnect → recover → resume path", () => {
    expect(canTransitionSessionState("running", "disconnected")).toBe(true);
    expect(canTransitionSessionState("disconnected", "recovering")).toBe(true);
    expect(canTransitionSessionState("recovering", "running")).toBe(true);
    expect(canTransitionSessionState("recovering", "waitingApproval")).toBe(
      true,
    );
  });

  it("lets a turn settle even after a cancel was requested", () => {
    expect(canTransitionSessionState("cancelling", "stopped")).toBe(true);
    expect(canTransitionSessionState("cancelling", "completed")).toBe(true);
    expect(canTransitionSessionState("cancelling", "failed")).toBe(true);
  });

  it("forbids leaving a terminal state", () => {
    for (const terminal of ["completed", "failed", "stopped"]) {
      expect(canTransitionSessionState(terminal, "running")).toBe(false);
      expect(canTransitionSessionState(terminal, "ready")).toBe(false);
    }
  });

  it("forbids illegal jumps and unknown states", () => {
    // cannot jump straight from starting to a terminal-success without running.
    expect(canTransitionSessionState("starting", "completed")).toBe(false);
    // cannot go from recovering straight back to starting.
    expect(canTransitionSessionState("recovering", "starting")).toBe(false);
    expect(canTransitionSessionState("bogus", "running")).toBe(false);
    expect(canTransitionSessionState("running", "bogus")).toBe(false);
  });

  it("always permits an idempotent self-transition", () => {
    for (const state of Object.values(SESSION_STATES)) {
      expect(canTransitionSessionState(state, state)).toBe(true);
    }
  });
});

describe("terminal / active classification", () => {
  it("classifies the three terminal states", () => {
    for (const t of ["completed", "failed", "stopped"]) {
      expect(isTerminalSessionState(t)).toBe(true);
      expect(isActiveSessionState(t)).toBe(false);
    }
  });

  it("classifies the live states as active", () => {
    for (const a of [
      "starting",
      "ready",
      "running",
      "waitingApproval",
      "cancelling",
      "disconnected",
      "recovering",
    ]) {
      expect(isActiveSessionState(a)).toBe(true);
      expect(isTerminalSessionState(a)).toBe(false);
    }
  });

  it("treats an unknown token as neither terminal nor active", () => {
    expect(isTerminalSessionState("bogus")).toBe(false);
    expect(isActiveSessionState("bogus")).toBe(false);
  });
});

describe("requiresIdempotencyGuard", () => {
  it("guards recovery and the disconnect that precedes it — the at-most-once hazard", () => {
    expect(requiresIdempotencyGuard(SESSION_STATES.RECOVERING)).toBe(true);
    expect(requiresIdempotencyGuard(SESSION_STATES.DISCONNECTED)).toBe(true);
  });

  it("does not guard the steady states — a normal turn replays nothing", () => {
    for (const state of [
      "starting",
      "ready",
      "running",
      "waitingApproval",
      "cancelling",
      "completed",
      "failed",
      "stopped",
    ]) {
      expect(requiresIdempotencyGuard(state)).toBe(false);
    }
  });
});

describe("describeSessionState", () => {
  it("gives a distinct human-readable line for each canonical state and a safe default", () => {
    const seen = new Set();
    for (const state of Object.values(SESSION_STATES)) {
      const line = describeSessionState(state);
      expect(typeof line).toBe("string");
      expect(line.length).toBeGreaterThan(0);
      expect(seen.has(line)).toBe(false); // each state has its own description
      seen.add(line);
    }
    // the recovery line names the guard invariant.
    expect(describeSessionState(SESSION_STATES.RECOVERING)).toMatch(/ledger/);
    expect(describeSessionState("bogus")).toBe("unknown session state");
  });
});
