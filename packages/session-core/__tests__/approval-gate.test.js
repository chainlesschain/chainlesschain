import { describe, it, expect, vi } from "vitest";
import {
  ApprovalGate,
  POLICY,
  RISK,
  DECISION,
  baseDecision,
} from "../lib/approval-gate.js";

describe("ApprovalGate.setConfirmer", () => {
  it("injects a confirm callback after construction (no-confirmer → user-confirm)", async () => {
    const gate = new ApprovalGate({ defaultPolicy: POLICY.STRICT });
    expect(gate.hasConfirmer()).toBe(false);

    // Before: STRICT + MEDIUM risk with no confirmer → safe-default deny
    const before = await gate.decide({ riskLevel: RISK.MEDIUM });
    expect(before.decision).toBe(DECISION.DENY);
    expect(before.via).toBe("no-confirmer");

    gate.setConfirmer(async () => true);
    expect(gate.hasConfirmer()).toBe(true);

    const after = await gate.decide({ riskLevel: RISK.MEDIUM });
    expect(after.decision).toBe(DECISION.ALLOW);
    expect(after.via).toBe("user-confirm");
  });

  it("setConfirmer(null) clears the callback", async () => {
    const gate = new ApprovalGate({
      defaultPolicy: POLICY.STRICT,
      confirm: async () => true,
    });
    gate.setConfirmer(null);
    expect(gate.hasConfirmer()).toBe(false);
    const res = await gate.decide({ riskLevel: RISK.HIGH });
    expect(res.via).toBe("no-confirmer");
  });

  it("rejects non-function non-null inputs", () => {
    const gate = new ApprovalGate();
    expect(() => gate.setConfirmer("not-a-fn")).toThrow(/function or null/);
  });
});

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
    expect(() => new ApprovalGate({ defaultPolicy: "bogus" })).toThrow(
      /invalid/,
    );
  });
  it("defaults to strict", () => {
    const g = new ApprovalGate();
    expect(g.getSessionPolicy("any")).toBe(POLICY.STRICT);
  });
  it("rejects an invalid authorization consumer", () => {
    expect(() => new ApprovalGate({ consumeAuthorization: true })).toThrow(
      /function or null/,
    );
  });
});

describe("ApprovalGate durable authorization", () => {
  const context = { sessionId: "s1", riskLevel: RISK.HIGH };

  it("keeps legacy boolean confirmer approvals compatible", async () => {
    const g = new ApprovalGate({
      confirm: async () => true,
    });

    await expect(g.decide(context)).resolves.toMatchObject({
      decision: DECISION.ALLOW,
      via: "user-confirm",
    });
  });

  it("never treats a truthy object as a legacy approval", async () => {
    const g = new ApprovalGate({
      confirm: async () => ({ approved: true, via: "third-party" }),
    });

    await expect(g.decide(context)).resolves.toMatchObject({
      decision: DECISION.DENY,
      via: "authorization-missing",
    });
  });

  it("denies an explicit durable approval without an authorization", async () => {
    const g = new ApprovalGate({
      confirm: async () => ({
        approved: true,
        via: "remote",
        authorizationRequired: true,
      }),
    });

    await expect(g.decide(context)).resolves.toMatchObject({
      decision: DECISION.DENY,
      via: "authorization-missing",
    });
  });

  it("denies a structured approval missing authorization while a consumer is active", async () => {
    const g = new ApprovalGate({
      confirm: async () => ({ approved: true, via: "remote" }),
      consumeAuthorization: async () => true,
    });

    await expect(g.decide(context)).resolves.toMatchObject({
      decision: DECISION.DENY,
      via: "authorization-missing",
    });
  });

  it("denies a structured authorization when no consumer can be bound", async () => {
    const g = new ApprovalGate({
      confirm: async () => ({
        approved: true,
        via: "remote",
        authorization: Object.freeze({ kind: "opaque-test" }),
      }),
    });

    await expect(g.decide(context)).resolves.toMatchObject({
      decision: DECISION.DENY,
      via: "authorization-consumer-missing",
    });
  });

  it("preserves an opaque authorization and delegates its one-shot consume", async () => {
    const authorization = Object.freeze({ kind: "opaque-test" });
    const consumeAuthorization = vi.fn(async () => true);
    const g = new ApprovalGate({
      confirm: async () => ({
        approved: true,
        via: "remote",
        authorizationRequired: true,
        authorization,
      }),
      consumeAuthorization,
    });
    expect(g.hasAuthorizationConsumer()).toBe(true);

    const decision = await g.decide(context);
    expect(decision).toMatchObject({
      decision: DECISION.ALLOW,
      via: "remote",
      authorization: {
        kind: "chainlesschain.approval-gate.bound-authorization/v1",
      },
    });
    const dispatchContext = { tool: "run_shell", args: { command: "pwd" } };
    // Reconfiguring the singleton after decide cannot retarget or remove the
    // consumer already bound to this opaque authorization.
    g.setAuthorizationConsumer(null);
    await expect(
      g.consumeAuthorization(decision.authorization, dispatchContext),
    ).resolves.toBe(true);
    expect(consumeAuthorization).toHaveBeenCalledWith(
      authorization,
      dispatchContext,
    );
    expect(g.hasAuthorizationConsumer()).toBe(false);
  });

  it("keeps a deterministic failed consume retryable with the correct context", async () => {
    const authorization = Object.freeze({ kind: "opaque-test" });
    const consumeAuthorization = vi.fn(async (_authorization, ctx) => {
      if (ctx.action !== "high-risk") throw new Error("dispatch mismatch");
      return true;
    });
    const g = new ApprovalGate({
      confirm: async () => ({ approved: true, authorization }),
      consumeAuthorization,
    });
    const decision = await g.decide(context);

    await expect(
      g.consumeAuthorization(decision.authorization, { action: null }),
    ).rejects.toThrow(/mismatch/);
    await expect(
      g.consumeAuthorization(decision.authorization, { action: "high-risk" }),
    ).resolves.toBe(true);
    expect(consumeAuthorization).toHaveBeenCalledTimes(2);
    await expect(
      g.consumeAuthorization(decision.authorization, { action: "high-risk" }),
    ).rejects.toThrow(/replayed/);
  });

  it("isolates concurrent session-scoped confirmers and consumers", async () => {
    const gate = new ApprovalGate();
    const scopeA = gate.createSessionScope("session-a");
    const scopeB = gate.createSessionScope("session-b");
    const rawA = Object.freeze({ kind: "raw-a" });
    const rawB = Object.freeze({ kind: "raw-b" });
    let resolveA;
    let resolveB;
    const consumerA = vi.fn(async () => true);
    const consumerB = vi.fn(async () => true);
    scopeA.setAuthorizationConsumer(consumerA);
    scopeB.setAuthorizationConsumer(consumerB);
    scopeA.setConfirmer(
      () =>
        new Promise((resolve) => {
          resolveA = resolve;
        }),
    );
    scopeB.setConfirmer(
      () =>
        new Promise((resolve) => {
          resolveB = resolve;
        }),
    );

    const pendingA = scopeA.decide({ riskLevel: RISK.HIGH });
    const pendingB = scopeB.decide({ riskLevel: RISK.HIGH });
    resolveB({ approved: true, authorization: rawB, via: "remote-b" });
    resolveA({ approved: true, authorization: rawA, via: "remote-a" });
    const [decisionA, decisionB] = await Promise.all([pendingA, pendingB]);

    // Teardown/reconfiguration of either scope after decide cannot alter the
    // consumer captured by the other authorization.
    scopeA.setAuthorizationConsumer(null);
    scopeB.setAuthorizationConsumer(async () => {
      throw new Error("replacement must not run");
    });
    await expect(
      scopeA.consumeAuthorization(decisionA.authorization, { session: "a" }),
    ).resolves.toBe(true);
    await expect(
      scopeB.consumeAuthorization(decisionB.authorization, { session: "b" }),
    ).resolves.toBe(true);
    expect(consumerA).toHaveBeenCalledWith(rawA, { session: "a" });
    expect(consumerB).toHaveBeenCalledWith(rawB, { session: "b" });
  });

  it("creates a binder pinned to the current consumer generation", async () => {
    const gate = new ApprovalGate();
    const scope = gate.createSessionScope("session-a");
    const raw = Object.freeze({ kind: "raw-a" });
    const consumerA = vi.fn(async () => true);
    const consumerB = vi.fn(async () => {
      throw new Error("replacement must not run");
    });
    scope.setAuthorizationConsumer(consumerA);
    const bind = scope.createAuthorizationBinder();
    scope.setAuthorizationConsumer(consumerB);

    const authorization = bind(raw);
    await expect(
      scope.consumeAuthorization(authorization, { session: "a" }),
    ).resolves.toBe(true);
    expect(consumerA).toHaveBeenCalledWith(raw, { session: "a" });
    expect(consumerB).not.toHaveBeenCalled();
  });

  it("fails closed when consume is absent, negative, or throws", async () => {
    const authorization = Object.freeze({ kind: "opaque-test" });
    const noConsumer = new ApprovalGate();
    await expect(
      noConsumer.consumeAuthorization(authorization, {}),
    ).rejects.toThrow(/unavailable/);

    const negative = new ApprovalGate({
      consumeAuthorization: async () => false,
    });
    await expect(
      negative.consumeAuthorization(authorization, {}),
    ).rejects.toThrow(/not confirmed/);

    const unknown = new ApprovalGate({
      consumeAuthorization: async () => {
        throw new Error("unknown commit");
      },
    });
    await expect(
      unknown.consumeAuthorization(authorization, {}),
    ).rejects.toThrow(/unknown commit/);
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
