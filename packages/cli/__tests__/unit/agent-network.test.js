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

import {
  AGENT_MATURITY_V2,
  TASK_LIFECYCLE_V2,
  AGENT_DEFAULT_MAX_ACTIVE_PER_NETWORK,
  AGENT_DEFAULT_MAX_PENDING_TASKS_PER_AGENT,
  AGENT_DEFAULT_AGENT_IDLE_MS,
  AGENT_DEFAULT_TASK_STUCK_MS,
  getMaxActiveAgentsPerNetworkV2,
  setMaxActiveAgentsPerNetworkV2,
  getMaxPendingTasksPerAgentV2,
  setMaxPendingTasksPerAgentV2,
  getAgentIdleMsV2,
  setAgentIdleMsV2,
  getTaskStuckMsV2,
  setTaskStuckMsV2,
  registerAgentV2,
  getAgentV2,
  listAgentsV2,
  setAgentStatusV2,
  activateAgentV2,
  suspendAgentV2,
  revokeAgentV2,
  touchAgentV2,
  createTaskV2,
  getTaskV2,
  listTasksV2,
  setTaskStatusV2,
  startTaskV2,
  completeTaskV2,
  failTaskV2,
  cancelTaskV2,
  getActiveAgentCountV2,
  getPendingTaskCountV2,
  autoSuspendIdleAgentsV2,
  autoFailStuckTasksV2,
  getAgentNetworkStatsV2,
  _resetStateAgentNetworkV2,
} from "../../src/lib/agent-network.js";

describe("Agent Network V2", () => {
  beforeEach(() => _resetStateAgentNetworkV2());

  describe("frozen enums + defaults", () => {
    it("freezes AGENT_MATURITY_V2", () => {
      expect(Object.isFrozen(AGENT_MATURITY_V2)).toBe(true);
      expect(Object.values(AGENT_MATURITY_V2).sort()).toEqual([
        "active",
        "pending",
        "revoked",
        "suspended",
      ]);
    });
    it("freezes TASK_LIFECYCLE_V2", () => {
      expect(Object.isFrozen(TASK_LIFECYCLE_V2)).toBe(true);
      expect(Object.values(TASK_LIFECYCLE_V2).sort()).toEqual([
        "cancelled",
        "completed",
        "failed",
        "queued",
        "running",
      ]);
    });
    it("exposes defaults", () => {
      expect(AGENT_DEFAULT_MAX_ACTIVE_PER_NETWORK).toBe(50);
      expect(AGENT_DEFAULT_MAX_PENDING_TASKS_PER_AGENT).toBe(10);
      expect(AGENT_DEFAULT_AGENT_IDLE_MS).toBe(7 * 24 * 60 * 60 * 1000);
      expect(AGENT_DEFAULT_TASK_STUCK_MS).toBe(30 * 60 * 1000);
    });
  });

  describe("config getters/setters", () => {
    it("returns defaults", () => {
      expect(getMaxActiveAgentsPerNetworkV2()).toBe(50);
      expect(getMaxPendingTasksPerAgentV2()).toBe(10);
      expect(getAgentIdleMsV2()).toBe(AGENT_DEFAULT_AGENT_IDLE_MS);
      expect(getTaskStuckMsV2()).toBe(AGENT_DEFAULT_TASK_STUCK_MS);
    });
    it("setters accept positives", () => {
      setMaxActiveAgentsPerNetworkV2(7);
      setMaxPendingTasksPerAgentV2(3);
      setAgentIdleMsV2(60_000);
      setTaskStuckMsV2(5_000);
      expect(getMaxActiveAgentsPerNetworkV2()).toBe(7);
      expect(getMaxPendingTasksPerAgentV2()).toBe(3);
      expect(getAgentIdleMsV2()).toBe(60_000);
      expect(getTaskStuckMsV2()).toBe(5_000);
    });
    it("setters floor non-integer positives", () => {
      setMaxActiveAgentsPerNetworkV2(2.7);
      expect(getMaxActiveAgentsPerNetworkV2()).toBe(2);
    });
    it("setters reject zero/negative/non-finite", () => {
      expect(() => setMaxActiveAgentsPerNetworkV2(0)).toThrow();
      expect(() => setMaxPendingTasksPerAgentV2(-1)).toThrow();
      expect(() => setAgentIdleMsV2(NaN)).toThrow();
      expect(() => setTaskStuckMsV2("x")).toThrow();
    });
  });

  describe("registerAgentV2", () => {
    it("registers PENDING with required fields", () => {
      const a = registerAgentV2("a1", {
        networkId: "n1",
        did: "did:key:z1",
        displayName: "Alice",
      });
      expect(a.status).toBe("pending");
      expect(a.networkId).toBe("n1");
      expect(a.did).toBe("did:key:z1");
      expect(a.displayName).toBe("Alice");
      expect(a.activatedAt).toBeNull();
      expect(a.revokedAt).toBeNull();
    });
    it("defaults displayName to id", () => {
      const a = registerAgentV2("a1", { networkId: "n1", did: "did:k:1" });
      expect(a.displayName).toBe("a1");
    });
    it("rejects duplicate id", () => {
      registerAgentV2("a1", { networkId: "n1", did: "did:k:1" });
      expect(() =>
        registerAgentV2("a1", { networkId: "n1", did: "did:k:2" }),
      ).toThrow(/already exists/);
    });
    it("rejects missing required", () => {
      expect(() => registerAgentV2("a1")).toThrow(/networkId/);
      expect(() => registerAgentV2("a1", { networkId: "n1" })).toThrow(/did/);
      expect(() => registerAgentV2("", { networkId: "n1", did: "x" })).toThrow(
        /agent id/,
      );
    });
    it("metadata defaults to {} and is copied", () => {
      const meta = { v: 1 };
      const a = registerAgentV2("a1", {
        networkId: "n1",
        did: "did:k:1",
        metadata: meta,
      });
      expect(a.metadata).toEqual({ v: 1 });
      meta.v = 99;
      expect(getAgentV2("a1").metadata.v).toBe(1);
    });
  });

  describe("agent state machine", () => {
    beforeEach(() => {
      registerAgentV2("a1", { networkId: "n1", did: "did:k:1" });
    });
    it("pending→active stamps activatedAt", () => {
      const a = activateAgentV2("a1");
      expect(a.status).toBe("active");
      expect(a.activatedAt).toBeGreaterThan(0);
    });
    it("active→suspended→active preserves activatedAt", () => {
      const a1 = activateAgentV2("a1");
      const ts = a1.activatedAt;
      suspendAgentV2("a1");
      const a3 = activateAgentV2("a1");
      expect(a3.activatedAt).toBe(ts);
    });
    it("revoked terminal", () => {
      activateAgentV2("a1");
      revokeAgentV2("a1");
      expect(() => activateAgentV2("a1")).toThrow(/invalid agent transition/);
    });
    it("revokedAt stamped on first terminal entry", () => {
      activateAgentV2("a1");
      const a = revokeAgentV2("a1");
      expect(a.revokedAt).toBeGreaterThan(0);
    });
    it("rejects pending→suspended", () => {
      expect(() => suspendAgentV2("a1")).toThrow(/invalid agent transition/);
    });
    it("rejects unknown agent", () => {
      expect(() => activateAgentV2("nope")).toThrow(/not found/);
    });
  });

  describe("per-network active-agent cap", () => {
    it("rejects pending→active beyond cap", () => {
      setMaxActiveAgentsPerNetworkV2(2);
      registerAgentV2("a1", { networkId: "n1", did: "d1" });
      registerAgentV2("a2", { networkId: "n1", did: "d2" });
      registerAgentV2("a3", { networkId: "n1", did: "d3" });
      activateAgentV2("a1");
      activateAgentV2("a2");
      expect(() => activateAgentV2("a3")).toThrow(/active-agent cap/);
    });
    it("recovery is exempt from cap", () => {
      setMaxActiveAgentsPerNetworkV2(1);
      registerAgentV2("a1", { networkId: "n1", did: "d1" });
      registerAgentV2("a2", { networkId: "n1", did: "d2" });
      activateAgentV2("a1");
      // suspend a1, activate a2 fills cap
      suspendAgentV2("a1");
      activateAgentV2("a2");
      // recover a1 even though a2 already at cap (recovery exempt)
      const a = activateAgentV2("a1");
      expect(a.status).toBe("active");
      expect(getActiveAgentCountV2("n1")).toBe(2);
    });
    it("scoped by network", () => {
      setMaxActiveAgentsPerNetworkV2(1);
      registerAgentV2("a1", { networkId: "n1", did: "d1" });
      registerAgentV2("a2", { networkId: "n2", did: "d2" });
      activateAgentV2("a1");
      const a2 = activateAgentV2("a2");
      expect(a2.status).toBe("active");
    });
  });

  describe("listAgentsV2", () => {
    it("filters by network and status", () => {
      registerAgentV2("a1", { networkId: "n1", did: "d1" });
      registerAgentV2("a2", { networkId: "n1", did: "d2" });
      registerAgentV2("a3", { networkId: "n2", did: "d3" });
      activateAgentV2("a1");
      expect(listAgentsV2({ networkId: "n1" })).toHaveLength(2);
      expect(listAgentsV2({ networkId: "n1", status: "active" })).toHaveLength(
        1,
      );
      expect(listAgentsV2({ status: "pending" })).toHaveLength(2);
    });
  });

  describe("touchAgentV2", () => {
    it("updates lastSeenAt", async () => {
      registerAgentV2("a1", { networkId: "n1", did: "d1" });
      const before = getAgentV2("a1").lastSeenAt;
      await new Promise((r) => setTimeout(r, 5));
      const a = touchAgentV2("a1");
      expect(a.lastSeenAt).toBeGreaterThan(before);
    });
    it("throws on unknown id", () => {
      expect(() => touchAgentV2("nope")).toThrow(/not found/);
    });
  });

  describe("createTaskV2", () => {
    beforeEach(() => {
      registerAgentV2("a1", { networkId: "n1", did: "d1" });
    });
    it("creates QUEUED with required fields", () => {
      const t = createTaskV2("t1", { agentId: "a1", kind: "summarize" });
      expect(t.status).toBe("queued");
      expect(t.agentId).toBe("a1");
      expect(t.kind).toBe("summarize");
      expect(t.startedAt).toBeNull();
      expect(t.settledAt).toBeNull();
    });
    it("defaults kind to invoke", () => {
      const t = createTaskV2("t1", { agentId: "a1" });
      expect(t.kind).toBe("invoke");
    });
    it("rejects duplicate id", () => {
      createTaskV2("t1", { agentId: "a1" });
      expect(() => createTaskV2("t1", { agentId: "a1" })).toThrow(
        /already exists/,
      );
    });
    it("rejects unknown agent", () => {
      expect(() => createTaskV2("t1", { agentId: "ghost" })).toThrow(
        /agent ghost not found/,
      );
    });
    it("rejects missing required", () => {
      expect(() => createTaskV2("t1")).toThrow(/agentId/);
      expect(() => createTaskV2("", { agentId: "a1" })).toThrow(/task id/);
    });
    it("enforces per-agent pending cap on create (counts queued+running)", () => {
      setMaxPendingTasksPerAgentV2(2);
      createTaskV2("t1", { agentId: "a1" });
      createTaskV2("t2", { agentId: "a1" });
      // 2 queued — at cap
      expect(() => createTaskV2("t3", { agentId: "a1" })).toThrow(
        /pending-task cap/,
      );
      // start one, still 2 pending (1 queued + 1 running)
      startTaskV2("t1");
      expect(() => createTaskV2("t3", { agentId: "a1" })).toThrow(
        /pending-task cap/,
      );
      // complete the running one, now 1 pending — accept
      completeTaskV2("t1");
      const t3 = createTaskV2("t3", { agentId: "a1" });
      expect(t3.status).toBe("queued");
    });
  });

  describe("task state machine", () => {
    beforeEach(() => {
      registerAgentV2("a1", { networkId: "n1", did: "d1" });
      createTaskV2("t1", { agentId: "a1" });
    });
    it("queued→running stamps startedAt", () => {
      const t = startTaskV2("t1");
      expect(t.status).toBe("running");
      expect(t.startedAt).toBeGreaterThan(0);
    });
    it("running→completed stamps settledAt", () => {
      startTaskV2("t1");
      const t = completeTaskV2("t1");
      expect(t.status).toBe("completed");
      expect(t.settledAt).toBeGreaterThan(0);
    });
    it("running→failed stamps settledAt", () => {
      startTaskV2("t1");
      const t = failTaskV2("t1");
      expect(t.status).toBe("failed");
      expect(t.settledAt).toBeGreaterThan(0);
    });
    it("queued→cancelled and running→cancelled both work", () => {
      cancelTaskV2("t1");
      expect(getTaskV2("t1").status).toBe("cancelled");
      // new task to test running→cancelled
      createTaskV2("t2", { agentId: "a1" });
      startTaskV2("t2");
      cancelTaskV2("t2");
      expect(getTaskV2("t2").status).toBe("cancelled");
    });
    it("rejects invalid transitions", () => {
      expect(() => completeTaskV2("t1")).toThrow(/invalid task transition/);
      cancelTaskV2("t1");
      expect(() => startTaskV2("t1")).toThrow(/invalid task transition/);
    });
    it("rejects unknown task", () => {
      expect(() => startTaskV2("ghost")).toThrow(/not found/);
    });
  });

  describe("listTasksV2", () => {
    it("filters by agent and status", () => {
      registerAgentV2("a1", { networkId: "n1", did: "d1" });
      registerAgentV2("a2", { networkId: "n1", did: "d2" });
      createTaskV2("t1", { agentId: "a1" });
      createTaskV2("t2", { agentId: "a1" });
      createTaskV2("t3", { agentId: "a2" });
      startTaskV2("t1");
      expect(listTasksV2({ agentId: "a1" })).toHaveLength(2);
      expect(listTasksV2({ status: "queued" })).toHaveLength(2);
      expect(listTasksV2({ agentId: "a1", status: "running" })).toHaveLength(1);
    });
  });

  describe("autoSuspendIdleAgentsV2", () => {
    it("flips active agents past idle threshold to suspended", () => {
      setAgentIdleMsV2(1000);
      registerAgentV2("a1", { networkId: "n1", did: "d1" });
      activateAgentV2("a1");
      const future = Date.now() + 5_000;
      const r = autoSuspendIdleAgentsV2({ now: future });
      expect(r.count).toBe(1);
      expect(r.flipped).toEqual(["a1"]);
      expect(getAgentV2("a1").status).toBe("suspended");
    });
    it("does not touch fresh agents", () => {
      registerAgentV2("a1", { networkId: "n1", did: "d1" });
      activateAgentV2("a1");
      const r = autoSuspendIdleAgentsV2({ now: Date.now() });
      expect(r.count).toBe(0);
    });
  });

  describe("autoFailStuckTasksV2", () => {
    it("flips running tasks past stuck threshold to failed", () => {
      setTaskStuckMsV2(1000);
      registerAgentV2("a1", { networkId: "n1", did: "d1" });
      createTaskV2("t1", { agentId: "a1" });
      startTaskV2("t1");
      const future = Date.now() + 5_000;
      const r = autoFailStuckTasksV2({ now: future });
      expect(r.count).toBe(1);
      expect(getTaskV2("t1").status).toBe("failed");
      expect(getTaskV2("t1").settledAt).toBeGreaterThan(0);
    });
    it("ignores queued tasks (no startedAt)", () => {
      registerAgentV2("a1", { networkId: "n1", did: "d1" });
      createTaskV2("t1", { agentId: "a1" });
      const r = autoFailStuckTasksV2({ now: Date.now() + 1e9 });
      expect(r.count).toBe(0);
    });
  });

  describe("getAgentNetworkStatsV2", () => {
    it("zero state has all keys", () => {
      const s = getAgentNetworkStatsV2();
      expect(s.totalAgentsV2).toBe(0);
      expect(s.totalTasksV2).toBe(0);
      expect(s.agentsByStatus).toEqual({
        pending: 0,
        active: 0,
        suspended: 0,
        revoked: 0,
      });
      expect(s.tasksByStatus).toEqual({
        queued: 0,
        running: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
      });
    });
    it("counts after operations", () => {
      registerAgentV2("a1", { networkId: "n1", did: "d1" });
      registerAgentV2("a2", { networkId: "n1", did: "d2" });
      activateAgentV2("a1");
      createTaskV2("t1", { agentId: "a1" });
      startTaskV2("t1");
      createTaskV2("t2", { agentId: "a1" });
      const s = getAgentNetworkStatsV2();
      expect(s.totalAgentsV2).toBe(2);
      expect(s.agentsByStatus.active).toBe(1);
      expect(s.agentsByStatus.pending).toBe(1);
      expect(s.totalTasksV2).toBe(2);
      expect(s.tasksByStatus.running).toBe(1);
      expect(s.tasksByStatus.queued).toBe(1);
    });
  });

  describe("counts", () => {
    it("getActiveAgentCountV2 scoped by network", () => {
      registerAgentV2("a1", { networkId: "n1", did: "d1" });
      registerAgentV2("a2", { networkId: "n2", did: "d2" });
      activateAgentV2("a1");
      activateAgentV2("a2");
      expect(getActiveAgentCountV2("n1")).toBe(1);
      expect(getActiveAgentCountV2("n2")).toBe(1);
      expect(getActiveAgentCountV2("nope")).toBe(0);
    });
    it("getPendingTaskCountV2 counts queued+running", () => {
      registerAgentV2("a1", { networkId: "n1", did: "d1" });
      createTaskV2("t1", { agentId: "a1" });
      createTaskV2("t2", { agentId: "a1" });
      startTaskV2("t1");
      expect(getPendingTaskCountV2("a1")).toBe(2);
      completeTaskV2("t1");
      expect(getPendingTaskCountV2("a1")).toBe(1);
    });
  });

  describe("_resetStateAgentNetworkV2", () => {
    it("clears state and restores defaults", () => {
      setMaxActiveAgentsPerNetworkV2(99);
      registerAgentV2("a1", { networkId: "n1", did: "d1" });
      _resetStateAgentNetworkV2();
      expect(getMaxActiveAgentsPerNetworkV2()).toBe(50);
      expect(getAgentV2("a1")).toBeNull();
      expect(getAgentNetworkStatsV2().totalAgentsV2).toBe(0);
    });
  });
});
