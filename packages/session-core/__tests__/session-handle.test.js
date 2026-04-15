import { describe, it, expect } from "vitest";
import {
  SessionHandle,
  STATUS,
  APPROVAL_POLICIES,
  generateSessionId,
} from "../lib/session-handle.js";

describe("SessionHandle — construction", () => {
  it("requires agentId", () => {
    expect(() => new SessionHandle({})).toThrow(/agentId is required/);
  });

  it("auto-generates sessionId when not provided", () => {
    const s = new SessionHandle({ agentId: "agent-1" });
    expect(s.sessionId).toMatch(/^sess_[a-f0-9]{16}$/);
  });

  it("uses provided sessionId", () => {
    const s = new SessionHandle({ agentId: "agent-1", sessionId: "custom-id" });
    expect(s.sessionId).toBe("custom-id");
  });

  it("defaults approvalPolicy to strict", () => {
    const s = new SessionHandle({ agentId: "agent-1" });
    expect(s.approvalPolicy).toBe("strict");
  });

  it("rejects invalid approvalPolicy", () => {
    expect(
      () => new SessionHandle({ agentId: "agent-1", approvalPolicy: "yolo" })
    ).toThrow(/invalid approvalPolicy/);
  });

  it("starts in running status", () => {
    const s = new SessionHandle({ agentId: "agent-1" });
    expect(s.status).toBe(STATUS.RUNNING);
  });

  it("initializes runtimeMs and idleMs to 0", () => {
    const s = new SessionHandle({ agentId: "agent-1" });
    expect(s.runtimeMs).toBe(0);
    expect(s.idleMs).toBe(0);
  });
});

describe("SessionHandle — state transitions", () => {
  it("running → idle accumulates runtimeMs", () => {
    const s = new SessionHandle({ agentId: "a", now: 1000 });
    s.idle(6000);
    expect(s.runtimeMs).toBe(5000);
    expect(s.status).toBe(STATUS.IDLE);
  });

  it("idle → running accumulates idleMs", () => {
    const s = new SessionHandle({ agentId: "a", now: 1000 });
    s.idle(2000);
    s.touch(5000);
    expect(s.idleMs).toBe(3000);
    expect(s.status).toBe(STATUS.RUNNING);
  });

  it("idle → parked", () => {
    const s = new SessionHandle({ agentId: "a", now: 1000 });
    s.idle(2000);
    const ok = s.park(3000);
    expect(ok).toBe(true);
    expect(s.status).toBe(STATUS.PARKED);
    expect(s.idleMs).toBe(1000);
  });

  it("parked → running via resume", () => {
    const s = new SessionHandle({ agentId: "a", now: 1000 });
    s.idle(2000);
    s.park(3000);
    const ok = s.resume(4000);
    expect(ok).toBe(true);
    expect(s.status).toBe(STATUS.RUNNING);
  });

  it("resume fails if not parked", () => {
    const s = new SessionHandle({ agentId: "a" });
    expect(s.resume()).toBe(false);
  });

  it("running → parked is rejected (must go through idle)", () => {
    const s = new SessionHandle({ agentId: "a" });
    const ok = s.park();
    expect(ok).toBe(false);
    expect(s.status).toBe(STATUS.RUNNING);
  });

  it("closed is terminal", () => {
    const s = new SessionHandle({ agentId: "a", now: 1000 });
    s.close(2000);
    expect(s.status).toBe(STATUS.CLOSED);
    expect(s.touch(3000)).toBe(false);
    expect(s.idle()).toBe(false);
  });

  it("same-status transition is a no-op success", () => {
    const s = new SessionHandle({ agentId: "a" });
    expect(s.transition(STATUS.RUNNING)).toBe(true);
  });
});

describe("SessionHandle — accumulators", () => {
  it("getRuntimeMs includes current running segment", () => {
    const s = new SessionHandle({ agentId: "a", now: 1000 });
    expect(s.getRuntimeMs(5000)).toBe(4000);
  });

  it("getIdleMs includes current idle segment", () => {
    const s = new SessionHandle({ agentId: "a", now: 1000 });
    s.idle(2000);
    expect(s.getIdleMs(7000)).toBe(5000);
  });

  it("parked state does not accumulate runtimeMs or idleMs", () => {
    const s = new SessionHandle({ agentId: "a", now: 0 });
    s.idle(1000);
    s.park(2000);
    expect(s.getRuntimeMs(10000)).toBe(1000);
    expect(s.getIdleMs(10000)).toBe(1000);
  });

  it("shouldPark true when idle beyond threshold", () => {
    const s = new SessionHandle({ agentId: "a", now: 0 });
    s.idle(1000);
    expect(s.shouldPark(500, 2000)).toBe(true);
  });

  it("shouldPark false when not idle", () => {
    const s = new SessionHandle({ agentId: "a", now: 0 });
    expect(s.shouldPark(500, 10000)).toBe(false);
  });
});

describe("SessionHandle — serialization", () => {
  it("round-trips via toJSON/fromJSON", () => {
    const s = new SessionHandle({ agentId: "a", now: 1000 });
    s.idle(3000);
    s.touch(5000);
    const json = s.toJSON();
    const restored = SessionHandle.fromJSON(json);
    expect(restored.sessionId).toBe(s.sessionId);
    expect(restored.agentId).toBe(s.agentId);
    expect(restored.status).toBe(s.status);
    expect(restored.runtimeMs).toBe(s.runtimeMs);
    expect(restored.idleMs).toBe(s.idleMs);
  });

  it("toJSON captures metadata", () => {
    const s = new SessionHandle({
      agentId: "a",
      metadata: { userId: "u1", locale: "zh-CN" },
    });
    const json = s.toJSON();
    expect(json.metadata).toEqual({ userId: "u1", locale: "zh-CN" });
  });
});

describe("generateSessionId", () => {
  it("produces unique ids", () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) ids.add(generateSessionId());
    expect(ids.size).toBe(100);
  });

  it("matches sess_<hex16> format", () => {
    expect(generateSessionId()).toMatch(/^sess_[a-f0-9]{16}$/);
  });
});

describe("APPROVAL_POLICIES constant", () => {
  it("contains expected values", () => {
    expect(APPROVAL_POLICIES).toEqual(["strict", "trusted", "autopilot"]);
  });
});
