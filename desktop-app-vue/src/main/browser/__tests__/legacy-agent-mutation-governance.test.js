import { describe, expect, it, vi } from "vitest";

const { BrowserAutomationAgent } = require("../browser-automation-agent");
const { ActionType, ComputerUseAgent } = require("../computer-use-agent");

function engineFixture() {
  return {
    act: vi.fn(),
    createContext: vi.fn(),
    getPage: vi.fn(),
    navigate: vi.fn(),
    openTab: vi.fn(),
    screenshot: vi.fn(async () => Buffer.from("safe-screenshot")),
    takeSnapshot: vi.fn(),
  };
}

describe("legacy Agent mutation governance", () => {
  it.each(["navigate", "click", "type", "select"])(
    "blocks BrowserAutomationAgent %s before browser mutation",
    async (action) => {
      const engine = engineFixture();
      const agent = new BrowserAutomationAgent({}, engine);

      await expect(
        agent._executeStep("tab-1", {
          action,
          url: "https://example.test/",
          ref: "button-1",
          text: "private",
          value: "choice",
        }),
      ).rejects.toMatchObject({
        code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
        action,
        authorityMode: "dedicated-action-required",
      });
      expect(engine.navigate).not.toHaveBeenCalled();
      expect(engine.act).not.toHaveBeenCalled();
    },
  );

  it.each([
    ActionType.CLICK,
    ActionType.DOUBLE_CLICK,
    ActionType.RIGHT_CLICK,
    ActionType.MOUSE_MOVE,
    ActionType.DRAG,
    ActionType.TYPE,
    ActionType.KEY,
    ActionType.SHORTCUT,
    ActionType.SCROLL,
    ActionType.VISION_CLICK,
    ActionType.NAVIGATE,
    ActionType.BACK,
    ActionType.FORWARD,
    ActionType.REFRESH,
    ActionType.DESKTOP_CLICK,
    ActionType.DESKTOP_TYPE,
  ])("blocks ComputerUseAgent %s before dispatch", async (type) => {
    const engine = engineFixture();
    const agent = new ComputerUseAgent();
    agent.browserEngine = engine;

    await expect(
      agent._executeAction(
        {
          type,
          url: "https://example.test/",
          ref: "button-1",
          text: "private",
        },
        "tab-1",
      ),
    ).rejects.toMatchObject({
      code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
      action: type,
    });
    expect(engine.navigate).not.toHaveBeenCalled();
    expect(engine.act).not.toHaveBeenCalled();
    expect(engine.getPage).not.toHaveBeenCalled();
  });

  it("blocks ComputerUseAgent openTab before context or page creation", async () => {
    const engine = engineFixture();
    const agent = new ComputerUseAgent();
    agent.browserEngine = engine;
    agent.isInitialized = true;

    await expect(agent.openTab("https://example.test/")).rejects.toMatchObject({
      code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
      action: "open-tab",
    });
    expect(engine.createContext).not.toHaveBeenCalled();
    expect(engine.openTab).not.toHaveBeenCalled();
  });

  it("retains non-mutating ComputerUseAgent screenshot dispatch", async () => {
    const engine = engineFixture();
    const agent = new ComputerUseAgent();
    agent.browserEngine = engine;

    await expect(
      agent._executeAction({ type: ActionType.SCREENSHOT }, "tab-1"),
    ).resolves.toMatchObject({ success: true });
    expect(engine.screenshot).toHaveBeenCalledWith("tab-1", {
      type: ActionType.SCREENSHOT,
    });
  });
});
