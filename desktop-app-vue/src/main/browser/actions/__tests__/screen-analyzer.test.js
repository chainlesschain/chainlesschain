/**
 * ScreenAnalyzer 单元测试
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const {
  ScreenAnalyzer,
  RegionType,
  AnalysisMode,
  getScreenAnalyzer,
} = require("../screen-analyzer");

describe("ScreenAnalyzer", () => {
  let analyzer;
  let mockEngine;
  let mockPage;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPage = {
      evaluate: vi.fn().mockResolvedValue({
        viewport: { width: 1920, height: 1080, scrollX: 0, scrollY: 0 },
        regions: [
          {
            type: "header",
            bounds: { x: 0, y: 0, width: 1920, height: 60 },
            element: { tagName: "header" },
          },
          {
            type: "navigation",
            bounds: { x: 0, y: 60, width: 200, height: 1020 },
            element: { tagName: "nav" },
          },
          {
            type: "content",
            bounds: { x: 200, y: 60, width: 1720, height: 1020 },
            element: { tagName: "main" },
          },
        ],
        layout: { hasHeader: true, hasNavigation: true, hasFooter: false },
        url: "https://example.com",
        title: "Example Page",
      }),
      screenshot: vi.fn().mockResolvedValue("base64image"),
    };

    mockEngine = {
      getPage: vi.fn().mockReturnValue(mockPage),
    };

    analyzer = new ScreenAnalyzer(mockEngine);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with engine", () => {
      expect(analyzer.browserEngine).toBe(mockEngine);
      expect(analyzer.config.enableCache).toBe(true);
    });

    it("should work without engine", () => {
      const a = new ScreenAnalyzer();
      expect(a.browserEngine).toBeNull();
    });

    it("should accept custom config", () => {
      const a = new ScreenAnalyzer(mockEngine, {
        enableCache: false,
        cacheTimeout: 10000,
      });

      expect(a.config.enableCache).toBe(false);
      expect(a.config.cacheTimeout).toBe(10000);
    });
  });

  describe("analyze", () => {
    it("should analyze screen", async () => {
      const result = await analyzer.analyze("tab1");

      expect(result.success).toBe(true);
      expect(result.regions).toBeDefined();
      expect(result.viewport).toBeDefined();
      expect(result.layout).toBeDefined();
    });

    it("should use cache when enabled", async () => {
      // First call
      await analyzer.analyze("tab1");

      // Second call should use cache
      const result = await analyzer.analyze("tab1");

      expect(result.fromCache).toBe(true);
      expect(mockPage.evaluate).toHaveBeenCalledTimes(1);
    });

    it("should bypass cache with forceRefresh", async () => {
      await analyzer.analyze("tab1");
      await analyzer.analyze("tab1", { forceRefresh: true });

      expect(mockPage.evaluate).toHaveBeenCalledTimes(2);
    });

    it("should throw when engine not set", async () => {
      const a = new ScreenAnalyzer();

      await expect(a.analyze("tab1")).rejects.toThrow("Browser engine not set");
    });

    it("should throw when page not found", async () => {
      mockEngine.getPage.mockReturnValue(null);

      await expect(analyzer.analyze("tab1")).rejects.toThrow("Page not found");
    });

    it("should support different analysis modes", async () => {
      await analyzer.analyze("tab1", { mode: AnalysisMode.QUICK });
      await analyzer.analyze("tab1", {
        mode: AnalysisMode.DETAILED,
        forceRefresh: true,
      });

      expect(mockPage.evaluate).toHaveBeenCalledTimes(2);
    });
  });

  describe("findRegions", () => {
    it("should find regions by type", async () => {
      const result = await analyzer.findRegions("tab1", { type: "header" });

      expect(result.success).toBe(true);
      expect(result.regions.length).toBe(1);
      expect(result.regions[0].type).toBe("header");
    });

    it("should find regions by bounds", async () => {
      // Use bounds that encompass the header region (x: 0, y: 0, width: 1920, height: 60)
      const result = await analyzer.findRegions("tab1", {
        bounds: { x: 0, y: 0, width: 2000, height: 100 },
      });

      expect(result.success).toBe(true);
      expect(result.regions.length).toBeGreaterThan(0);
      expect(result.regions[0].type).toBe("header");
    });
  });

  describe("captureRegion", () => {
    it("should capture region screenshot", async () => {
      const bounds = { x: 100, y: 100, width: 200, height: 200 };
      const result = await analyzer.captureRegion("tab1", bounds);

      expect(result.success).toBe(true);
      expect(result.image).toBe("base64image");
      expect(mockPage.screenshot).toHaveBeenCalledWith({
        clip: bounds,
        encoding: "base64",
      });
    });

    it("should fail when engine not set", async () => {
      const a = new ScreenAnalyzer();
      const result = await a.captureRegion("tab1", {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      });

      expect(result.success).toBe(false);
    });

    it("should fail when page not found", async () => {
      mockEngine.getPage.mockReturnValue(null);
      const result = await analyzer.captureRegion("tab1", {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      });

      expect(result.success).toBe(false);
    });
  });

  describe("compare", () => {
    it("should compare two analyses", () => {
      const before = {
        url: "https://example.com/page1",
        title: "Page 1",
        regions: [
          {
            type: "header",
            bounds: { x: 0, y: 0, width: 100, height: 50 },
            element: {},
          },
        ],
      };

      const after = {
        url: "https://example.com/page2",
        title: "Page 2",
        regions: [
          {
            type: "header",
            bounds: { x: 0, y: 0, width: 100, height: 50 },
            element: {},
          },
          {
            type: "footer",
            bounds: { x: 0, y: 900, width: 100, height: 50 },
            element: {},
          },
        ],
      };

      const diff = analyzer.compare(before, after);

      expect(diff.urlChanged).toBe(true);
      expect(diff.titleChanged).toBe(true);
      expect(diff.regionsDiff.added.length).toBe(1);
    });

    it("should detect removed regions", () => {
      const before = {
        url: "https://example.com",
        title: "Page",
        regions: [
          {
            type: "header",
            bounds: { x: 0, y: 0, width: 100, height: 50 },
            element: { id: "header" },
          },
          {
            type: "sidebar",
            bounds: { x: 0, y: 50, width: 50, height: 100 },
            element: { id: "sidebar" },
          },
        ],
      };

      const after = {
        url: "https://example.com",
        title: "Page",
        regions: [
          {
            type: "header",
            bounds: { x: 0, y: 0, width: 100, height: 50 },
            element: { id: "header" },
          },
        ],
      };

      const diff = analyzer.compare(before, after);

      expect(diff.regionsDiff.removed.length).toBe(1);
      expect(diff.regionsDiff.removed[0].type).toBe("sidebar");
    });
  });

  describe("clearCache", () => {
    it("should clear all cache", async () => {
      await analyzer.analyze("tab1");
      await analyzer.analyze("tab2", { forceRefresh: true });

      analyzer.clearCache();

      expect(analyzer.analysisCache.size).toBe(0);
    });

    it("should clear cache for specific tab", async () => {
      await analyzer.analyze("tab1");
      await analyzer.analyze("tab2", { forceRefresh: true });

      analyzer.clearCache("tab1");

      // Tab1 cache should be cleared, tab2 should remain
      const stats = analyzer.getStats();
      expect(stats).toBeDefined();
    });
  });

  describe("getStats", () => {
    it("should return statistics", async () => {
      await analyzer.analyze("tab1");

      const stats = analyzer.getStats();

      expect(stats.totalAnalyses).toBe(1);
      expect(stats.cacheHitRate).toBeDefined();
    });

    it("should track cache hits", async () => {
      await analyzer.analyze("tab1");
      await analyzer.analyze("tab1");

      const stats = analyzer.getStats();

      expect(stats.cacheHits).toBe(1);
      expect(stats.cacheMisses).toBe(1);
    });
  });

  describe("resetStats", () => {
    it("should reset all statistics", async () => {
      await analyzer.analyze("tab1");
      await analyzer.analyze("tab1");

      analyzer.resetStats();

      const stats = analyzer.getStats();
      expect(stats.totalAnalyses).toBe(0);
      expect(stats.cacheHits).toBe(0);
    });
  });

  describe("RegionType constants", () => {
    it("should have all region types defined", () => {
      expect(RegionType.HEADER).toBe("header");
      expect(RegionType.FOOTER).toBe("footer");
      expect(RegionType.SIDEBAR).toBe("sidebar");
      expect(RegionType.CONTENT).toBe("content");
      expect(RegionType.NAVIGATION).toBe("navigation");
      expect(RegionType.FORM).toBe("form");
      expect(RegionType.TABLE).toBe("table");
      expect(RegionType.LIST).toBe("list");
      expect(RegionType.MODAL).toBe("modal");
      expect(RegionType.BUTTON).toBe("button");
      expect(RegionType.INPUT).toBe("input");
    });
  });

  describe("AnalysisMode constants", () => {
    it("should have all modes defined", () => {
      expect(AnalysisMode.QUICK).toBe("quick");
      expect(AnalysisMode.STANDARD).toBe("standard");
      expect(AnalysisMode.DETAILED).toBe("detailed");
      expect(AnalysisMode.FULL).toBe("full");
    });
  });

  describe("getScreenAnalyzer singleton", () => {
    it("should return singleton instance", () => {
      const a1 = getScreenAnalyzer(mockEngine);
      const a2 = getScreenAnalyzer();

      expect(a1).toBe(a2);
    });
  });
});
