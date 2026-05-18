/**
 * Unit tests for EvoMapClient
 * @module evomap/evomap-client.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let EvoMapClient, getEvoMapClient;

describe("EvoMapClient", () => {
  beforeEach(async () => {
    vi.resetModules();

    vi.doMock("uuid", () => ({
      v4: vi.fn(() => "test-uuid-1234"),
    }));

    vi.doMock("../../../src/main/utils/logger.js", () => ({
      logger: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      },
    }));

    // Mock axios — the constructor calls axios.create()
    vi.doMock("axios", () => {
      const mockInst = {
        request: vi.fn().mockResolvedValue({}),
        defaults: { baseURL: "" },
        interceptors: {
          request: { use: vi.fn(), clear: vi.fn() },
          response: { use: vi.fn(), clear: vi.fn() },
        },
      };
      const createFn = vi.fn(() => mockInst);
      return { default: { create: createFn }, create: createFn };
    });

    const mod = await import("../../../src/main/evomap/evomap-client.js");
    EvoMapClient = mod.EvoMapClient;
    getEvoMapClient = mod.getEvoMapClient;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Create a client, replace client.client with a fresh mock, mock _sleep.
   * The source uses this.client.request() — we replace it with a vi.fn().
   */
  function createClient(opts) {
    const client = new EvoMapClient(opts);
    const mock = {
      request: vi.fn().mockResolvedValue({}),
      defaults: { baseURL: "" },
      interceptors: {
        request: { use: vi.fn(), clear: vi.fn() },
        response: { use: vi.fn(), clear: vi.fn() },
      },
    };
    client.client = mock;
    client._sleep = vi.fn().mockResolvedValue(undefined);
    return client;
  }

  // ============================================================
  // Constructor & Initialization
  // ============================================================

  describe("constructor", () => {
    it("should create with default options", () => {
      const client = createClient();
      expect(client.hubUrl).toBeDefined();
      expect(client.timeout).toBe(30000);
      expect(client.maxRetries).toBe(3);
      expect(client.senderId).toBeNull();
    });

    it("should create with custom options", () => {
      const client = createClient({
        hubUrl: "http://custom:8080",
        timeout: 5000,
        maxRetries: 1,
      });
      expect(client.hubUrl).toBe("http://custom:8080");
      expect(client.timeout).toBe(5000);
      expect(client.maxRetries).toBe(1);
    });

    it("should initialize stats", () => {
      const client = createClient();
      const stats = client.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.successfulRequests).toBe(0);
      expect(stats.failedRequests).toBe(0);
      expect(stats.retries).toBe(0);
    });

    it("should set the client property", () => {
      const client = createClient();
      expect(client.client).toBeDefined();
      expect(client.client).not.toBeNull();
    });
  });

  // ============================================================
  // Interceptors
  // ============================================================

  /**
   * Helper: create a client with a spy client that captures interceptor fns.
   */
  function createClientForInterceptors() {
    const client = new EvoMapClient();
    // Build a fresh mock client with use() that captures functions
    let reqFulfill, resFulfill, resReject;
    const spyClient = {
      request: vi.fn().mockResolvedValue({}),
      defaults: { baseURL: "" },
      interceptors: {
        request: {
          use: vi.fn((fn) => {
            reqFulfill = fn;
          }),
          clear: vi.fn(),
        },
        response: {
          use: vi.fn((success, reject) => {
            resFulfill = success;
            resReject = reject;
          }),
          clear: vi.fn(),
        },
      },
    };
    client.client = spyClient;
    // Re-run interceptor setup on the new spy client
    client._setupRequestInterceptor();
    client._setupResponseInterceptor();
    return {
      client,
      reqFulfill: () => reqFulfill,
      resFulfill: () => resFulfill,
      resReject: () => resReject,
    };
  }

  describe("interceptors", () => {
    it("request interceptor should add X-Request-ID header", () => {
      const { reqFulfill } = createClientForInterceptors();
      const fn = reqFulfill();
      expect(fn).toBeDefined();
      const config = { method: "get", url: "/test", headers: {} };
      const result = fn(config);
      expect(result.headers["X-Request-ID"]).toBeDefined();
    });

    it("response interceptor should return response.data on success", () => {
      const { resFulfill } = createClientForInterceptors();
      const fn = resFulfill();
      expect(fn).toBeDefined();
      const result = fn({ data: { payload: "test" } });
      expect(result).toEqual({ payload: "test" });
    });

    it("response interceptor should create enhanced error on HTTP error", async () => {
      const { resReject } = createClientForInterceptors();
      const fn = resReject();
      expect(fn).toBeDefined();
      const error = {
        response: { status: 500, data: { message: "Server error" } },
        message: "fail",
      };
      await expect(fn(error)).rejects.toMatchObject({
        status: 500,
        isHttpError: true,
        isTransient: true,
      });
    });

    it("response interceptor should create network error on no response", async () => {
      const { resReject } = createClientForInterceptors();
      const fn = resReject();
      expect(fn).toBeDefined();
      const error = {
        request: {},
        code: "ECONNREFUSED",
        message: "connection refused",
      };
      await expect(fn(error)).rejects.toMatchObject({
        isNetworkError: true,
        isTransient: true,
        code: "ECONNREFUSED",
      });
    });
  });

  // ============================================================
  // Sender Identity
  // ============================================================

  describe("setSenderId", () => {
    it("should set the sender ID", () => {
      const client = createClient();
      client.setSenderId("node_abc");
      expect(client.senderId).toBe("node_abc");
    });
  });

  // ============================================================
  // Protocol Envelope
  // ============================================================

  describe("_buildEnvelope", () => {
    it("should build correct envelope structure", () => {
      const client = createClient();
      client.setSenderId("node_test");
      const envelope = client._buildEnvelope("hello", { foo: "bar" });

      expect(envelope.protocol).toBe("GEP-A2A");
      expect(envelope.protocol_version).toBe("1.0.0");
      expect(envelope.message_type).toBe("hello");
      expect(envelope.sender_id).toBe("node_test");
      expect(envelope.message_id).toBeDefined();
      expect(envelope.timestamp).toBeDefined();
      expect(envelope.payload).toEqual({ foo: "bar" });
    });

    it('should use "unknown" when no senderId set', () => {
      const client = createClient();
      const envelope = client._buildEnvelope("hello");
      expect(envelope.sender_id).toBe("unknown");
    });
  });

  // ============================================================
  // Core A2A Endpoints
  // ============================================================

  describe("hello()", () => {
    it("should send hello and return success", async () => {
      const client = createClient();
      client.client.request.mockResolvedValue({ payload: { credits: 50 } });

      const result = await client.hello();
      expect(result.success).toBe(true);
      expect(client.client.request).toHaveBeenCalled();
    });

    it("should return error on failure", async () => {
      const client = createClient();
      client.client.request.mockRejectedValue(new Error("Connection failed"));

      const result = await client.hello();
      expect(result.success).toBe(false);
      expect(result.error).toContain("Connection failed");
    });

    it("should return error if client unavailable", async () => {
      const client = createClient();
      client.client = null;

      const result = await client.hello();
      expect(result.success).toBe(false);
      expect(result.error).toContain("not available");
    });
  });

  describe("publish()", () => {
    it("should publish assets and return success", async () => {
      const client = createClient();
      client.client.request.mockResolvedValue({
        payload: { status: "ok" },
      });

      const result = await client.publish([{ type: "Gene" }]);
      expect(result.success).toBe(true);
    });

    it("should reject empty assets array", async () => {
      const client = createClient();
      const result = await client.publish([]);
      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });

    it("should reject null assets", async () => {
      const client = createClient();
      const result = await client.publish(null);
      expect(result.success).toBe(false);
    });
  });

  describe("validate()", () => {
    it("should validate assets successfully", async () => {
      const client = createClient();
      client.client.request.mockResolvedValue({
        payload: { computed_ids: [] },
      });

      const result = await client.validate([{ type: "Gene" }]);
      expect(result.success).toBe(true);
    });

    it("should reject empty assets", async () => {
      const client = createClient();
      const result = await client.validate([]);
      expect(result.success).toBe(false);
    });
  });

  describe("fetch()", () => {
    it("should fetch assets successfully", async () => {
      const client = createClient();
      client.client.request.mockResolvedValue({ payload: { assets: [] } });

      const result = await client.fetch({ signals: ["test"] });
      expect(result.success).toBe(true);
    });
  });

  describe("report()", () => {
    it("should report on an asset", async () => {
      const client = createClient();
      client.client.request.mockResolvedValue({ payload: {} });

      const result = await client.report("asset_1", { valid: true });
      expect(result.success).toBe(true);
    });

    it("should reject missing target asset ID", async () => {
      const client = createClient();
      const result = await client.report(null, {});
      expect(result.success).toBe(false);
    });
  });

  describe("revoke()", () => {
    it("should revoke an asset", async () => {
      const client = createClient();
      client.client.request.mockResolvedValue({ payload: {} });

      const result = await client.revoke("asset_1", "outdated");
      expect(result.success).toBe(true);
    });

    it("should reject missing asset ID", async () => {
      const client = createClient();
      const result = await client.revoke(null);
      expect(result.success).toBe(false);
    });
  });

  // ============================================================
  // REST Discovery Endpoints
  // ============================================================

  describe("searchAssets()", () => {
    it("should search with signals, type, and sort", async () => {
      const client = createClient();
      client.client.request.mockResolvedValue({ assets: [] });

      const result = await client.searchAssets(
        ["test", "query"],
        "Gene",
        "relevance",
      );
      expect(result.success).toBe(true);

      const callConfig = client.client.request.mock.calls[0][0];
      expect(callConfig.params.signals).toBe("test,query");
      expect(callConfig.params.type).toBe("Gene");
      expect(callConfig.params.sort).toBe("relevance");
    });
  });

  describe("getAssetDetail()", () => {
    it("should get asset detail", async () => {
      const client = createClient();
      client.client.request.mockResolvedValue({ asset_id: "a1" });

      const result = await client.getAssetDetail("a1");
      expect(result.success).toBe(true);
    });

    it("should reject missing asset ID", async () => {
      const client = createClient();
      const result = await client.getAssetDetail(null);
      expect(result.success).toBe(false);
    });
  });

  describe("getRankedAssets()", () => {
    it("should cap limit at 100", async () => {
      const client = createClient();
      client.client.request.mockResolvedValue([]);

      await client.getRankedAssets("Gene", 200);
      const callConfig = client.client.request.mock.calls[0][0];
      expect(callConfig.params.limit).toBe(100);
    });
  });

  describe("getTrending()", () => {
    it("should get trending assets", async () => {
      const client = createClient();
      client.client.request.mockResolvedValue({ assets: [] });

      const result = await client.getTrending();
      expect(result.success).toBe(true);
    });
  });

  // ============================================================
  // Task/Bounty Endpoints
  // ============================================================

  describe("listTasks()", () => {
    it("should list tasks with filters", async () => {
      const client = createClient();
      client.client.request.mockResolvedValue({ tasks: [] });

      const result = await client.listTasks(0.5, 10);
      expect(result.success).toBe(true);
    });
  });

  describe("claimTask()", () => {
    it("should claim a task", async () => {
      const client = createClient();
      client.client.request.mockResolvedValue({});

      const result = await client.claimTask("task_1");
      expect(result.success).toBe(true);
    });

    it("should reject missing task ID", async () => {
      const client = createClient();
      const result = await client.claimTask(null);
      expect(result.success).toBe(false);
    });
  });

  describe("completeTask()", () => {
    it("should complete a task", async () => {
      const client = createClient();
      client.client.request.mockResolvedValue({});

      const result = await client.completeTask("task_1", "asset_1");
      expect(result.success).toBe(true);
    });

    it("should reject missing IDs", async () => {
      const client = createClient();
      const result = await client.completeTask(null, null);
      expect(result.success).toBe(false);
    });
  });

  // ============================================================
  // Node Info
  // ============================================================

  describe("getNodeInfo()", () => {
    it("should get node info", async () => {
      const client = createClient();
      client.client.request.mockResolvedValue({ reputation: 0.9 });

      const result = await client.getNodeInfo("node_1");
      expect(result.success).toBe(true);
    });

    it("should reject missing node ID", async () => {
      const client = createClient();
      const result = await client.getNodeInfo(null);
      expect(result.success).toBe(false);
    });
  });

  describe("getHubStats()", () => {
    it("should get hub stats", async () => {
      const client = createClient();
      client.client.request.mockResolvedValue({ totalAssets: 100 });

      const result = await client.getHubStats();
      expect(result.success).toBe(true);
    });
  });

  // ============================================================
  // Asset ID Computation
  // ============================================================

  describe("computeAssetId", () => {
    it("should compute SHA-256 hash of canonical JSON", () => {
      const asset = { type: "Gene", summary: "test" };
      const id = EvoMapClient.computeAssetId(asset);
      expect(id).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it("should exclude asset_id from hash computation", () => {
      const asset1 = { type: "Gene", summary: "test" };
      const asset2 = { type: "Gene", summary: "test", asset_id: "sha256:abc" };
      expect(EvoMapClient.computeAssetId(asset1)).toBe(
        EvoMapClient.computeAssetId(asset2),
      );
    });

    it("should produce different hashes for different content", () => {
      const id1 = EvoMapClient.computeAssetId({ type: "Gene", summary: "a" });
      const id2 = EvoMapClient.computeAssetId({ type: "Gene", summary: "b" });
      expect(id1).not.toBe(id2);
    });

    it("should sort keys for canonical JSON", () => {
      const id1 = EvoMapClient.computeAssetId({ b: 2, a: 1 });
      const id2 = EvoMapClient.computeAssetId({ a: 1, b: 2 });
      expect(id1).toBe(id2);
    });
  });

  // ============================================================
  // Configuration
  // ============================================================

  describe("setHubUrl()", () => {
    it("should update hub URL", () => {
      const client = createClient();
      client.setHubUrl("http://new-hub:8080");
      expect(client.hubUrl).toBe("http://new-hub:8080");
      expect(client.client.defaults.baseURL).toBe("http://new-hub:8080");
    });

    it("should reject invalid URL", () => {
      const client = createClient();
      const original = client.hubUrl;
      client.setHubUrl("");
      expect(client.hubUrl).toBe(original);
    });
  });

  describe("getConfig()", () => {
    it("should return configuration summary", () => {
      const client = createClient();
      const config = client.getConfig();
      expect(config).toHaveProperty("hubUrl");
      expect(config).toHaveProperty("timeout");
      expect(config).toHaveProperty("maxRetries");
      expect(config).toHaveProperty("senderId");
      expect(config).toHaveProperty("isAvailable");
      expect(config.isAvailable).toBe(true);
    });
  });

  // ============================================================
  // Retry Logic
  // ============================================================

  describe("_isRetryableError", () => {
    it("should return true for transient errors", () => {
      const client = createClient();
      expect(client._isRetryableError({ isTransient: true })).toBe(true);
    });

    it("should return true for network errors", () => {
      const client = createClient();
      expect(client._isRetryableError({ isNetworkError: true })).toBe(true);
    });

    it("should return true for transient error codes", () => {
      const client = createClient();
      expect(client._isRetryableError({ code: "ECONNRESET" })).toBe(true);
    });

    it("should return true for transient status codes", () => {
      const client = createClient();
      expect(client._isRetryableError({ status: 429 })).toBe(true);
      expect(client._isRetryableError({ status: 503 })).toBe(true);
    });

    it("should return false for non-retryable errors", () => {
      const client = createClient();
      expect(client._isRetryableError({ status: 400 })).toBe(false);
      expect(client._isRetryableError({ status: 404 })).toBe(false);
      expect(client._isRetryableError({})).toBe(false);
    });
  });

  describe("_requestWithRetry", () => {
    it("should return on first success", async () => {
      const client = createClient();
      client.client.request.mockResolvedValue({ data: "ok" });

      const result = await client._requestWithRetry("get", "/test");
      expect(result).toEqual({ data: "ok" });
      expect(client.client.request).toHaveBeenCalledTimes(1);
    });

    it("should throw non-retryable errors immediately", async () => {
      const client = createClient();
      client.maxRetries = 2;
      const err = new Error("bad request");
      err.status = 400;
      client.client.request.mockRejectedValue(err);

      await expect(client._requestWithRetry("get", "/test")).rejects.toThrow();
      expect(client.client.request).toHaveBeenCalledTimes(1);
    });

    it("should retry retryable errors up to max", async () => {
      const client = createClient();
      client.maxRetries = 1;

      const err = new Error("transient");
      err.isTransient = true;
      client.client.request.mockRejectedValue(err);

      await expect(client._requestWithRetry("get", "/test")).rejects.toThrow();
      // attempt 0 + 1 retry = 2 calls
      expect(client.client.request).toHaveBeenCalledTimes(2);
      expect(client._sleep).toHaveBeenCalled();
    });
  });

  // ============================================================
  // Destroy
  // ============================================================

  describe("destroy()", () => {
    it("should clear interceptors and null client", () => {
      const client = createClient();
      const reqClear = client.client.interceptors.request.clear;
      const resClear = client.client.interceptors.response.clear;

      client.destroy();

      expect(reqClear).toHaveBeenCalled();
      expect(resClear).toHaveBeenCalled();
      expect(client.client).toBeNull();
      expect(client.senderId).toBeNull();
    });
  });

  // ============================================================
  // Singleton
  // ============================================================

  describe("getEvoMapClient()", () => {
    it("should return a singleton instance", () => {
      const instance1 = getEvoMapClient();
      const instance2 = getEvoMapClient();
      expect(instance1).toBe(instance2);
    });

    it("should create new instance when forceNew is true", () => {
      const instance1 = getEvoMapClient();
      const instance2 = getEvoMapClient({}, true);
      expect(instance2).not.toBe(instance1);
    });
  });
});
