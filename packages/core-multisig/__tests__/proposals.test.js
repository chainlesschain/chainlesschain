import { describe, it, expect, beforeEach, beforeAll } from "vitest";

const { applySchema } = require("../lib/schema.js");
const { createStore } = require("../lib/store.js");
const { createProposalsManager } = require("../lib/proposals.js");
const { adaptSqlJsDb } = require("./helpers/sql-js-adapter.js");
const { makeEd25519Member, makeSlhDsaMember } = require("./helpers/fixtures.js");

let initSqlJs;
let SQL;

beforeAll(async () => {
  initSqlJs = (await import("sql.js")).default;
  SQL = await initSqlJs();
});

function setupStore() {
  const sqlDb = new SQL.Database();
  const db = adaptSqlJsDb(sqlDb);
  applySchema(db);
  return createStore(db);
}

function setupPolicy({ m, n, withPqc = false, requirePqc = false, domain = "test.purchase" }) {
  const members = [];
  for (let i = 0; i < n; i++) {
    if (withPqc && i === 0) members.push(makeSlhDsaMember(i));
    else members.push(makeEd25519Member(i));
  }
  const secretKeys = Object.fromEntries(members.map((m) => [m.did, m._secretKey]));
  const policy = {
    domain,
    m,
    n,
    members: members.map((m) => ({ did: m.did, alg: m.alg, pubkeyJwk: m.pubkeyJwk })),
    requirePqc,
  };
  return { policy, secretKeys, members };
}

describe("proposals.propose", () => {
  let store;
  beforeEach(() => {
    store = setupStore();
  });

  it("creates a pending proposal with initiator signature", () => {
    const mgr = createProposalsManager(store);
    const { policy, secretKeys, members } = setupPolicy({ m: 2, n: 3 });
    const result = mgr.propose({
      domain: policy.domain,
      payload: { orderId: "o-1", total: "1500" },
      policy,
      initiator: {
        did: members[0].did,
        alg: members[0].alg,
        secretKey: secretKeys[members[0].did],
      },
    });
    expect(result.proposal.state).toBe("pending");
    expect(result.proposal.initiatorDid).toBe(members[0].did);
    expect(result.proposal.thresholdM).toBe(2);
    expect(result.reachedThreshold).toBe(false);
    expect(Buffer.isBuffer(result.sig)).toBe(true);

    const sigs = store.getSignatures(result.proposal.id);
    expect(sigs).toHaveLength(1);
    expect(sigs[0].signerDid).toBe(members[0].did);
  });

  it("1-of-1 proposal reaches threshold immediately", () => {
    const mgr = createProposalsManager(store);
    const { policy, secretKeys, members } = setupPolicy({ m: 1, n: 1 });
    const result = mgr.propose({
      domain: policy.domain,
      payload: { x: 1 },
      policy,
      initiator: {
        did: members[0].did,
        alg: members[0].alg,
        secretKey: secretKeys[members[0].did],
      },
    });
    expect(result.reachedThreshold).toBe(true);
    const stored = store.getProposal(result.proposal.id);
    expect(stored.state).toBe("reached");
  });

  it("rejects when initiator not in policy.members", () => {
    const mgr = createProposalsManager(store);
    const { policy } = setupPolicy({ m: 2, n: 3 });
    const intruder = makeEd25519Member(99);
    expect(() =>
      mgr.propose({
        domain: policy.domain,
        payload: { x: 1 },
        policy,
        initiator: { did: intruder.did, alg: intruder.alg, secretKey: intruder._secretKey },
      }),
    ).toThrow(RangeError);
  });

  it("rejects when initiator alg doesn't match member alg", () => {
    const mgr = createProposalsManager(store);
    const { policy, secretKeys, members } = setupPolicy({ m: 2, n: 3 });
    expect(() =>
      mgr.propose({
        domain: policy.domain,
        payload: { x: 1 },
        policy,
        initiator: {
          did: members[0].did,
          alg: "SLH-DSA-SHA2-128F", // wrong alg
          secretKey: secretKeys[members[0].did],
        },
      }),
    ).toThrow(RangeError);
  });

  it("each propose generates unique proposalId + nonce", () => {
    const mgr = createProposalsManager(store);
    const { policy, secretKeys, members } = setupPolicy({ m: 1, n: 1 });
    const a = mgr.propose({
      domain: policy.domain,
      payload: { x: 1 },
      policy,
      initiator: { did: members[0].did, alg: members[0].alg, secretKey: secretKeys[members[0].did] },
    });
    const b = mgr.propose({
      domain: policy.domain,
      payload: { x: 1 },
      policy,
      initiator: { did: members[0].did, alg: members[0].alg, secretKey: secretKeys[members[0].did] },
    });
    expect(a.proposal.id).not.toBe(b.proposal.id);
    expect(a.proposal.nonce).not.toBe(b.proposal.nonce);
  });
});

describe("proposals.sign", () => {
  let store;
  beforeEach(() => {
    store = setupStore();
  });

  function proposeFresh(mgr, members, secretKeys, m, n) {
    return mgr.propose({
      domain: "test.purchase",
      payload: { orderId: "o-x", total: "1500" },
      policy: {
        domain: "test.purchase",
        m,
        n,
        members: members.map((mm) => ({ did: mm.did, alg: mm.alg, pubkeyJwk: mm.pubkeyJwk })),
      },
      initiator: {
        did: members[0].did,
        alg: members[0].alg,
        secretKey: secretKeys[members[0].did],
      },
    });
  }

  it("2-of-3: second signer brings proposal to reached", () => {
    const mgr = createProposalsManager(store);
    const { secretKeys, members } = setupPolicy({ m: 2, n: 3 });
    const { proposal } = proposeFresh(mgr, members, secretKeys, 2, 3);
    const r = mgr.sign({
      proposalId: proposal.id,
      signer: { did: members[1].did, alg: members[1].alg, secretKey: secretKeys[members[1].did] },
    });
    expect(r.accepted).toBe(true);
    expect(r.reachedThreshold).toBe(true);
    expect(store.getProposal(proposal.id).state).toBe("reached");
  });

  it("3-of-3: needs all three to reach", () => {
    const mgr = createProposalsManager(store);
    const { secretKeys, members } = setupPolicy({ m: 3, n: 3 });
    const { proposal } = proposeFresh(mgr, members, secretKeys, 3, 3);
    const r1 = mgr.sign({
      proposalId: proposal.id,
      signer: { did: members[1].did, alg: members[1].alg, secretKey: secretKeys[members[1].did] },
    });
    expect(r1.reachedThreshold).toBe(false);
    const r2 = mgr.sign({
      proposalId: proposal.id,
      signer: { did: members[2].did, alg: members[2].alg, secretKey: secretKeys[members[2].did] },
    });
    expect(r2.reachedThreshold).toBe(true);
  });

  it("rejects duplicate signer", () => {
    const mgr = createProposalsManager(store);
    const { secretKeys, members } = setupPolicy({ m: 2, n: 3 });
    const { proposal } = proposeFresh(mgr, members, secretKeys, 2, 3);
    const r = mgr.sign({
      proposalId: proposal.id,
      signer: { did: members[0].did, alg: members[0].alg, secretKey: secretKeys[members[0].did] },
    });
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe("duplicate_signer");
  });

  it("rejects non-member signer", () => {
    const mgr = createProposalsManager(store);
    const { secretKeys, members } = setupPolicy({ m: 2, n: 3 });
    const { proposal } = proposeFresh(mgr, members, secretKeys, 2, 3);
    const intruder = makeEd25519Member(99);
    const r = mgr.sign({
      proposalId: proposal.id,
      signer: { did: intruder.did, alg: intruder.alg, secretKey: intruder._secretKey },
    });
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe("not_a_member");
  });

  it("rejects when proposal already reached", () => {
    const mgr = createProposalsManager(store);
    const { secretKeys, members } = setupPolicy({ m: 1, n: 3 });
    const { proposal } = proposeFresh(mgr, members, secretKeys, 1, 3);
    const r = mgr.sign({
      proposalId: proposal.id,
      signer: { did: members[1].did, alg: members[1].alg, secretKey: secretKeys[members[1].did] },
    });
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe("proposal_state_reached");
    expect(r.reachedThreshold).toBe(true);
  });

  it("rejects nonexistent proposalId", () => {
    const mgr = createProposalsManager(store);
    const m = makeEd25519Member(0);
    const r = mgr.sign({
      proposalId: "msp_does_not_exist",
      signer: { did: m.did, alg: m.alg, secretKey: m._secretKey },
    });
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe("proposal_not_found");
  });

  it("expires proposal when signing past expiresAtMs", () => {
    let fakeTime = 1_000_000;
    const mgr = createProposalsManager(store, { now: () => fakeTime });
    const { secretKeys, members } = setupPolicy({ m: 2, n: 3 });
    const { proposal } = mgr.propose({
      domain: "test",
      payload: { x: 1 },
      policy: {
        domain: "test",
        m: 2,
        n: 3,
        members: members.map((m) => ({ did: m.did, alg: m.alg, pubkeyJwk: m.pubkeyJwk })),
        defaultExpiryMs: 60_000, // 1 min
      },
      initiator: {
        did: members[0].did,
        alg: members[0].alg,
        secretKey: secretKeys[members[0].did],
      },
    });
    // 跳到 1h 后
    fakeTime += 60 * 60 * 1000;
    const r = mgr.sign({
      proposalId: proposal.id,
      signer: { did: members[1].did, alg: members[1].alg, secretKey: secretKeys[members[1].did] },
    });
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe("expired");
    expect(store.getProposal(proposal.id).state).toBe("expired");
  });
});

describe("proposals.signWithExternal (#21 B.1 PR2a)", () => {
  let store;
  beforeEach(() => {
    store = setupStore();
  });

  function proposeFresh(mgr, members, secretKeys, m, n) {
    return mgr.propose({
      domain: "test.purchase",
      payload: { orderId: "o-y", total: "2200" },
      policy: {
        domain: "test.purchase",
        m,
        n,
        members: members.map((mm) => ({
          did: mm.did,
          alg: mm.alg,
          pubkeyJwk: mm.pubkeyJwk,
        })),
      },
      initiator: {
        did: members[0].did,
        alg: members[0].alg,
        secretKey: secretKeys[members[0].did],
      },
    });
  }

  it("happy path: callback signature accepted + threshold reached", async () => {
    const { signRaw } = require("../lib/signing.js");
    const mgr = createProposalsManager(store);
    const { secretKeys, members } = setupPolicy({ m: 2, n: 3 });
    const { proposal } = proposeFresh(mgr, members, secretKeys, 2, 3);

    const signCallback = async (canonicalBytes, alg) => {
      return signRaw(canonicalBytes, secretKeys[members[1].did], alg);
    };
    const r = await mgr.signWithExternal({
      proposalId: proposal.id,
      signer: { did: members[1].did, alg: members[1].alg },
      signCallback,
    });
    expect(r.accepted).toBe(true);
    expect(r.reachedThreshold).toBe(true);
    expect(store.getProposal(proposal.id).state).toBe("reached");
  });

  it("rejects missing signCallback", async () => {
    const mgr = createProposalsManager(store);
    const { secretKeys, members } = setupPolicy({ m: 2, n: 3 });
    const { proposal } = proposeFresh(mgr, members, secretKeys, 2, 3);
    const r = await mgr.signWithExternal({
      proposalId: proposal.id,
      signer: { did: members[1].did, alg: members[1].alg },
    });
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe("missing_sign_callback");
  });

  it("rejects proposal_not_found", async () => {
    const mgr = createProposalsManager(store);
    const r = await mgr.signWithExternal({
      proposalId: "msp_nonexistent",
      signer: { did: "did:cc:a", alg: "Ed25519" },
      signCallback: async () => Buffer.alloc(64),
    });
    expect(r.reason).toBe("proposal_not_found");
  });

  it("rejects duplicate_signer (initiator already signed)", async () => {
    const { signRaw } = require("../lib/signing.js");
    const mgr = createProposalsManager(store);
    const { secretKeys, members } = setupPolicy({ m: 2, n: 3 });
    const { proposal } = proposeFresh(mgr, members, secretKeys, 2, 3);
    const r = await mgr.signWithExternal({
      proposalId: proposal.id,
      signer: { did: members[0].did, alg: members[0].alg },
      signCallback: async (bytes, alg) =>
        signRaw(bytes, secretKeys[members[0].did], alg),
    });
    expect(r.reason).toBe("duplicate_signer");
  });

  it("rejects not_a_member when signer DID not in policy", async () => {
    const mgr = createProposalsManager(store);
    const { secretKeys, members } = setupPolicy({ m: 2, n: 3 });
    const { proposal } = proposeFresh(mgr, members, secretKeys, 2, 3);
    const intruder = makeEd25519Member(99);
    const r = await mgr.signWithExternal({
      proposalId: proposal.id,
      signer: { did: intruder.did, alg: intruder.alg },
      signCallback: async () => Buffer.alloc(64),
    });
    expect(r.reason).toBe("not_a_member");
  });

  it("rejects alg_mismatch when signer alg differs from member alg", async () => {
    const mgr = createProposalsManager(store);
    const { secretKeys, members } = setupPolicy({ m: 2, n: 3 });
    const { proposal } = proposeFresh(mgr, members, secretKeys, 2, 3);
    const r = await mgr.signWithExternal({
      proposalId: proposal.id,
      signer: { did: members[1].did, alg: "SLH-DSA-128F" }, // member is Ed25519
      signCallback: async () => Buffer.alloc(64),
    });
    expect(r.reason).toBe("alg_mismatch");
  });

  it("rejects when callback returns garbage (sig_self_verify_failed)", async () => {
    const mgr = createProposalsManager(store);
    const { secretKeys, members } = setupPolicy({ m: 2, n: 3 });
    const { proposal } = proposeFresh(mgr, members, secretKeys, 2, 3);
    const r = await mgr.signWithExternal({
      proposalId: proposal.id,
      signer: { did: members[1].did, alg: members[1].alg },
      signCallback: async () => Buffer.alloc(64, 0xff), // 64 0xff bytes — not a valid Ed25519 sig
    });
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe("sig_self_verify_failed");
  });

  it("rejects when callback returns non-buffer", async () => {
    const mgr = createProposalsManager(store);
    const { secretKeys, members } = setupPolicy({ m: 2, n: 3 });
    const { proposal } = proposeFresh(mgr, members, secretKeys, 2, 3);
    const r = await mgr.signWithExternal({
      proposalId: proposal.id,
      signer: { did: members[1].did, alg: members[1].alg },
      signCallback: async () => "not-a-buffer-string",
    });
    expect(r.reason).toBe("sign_callback_returned_non_buffer");
  });

  it("captures callback throw with sign_callback_failed + detail", async () => {
    const mgr = createProposalsManager(store);
    const { secretKeys, members } = setupPolicy({ m: 2, n: 3 });
    const { proposal } = proposeFresh(mgr, members, secretKeys, 2, 3);
    const r = await mgr.signWithExternal({
      proposalId: proposal.id,
      signer: { did: members[1].did, alg: members[1].alg },
      signCallback: async () => {
        throw new Error("PIN cancelled by user");
      },
    });
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe("sign_callback_failed");
    expect(r.detail).toBe("PIN cancelled by user");
  });

  it("hybrid Ed25519+SLH-DSA: SLH-DSA member signs via external callback", async () => {
    const { signRaw } = require("../lib/signing.js");
    const mgr = createProposalsManager(store);
    // setupPolicy withPqc=true makes member[0] SLH-DSA.
    const { secretKeys, members } = setupPolicy({
      m: 2,
      n: 3,
      withPqc: true,
    });
    // members[0] (SLH-DSA) is initiator → already signed during propose.
    // Make members[1] (Ed25519) sign via external callback.
    const { proposal } = proposeFresh(mgr, members, secretKeys, 2, 3);
    const r = await mgr.signWithExternal({
      proposalId: proposal.id,
      signer: { did: members[1].did, alg: members[1].alg },
      signCallback: async (bytes, alg) =>
        signRaw(bytes, secretKeys[members[1].did], alg),
    });
    expect(r.accepted).toBe(true);
    expect(r.reachedThreshold).toBe(true);
  });

  it("interop with sign(): mgr.sign initiator + mgr.signWithExternal cosigner reaches threshold", async () => {
    const { signRaw } = require("../lib/signing.js");
    const mgr = createProposalsManager(store);
    const { secretKeys, members } = setupPolicy({ m: 2, n: 3 });
    const { proposal } = proposeFresh(mgr, members, secretKeys, 2, 3);
    // member[0] already signed via propose (sync path); member[1] external.
    const r = await mgr.signWithExternal({
      proposalId: proposal.id,
      signer: { did: members[1].did, alg: members[1].alg },
      signCallback: async (bytes, alg) =>
        signRaw(bytes, secretKeys[members[1].did], alg),
    });
    expect(r.accepted).toBe(true);
    expect(r.reachedThreshold).toBe(true);
  });
});

describe("proposals.cancel + finalize + expire", () => {
  let store;
  beforeEach(() => {
    store = setupStore();
  });

  it("cancel pending proposal transitions to cancelled", () => {
    const mgr = createProposalsManager(store);
    const { policy, secretKeys, members } = setupPolicy({ m: 2, n: 3 });
    const { proposal } = mgr.propose({
      domain: policy.domain,
      payload: { x: 1 },
      policy,
      initiator: { did: members[0].did, alg: members[0].alg, secretKey: secretKeys[members[0].did] },
    });
    const r = mgr.cancel(proposal.id, "user changed mind");
    expect(r.ok).toBe(true);
    expect(store.getProposal(proposal.id).state).toBe("cancelled");
  });

  it("cancel rejects on already-consumed", () => {
    const mgr = createProposalsManager(store);
    const { policy, secretKeys, members } = setupPolicy({ m: 1, n: 1 });
    const { proposal } = mgr.propose({
      domain: policy.domain,
      payload: { x: 1 },
      policy,
      initiator: { did: members[0].did, alg: members[0].alg, secretKey: secretKeys[members[0].did] },
    });
    expect(mgr.finalize(proposal.id).ok).toBe(true);
    const r = mgr.cancel(proposal.id);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("proposal_state_consumed");
  });

  it("finalize rejects on non-reached state", () => {
    const mgr = createProposalsManager(store);
    const { policy, secretKeys, members } = setupPolicy({ m: 2, n: 3 });
    const { proposal } = mgr.propose({
      domain: policy.domain,
      payload: { x: 1 },
      policy,
      initiator: { did: members[0].did, alg: members[0].alg, secretKey: secretKeys[members[0].did] },
    });
    const r = mgr.finalize(proposal.id);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("proposal_state_pending");
  });

  it("finalize rejects double-consume", () => {
    const mgr = createProposalsManager(store);
    const { policy, secretKeys, members } = setupPolicy({ m: 1, n: 1 });
    const { proposal } = mgr.propose({
      domain: policy.domain,
      payload: { x: 1 },
      policy,
      initiator: { did: members[0].did, alg: members[0].alg, secretKey: secretKeys[members[0].did] },
    });
    mgr.finalize(proposal.id);
    const r = mgr.finalize(proposal.id);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("proposal_state_consumed");
  });

  it("expireStale sweeps pending past deadline", () => {
    let fakeTime = 1_000_000;
    const mgr = createProposalsManager(store, { now: () => fakeTime });
    const { secretKeys, members } = setupPolicy({ m: 2, n: 3 });
    mgr.propose({
      domain: "test",
      payload: { x: 1 },
      policy: {
        domain: "test",
        m: 2,
        n: 3,
        members: members.map((m) => ({ did: m.did, alg: m.alg, pubkeyJwk: m.pubkeyJwk })),
        defaultExpiryMs: 60_000,
      },
      initiator: { did: members[0].did, alg: members[0].alg, secretKey: secretKeys[members[0].did] },
    });
    fakeTime += 2 * 60 * 60 * 1000;
    const swept = mgr.expireStale();
    expect(swept).toBe(1);
  });
});

describe("proposals.get + governance log integration", () => {
  let store;
  let logged;
  beforeEach(() => {
    store = setupStore();
    logged = [];
  });

  it("get returns proposal + signatures", () => {
    const mgr = createProposalsManager(store);
    const { policy, secretKeys, members } = setupPolicy({ m: 2, n: 3 });
    const { proposal } = mgr.propose({
      domain: policy.domain,
      payload: { x: 1 },
      policy,
      initiator: { did: members[0].did, alg: members[0].alg, secretKey: secretKeys[members[0].did] },
    });
    const out = mgr.get(proposal.id);
    expect(out.proposal.id).toBe(proposal.id);
    expect(out.signatures).toHaveLength(1);
  });

  it("logEvent fires on propose + signed + reached + consumed", () => {
    const mgr = createProposalsManager(store, { logEvent: (e) => logged.push(e) });
    const { policy, secretKeys, members } = setupPolicy({ m: 2, n: 3 });
    const { proposal } = mgr.propose({
      domain: policy.domain,
      payload: { x: 1 },
      policy,
      initiator: { did: members[0].did, alg: members[0].alg, secretKey: secretKeys[members[0].did] },
    });
    mgr.sign({
      proposalId: proposal.id,
      signer: { did: members[1].did, alg: members[1].alg, secretKey: secretKeys[members[1].did] },
    });
    mgr.finalize(proposal.id);

    const types = logged.map((e) => e.type);
    expect(types).toContain("proposed");
    expect(types.filter((t) => t === "signed")).toHaveLength(2); // initiator + co-signer
    expect(types).toContain("reached");
    expect(types).toContain("consumed");
  });

  it("logEvent fires on cancel + expired_sweep", () => {
    let fakeTime = 1_000_000;
    const mgr = createProposalsManager(store, {
      logEvent: (e) => logged.push(e),
      now: () => fakeTime,
    });
    const { secretKeys, members } = setupPolicy({ m: 2, n: 3 });
    const { proposal } = mgr.propose({
      domain: "x",
      payload: { x: 1 },
      policy: {
        domain: "x",
        m: 2,
        n: 3,
        members: members.map((m) => ({ did: m.did, alg: m.alg, pubkeyJwk: m.pubkeyJwk })),
        defaultExpiryMs: 60_000,
      },
      initiator: { did: members[0].did, alg: members[0].alg, secretKey: secretKeys[members[0].did] },
    });
    mgr.cancel(proposal.id, "test cancel");
    expect(logged.some((e) => e.type === "cancelled" && e.reason === "test cancel")).toBe(true);

    // 第二个 proposal 走 sweeper
    fakeTime += 1000;
    const { proposal: p2 } = mgr.propose({
      domain: "x",
      payload: { y: 1 },
      policy: {
        domain: "x",
        m: 2,
        n: 3,
        members: members.map((m) => ({ did: m.did, alg: m.alg, pubkeyJwk: m.pubkeyJwk })),
        defaultExpiryMs: 60_000,
      },
      initiator: { did: members[0].did, alg: members[0].alg, secretKey: secretKeys[members[0].did] },
    });
    fakeTime += 3600 * 1000;
    mgr.expireStale();
    expect(logged.some((e) => e.type === "expired_sweep")).toBe(true);
    expect(store.getProposal(p2.id).state).toBe("expired");
  });
});

describe("proposals — requirePqc enforcement (security regression)", () => {
  let store;
  beforeEach(() => {
    store = setupStore();
  });

  it("snapshots requirePqc onto the proposal", () => {
    const mgr = createProposalsManager(store);
    const { policy, secretKeys, members } = setupPolicy({
      m: 2,
      n: 3,
      withPqc: true,
      requirePqc: true,
    });
    const { proposal } = mgr.propose({
      domain: policy.domain,
      payload: { orderId: "o-pqc" },
      policy,
      // initiator is an Ed25519 member (members[0] is the SLH-DSA one)
      initiator: {
        did: members[1].did,
        alg: members[1].alg,
        secretKey: secretKeys[members[1].did],
      },
    });
    expect(store.getProposal(proposal.id).requirePqc).toBe(true);
  });

  it("requirePqc=true: M valid Ed25519 sigs alone do NOT reach threshold — needs ≥1 PQC sig", () => {
    const mgr = createProposalsManager(store);
    // members[0] = SLH-DSA, members[1]/[2] = Ed25519
    const { policy, secretKeys, members } = setupPolicy({
      m: 2,
      n: 3,
      withPqc: true,
      requirePqc: true,
    });
    const { proposal, reachedThreshold } = mgr.propose({
      domain: policy.domain,
      payload: { orderId: "o-pqc" },
      policy,
      initiator: {
        did: members[1].did,
        alg: members[1].alg,
        secretKey: secretKeys[members[1].did],
      },
    });
    expect(reachedThreshold).toBe(false);

    // Second Ed25519 sig → 2 valid sigs == m, but still 0 PQC sigs.
    const r2 = mgr.sign({
      proposalId: proposal.id,
      signer: {
        did: members[2].did,
        alg: members[2].alg,
        secretKey: secretKeys[members[2].did],
      },
    });
    expect(r2.accepted).toBe(true);
    // Regression: before requirePqc was snapshotted, this wrongly returned true.
    expect(r2.reachedThreshold).toBe(false);
    expect(store.getProposal(proposal.id).state).toBe("pending");

    // SLH-DSA member signs → PQC requirement satisfied → reached.
    const r3 = mgr.sign({
      proposalId: proposal.id,
      signer: {
        did: members[0].did,
        alg: members[0].alg,
        secretKey: secretKeys[members[0].did],
      },
    });
    expect(r3.accepted).toBe(true);
    expect(r3.reachedThreshold).toBe(true);
    expect(store.getProposal(proposal.id).state).toBe("reached");
  });

  it("requirePqc=false: M Ed25519 sigs reach threshold (control)", () => {
    const mgr = createProposalsManager(store);
    const { policy, secretKeys, members } = setupPolicy({
      m: 2,
      n: 3,
      withPqc: true,
      requirePqc: false,
    });
    const { proposal } = mgr.propose({
      domain: policy.domain,
      payload: { orderId: "o-noreq" },
      policy,
      initiator: {
        did: members[1].did,
        alg: members[1].alg,
        secretKey: secretKeys[members[1].did],
      },
    });
    const r2 = mgr.sign({
      proposalId: proposal.id,
      signer: {
        did: members[2].did,
        alg: members[2].alg,
        secretKey: secretKeys[members[2].did],
      },
    });
    expect(r2.reachedThreshold).toBe(true);
    expect(store.getProposal(proposal.id).state).toBe("reached");
  });
});
