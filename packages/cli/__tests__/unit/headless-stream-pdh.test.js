/**
 * Stream-mode PDH chat controls (Personal-Data IDE / PDH Bridge, design module
 * 101) — the cc-side consumption of the two events the Android chat emits:
 *   §3.5.13 {"type":"feedback","turn_id":…,"kind":…,"comment":…}  self-learning
 *   §3.5.15 {"type":"resume","token":…,"action":…}                guided collect
 *
 * Both are acked (feedback_ack / resume_ack) so the app can confirm/dismiss the
 * card; a `correction` and every `resume` re-drive a turn so the model adapts /
 * retries, while positive/negative feedback is recorded in history without a
 * fresh reply. Mirrors the plan-control test harness.
 */
import { describe, it, expect } from "vitest";
import {
  runAgentHeadlessStream,
  parseInputEvent,
} from "../../src/runtime/headless-stream.js";

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

describe("parseInputEvent — PDH feedback (§3.5.13)", () => {
  it("parses each kind and reads optional turn_id/comment", () => {
    expect(
      parseInputEvent(
        '{"type":"feedback","turn_id":"t1","kind":"correction","comment":"应该用人民币"}',
      ),
    ).toEqual({
      feedback: { turnId: "t1", kind: "correction", comment: "应该用人民币" },
    });
    expect(parseInputEvent('{"type":"feedback","kind":"POSITIVE"}')).toEqual({
      feedback: { turnId: null, kind: "positive", comment: null },
    });
  });

  it("skips a feedback with no kind", () => {
    expect(parseInputEvent('{"type":"feedback","turn_id":"t1"}')).toBe(null);
  });
});

describe("parseInputEvent — PDH resume (§3.5.15)", () => {
  it("parses completed/skip and reads optional token", () => {
    expect(
      parseInputEvent('{"type":"resume","token":"k1","action":"completed"}'),
    ).toEqual({ resume: { token: "k1", action: "completed" } });
    expect(parseInputEvent('{"type":"resume","action":"SKIP"}')).toEqual({
      resume: { token: null, action: "skip" },
    });
  });

  it("skips a resume with no action", () => {
    expect(parseInputEvent('{"type":"resume","token":"k1"}')).toBe(null);
  });
});

describe("stream PDH feedback consumption", () => {
  it("correction → feedback_ack + a turn carrying the correction prompt", async () => {
    const h = harness({
      inputObjs: [
        {
          type: "feedback",
          turn_id: "t1",
          kind: "correction",
          comment: "金额应是人民币不是美元",
        },
      ],
    });
    await h.run();
    const ack = h.events().find((e) => e.type === "feedback_ack");
    expect(ack).toMatchObject({ turn_id: "t1", kind: "correction" });
    // a turn ran, and its last user message is the correction prompt
    expect(h.seenTurns).toHaveLength(1);
    const lastUser = h.seenTurns[0].filter((m) => m.role === "user").pop();
    expect(lastUser.content).toContain("纠正");
    expect(lastUser.content).toContain("金额应是人民币不是美元");
  });

  it("positive → feedback_ack + a history note, but no fresh turn", async () => {
    const h = harness({
      inputObjs: [{ type: "feedback", turn_id: "t1", kind: "positive" }],
    });
    await h.run();
    const ack = h.events().find((e) => e.type === "feedback_ack");
    expect(ack).toMatchObject({ turn_id: "t1", kind: "positive" });
    expect(h.seenTurns).toHaveLength(0); // no turn driven
  });

  it("negative → feedback_ack + a history note seen by the NEXT turn", async () => {
    const h = harness({
      inputObjs: [
        { type: "feedback", turn_id: "t1", kind: "negative" },
        { type: "user", text: "继续" },
      ],
    });
    await h.run();
    expect(h.events().some((e) => e.type === "feedback_ack")).toBe(true);
    // the negative-preference note is in history when the next turn runs
    expect(h.seenTurns).toHaveLength(1);
    const userContents = h.seenTurns[0]
      .filter((m) => m.role === "user")
      .map((m) => m.content);
    expect(userContents.some((c) => /不满意/.test(c))).toBe(true);
    expect(userContents.some((c) => c === "继续")).toBe(true);
  });
});

describe("stream PDH resume consumption", () => {
  it("completed → resume_ack + a retry turn", async () => {
    const h = harness({
      inputObjs: [{ type: "resume", token: "k1", action: "completed" }],
    });
    await h.run();
    const ack = h.events().find((e) => e.type === "resume_ack");
    expect(ack).toMatchObject({ token: "k1", action: "completed" });
    expect(h.seenTurns).toHaveLength(1);
    const lastUser = h.seenTurns[0].filter((m) => m.role === "user").pop();
    expect(lastUser.content).toContain("重试");
  });

  it("skip → resume_ack + a move-on turn", async () => {
    const h = harness({
      inputObjs: [{ type: "resume", token: "k1", action: "skip" }],
    });
    await h.run();
    const ack = h.events().find((e) => e.type === "resume_ack");
    expect(ack).toMatchObject({ token: "k1", action: "skip" });
    expect(h.seenTurns).toHaveLength(1);
    const lastUser = h.seenTurns[0].filter((m) => m.role === "user").pop();
    expect(lastUser.content).toContain("跳过");
  });
});
