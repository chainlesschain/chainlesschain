/**
 * Stream-mode plan controls (chat-panel plan UI) — stdin
 * {"type":"plan","action":…} mirrors the REPL's /plan verbs:
 *   enter   → plan mode on (write tools become plan items) + plan_update
 *   approve → unlock + plan_update + an IMMEDIATE continuation turn
 *   reject  → off + plan_update
 * plus a live plan_update after every turn while planning. Uses the real
 * process-global PlanModeManager (reset around each test).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  runAgentHeadlessStream,
  parseInputEvent,
  planSnapshot,
} from "../../src/runtime/headless-stream.js";
import { getPlanModeManager } from "../../src/lib/plan-mode.js";

function resetPlan() {
  const pm = getPlanModeManager();
  try {
    if (pm.isActive()) pm.rejectPlan("test reset");
  } catch {
    /* ignore */
  }
}

function harness({ inputObjs, agentLoop } = {}) {
  const lines = [];
  const seenTurns = [];
  const loop =
    agentLoop ||
    async function* (messages) {
      seenTurns.push(
        messages.map((m) => ({ role: m.role, content: m.content })),
      );
      yield { type: "response-complete", content: "reply" };
      yield { type: "run-ended", reason: "complete" };
    };
  async function* input() {
    for (const o of inputObjs) yield JSON.stringify(o) + "\n";
  }
  const deps = {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => null,
    writeOut: (s) => lines.push(s),
    writeErr: () => {},
    agentLoop: loop,
    input: input(),
  };
  return {
    run: () => runAgentHeadlessStream({ expandFileRefs: false }, deps),
    events: () =>
      lines
        .join("")
        .trimEnd()
        .split("\n")
        .map((l) => JSON.parse(l)),
    seenTurns,
  };
}

describe("parseInputEvent — plan controls", () => {
  it("parses plan actions and ignores empty ones", () => {
    expect(parseInputEvent('{"type":"plan","action":"enter"}')).toEqual({
      plan: "enter",
    });
    expect(parseInputEvent('{"type":"plan","action":"APPROVE"}')).toEqual({
      plan: "approve",
    });
    expect(parseInputEvent('{"type":"plan"}')).toBe(null);
  });

  it("parses optional IDE review snapshots on plan controls", () => {
    const parsed = parseInputEvent(
      JSON.stringify({
        type: "plan",
        action: "approve",
        review: {
          action: "approve",
          reviewedAt: "2026-07-10T00:00:00.000Z",
          conversationId: "conv-1",
          revision: 4,
          comments: [
            {
              id: "c1",
              itemId: "p1",
              text: "Keep src/a.js:12 compatible",
              file: "src/a.js",
              line: 12,
              turn: 2,
            },
          ],
          snapshot: "# Plan\n\nLooks good.",
        },
      }),
    );
    expect(parsed).toMatchObject({
      plan: "approve",
      planReview: {
        action: "approve",
        reviewedAt: "2026-07-10T00:00:00.000Z",
        conversationId: "conv-1",
        revision: 4,
        comments: [
          expect.objectContaining({
            id: "c1",
            itemId: "p1",
            file: "src/a.js",
            line: 12,
            turn: 2,
          }),
        ],
        snapshot: "# Plan\n\nLooks good.",
      },
    });
  });
});

describe("stream plan mode", () => {
  beforeEach(resetPlan);
  afterEach(resetPlan);

  it("enter → plan_update(active) + [PLAN MODE ACTIVE] visible to the next turn", async () => {
    const h = harness({
      inputObjs: [
        { type: "plan", action: "enter" },
        { type: "user", text: "analyze the task" },
      ],
    });
    await h.run();
    const updates = h.events().filter((e) => e.type === "plan_update");
    expect(updates.length).toBeGreaterThanOrEqual(2); // on enter + after turn
    expect(updates[0].active).toBe(true);
    const sys = h.seenTurns[0].filter((m) => m.role === "system");
    expect(sys.some((m) => /PLAN MODE ACTIVE/.test(m.content))).toBe(true);
  });

  it("approve with items unlocks and runs a continuation turn by itself", async () => {
    const h = harness({
      inputObjs: [
        { type: "plan", action: "enter" },
        { type: "plan", action: "approve" },
      ],
    });
    // seed a plan item the way executeTool would (blocked write during planning)
    const pm = getPlanModeManager();
    const origEnter = pm.enterPlanMode.bind(pm);
    pm.enterPlanMode = (o) => {
      const r = origEnter(o);
      pm.addPlanItem({
        title: "write_file: a.js",
        tool: "write_file",
        params: { path: "a.js" },
        estimatedImpact: "medium",
      });
      return r;
    };
    try {
      await h.run();
    } finally {
      pm.enterPlanMode = origEnter;
    }
    const updates = h.events().filter((e) => e.type === "plan_update");
    expect(updates[0].items).toHaveLength(1);
    expect(updates[0].items[0].tool).toBe("write_file");
    // the approve triggered ONE turn without any user event on stdin
    expect(h.seenTurns).toHaveLength(1);
    const userMsgs = h.seenTurns[0].filter((m) => m.role === "user");
    expect(userMsgs.pop().content).toBe("Proceed with the approved plan.");
    const sys = h.seenTurns[0].filter((m) => m.role === "system");
    expect(sys.some((m) => /PLAN APPROVED/.test(m.content))).toBe(true);
    // a result event for that turn exists
    expect(h.events().some((e) => e.type === "result" && !e.is_error)).toBe(
      true,
    );
  });

  it("approve writes an IDE review snapshot into the continuation turn", async () => {
    const h = harness({
      inputObjs: [
        { type: "plan", action: "enter" },
        {
          type: "plan",
          action: "approve",
          review: {
            action: "approve",
            snapshot: "# Review\n\nApproved.",
            comments: [{ itemId: "p1", text: "Keep src/a.js:12 compatible" }],
          },
        },
      ],
    });
    const pm = getPlanModeManager();
    const origEnter = pm.enterPlanMode.bind(pm);
    pm.enterPlanMode = (o) => {
      const r = origEnter(o);
      pm.addPlanItem({
        title: "write_file: a.js",
        tool: "write_file",
        params: { path: "a.js" },
        estimatedImpact: "medium",
      });
      return r;
    };
    try {
      await h.run();
    } finally {
      pm.enterPlanMode = origEnter;
    }
    const sys = h.seenTurns[0].filter((m) => m.role === "system");
    expect(sys.some((m) => /PLAN REVIEW SNAPSHOT/.test(m.content))).toBe(true);
    expect(sys.some((m) => /# Review/.test(m.content))).toBe(true);
    expect(
      sys.some((m) => /PLAN REVIEW STRUCTURED COMMENTS/.test(m.content)),
    ).toBe(true);
  });

  it("attributes tool execution to a plan item and streams its progress", async () => {
    const h = harness({
      inputObjs: [
        { type: "plan", action: "enter" },
        { type: "plan", action: "approve" },
      ],
      agentLoop: async function* () {
        yield {
          type: "tool-executing",
          tool: "edit_file",
          args: { path: "a.js" },
        };
        yield {
          type: "tool-result",
          tool: "edit_file",
          result: { ok: true },
        };
        yield { type: "response-complete", content: "done" };
        yield { type: "run-ended", reason: "complete" };
      },
    });
    const pm = getPlanModeManager();
    const origEnter = pm.enterPlanMode.bind(pm);
    pm.enterPlanMode = (options) => {
      const result = origEnter(options);
      pm.addPlanItem({
        id: "p1",
        title: "Edit a.js",
        tool: "edit_file",
        params: { path: "a.js" },
      });
      return result;
    };
    try {
      await h.run();
    } finally {
      pm.enterPlanMode = origEnter;
    }

    const events = h.events();
    expect(events.find((event) => event.type === "tool_use")).toMatchObject({
      id: "tu-1",
      plan_item_id: "p1",
      turn: 1,
    });
    expect(events.find((event) => event.type === "tool_result")).toMatchObject({
      id: "tu-1",
      plan_item_id: "p1",
      turn: 1,
      is_error: false,
    });
    const updates = events.filter((event) => event.type === "plan_update");
    expect(
      updates.some(
        (event) =>
          event.state === "executing" && event.items[0]?.status === "executing",
      ),
    ).toBe(true);
    expect(
      updates.some(
        (event) =>
          event.state === "completed" && event.items[0]?.status === "completed",
      ),
    ).toBe(true);
  });

  it("approve with NO items reports 'nothing to approve' and runs no turn", async () => {
    const h = harness({
      inputObjs: [
        { type: "plan", action: "enter" },
        { type: "plan", action: "approve" },
      ],
    });
    await h.run();
    const note = h
      .events()
      .find((e) => e.type === "plan_update" && e.note === "nothing to approve");
    expect(note).toBeTruthy();
    expect(h.seenTurns).toHaveLength(0);
  });

  it("reject turns plan mode off", async () => {
    const h = harness({
      inputObjs: [
        { type: "plan", action: "enter" },
        { type: "plan", action: "reject" },
      ],
    });
    await h.run();
    const updates = h.events().filter((e) => e.type === "plan_update");
    expect(updates[0].active).toBe(true);
    expect(updates[updates.length - 1].active).toBe(false);
    expect(h.seenTurns).toHaveLength(0);
  });

  it("planSnapshot never throws on a virgin manager", () => {
    const snap = planSnapshot(getPlanModeManager());
    expect(snap).toMatchObject({ active: false, items: [] });
  });
});
