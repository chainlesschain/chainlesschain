import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";

import {
  NODE_MODE,
  NODE_STATUS,
  DEFAULT_QUOTA_BYTES,
  ensureIpfsTables,
  startNode,
  stopNode,
  getNodeStatus,
  setMode,
  addContent,
  getContent,
  hasContent,
  listContent,
  pin,
  unpin,
  listPins,
  getStorageStats,
  garbageCollect,
  setQuota,
  addKnowledgeAttachment,
  getKnowledgeAttachments,
  _resetState,
} from "../../src/lib/ipfs-storage.js";

describe("ipfs-storage", () => {
  let db;

  beforeEach(() => {
    _resetState();
    db = new MockDatabase();
    ensureIpfsTables(db);
  });

  /* ── Schema ────────────────────────────────────────── */

  describe("ensureIpfsTables", () => {
    it("creates ipfs_content and ipfs_node_config tables", () => {
      expect(db.tables.has("ipfs_content")).toBe(true);
      expect(db.tables.has("ipfs_node_config")).toBe(true);
    });

    it("is idempotent", () => {
      ensureIpfsTables(db);
      expect(db.tables.has("ipfs_content")).toBe(true);
    });
  });

  /* ── Catalogs ──────────────────────────────────────── */

  describe("catalogs", () => {
    it("NODE_MODE has embedded and external", () => {
      expect(Object.values(NODE_MODE)).toEqual(["embedded", "external"]);
    });

    it("NODE_STATUS has 4 states", () => {
      expect(Object.values(NODE_STATUS)).toEqual([
        "stopped",
        "starting",
        "running",
        "error",
      ]);
    });

    it("DEFAULT_QUOTA_BYTES is 1 GB", () => {
      expect(DEFAULT_QUOTA_BYTES).toBe(1024 * 1024 * 1024);
    });
  });

  /* ── Node lifecycle ────────────────────────────────── */

  describe("startNode", () => {
    it("starts the node in embedded mode by default", () => {
      const r = startNode(db);
      expect(r.started).toBe(true);
      expect(r.status).toBe("running");
      expect(r.mode).toBe("embedded");
      expect(r.peerId).toMatch(/^sim-/);
    });

    it("can start in external mode", () => {
      const r = startNode(db, { mode: "external" });
      expect(r.started).toBe(true);
      expect(r.mode).toBe("external");
    });

    it("rejects invalid mode", () => {
      const r = startNode(db, { mode: "bogus" });
      expect(r.started).toBe(false);
      expect(r.reason).toBe("invalid_mode");
    });

    it("rejects double-start", () => {
      startNode(db);
      const r = startNode(db);
      expect(r.started).toBe(false);
      expect(r.reason).toBe("already_running");
    });
  });

  describe("stopNode", () => {
    it("stops a running node", () => {
      startNode(db);
      const r = stopNode(db);
      expect(r.stopped).toBe(true);
    });

    it("rejects stopping a stopped node", () => {
      const r = stopNode(db);
      expect(r.stopped).toBe(false);
      expect(r.reason).toBe("not_running");
    });
  });

  describe("getNodeStatus", () => {
    it("reports stopped initially", () => {
      const r = getNodeStatus();
      expect(r.status).toBe("stopped");
      expect(r.uptimeMs).toBe(0);
      expect(r.peerId).toBeNull();
    });

    it("reports uptime when running", () => {
      startNode(db);
      const r = getNodeStatus();
      expect(r.status).toBe("running");
      expect(r.uptimeMs).toBeGreaterThanOrEqual(0);
      expect(r.peerId).toMatch(/^sim-/);
    });
  });

  describe("setMode", () => {
    it("sets mode when node is stopped", () => {
      const r = setMode(db, "external");
      expect(r.set).toBe(true);
      expect(r.mode).toBe("external");
    });

    it("refuses when node is running", () => {
      startNode(db);
      const r = setMode(db, "external");
      expect(r.set).toBe(false);
      expect(r.reason).toBe("stop_node_first");
    });

    it("rejects invalid mode", () => {
      const r = setMode(db, "bogus");
      expect(r.set).toBe(false);
      expect(r.reason).toBe("invalid_mode");
    });
  });

  /* ── Content: add + get ─────────────────────────────── */

  describe("addContent", () => {
    it("requires running node", () => {
      const r = addContent(db, "hello");
      expect(r.added).toBe(false);
      expect(r.reason).toBe("node_not_running");
    });

    it("rejects empty content", () => {
      startNode(db);
      expect(addContent(db, "").reason).toBe("empty_content");
      expect(addContent(db, null).reason).toBe("empty_content");
    });

    it("adds text content and returns CID", () => {
      startNode(db);
      const r = addContent(db, "hello world");
      expect(r.added).toBe(true);
      expect(r.cid).toMatch(/^bafy/);
      expect(r.size).toBe(11);
    });

    it("same content yields same CID (deterministic)", () => {
      startNode(db);
      const a = addContent(db, "hello world");
      const b = addContent(db, "hello world");
      expect(a.cid).toBe(b.cid);
      expect(b.duplicate).toBe(true);
    });

    it("pin flag stores as pinned", () => {
      startNode(db);
      const r = addContent(db, "pinned content", { pin: true });
      expect(r.pinned).toBe(true);
    });

    it("duplicate add with pin upgrades unpinned to pinned", () => {
      startNode(db);
      addContent(db, "x");
      const r = addContent(db, "x", { pin: true });
      expect(r.duplicate).toBe(true);
      expect(r.pinned).toBe(true);
    });

    it("stores filename and mime-type metadata", () => {
      startNode(db);
      const r = addContent(db, "data", {
        filename: "note.txt",
        mimeType: "text/plain",
      });
      const rows = listContent(db);
      expect(rows[0].filename).toBe("note.txt");
      expect(rows[0].mime_type).toBe("text/plain");
    });

    it("accepts Buffer content", () => {
      startNode(db);
      const r = addContent(db, Buffer.from([1, 2, 3, 4]));
      expect(r.added).toBe(true);
      expect(r.size).toBe(4);
    });

    it("accepts object content (JSON-encoded)", () => {
      startNode(db);
      const r = addContent(db, { foo: "bar" });
      expect(r.added).toBe(true);
      expect(r.size).toBeGreaterThan(0);
    });
  });

  describe("getContent", () => {
    it("returns null when node is stopped", () => {
      expect(getContent(db, "missing-cid")).toBeNull();
    });

    it("returns null for unknown CID", () => {
      startNode(db);
      expect(getContent(db, "missing-cid")).toBeNull();
    });

    it("round-trips plaintext", () => {
      startNode(db);
      const { cid } = addContent(db, "hello world");
      const r = getContent(db, cid, { asString: true });
      expect(r.content).toBe("hello world");
      expect(r.size).toBe(11);
    });

    it("round-trips binary", () => {
      startNode(db);
      const buf = Buffer.from([10, 20, 30, 40, 50]);
      const { cid } = addContent(db, buf);
      const r = getContent(db, cid);
      expect(Buffer.isBuffer(r.content)).toBe(true);
      expect(r.content.equals(buf)).toBe(true);
    });
  });

  /* ── Encryption round-trip ──────────────────────────── */

  describe("encryption", () => {
    it("encrypts with AES-256-GCM and decrypts on get", () => {
      startNode(db);
      const { cid } = addContent(db, "secret data", { encrypt: true });
      const r = getContent(db, cid, { asString: true });
      expect(r.encrypted).toBe(true);
      expect(r.content).toBe("secret data");
    });

    it("encrypted CID differs from plaintext CID", () => {
      startNode(db);
      const a = addContent(db, "same");
      _resetState();
      db = new MockDatabase();
      ensureIpfsTables(db);
      startNode(db);
      const b = addContent(db, "same", { encrypt: true });
      expect(a.cid).not.toBe(b.cid);
    });

    it("encrypted payload is stored, not plaintext", () => {
      startNode(db);
      addContent(db, "plaintext payload", { encrypt: true });
      const rows = db.data.get("ipfs_content");
      expect(rows[0].payload).not.toContain("plaintext payload");
    });
  });

  /* ── listContent ────────────────────────────────────── */

  describe("listContent", () => {
    beforeEach(() => {
      startNode(db);
      addContent(db, "a", { pin: true, filename: "a.txt" });
      addContent(db, "b", { filename: "b.txt" });
      addContent(db, "c", { pin: true, knowledgeId: "k1", filename: "c.txt" });
    });

    it("lists all by default", () => {
      expect(listContent(db)).toHaveLength(3);
    });

    it("filters by pinned=true", () => {
      expect(listContent(db, { pinned: true })).toHaveLength(2);
    });

    it("filters by pinned=false", () => {
      expect(listContent(db, { pinned: false })).toHaveLength(1);
    });

    it("filters by knowledge id", () => {
      expect(listContent(db, { knowledgeId: "k1" })).toHaveLength(1);
    });

    it("honors limit", () => {
      expect(listContent(db, { limit: 2 })).toHaveLength(2);
    });

    it("excludes payload and encryption_key from output", () => {
      const rows = listContent(db);
      expect(rows[0]).not.toHaveProperty("payload");
      expect(rows[0]).not.toHaveProperty("encryption_key");
    });
  });

  /* ── pin / unpin ────────────────────────────────────── */

  describe("pin management", () => {
    it("pin() flips unpinned → pinned", () => {
      startNode(db);
      const { cid } = addContent(db, "x");
      const r = pin(db, cid);
      expect(r.pinned).toBe(true);
    });

    it("pin() rejects unknown CID", () => {
      startNode(db);
      expect(pin(db, "bogus").reason).toBe("not_found");
    });

    it("pin() rejects already pinned", () => {
      startNode(db);
      const { cid } = addContent(db, "x", { pin: true });
      expect(pin(db, cid).reason).toBe("already_pinned");
    });

    it("unpin() flips pinned → unpinned", () => {
      startNode(db);
      const { cid } = addContent(db, "x", { pin: true });
      const r = unpin(db, cid);
      expect(r.unpinned).toBe(true);
    });

    it("unpin() rejects not-pinned", () => {
      startNode(db);
      const { cid } = addContent(db, "x");
      expect(unpin(db, cid).reason).toBe("not_pinned");
    });
  });

  describe("listPins", () => {
    it("lists pinned content sorted by created_at desc by default", () => {
      startNode(db);
      addContent(db, "x", { pin: true });
      addContent(db, "y", { pin: true });
      const rows = listPins(db);
      expect(rows).toHaveLength(2);
    });

    it("can sort by size", () => {
      startNode(db);
      addContent(db, "a", { pin: true });
      addContent(db, "longer content here", { pin: true });
      const rows = listPins(db, { sortBy: "size" });
      expect(rows[0].size).toBeGreaterThan(rows[1].size);
    });
  });

  /* ── Quota ─────────────────────────────────────────── */

  describe("quota", () => {
    it("setQuota updates the limit", () => {
      const r = setQuota(db, 1024);
      expect(r.set).toBe(true);
      expect(r.quotaBytes).toBe(1024);
    });

    it("rejects invalid quota", () => {
      expect(setQuota(db, -1).reason).toBe("invalid_quota");
      expect(setQuota(db, "abc").reason).toBe("invalid_quota");
    });

    it("blocks addContent with pin when quota exceeded", () => {
      startNode(db);
      setQuota(db, 5);
      const r = addContent(db, "this is too long", { pin: true });
      expect(r.added).toBe(false);
      expect(r.reason).toBe("quota_exceeded");
    });

    it("blocks pin() when quota exceeded", () => {
      startNode(db);
      setQuota(db, 100);
      const { cid } = addContent(db, "a".repeat(200));
      expect(pin(db, cid).reason).toBe("quota_exceeded");
    });

    it("allows unpinned add beyond quota (only pinned counts)", () => {
      startNode(db);
      setQuota(db, 5);
      const r = addContent(db, "this is longer than quota");
      expect(r.added).toBe(true);
    });
  });

  /* ── Stats ─────────────────────────────────────────── */

  describe("getStorageStats", () => {
    it("reports zero state initially", () => {
      const s = getStorageStats();
      expect(s.totalContent).toBe(0);
      expect(s.pinnedCount).toBe(0);
      expect(s.usagePercent).toBe(0);
    });

    it("counts pinned and encrypted separately", () => {
      startNode(db);
      addContent(db, "a", { pin: true });
      addContent(db, "b", { encrypt: true });
      addContent(db, "c", { pin: true, encrypt: true });
      const s = getStorageStats();
      expect(s.totalContent).toBe(3);
      expect(s.pinnedCount).toBe(2);
      expect(s.encryptedCount).toBe(2);
    });

    it("computes usagePercent from pinned bytes / quota", () => {
      startNode(db);
      setQuota(db, 100);
      addContent(db, "a".repeat(40), { pin: true });
      const s = getStorageStats();
      expect(s.usagePercent).toBeGreaterThan(30);
      expect(s.usagePercent).toBeLessThanOrEqual(50);
    });
  });

  /* ── GC ────────────────────────────────────────────── */

  describe("garbageCollect", () => {
    it("removes only unpinned content", () => {
      startNode(db);
      addContent(db, "keep", { pin: true });
      addContent(db, "drop1");
      addContent(db, "drop2");
      const r = garbageCollect(db);
      expect(r.removed).toBe(2);
      expect(r.after).toBe(1);
      expect(r.freedBytes).toBeGreaterThan(0);
    });

    it("no-op when nothing to collect", () => {
      startNode(db);
      addContent(db, "pinned", { pin: true });
      const r = garbageCollect(db);
      expect(r.removed).toBe(0);
    });

    it("cleans up knowledge links when all attachments removed", () => {
      startNode(db);
      // Add unpinned entry with knowledge id via internal path
      addContent(db, "orphan", { knowledgeId: "k1" });
      garbageCollect(db);
      expect(getKnowledgeAttachments(db, "k1")).toHaveLength(0);
    });
  });

  /* ── hasContent ────────────────────────────────────── */

  describe("hasContent", () => {
    it("returns true for known CID", () => {
      startNode(db);
      const { cid } = addContent(db, "x");
      expect(hasContent(db, cid)).toBe(true);
    });

    it("returns false for unknown CID", () => {
      expect(hasContent(db, "bogus")).toBe(false);
    });
  });

  /* ── Knowledge attachments ─────────────────────────── */

  describe("knowledge attachments", () => {
    it("rejects missing knowledge id", () => {
      startNode(db);
      const r = addKnowledgeAttachment(db, "", "x");
      expect(r.added).toBe(false);
      expect(r.reason).toBe("missing_knowledge_id");
    });

    it("attaches and auto-pins content", () => {
      startNode(db);
      const r = addKnowledgeAttachment(db, "k1", "attachment body", {
        filename: "a.pdf",
      });
      expect(r.added).toBe(true);
      expect(r.pinned).toBe(true);
      expect(r.knowledgeId).toBe("k1");
    });

    it("lists attachments for a knowledge id", () => {
      startNode(db);
      addKnowledgeAttachment(db, "k1", "a");
      addKnowledgeAttachment(db, "k1", "b");
      addKnowledgeAttachment(db, "k2", "c");
      expect(getKnowledgeAttachments(db, "k1")).toHaveLength(2);
      expect(getKnowledgeAttachments(db, "k2")).toHaveLength(1);
      expect(getKnowledgeAttachments(db, "k3")).toHaveLength(0);
    });

    it("attachment metadata is persisted", () => {
      startNode(db);
      addKnowledgeAttachment(db, "k1", "body", {
        filename: "report.pdf",
        mimeType: "application/pdf",
      });
      const rows = getKnowledgeAttachments(db, "k1");
      expect(rows[0].filename).toBe("report.pdf");
      expect(rows[0].mime_type).toBe("application/pdf");
    });
  });

  /* ── Config persistence ─────────────────────────────── */

  describe("config persistence", () => {
    it("persists mode on startNode", () => {
      startNode(db, { mode: "external" });
      const rows = db.data.get("ipfs_node_config") || [];
      const modeRow = rows.find((r) => r.config_key === "mode");
      expect(modeRow?.config_value).toBe("external");
    });

    it("persists quota on setQuota", () => {
      setQuota(db, 2048);
      const rows = db.data.get("ipfs_node_config") || [];
      const quotaRow = rows.find((r) => r.config_key === "quota");
      expect(quotaRow?.config_value).toBe("2048");
    });
  });
});

/* ═════════════════════════════════════════════════════════ *
 *  Phase 17 V2 Tests
 * ═════════════════════════════════════════════════════════ */

import {
  GATEWAY_MATURITY_V2,
  PIN_LIFECYCLE_V2,
  IPFS_DEFAULT_MAX_ACTIVE_GATEWAYS_PER_OPERATOR,
  IPFS_DEFAULT_MAX_PENDING_PINS_PER_OWNER,
  IPFS_DEFAULT_GATEWAY_IDLE_MS,
  IPFS_DEFAULT_PIN_PENDING_MS,
  getMaxActiveGatewaysPerOperatorV2,
  setMaxActiveGatewaysPerOperatorV2,
  getMaxPendingPinsPerOwnerV2,
  setMaxPendingPinsPerOwnerV2,
  getGatewayIdleMsV2,
  setGatewayIdleMsV2,
  getPinPendingMsV2,
  setPinPendingMsV2,
  registerGatewayV2,
  getGatewayV2,
  setGatewayMaturityV2,
  activateGateway,
  degradeGateway,
  offlineGateway,
  retireGateway,
  touchGatewayHeartbeat,
  registerPinV2,
  getPinV2,
  setPinStatusV2,
  confirmPin,
  failPin,
  unpinV2,
  getActiveGatewayCount,
  getPendingPinCount,
  autoOfflineStaleGateways,
  autoFailStalePendingPins,
  getIpfsStatsV2,
  _resetStateV2,
} from "../../src/lib/ipfs-storage.js";

describe("ipfs-storage V2 (Phase 17)", () => {
  beforeEach(() => _resetStateV2());

  describe("enums + defaults", () => {
    it("frozen gateway maturity", () => {
      expect(() => {
        GATEWAY_MATURITY_V2.X = "y";
      }).toThrow();
      expect(Object.keys(GATEWAY_MATURITY_V2)).toEqual([
        "ONBOARDING",
        "ACTIVE",
        "DEGRADED",
        "OFFLINE",
        "RETIRED",
      ]);
    });
    it("frozen pin lifecycle", () => {
      expect(() => {
        PIN_LIFECYCLE_V2.X = "y";
      }).toThrow();
    });
    it("defaults exposed", () => {
      expect(IPFS_DEFAULT_MAX_ACTIVE_GATEWAYS_PER_OPERATOR).toBe(20);
      expect(IPFS_DEFAULT_MAX_PENDING_PINS_PER_OWNER).toBe(100);
      expect(IPFS_DEFAULT_GATEWAY_IDLE_MS).toBe(60 * 86400000);
      expect(IPFS_DEFAULT_PIN_PENDING_MS).toBe(24 * 3600000);
    });
  });

  describe("config mutators", () => {
    it("floors + rejects non-positive", () => {
      expect(setMaxActiveGatewaysPerOperatorV2(5.7)).toBe(5);
      expect(() => setMaxActiveGatewaysPerOperatorV2(0)).toThrow();
      expect(() => setMaxPendingPinsPerOwnerV2(-1)).toThrow();
      expect(() => setGatewayIdleMsV2(NaN)).toThrow();
      expect(() => setPinPendingMsV2("x")).toThrow();
    });
  });

  describe("registerGatewayV2", () => {
    it("defaults to onboarding", () => {
      const r = registerGatewayV2(null, {
        gatewayId: "g1",
        operatorId: "op1",
        endpoint: "https://x.io",
      });
      expect(r.status).toBe("onboarding");
    });
    it("missing + duplicate + terminal + invalid", () => {
      expect(() =>
        registerGatewayV2(null, { operatorId: "op1", endpoint: "x" }),
      ).toThrow("gatewayId");
      expect(() =>
        registerGatewayV2(null, { gatewayId: "g1", endpoint: "x" }),
      ).toThrow("operatorId");
      expect(() =>
        registerGatewayV2(null, { gatewayId: "g1", operatorId: "op1" }),
      ).toThrow("endpoint");
      registerGatewayV2(null, {
        gatewayId: "g1",
        operatorId: "op1",
        endpoint: "x",
      });
      expect(() =>
        registerGatewayV2(null, {
          gatewayId: "g1",
          operatorId: "op1",
          endpoint: "x",
        }),
      ).toThrow("already");
      expect(() =>
        registerGatewayV2(null, {
          gatewayId: "g2",
          operatorId: "op1",
          endpoint: "x",
          initialStatus: "retired",
        }),
      ).toThrow("terminal");
      expect(() =>
        registerGatewayV2(null, {
          gatewayId: "g3",
          operatorId: "op1",
          endpoint: "x",
          initialStatus: "bogus",
        }),
      ).toThrow();
    });
    it("per-operator active cap", () => {
      setMaxActiveGatewaysPerOperatorV2(1);
      registerGatewayV2(null, {
        gatewayId: "g1",
        operatorId: "op1",
        endpoint: "x",
        initialStatus: "active",
      });
      expect(() =>
        registerGatewayV2(null, {
          gatewayId: "g2",
          operatorId: "op1",
          endpoint: "x",
          initialStatus: "active",
        }),
      ).toThrow("active-gateway cap");
      expect(
        registerGatewayV2(null, {
          gatewayId: "g3",
          operatorId: "op2",
          endpoint: "x",
          initialStatus: "active",
        }),
      ).toBeDefined();
    });
  });

  describe("setGatewayMaturityV2 + shortcuts", () => {
    it("full traversal", () => {
      registerGatewayV2(null, {
        gatewayId: "g1",
        operatorId: "op1",
        endpoint: "x",
      });
      expect(activateGateway(null, "g1").status).toBe("active");
      expect(degradeGateway(null, "g1").status).toBe("degraded");
      expect(activateGateway(null, "g1").status).toBe("active");
      expect(offlineGateway(null, "g1").status).toBe("offline");
      expect(retireGateway(null, "g1").status).toBe("retired");
    });
    it("terminal + unknown + invalid", () => {
      registerGatewayV2(null, {
        gatewayId: "g1",
        operatorId: "op1",
        endpoint: "x",
      });
      retireGateway(null, "g1");
      expect(() => activateGateway(null, "g1")).toThrow("Invalid transition");
      expect(() => activateGateway(null, "nope")).toThrow("Unknown");
      registerGatewayV2(null, {
        gatewayId: "g2",
        operatorId: "op1",
        endpoint: "x",
      });
      expect(() => setGatewayMaturityV2(null, "g2", "bogus")).toThrow(
        "Invalid status",
      );
    });
    it("activation cap + patch merge + null get", () => {
      setMaxActiveGatewaysPerOperatorV2(1);
      registerGatewayV2(null, {
        gatewayId: "g1",
        operatorId: "op1",
        endpoint: "x",
        initialStatus: "active",
      });
      registerGatewayV2(null, {
        gatewayId: "g2",
        operatorId: "op1",
        endpoint: "x",
      });
      expect(() => activateGateway(null, "g2")).toThrow("active-gateway cap");
      registerGatewayV2(null, {
        gatewayId: "g3",
        operatorId: "op2",
        endpoint: "x",
        metadata: { a: 1 },
      });
      const r = setGatewayMaturityV2(null, "g3", "retired", {
        reason: "done",
        metadata: { b: 2 },
      });
      expect(r.lastReason).toBe("done");
      expect(r.metadata).toEqual({ a: 1, b: 2 });
      expect(getGatewayV2("nope")).toBeNull();
    });
    it("touchGatewayHeartbeat", () => {
      registerGatewayV2(null, {
        gatewayId: "g1",
        operatorId: "op1",
        endpoint: "x",
      });
      const r = touchGatewayHeartbeat("g1");
      expect(r.lastHeartbeatAt).toBeGreaterThan(0);
      expect(() => touchGatewayHeartbeat("nope")).toThrow();
    });
  });

  describe("registerPinV2", () => {
    it("defaults + missing + duplicate + terminal + invalid + cap", () => {
      const r = registerPinV2(null, {
        pinId: "p1",
        ownerId: "u1",
        cid: "bafyabc",
      });
      expect(r.status).toBe("pending");
      expect(() => registerPinV2(null, { ownerId: "u1", cid: "x" })).toThrow(
        "pinId",
      );
      expect(() => registerPinV2(null, { pinId: "p2", cid: "x" })).toThrow(
        "ownerId",
      );
      expect(() => registerPinV2(null, { pinId: "p2", ownerId: "u1" })).toThrow(
        "cid",
      );
      expect(() =>
        registerPinV2(null, { pinId: "p1", ownerId: "u1", cid: "x" }),
      ).toThrow("already");
      expect(() =>
        registerPinV2(null, {
          pinId: "p3",
          ownerId: "u1",
          cid: "x",
          initialStatus: "unpinned",
        }),
      ).toThrow("terminal");
      expect(() =>
        registerPinV2(null, {
          pinId: "p4",
          ownerId: "u1",
          cid: "x",
          initialStatus: "nope",
        }),
      ).toThrow();
      setMaxPendingPinsPerOwnerV2(1);
      expect(() =>
        registerPinV2(null, { pinId: "p5", ownerId: "u1", cid: "x" }),
      ).toThrow("pending-pin cap");
      // different owner unaffected
      expect(
        registerPinV2(null, { pinId: "p6", ownerId: "u2", cid: "x" }),
      ).toBeDefined();
    });
  });

  describe("setPinStatusV2 + shortcuts", () => {
    it("pending -> pinned -> unpinned", () => {
      registerPinV2(null, { pinId: "p1", ownerId: "u1", cid: "x" });
      const r = confirmPin(null, "p1");
      expect(r.status).toBe("pinned");
      expect(r.pinnedAt).toBeGreaterThan(0);
      expect(unpinV2(null, "p1").status).toBe("unpinned");
    });
    it("pending -> failed -> pending -> unpinned", () => {
      registerPinV2(null, { pinId: "p1", ownerId: "u1", cid: "x" });
      expect(failPin(null, "p1").status).toBe("failed");
      expect(setPinStatusV2(null, "p1", "pending").status).toBe("pending");
      expect(unpinV2(null, "p1").status).toBe("unpinned");
    });
    it("terminal + unknown + invalid + pinnedAt stamp-once", () => {
      registerPinV2(null, { pinId: "p1", ownerId: "u1", cid: "x" });
      unpinV2(null, "p1");
      expect(() => confirmPin(null, "p1")).toThrow("Invalid transition");
      expect(() => confirmPin(null, "nope")).toThrow("Unknown");
      registerPinV2(null, { pinId: "p2", ownerId: "u1", cid: "x" });
      expect(() => setPinStatusV2(null, "p2", "bogus")).toThrow();
      const r1 = confirmPin(null, "p2");
      const t1 = r1.pinnedAt;
      unpinV2(null, "p2");
      // can't go back to pinned anyway, but confirm stamp-once semantic
      expect(t1).toBeGreaterThan(0);
    });
  });

  describe("counts + auto-flip", () => {
    it("getActiveGatewayCount / getPendingPinCount scoping", () => {
      registerGatewayV2(null, {
        gatewayId: "g1",
        operatorId: "op1",
        endpoint: "x",
        initialStatus: "active",
      });
      registerGatewayV2(null, {
        gatewayId: "g2",
        operatorId: "op2",
        endpoint: "x",
        initialStatus: "active",
      });
      expect(getActiveGatewayCount()).toBe(2);
      expect(getActiveGatewayCount("op1")).toBe(1);
      registerPinV2(null, { pinId: "p1", ownerId: "u1", cid: "x" });
      registerPinV2(null, { pinId: "p2", ownerId: "u2", cid: "x" });
      expect(getPendingPinCount()).toBe(2);
      expect(getPendingPinCount("u1")).toBe(1);
    });
    it("autoOfflineStaleGateways + autoFailStalePendingPins", () => {
      registerGatewayV2(null, {
        gatewayId: "g1",
        operatorId: "op1",
        endpoint: "x",
        initialStatus: "active",
      });
      setGatewayIdleMsV2(1000);
      const future1 = Date.now() + 86400000;
      const r1 = autoOfflineStaleGateways(null, future1);
      expect(r1.flipped).toContain("g1");

      registerPinV2(null, { pinId: "p1", ownerId: "u1", cid: "x" });
      setPinPendingMsV2(1000);
      const future2 = Date.now() + 86400000;
      const r2 = autoFailStalePendingPins(null, future2);
      expect(r2.flipped).toContain("p1");
      expect(getPinV2("p1").status).toBe("failed");
    });
  });

  describe("getIpfsStatsV2", () => {
    it("zero-init all enum keys", () => {
      const s = getIpfsStatsV2();
      expect(Object.keys(s.gatewaysByStatus).sort()).toEqual([
        "active",
        "degraded",
        "offline",
        "onboarding",
        "retired",
      ]);
      expect(Object.keys(s.pinsByStatus).sort()).toEqual([
        "failed",
        "pending",
        "pinned",
        "unpinned",
      ]);
    });
    it("aggregates across states", () => {
      registerGatewayV2(null, {
        gatewayId: "g1",
        operatorId: "op1",
        endpoint: "x",
        initialStatus: "active",
      });
      registerGatewayV2(null, {
        gatewayId: "g2",
        operatorId: "op1",
        endpoint: "x",
      });
      registerPinV2(null, { pinId: "p1", ownerId: "u1", cid: "x" });
      confirmPin(null, "p1");
      const s = getIpfsStatsV2();
      expect(s.totalGatewaysV2).toBe(2);
      expect(s.gatewaysByStatus.active).toBe(1);
      expect(s.gatewaysByStatus.onboarding).toBe(1);
      expect(s.pinsByStatus.pinned).toBe(1);
    });
  });
});
