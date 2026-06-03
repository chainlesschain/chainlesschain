/**
 * MarketplaceClient Unit Tests
 *
 * Covers constructor, authentication, listPlugins, searchPlugins,
 * getPluginDetail, getFeatured, getPopular, getCategories, downloadPlugin,
 * ratePlugin, getRatings, reportPlugin, publishPlugin, updatePluginMetadata,
 * deletePlugin, approvePlugin, rejectPlugin, setBaseURL, checkHealth,
 * _isRetryableError, getConfig, getStats, resetStats, destroy, singleton.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Instead of mocking axios at module level (CJS/ESM interop issue),
// we spy on the client's internal axios instance after construction.
const {
  MarketplaceClient,
  getMarketplaceClient,
} = require("../marketplace-client.js");

/**
 * Replace the internal axios client with a controllable mock.
 * This avoids the CJS/ESM mock problem entirely.
 */
function stubClient(client) {
  const mockRequest = vi.fn();
  const mockGet = vi.fn();
  client.client = {
    request: mockRequest,
    get: mockGet,
    defaults: { baseURL: client.baseURL, headers: { common: {} } },
    interceptors: {
      request: { use: vi.fn(), handlers: [] },
      response: { use: vi.fn(), handlers: [] },
    },
  };
  return { mockRequest, mockGet };
}

describe("MarketplaceClient", () => {
  let client;
  let mockRequest;
  let mockGet;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new MarketplaceClient({
      baseURL: "http://test:8090/api",
      timeout: 5000,
      maxRetries: 0,
    });
    // Replace the real axios client with our mock
    const stubs = stubClient(client);
    mockRequest = stubs.mockRequest;
    mockGet = stubs.mockGet;
  });

  // ── Constructor ────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("should initialize with defaults", () => {
      const c = new MarketplaceClient();
      expect(c.baseURL).toContain("localhost:8090");
      expect(c.timeout).toBe(30000);
      expect(c.maxRetries).toBe(3);
      expect(c.authToken).toBeNull();
    });

    it("should accept custom options", () => {
      expect(client.baseURL).toBe("http://test:8090/api");
      expect(client.timeout).toBe(5000);
      expect(client.maxRetries).toBe(0);
    });

    it("should initialize stats", () => {
      const s = client.getStats();
      expect(s.totalRequests).toBe(0);
      expect(s.failedRequests).toBe(0);
    });
  });

  // ── Auth ───────────────────────────────────────────────────────────────

  describe("authentication", () => {
    it("should set auth token", () => {
      client.setAuthToken("jwt-123");
      expect(client.hasAuthToken()).toBe(true);
    });

    it("should clear auth token", () => {
      client.setAuthToken("jwt-123");
      client.setAuthToken(null);
      expect(client.hasAuthToken()).toBe(false);
    });

    it("hasAuthToken returns false initially", () => {
      expect(client.hasAuthToken()).toBe(false);
    });
  });

  // ── Config / Stats ────────────────────────────────────────────────────

  describe("getConfig", () => {
    it("should return config", () => {
      const c = client.getConfig();
      expect(c.baseURL).toBe("http://test:8090/api");
      expect(c.isAvailable).toBe(true);
    });
  });

  describe("resetStats", () => {
    it("should reset to zero", () => {
      client._stats.totalRequests = 10;
      client.resetStats();
      expect(client.getStats().totalRequests).toBe(0);
    });
  });

  // ── listPlugins ────────────────────────────────────────────────────────

  describe("listPlugins", () => {
    it("should call request", async () => {
      mockRequest.mockResolvedValue({ success: true, data: { items: [] } });
      const r = await client.listPlugins({ category: "tools" });
      expect(r.success).toBe(true);
    });

    it("should return error when client unavailable", async () => {
      client.client = null;
      const r = await client.listPlugins();
      expect(r.success).toBe(false);
      expect(r.error).toContain("not available");
    });
  });

  // ── searchPlugins ──────────────────────────────────────────────────────

  describe("searchPlugins", () => {
    it("should reject empty keyword", async () => {
      const r = await client.searchPlugins("");
      expect(r.success).toBe(false);
      expect(r.error).toContain("keyword");
    });

    it("should reject null keyword", async () => {
      const r = await client.searchPlugins(null);
      expect(r.success).toBe(false);
    });

    it("should call search endpoint", async () => {
      mockRequest.mockResolvedValue({ success: true, data: { items: [] } });
      const r = await client.searchPlugins("test", { category: "ai" });
      expect(r.success).toBe(true);
    });
  });

  // ── getPluginDetail ────────────────────────────────────────────────────

  describe("getPluginDetail", () => {
    it("should reject empty ID", async () => {
      const r = await client.getPluginDetail("");
      expect(r.success).toBe(false);
    });

    it("should call detail endpoint", async () => {
      mockRequest.mockResolvedValue({ success: true, data: { id: "p1" } });
      const r = await client.getPluginDetail("p1");
      expect(r.success).toBe(true);
    });
  });

  // ── getFeatured / getPopular / getCategories ──────────────────────────

  describe("getFeatured", () => {
    it("should request featured", async () => {
      mockRequest.mockResolvedValue({ success: true, data: [] });
      const r = await client.getFeatured(5);
      expect(r.success).toBe(true);
    });
  });

  describe("getPopular", () => {
    it("should request popular", async () => {
      mockRequest.mockResolvedValue({ success: true, data: [] });
      const r = await client.getPopular(10);
      expect(r.success).toBe(true);
    });
  });

  describe("getCategories", () => {
    it("should request categories", async () => {
      mockRequest.mockResolvedValue({ success: true, data: ["tools"] });
      const r = await client.getCategories();
      expect(r.success).toBe(true);
    });
  });

  // ── downloadPlugin ────────────────────────────────────────────────────

  describe("downloadPlugin", () => {
    it("should reject empty ID", async () => {
      const r = await client.downloadPlugin("");
      expect(r.success).toBe(false);
    });

    it("should download with version", async () => {
      mockRequest.mockResolvedValue({
        success: true,
        data: { url: "http://cdn/test.zip" },
      });
      const r = await client.downloadPlugin("p1", "1.0.0");
      expect(r.success).toBe(true);
    });
  });

  // ── ratePlugin ────────────────────────────────────────────────────────

  describe("ratePlugin", () => {
    it("should reject rating > 5", async () => {
      const r = await client.ratePlugin("p1", 6);
      expect(r.success).toBe(false);
    });

    it("should reject NaN rating", async () => {
      const r = await client.ratePlugin("p1", "abc");
      expect(r.success).toBe(false);
    });

    it("should reject missing pluginId", async () => {
      const r = await client.ratePlugin("", 5);
      expect(r.success).toBe(false);
    });

    it("should submit valid rating", async () => {
      mockRequest.mockResolvedValue({
        success: true,
        data: { ratingId: "r1" },
      });
      const r = await client.ratePlugin("p1", 4, "Great");
      expect(r.success).toBe(true);
    });
  });

  // ── getRatings ────────────────────────────────────────────────────────

  describe("getRatings", () => {
    it("should reject empty pluginId", async () => {
      const r = await client.getRatings("");
      expect(r.success).toBe(false);
    });

    it("should fetch ratings", async () => {
      mockRequest.mockResolvedValue({ success: true, data: { items: [] } });
      const r = await client.getRatings("p1");
      expect(r.success).toBe(true);
    });
  });

  // ── reportPlugin ──────────────────────────────────────────────────────

  describe("reportPlugin", () => {
    it("should reject empty reason", async () => {
      const r = await client.reportPlugin("p1", "");
      expect(r.success).toBe(false);
    });

    it("should reject empty pluginId", async () => {
      const r = await client.reportPlugin("", "spam");
      expect(r.success).toBe(false);
    });

    it("should submit report", async () => {
      mockRequest.mockResolvedValue({ success: true, data: {} });
      const r = await client.reportPlugin("p1", "Contains malware");
      expect(r.success).toBe(true);
    });
  });

  // ── publishPlugin ─────────────────────────────────────────────────────

  describe("publishPlugin", () => {
    it("should reject missing name/version", async () => {
      const r = await client.publishPlugin(
        { description: "test" },
        Buffer.from("data"),
      );
      expect(r.success).toBe(false);
    });

    it("should reject missing file buffer", async () => {
      const r = await client.publishPlugin(
        { name: "test", version: "1.0.0" },
        null,
      );
      expect(r.success).toBe(false);
    });
  });

  // ── updatePluginMetadata ──────────────────────────────────────────────

  describe("updatePluginMetadata", () => {
    it("should reject missing ID", async () => {
      const r = await client.updatePluginMetadata("", { name: "new" });
      expect(r.success).toBe(false);
    });

    it("should reject empty data", async () => {
      const r = await client.updatePluginMetadata("p1", {});
      expect(r.success).toBe(false);
    });

    it("should update metadata", async () => {
      mockRequest.mockResolvedValue({ success: true, data: { id: "p1" } });
      const r = await client.updatePluginMetadata("p1", {
        description: "Updated",
      });
      expect(r.success).toBe(true);
    });
  });

  // ── deletePlugin ──────────────────────────────────────────────────────

  describe("deletePlugin", () => {
    it("should reject missing ID", async () => {
      const r = await client.deletePlugin("");
      expect(r.success).toBe(false);
    });

    it("should delete", async () => {
      mockRequest.mockResolvedValue({ success: true, data: {} });
      const r = await client.deletePlugin("p1");
      expect(r.success).toBe(true);
    });
  });

  // ── Admin ─────────────────────────────────────────────────────────────

  describe("approvePlugin", () => {
    it("should reject missing ID", async () => {
      const r = await client.approvePlugin("");
      expect(r.success).toBe(false);
    });

    it("should approve", async () => {
      mockRequest.mockResolvedValue({ success: true, data: {} });
      const r = await client.approvePlugin("p1");
      expect(r.success).toBe(true);
    });
  });

  describe("rejectPlugin", () => {
    it("should reject missing reason", async () => {
      const r = await client.rejectPlugin("p1", "");
      expect(r.success).toBe(false);
    });

    it("should reject plugin", async () => {
      mockRequest.mockResolvedValue({ success: true, data: {} });
      const r = await client.rejectPlugin("p1", "Policy violation");
      expect(r.success).toBe(true);
    });
  });

  // ── setBaseURL ────────────────────────────────────────────────────────

  describe("setBaseURL", () => {
    it("should update URL", () => {
      client.setBaseURL("http://new:8090/api");
      expect(client.baseURL).toBe("http://new:8090/api");
    });

    it("should ignore invalid URL", () => {
      const before = client.baseURL;
      client.setBaseURL("");
      expect(client.baseURL).toBe(before);
    });
  });

  // ── checkHealth ───────────────────────────────────────────────────────

  describe("checkHealth", () => {
    it("should return healthy on success", async () => {
      mockGet.mockResolvedValue({ status: 200 });
      const r = await client.checkHealth();
      expect(r.success).toBe(true);
      expect(r.data.status).toBe("healthy");
    });

    it("should return unhealthy on failure", async () => {
      mockGet.mockRejectedValue(new Error("Connection refused"));
      const r = await client.checkHealth();
      expect(r.success).toBe(false);
      expect(r.data.status).toBe("unhealthy");
    });
  });

  // ── _isRetryableError ─────────────────────────────────────────────────

  describe("_isRetryableError", () => {
    it("should identify transient errors", () => {
      expect(client._isRetryableError({ isTransient: true })).toBe(true);
      expect(client._isRetryableError({ isNetworkError: true })).toBe(true);
      expect(client._isRetryableError({ code: "ECONNRESET" })).toBe(true);
      expect(client._isRetryableError({ status: 503 })).toBe(true);
    });

    it("should reject non-transient errors", () => {
      expect(client._isRetryableError({ status: 400 })).toBe(false);
      expect(client._isRetryableError({ status: 404 })).toBe(false);
      expect(client._isRetryableError(new Error("Unknown"))).toBe(false);
    });
  });

  // ── destroy ───────────────────────────────────────────────────────────

  describe("destroy", () => {
    it("should clean up", () => {
      client.setAuthToken("token");
      client.destroy();
      expect(client.client).toBeNull();
      expect(client.authToken).toBeNull();
    });
  });

  // ── Singleton ─────────────────────────────────────────────────────────

  describe("getMarketplaceClient", () => {
    it("should return instance", () => {
      const inst = getMarketplaceClient({}, true);
      expect(inst).toBeInstanceOf(MarketplaceClient);
    });

    it("should return same instance", () => {
      const inst1 = getMarketplaceClient({}, true);
      const inst2 = getMarketplaceClient();
      expect(inst1).toBe(inst2);
    });
  });
});
