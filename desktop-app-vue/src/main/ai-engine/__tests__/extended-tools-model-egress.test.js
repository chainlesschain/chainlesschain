import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ExtendedTools3 = require("../extended-tools-3.js");
const ExtendedTools = require("../extended-tools.js");
const ExtendedTools4 = require("../extended-tools-4.js");

function getRegisteredTool(registrar, targetName) {
  const tools = new Map();
  registrar.registerAll({
    registerTool(name, handler) {
      tools.set(name, handler);
    },
  });
  return tools.get(targetName);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ExtendedTools3 generic HTTP egress", () => {
  it("fails closed before an arbitrary request body can reach an unknown model provider", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const apiRequester = getRegisteredTool(ExtendedTools3, "api_requester");

    await expect(
      apiRequester({
        url: "https://unrecognised-model.example/v1/chat/completions",
        method: "POST",
        headers: { Authorization: "Bearer secret" },
        body: { messages: [{ role: "user", content: "private prompt" }] },
      }),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not start the legacy HTTP client for an arbitrary model-shaped request", async () => {
    const httpClient = getRegisteredTool(ExtendedTools, "http_client");

    await expect(
      httpClient({
        url: "https://unrecognised-model.example/v1/embeddings",
        method: "POST",
        body: { input: "private source text" },
      }),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
  });

  it("does not crawl an arbitrary endpoint before a governed bridge exists", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const webCrawler = getRegisteredTool(ExtendedTools4, "web_crawler");

    await expect(
      webCrawler({
        url: "https://unrecognised-model.example/v1/models?prompt=private",
        headers: { Authorization: "Bearer secret" },
      }),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
