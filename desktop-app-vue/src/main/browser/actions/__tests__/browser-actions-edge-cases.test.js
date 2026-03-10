import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { CoordinateAction } = require("../coordinate-action.js");
const {
  NetworkInterceptor,
  InterceptType,
} = require("../network-interceptor.js");
const { VisionAction } = require("../vision-action.js");

let mockPage, mockEngine;

beforeEach(() => {
  mockPage = {
    mouse: {
      click: vi.fn().mockResolvedValue(undefined),
      move: vi.fn().mockResolvedValue(undefined),
      down: vi.fn().mockResolvedValue(undefined),
      up: vi.fn().mockResolvedValue(undefined),
      wheel: vi.fn().mockResolvedValue(undefined),
    },
    viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 720 }),
    evaluate: vi.fn().mockResolvedValue(null),
    route: vi.fn().mockResolvedValue(undefined),
    unroute: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
    screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-png")),
    waitForRequest: vi.fn(),
    waitForResponse: vi.fn(),
  };
  mockEngine = {
    getPage: vi.fn().mockReturnValue(mockPage),
  };
});

describe("CoordinateAction Edge Cases", () => {
  let coordAction;

  beforeEach(() => {
    coordAction = new CoordinateAction(mockEngine);
  });

  it("clickAt with negative coordinates still calls mouse.click", async () => {
    const result = await coordAction.clickAt("tab1", -10, -20);

    expect(mockPage.mouse.click).toHaveBeenCalledWith(-10, -20, {
      button: "left",
      clickCount: 1,
      delay: 0,
    });
    expect(result.success).toBe(true);
    expect(result.x).toBe(-10);
    expect(result.y).toBe(-20);
  });

  it("moveTo with smooth=true uses interpolation steps", async () => {
    // Set a known starting position
    coordAction.mousePosition = { x: 0, y: 0 };

    const steps = 5;
    await coordAction.moveTo("tab1", 100, 100, { smooth: true, steps });

    // _smoothMove calls mouse.move once per step
    expect(mockPage.mouse.move).toHaveBeenCalledTimes(steps);
    // Final position should be close to target
    const lastCall = mockPage.mouse.move.mock.calls[steps - 1];
    expect(lastCall[0]).toBeCloseTo(100, 0);
    expect(lastCall[1]).toBeCloseTo(100, 0);
  });

  it("drawPath with single point throws or handles gracefully", async () => {
    await expect(
      coordAction.drawPath("tab1", [{ x: 50, y: 50 }]),
    ).rejects.toThrow("At least 2 points required for drawing path");
  });

  it("ratioToCoordinate clamps to viewport at boundaries", async () => {
    const topLeft = await coordAction.ratioToCoordinate("tab1", 0, 0);
    expect(topLeft).toEqual({ x: 0, y: 0 });

    const bottomRight = await coordAction.ratioToCoordinate("tab1", 1, 1);
    expect(bottomRight).toEqual({ x: 1280, y: 720 });
  });
});

describe("NetworkInterceptor Edge Cases", () => {
  let interceptor;

  beforeEach(() => {
    interceptor = new NetworkInterceptor(mockEngine);
  });

  it("addRule with string urlPattern converts to regex", () => {
    const ruleId = interceptor.addRule({
      urlPattern: "https://api.example.com/*",
      type: InterceptType.ABORT,
    });

    expect(ruleId).toBeTruthy();
    const rule = interceptor.interceptRules.get(ruleId);
    expect(rule).toBeDefined();
    expect(rule.urlMatcher).toBeInstanceOf(RegExp);
    // The converted regex should match the original pattern
    expect(rule.urlMatcher.test("https://api.example.com/users")).toBe(true);
    expect(rule.urlMatcher.test("https://other.com/api")).toBe(false);
  });

  it("getRequestLog with regex urlPattern filter", () => {
    // Manually add entries to the request log
    interceptor.requestLog.push(
      { url: "https://api.example.com/users", method: "GET", timestamp: 1 },
      { url: "https://api.example.com/posts", method: "GET", timestamp: 2 },
      { url: "https://cdn.example.com/image.png", method: "GET", timestamp: 3 },
    );

    const filtered = interceptor.getRequestLog({
      urlPattern: "api\\.example\\.com",
    });
    expect(filtered).toHaveLength(2);
    expect(filtered[0].url).toContain("api.example.com");
    expect(filtered[1].url).toContain("api.example.com");
  });

  it("clearRules removes all rules", () => {
    interceptor.addRule({ urlPattern: "/api/*", type: InterceptType.ABORT });
    interceptor.addRule({ urlPattern: "/cdn/*", type: InterceptType.ABORT });
    interceptor.addRule({ urlPattern: "/ws/*", type: InterceptType.ABORT });

    expect(interceptor.interceptRules.size).toBe(3);

    interceptor.clearRules();

    expect(interceptor.interceptRules.size).toBe(0);
  });

  it("mockAPI creates a MOCK type rule", () => {
    const ruleId = interceptor.mockAPI("/api/users", {
      status: 200,
      body: { users: [] },
    });

    expect(ruleId).toBeTruthy();
    const rule = interceptor.interceptRules.get(ruleId);
    expect(rule).toBeDefined();
    expect(rule.type).toBe(InterceptType.MOCK);
    expect(rule.response.status).toBe(200);
    expect(rule.response.body).toBe(JSON.stringify({ users: [] }));
  });
});

describe("VisionAction Edge Cases", () => {
  it("analyze throws when no LLM service configured", async () => {
    const vision = new VisionAction(mockEngine, null);

    await expect(vision.analyze("tab1", "describe this page")).rejects.toThrow(
      "LLM Service not configured",
    );
  });

  it("analyze returns cached result within TTL", async () => {
    const mockLLM = {
      chat: vi.fn().mockResolvedValue({ text: '{"description": "test page"}' }),
    };
    const vision = new VisionAction(mockEngine, mockLLM);

    const first = await vision.analyze("tab1", "describe this");
    const second = await vision.analyze("tab1", "describe this");

    // LLM should only be called once; second call uses cache
    expect(mockLLM.chat).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("locateElement handles LLM returning malformed JSON", async () => {
    const mockLLM = {
      chat: vi
        .fn()
        .mockResolvedValue({ text: "I cannot find any JSON here, sorry!" }),
    };
    const vision = new VisionAction(mockEngine, mockLLM);

    const result = await vision.locateElement("tab1", "red button");

    // Should gracefully return a not-found result instead of throwing
    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to parse element location");
    expect(result.rawResponse).toBeDefined();
  });

  it("clearCache empties the analysis cache", async () => {
    const mockLLM = {
      chat: vi.fn().mockResolvedValue({ text: '{"description": "cached"}' }),
    };
    const vision = new VisionAction(mockEngine, mockLLM);

    await vision.analyze("tab1", "describe this");
    expect(vision.analysisCache.size).toBe(1);

    vision.clearCache();
    expect(vision.analysisCache.size).toBe(0);

    // Next call should hit LLM again
    await vision.analyze("tab1", "describe this");
    expect(mockLLM.chat).toHaveBeenCalledTimes(2);
  });
});
