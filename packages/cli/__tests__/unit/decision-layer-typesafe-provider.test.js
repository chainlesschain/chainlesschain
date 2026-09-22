import { describe, expect, it, vi } from "vitest";

import { createTypeSafeDecisionProvider } from "../../src/lib/decision-layer/typesafe-provider.js";

describe("TypeSafe decision provider", () => {
  it("sends only the typed payload to the System One endpoint", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        model: "jev-1.13",
        answers: { verdict: { type: "noul", noul: 0.8 } },
        usage: { input_tokens: 5, output_tokens: 1 },
      }),
    }));
    const provider = createTypeSafeDecisionProvider({
      apiKey: "secret-key",
      model: "jev-1.13",
      fetchImpl,
    });
    const result = await provider.decide({
      payload: {
        state: { task: "repair tests" },
        questions: {
          verdict: { type: "noul", instructions: "Is this relevant?" },
        },
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.typesafe.ai/v1/systemone",
      expect.objectContaining({ method: "POST" }),
    );
    const request = fetchImpl.mock.calls[0][1];
    expect(JSON.parse(request.body)).toEqual({
      model: "jev-1.13",
      state: { task: "repair tests" },
      questions: {
        verdict: { type: "noul", instructions: "Is this relevant?" },
      },
    });
    expect(result).toMatchObject({
      provider: "typesafe",
      model: "jev-1.13",
      usage: { input_tokens: 5, output_tokens: 1 },
    });
  });

  it("rejects plaintext remote endpoints", () => {
    expect(() =>
      createTypeSafeDecisionProvider({
        apiKey: "key",
        baseUrl: "http://example.com",
      }),
    ).toThrow("HTTPS or loopback");
  });
});
