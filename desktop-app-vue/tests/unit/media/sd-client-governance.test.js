import { describe, expect, it, vi } from "vitest";

const { SDClient } = require("../../../src/main/image-gen/sd-client");

describe("SDClient governance", () => {
  it.each([
    ["status", (client) => client.checkStatus()],
    ["text generation", (client) => client.txt2img("draw a safe icon")],
    ["image generation", (client) => client.img2img("edit", "aW1hZ2U=")],
    ["upscale", (client) => client.upscale("aW1hZ2U=")],
  ])("blocks %s before fetch", async (_name, invoke) => {
    const client = new SDClient();
    const fetch = vi.fn();
    globalThis.fetch = fetch;

    const result = await Promise.resolve(invoke(client)).catch((error) => error);
    if (result instanceof Error)
      expect(result).toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
    else expect(result.error).toContain("governed multimodal ingress");
    expect(fetch).not.toHaveBeenCalled();
  });
});
