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
