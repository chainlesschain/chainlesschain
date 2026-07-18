import { describe, it, expect, vi } from "vitest";
import {
  buildWsApprovalConfirmer,
  createWsApprovalGate,
} from "../../src/gateways/ws/ws-approval-gate.js";
import { verifyApprovalBinding } from "../../src/lib/agent-authority.js";
import { WebSocketInteractionAdapter } from "../../src/lib/interaction-adapter.js";

/**
 * P0 permission-gate-over-WS: the approval-binding PRODUCER. The consumer
 * (echo verification in the interaction adapter) was already wired; these
 * tests pin the producer half and the end-to-end producer→consumer loop.
 */

describe("buildWsApprovalConfirmer", () => {
  it("asks over the adapter with a verifiable binding and fail-closed default", async () => {
    const askConfirm = vi.fn(async () => true);
    const confirmer = buildWsApprovalConfirmer({
      interaction: { askConfirm },
      sessionId: "sess-1",
    });

    const ok = await confirmer({
      sessionId: "sess-1",
      tool: "run_shell",
      args: { command: "rm -rf build" },
      riskLevel: "high",
    });

    expect(ok).toBe(true);
    expect(askConfirm).toHaveBeenCalledTimes(1);
    const [question, opts] = askConfirm.mock.calls[0];
    expect(question).toContain("run_shell");
    expect(question).toContain("rm -rf build");
    expect(opts.default).toBe(false); // never approve by default
    expect(opts.approval).toMatchObject({
      tool: "run_shell",
      command: "rm -rf build",
      risk: "high",
    });
    // the binding is the real digest over this call's identity + args + policy
    expect(
      verifyApprovalBinding(opts.binding, {
        toolCallId: "sess-1:appr-1",
        args: { command: "rm -rf build" },
        policyDigest: "high",
      }),
    ).toBe(true);
    // and NOT valid for tampered arguments
    expect(
      verifyApprovalBinding(opts.binding, {
        toolCallId: "sess-1:appr-1",
        args: { command: "rm -rf /" },
        policyDigest: "high",
      }),
    ).toBe(false);
  });

  it("increments the approval id per request (no binding reuse)", async () => {
    const bindings = [];
    const askConfirm = vi.fn(async (_q, opts) => {
      bindings.push(opts.binding);
      return true;
    });
    const confirmer = buildWsApprovalConfirmer({
      interaction: { askConfirm },
      sessionId: "sess-1",
    });
    await confirmer({ tool: "run_shell", args: { command: "ls" } });
    await confirmer({ tool: "run_shell", args: { command: "ls" } });
    expect(bindings[0]).not.toBe(bindings[1]); // same args, distinct requests
  });

  it("fails closed when the transport throws (timeout / disconnect)", async () => {
    const confirmer = buildWsApprovalConfirmer({
      interaction: {
        askConfirm: async () => {
          throw new Error("Question timed out");
        },
      },
      sessionId: "sess-1",
    });
    expect(await confirmer({ tool: "run_shell" })).toBe(false);
  });

  it("returns false on a non-true answer", async () => {
    const confirmer = buildWsApprovalConfirmer({
      interaction: { askConfirm: async () => false },
      sessionId: "sess-1",
    });
    expect(await confirmer({ tool: "write_file" })).toBe(false);
  });
});

describe("createWsApprovalGate", () => {
  /** deps seams: real ApprovalGate class, fake policy singleton. */
  function makeDeps({ policy = "strict", confirmer } = {}) {
    const inner = {
      policies: new Map(),
      getSessionPolicy: vi.fn((sid) => inner.policies.get(sid) || policy),
      setSessionPolicy: vi.fn((sid, p) => inner.policies.set(sid, p)),
    };
    return {
      inner,
      deps: {
        loadSingletons: async () => ({ getApprovalGate: async () => inner }),
        loadSessionCore: () => import("@chainlesschain/session-core"),
        ...(confirmer ? { confirmer } : {}),
      },
    };
  }

  it("routes CONFIRM-tier decisions to the WS confirmer (policy from the singleton)", async () => {
    const confirmer = vi.fn(async () => true);
    const { deps } = makeDeps({ policy: "strict", confirmer });
    const gate = await createWsApprovalGate({
      sessionId: "sess-1",
      interaction: {},
      deps,
    });

    const res = await gate.decide({
      sessionId: "sess-1",
      riskLevel: "high",
      tool: "run_shell",
      args: { command: "rm x" },
    });

    expect(res.decision).toBe("allow");
    expect(res.via).toBe("user-confirm");
    expect(confirmer).toHaveBeenCalledTimes(1);
  });

  it("honors mid-session policy changes via the singleton (trusted → medium allows)", async () => {
    const confirmer = vi.fn(async () => true);
    const { inner, deps } = makeDeps({ policy: "strict", confirmer });
    const gate = await createWsApprovalGate({
      sessionId: "sess-1",
      interaction: {},
      deps,
    });

    inner.policies.set("sess-1", "trusted"); // sessions.policy.set over WS
    const res = await gate.decide({
      sessionId: "sess-1",
      riskLevel: "medium",
      tool: "run_shell",
      args: { command: "ls" },
    });

    expect(res.decision).toBe("allow");
    expect(res.via).toBe("policy"); // no confirm needed under trusted/medium
    expect(confirmer).not.toHaveBeenCalled();
  });

  it("denies fail-closed when the confirmer rejects", async () => {
    const { deps } = makeDeps({ confirmer: async () => false });
    const gate = await createWsApprovalGate({
      sessionId: "sess-1",
      interaction: {},
      deps,
    });
    const res = await gate.decide({ sessionId: "sess-1", riskLevel: "high" });
    expect(res.decision).toBe("deny");
    expect(res.via).toBe("user-deny");
  });

  it("returns null when wiring fails (degrade to legacy no-gate path)", async () => {
    const gate = await createWsApprovalGate({
      sessionId: "sess-1",
      interaction: {},
      deps: {
        loadSingletons: async () => {
          throw new Error("no singletons");
        },
      },
    });
    expect(gate).toBeNull();
  });

  it("end-to-end over the real adapter: request carries the binding, tampered echo denies", async () => {
    const ws = { readyState: 1, OPEN: 1, send: vi.fn() };
    const adapter = new WebSocketInteractionAdapter(ws, "sess-1");
    const { deps } = makeDeps(); // real confirmer built from the adapter
    const gate = await createWsApprovalGate({
      sessionId: "sess-1",
      interaction: adapter,
      deps,
    });

    const pending = gate.decide({
      sessionId: "sess-1",
      riskLevel: "high",
      tool: "run_shell",
      args: { command: "rm x" },
    });
    await vi.waitFor(() => {
      expect(ws.send).toHaveBeenCalled();
    });
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.questionType).toBe("confirm");
    expect(typeof sent.binding).toBe("string");
    expect(sent.binding.startsWith("ab_")).toBe(true);
    // the client approves but echoes a TAMPERED binding → forced deny
    adapter.resolveAnswer(sent.requestId, true, "ab_tampered");
    const res = await pending;
    expect(res.decision).toBe("deny");

    // and a faithful echo approves
    const pending2 = gate.decide({
      sessionId: "sess-1",
      riskLevel: "high",
      tool: "run_shell",
      args: { command: "rm x" },
    });
    await vi.waitFor(() => {
      expect(ws.send.mock.calls.length).toBeGreaterThan(1);
    });
    const sent2 = JSON.parse(ws.send.mock.calls[1][0]);
    adapter.resolveAnswer(sent2.requestId, true, sent2.binding);
    const res2 = await pending2;
    expect(res2.decision).toBe("allow");
    expect(res2.via).toBe("user-confirm");
  });
});
