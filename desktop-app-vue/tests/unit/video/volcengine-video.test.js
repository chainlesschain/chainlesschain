// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const provider = require("../../../src/main/video/providers/volcengine-video.js");
const generator = require("../../../src/main/video/video-generator.js");

describe("Volcengine video governed multimodal ingress", () => {
  it("rejects a direct provider call before creating a remote task", async () => {
    const fetch = vi.fn();
    const originalFetch = provider._deps.fetch;
    provider._deps.fetch = fetch;
    try {
      await expect(
        provider.generateVideo({
          apiKey: "private-key",
          prompt: "private prompt",
          imageUrl: "https://private.example/first-frame.png",
          outputPath: "/private/output.mp4",
        }),
      ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      provider._deps.fetch = originalFetch;
    }
  });

  it("rejects before reading provider configuration or dispatching the router", async () => {
    const getLLMConfig = vi.fn();
    const generateVideo = vi.fn();
    const originalConfig = generator._deps.getLLMConfig;
    const originalProvider = generator._deps.volcengine;
    generator._deps.getLLMConfig = getLLMConfig;
    generator._deps.volcengine = { generateVideo };
    try {
      await expect(
        generator.generateVideo({
          prompt: "private prompt",
          imageUrl: "https://private.example/first-frame.png",
          outputPath: "/private/output.mp4",
        }),
      ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
      expect(getLLMConfig).not.toHaveBeenCalled();
      expect(generateVideo).not.toHaveBeenCalled();
    } finally {
      generator._deps.getLLMConfig = originalConfig;
      generator._deps.volcengine = originalProvider;
    }
  });
});
