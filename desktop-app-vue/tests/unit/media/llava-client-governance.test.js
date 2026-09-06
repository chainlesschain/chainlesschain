// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

const { LLaVAClient } = require("../../../src/main/llm/llava-client.js");

describe("LLaVAClient governed multimodal ingress", () => {
  it.each([
    [
      "image analysis",
      (client) => client.analyzeImage({ imageBase64: "private" }),
    ],
    [
      "streamed image analysis",
      (client) =>
        client.analyzeImageStream({ imageBase64: "private" }, vi.fn()),
    ],
    [
      "image chat",
      (client) => client.chat([{ role: "user", images: ["private"] }]),
    ],
  ])(
    "rejects %s before calling the local model service",
    async (_name, invoke) => {
      const client = new LLaVAClient();
      const post = vi.spyOn(client.client, "post");

      await expect(invoke(client)).rejects.toMatchObject({
        code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
      });
      expect(post).not.toHaveBeenCalled();
    },
  );
});
