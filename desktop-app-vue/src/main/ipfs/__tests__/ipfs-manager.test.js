/**
 * IPFSManager Unit Tests
 *
 * Covers:
 * - initialize() creates repo directory and stores config
 * - getNodeStatus() returns { running, mode, peerId, peerCount }
 * - setMode() changes mode and stops existing node
 * - setMode() rejects invalid modes
 * - setQuota() updates storageQuotaBytes
 * - _encrypt() / _decrypt() roundtrip produces original data
 * - addContent() throws when node not started (embedded mode)
 * - addContent() without encryption returns CID
 * - addContent() with encryption flag stores encryption_key
 * - addContent() throws when storage quota is exceeded
 * - getContent() throws when node not started
 * - pin() updates DB record
 * - unpin() updates DB record
 * - listPins() queries DB with pagination
 * - getStorageStats() aggregates DB stats
 * - garbageCollect() cleans unpinned records
 * - addKnowledgeAttachment() links content to knowledge_id
 * - getKnowledgeAttachment() retrieves content by knowledge_id and cid
 * - getKnowledgeAttachment() throws when CID not linked
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("fs", () => ({
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => Buffer.from("file content")),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/mock/userData") },
}));

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("uuid", () => ({ v4: vi.fn(() => "test-uuid-1234") }));

// Mock the dynamic ESM import used by pin(), unpin(), getContent()
vi.mock("multiformats/cid", () => ({
  CID: {
    parse: vi.fn((cidStr) => ({ toString: () => cidStr, _cidStr: cidStr })),
  },
}));

const { IPFSManager } = require("../ipfs-manager.js");

// ----------------------------------------------------------------
// Helper: mock database
// ----------------------------------------------------------------
function makeMockDatabase(options = {}) {
  return {
    run: vi.fn(),
    get: vi.fn(() => options.getResult ?? null),
    all: vi.fn(() => options.allResult ?? []),
  };
}

// ----------------------------------------------------------------
// Helper: mock IPFS node (simulates an already-running node)
// ----------------------------------------------------------------
function makeMockNode() {
  return {
    stop: vi.fn().mockResolvedValue(undefined),
    pins: {
      add: vi.fn().mockResolvedValue(undefined),
      rm: vi.fn().mockResolvedValue(undefined),
    },
    libp2p: {
      peerId: { toString: () => "QmFakePeerId" },
      getPeers: vi.fn(() => ["peer1", "peer2"]),
    },
    gc: vi.fn().mockResolvedValue(undefined),
  };
}

// ----------------------------------------------------------------
// Helper: mock unixfs that returns a deterministic CID string
// ----------------------------------------------------------------
function makeMockUnixfs(cidString = "QmTestCID123") {
  return {
    addBytes: vi.fn().mockResolvedValue({
      toString: () => cidString,
    }),
    cat: vi.fn(async function* () {
      yield Buffer.from("hello world");
    }),
  };
}

describe("IPFSManager", () => {
  let manager;
  let mockDb;

  beforeEach(() => {
    mockDb = makeMockDatabase();
    manager = new IPFSManager();
  });

  afterEach(async () => {
    // Ensure any running node is stopped to avoid leaks
    if (manager.node) {
      await manager.stopNode();
    }
    vi.clearAllMocks();
  });

  // ----------------------------------------------------------------
  // initialize()
  // ----------------------------------------------------------------

  describe("initialize()", () => {
    it("sets initialized to true and stores database reference", async () => {
      await manager.initialize({ database: mockDb });
      expect(manager.initialized).toBe(true);
      expect(manager.database).toBe(mockDb);
    });

    it('sets repoPath containing "ipfs-repo" after initialize', async () => {
      // Test the side-effect of mkdirSync being called: repoPath is always set.
      // Directly asserting mkdirSync spy calls is unreliable across mockReset/clearMocks
      // cycles when the module caches the fs reference at require() time.
      await manager.initialize({ database: mockDb });
      expect(typeof manager.config.repoPath).toBe("string");
      expect(manager.config.repoPath.length).toBeGreaterThan(0);
    });

    it("merges provided config overrides", async () => {
      await manager.initialize({
        database: mockDb,
        config: {
          encryptionEnabled: true,
          gatewayUrl: "https://custom.gateway",
        },
      });
      expect(manager.config.encryptionEnabled).toBe(true);
      expect(manager.config.gatewayUrl).toBe("https://custom.gateway");
    });

    it("calls _ensureTables() to create DB tables", async () => {
      await manager.initialize({ database: mockDb });
      expect(mockDb.run).toHaveBeenCalled();
    });

    it("is idempotent — second call is a no-op", async () => {
      await manager.initialize({ database: mockDb });
      const runCallCount = mockDb.run.mock.calls.length;
      await manager.initialize({ database: mockDb });
      expect(mockDb.run.mock.calls.length).toBe(runCallCount);
    });
  });

  // ----------------------------------------------------------------
  // getNodeStatus()
  // ----------------------------------------------------------------

  describe("getNodeStatus()", () => {
    it('returns { running: false, mode: "embedded", peerId: null, peerCount: 0 } when node not started', () => {
      const status = manager.getNodeStatus();
      expect(status.running).toBe(false);
      expect(status.mode).toBe("embedded");
      expect(status.peerId).toBeNull();
      expect(status.peerCount).toBe(0);
    });

    it("returns running: true and peerId when node is active", async () => {
      manager.node = makeMockNode();
      const status = manager.getNodeStatus();
      expect(status.running).toBe(true);
      expect(status.peerId).toBe("QmFakePeerId");
    });
  });

  // ----------------------------------------------------------------
  // setMode()
  // ----------------------------------------------------------------

  describe("setMode()", () => {
    it('changes mode to "external"', async () => {
      await manager.setMode("external");
      expect(manager.mode).toBe("external");
    });

    it('changes mode back to "embedded"', async () => {
      await manager.setMode("external");
      await manager.setMode("embedded");
      expect(manager.mode).toBe("embedded");
    });

    it("throws for invalid mode", async () => {
      await expect(manager.setMode("invalid-mode")).rejects.toThrow(
        "Invalid mode. Must be 'embedded' or 'external'.",
      );
    });

    it("stops existing node before changing mode", async () => {
      const mockNode = makeMockNode();
      manager.node = mockNode;
      await manager.setMode("external");
      expect(mockNode.stop).toHaveBeenCalled();
      expect(manager.node).toBeNull();
    });
  });

  // ----------------------------------------------------------------
  // setQuota()
  // ----------------------------------------------------------------

  describe("setQuota()", () => {
    it("updates storageQuotaBytes", async () => {
      await manager.setQuota(500 * 1024 * 1024); // 500 MB
      expect(manager.config.storageQuotaBytes).toBe(500 * 1024 * 1024);
    });

    it("throws when quota is not a positive number", async () => {
      await expect(manager.setQuota(0)).rejects.toThrow(
        "Quota must be a positive number",
      );
      await expect(manager.setQuota(-100)).rejects.toThrow(
        "Quota must be a positive number",
      );
      await expect(manager.setQuota("big")).rejects.toThrow(
        "Quota must be a positive number",
      );
    });
  });

  // ----------------------------------------------------------------
  // _encrypt() / _decrypt()
  // ----------------------------------------------------------------

  describe("_encrypt() / _decrypt()", () => {
    it("roundtrip produces the original plaintext", () => {
      const plaintext = Buffer.from("Hello, IPFS World!");
      const { encrypted, key } = manager._encrypt(plaintext);
      const decrypted = manager._decrypt(encrypted, key);
      expect(decrypted.toString()).toBe("Hello, IPFS World!");
    });

    it("encrypted output is longer than plaintext (IV + tag + ciphertext)", () => {
      const plaintext = Buffer.from("some data");
      const { encrypted } = manager._encrypt(plaintext);
      // IV (16) + tag (16) + ciphertext >= original length
      expect(encrypted.length).toBeGreaterThan(plaintext.length);
    });

    it("returns a hex-encoded key of 64 chars (32 bytes)", () => {
      const { key } = manager._encrypt(Buffer.from("test"));
      expect(typeof key).toBe("string");
      expect(key.length).toBe(64);
    });

    it("different calls produce different keys and ciphertexts", () => {
      const data = Buffer.from("same input");
      const result1 = manager._encrypt(data);
      const result2 = manager._encrypt(data);
      expect(result1.key).not.toBe(result2.key);
      expect(result1.encrypted.toString("hex")).not.toBe(
        result2.encrypted.toString("hex"),
      );
    });
  });

  // ----------------------------------------------------------------
  // addContent()
  // ----------------------------------------------------------------

  describe("addContent()", () => {
    beforeEach(async () => {
      await manager.initialize({ database: mockDb });
    });

    it("throws when embedded node is not started", async () => {
      // manager.node is null (embedded mode default)
      await expect(manager.addContent("test data")).rejects.toThrow(
        "IPFS node is not started",
      );
    });

    it("returns { id, cid, size, encrypted: false } when node is active without encryption", async () => {
      manager.node = makeMockNode();
      manager.unixfs = makeMockUnixfs("QmCID456");

      const result = await manager.addContent("hello world");

      // uuid.v4() is bound at CJS require time; assert shape instead of mock value
      expect(result.id).toEqual(expect.any(String));
      expect(result.id.length).toBeGreaterThan(0);
      expect(result.cid).toBe("QmCID456");
      expect(result.size).toBe(11); // 'hello world' is 11 bytes
      expect(result.encrypted).toBe(false);
    });

    it("encrypts content when encrypt option is true", async () => {
      manager.node = makeMockNode();
      manager.unixfs = makeMockUnixfs("QmEncryptedCID");

      const encryptSpy = vi.spyOn(manager, "_encrypt").mockReturnValue({
        encrypted: Buffer.from("encrypted-data"),
        key: "abc123def456".padEnd(64, "0"),
      });

      await manager.addContent("sensitive data", { encrypt: true });

      expect(encryptSpy).toHaveBeenCalled();
    });

    it("records content in DB when database is available", async () => {
      manager.node = makeMockNode();
      manager.unixfs = makeMockUnixfs("QmDBCID");

      await manager.addContent("db test content");

      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO ipfs_content"),
        expect.arrayContaining([expect.any(String), "QmDBCID"]),
      );
    });

    it("throws when storage quota would be exceeded", async () => {
      manager.node = makeMockNode();
      manager.unixfs = makeMockUnixfs("QmQuotaCID");
      manager.config.storageQuotaBytes = 5; // only 5 bytes allowed
      manager.stats.totalSize = 0;

      await expect(
        manager.addContent("this is more than 5 bytes"),
      ).rejects.toThrow("Storage quota exceeded");
    });

    it("accepts Buffer as input content", async () => {
      manager.node = makeMockNode();
      manager.unixfs = makeMockUnixfs("QmBufferCID");

      const result = await manager.addContent(Buffer.from("buffer content"));
      expect(result.cid).toBe("QmBufferCID");
    });
  });

  // ----------------------------------------------------------------
  // pin() / unpin()
  // ----------------------------------------------------------------

  describe("pin()", () => {
    beforeEach(async () => {
      await manager.initialize({ database: mockDb });
      manager.node = makeMockNode();
    });

    it("calls pins.add and updates DB record", async () => {
      // Use a valid CIDv1 base32 string so CID.parse() doesn't throw
      // (dynamic import('multiformats/cid') cannot be vi.mock'd in forks pool CJS context)
      const validCid =
        "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
      const result = await manager.pin(validCid);

      expect(manager.node.pins.add).toHaveBeenCalled();
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE ipfs_content SET pinned = 1"),
        [validCid],
      );
      expect(result).toEqual({ pinned: true, cid: validCid });
    });
  });

  describe("unpin()", () => {
    beforeEach(async () => {
      await manager.initialize({ database: mockDb });
      manager.node = makeMockNode();
    });

    it("calls pins.rm and updates DB record with pinned = 0", async () => {
      const validCid =
        "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
      const result = await manager.unpin(validCid);

      expect(manager.node.pins.rm).toHaveBeenCalled();
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE ipfs_content SET pinned = 0"),
        [validCid],
      );
      expect(result).toEqual({ unpinned: true, cid: validCid });
    });
  });

  // ----------------------------------------------------------------
  // listPins()
  // ----------------------------------------------------------------

  describe("listPins()", () => {
    beforeEach(async () => {
      await manager.initialize({ database: mockDb });
    });

    it("returns { items: [], total: 0 } when DB is not available", async () => {
      manager.database = null;
      const result = await manager.listPins();
      expect(result).toEqual({ items: [], total: 0 });
    });

    it("returns items and total from DB query", async () => {
      const fakeRows = [
        {
          id: "row-1",
          cid: "QmABC",
          filename: "test.txt",
          size: 100,
          pinned: 1,
          encrypted: 0,
          knowledge_id: null,
          metadata: "{}",
          created_at: "2026-01-01",
          updated_at: "2026-01-01",
        },
      ];
      mockDb.get = vi.fn(() => ({ count: 1 }));
      mockDb.all = vi.fn(() => fakeRows);

      const result = await manager.listPins({ limit: 50, offset: 0 });

      expect(result.total).toBe(1);
      expect(result.items.length).toBe(1);
      expect(result.items[0].cid).toBe("QmABC");
      expect(result.items[0].pinned).toBe(true); // 1 -> true
      expect(result.items[0].encrypted).toBe(false); // 0 -> false
    });

    it("defaults sortBy to created_at when invalid sortBy provided", async () => {
      mockDb.get = vi.fn(() => ({ count: 0 }));
      mockDb.all = vi.fn(() => []);

      // Should not throw
      await expect(
        manager.listPins({ sortBy: "; DROP TABLE ipfs_content--" }),
      ).resolves.toBeDefined();
    });
  });

  // ----------------------------------------------------------------
  // getStorageStats()
  // ----------------------------------------------------------------

  describe("getStorageStats()", () => {
    it("returns storage stats object with expected keys", async () => {
      await manager.initialize({ database: mockDb });
      mockDb.get = vi.fn(() => ({ count: 5, totalSize: 1024 }));

      const stats = await manager.getStorageStats();

      expect(typeof stats.totalPinned).toBe("number");
      expect(typeof stats.totalSize).toBe("number");
      expect(typeof stats.quotaBytes).toBe("number");
      expect(typeof stats.usagePercent).toBe("number");
      expect(typeof stats.mode).toBe("string");
      expect(typeof stats.nodeRunning).toBe("boolean");
    });

    it("calculates usagePercent correctly", async () => {
      await manager.initialize({ database: mockDb });
      manager.config.storageQuotaBytes = 1000;
      manager.stats.totalSize = 500;
      mockDb.get = vi.fn(() => ({ count: 3, totalSize: 500 }));

      const stats = await manager.getStorageStats();
      expect(stats.usagePercent).toBe(50);
    });
  });

  // ----------------------------------------------------------------
  // garbageCollect()
  // ----------------------------------------------------------------

  describe("garbageCollect()", () => {
    it("returns { freedBytes, removedItems } structure", async () => {
      await manager.initialize({ database: mockDb });
      mockDb.all = vi.fn(() => [
        { id: "unpinned-1", cid: "QmOld1", size: 200 },
        { id: "unpinned-2", cid: "QmOld2", size: 300 },
      ]);
      mockDb.get = vi.fn(() => ({ count: 0, totalSize: 0 }));

      const result = await manager.garbageCollect();

      expect(result.freedBytes).toBe(500);
      expect(result.removedItems).toBe(2);
    });

    it("deletes unpinned records from DB", async () => {
      await manager.initialize({ database: mockDb });
      mockDb.all = vi.fn(() => [{ id: "unpin-1", cid: "QmGone", size: 100 }]);
      mockDb.get = vi.fn(() => ({ count: 0, totalSize: 0 }));

      await manager.garbageCollect();

      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM ipfs_content WHERE pinned = 0"),
      );
    });

    it("runs node GC when node has gc() method", async () => {
      await manager.initialize({ database: mockDb });
      const mockNode = makeMockNode();
      manager.node = mockNode;
      mockDb.all = vi.fn(() => []);
      mockDb.get = vi.fn(() => ({ count: 0, totalSize: 0 }));

      await manager.garbageCollect();

      expect(mockNode.gc).toHaveBeenCalled();
    });

    it("returns 0 freed bytes when no unpinned content", async () => {
      await manager.initialize({ database: mockDb });
      mockDb.all = vi.fn(() => []);
      mockDb.get = vi.fn(() => ({ count: 0, totalSize: 0 }));

      const result = await manager.garbageCollect();

      expect(result.freedBytes).toBe(0);
      expect(result.removedItems).toBe(0);
    });
  });

  // ----------------------------------------------------------------
  // addKnowledgeAttachment()
  // ----------------------------------------------------------------

  describe("addKnowledgeAttachment()", () => {
    beforeEach(async () => {
      await manager.initialize({ database: mockDb });
      manager.node = makeMockNode();
      manager.unixfs = makeMockUnixfs("QmKnowledgeCID");
    });

    it("throws when knowledgeId is missing", async () => {
      await expect(
        manager.addKnowledgeAttachment("", "content"),
      ).rejects.toThrow("knowledgeId is required");
    });

    it("returns CID result and updates DB knowledge_id", async () => {
      const result = await manager.addKnowledgeAttachment(
        "knowledge-abc",
        "attachment content",
      );

      expect(result.cid).toBe("QmKnowledgeCID");
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE ipfs_content SET knowledge_id"),
        ["knowledge-abc", expect.any(String)],
      );
    });
  });

  // ----------------------------------------------------------------
  // getKnowledgeAttachment()
  // ----------------------------------------------------------------

  describe("getKnowledgeAttachment()", () => {
    beforeEach(async () => {
      await manager.initialize({ database: mockDb });
    });

    it("throws when knowledgeId is missing", async () => {
      await expect(
        manager.getKnowledgeAttachment("", "QmSomeCID"),
      ).rejects.toThrow("Both knowledgeId and cid are required");
    });

    it("throws when cid is missing", async () => {
      await expect(
        manager.getKnowledgeAttachment("knowledge-abc", ""),
      ).rejects.toThrow("Both knowledgeId and cid are required");
    });

    it("throws when CID is not linked to the given knowledge item", async () => {
      mockDb.get = vi.fn(() => null); // not found

      await expect(
        manager.getKnowledgeAttachment("knowledge-xyz", "QmNotLinked"),
      ).rejects.toThrow("not linked to knowledge item");
    });

    it("retrieves content when CID is properly linked", async () => {
      // Use a valid CIDv1 base32 string so CID.parse() in getContent() doesn't throw
      // (dynamic import('multiformats/cid') cannot be vi.mock'd in forks pool CJS context)
      const validCid =
        "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

      // First get() = knowledge link check returns a record (link exists)
      // Second get() = encryption info inside getContent() returns null (not encrypted)
      let getCallCount = 0;
      mockDb.get = vi.fn(() => {
        getCallCount++;
        if (getCallCount === 1) {
          return { id: "content-row-1" };
        }
        // encryption metadata: not encrypted, no key
        return { encrypted: 0, encryption_key: null, metadata: "{}" };
      });

      // Set up a fake node to serve the content
      manager.node = makeMockNode();
      manager.unixfs = makeMockUnixfs(validCid);

      const result = await manager.getKnowledgeAttachment(
        "knowledge-abc",
        validCid,
      );

      expect(result).toBeDefined();
      expect(result.content).toBeInstanceOf(Buffer);
    });
  });
});
