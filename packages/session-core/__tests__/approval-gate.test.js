import { describe, it, expect, vi } from "vitest";
import {
  ApprovalGate,
  POLICY,
  RISK,
  DECISION,
  baseDecision,
} from "../lib/approval-gate.js";

describe("baseDecision", () => {
  it("LOW always allows regardless of policy", () => {
    expect(baseDecision(POLICY.STRICT, RISK.LOW)).toBe(DECISION.ALLOW);
    expect(baseDecision(POLICY.TRUSTED, RISK.LOW)).toBe(DECISION.ALLOW);
    expect(baseDecision(POLICY.AUTOPILOT, RISK.LOW)).toBe(DECISION.ALLOW);
  });
  it("AUTOPILOT allows any risk", () => {
    expect(baseDecision(POLICY.AUTOPILOT, RISK.MEDIUM)).toBe(DECISION.ALLOW);
    expect(baseDecision(POLICY.AUTOPILOT, RISK.HIGH)).toBe(DECISION.ALLOW);
  });
  it("TRUSTED confirms only HIGH", () => {
    expect(baseDecision(POLICY.TRUSTED, RISK.MEDIUM)).toBe(DECISION.ALLOW);
    expect(baseDecision(POLICY.TRUSTED, RISK.HIGH)).toBe(DECISION.CONFIRM);
  });
  it("STRICT confirms MEDIUM and HIGH", () => {
    expect(baseDecision(POLICY.STRICT, RISK.MEDIUM)).toBe(DECISION.CONFIRM);
    expect(baseDecision(POLICY.STRICT, RISK.HIGH)).toBe(DECISION.CONFIRM);
  });
  it("unknown risk treated as LOW", () => {
    expect(baseDecision(POLICY.STRICT, "weird")).toBe(DECISION.ALLOW);
  });
  it("rejects invalid policy", () => {
    expect(() => baseDecision("bogus", RISK.LOW)).toThrow(/invalid policy/);
  });
});

describe("ApprovalGate constructor", () => {
  it("rejects invalid defaultPolicy", () => {
    expect(() => new ApprovalGate({ defaultPolicy: "bogus" })).toThrow(/invalid/);
  });
  it("defaults to strict", () => {
    const g = new ApprovalGate();
    expect(g.getSessionPolicy("any")).toBe(POLICY.STRICT);
  });
});

describe("ApprovalGate session policy overrides", () => {
  it("setSessionPolicy overrides default", () => {
    const g = new ApprovalGate();
    g.setSessionPolicy("s1", POLICY.TRUSTED);
    expect(g.getSessionPolicy("s1")).toBe(POLICY.TRUSTED);
    expect(g.getSessionPolicy("s2")).toBe(POLICY.STRICT);
  });
  it("clearSessionPolicy falls back to default", () => {
    const g = new ApprovalGate({ defaultPolicy: POLICY.AUTOPILOT });
    g.setSessionPolicy("s1", POLICY.STRICT);
    g.clearSessionPolicy("s1");
    expect(g.getSessionPolicy("s1")).toBe(POLICY.AUTOPILOT);
  });
  it("rejects invalid policy", () => {
    const g = new ApprovalGate();
    expect(() => g.setSessionPolicy("s1", "bogus")).toThrow(/invalid/);
  });
  it("requires sessionId", () => {
    const g = new ApprovalGate();
    expect(() => g.setSessionPolicy("", POLICY.STRICT)).toThrow(/sessionId/);
  });
});

describe("ApprovalGate.decide", () => {
  it("LOW allows without calling confirm", async () => {
    const confirm = vi.fn();
    const g = new ApprovalGate({ confirm });
    const r = await g.decide({ sessionId: "s1", riskLevel: RISK.LOW });
    expect(r.decision).toBe(DECISION.ALLOW);
    expect(r.via).toBe("policy");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("AUTOPILOT allows HIGH without confirm", async () => {
    const confirm = vi.fn();
    const g = new ApprovalGate({ confirm });
    g.setSessionPolicy("s1", POLICY.AUTOPILOT);
    const r = await g.decide({ sessionId: "s1", riskLevel: RISK.HIGH });
    expect(r.decision).toBe(DECISION.ALLOW);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("STRICT MEDIUM calls confirm, allows when user confirms", async () => {
    const confirm = vi.fn(async () => true);
    const g = new ApprovalGate({ confirm });
    const r = await g.decide({ sessionId: "s1", riskLevel: RISK.MEDIUM });
    expect(confirm).toHaveBeenCalledOnce();
    expect(r.decision).toBe(DECISION.ALLOW);
    expect(r.via).toBe("user-confirm");
  });

  it("denies when user declines", async () => {
    const confirm = vi.fn(async () => false);
    const g = new ApprovalGate({ confirm });
    const r = await g.decide({ sessionId: "s1", riskLevel: RISK.HIGH });
    expect(r.decision).toBe(DECISION.DENY);
    expect(r.via).toBe("user-deny");
  });

  it("denies via no-confirmer when confirm is missing", async () => {
    const g = new ApprovalGate();
    const r = await g.decide({ sessionId: "s1", riskLevel: RISK.HIGH });
    expect(r.decision).toBe(DECISION.DENY);
    expect(r.via).toBe("no-confirmer");
  });

  it("denies via confirm-error when confirm throws", async () => {
    const confirm = vi.fn(async () => {
      throw new Error("io");
    });
    const g = new ApprovalGate({ confirm });
    const r = await g.decide({ sessionId: "s1", riskLevel: RISK.HIGH });
    expect(r.decision).toBe(DECISION.DENY);
    expect(r.via).toBe("confirm-error");
    expect(r.error).toBeInstanceOf(Error);
  });

  it("explicit ctx.policy overrides session policy", async () => {
    const confirm = vi.fn(async () => true);
    const g = new ApprovalGate({ confirm });
    g.setSessionPolicy("s1", POLICY.AUTOPILOT);
    const r = await g.decide({
      sessionId: "s1",
      riskLevel: RISK.HIGH,
      policy: POLICY.STRICT,
    });
    expect(confirm).toHaveBeenCalled();
    expect(r.policy).toBe(POLICY.STRICT);
  });

  it("onDecision hook fires for every decision", async () => {
    const onDecision = vi.fn();
    const g = new ApprovalGate({ onDecision });
    await g.decide({ sessionId: "s1", riskLevel: RISK.LOW });
    expect(onDecision).toHaveBeenCalledOnce();
    expect(onDecision.mock.calls[0][1].decision).toBe(DECISION.ALLOW);
  });

  it("TRUSTED MEDIUM allows without confirm", async () => {
    const confirm = vi.fn();
    const g = new ApprovalGate({ confirm, defaultPolicy: POLICY.TRUSTED });
    const r = await g.decide({ sessionId: "s1", riskLevel: RISK.MEDIUM });
    expect(r.decision).toBe(DECISION.ALLOW);
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("ApprovalGate store persistence", () => {
  const makeMemStore = () => {
    let snapshot = {};
    return {
      saves: 0,
      async load() {
        return snapshot;
      },
      async save(policies) {
        this.saves++;
        snapshot = { ...policies };
      },
      _read: () => snapshot,
    };
  };

  it("load() hydrates from store (object form)", async () => {
    const store = makeMemStore();
    await store.save({ s1: POLICY.TRUSTED, s2: POLICY.AUTOPILOT });
    const g = new ApprovalGate({ store });
    await g.load();
    expect(g.getSessionPolicy("s1")).toBe(POLICY.TRUSTED);
    expect(g.getSessionPolicy("s2")).toBe(POLICY.AUTOPILOT);
  });

  it("load() accepts array-of-entries form", async () => {
    const store = {
      async load() {
        return [
          ["s1", POLICY.TRUSTED],
          ["bad", "nope"],
        ];
      },
      async save() {},
    };
    const g = new ApprovalGate({ store });
    await g.load();
    expect(g.getSessionPolicy("s1")).toBe(POLICY.TRUSTED);
    expect(g.getSessionPolicy("bad")).toBe(POLICY.STRICT); // invalid filtered
  });

  it("setSessionPolicy triggers async persist", async () => {
    const store = makeMemStore();
    const g = new ApprovalGate({ store });
    g.setSessionPolicy("s1", POLICY.TRUSTED);
    await new Promise((r) => setImmediate(r));
    expect(store.saves).toBe(1);
    expect(store._read()).toEqual({ s1: POLICY.TRUSTED });
  });

  it("setSessionPolicy skips persist when policy unchanged", async () => {
    const store = makeMemStore();
    const g = new ApprovalGate({ store });
    g.setSessionPolicy("s1", POLICY.TRUSTED);
    await new Promise((r) => setImmediate(r));
    g.setSessionPolicy("s1", POLICY.TRUSTED);
    await new Promise((r) => setImmediate(r));
    expect(store.saves).toBe(1);
  });

  it("clearSessionPolicy persists the removal", async () => {
    const store = makeMemStore();
    const g = new ApprovalGate({ store });
    g.setSessionPolicy("s1", POLICY.TRUSTED);
    await new Promise((r) => setImmediate(r));
    g.clearSessionPolicy("s1");
    await new Promise((r) => setImmediate(r));
    expect(store._read()).toEqual({});
  });

  it("swallows store.save errors", async () => {
    const store = {
      async load() {
        return {};
      },
      async save() {
        throw new Error("disk full");
      },
    };
    const g = new ApprovalGate({ store });
    expect(() => g.setSessionPolicy("s1", POLICY.TRUSTED)).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });
});
