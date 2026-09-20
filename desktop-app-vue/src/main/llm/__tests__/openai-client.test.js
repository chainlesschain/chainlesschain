import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { isRetryableTransportError, OpenAIClient } = require("../openai-client");

describe("OpenAIClient status ingress", () => {
  const transport = { get: vi.fn(), post: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the control-plane model listing for Volcengine without invoking chat", async () => {
    transport.get.mockResolvedValue({
      data: { data: [{ id: "doubao-seed", created: 1, owned_by: "volc" }] },
    });
    const client = new OpenAIClient({
      baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    });
    client.client = transport;

    await expect(client.checkStatus()).resolves.toEqual({
      available: true,
      models: [{ name: "doubao-seed", created: 1, owned_by: "volc" }],
    });
    expect(transport.get).toHaveBeenCalledWith("/models");
    expect(transport.post).not.toHaveBeenCalled();
  });

  it("classifies retries only from allowlisted transport identifiers", () => {
    expect(isRetryableTransportError({ code: "ETIMEDOUT" })).toBe(true);
    expect(isRetryableTransportError({ code: "ERR_NETWORK" })).toBe(true);
    expect(isRetryableTransportError({ name: "TimeoutError" })).toBe(true);
    expect(
      isRetryableTransportError({
        code: "PRIVATE_PROVIDER_FAILURE",
        message: "timeout with private provider payload",
      }),
    ).toBe(false);

    const hostile = new Proxy(new Error("private provider payload"), {
      get() {
        throw new Error("provider error inspection blocked");
      },
    });
    expect(isRetryableTransportError(hostile)).toBe(false);
  });
});
