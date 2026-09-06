// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
const { VisionManager } = require("../../../src/main/ai-engine/vision-manager");

describe("VisionManager governed multimodal ingress", () => {
  it("fails closed before dispatching image analysis to a provider", async () => {
    const manager = new VisionManager();
    manager.llavaClient = { analyzeImage: vi.fn() };
    manager.cloudClient = { chatWithMessages: vi.fn() };

    await expect(
      manager.analyzeImage({ imageBase64: "private-image" }),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });

    expect(manager.llavaClient.analyzeImage).not.toHaveBeenCalled();
    expect(manager.cloudClient.chatWithMessages).not.toHaveBeenCalled();
  });

  it("fails closed before dispatching streamed image analysis", async () => {
    const manager = new VisionManager();
    manager.llavaClient = { analyzeImageStream: vi.fn() };

    await expect(
      manager.analyzeImageStream({ imageBase64: "private-image" }, vi.fn()),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });

    expect(manager.llavaClient.analyzeImageStream).not.toHaveBeenCalled();
  });
});
