import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatWithTools } from "../helpers/test-model-egress.js";
import { chatWithStreaming } from "../../src/lib/chat-core.js";
import { buildProviderSource } from "../../src/lib/provider-stream.js";
import { probeLlmConnection } from "../../src/lib/llm-connection-probe.js";
import { resolveLlmConnection } from "../../src/lib/llm-connection-resolution.js";
import { reconcileConfigLlmProvider } from "../../src/lib/llm-config-defaults.js";
import {
  makeRunnableProviderFallback,
  pickRunnableProvider,
} from "../../src/lib/runnable-provider.js";

beforeEach(() => {
  vi.stubEnv("CC_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "unrelated-cloud-key");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const endpoints = [
  "http://192.168.31.79:8889/v1",
  "http://localhost:1234/v1",
  "http://127.0.0.1:8000/proxy/v1",
];
const model = "platform/model-alias";
const messages = [{ role: "user", content: "hello" }];

describe("custom OpenAI-compatible platforms", () => {
  it("uses CC_API_KEY for an explicitly configured custom platform", async () => {
    vi.stubEnv("CC_API_KEY", "platform-env-key");
    const options = { provider: "custom", baseUrl: endpoints[1], model };
    expect(resolveLlmConnection(options).apiKey).toBe("platform-env-key");
    const fetch = vi.fn(
      async () =>
        new Response(
          'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n',
        ),
    );
    vi.stubGlobal("fetch", fetch);
    expect(await chatWithStreaming(messages, options)).toBe("hello");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer platform-env-key",
    );
  });
  it.each(
    endpoints.flatMap((baseUrl) =>
      [null, "platform-key"].map((apiKey) => ({ baseUrl, apiKey })),
    ),
  )(
    "uses the configured protocol, model and optional key at $baseUrl (key: $apiKey)",
    async ({ baseUrl, apiKey }) => {
      const requests = [];
      const fetch = vi.fn(async (url, init) => {
        const body = JSON.parse(init.body);
        requests.push({ url, headers: init.headers, body });
        if (body.stream) {
          return new Response(
            'data: {"choices":[{"delta":{"content":"hello"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
          );
        }
        return Response.json({
          choices: [{ message: { role: "assistant", content: "hello" } }],
        });
      });
      vi.stubGlobal("fetch", fetch);
      const options = {
        provider: "custom",
        baseUrl,
        model,
        apiKey,
        enabledToolNames: [],
        exactToolNames: true,
        contextMemorySkipPlanning: true,
      };

      expect((await chatWithTools(messages, options)).message.content).toBe(
        "hello",
      );
      const tokens = [];
      expect(
        (
          await chatWithTools(messages, {
            ...options,
            onToken: (token) => tokens.push(token),
          })
        ).message.content,
      ).toBe("hello");
      expect(tokens.join("")).toBe("hello");
      expect(await chatWithStreaming(messages, options)).toBe("hello");
      const streamed = [];
      for await (const token of buildProviderSource("custom", {
        ...options,
        prompt: "hello",
        requireCompletion: true,
      }))
        streamed.push(token);
      expect(streamed.join("")).toBe("hello");
      expect(await probeLlmConnection(options)).toBe("hello");

      expect(requests).toHaveLength(5);
      for (const request of requests) {
        expect(request.url).toBe(`${baseUrl}/chat/completions`);
        expect(request.body.model).toBe(model);
        expect(request.headers.Authorization).toBe(
          apiKey ? `Bearer ${apiKey}` : undefined,
        );
      }
    },
  );

  it.each([
    { baseUrl: null, model },
    { baseUrl: endpoints[0], model: "" },
    { baseUrl: "file:///tmp/model", model },
  ])(
    "rejects incomplete custom targets before sending credentials: %j",
    async (target) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const options = { provider: "custom", apiKey: "platform-key", ...target };
      expect(() => resolveLlmConnection(options)).toThrow(
        /Custom provider requires/,
      );
      expect(() => buildProviderSource("custom", options)).toThrow(
        /Custom provider requires/,
      );
      await expect(chatWithStreaming(messages, options)).rejects.toThrow(
        /Custom provider requires/,
      );
      await expect(probeLlmConnection(options)).rejects.toThrow(
        /Custom provider requires/,
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("preserves a custom localhost platform through provider reconciliation and authentication errors", async () => {
    const options = {
      provider: "custom",
      baseUrl: "http://localhost:1234/v1",
      model,
      apiKey: null,
    };
    expect((await reconcileConfigLlmProvider(options)).changed).toBe(false);
    expect(
      pickRunnableProvider({
        ...options,
        env: { OPENAI_API_KEY: "unrelated-cloud-key" },
      }),
    ).toMatchObject({ provider: "custom", runnable: true });
    const error = new Error("HTTP 401 unauthorized");
    const chat = vi.fn().mockRejectedValue(error);
    const wrapped = makeRunnableProviderFallback(chat, {
      env: { OPENAI_API_KEY: "unrelated-cloud-key" },
    });
    await expect(wrapped(messages, options)).rejects.toBe(error);
    expect(chat).toHaveBeenCalledExactlyOnceWith(messages, options);
  });
});
