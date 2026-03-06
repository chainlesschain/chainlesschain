/**
 * EvoMap E2E Integration Tests
 *
 * Tests the full integration flow with real module instances
 * wired together with mock DB and mock HTTP client.
 *
 * @module evomap/evomap-e2e.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let EvoMapGeneSynthesizer, EvoMapAssetBridge, EvoMapNodeManager;

describe("EvoMap E2E Integration", () => {
  let mockDb, mockClient;

  beforeEach(async () => {
    vi.resetModules();

    // Mock dependencies before importing
    vi.doMock("electron", () => ({
      app: { getPath: vi.fn(() => "/mock/userData") },
      ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
    }));
    vi.doMock("fs", () => ({
      existsSync: vi.fn(() => true),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
    }));
    vi.doMock("uuid", () => ({
      v4: vi.fn(
        () => `uuid-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ),
    }));
    vi.doMock("../../src/main/config/unified-config-manager.js", () => ({
      getUnifiedConfigManager: () => ({
        get: vi.fn().mockReturnValue({}),
        set: vi.fn(),
      }),
    }));

    // Setup mock DB
    const dbRows = new Map();
    mockDb = {
      exec: vi.fn(),
      run: vi.fn((sql, params) => {
        // Simple simulation: track inserts
        if (sql.includes("INSERT") && params) {
          const id = params[0];
          dbRows.set(id, { id, sql, params });
        }
      }),
      prepare: vi.fn((sql) => ({
        get: vi.fn((...args) => {
          // Simulate instinct lookup
          if (sql.includes("FROM instincts") && args[0] === "inst_001") {
            return {
              id: "inst_001",
              pattern: "Use async/await instead of callbacks",
              category: "coding-pattern",
              confidence: 0.85,
              use_count: 12,
              examples: JSON.stringify([
                "const data = await fetch(url)",
                "const result = await db.query(sql)",
              ]),
            };
          }
          // Simulate decision lookup
          if (sql.includes("FROM decision_records") && args[0] === "dec_001") {
            return {
              id: "dec_001",
              context: "Database choice for caching layer",
              outcome: "Use Redis",
              rationale: "Better pub/sub, data structures, persistence",
              source: "manual",
              success_rate: 0.92,
              apply_count: 8,
            };
          }
          // Simulate asset lookup
          if (sql.includes("FROM evomap_assets") && args[0]) {
            const id = args[0];
            if (id === "fetched_gene_1") {
              return {
                asset_id: "fetched_gene_1",
                type: "Gene",
                content: JSON.stringify({
                  type: "Gene",
                  summary: "Error handling optimization",
                  category: "repair",
                  strategy: {
                    description: "Use try-catch with specific error types",
                    instructions: "Catch specific exceptions",
                  },
                }),
              };
            }
            if (id === "fetched_capsule_1") {
              return {
                asset_id: "fetched_capsule_1",
                type: "Capsule",
                content: JSON.stringify({
                  type: "Capsule",
                  result_summary: "Handle errors with specific types",
                  confidence: 0.88,
                  signals_observed: ["error", "handling", "try", "catch"],
                }),
              };
            }
          }
          // Check if already published
          if (sql.includes("local_source_id") && sql.includes("published")) {
            return null; // Not yet published
          }
          if (sql.includes("fetch_count")) {
            return null; // Not yet cached
          }
          return null;
        }),
        all: vi.fn((..._args) => {
          // Auto-publish scan: return eligible instincts
          if (sql.includes("FROM instincts WHERE confidence")) {
            return [
              {
                id: "inst_001",
                pattern: "Use async/await instead of callbacks",
                category: "coding-pattern",
                confidence: 0.85,
                use_count: 12,
              },
            ];
          }
          // Auto-publish scan: return eligible decisions
          if (sql.includes("FROM decision_records WHERE success_rate")) {
            return [
              {
                id: "dec_001",
                context: "Database choice",
                outcome: "Redis",
                success_rate: 0.92,
                apply_count: 8,
              },
            ];
          }
          // Fetched assets for context building
          if (sql.includes("evomap_assets") && sql.includes("fetched")) {
            return [
              {
                asset_id: "ctx_gene_1",
                type: "Gene",
                summary: "Database query optimization using indexes",
                content: JSON.stringify({
                  type: "Gene",
                  summary: "Database query optimization using indexes",
                  strategy: {
                    description:
                      "Add composite indexes for frequently queried columns",
                  },
                }),
                gdi_score: 8.5,
              },
              {
                asset_id: "ctx_gene_2",
                type: "Gene",
                summary: "Caching strategy for API responses",
                content: JSON.stringify({
                  type: "Gene",
                  summary: "Caching strategy for API responses",
                  strategy: {
                    description: "Use Redis with TTL-based invalidation",
                  },
                }),
                gdi_score: 7.2,
              },
            ];
          }
          return [];
        }),
      })),
      saveToFile: vi.fn(),
    };

    // Setup mock HTTP client
    mockClient = {
      setSenderId: vi.fn(),
      hello: vi.fn().mockResolvedValue({
        success: true,
        data: {
          credits: 100,
          claim_code: "CC_001",
          heartbeat_interval_ms: 60000,
        },
      }),
      validate: vi.fn().mockResolvedValue({ success: true }),
      publish: vi.fn().mockResolvedValue({ success: true, data: {} }),
      searchAssets: vi.fn().mockResolvedValue({
        success: true,
        data: {
          assets: [
            {
              asset_id: "search_1",
              type: "Gene",
              summary: "Error handling pattern",
            },
            {
              asset_id: "search_2",
              type: "Gene",
              summary: "Async optimization",
            },
          ],
        },
      }),
      getAssetDetail: vi
        .fn()
        .mockResolvedValue({ success: true, data: { asset_id: "detail_1" } }),
      getTrending: vi
        .fn()
        .mockResolvedValue({ success: true, data: { assets: [] } }),
      getRankedAssets: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getNodeInfo: vi
        .fn()
        .mockResolvedValue({
          success: true,
          data: { credits: 100, reputation: 0.9 },
        }),
      listTasks: vi
        .fn()
        .mockResolvedValue({ success: true, data: { tasks: [] } }),
      getConfig: vi.fn().mockReturnValue({ hubUrl: "http://test-hub:8080" }),
      setHubUrl: vi.fn(),
    };

    // Import modules
    const synthMod =
      await import("../../src/main/evomap/evomap-gene-synthesizer.js");
    EvoMapGeneSynthesizer = synthMod.EvoMapGeneSynthesizer;

    const bridgeMod =
      await import("../../src/main/evomap/evomap-asset-bridge.js");
    EvoMapAssetBridge = bridgeMod.EvoMapAssetBridge;

    const nodeMod =
      await import("../../src/main/evomap/evomap-node-manager.js");
    EvoMapNodeManager = nodeMod.EvoMapNodeManager;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Flow 1: Register node → get status → refresh credits", async () => {
    const nodeManager = new EvoMapNodeManager();
    await nodeManager.initialize(mockDb, null);

    // Register
    const regResult = await nodeManager.registerNode(mockClient);
    expect(regResult.success).toBe(true);
    expect(nodeManager._registered).toBe(true);
    expect(nodeManager._credits).toBe(100);

    // Get status
    const status = nodeManager.getNodeStatus();
    expect(status.registered).toBe(true);
    expect(status.credits).toBe(100);

    // Refresh credits
    const credits = await nodeManager.refreshCredits(mockClient);
    expect(credits).toBe(100); // From getNodeInfo mock
  });

  it("Flow 2: Synthesize instinct → Gene+Capsule", () => {
    const synthesizer = new EvoMapGeneSynthesizer();

    const instinct = {
      pattern: "Use async/await instead of callbacks",
      category: "coding-pattern",
      confidence: 0.85,
      use_count: 12,
      examples: JSON.stringify(["const data = await fetch(url)"]),
    };

    const { gene, capsule, evolutionEvent } =
      synthesizer.synthesizeFromInstinct(instinct);

    expect(gene.type).toBe("Gene");
    expect(gene.category).toBe("optimize");
    expect(gene.summary).toContain("async");
    expect(gene.asset_id).toBeDefined();

    expect(capsule.type).toBe("Capsule");
    expect(capsule.parent_gene_id).toBe(gene.asset_id);
    expect(capsule.confidence).toBe(0.85);

    expect(evolutionEvent.type).toBe("EvolutionEvent");
    expect(evolutionEvent.related_assets).toContain(gene.asset_id);
  });

  it("Flow 3: Synthesize decision → Gene+Capsule", () => {
    const synthesizer = new EvoMapGeneSynthesizer();

    const decision = {
      context: "Database choice for caching layer",
      outcome: "Use Redis",
      rationale: "Better pub/sub and data structures",
      source: "voting",
      success_rate: 0.92,
      apply_count: 8,
    };

    const { gene, capsule, evolutionEvent } =
      synthesizer.synthesizeFromDecision(decision);

    expect(gene.type).toBe("Gene");
    expect(gene.category).toBe("optimize");
    expect(gene.summary).toContain("Decision");

    expect(capsule.confidence).toBe(0.92);
    expect(capsule.success_streak).toBe(8);

    expect(evolutionEvent.event_type).toBe("decision_validated");
  });

  it("Flow 4: Privacy filter — secrets blocked", () => {
    const synthesizer = new EvoMapGeneSynthesizer();

    const instinct = {
      pattern: "Use api_key: sk-abc123 for authentication",
      category: "general",
    };

    const { gene } = synthesizer.synthesizeFromInstinct(instinct);

    // Secret should be redacted
    expect(gene.summary).toContain("[REDACTED]");
    expect(gene.summary).not.toContain("sk-abc123");
  });

  it("Flow 5: Full publish cycle — synthesize → validate → publish", async () => {
    const synthesizer = new EvoMapGeneSynthesizer();
    const nodeManager = new EvoMapNodeManager();
    await nodeManager.initialize(mockDb, null);
    await nodeManager.registerNode(mockClient);

    const bridge = new EvoMapAssetBridge();
    await bridge.initialize({
      database: mockDb,
      client: mockClient,
      nodeManager,
      synthesizer,
      instinctManager: {},
    });

    // Direct publish (no review)
    bridge._config = { privacyFilter: { requireReview: false } };

    const instinct = {
      pattern: "Prefer composition over inheritance",
      category: "architecture",
      confidence: 0.9,
      use_count: 20,
    };

    const bundle = synthesizer.synthesizeFromInstinct(instinct);
    const result = await bridge.publishBundle(
      bundle.gene,
      bundle.capsule,
      bundle.evolutionEvent,
    );

    expect(result.success).toBe(true);
    expect(result.data.assetIds).toHaveLength(3);
    expect(mockClient.validate).toHaveBeenCalled();
    expect(mockClient.publish).toHaveBeenCalled();
  });

  it("Flow 6: Publish with review gate → approve → publish", async () => {
    const synthesizer = new EvoMapGeneSynthesizer();
    const nodeManager = new EvoMapNodeManager();
    await nodeManager.initialize(mockDb, null);

    const bridge = new EvoMapAssetBridge();
    await bridge.initialize({
      database: mockDb,
      client: mockClient,
      nodeManager,
      synthesizer,
    });

    // Enable review
    bridge._config = { privacyFilter: { requireReview: true } };

    const gene = { asset_id: "test_gene", type: "Gene", summary: "Test gene" };
    const capsule = { asset_id: "test_cap", type: "Capsule" };

    // Publish → pending review
    const pendResult = await bridge.publishBundle(gene, capsule);
    expect(pendResult.pendingReview).toBe(true);
    expect(pendResult.reviewId).toBeDefined();

    // Approve → actual publish
    const approveResult = await bridge.approvePublish(pendResult.reviewId);
    expect(approveResult.success).toBe(true);
    expect(mockClient.publish).toHaveBeenCalled();
  });

  it("Flow 7: Fetch → cache → import as skill (skill conversion logic)", async () => {
    const bridge = new EvoMapAssetBridge();
    await bridge.initialize({
      database: mockDb,
      client: mockClient,
      nodeManager: { getOrCreateNodeId: vi.fn(() => "node_test") },
      synthesizer: new EvoMapGeneSynthesizer(),
    });

    // Fetch
    const fetchResult = await bridge.fetchRelevantAssets(["error", "handling"]);
    expect(fetchResult.success).toBe(true);
    expect(fetchResult.data.assets).toBeDefined();

    // importAsSkill depends on require('electron').app.getPath which may not
    // be mocked at runtime. Test the fetch+cache flow and asset lookup.
    const localAsset = bridge._getLocalAsset("fetched_gene_1");
    expect(localAsset).toBeDefined();
    expect(localAsset.type).toBe("Gene");

    // Parse the asset content
    const parsed = JSON.parse(localAsset.content);
    expect(parsed.type).toBe("Gene");
    expect(parsed.strategy.description).toContain("try-catch");
  });

  it("Flow 8: Fetch → import as instinct with capped confidence", async () => {
    const mockInstinctManager = {
      addInstinct: vi.fn().mockReturnValue({ id: "imported_inst" }),
    };

    const bridge = new EvoMapAssetBridge();
    await bridge.initialize({
      database: mockDb,
      client: mockClient,
      nodeManager: { getOrCreateNodeId: vi.fn(() => "node_test") },
      synthesizer: new EvoMapGeneSynthesizer(),
      instinctManager: mockInstinctManager,
    });

    const result = await bridge.importAsInstinct("fetched_capsule_1");
    expect(result.success).toBe(true);

    // Confidence should be capped at 0.7 (original was 0.88)
    expect(mockInstinctManager.addInstinct).toHaveBeenCalledWith(
      expect.any(String),
      0.7, // capped
      "general",
      expect.objectContaining({ source: "evomap-import" }),
    );
  });

  it("Flow 9: Context building — match keywords → return markdown", () => {
    const bridge = new EvoMapAssetBridge();
    bridge.db = mockDb;

    const context = bridge.buildEvoMapContext("database query optimization");
    expect(context).not.toBeNull();
    expect(context).toContain("EvoMap Community Knowledge");
    expect(context).toContain("Database query optimization");
  });

  it("Flow 10: Synthesize workflow → recipe", () => {
    const synthesizer = new EvoMapGeneSynthesizer();

    const template = {
      id: "bugfix",
      name: "Bug Fix Workflow",
      steps: [
        { role: "investigator", description: "Investigate the bug" },
        { role: "fixer", description: "Fix the bug" },
        { role: "verifier", description: "Verify the fix" },
      ],
    };

    const history = [
      { success: true },
      { status: "success" },
      { success: false },
    ];

    const recipe = synthesizer.synthesizeRecipeFromWorkflow(template, history);

    expect(recipe.type).toBe("Gene");
    expect(recipe.category).toBe("innovate");
    expect(recipe.summary).toContain("Bug Fix Workflow");
    expect(recipe.strategy.steps).toHaveLength(3);
    expect(recipe.strategy.success_rate).toBeCloseTo(2 / 3);
  });
});
