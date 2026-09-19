import { describe, expect, it, vi } from "vitest";

const {
  bindDesktopModelIngressClient,
  createDesktopModelIngressHost,
} = require("../../evolution/desktop-model-ingress");
const {
  LLMManager,
  captureDesktopGovernedVisionModelClient,
  createDesktopGovernedVisionModelClient,
} = require("../llm-manager");

describe("governed Desktop vision model client", () => {
  it("cannot be minted from an unsigned or uninitialized manager", () => {
    const plain = new LLMManager({ enableStateBus: false });
    expect(() => createDesktopGovernedVisionModelClient(plain)).toThrow(
      /governed, initialized/u,
    );

    const host = createDesktopModelIngressHost(async () => null);
    const notInitialized = new LLMManager({ enableStateBus: false }, host);
    expect(() =>
      createDesktopGovernedVisionModelClient(notInitialized),
    ).toThrow(/governed, initialized/u);
  });

  it("uses an opaque branded port and bypasses raw multimodal text/cache projection", async () => {
    const host = createDesktopModelIngressHost(async () => null);
    const responseCache = {
      get: vi.fn(),
      set: vi.fn(),
      getEvidenceReceipt: vi.fn(),
      setEvidenceReceipt: vi.fn(),
    };
    const promptCompressor = { compress: vi.fn() };
    const transport = {
      model: "vision-test",
      chat: vi.fn().mockResolvedValue({
        message: { role: "assistant", content: "observed" },
        model: "vision-test",
        usage: { total_tokens: 4 },
      }),
    };
    bindDesktopModelIngressClient(transport, host);
    const manager = new LLMManager(
      {
        enableStateBus: false,
        provider: "openai",
        model: "vision-test",
        responseCache,
        promptCompressor,
      },
      host,
    );
    manager.client = transport;
    manager.isInitialized = true;
    const opaque = createDesktopGovernedVisionModelClient(manager);
    const port = captureDesktopGovernedVisionModelClient(opaque);
    const messages = [
      { role: "system", content: "inspect" },
      { role: "user", content: "context 1" },
      { role: "assistant", content: "context 2" },
      { role: "user", content: "context 3" },
      { role: "assistant", content: "context 4" },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: "data:image/jpeg;base64,cHJpdmF0ZQ==" },
          },
          { type: "text", text: "describe" },
        ],
      },
    ];

    await expect(
      port.chat(messages, { max_tokens: 32 }),
    ).resolves.toMatchObject({ content: "observed" });

    expect(transport.chat).toHaveBeenCalledWith(
      messages,
      expect.objectContaining({
        max_tokens: 32,
        skipCache: true,
        skipCompression: true,
      }),
    );
    expect(responseCache.get).not.toHaveBeenCalled();
    expect(responseCache.set).not.toHaveBeenCalled();
    expect(promptCompressor.compress).not.toHaveBeenCalled();
    expect(Object.keys(opaque)).toEqual([]);
    expect(Object.isFrozen(opaque)).toBe(true);
    expect(() =>
      captureDesktopGovernedVisionModelClient(new Proxy(opaque, {})),
    ).toThrow(/branded governed/u);
  });

  it("admits implemented local/Gemini protocols, rejects unknown providers, and rechecks switches", async () => {
    const host = createDesktopModelIngressHost(async () => null);
    for (const provider of ["ollama", "gemini"]) {
      const supported = new LLMManager(
        { enableStateBus: false, provider },
        host,
      );
      supported.client = bindDesktopModelIngressClient({ chat: vi.fn() }, host);
      supported.isInitialized = true;
      expect(() =>
        createDesktopGovernedVisionModelClient(supported),
      ).not.toThrow();
    }

    const unsupported = new LLMManager(
      { enableStateBus: false, provider: "unsupported" },
      host,
    );
    unsupported.client = bindDesktopModelIngressClient({ chat: vi.fn() }, host);
    unsupported.isInitialized = true;
    expect(() => createDesktopGovernedVisionModelClient(unsupported)).toThrow(
      /supported vision protocol/u,
    );

    const manager = new LLMManager(
      { enableStateBus: false, provider: "openai" },
      host,
    );
    manager.client = bindDesktopModelIngressClient({ chat: vi.fn() }, host);
    manager.isInitialized = true;
    const opaque = createDesktopGovernedVisionModelClient(manager);
    const port = captureDesktopGovernedVisionModelClient(opaque);

    manager.provider = "unsupported";
    await expect(port.chat([{ role: "user", content: "x" }])).rejects.toThrow(
      /supported vision protocol/u,
    );
    expect(manager.client.chat).not.toHaveBeenCalled();
  });
});
