/**
 * Unit tests for `multisig.* + marketplace.consume` WS handlers (#21 B.2).
 *
 * Uses the `runtimeFactory` injection seam to bypass dynamic-import of the
 * real CLI multisig runtime — tests pass fake { mgr, store, close } shapes
 * that mirror the real openMultisigManager() return so we can assert
 * argument forwarding + response shaping without touching SQLite.
 */

import { describe, it, expect, vi } from "vitest";
import {
  createMultisigHandlers,
  shapeProposalForList,
  shapeProposalDetail,
  MULTISIG_PURCHASE_DOMAIN,
} from "../handlers/multisig-handlers.js";

function makeFakeRuntime(impl) {
  const close = vi.fn();
  return {
    openMultisigManager: vi.fn(async () => ({
      db: {},
      store: impl.store || {},
      mgr: impl.mgr || {},
      close,
    })),
    _close: close,
  };
}

function withRuntimeFactory(impl) {
  const fake = makeFakeRuntime(impl);
  const handlers = createMultisigHandlers({
    runtimeFactory: async () => fake,
  });
  return { handlers, fake };
}

describe("shapeProposalForList", () => {
  it("maps store proposal fields to the list response shape", () => {
    expect(
      shapeProposalForList({
        id: "msp_abc",
        domain: "marketplace.purchase",
        state: "pending",
        thresholdM: 2,
        memberSet: [
          { did: "did:cc:a", alg: "Ed25519" },
          { did: "did:cc:b", alg: "Ed25519" },
          { did: "did:cc:c", alg: "Ed25519" },
        ],
        initiatorDid: "did:cc:a",
        createdAtMs: 1000,
        expiresAtMs: 2000,
      }),
    ).toEqual({
      id: "msp_abc",
      domain: "marketplace.purchase",
      state: "pending",
      m: 2,
      n: 3,
      initiatorDid: "did:cc:a",
      createdAtMs: 1000,
      expiresAtMs: 2000,
    });
  });

  it("returns n=null when memberSet is missing/not an array", () => {
    expect(shapeProposalForList({ memberSet: undefined }).n).toBeNull();
  });
});

describe("shapeProposalDetail", () => {
  it("hex-encodes payloadHash buffer and parses payloadJcs", () => {
    const result = shapeProposalDetail({
      proposal: {
        id: "msp_1",
        domain: "did.rotate",
        payloadHash: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
        payloadJcs: '{"a":1,"b":"x"}',
        otherField: "kept",
      },
      signatures: [
        {
          signerDid: "did:cc:a",
          alg: "Ed25519",
          signedAtMs: 100,
          sig: Buffer.alloc(64),
        },
      ],
    });
    expect(result.proposal.payloadHash).toBe("deadbeef");
    expect(result.proposal.payload).toEqual({ a: 1, b: "x" });
    expect(result.proposal.otherField).toBe("kept");
    expect(result.signatures).toEqual([
      {
        signerDid: "did:cc:a",
        alg: "Ed25519",
        signedAtMs: 100,
        sigBytes: 64,
      },
    ]);
  });

  it("returns payload=null when payloadJcs is unparseable", () => {
    const result = shapeProposalDetail({
      proposal: { payloadHash: "alreadyHex", payloadJcs: "not json {" },
      signatures: [],
    });
    expect(result.proposal.payload).toBeNull();
    // Non-Buffer payloadHash passes through unchanged
    expect(result.proposal.payloadHash).toBe("alreadyHex");
  });
});

describe("multisig.list handler", () => {
  it("forwards state / domain / limit and shapes results", async () => {
    const listProposals = vi.fn(() => [
      {
        id: "msp_1",
        domain: "marketplace.purchase",
        state: "pending",
        thresholdM: 2,
        memberSet: [{}, {}],
        initiatorDid: "did:cc:a",
        createdAtMs: 1,
        expiresAtMs: 2,
      },
    ]);
    const { handlers, fake } = withRuntimeFactory({
      store: { listProposals },
    });

    const result = await handlers["multisig.list"]({
      state: "pending",
      domain: "marketplace.purchase",
      limit: 10,
    });

    expect(listProposals).toHaveBeenCalledWith({
      state: "pending",
      domain: "marketplace.purchase",
      limit: 10,
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("msp_1");
    expect(fake._close).toHaveBeenCalledTimes(1);
  });

  it("defaults limit to 50 when omitted", async () => {
    const listProposals = vi.fn(() => []);
    const { handlers } = withRuntimeFactory({ store: { listProposals } });
    await handlers["multisig.list"]({});
    expect(listProposals).toHaveBeenCalledWith({
      state: undefined,
      domain: undefined,
      limit: 50,
    });
  });
});

describe("multisig.show handler", () => {
  it("returns shaped proposal detail when found", async () => {
    const mgr = {
      get: vi.fn(() => ({
        proposal: {
          id: "msp_1",
          payloadHash: Buffer.from([0xaa]),
          payloadJcs: '{"x":1}',
        },
        signatures: [
          {
            signerDid: "did:a",
            alg: "Ed25519",
            signedAtMs: 1,
            sig: Buffer.alloc(8),
          },
        ],
      })),
    };
    const { handlers, fake } = withRuntimeFactory({ mgr });
    const result = await handlers["multisig.show"]({ proposalId: "msp_1" });
    expect(mgr.get).toHaveBeenCalledWith("msp_1");
    expect(result.proposal.payloadHash).toBe("aa");
    expect(result.proposal.payload).toEqual({ x: 1 });
    expect(fake._close).toHaveBeenCalled();
  });

  it("throws INVALID_ARGS when proposalId missing", async () => {
    const { handlers } = withRuntimeFactory({});
    try {
      await handlers["multisig.show"]({});
      throw new Error("expected throw");
    } catch (e) {
      expect(e.code).toBe("INVALID_ARGS");
    }
  });

  it("throws PROPOSAL_NOT_FOUND when mgr.get returns null", async () => {
    const mgr = { get: vi.fn(() => null) };
    const { handlers, fake } = withRuntimeFactory({ mgr });
    try {
      await handlers["multisig.show"]({ proposalId: "nope" });
      throw new Error("expected throw");
    } catch (e) {
      expect(e.code).toBe("PROPOSAL_NOT_FOUND");
    }
    // close still runs in finally
    expect(fake._close).toHaveBeenCalled();
  });
});

describe("multisig.policy.show handler", () => {
  it("returns policy when found", async () => {
    const policy = {
      domain: "marketplace.purchase",
      m: 2,
      members: [{}, {}, {}],
    };
    const { handlers } = withRuntimeFactory({
      store: { getPolicy: vi.fn(() => policy) },
    });
    const result = await handlers["multisig.policy.show"]({
      domain: "marketplace.purchase",
    });
    expect(result).toEqual(policy);
  });

  it("throws POLICY_NOT_FOUND when policy missing", async () => {
    const { handlers } = withRuntimeFactory({
      store: { getPolicy: vi.fn(() => null) },
    });
    try {
      await handlers["multisig.policy.show"]({ domain: "x" });
      throw new Error("expected throw");
    } catch (e) {
      expect(e.code).toBe("POLICY_NOT_FOUND");
    }
  });

  it("throws INVALID_ARGS when domain missing", async () => {
    const { handlers } = withRuntimeFactory({});
    try {
      await handlers["multisig.policy.show"]({});
      throw new Error("expected throw");
    } catch (e) {
      expect(e.code).toBe("INVALID_ARGS");
    }
  });
});

describe("multisig.cancel / multisig.finalize handlers", () => {
  it("cancel forwards proposalId + reason and returns mgr.cancel result", async () => {
    const cancel = vi.fn(() => ({ ok: true }));
    const { handlers } = withRuntimeFactory({ mgr: { cancel } });
    const r = await handlers["multisig.cancel"]({
      proposalId: "msp_1",
      reason: "ui-test",
    });
    expect(cancel).toHaveBeenCalledWith("msp_1", "ui-test");
    expect(r).toEqual({ ok: true });
  });

  it("finalize forwards proposalId and returns mgr.finalize result", async () => {
    const finalize = vi.fn(() => ({ ok: true }));
    const { handlers } = withRuntimeFactory({ mgr: { finalize } });
    const r = await handlers["multisig.finalize"]({ proposalId: "msp_2" });
    expect(finalize).toHaveBeenCalledWith("msp_2");
    expect(r).toEqual({ ok: true });
  });

  it("both reject INVALID_ARGS when proposalId missing", async () => {
    const { handlers } = withRuntimeFactory({});
    await expect(handlers["multisig.cancel"]({})).rejects.toMatchObject({
      code: "INVALID_ARGS",
    });
    await expect(handlers["multisig.finalize"]({})).rejects.toMatchObject({
      code: "INVALID_ARGS",
    });
  });
});

describe("multisig.sweep handler", () => {
  it("returns { expired: count } from mgr.expireStale()", async () => {
    const { handlers } = withRuntimeFactory({
      mgr: { expireStale: vi.fn(() => 3) },
    });
    const r = await handlers["multisig.sweep"]({});
    expect(r).toEqual({ expired: 3 });
  });

  it("ignores any message body (sweep has no params)", async () => {
    const { handlers } = withRuntimeFactory({
      mgr: { expireStale: vi.fn(() => 0) },
    });
    expect(await handlers["multisig.sweep"]({ ignored: true })).toEqual({
      expired: 0,
    });
  });
});

describe("marketplace.consume handler", () => {
  function makeMgr({ proposal, state, finalizeOk = true }) {
    return {
      get: vi.fn(() =>
        proposal === null
          ? null
          : { proposal: { ...proposal, state }, signatures: [] },
      ),
      finalize: vi.fn(() => ({
        ok: finalizeOk,
        reason: finalizeOk ? null : "fail",
      })),
    };
  }

  it("succeeds when proposal is reached + correct domain", async () => {
    const order = { itemId: "sku-1", amountFen: 99900, buyer: "did:cc:b" };
    const mgr = makeMgr({
      proposal: {
        id: "msp_1",
        domain: MULTISIG_PURCHASE_DOMAIN,
        payloadJcs: JSON.stringify(order),
      },
      state: "reached",
    });
    const { handlers } = withRuntimeFactory({ mgr });

    const r = await handlers["marketplace.consume"]({ proposalId: "msp_1" });

    expect(r).toEqual({
      status: "consumed",
      proposalId: "msp_1",
      order,
    });
    expect(mgr.finalize).toHaveBeenCalledWith("msp_1");
  });

  it("returns error when proposal not found", async () => {
    const mgr = makeMgr({ proposal: null });
    const { handlers } = withRuntimeFactory({ mgr });
    const r = await handlers["marketplace.consume"]({ proposalId: "no" });
    expect(r).toEqual({ status: "error", reason: "proposal_not_found" });
    expect(mgr.finalize).not.toHaveBeenCalled();
  });

  it("returns error wrong_domain for non-marketplace proposals", async () => {
    const mgr = makeMgr({
      proposal: { domain: "did.rotate", payloadJcs: "{}" },
      state: "reached",
    });
    const { handlers } = withRuntimeFactory({ mgr });
    const r = await handlers["marketplace.consume"]({ proposalId: "msp_x" });
    expect(r).toMatchObject({
      status: "error",
      reason: "wrong_domain",
      expected: MULTISIG_PURCHASE_DOMAIN,
      actual: "did.rotate",
    });
    expect(mgr.finalize).not.toHaveBeenCalled();
  });

  it("returns proposal_state_X when not yet reached", async () => {
    const mgr = makeMgr({
      proposal: { domain: MULTISIG_PURCHASE_DOMAIN, payloadJcs: "{}" },
      state: "pending",
    });
    const { handlers } = withRuntimeFactory({ mgr });
    const r = await handlers["marketplace.consume"]({ proposalId: "msp_p" });
    expect(r).toEqual({ status: "error", reason: "proposal_state_pending" });
    expect(mgr.finalize).not.toHaveBeenCalled();
  });

  it("returns finalize error if finalize fails after all gates pass", async () => {
    const mgr = makeMgr({
      proposal: {
        domain: MULTISIG_PURCHASE_DOMAIN,
        payloadJcs: '{"itemId":"x"}',
      },
      state: "reached",
      finalizeOk: false,
    });
    const { handlers } = withRuntimeFactory({ mgr });
    const r = await handlers["marketplace.consume"]({ proposalId: "msp_f" });
    expect(r).toEqual({ status: "error", reason: "fail" });
  });

  it("rejects INVALID_ARGS when proposalId missing", async () => {
    const { handlers } = withRuntimeFactory({});
    await expect(handlers["marketplace.consume"]({})).rejects.toMatchObject({
      code: "INVALID_ARGS",
    });
  });
});
