"use strict";

/**
 * provider-stream tests (previously untested) — the token-stream parsers behind
 * `cc stream` and the Hosted Session stream.run route. Pins the bug-prone
 * streaming parse logic: Ollama NDJSON (yield response, stop on done, line
 * buffering across chunk boundaries, skip malformed), OpenAI-style SSE, and
 * native Anthropic/Gemini SSE. Also pins protocol routing, completion markers,
 * authentication headers, and URL normalization. fetch is stubbed; no network.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  ollamaTokenStream,
  openAIStream,
  buildProviderSource,
} from "../provider-stream.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** A fake fetch whose response body streams the given string chunks. */
function mockFetch(
  chunks,
  { ok = true, status = 200, statusText = "OK" } = {},
) {
  return vi.fn(async () => {
    const enc = new TextEncoder();
    let i = 0;
    return {
      ok,
      status,
      statusText,
      body: new ReadableStream({
        pull(controller) {
          if (i < chunks.length) controller.enqueue(enc.encode(chunks[i++]));
          else controller.close();
        },
      }),
    };
  });
}

async function collect(gen) {
  const out = [];
  for await (const t of gen) out.push(t);
  return out;
}

// --------------------------------------------------------------------------- //
// ollamaTokenStream
// --------------------------------------------------------------------------- //
describe("ollamaTokenStream", () => {
  it("yields responses across NDJSON lines and stops on done", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        '{"response":"He"}\n{"response":"llo"}\n',
        '{"response":"!"}\n{"done":true}\n',
        '{"response":"AFTER"}\n', // never read — returned on done
      ]),
    );
    const out = await collect(
      ollamaTokenStream({ baseUrl: "http://x", model: "m", prompt: "p" }),
    );
    expect(out).toEqual(["He", "llo", "!"]);
  });

  it("buffers a JSON line split across chunk boundaries", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(['{"resp', 'onse":"hi"}\n{"done":true}\n']),
    );
    expect(
      await collect(
        ollamaTokenStream({ baseUrl: "http://x", model: "m", prompt: "p" }),
      ),
    ).toEqual(["hi"]);
  });

  it("skips malformed JSON lines", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(['not json\n{"response":"ok"}\n{"done":true}\n']),
    );
    expect(
      await collect(
        ollamaTokenStream({ baseUrl: "http://x", model: "m", prompt: "p" }),
      ),
    ).toEqual(["ok"]);
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([], { ok: false, status: 500, statusText: "Err" }),
    );
    await expect(
      collect(
        ollamaTokenStream({ baseUrl: "http://x", model: "m", prompt: "p" }),
      ),
    ).rejects.toThrow(/500/);
  });
});

// --------------------------------------------------------------------------- //
// openAIStream
// --------------------------------------------------------------------------- //
describe("openAIStream", () => {
  const args = { baseUrl: "http://x", apiKey: "k", model: "m", prompt: "p" };

  it("yields delta.content from data lines and stops on [DONE]", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        'data: {"choices":[{"delta":{"content":"A"}}]}\n',
        'data: {"choices":[{"delta":{"content":"B"}}]}\ndata: [DONE]\n',
        'data: {"choices":[{"delta":{"content":"AFTER"}}]}\n',
      ]),
    );
    expect(await collect(openAIStream(args))).toEqual(["A", "B"]);
  });

  it("skips non-data, empty and content-less delta lines", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        ": comment\n\n",
        'data: {"choices":[{"delta":{}}]}\n', // no content
        'data: {"choices":[{"delta":{"content":"x"}}]}\ndata: [DONE]\n',
      ]),
    );
    expect(await collect(openAIStream(args))).toEqual(["x"]);
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([], { ok: false, status: 401, statusText: "No" }),
    );
    await expect(collect(openAIStream(args))).rejects.toThrow(/401/);
  });
});

// --------------------------------------------------------------------------- //
// buildProviderSource
// --------------------------------------------------------------------------- //
describe("buildProviderSource", () => {
  it("routes ollama to /api/generate with localhost default", async () => {
    const fetchMock = mockFetch(['{"done":true}\n']);
    vi.stubGlobal("fetch", fetchMock);
    await collect(buildProviderSource("ollama", { prompt: "hi" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/generate",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("routes a known provider to /chat/completions with a Bearer key", async () => {
    const fetchMock = mockFetch(["data: [DONE]\n"]);
    vi.stubGlobal("fetch", fetchMock);
    await collect(
      buildProviderSource("deepseek", { apiKey: "sk-x", prompt: "hi" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.deepseek.com/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk-x" }),
      }),
    );
  });

  it("normalizes a trailing slash on OpenAI-compatible provider bases", async () => {
    const fetchMock = mockFetch(["data: [DONE]\n"]);
    vi.stubGlobal("fetch", fetchMock);
    await collect(
      buildProviderSource("deepseek", {
        baseUrl: "https://api.deepseek.com/v1/",
        apiKey: "sk-x",
        prompt: "hi",
      }),
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.deepseek.com/v1/chat/completions",
    );
  });

  it("routes Gemini through its native SSE API without putting the key in the URL", async () => {
    const fetchMock = mockFetch([
      'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"private"},{"text":"hello"}]}}]}\n',
      'data: {"candidates":[{"finishReason":"STOP"}]}\n',
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const out = await collect(
      buildProviderSource("gemini", {
        apiKey: "secret",
        model: "gemini-2.0-flash",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/",
        prompt: "hello",
        requireCompletion: true,
      }),
    );
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse",
    );
    expect(url).not.toContain("secret");
    expect(options.headers["x-goog-api-key"]).toBe("secret");
    expect(out).toEqual(["hello"]);
  });

  it("routes Anthropic through native Messages SSE with a trimmed base URL", async () => {
    const fetchMock = mockFetch([
      'data: {"type":"content_block_delta","delta":{"text":"hello"}}\n',
      'data: {"type":"message_stop"}\n',
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const out = await collect(
      buildProviderSource("anthropic", {
        apiKey: "secret",
        model: "claude-haiku-4-5-20251001",
        baseUrl: "https://api.anthropic.com/v1/",
        messages: [
          { role: "system", content: "be concise" },
          { role: "user", content: "hello" },
        ],
        requireCompletion: true,
      }),
    );
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(options.headers["x-api-key"]).toBe("secret");
    expect(JSON.parse(options.body)).toMatchObject({
      system: "be concise",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(out).toEqual(["hello"]);
  });

  it("throws for an unsupported provider", () => {
    expect(() => buildProviderSource("nope", { prompt: "x" })).toThrow(
      /Unsupported provider/,
    );
  });

  it("throws when a known provider has no api key", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    expect(() => buildProviderSource("deepseek", { prompt: "x" })).toThrow(
      /API key/,
    );
  });
});
