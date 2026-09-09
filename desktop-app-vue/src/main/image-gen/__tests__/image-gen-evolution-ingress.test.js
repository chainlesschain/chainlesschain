import { afterEach, describe, expect, it, vi } from "vitest";

const { ImageGenManager } = require("../image-gen-manager.js");
const { SDClient } = require("../sd-client.js");
const { DALLEClient } = require("../dalle-client.js");

const INGRESS_ERROR = "CC_AGENT_EVOLUTION_INGRESS_FAILED";

function expectIngressFailure(promise) {
  return expect(promise).rejects.toMatchObject({ code: INGRESS_ERROR });
}

describe("legacy image generation evolution ingress", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects every legacy manager content entry before cache or provider calls", async () => {
    const manager = new ImageGenManager();
    manager.cache.set("cached", { success: true });
    manager.cacheTimestamps.set("cached", Date.now());
    manager.providerStatus.sd_local = true;
    manager.providerStatus.dalle = true;

    const txt2img = vi.spyOn(manager.sdClient, "txt2img");
    const img2img = vi.spyOn(manager.sdClient, "img2img");
    const upscale = vi.spyOn(manager.sdClient, "upscale");
    const variation = vi.spyOn(manager.dalleClient, "createVariation");

    await expectIngressFailure(manager.generate("cached"));
    await expectIngressFailure(manager.img2img("prompt", "base64-image"));
    await expectIngressFailure(manager.upscale("base64-image"));
    await expectIngressFailure(manager.createVariations("base64-image"));

    expect(txt2img).not.toHaveBeenCalled();
    expect(img2img).not.toHaveBeenCalled();
    expect(upscale).not.toHaveBeenCalled();
    expect(variation).not.toHaveBeenCalled();
  });

  it("keeps exported provider clients fail-closed before fetch", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const stableDiffusion = new SDClient();
    const dalle = new DALLEClient();

    await expectIngressFailure(stableDiffusion.txt2img("prompt"));
    await expectIngressFailure(
      stableDiffusion.img2img("prompt", "base64-image"),
    );
    await expectIngressFailure(stableDiffusion.upscale("base64-image"));
    await expectIngressFailure(dalle.generate("prompt"));
    await expectIngressFailure(dalle.createVariation("base64-image"));
    await expectIngressFailure(
      dalle.edit("base64-image", "prompt", "base64-mask"),
    );

    expect(fetch).not.toHaveBeenCalled();
  });
});
