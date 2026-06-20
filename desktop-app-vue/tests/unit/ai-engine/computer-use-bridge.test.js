import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * computer-use-bridge 初始化幂等性测试
 *
 * 回归点：当浏览器引擎与 LLM 服务都不可用时，旧实现仍把 initialized 置为
 * true，使后续 `if (initialized) return` 永久跳过重试——组件稍后就绪也再不连接。
 */

vi.mock("../../../src/main/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../src/main/ai-engine/extended-tools-computeruse", () => ({
  setBrowserEngine: vi.fn(),
  setLLMService: vi.fn(),
  setCurrentTarget: vi.fn(),
  getToolExecutor: vi.fn(() => ({})),
}));

describe("computer-use-bridge initialize", () => {
  let bridge;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod =
      await import("../../../src/main/ai-engine/computer-use-bridge.js");
    bridge = mod.default || mod;
  });

  it("retries on a later call when no component was available at first init", async () => {
    bridge._deps.getBrowserEngine = () => null;
    bridge._deps.getLLMManager = () => null;

    // First init: nothing available — must NOT be marked initialized, otherwise
    // the `if (initialized) return` guard would block all future attempts.
    await bridge.initializeComputerUseBridge();
    expect(bridge.getStatus().initialized).toBe(false);

    // Components become available; a second call should now connect + finish.
    bridge._deps.getBrowserEngine = () => ({ id: "browser-engine" });
    await bridge.initializeComputerUseBridge();
    expect(bridge.getStatus().initialized).toBe(true);
  });
});
