import { describe, expect, it, vi } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

describe("video generation renderer-to-IPC governed boundary", () => {
  it("rejects before a renderer request can reach a video provider", async () => {
    const generator = require("../../src/main/video/video-generator.js");
    const getLLMConfig = vi.fn();
    const generateVideo = vi.fn();
    const previousConfig = generator._deps.getLLMConfig;
    const previousProvider = generator._deps.volcengine;
    generator._deps.getLLMConfig = getLLMConfig;
    generator._deps.volcengine = { generateVideo };
    try {
      await expect(
        generator.generateVideo({
          prompt: "private video prompt",
          outputPath: "/private/out.mp4",
        }),
      ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
      expect(getLLMConfig).not.toHaveBeenCalled();
      expect(generateVideo).not.toHaveBeenCalled();
    } finally {
      generator._deps.getLLMConfig = previousConfig;
      generator._deps.volcengine = previousProvider;
    }
  });
});
