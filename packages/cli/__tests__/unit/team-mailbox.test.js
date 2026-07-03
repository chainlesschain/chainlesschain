import { describe, it, expect } from "vitest";
import { TeamMailbox } from "../../src/lib/agent-team/team-mailbox.js";

describe("TeamMailbox directed delivery", () => {
  it("delivers a direct message once and only to its recipient", () => {
    const mb = new TeamMailbox();
    mb.send({ from: "a", to: "b", body: "hi b" });
    expect(mb.pendingCount("c")).toBe(0); // not addressed to c
    const forB = mb.drain("b");
    expect(forB).toHaveLength(1);
    expect(forB[0].body).toBe("hi b");
    expect(mb.drain("b")).toHaveLength(0); // already delivered — cursor advanced
  });

  it("delivers a broadcast to every teammate except the sender, once each", () => {
    const mb = new TeamMailbox();
    mb.send({ from: "a", to: "*", body: "all hands" });
    expect(mb.drain("a")).toHaveLength(0); // sender never gets its own broadcast
    expect(mb.drain("b")).toHaveLength(1);
    expect(mb.drain("c")).toHaveLength(1);
    expect(mb.drain("b")).toHaveLength(0); // b already saw it
    expect(mb.drain("c")).toHaveLength(0);
  });

  it("peek does not advance the delivery cursor", () => {
    const mb = new TeamMailbox();
    mb.send({ from: "a", to: "b", body: "1" });
    expect(mb.peek("b")).toHaveLength(1);
    expect(mb.peek("b")).toHaveLength(1); // still pending
    expect(mb.drain("b")).toHaveLength(1);
    expect(mb.peek("b")).toHaveLength(0);
  });

  it("requires a recipient", () => {
    const mb = new TeamMailbox();
    expect(() => mb.send({ from: "a", body: "x" })).toThrow(/recipient/);
  });

  it("assigns monotonic ids independent of the clock", () => {
    let t = 5;
    const mb = new TeamMailbox({ now: () => t });
    const m1 = mb.send({ from: "a", to: "b", body: "1" });
    t = 3; // clock goes backwards — ids must not
    const m2 = mb.send({ from: "a", to: "b", body: "2" });
    expect(m2.id).toBe(m1.id + 1);
    expect(m1.ts).toBe(5);
    expect(m2.ts).toBe(3);
  });
});

describe("TeamMailbox snapshot/restore", () => {
  it("re-delivers only what a recipient had not yet drained", () => {
    const mb = new TeamMailbox();
    mb.send({ from: "a", to: "b", body: "first" });
    mb.drain("b"); // b has seen the first
    mb.send({ from: "a", to: "b", body: "second" }); // not yet drained
    const snap = mb.snapshot();

    const restored = TeamMailbox.restore(snap);
    const pending = restored.drain("b");
    expect(pending).toHaveLength(1);
    expect(pending[0].body).toBe("second");
    // A new message after restore keeps the id sequence monotonic.
    const m = restored.send({ from: "a", to: "b", body: "third" });
    expect(m.id).toBe(3);
  });
});
