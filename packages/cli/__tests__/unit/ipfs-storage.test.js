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
