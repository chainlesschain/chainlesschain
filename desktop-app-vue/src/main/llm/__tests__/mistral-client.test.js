import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const { MistralClient } = require("../mistral-client");
const { OpenAIClient } = require("../openai-client");

describe("MistralClient", () => {
  it("should extend OpenAIClient", () => {
    const client = new MistralClient({ apiKey: "test-key" });
    expect(client).toBeInstanceOf(OpenAIClient);
  });

  it("should set default Mistral baseURL", () => {
    const client = new MistralClient({ apiKey: "test-key" });
    expect(client.baseURL).toBe("https://api.mistral.ai/v1");
  });

  it("should set default model to mistral-large-latest", () => {
    const client = new MistralClient({ apiKey: "test-key" });
    expect(client.model).toBe("mistral-large-latest");
  });

  it("should set default embedding model to mistral-embed", () => {
    const client = new MistralClient({ apiKey: "test-key" });
    expect(client.embeddingModel).toBe("mistral-embed");
  });

  it("should accept custom config", () => {
    const client = new MistralClient({
      apiKey: "custom-key",
      baseURL: "https://custom.mistral.ai/v1",
      model: "mistral-small-latest",
      embeddingModel: "custom-embed",
    });
    expect(client.apiKey).toBe("custom-key");
    expect(client.baseURL).toBe("https://custom.mistral.ai/v1");
    expect(client.model).toBe("mistral-small-latest");
    expect(client.embeddingModel).toBe("custom-embed");
  });
});
