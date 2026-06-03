/**
 * Unit tests for EvoMapAssetBridge
 * @module evomap/evomap-asset-bridge.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let EvoMapAssetBridge, getEvoMapAssetBridge;

describe("EvoMapAssetBridge", () => {
  let mockDb, mockClient, mockNodeManager, mockSynthesizer, mockInstinctManager;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock("electron", () => ({
      app: { getPath: vi.fn(() => "/mock/userData") },
      ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
    }));
    vi.doMock("fs", () => ({
      existsSync: vi.fn(() => true),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
    }));
    vi.doMock("../../src/main/config/unified-config-manager.js", () => ({
      getUnifiedConfigManager: () => ({
        get: vi.fn().mockReturnValue({}),
        set: vi.fn(),
      }),
    }));

    mockDb = {
      exec: vi.fn(),
      run: vi.fn(),
      prepare: vi.fn(() => ({
        get: vi.fn(() => null),
        all: vi.fn(() => []),
      })),
      saveToFile: vi.fn(),
    };

    mockClient = {
      validate: vi.fn().mockResolvedValue({ success: true }),
      publish: vi.fn().mockResolvedValue({ success: true, data: {} }),
      searchAssets: vi.fn().mockResolvedValue({
        success: true,
        data: { assets: [{ asset_id: "a1", type: "Gene", summary: "test" }] },
      }),
    };

    mockNodeManager = {
      getOrCreateNodeId: vi.fn(() => "node_test"),
    };

    mockSynthesizer = {
      containsSecrets: vi.fn(() => false),
      synthesizeFromInstinct: vi.fn((inst) => ({
        gene: { type: "Gene", asset_id: "g1", summary: inst.pattern },
        capsule: { type: "Capsule", asset_id: "c1" },
        evolutionEvent: { type: "EvolutionEvent", asset_id: "e1" },
      })),
      synthesizeFromDecision: vi.fn((dec) => ({
        gene: { type: "Gene", asset_id: "g2", summary: dec.context },
        capsule: { type: "Capsule", asset_id: "c2" },
        evolutionEvent: { type: "EvolutionEvent", asset_id: "e2" },
      })),
      setConfig: vi.fn(),
    };

    mockInstinctManager = {
      addInstinct: vi.fn().mockReturnValue({ id: "imported_inst" }),
    };

    const mod = await import("../../../src/main/evomap/evomap-asset-bridge.js");
    EvoMapAssetBridge = mod.EvoMapAssetBridge;
    getEvoMapAssetBridge = mod.getEvoMapAssetBridge;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================
  // Constructor & Initialize
  // ============================================================

  describe("constructor", () => {
    it("should initialize with null fields", () => {
      const bridge = new EvoMapAssetBridge();
      expect(bridge.initialized).toBe(false);
      expect(bridge.db).toBeNull();
      expect(bridge._pendingReviews).toBeDefined();
    });
  });

  describe("initialize()", () => {
    it("should set dependencies and mark initialized", async () => {
      const bridge = new EvoMapAssetBridge();
      await bridge.initialize({
        database: mockDb,
        client: mockClient,
        nodeManager: mockNodeManager,
        synthesizer: mockSynthesizer,
      });

      expect(bridge.initialized).toBe(true);
      expect(bridge.db).toBe(mockDb);
      expect(bridge.client).toBe(mockClient);
    });

    it("should skip if already initialized", async () => {
      const bridge = new EvoMapAssetBridge();
      await bridge.initialize({
        database: mockDb,
        client: mockClient,
        nodeManager: mockNodeManager,
      });
      await bridge.initialize({
        database: mockDb,
        client: mockClient,
        nodeManager: mockNodeManager,
      });
      expect(bridge.initialized).toBe(true);
    });
  });

  describe("setConfig / getConfig", () => {
    it("should set and get config", () => {
      const bridge = new EvoMapAssetBridge();
      bridge.synthesizer = mockSynthesizer;
      bridge.setConfig({ hubUrl: "http://test" });
      expect(bridge.getConfig()).toEqual({ hubUrl: "http://test" });
      expect(mockSynthesizer.setConfig).toHaveBeenCalled();
    });

    it("should return empty object when no config set", () => {
      const bridge = new EvoMapAssetBridge();
      expect(bridge.getConfig()).toEqual({});
    });
  });

  // ============================================================
  // publishBundle
  // ============================================================

  describe("publishBundle()", () => {
    it("should publish directly when requireReview is false", async () => {
      const bridge = new EvoMapAssetBridge();
      await bridge.initialize({
        database: mockDb,
        client: mockClient,
        nodeManager: mockNodeManager,
        synthesizer: mockSynthesizer,
      });
      bridge._config = { privacyFilter: { requireReview: false } };

      const result = await bridge.publishBundle(
        { type: "Gene", asset_id: "g1", summary: "test" },
        { type: "Capsule", asset_id: "c1" },
        { type: "EvolutionEvent", asset_id: "e1" },
      );

      expect(result.success).toBe(true);
      expect(result.data.assetIds).toHaveLength(3);
      expect(mockClient.validate).toHaveBeenCalled();
      expect(mockClient.publish).toHaveBeenCalled();
    });

    it("should return pendingReview when requireReview is true", async () => {
      const bridge = new EvoMapAssetBridge();
      await bridge.initialize({
        database: mockDb,
        client: mockClient,
        nodeManager: mockNodeManager,
        synthesizer: mockSynthesizer,
      });
      bridge._config = { privacyFilter: { requireReview: true } };

      const result = await bridge.publishBundle(
        { type: "Gene", asset_id: "g1" },
        { type: "Capsule", asset_id: "c1" },
      );

      expect(result.pendingReview).toBe(true);
      expect(result.reviewId).toBeDefined();
    });

    it("should block publish when secrets detected", async () => {
      mockSynthesizer.containsSecrets.mockReturnValue(true);

      const bridge = new EvoMapAssetBridge();
      await bridge.initialize({
        database: mockDb,
        client: mockClient,
        nodeManager: mockNodeManager,
        synthesizer: mockSynthesizer,
      });
      bridge._config = { privacyFilter: { requireReview: false } };

      const result = await bridge.publishBundle(
        { type: "Gene", asset_id: "g1" },
        { type: "Capsule", asset_id: "c1" },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("secrets");
    });

    it("should fail when validation fails", async () => {
      mockClient.validate.mockResolvedValue({
        success: false,
        error: "Invalid asset format",
      });

      const bridge = new EvoMapAssetBridge();
      await bridge.initialize({
        database: mockDb,
        client: mockClient,
        nodeManager: mockNodeManager,
        synthesizer: mockSynthesizer,
      });
      bridge._config = { privacyFilter: { requireReview: false } };

      const result = await bridge.publishBundle(
        { type: "Gene", asset_id: "g1" },
        { type: "Capsule", asset_id: "c1" },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Validation failed");
    });

    it("should set executor_node_id on capsule", async () => {
      const bridge = new EvoMapAssetBridge();
      await bridge.initialize({
        database: mockDb,
        client: mockClient,
        nodeManager: mockNodeManager,
        synthesizer: mockSynthesizer,
      });
      bridge._config = { privacyFilter: { requireReview: false } };

      const capsule = { type: "Capsule", asset_id: "c1" };
      await bridge.publishBundle({ type: "Gene", asset_id: "g1" }, capsule);

      expect(capsule.executor_node_id).toBe("node_test");
    });
  });

  // ============================================================
  // approvePublish / rejectPublish
  // ============================================================

  describe("approvePublish()", () => {
    it("should approve and publish pending review", async () => {
      const bridge = new EvoMapAssetBridge();
      await bridge.initialize({
        database: mockDb,
        client: mockClient,
        nodeManager: mockNodeManager,
        synthesizer: mockSynthesizer,
      });
      bridge._config = { privacyFilter: { requireReview: true } };

      const pendResult = await bridge.publishBundle(
        { type: "Gene", asset_id: "g1" },
        { type: "Capsule", asset_id: "c1" },
      );

      const result = await bridge.approvePublish(pendResult.reviewId);
      expect(result.success).toBe(true);
      expect(mockClient.publish).toHaveBeenCalled();
    });

    it("should return error for unknown review ID", async () => {
      const bridge = new EvoMapAssetBridge();
      const result = await bridge.approvePublish("nonexistent");
      expect(result.success).toBe(false);
    });
  });

  describe("rejectPublish()", () => {
    it("should reject pending review", async () => {
      const bridge = new EvoMapAssetBridge();
      await bridge.initialize({
        database: mockDb,
        client: mockClient,
        nodeManager: mockNodeManager,
        synthesizer: mockSynthesizer,
      });
      bridge._config = { privacyFilter: { requireReview: true } };

      const pendResult = await bridge.publishBundle(
        { type: "Gene", asset_id: "g1" },
        { type: "Capsule", asset_id: "c1" },
      );

      const result = bridge.rejectPublish(pendResult.reviewId);
      expect(result.success).toBe(true);
    });

    it("should return false for unknown review", () => {
      const bridge = new EvoMapAssetBridge();
      const result = bridge.rejectPublish("nonexistent");
      expect(result.success).toBe(false);
    });
  });

  // ============================================================
  // publishInstinct
  // ============================================================

  describe("publishInstinct()", () => {
    it("should load instinct from DB, synthesize, and publish", async () => {
      const instinctRow = {
        id: "inst_1",
        pattern: "Use async",
        confidence: 0.8,
      };
      mockDb.prepare.mockReturnValue({
        get: vi.fn((id) => {
          if (id === "inst_1") {
            return instinctRow;
          }
          return null;
        }),
        all: vi.fn(() => []),
      });

      const bridge = new EvoMapAssetBridge();
      await bridge.initialize({
        database: mockDb,
        client: mockClient,
        nodeManager: mockNodeManager,
        synthesizer: mockSynthesizer,
        instinctManager: mockInstinctManager,
      });
      bridge._config = { privacyFilter: { requireReview: false } };

      const result = await bridge.publishInstinct("inst_1");
      expect(result.success).toBe(true);
      expect(mockSynthesizer.synthesizeFromInstinct).toHaveBeenCalled();
    });

    it("should return error when instinct not found", async () => {
      const bridge = new EvoMapAssetBridge();
      await bridge.initialize({
        database: mockDb,
        client: mockClient,
        nodeManager: mockNodeManager,
        synthesizer: mockSynthesizer,
        instinctManager: mockInstinctManager,
      });

      const result = await bridge.publishInstinct("nonexistent");
      expect(result.success).toBe(false);
    });

    it("should return error when no instinct manager", async () => {
      const bridge = new EvoMapAssetBridge();
      await bridge.initialize({
        database: mockDb,
        client: mockClient,
        nodeManager: mockNodeManager,
        synthesizer: mockSynthesizer,
      });

      const result = await bridge.publishInstinct("inst_1");
      expect(result.success).toBe(false);
      expect(result.error).toContain("InstinctManager");
    });

    it("should return error when no synthesizer", async () => {
      const instinctRow = {
        id: "inst_1",
        pattern: "Use async",
        confidence: 0.8,
      };
      mockDb.prepare.mockReturnValue({
        get: vi.fn(() => instinctRow),
        all: vi.fn(() => []),
      });

      const bridge = new EvoMapAssetBridge();
      await bridge.initialize({
        database: mockDb,
        client: mockClient,
        nodeManager: mockNodeManager,
        instinctManager: mockInstinctManager,
      });

      const result = await bridge.publishInstinct("inst_1");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Synthesizer");
    });
  });

  // ============================================================
  // publishDecision
  // ============================================================

  describe("publishDecision()", () => {
    it("should load decision and publish", async () => {
      const decisionRow = {
        id: "dec_1",
        context: "Use Redis",
        success_rate: 0.9,
      };
      mockDb.prepare.mockReturnValue({
        get: vi.fn((id) => {
          if (id === "dec_1") {
            return decisionRow;
          }
          return null;
        }),
        all: vi.fn(() => []),
      });

      const bridge = new EvoMapAssetBridge();
      await bridge.initialize({
        database: mockDb,
        client: mockClient,
        nodeManager: mockNodeManager,
        synthesizer: mockSynthesizer,
      });
      bridge._config = { privacyFilter: { requireReview: false } };

      const result = await bridge.publishDecision("dec_1");
      expect(result.success).toBe(true);
    });
  });

  // ============================================================
  // fetchRelevantAssets
  // ============================================================

  describe("fetchRelevantAssets()", () => {
    it("should search and cache assets", async () => {
      const bridge = new EvoMapAssetBridge();
      await bridge.initialize({
        database: mockDb,
        client: mockClient,
        nodeManager: mockNodeManager,
        synthesizer: mockSynthesizer,
      });

      const result = await bridge.fetchRelevantAssets(["error", "handling"]);
      expect(result.success).toBe(true);
      expect(result.data.assets).toBeDefined();
      expect(mockClient.searchAssets).toHaveBeenCalledWith(
        ["error", "handling"],
        undefined,
        "relevance",
      );
    });

    it("should return error on search failure", async () => {
      mockClient.searchAssets.mockResolvedValue({
        success: false,
        error: "Hub unavailable",
      });

      const bridge = new EvoMapAssetBridge();
      await bridge.initialize({
        database: mockDb,
        client: mockClient,
        nodeManager: mockNodeManager,
      });

      const result = await bridge.fetchRelevantAssets(["test"]);
      expect(result.success).toBe(false);
    });
  });

  // ============================================================
  // importAsInstinct
  // ============================================================

  describe("importAsInstinct()", () => {
    it("should import capsule and cap confidence at 0.7", async () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn((assetId) => {
          if (assetId === "cap_1") {
            return {
              asset_id: "cap_1",
              type: "Capsule",
              content: JSON.stringify({
                type: "Capsule",
                result_summary: "Handle errors",
                confidence: 0.95,
                signals_observed: ["error"],
              }),
            };
          }
          return null;
        }),
        all: vi.fn(() => []),
      });

      const bridge = new EvoMapAssetBridge();
      await bridge.initialize({
        database: mockDb,
        client: mockClient,
        nodeManager: mockNodeManager,
        synthesizer: mockSynthesizer,
        instinctManager: mockInstinctManager,
      });

      const result = await bridge.importAsInstinct("cap_1");
      expect(result.success).toBe(true);
      expect(mockInstinctManager.addInstinct).toHaveBeenCalledWith(
        "Handle errors",
        0.7, // capped
        "general",
        expect.objectContaining({ source: "evomap-import" }),
      );
    });

    it("should return error when no instinct manager", async () => {
      const bridge = new EvoMapAssetBridge();
      await bridge.initialize({
        database: mockDb,
        client: mockClient,
        nodeManager: mockNodeManager,
      });

      const result = await bridge.importAsInstinct("cap_1");
      expect(result.success).toBe(false);
      expect(result.error).toContain("InstinctManager");
    });

    it("should return error when asset not found", async () => {
      const bridge = new EvoMapAssetBridge();
      await bridge.initialize({
        database: mockDb,
        client: mockClient,
        nodeManager: mockNodeManager,
        instinctManager: mockInstinctManager,
      });

      const result = await bridge.importAsInstinct("nonexistent");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  // ============================================================
  // buildEvoMapContext
  // ============================================================

  describe("buildEvoMapContext()", () => {
    it("should return null for empty hint", () => {
      const bridge = new EvoMapAssetBridge();
      bridge.db = mockDb;
      expect(bridge.buildEvoMapContext("")).toBeNull();
    });

    it("should return null when no matching assets", () => {
      const bridge = new EvoMapAssetBridge();
      bridge.db = mockDb;
      // Mock returns empty
      expect(bridge.buildEvoMapContext("some query")).toBeNull();
    });

    it("should return markdown with matching assets", () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn(() => null),
        all: vi.fn(() => [
          {
            asset_id: "g1",
            type: "Gene",
            summary: "Database optimization using indexes",
            content: JSON.stringify({
              type: "Gene",
              summary: "Database optimization using indexes",
              strategy: { description: "Add composite indexes" },
            }),
            gdi_score: 8.5,
          },
        ]),
      });

      const bridge = new EvoMapAssetBridge();
      bridge.db = mockDb;

      const context = bridge.buildEvoMapContext("database optimization");
      expect(context).toContain("EvoMap Community Knowledge");
      expect(context).toContain("Database optimization");
    });

    it("should return null when no db", () => {
      const bridge = new EvoMapAssetBridge();
      expect(bridge.buildEvoMapContext("test")).toBeNull();
    });

    it("should return null for short keywords only", () => {
      const bridge = new EvoMapAssetBridge();
      bridge.db = mockDb;
      // All words < 3 chars
      expect(bridge.buildEvoMapContext("a b c")).toBeNull();
    });
  });

  // ============================================================
  // getLocalAssets / getSyncLog
  // ============================================================

  describe("getLocalAssets()", () => {
    it("should return assets with filters", () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn(() => null),
        all: vi.fn(() => [{ asset_id: "a1", direction: "published" }]),
      });

      const bridge = new EvoMapAssetBridge();
      bridge.db = mockDb;
      const assets = bridge.getLocalAssets({ direction: "published" });
      expect(assets).toHaveLength(1);
    });

    it("should return empty on error", () => {
      mockDb.prepare.mockImplementation(() => {
        throw new Error("DB error");
      });

      const bridge = new EvoMapAssetBridge();
      bridge.db = mockDb;
      expect(bridge.getLocalAssets()).toEqual([]);
    });
  });

  describe("getSyncLog()", () => {
    it("should return sync log entries", () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn(() => null),
        all: vi.fn(() => [{ id: "log1", action: "publish" }]),
      });

      const bridge = new EvoMapAssetBridge();
      bridge.db = mockDb;
      const log = bridge.getSyncLog(10);
      expect(log).toHaveLength(1);
    });

    it("should return empty on error", () => {
      mockDb.prepare.mockImplementation(() => {
        throw new Error("DB error");
      });

      const bridge = new EvoMapAssetBridge();
      bridge.db = mockDb;
      expect(bridge.getSyncLog()).toEqual([]);
    });
  });

  // ============================================================
  // _logSync
  // ============================================================

  describe("_logSync()", () => {
    it("should insert sync log entry", async () => {
      const bridge = new EvoMapAssetBridge();
      await bridge.initialize({
        database: mockDb,
        client: mockClient,
        nodeManager: mockNodeManager,
      });

      bridge._logSync("publish", "g1", "success", { count: 3 });
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO evomap_sync_log"),
        expect.any(Array),
      );
    });
  });

  // ============================================================
  // Singleton
  // ============================================================

  describe("getEvoMapAssetBridge()", () => {
    it("should return a singleton", () => {
      const instance = getEvoMapAssetBridge();
      expect(instance).toBeInstanceOf(EvoMapAssetBridge);
    });
  });
});
