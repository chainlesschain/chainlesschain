import { describe, it, expect, vi } from "vitest";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";

/** Capturing fake of the persistent ApprovalGate singleton. */
function fakeGate() {
  return {
    setSessionPolicy: () => {},
    setConfirmer: () => {},
    decide: async () => ({ decision: "allow", via: "test", policy: "test" }),
  };
}

/**
 * Deps that capture stdout and the messages the LLM sees. The injected chatFn
 * drives the REAL agent loop, so prepareCall (goal injection) actually runs and
 * its system-suffix lands in the messages chatFn receives.
 */
function makeDeps({ goal } = {}) {
  const out = [];
  let seenMessages = null;
  const chatFn = vi.fn(async (messages) => {
    seenMessages = messages;
    return {
      message: { role: "assistant", content: "ok" },
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  });
  const deps = {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => fakeGate(),
    writeOut: (s) => out.push(s),
    writeErr: () => {},
    now: (() => {
      let t = 1000;
      return () => (t += 5);
    })(),
    chatFn,
  };
  if (goal !== undefined) {
    deps.resolveActiveGoal = goal.fn;
  }
  return { deps, out, getSeen: () => seenMessages, chatFn };
}

const GOAL = {
  id: "goal-x",
  objective: "Ship Phase 1 goal binding",
  status: "active",
  progress: 20,
  keyResults: [{ id: "kr-1", text: "wire headless", done: false }],
};

describe("headless goal binding (cc goal Phase 1)", () => {
  it("injects goal context into the call when --goal <id> is given", async () => {
    const { deps, getSeen } = makeDeps({ goal: { fn: () => GOAL } });
    await runAgentHeadless(
      { prompt: "do it", outputFormat: "text", goal: "goal-x" },
      deps,
    );
    const sys = getSeen().find(
      (m) => m.role === "system" && /Ship Phase 1 goal binding/.test(m.content),
    );
    expect(sys).toBeTruthy();
    expect(sys.content).toContain("wire headless"); // open key result listed
  });

  it("does NOT bind (or even resolve) a goal when --goal is omitted", async () => {
    let called = false;
    const { deps, getSeen } = makeDeps({
      goal: {
        fn: () => {
          called = true;
          return GOAL;
        },
      },
    });
    await runAgentHeadless({ prompt: "x", outputFormat: "text" }, deps); // no goal
    expect(called).toBe(false);
    const sys = getSeen().find(
      (m) => m.role === "system" && /Ship Phase 1/.test(m.content),
    );
    expect(sys).toBeUndefined();
  });

  it("--goal with no value auto-resolves (explicitId null)", async () => {
    let seenSel = null;
    const { deps } = makeDeps({
      goal: {
        fn: (sel) => {
          seenSel = sel;
          return GOAL;
        },
      },
    });
    await runAgentHeadless(
      { prompt: "x", outputFormat: "text", goal: true },
      deps,
    );
    expect(seenSel).toMatchObject({ explicitId: null });
  });

  it("--goal <id> passes the explicit id through to resolution", async () => {
    let seenSel = null;
    const { deps } = makeDeps({
      goal: {
        fn: (sel) => {
          seenSel = sel;
          return GOAL;
        },
      },
    });
    await runAgentHeadless(
      { prompt: "x", outputFormat: "text", goal: "goal-x" },
      deps,
    );
    expect(seenSel.explicitId).toBe("goal-x");
  });

  it("emits goal_id in the stream-json init envelope", async () => {
    const { deps, out } = makeDeps({ goal: { fn: () => GOAL } });
    await runAgentHeadless(
      { prompt: "x", outputFormat: "stream-json", goal: "goal-x" },
      deps,
    );
    const init = JSON.parse(out.join("").trim().split("\n")[0]);
    expect(init.subtype).toBe("init");
    expect(init.goal_id).toBe("goal-x");
  });

  it("a goal that does not resolve leaves the run goal-free", async () => {
    const { deps, getSeen, out } = makeDeps({ goal: { fn: () => null } });
    await runAgentHeadless(
      { prompt: "x", outputFormat: "stream-json", goal: "nope" },
      deps,
    );
    const init = JSON.parse(out.join("").trim().split("\n")[0]);
    expect(init.goal_id).toBeNull();
    const sys = getSeen().find(
      (m) => m.role === "system" && /Ship Phase 1/.test(m.content),
    );
    expect(sys).toBeUndefined();
  });

  it("--goal-assess runs the run-end assessment and emits goal_assessment", async () => {
    const { deps, out } = makeDeps({ goal: { fn: () => GOAL } });
    // Inject store + assessment seams so nothing touches the real goal store.
    deps.getGoal = () => GOAL;
    let assessArgs = null;
    deps.assessGoalProgress = async (args) => {
      assessArgs = args;
      return {
        assessment: { advanced: true, progress: 35, note: "moved forward" },
        goal: GOAL,
      };
    };
    await runAgentHeadless(
      {
        prompt: "do it",
        outputFormat: "stream-json",
        goal: "goal-x",
        goalAssess: true,
      },
      deps,
    );
    // The transcript handed to the assessor reflects the run.
    expect(assessArgs.transcript).toMatchObject({ prompt: "do it" });
    const lines = out
      .join("")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const ev = lines.find((l) => l.type === "goal_assessment");
    expect(ev).toMatchObject({
      goal_id: "goal-x",
      advanced: true,
      progress: 35,
    });
  });

  it("does NOT assess when --goal-assess is omitted", async () => {
    const { deps, out } = makeDeps({ goal: { fn: () => GOAL } });
    deps.getGoal = () => GOAL;
    let called = false;
    deps.assessGoalProgress = async () => {
      called = true;
      return { assessment: null, goal: GOAL };
    };
    await runAgentHeadless(
      { prompt: "x", outputFormat: "stream-json", goal: "goal-x" }, // no goalAssess
      deps,
    );
    expect(called).toBe(false);
    const lines = out
      .join("")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines.find((l) => l.type === "goal_assessment")).toBeUndefined();
  });
});
