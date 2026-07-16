/**
 * background-phase-reporter — the producer that finally WRITES
 * `phase: "waiting_permission"` + `pendingApprovals` into the shared
 * background-agent state file while a human-blocking confirmer is pending
 * (P0 state-machine slice). IO is injected — no real user data dir is touched.
 */
import { describe, it, expect, vi } from "vitest";
import { createBackgroundPhaseReporter } from "../../src/lib/background-phase-reporter.js";

function makeStore(initial = {}) {
  const states = new Map(Object.entries(initial));
  return {
    states,
    readState: (id) => states.get(id) || null,
    writeState: (state) => states.set(state.id, state),
  };
}

describe("createBackgroundPhaseReporter — disabled (non-background run)", () => {
  it("is a no-op without an agent id: same confirmer object, zero IO", () => {
    const readState = vi.fn();
    const writeState = vi.fn();
    const reporter = createBackgroundPhaseReporter({
      agentId: null,
      readState,
      writeState,
    });
    expect(reporter.enabled).toBe(false);

    const confirmer = async () => true;
    // Object identity preserved — the default (foreground) path stays
    // byte-identical, not merely behavior-equivalent.
    expect(reporter.wrapConfirmer(confirmer)).toBe(confirmer);

    reporter.beginApproval();
    reporter.endApproval();
    expect(readState).not.toHaveBeenCalled();
    expect(writeState).not.toHaveBeenCalled();
  });

  it("treats a blank/whitespace agent id as disabled", () => {
    const reporter = createBackgroundPhaseReporter({
      agentId: "   ",
      readState: vi.fn(),
      writeState: vi.fn(),
    });
    expect(reporter.enabled).toBe(false);
  });
});

describe("createBackgroundPhaseReporter — pending window", () => {
  it("writes waiting_permission on begin and restores turn on settle", () => {
    const store = makeStore({
      "bg-1": { id: "bg-1", status: "running", phase: "turn", turnCount: 3 },
    });
    const reporter = createBackgroundPhaseReporter({
      agentId: "bg-1",
      ...store,
    });

    reporter.beginApproval();
    expect(store.states.get("bg-1")).toMatchObject({
      phase: "waiting_permission",
      pendingApprovals: 1,
      turnCount: 3, // merge, not replace — sibling fields survive
    });

    reporter.endApproval();
    expect(store.states.get("bg-1")).toMatchObject({
      phase: "turn",
      pendingApprovals: 0,
    });
  });

  it("counts overlapping approvals and only restores when the last settles", () => {
    const store = makeStore({
      "bg-1": { id: "bg-1", status: "running" },
    });
    const reporter = createBackgroundPhaseReporter({
      agentId: "bg-1",
      ...store,
    });

    reporter.beginApproval();
    reporter.beginApproval();
    expect(store.states.get("bg-1").pendingApprovals).toBe(2);
    expect(store.states.get("bg-1").phase).toBe("waiting_permission");

    reporter.endApproval();
    // One still pending — phase must stay blocked.
    expect(store.states.get("bg-1").pendingApprovals).toBe(1);
    expect(store.states.get("bg-1").phase).toBe("waiting_permission");

    reporter.endApproval();
    expect(store.states.get("bg-1").pendingApprovals).toBe(0);
    expect(store.states.get("bg-1").phase).toBe("turn");
  });

  it("never resurrects a terminal session", () => {
    const store = makeStore({
      "bg-1": { id: "bg-1", status: "completed", exitCode: 0 },
    });
    const reporter = createBackgroundPhaseReporter({
      agentId: "bg-1",
      ...store,
    });
    reporter.beginApproval();
    // Untouched — the stopper/worker owns terminal records.
    expect(store.states.get("bg-1")).toEqual({
      id: "bg-1",
      status: "completed",
      exitCode: 0,
    });
  });

  it("survives state IO failures without breaking the approval", () => {
    const reporter = createBackgroundPhaseReporter({
      agentId: "bg-1",
      readState: () => {
        throw new Error("disk gone");
      },
      writeState: () => {
        throw new Error("disk gone");
      },
    });
    expect(() => reporter.beginApproval()).not.toThrow();
    expect(() => reporter.endApproval()).not.toThrow();
    expect(reporter.pendingCount()).toBe(0);
  });
});

describe("wrapConfirmer", () => {
  it("reports the pending window around the confirmer and passes through the verdict", async () => {
    const store = makeStore({ "bg-1": { id: "bg-1", status: "running" } });
    const reporter = createBackgroundPhaseReporter({
      agentId: "bg-1",
      ...store,
    });

    let midPhase = null;
    let midPending = null;
    const wrapped = reporter.wrapConfirmer(async (ctx) => {
      midPhase = store.states.get("bg-1").phase;
      midPending = store.states.get("bg-1").pendingApprovals;
      return ctx.answer;
    });

    const verdict = await wrapped({ answer: true });
    expect(verdict).toBe(true);
    // While the human decision was pending the state said so…
    expect(midPhase).toBe("waiting_permission");
    expect(midPending).toBe(1);
    // …and settling restored the live-turn phase.
    expect(store.states.get("bg-1")).toMatchObject({
      phase: "turn",
      pendingApprovals: 0,
    });
  });

  it("clears the pending window even when the confirmer throws", async () => {
    const store = makeStore({ "bg-1": { id: "bg-1", status: "running" } });
    const reporter = createBackgroundPhaseReporter({
      agentId: "bg-1",
      ...store,
    });
    const wrapped = reporter.wrapConfirmer(async () => {
      throw new Error("bridge timeout");
    });
    await expect(wrapped({})).rejects.toThrow("bridge timeout");
    expect(store.states.get("bg-1")).toMatchObject({
      phase: "turn",
      pendingApprovals: 0,
    });
    expect(reporter.pendingCount()).toBe(0);
  });

  it("returns non-function confirmers unchanged", () => {
    const store = makeStore({ "bg-1": { id: "bg-1", status: "running" } });
    const reporter = createBackgroundPhaseReporter({
      agentId: "bg-1",
      ...store,
    });
    expect(reporter.wrapConfirmer(null)).toBe(null);
    expect(reporter.wrapConfirmer(undefined)).toBe(undefined);
  });
});

describe("dashboard contract round-trip", () => {
  it("the written state classifies as needs-input, and the settled state as working", async () => {
    const { phaseGroupKey } =
      await import("../../src/lib/background-agent-phase.js");
    const store = makeStore({ "bg-1": { id: "bg-1", status: "running" } });
    const reporter = createBackgroundPhaseReporter({
      agentId: "bg-1",
      ...store,
    });

    reporter.beginApproval();
    expect(phaseGroupKey(store.states.get("bg-1"))).toBe("needs-input");

    reporter.endApproval();
    expect(phaseGroupKey(store.states.get("bg-1"))).toBe("working");
  });
});
