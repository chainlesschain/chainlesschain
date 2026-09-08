import { afterEach, describe, expect, it, vi } from "vitest";
import {
  streamOllama,
  streamOpenAI,
  streamAnthropic,
} from "../../src/lib/chat-core.js";
import { buildProviderSource } from "../../src/lib/provider-stream.js";
import {
  readEvolutionCompositionFactory,
  prepareGovernedModelTurn,
  governModelTokenSource,
} from "../../src/lib/evolution/governed-model-turn.js";

afterEach(() => vi.unstubAllGlobals());
const messages = [{ role: "user", content: "projected prompt" }];
const body = {
  ollama: JSON.stringify({ message: { content: "ok" }, done: true }) + "\n",
  openai: 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',
  anthropic:
    'data: {"type":"content_block_delta","delta":{"text":"ok"}}\n\ndata: {"type":"message_stop"}\n\n',
};

describe("governed stream transport completion", () => {
  it.each(
    ["ollama", "openai", "anthropic"].flatMap((provider) =>
      ["complete", "truncated", "cancelled", "error", "malformed"].map(
        (mode) => [provider, mode],
      ),
    ),
  )(
    "%s rejects incomplete or cancelled output (%s)",
    async (provider, mode) => {
      const controller = new AbortController();
      let response = body[provider];
      if (mode === "error" || mode === "malformed") {
        response =
          (provider === "ollama" ? "" : "data: ") +
          (mode === "error" ? '{"error":"denied"}' : "{invalid") +
          "\n" +
          response;
      }
      if (mode === "truncated")
        response =
          provider === "ollama"
            ? '{"message":{"content":"partial"}}\n'
            : 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n';
      const fetch = vi.fn(async () => new Response(response));
      vi.stubGlobal("fetch", fetch);
      const onToken = vi.fn(() => {
        if (mode === "cancelled") controller.abort();
      });
      const options = { requireCompletion: true, signal: controller.signal };
      const args = [messages, "test", "http://127.0.0.1:1"];
      const operation =
        provider === "ollama"
          ? streamOllama(...args, onToken, undefined, undefined, options)
          : (provider === "openai" ? streamOpenAI : streamAnthropic)(
              ...args,
              "test-key",
              onToken,
              undefined,
              undefined,
              options,
            );
      if (mode === "complete") await expect(operation).resolves.toBe("ok");
      else await expect(operation).rejects.toThrow();
      expect(JSON.parse(fetch.mock.calls[0][1].body).messages).toEqual(
        messages,
      );
    },
  );

  it.each(
    ["ollama", "openai"].flatMap((provider) =>
      ["complete", "truncated", "error", "malformed"].map((mode) => [
        provider,
        mode,
      ]),
    ),
  )("provider source %s fails closed (%s)", async (provider, mode) => {
    const terminal =
      provider === "ollama" ? '{"done":true}\n' : "data: [DONE]\n\n";
    const prefix = provider === "ollama" ? "" : "data: ";
    const response =
      mode === "complete"
        ? body[provider]
        : mode === "truncated"
          ? ""
          : prefix +
            (mode === "error" ? '{"error":"denied"}' : "{invalid") +
            "\n" +
            terminal;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(response)),
    );
    const operation = (async () => {
      let text = "";
      for await (const delta of buildProviderSource(provider, {
        messages,
        apiKey: "test-key",
        requireCompletion: true,
      }))
        text += delta;
      return text;
    })();
    if (mode === "complete") await expect(operation).resolves.toBe("ok");
    else await expect(operation).rejects.toThrow();
  });

  it("does not invoke accessor or proxy factories", () => {
    const trap = vi.fn();
    expect(() =>
      readEvolutionCompositionFactory(
        Object.defineProperty({}, "evolutionCompositionFactory", { get: trap }),
      ),
    ).toThrow();
    expect(() =>
      readEvolutionCompositionFactory(
        new Proxy({}, { getOwnPropertyDescriptor: trap }),
      ),
    ).toThrow();
    expect(trap).not.toHaveBeenCalled();
  });

  it("rejects unbranded composition before requesting a model", async () => {
    await expect(
      prepareGovernedModelTurn(async () => ({}), {
        mode: "stream",
        messages,
      }),
    ).rejects.toThrow(/branded/);
  });

  it("does not complete a turn when the consumer cancels iteration", async () => {
    const complete = vi.fn();
    async function* source() {
      yield "first";
      yield "second";
    }
    for await (const _delta of governModelTokenSource(source(), { complete }))
      break;
    expect(complete).not.toHaveBeenCalled();
  });
});
