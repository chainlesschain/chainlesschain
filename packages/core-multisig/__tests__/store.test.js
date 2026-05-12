import { describe, it, expect, beforeAll, beforeEach } from "vitest";

const { applySchema } = require("../lib/schema.js");
const { createStore } = require("../lib/store.js");
const { adaptSqlJsDb } = require("./helpers/sql-js-adapter.js");

let SQL;

beforeAll(async () => {
  const initSqlJs = (await import("sql.js")).default;
  SQL = await initSqlJs();
});

function freshStore() {
  const sqlDb = new SQL.Database();
  const db = adaptSqlJsDb(sqlDb);
  applySchema(db);
  return createStore(db);
}

const fakeProposal = (overrides = {}) => ({
  id: "msp_test_1",
  domain: "test.purchase",
  payloadJcs: '{"a":1}',
  payloadHash: Buffer.alloc(32, 7),
  nonce: "abc",
  expiresAtMs: 1_700_000_000_000,
  thresholdM: 2,
  memberSet: [
    { did: "did:cc:a", alg: "Ed25519", pubkeyJwk: { x: "fake" } },
    { did: "did:cc:b", alg: "Ed25519", pubkeyJwk: { x: "fake2" } },
  ],
  state: "pending",
  initiatorDid: "did:cc:a",
  createdAtMs: 1_700_000_000_000,
  updatedAtMs: 1_700_000_000_000,
  ...overrides,
});

const fakeSig = (overrides = {}) => ({
  proposalId: "msp_test_1",
  signerDid: "did:cc:a",
  sig: Buffer.alloc(64, 9),
  alg: "Ed25519",
  signedAtMs: 1_700_000_000_000,
  ...overrides,
});

describe("store proposals", () => {
  it("insert + get roundtrip preserves all fields", () => {
    const store = freshStore();
    store.insertProposal(fakeProposal());
    const got = store.getProposal("msp_test_1");
    expect(got).toBeTruthy();
    expect(got.id).toBe("msp_test_1");
    expect(got.domain).toBe("test.purchase");
    expect(got.payloadJcs).toBe('{"a":1}');
    expect(Buffer.isBuffer(got.payloadHash)).toBe(true);
    expect(got.payloadHash.length).toBe(32);
    expect(got.memberSet).toHaveLength(2);
    expect(got.memberSet[0].did).toBe("did:cc:a");
    expect(got.state).toBe("pending");
  });

  it("getProposal returns null for unknown id", () => {
    const store = freshStore();
    expect(store.getProposal("nonexistent")).toBeNull();
  });

  it("updateProposalState transitions state and returns true", () => {
    const store = freshStore();
    store.insertProposal(fakeProposal());
    const ok = store.updateProposalState("msp_test_1", "reached", 1_700_000_001_000);
    expect(ok).toBe(true);
    const got = store.getProposal("msp_test_1");
    expect(got.state).toBe("reached");
    expect(got.updatedAtMs).toBe(1_700_000_001_000);
  });

  it("updateProposalState returns false for unknown id", () => {
    const store = freshStore();
    const ok = store.updateProposalState("nope", "reached", 0);
    expect(ok).toBe(false);
  });

  it("CHECK constraint rejects invalid state", () => {
    const store = freshStore();
    expect(() =>
      store.insertProposal(fakeProposal({ state: "INVALID_STATE" })),
    ).toThrow();
  });

  it("listProposals filters by state and domain", () => {
    const store = freshStore();
    store.insertProposal(fakeProposal({ id: "p1", state: "pending" }));
    store.insertProposal(fakeProposal({ id: "p2", state: "reached" }));
    store.insertProposal(fakeProposal({ id: "p3", state: "pending", domain: "other" }));
    expect(store.listProposals({ state: "pending" })).toHaveLength(2);
    expect(store.listProposals({ domain: "other" })).toHaveLength(1);
    expect(store.listProposals({ state: "pending", domain: "test.purchase" })).toHaveLength(1);
  });

  it("listProposals default limit ordering by createdAtMs DESC", () => {
    const store = freshStore();
    store.insertProposal(fakeProposal({ id: "p1", createdAtMs: 100 }));
    store.insertProposal(fakeProposal({ id: "p2", createdAtMs: 200 }));
    store.insertProposal(fakeProposal({ id: "p3", createdAtMs: 150 }));
    const out = store.listProposals();
    expect(out.map((p) => p.id)).toEqual(["p2", "p3", "p1"]);
  });
});

describe("store signatures", () => {
  it("insert + getSignatures + hasSignature", () => {
    const store = freshStore();
    store.insertProposal(fakeProposal());
    store.insertSignature(fakeSig({ signerDid: "did:cc:a" }));
    store.insertSignature(fakeSig({ signerDid: "did:cc:b", sig: Buffer.alloc(64, 5) }));
    const sigs = store.getSignatures("msp_test_1");
    expect(sigs).toHaveLength(2);
    // sorted by signer_did ASC
    expect(sigs.map((s) => s.signerDid)).toEqual(["did:cc:a", "did:cc:b"]);
    expect(store.hasSignature("msp_test_1", "did:cc:a")).toBe(true);
    expect(store.hasSignature("msp_test_1", "did:cc:zzz")).toBe(false);
  });

  it("PK (proposal_id, signer_did) prevents duplicate signature", () => {
    const store = freshStore();
    store.insertProposal(fakeProposal());
    store.insertSignature(fakeSig());
    expect(() => store.insertSignature(fakeSig())).toThrow();
  });
});

describe("store policies", () => {
  it("setPolicy + getPolicy roundtrip", () => {
    const store = freshStore();
    const policy = { domain: "x", m: 2, n: 3 };
    store.setPolicy("x", JSON.stringify(policy), 100);
    expect(store.getPolicy("x")).toEqual(policy);
  });

  it("setPolicy upserts on duplicate domain", () => {
    const store = freshStore();
    store.setPolicy("x", JSON.stringify({ v: 1 }), 100);
    store.setPolicy("x", JSON.stringify({ v: 2 }), 200);
    expect(store.getPolicy("x").v).toBe(2);
  });

  it("getPolicy returns null for unknown domain", () => {
    const store = freshStore();
    expect(store.getPolicy("nope")).toBeNull();
  });

  it("listPolicies returns all entries", () => {
    const store = freshStore();
    store.setPolicy("a", "{}", 1);
    store.setPolicy("b", "{}", 2);
    expect(store.listPolicies()).toHaveLength(2);
  });
});

describe("store expire sweeper", () => {
  it("expireStale flips state and returns count", () => {
    const store = freshStore();
    store.insertProposal(fakeProposal({ id: "p1", expiresAtMs: 100, state: "pending" }));
    store.insertProposal(fakeProposal({ id: "p2", expiresAtMs: 100, state: "reached" }));
    store.insertProposal(fakeProposal({ id: "p3", expiresAtMs: 9_999_999_999, state: "pending" }));
    const swept = store.expireStale(1_000);
    expect(swept).toBe(1);
    expect(store.getProposal("p1").state).toBe("expired");
    expect(store.getProposal("p2").state).toBe("reached"); // 不触
    expect(store.getProposal("p3").state).toBe("pending"); // 未到期
  });
});
