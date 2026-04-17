import { describe, it, expect, beforeEach } from "vitest";
import {
  DID_METHOD,
  CREDENTIAL_STATUS,
  RECOVERY_STATUS,
  DID_STATUS,
  REPUTATION_SOURCE_WEIGHTS,
  DEFAULT_RECOVERY_THRESHOLD,
  VP_DEFAULT_TTL_MS,
  ensureDIDv2Tables,
  createDID,
  resolveDID,
  listDIDs,
  updateDIDStatus,
  issueCredential,
  getCredential,
  listCredentials,
  revokeCredential,
  createPresentation,
  getPresentation,
  listPresentations,
  verifyPresentation,
  startRecovery,
  completeRecovery,
  getRecovery,
  listRecoveries,
  roamIdentity,
  listRoamingLog,
  recordReputationSource,
  aggregateReputation,
  exportDID,
  getStats,
  getConfig,
} from "../../src/lib/did-v2-manager.js";
import { MockDatabase } from "../helpers/mock-db.js";

describe("did-v2-manager", () => {
  let db;
  beforeEach(() => {
    db = new MockDatabase();
    ensureDIDv2Tables(db);
  });

  describe("constants & config", () => {
    it("defines 3 DID methods (key/web/chain)", () => {
      expect(Object.values(DID_METHOD)).toEqual(["key", "web", "chain"]);
    });

    it("defines 4 credential statuses", () => {
      expect(Object.values(CREDENTIAL_STATUS)).toEqual([
        "active",
        "revoked",
        "expired",
        "suspended",
      ]);
    });

    it("default recovery threshold is 3", () => {
      expect(DEFAULT_RECOVERY_THRESHOLD).toBe(3);
    });

    it("VP default TTL is 30 minutes", () => {
      expect(VP_DEFAULT_TTL_MS).toBe(30 * 60_000);
    });

    it("on-chain source has highest weight", () => {
      expect(REPUTATION_SOURCE_WEIGHTS["on-chain"]).toBeGreaterThan(
        REPUTATION_SOURCE_WEIGHTS.social,
      );
    });

    it("config exposes all methods and statuses", () => {
      const c = getConfig();
      expect(c.methods).toEqual(["key", "web", "chain"]);
      expect(c.credentialStatuses).toContain("active");
      expect(c.recoveryStatuses).toContain("threshold_met");
      expect(c.didStatuses).toContain("active");
    });
  });

  describe("DID creation", () => {
    it("creates a did:key DID with Ed25519 keys", () => {
      const r = createDID(db, { method: DID_METHOD.KEY });
      expect(r.did).toMatch(/^did:key:z/);
      expect(r.method).toBe(DID_METHOD.KEY);
      expect(r.publicKey).toMatch(/^[0-9a-f]+$/);
      expect(r.privateKey).toMatch(/^[0-9a-f]+$/);
      expect(r.document.id).toBe(r.did);
      expect(r.document.verificationMethod[0].publicKeyHex).toBe(r.publicKey);
    });

    it("creates a did:web DID with domain", () => {
      const r = createDID(db, {
        method: DID_METHOD.WEB,
        domain: "example.org",
      });
      expect(r.did).toMatch(/^did:web:example.org:/);
    });

    it("creates a did:chain DID", () => {
      const r = createDID(db, { method: DID_METHOD.CHAIN });
      expect(r.did).toMatch(/^did:chain:/);
    });

    it("rejects invalid method", () => {
      expect(() => createDID(db, { method: "bogus" })).toThrow(
        /invalid method/,
      );
    });

    it("rejects threshold exceeding guardians", () => {
      expect(() =>
        createDID(db, { guardians: ["did:a", "did:b"], threshold: 5 }),
      ).toThrow(/exceeds guardian count/);
    });

    it("allows threshold within guardian count", () => {
      const r = createDID(db, {
        guardians: ["did:a", "did:b", "did:c", "did:d"],
        threshold: 3,
      });
      expect(r.did).toBeDefined();
    });

    it("persists guardians and threshold", () => {
      const r = createDID(db, {
        guardians: ["did:g1", "did:g2", "did:g3"],
        threshold: 2,
      });
      const loaded = resolveDID(db, r.did);
      expect(loaded.recoveryGuardians).toEqual(["did:g1", "did:g2", "did:g3"]);
      expect(loaded.recoveryThreshold).toBe(2);
    });

    it("persists service endpoints", () => {
      const services = [{ type: "LinkedDomains", endpoint: "https://foo.bar" }];
      const r = createDID(db, { services });
      const loaded = resolveDID(db, r.did);
      expect(loaded.serviceEndpoints).toEqual(services);
    });
  });

  describe("DID resolution & listing", () => {
    it("returns null for unknown DID", () => {
      expect(resolveDID(db, "did:nope:xxx")).toBeNull();
    });

    it("resolves a created DID", () => {
      const r = createDID(db);
      const loaded = resolveDID(db, r.did);
      expect(loaded.did).toBe(r.did);
      expect(loaded.status).toBe("active");
      expect(loaded.reputationScore).toBe(0.0);
    });

    it("lists all DIDs", () => {
      createDID(db, { method: DID_METHOD.KEY });
      createDID(db, { method: DID_METHOD.CHAIN });
      createDID(db, { method: DID_METHOD.CHAIN });
      const rows = listDIDs(db);
      expect(rows).toHaveLength(3);
    });

    it("filters DIDs by method", () => {
      createDID(db, { method: DID_METHOD.KEY });
      createDID(db, { method: DID_METHOD.CHAIN });
      const chain = listDIDs(db, { method: DID_METHOD.CHAIN });
      expect(chain).toHaveLength(1);
      expect(chain[0].method).toBe("chain");
    });

    it("updates DID status (revoke)", () => {
      const r = createDID(db);
      expect(updateDIDStatus(db, r.did, DID_STATUS.REVOKED)).toBe(true);
      expect(resolveDID(db, r.did).status).toBe("revoked");
    });

    it("rejects invalid status", () => {
      const r = createDID(db);
      expect(() => updateDIDStatus(db, r.did, "nope")).toThrow(
        /invalid status/,
      );
    });
  });

  describe("credentials", () => {
    let holder, issuer;
    beforeEach(() => {
      issuer = createDID(db);
      holder = createDID(db);
    });

    it("issues a credential with Ed25519 proof", () => {
      const vc = issueCredential(db, {
        holderDid: holder.did,
        issuerDid: issuer.did,
        type: "DriverLicense",
        credentialSubject: { name: "Alice", license: "ABC123" },
      });
      expect(vc.id).toMatch(/^urn:uuid:/);
      expect(vc.type).toContain("VerifiableCredential");
      expect(vc.type).toContain("DriverLicense");
      expect(vc.issuer).toBe(issuer.did);
      expect(vc.credentialSubject.id).toBe(holder.did);
      expect(vc.proof.proofValue).toMatch(/^[0-9a-f]+$/);
    });

    it("rejects issuance when issuer missing", () => {
      expect(() =>
        issueCredential(db, {
          holderDid: holder.did,
          issuerDid: "did:missing:xxx",
          type: "Thing",
        }),
      ).toThrow(/issuer not found/);
    });

    it("requires holder/issuer/type", () => {
      expect(() =>
        issueCredential(db, { issuerDid: issuer.did, type: "X" }),
      ).toThrow(/holderDid/);
    });

    it("retrieves a credential by id", () => {
      const vc = issueCredential(db, {
        holderDid: holder.did,
        issuerDid: issuer.did,
        type: "T",
      });
      const r = getCredential(db, vc._id);
      expect(r.holderDid).toBe(holder.did);
      expect(r.status).toBe("active");
    });

    it("lists credentials filtered by holder", () => {
      issueCredential(db, {
        holderDid: holder.did,
        issuerDid: issuer.did,
        type: "A",
      });
      issueCredential(db, {
        holderDid: holder.did,
        issuerDid: issuer.did,
        type: "B",
      });
      const rows = listCredentials(db, { holderDid: holder.did });
      expect(rows).toHaveLength(2);
    });

    it("revokes a credential with reason", () => {
      const vc = issueCredential(db, {
        holderDid: holder.did,
        issuerDid: issuer.did,
        type: "T",
      });
      expect(revokeCredential(db, vc._id, "expired license")).toBe(true);
      const r = getCredential(db, vc._id);
      expect(r.status).toBe("revoked");
      expect(r.revocationReason).toBe("expired license");
    });

    it("sets expiration when provided", () => {
      const vc = issueCredential(db, {
        holderDid: holder.did,
        issuerDid: issuer.did,
        type: "T",
        expiresInMs: 60_000,
      });
      const r = getCredential(db, vc._id);
      expect(r.expirationDate).toBeGreaterThan(r.issuanceDate);
    });
  });

  describe("verifiable presentations", () => {
    let holder, issuer, credId;
    beforeEach(() => {
      issuer = createDID(db);
      holder = createDID(db);
      const vc = issueCredential(db, {
        holderDid: holder.did,
        issuerDid: issuer.did,
        type: "TestCred",
      });
      credId = vc._id;
    });

    it("creates a VP with Ed25519 proof", () => {
      const vp = createPresentation(db, {
        holderDid: holder.did,
        credentialIds: [credId],
      });
      expect(vp.id).toMatch(/^urn:uuid:/);
      expect(vp.credentialIds).toEqual([credId]);
      expect(vp.proof.proofValue).toMatch(/^[0-9a-f]+$/);
      expect(vp.expiresAt).toBeGreaterThan(Date.now());
    });

    it("rejects empty credentialIds", () => {
      expect(() =>
        createPresentation(db, { holderDid: holder.did, credentialIds: [] }),
      ).toThrow(/non-empty/);
    });

    it("rejects credentials from another holder", () => {
      const other = createDID(db);
      expect(() =>
        createPresentation(db, {
          holderDid: other.did,
          credentialIds: [credId],
        }),
      ).toThrow(/belongs to/);
    });

    it("rejects revoked credentials", () => {
      revokeCredential(db, credId);
      expect(() =>
        createPresentation(db, {
          holderDid: holder.did,
          credentialIds: [credId],
        }),
      ).toThrow(/not active/);
    });

    it("supports ZKP proof placeholder", () => {
      const vp = createPresentation(db, {
        holderDid: holder.did,
        credentialIds: [credId],
        zkpEnabled: true,
      });
      expect(vp.zkpProofId).toMatch(/^zkp:/);
    });

    it("stores selectively-disclosed fields", () => {
      const vp = createPresentation(db, {
        holderDid: holder.did,
        credentialIds: [credId],
        disclosedFields: ["name"],
      });
      const loaded = getPresentation(db, vp.id);
      expect(loaded.disclosedFields).toEqual(["name"]);
    });

    it("verifies a valid VP", () => {
      const vp = createPresentation(db, {
        holderDid: holder.did,
        credentialIds: [credId],
      });
      const r = verifyPresentation(db, vp.id);
      expect(r.ok).toBe(true);
      expect(r.verificationTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("rejects verification of unknown VP", () => {
      expect(verifyPresentation(db, "urn:uuid:nope").ok).toBe(false);
    });

    it("rejects verification when underlying credential is revoked", () => {
      const vp = createPresentation(db, {
        holderDid: holder.did,
        credentialIds: [credId],
      });
      revokeCredential(db, credId);
      const r = verifyPresentation(db, vp.id);
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/credential_revoked/);
    });

    it("lists presentations by holder", () => {
      createPresentation(db, {
        holderDid: holder.did,
        credentialIds: [credId],
      });
      createPresentation(db, {
        holderDid: holder.did,
        credentialIds: [credId],
      });
      const rows = listPresentations(db, { holderDid: holder.did });
      expect(rows).toHaveLength(2);
    });

    it("persists verified state after verification", () => {
      const vp = createPresentation(db, {
        holderDid: holder.did,
        credentialIds: [credId],
      });
      verifyPresentation(db, vp.id);
      const loaded = getPresentation(db, vp.id);
      expect(loaded.verified).toBe(true);
    });
  });

  describe("social recovery", () => {
    let did;
    const guardians = ["did:g1", "did:g2", "did:g3", "did:g4", "did:g5"];
    beforeEach(() => {
      const r = createDID(db, { guardians, threshold: 3 });
      did = r.did;
    });

    it("marks recovery PENDING when below threshold", () => {
      const r = startRecovery(db, {
        did,
        shares: [
          { guardian: "did:g1", share: "s1" },
          { guardian: "did:g2", share: "s2" },
        ],
      });
      expect(r.status).toBe(RECOVERY_STATUS.PENDING);
      expect(r.validShares).toBe(2);
    });

    it("marks recovery THRESHOLD_MET when shares >= threshold", () => {
      const r = startRecovery(db, {
        did,
        shares: [
          { guardian: "did:g1", share: "s1" },
          { guardian: "did:g2", share: "s2" },
          { guardian: "did:g3", share: "s3" },
        ],
      });
      expect(r.status).toBe(RECOVERY_STATUS.THRESHOLD_MET);
    });

    it("ignores shares from non-guardians", () => {
      const r = startRecovery(db, {
        did,
        shares: [
          { guardian: "did:g1", share: "s1" },
          { guardian: "did:imposter", share: "x" },
          { guardian: "did:g3", share: "s3" },
        ],
      });
      expect(r.validShares).toBe(2);
      expect(r.status).toBe(RECOVERY_STATUS.PENDING);
    });

    it("rotates keypair on completeRecovery", () => {
      const before = resolveDID(db, did).publicKey;
      const r1 = startRecovery(db, {
        did,
        shares: guardians.slice(0, 3).map((g) => ({ guardian: g, share: "x" })),
      });
      const r2 = completeRecovery(db, r1.id);
      expect(r2.newPublicKey).not.toBe(before);
      const after = resolveDID(db, did).publicKey;
      expect(after).toBe(r2.newPublicKey);
    });

    it("rejects complete when threshold not met", () => {
      const r1 = startRecovery(db, {
        did,
        shares: [{ guardian: "did:g1", share: "s1" }],
      });
      expect(() => completeRecovery(db, r1.id)).toThrow(/not ready/);
    });

    it("lists recoveries filtered by DID", () => {
      startRecovery(db, { did, shares: [{ guardian: "did:g1", share: "s1" }] });
      startRecovery(db, { did, shares: [{ guardian: "did:g2", share: "s2" }] });
      const rows = listRecoveries(db, { did });
      expect(rows).toHaveLength(2);
    });
  });

  describe("identity roaming", () => {
    it("logs a roaming migration", () => {
      const d = createDID(db);
      const issuer = createDID(db);
      issueCredential(db, {
        holderDid: d.did,
        issuerDid: issuer.did,
        type: "T",
      });
      const r = roamIdentity(db, {
        did: d.did,
        targetPlatform: "PlatformY",
        sourcePlatform: "PlatformX",
        migrationProof: "proof-abc",
      });
      expect(r.targetPlatform).toBe("PlatformY");
      expect(r.credentialsMigrated).toBe(1);
    });

    it("marks DID status as roamed", () => {
      const d = createDID(db);
      roamIdentity(db, { did: d.did, targetPlatform: "PlatformZ" });
      expect(resolveDID(db, d.did).status).toBe("roamed");
    });

    it("lists roaming log by DID", () => {
      const d = createDID(db);
      roamIdentity(db, { did: d.did, targetPlatform: "A" });
      roamIdentity(db, { did: d.did, targetPlatform: "B" });
      expect(listRoamingLog(db, { did: d.did })).toHaveLength(2);
    });

    it("throws on unknown DID", () => {
      expect(() =>
        roamIdentity(db, { did: "did:missing", targetPlatform: "X" }),
      ).toThrow(/did not found/);
    });
  });

  describe("reputation aggregation", () => {
    let did;
    beforeEach(() => {
      did = createDID(db).did;
    });

    it("applies source weight on record", () => {
      const r = recordReputationSource(db, {
        did,
        source: "on-chain",
        score: 4.5,
      });
      expect(r.weight).toBe(REPUTATION_SOURCE_WEIGHTS["on-chain"]);
    });

    it("defaults weight to 1.0 for unknown source", () => {
      const r = recordReputationSource(db, {
        did,
        source: "custom",
        score: 3.0,
      });
      expect(r.weight).toBe(1.0);
    });

    it("aggregates to weighted mean", () => {
      recordReputationSource(db, { did, source: "on-chain", score: 4.0 });
      recordReputationSource(db, { did, source: "social", score: 2.0 });
      const agg = aggregateReputation(db, did);
      const expected = (4.0 * 1.3 + 2.0 * 1.0) / (1.3 + 1.0);
      expect(agg.aggregatedScore).toBeCloseTo(expected, 3);
      expect(agg.sourceCount).toBe(2);
    });

    it("writes aggregated score back to DID document", () => {
      recordReputationSource(db, { did, source: "social", score: 3.5 });
      aggregateReputation(db, did);
      expect(resolveDID(db, did).reputationScore).toBeCloseTo(3.5, 3);
    });

    it("returns zero when no samples", () => {
      const r = aggregateReputation(db, did);
      expect(r.aggregatedScore).toBe(0.0);
      expect(r.sourceCount).toBe(0);
    });

    it("filters aggregation by source list", () => {
      recordReputationSource(db, { did, source: "on-chain", score: 4.0 });
      recordReputationSource(db, { did, source: "social", score: 2.0 });
      const r = aggregateReputation(db, did, { sources: ["on-chain"] });
      expect(r.sourceCount).toBe(1);
      expect(r.aggregatedScore).toBeCloseTo(4.0, 3);
    });

    it("reports per-source breakdown with sample count", () => {
      recordReputationSource(db, { did, source: "on-chain", score: 4.0 });
      recordReputationSource(db, { did, source: "on-chain", score: 5.0 });
      const r = aggregateReputation(db, did);
      expect(r.sources).toHaveLength(1);
      expect(r.sources[0].sampleCount).toBe(2);
      expect(r.sources[0].avgScore).toBeCloseTo(4.5, 3);
    });
  });

  describe("export", () => {
    it("exports json-ld with document + credentials", () => {
      const d = createDID(db);
      const issuer = createDID(db);
      issueCredential(db, {
        holderDid: d.did,
        issuerDid: issuer.did,
        type: "T",
      });
      const r = exportDID(db, d.did);
      expect(r.format).toBe("json-ld");
      expect(r.document.id).toBe(d.did);
      expect(r.credentials).toHaveLength(1);
    });

    it("exports JWT-style token", () => {
      const d = createDID(db);
      const r = exportDID(db, d.did, { format: "jwt" });
      expect(r.format).toBe("jwt");
      expect(r.token.split(".")).toHaveLength(3);
    });

    it("throws on unknown DID", () => {
      expect(() => exportDID(db, "did:missing")).toThrow(/did not found/);
    });
  });

  describe("stats", () => {
    it("returns zero stats for empty DB", () => {
      const s = getStats(db);
      expect(s.didCount).toBe(0);
      expect(s.credentialCount).toBe(0);
      expect(s.presentationCount).toBe(0);
    });

    it("tallies DIDs, credentials, presentations", () => {
      const issuer = createDID(db);
      const holder = createDID(db);
      const vc = issueCredential(db, {
        holderDid: holder.did,
        issuerDid: issuer.did,
        type: "T",
      });
      createPresentation(db, {
        holderDid: holder.did,
        credentialIds: [vc._id],
      });
      const s = getStats(db);
      expect(s.didCount).toBe(2);
      expect(s.activeDIDs).toBe(2);
      expect(s.credentialCount).toBe(1);
      expect(s.activeCredentials).toBe(1);
      expect(s.presentationCount).toBe(1);
    });

    it("counts verified presentations", () => {
      const issuer = createDID(db);
      const holder = createDID(db);
      const vc = issueCredential(db, {
        holderDid: holder.did,
        issuerDid: issuer.did,
        type: "T",
      });
      const vp = createPresentation(db, {
        holderDid: holder.did,
        credentialIds: [vc._id],
      });
      verifyPresentation(db, vp.id);
      expect(getStats(db).verifiedPresentations).toBe(1);
    });
  });
});
