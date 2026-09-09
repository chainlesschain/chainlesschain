import { describe, expect, it, vi } from "vitest";

const PluginAPI = require("../plugin-api.js");

function createPluginApi(fetch = vi.fn()) {
  return {
    api: new PluginAPI(
      "example-plugin",
      { requirePermission: vi.fn() },
      { pluginNetworkFetch: fetch },
    ).api,
    fetch,
  };
}

describe("PluginAPI model egress boundary", () => {
  it.each([
    "https://api.openai.com/v1/responses",
    "https://api.anthropic.com/v1/messages",
    "https://api.mistral.ai/v1/chat/completions",
    "https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent",
    "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    "http://localhost:11434/api/generate",
  ])("rejects the known direct model endpoint %s before fetch", async (url) => {
    const { api, fetch } = createPluginApi();

    await expect(
      api.network.fetch(url, { body: "canary-model-prompt" }),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the separately permitted generic HTTPS API available", async () => {
    const response = { ok: true };
    const { api, fetch } = createPluginApi(vi.fn().mockResolvedValue(response));

    await expect(api.network.fetch("https://example.test/resource")).resolves.toBe(
      response,
    );
    expect(fetch).toHaveBeenCalledWith("https://example.test/resource", {
      timeout: 30000,
    });
  });
});
