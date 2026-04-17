import { describe, it, expect, beforeEach } from "vitest";
import {
  DID_STATUS,
  REG_STATUS,
  AUTH_STATUS,
  CRED_STATUS,
  TASK_STATUS,
  REPUTATION_DIMENSIONS,
  KADEMLIA_K,
  KADEMLIA_BITS,
  ensureAgentNetworkTables,
  createAgentDID,
  resolveAgentDID,
  listAgentDIDs,
  deactivateAgentDID,
  signWithAgent,
  verifyWithAgent,
  registerAgent,
  unregisterAgent,
  heartbeatAgent,
  discoverAgents,
  sweepStaleAgents,
  addPeer,
  removePeer,
  listPeers,
  startAuth,
  completeAuth,
  validateSession,
  listSessions,
  issueCredential,
  getCredential,
  verifyCredential,
  revokeCredential,
  listCredentials,
  routeTask,
  getTask,
  updateTaskStatus,
  cancelTask,
  listTasks,
  updateReputation,
  getReputation,
  getReputationHistory,
  getTopAgents,
  getNetworkStats,
  getNetworkConfig,
} from "../../src/lib/agent-network.js";
import { MockDatabase } from "../helpers/mock-db.js";

describe("agent-network", () => {
  let db;
  beforeEach(() => {
    db = new MockDatabase();
    ensureAgentNetworkTables(db);
  });

  describe("schema & constants", () => {
    it("defines 4 reputation dimensions", () => {
      expect(REPUTATION_DIMENSIONS).toEqual([
        "reliability",
        "quality",
        "speed",
        "cooperation",
      ]);
    });

    it("Kademlia params match spec (160 bits, k=20)", () => {
      expect(KADEMLIA_BITS).toBe(160);
      expect(KADEMLIA_K).toBe(20);
    });

    it("network config exposes all constants", () => {
      const cfg = getNetworkConfig();
      expect(cfg.kademliaBits).toBe(160);
      expect(cfg.kademliaK).toBe(20);
      expect(cfg.reputationDimensions).toEqual(REPUTATION_DIMENSIONS);
      expect(cfg.didStatuses).toContain(DID_STATUS.ACTIVE);
      expect(cfg.regStatuses).toContain(REG_STATUS.ONLINE);
      expect(cfg.taskStatuses).toContain(TASK_STATUS.ROUTED);
    });

    it("ensureAgentNetworkTables is idempotent", () => {
      expect(() => {
        ensureAgentNetworkTables(db);
        ensureAgentNetworkTables(db);
      }).not.toThrow();
    });
  });

  describe("DID management", () => {
    it("creates a DID with valid did:chainless prefix", () => {
      const r = createAgentDID(db, { displayName: "agent-a" });
      expect(r.did).toMatch(/^did:chainless:[A-Za-z0-9_-]+$/);
      expect(r.publicKey).toMatch(/^[0-9a-f]+$/);
      expect(r.didDocument.id).toBe(r.did);
      expect(r.didDocument.service[0].type).toBe("AgentService");
    });

    it("resolves a DID back into public metadata", () => {
      const { did } = createAgentDID(db, { displayName: "agent-b" });
      const resolved = resolveAgentDID(db, did);
      expect(resolved).toBeTruthy();
      expect(resolved.status).toBe(DID_STATUS.ACTIVE);
      expect(resolved.metadata.displayName).toBe("agent-b");
    });

    it("returns null for unknown DID", () => {
      expect(resolveAgentDID(db, "did:chainless:unknown")).toBeNull();
    });

    it("lists DIDs filtered by status", () => {
      const a = createAgentDID(db).did;
      createAgentDID(db);
      deactivateAgentDID(db, a);
      const active = listAgentDIDs(db, { status: DID_STATUS.ACTIVE });
      const deact = listAgentDIDs(db, { status: DID_STATUS.DEACTIVATED });
      expect(active).toHaveLength(1);
      expect(deact).toHaveLength(1);
      expect(deact[0].did).toBe(a);
    });

    it("deactivates a DID and forces registry offline", () => {
      const { did } = createAgentDID(db);
      registerAgent(db, { did, orgId: "org-1", capabilities: ["nlp"] });
      deactivateAgentDID(db, did);
      const agents = discoverAgents(db, {
        orgId: "org-1",
        status: REG_STATUS.OFFLINE,
      });
      expect(agents).toHaveLength(1);
      expect(agents[0].agentDid).toBe(did);
    });

    it("deactivate returns { changed: false } for unknown DID", () => {
      expect(deactivateAgentDID(db, "did:chainless:ghost")).toEqual({
        changed: false,
      });
    });
  });

  describe("signing & verification", () => {
    it("signs and verifies arbitrary data with agent keypair", () => {
      const { did } = createAgentDID(db);
      const sig = signWithAgent(db, did, "hello");
      expect(verifyWithAgent(db, did, "hello", sig)).toBe(true);
      expect(verifyWithAgent(db, did, "tampered", sig)).toBe(false);
    });

    it("throws when signing with unknown DID", () => {
      expect(() => signWithAgent(db, "did:chainless:ghost", "x")).toThrow(
        /Unknown agent DID/,
      );
    });

    it("throws when signing with deactivated DID", () => {
      const { did } = createAgentDID(db);
      deactivateAgentDID(db, did);
      expect(() => signWithAgent(db, did, "x")).toThrow(/not active/);
    });

    it("verify returns false for unknown DID (no throw)", () => {
      expect(verifyWithAgent(db, "did:chainless:ghost", "x", "aa")).toBe(false);
    });
  });

  describe("federated registry", () => {
    it("registers, heartbeats, and discovers by capability", () => {
      const a = createAgentDID(db).did;
      const b = createAgentDID(db).did;
      registerAgent(db, {
        did: a,
        orgId: "org-1",
        capabilities: ["nlp", "vision"],
      });
      registerAgent(db, {
        did: b,
        orgId: "org-2",
        capabilities: ["nlp"],
      });
      const all = discoverAgents(db);
      expect(all).toHaveLength(2);
      const visionAgents = discoverAgents(db, { capability: "vision" });
      expect(visionAgents).toHaveLength(1);
      expect(visionAgents[0].agentDid).toBe(a);
      const org1 = discoverAgents(db, { orgId: "org-1" });
      expect(org1).toHaveLength(1);
    });

    it("re-registers by updating existing row (no duplicate)", () => {
      const { did } = createAgentDID(db);
      registerAgent(db, { did, orgId: "org-1", capabilities: ["nlp"] });
      registerAgent(db, { did, orgId: "org-2", capabilities: ["vision"] });
      const rows = discoverAgents(db, { orgId: "org-2" });
      expect(rows).toHaveLength(1);
      expect(rows[0].capabilities).toEqual(["vision"]);
    });

    it("rejects register for unknown DID", () => {
      expect(() =>
        registerAgent(db, { did: "did:chainless:ghost", orgId: "org-1" }),
      ).toThrow(/Unknown agent DID/);
    });

    it("unregister removes the agent", () => {
      const { did } = createAgentDID(db);
      registerAgent(db, { did, orgId: "org-1" });
      unregisterAgent(db, did);
      expect(discoverAgents(db)).toHaveLength(0);
    });

    it("heartbeat updates last_heartbeat & flips offline→online", () => {
      const { did } = createAgentDID(db);
      registerAgent(db, { did, orgId: "org-1" });
      // artificially age the heartbeat
      const now0 = Date.now();
      sweepStaleAgents(db, now0 + 10 * 60_000);
      expect(discoverAgents(db, { status: REG_STATUS.OFFLINE })).toHaveLength(
        1,
      );
      const hb = heartbeatAgent(db, did);
      expect(hb.changed).toBe(true);
      expect(discoverAgents(db, { status: REG_STATUS.ONLINE })).toHaveLength(1);
    });

    it("sweepStaleAgents ignores already-offline rows", () => {
      const { did } = createAgentDID(db);
      registerAgent(db, { did, orgId: "org-1" });
      sweepStaleAgents(db, Date.now() + 10 * 60_000);
      const res = sweepStaleAgents(db, Date.now() + 20 * 60_000);
      expect(res.swept).toBe(0);
    });
  });

  describe("Kademlia peers", () => {
    it("adds peer with computed k-bucket", () => {
      const r = addPeer(db, { peerId: "peer-xyz", endpoint: "tcp://1.2.3.4" });
      expect(r.kBucket).toBeGreaterThanOrEqual(0);
      expect(r.kBucket).toBeLessThan(KADEMLIA_BITS);
    });

    it("listPeers returns all and filters by bucket", () => {
      addPeer(db, { peerId: "p1" });
      addPeer(db, { peerId: "p2" });
      const all = listPeers(db);
      expect(all).toHaveLength(2);
      const bucket = all[0].kBucket;
      const filtered = listPeers(db, { kBucket: bucket });
      expect(filtered.length).toBeGreaterThanOrEqual(1);
    });

    it("addPeer re-adding same id updates last_seen, not duplicate", () => {
      addPeer(db, { peerId: "p1", endpoint: "a" });
      addPeer(db, { peerId: "p1", endpoint: "b" });
      const rows = listPeers(db);
      expect(rows).toHaveLength(1);
      expect(rows[0].endpoint).toBe("b");
    });

    it("removePeer deletes the peer", () => {
      addPeer(db, { peerId: "p1" });
      removePeer(db, "p1");
      expect(listPeers(db)).toHaveLength(0);
    });
  });

  describe("challenge-response auth", () => {
    it("startAuth + completeAuth yields an ACTIVE session", () => {
      const { did } = createAgentDID(db);
      const { sessionId, challenge } = startAuth(db, did);
      const sig = signWithAgent(db, did, challenge);
      const { token } = completeAuth(db, sessionId, sig);
      const session = validateSession(db, token);
      expect(session).toBeTruthy();
      expect(session.agentDid).toBe(did);
    });

    it("rejects a bad signature", () => {
      const { did } = createAgentDID(db);
      const { sessionId } = startAuth(db, did);
      expect(() => completeAuth(db, sessionId, "00".repeat(64))).toThrow(
        /verification failed/,
      );
    });

    it("rejects re-completion of an already-ACTIVE session", () => {
      const { did } = createAgentDID(db);
      const { sessionId, challenge } = startAuth(db, did);
      const sig = signWithAgent(db, did, challenge);
      completeAuth(db, sessionId, sig);
      expect(() => completeAuth(db, sessionId, sig)).toThrow(/not in PENDING/);
    });

    it("validateSession returns null for unknown token", () => {
      expect(validateSession(db, "unknown-token")).toBeNull();
    });

    it("listSessions filters by agentDid/status", () => {
      const a = createAgentDID(db).did;
      const b = createAgentDID(db).did;
      startAuth(db, a);
      startAuth(db, b);
      const forA = listSessions(db, { agentDid: a });
      expect(forA).toHaveLength(1);
      const pending = listSessions(db, { status: AUTH_STATUS.PENDING });
      expect(pending).toHaveLength(2);
    });
  });

  describe("credentials (W3C VC)", () => {
    it("issues & verifies a credential with Ed25519 proof", () => {
      const issuer = createAgentDID(db).did;
      const subject = createAgentDID(db).did;
      const vc = issueCredential(db, {
        issuerDid: issuer,
        subjectDid: subject,
        type: "DeveloperCredential",
        claims: { level: "senior", since: 2024 },
      });
      expect(vc.id).toMatch(/^vc:/);
      expect(vc.proof).toMatch(/^[0-9a-f]+$/);
      const res = verifyCredential(db, vc.id);
      expect(res.valid).toBe(true);
      expect(res.credential.claims.level).toBe("senior");
    });

    it("revokeCredential → verify returns revoked", () => {
      const issuer = createAgentDID(db).did;
      const subject = createAgentDID(db).did;
      const vc = issueCredential(db, {
        issuerDid: issuer,
        subjectDid: subject,
        claims: {},
      });
      revokeCredential(db, vc.id);
      const r = verifyCredential(db, vc.id);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe("revoked");
    });

    it("expired credential fails verification", () => {
      const issuer = createAgentDID(db).did;
      const subject = createAgentDID(db).did;
      const vc = issueCredential(db, {
        issuerDid: issuer,
        subjectDid: subject,
        claims: {},
        expiresAt: Date.now() - 1,
      });
      const r = verifyCredential(db, vc.id);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe("expired");
    });

    it("listCredentials filters by subject & issuer", () => {
      const issuer = createAgentDID(db).did;
      const s1 = createAgentDID(db).did;
      const s2 = createAgentDID(db).did;
      issueCredential(db, { issuerDid: issuer, subjectDid: s1, claims: {} });
      issueCredential(db, { issuerDid: issuer, subjectDid: s2, claims: {} });
      expect(listCredentials(db, { subjectDid: s1 })).toHaveLength(1);
      expect(listCredentials(db, { issuerDid: issuer })).toHaveLength(2);
    });

    it("rejects issue with unknown issuer", () => {
      const subject = createAgentDID(db).did;
      expect(() =>
        issueCredential(db, {
          issuerDid: "did:chainless:ghost",
          subjectDid: subject,
          claims: {},
        }),
      ).toThrow(/Unknown issuer/);
    });

    it("rejects issue with deactivated issuer", () => {
      const issuer = createAgentDID(db).did;
      const subject = createAgentDID(db).did;
      deactivateAgentDID(db, issuer);
      expect(() =>
        issueCredential(db, {
          issuerDid: issuer,
          subjectDid: subject,
          claims: {},
        }),
      ).toThrow(/not active/);
    });

    it("verifyCredential returns not-found for unknown id", () => {
      const r = verifyCredential(db, "vc:does-not-exist");
      expect(r.valid).toBe(false);
      expect(r.reason).toBe("not-found");
    });
  });

  describe("cross-org task routing", () => {
    it("routes task to highest-reputation matching agent", () => {
      const a = createAgentDID(db).did;
      const b = createAgentDID(db).did;
      registerAgent(db, { did: a, orgId: "org-x", capabilities: ["nlp"] });
      registerAgent(db, { did: b, orgId: "org-x", capabilities: ["nlp"] });
      // boost b's reliability so it should be picked
      updateReputation(db, {
        agentDid: b,
        dimension: "reliability",
        score: 5,
      });
      updateReputation(db, {
        agentDid: b,
        dimension: "quality",
        score: 5,
      });
      const r = routeTask(db, {
        sourceOrg: "org-y",
        targetOrg: "org-x",
        taskType: "parse",
        requirements: { capability: "nlp" },
      });
      expect(r.agentDid).toBe(b);
      expect(r.status).toBe(TASK_STATUS.ROUTED);
    });

    it("falls back to PENDING when no candidate available", () => {
      const r = routeTask(db, {
        sourceOrg: "org-y",
        taskType: "parse",
        requirements: { capability: "nlp" },
      });
      expect(r.agentDid).toBeNull();
      expect(r.status).toBe(TASK_STATUS.PENDING);
    });

    it("getTask returns parsed payload/requirements", () => {
      const a = createAgentDID(db).did;
      registerAgent(db, { did: a, orgId: "o", capabilities: ["x"] });
      const r = routeTask(db, {
        sourceOrg: "o",
        taskType: "t",
        payload: { input: "hi" },
        requirements: { capability: "x" },
      });
      const t = getTask(db, r.taskId);
      expect(t.payload).toEqual({ input: "hi" });
      expect(t.requirements.capability).toBe("x");
    });

    it("updateTaskStatus marks completedAt on terminal states only", () => {
      const a = createAgentDID(db).did;
      registerAgent(db, { did: a, orgId: "o", capabilities: ["x"] });
      const { taskId } = routeTask(db, {
        sourceOrg: "o",
        taskType: "t",
        requirements: { capability: "x" },
      });
      updateTaskStatus(db, taskId, TASK_STATUS.RUNNING);
      expect(getTask(db, taskId).completedAt).toBeNull();
      updateTaskStatus(db, taskId, TASK_STATUS.COMPLETED, { ok: true });
      expect(getTask(db, taskId).completedAt).toBeTruthy();
      expect(getTask(db, taskId).result).toEqual({ ok: true });
    });

    it("cancelTask marks CANCELLED", () => {
      const a = createAgentDID(db).did;
      registerAgent(db, { did: a, orgId: "o", capabilities: ["x"] });
      const { taskId } = routeTask(db, {
        sourceOrg: "o",
        taskType: "t",
        requirements: { capability: "x" },
      });
      cancelTask(db, taskId, "user-aborted");
      const t = getTask(db, taskId);
      expect(t.status).toBe(TASK_STATUS.CANCELLED);
      expect(t.result.reason).toBe("user-aborted");
    });

    it("listTasks filters by orgId/agentDid/status", () => {
      const a = createAgentDID(db).did;
      registerAgent(db, { did: a, orgId: "o", capabilities: ["x"] });
      routeTask(db, {
        sourceOrg: "o",
        taskType: "t",
        requirements: { capability: "x" },
      });
      routeTask(db, {
        sourceOrg: "o",
        taskType: "t",
        requirements: { capability: "missing" },
      });
      const routed = listTasks(db, { status: TASK_STATUS.ROUTED });
      const pending = listTasks(db, { status: TASK_STATUS.PENDING });
      expect(routed).toHaveLength(1);
      expect(pending).toHaveLength(1);
      const byAgent = listTasks(db, { agentDid: a });
      expect(byAgent).toHaveLength(1);
    });
  });

  describe("reputation", () => {
    it("rejects invalid dimension", () => {
      const { did } = createAgentDID(db);
      expect(() =>
        updateReputation(db, {
          agentDid: did,
          dimension: "invalid",
          score: 4,
        }),
      ).toThrow(/Invalid dimension/);
    });

    it("clamps score to [0, 5]", () => {
      const { did } = createAgentDID(db);
      const r1 = updateReputation(db, {
        agentDid: did,
        dimension: "quality",
        score: 99,
      });
      const r2 = updateReputation(db, {
        agentDid: did,
        dimension: "quality",
        score: -1,
      });
      expect(r1.score).toBe(5);
      expect(r2.score).toBe(0);
    });

    it("default reputation (no samples) is 2.5 with empty dims", () => {
      const { did } = createAgentDID(db);
      const r = getReputation(db, did);
      expect(r.total).toBe(2.5);
      expect(r.samples).toBe(0);
      expect(r.dimensions).toEqual({});
    });

    it("computes weighted total across dimensions", () => {
      const { did } = createAgentDID(db);
      updateReputation(db, {
        agentDid: did,
        dimension: "reliability",
        score: 4,
      });
      updateReputation(db, { agentDid: did, dimension: "quality", score: 4 });
      updateReputation(db, { agentDid: did, dimension: "speed", score: 4 });
      updateReputation(db, {
        agentDid: did,
        dimension: "cooperation",
        score: 4,
      });
      const r = getReputation(db, did);
      expect(r.total).toBeCloseTo(4, 5);
      expect(r.samples).toBe(4);
      expect(Object.keys(r.dimensions).sort()).toEqual([
        "cooperation",
        "quality",
        "reliability",
        "speed",
      ]);
    });

    it("history returns newest-first", () => {
      const { did } = createAgentDID(db);
      updateReputation(db, { agentDid: did, dimension: "quality", score: 3 });
      updateReputation(db, { agentDid: did, dimension: "quality", score: 5 });
      const hist = getReputationHistory(db, did);
      expect(hist).toHaveLength(2);
      expect(hist[0].score).toBe(5);
    });

    it("getTopAgents ranks across the pool", () => {
      const a = createAgentDID(db).did;
      const b = createAgentDID(db).did;
      registerAgent(db, { did: a, orgId: "o" });
      registerAgent(db, { did: b, orgId: "o" });
      updateReputation(db, { agentDid: a, dimension: "quality", score: 4 });
      updateReputation(db, { agentDid: b, dimension: "quality", score: 2 });
      const top = getTopAgents(db, { dimension: "quality", limit: 2 });
      expect(top[0].agentDid).toBe(a);
      expect(top[1].agentDid).toBe(b);
    });

    it("getTopAgents with no dimension uses total", () => {
      const a = createAgentDID(db).did;
      updateReputation(db, { agentDid: a, dimension: "quality", score: 5 });
      const top = getTopAgents(db, { limit: 5 });
      expect(top[0].agentDid).toBe(a);
      expect(top[0].score).toBeGreaterThan(2.5);
    });
  });

  describe("network stats", () => {
    it("aggregates counts across all tables", () => {
      const a = createAgentDID(db).did;
      const b = createAgentDID(db).did;
      registerAgent(db, { did: a, orgId: "o", capabilities: ["x"] });
      addPeer(db, { peerId: "p1" });
      startAuth(db, a);
      issueCredential(db, {
        issuerDid: a,
        subjectDid: b,
        claims: { foo: "bar" },
      });
      routeTask(db, {
        sourceOrg: "o",
        taskType: "t",
        requirements: { capability: "x" },
      });
      const s = getNetworkStats(db);
      expect(s.dids.active).toBe(2);
      expect(s.registry.online).toBe(1);
      expect(s.tasks.routed).toBe(1);
      expect(s.credentials.active).toBe(1);
      expect(s.sessions.pending).toBe(1);
      expect(s.peers).toBe(1);
    });
  });
});
