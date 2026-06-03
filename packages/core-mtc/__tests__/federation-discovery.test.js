"use strict";

import { describe, it, expect } from "vitest";

const {
  createMemberAnnounce,
  verifyMemberAnnounce,
  FederationAnnounceCache,
  ed25519,
  slhDsa,
  SCHEMA_FEDERATION_ANNOUNCE,
} = require("../lib/index.js");

function makeMember(overrides = {}) {
  const keys = ed25519.generateKeyPair();
  return {
    federationId: "fed-acme",
    memberId: "node-a",
    issuer: "mtca:cc:fed-acme:node-a",
    secretKey: keys.secretKey,
    publicKey: keys.publicKey,
    ...overrides,
  };
}

describe("createMemberAnnounce / verifyMemberAnnounce", () => {
  it("produces a self-signed announce that round-trips through verify", () => {
    const ann = createMemberAnnounce(makeMember());
    expect(ann.schema).toBe(SCHEMA_FEDERATION_ANNOUNCE);
    expect(ann.federation_id).toBe("fed-acme");
    expect(ann.member_id).toBe("node-a");
    expect(ann.alg).toBe("Ed25519");
    expect(ann.pubkey_id).toMatch(/^sha256:/);
    expect(ann.signature).toBeDefined();

    const r = verifyMemberAnnounce(ann);
    expect(r.ok).toBe(true);
  });

  it("verify rejects schema mismatch", () => {
    const ann = createMemberAnnounce(makeMember());
    ann.schema = "wrong/v1";
    expect(verifyMemberAnnounce(ann).code).toBe("BAD_ANNOUNCE_SCHEMA");
  });

  it("verify rejects missing required fields", () => {
    const ann = createMemberAnnounce(makeMember());
    delete ann.federation_id;
    expect(verifyMemberAnnounce(ann).code).toBe("MISSING_FIELD");
  });

  it("verify rejects expired announces by default", () => {
    const oldDate = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    const ann = createMemberAnnounce({
      ...makeMember(),
      announcedAt: oldDate,
      ttlSeconds: 60, // 1 min, way smaller than the 3 hours past
    });
    expect(verifyMemberAnnounce(ann).code).toBe("ANNOUNCE_EXPIRED");
  });

  it("verify accepts expired announces with allowExpired:true", () => {
    const oldDate = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    const ann = createMemberAnnounce({
      ...makeMember(),
      announcedAt: oldDate,
      ttlSeconds: 60,
    });
    expect(verifyMemberAnnounce(ann, { allowExpired: true }).ok).toBe(true);
  });

  it("verify rejects tampered announces (signature mismatch)", () => {
    const ann = createMemberAnnounce(makeMember());
    // Tamper: change member_id after signing
    ann.member_id = "impersonator";
    expect(verifyMemberAnnounce(ann).code).toBe("BAD_SIGNATURE");
  });

  it("verify rejects pubkey_id that doesn't match the JWK", () => {
    const ann = createMemberAnnounce(makeMember());
    ann.pubkey_id = "sha256:wrongidwrongidwrongid";
    expect(verifyMemberAnnounce(ann).code).toBe("PUBKEY_ID_MISMATCH");
  });

  it("supports SLH-DSA-128F federation members", () => {
    const keys = slhDsa.generateKeyPair();
    const ann = createMemberAnnounce({
      federationId: "fed-pqc",
      memberId: "pqc-node",
      issuer: "mtca:cc:fed-pqc:pqc-node",
      secretKey: keys.secretKey,
      publicKey: keys.publicKey,
      signer: slhDsa,
    });
    expect(ann.alg).toBe("SLH-DSA-SHA2-128F");
    expect(ann.pubkey_jwk.kty).toBe("PQK");
    expect(verifyMemberAnnounce(ann).ok).toBe(true);
  });

  it("verify rejects unknown alg", () => {
    const ann = createMemberAnnounce(makeMember());
    ann.alg = "RSA-PSS-SHA512"; // not supported
    expect(verifyMemberAnnounce(ann).code).toBe("UNKNOWN_ALG");
  });
});

describe("FederationAnnounceCache", () => {
  it("ingests valid announces and lists them per federation", () => {
    const cache = new FederationAnnounceCache();
    const a = createMemberAnnounce(makeMember({ memberId: "alice" }));
    const b = createMemberAnnounce(makeMember({ memberId: "bob" }));
    expect(cache.ingest(a)).toEqual({ accepted: true, replaced: false });
    expect(cache.ingest(b)).toEqual({ accepted: true, replaced: false });

    const list = cache.listMembers("fed-acme");
    expect(list).toHaveLength(2);
    expect(list.map((m) => m.member_id).sort()).toEqual(["alice", "bob"]);
  });

  it("rejects expired announces silently (accepted=false)", () => {
    const cache = new FederationAnnounceCache();
    const oldAnn = createMemberAnnounce({
      ...makeMember(),
      announcedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
      ttlSeconds: 60,
    });
    const r = cache.ingest(oldAnn);
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe("ANNOUNCE_EXPIRED");
    expect(cache.size()).toBe(0);
  });

  it("re-announce from same pubkey_id replaces previous (replaced=true)", () => {
    const cache = new FederationAnnounceCache();
    const member = makeMember();
    const first = createMemberAnnounce({
      ...member,
      announcedAt: new Date(Date.now() - 1000).toISOString(),
    });
    const second = createMemberAnnounce(member); // same key, fresh timestamp
    expect(cache.ingest(first)).toEqual({ accepted: true, replaced: false });
    expect(cache.ingest(second)).toEqual({ accepted: true, replaced: true });
    expect(cache.listMembers("fed-acme")).toHaveLength(1);
  });

  it("listMembers evicts entries that have expired since insertion", () => {
    const cache = new FederationAnnounceCache();
    const ann = createMemberAnnounce({
      ...makeMember(),
      announcedAt: new Date().toISOString(),
      ttlSeconds: 60,
    });
    cache.ingest(ann);
    expect(cache.listMembers("fed-acme")).toHaveLength(1);
    // Simulate "10 minutes later" — past TTL
    const futureNow = Date.now() + 10 * 60 * 1000;
    expect(cache.listMembers("fed-acme", { now: futureNow })).toHaveLength(0);
    // Subsequent calls confirm eviction is sticky
    expect(cache.listMembers("fed-acme")).toHaveLength(0);
  });

  it("federations() lists all keys with at least one announce", () => {
    const cache = new FederationAnnounceCache();
    cache.ingest(createMemberAnnounce(makeMember({ federationId: "f1" })));
    cache.ingest(createMemberAnnounce(makeMember({ federationId: "f2" })));
    expect(cache.federations().sort()).toEqual(["f1", "f2"]);
  });

  it("rejects ingest on tampered announces", () => {
    const cache = new FederationAnnounceCache();
    const ann = createMemberAnnounce(makeMember());
    ann.issuer = "mtca:cc:imposter";
    const r = cache.ingest(ann);
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe("BAD_SIGNATURE");
  });
});
