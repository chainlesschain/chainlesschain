/**
 * Browser VisionAction is deliberately unavailable until image bytes can use
 * the same authenticated Raw/projection/response-evidence lifecycle as text.
 */

import { describe, expect, it, vi } from "vitest";

const { VisionAction, VisionModel } = require("../vision-action");

function createVisionAction() {
  const page = {
    screenshot: vi.fn().mockResolvedValue(Buffer.from("private-image")),
    viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 720 }),
  };
  const llmService = { chat: vi.fn() };
  return {
    page,
    llmService,
    action: new VisionAction(
      { getPage: vi.fn().mockReturnValue(page) },
      llmService,
    ),
  };
}

describe("VisionAction governed multimodal ingress", () => {
  it("rejects before capturing a screenshot or calling a model", async () => {
    const { action, page, llmService } = createVisionAction();

    await expect(
      action.analyze("tab-1", "describe the page"),
    ).rejects.toMatchObject({
      code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
    });

    expect(page.screenshot).not.toHaveBeenCalled();
    expect(llmService.chat).not.toHaveBeenCalled();
  });

  it.each([
    ["locate", (action) => action.locateElement("tab-1", "login button")],
    ["click", (action) => action.visualClick("tab-1", "login button")],
    ["compare", (action) => action.compareWithBaseline("tab-1", "baseline")],
    ["task", (action) => action.executeVisualTask("tab-1", "submit the form")],
  ])(
    "rejects %s workflows without provider dispatch",
    async (_name, invoke) => {
      const { action, page, llmService } = createVisionAction();

      await expect(invoke(action)).rejects.toMatchObject({
        code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
      });

      expect(page.screenshot).not.toHaveBeenCalled();
      expect(llmService.chat).not.toHaveBeenCalled();
    },
  );

  it("does not replay a cached image analysis without authenticated evidence", async () => {
    const { action, page, llmService } = createVisionAction();
    action.analysisCache.set("tab-1:describe the page", {
      result: { success: true, analysis: "stale image result" },
      timestamp: Date.now(),
    });

    await expect(
      action.analyze("tab-1", "describe the page"),
    ).rejects.toMatchObject({
      code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
    });

    expect(page.screenshot).not.toHaveBeenCalled();
    expect(llmService.chat).not.toHaveBeenCalled();
  });

  it("retains pure message-shape helpers without dispatching a model", () => {
    const { action, llmService } = createVisionAction();

    const message = action._buildVisionMessage("Describe this", "base64data", {
      model: VisionModel.GPT4_VISION,
    });

    expect(message.content[0].type).toBe("image_url");
    expect(llmService.chat).not.toHaveBeenCalled();
  });
});
