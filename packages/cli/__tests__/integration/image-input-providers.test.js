/**
 * Integration: `cc agent --image` multimodal request shaping per provider.
 *
 * image-input.js produces ONE internal (OpenAI-shaped) multimodal message;
 * chatWithTools must hand each provider the shape *it* understands:
 *   - ollama            → { content:"<text>", images:["<base64>"] }
 *   - anthropic         → content block { type:"image", source:{base64} }
 *   - openai-compatible → the image_url array passes through verbatim
 *
 * We mock global fetch and assert the request body that would hit the wire.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { chatWithTools } from "../../src/runtime/agent-core.js";

const IMG_URL = "data:image/png;base64,AAAA";
const multimodalUser = () => ({
  role: "user",
  content: [
    { type: "text", text: "what is in this image?" },
    { type: "image_url", image_url: { url: IMG_URL } },
  ],
});

/** Mock fetch that records the parsed JSON body and returns a per-provider-ok shape. */
function mockFetch(kind) {
  let capturedBody = null;
  globalThis.fetch = vi.fn().mockImplementation(async (_url, opts) => {
    capturedBody = JSON.parse(opts.body);
    const bodies = {
      ollama: { message: { role: "assistant", content: "ok" } },
      anthropic: {
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "end_turn",
      },
      openai: { choices: [{ message: { role: "assistant", content: "ok" } }] },
    };
    return { ok: true, json: async () => bodies[kind] };
  });
  return () => capturedBody;
}

describe("cc agent --image — per-provider request shaping", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("ollama: image_url → {content, images:[base64]}", async () => {
    const getBody = mockFetch("ollama");
    await chatWithTools([multimodalUser()], {
      provider: "ollama",
      model: "llava",
      baseUrl: "http://localhost:11434",
    });
    const last = getBody().messages.at(-1);
    expect(last.content).toBe("what is in this image?");
    expect(last.images).toEqual(["AAAA"]);
  });

  it("anthropic: image_url → Anthropic image block (base64 source)", async () => {
    const getBody = mockFetch("anthropic");
    await chatWithTools([multimodalUser()], {
      provider: "anthropic",
      model: "claude-haiku-4-5",
      apiKey: "sk-test",
    });
    const last = getBody().messages.at(-1);
    expect(last.role).toBe("user");
    const img = last.content.find((b) => b.type === "image");
    expect(img).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "AAAA" },
    });
    // text part is preserved alongside the image
    expect(last.content.some((b) => b.type === "text")).toBe(true);
  });

  it("openai-compatible (volcengine): image_url array passes through verbatim", async () => {
    const getBody = mockFetch("openai");
    await chatWithTools([multimodalUser()], {
      provider: "volcengine",
      model: "doubao-seed-1-6-251015",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      apiKey: "ark-test",
    });
    const last = getBody().messages.at(-1);
    expect(last.content).toEqual([
      { type: "text", text: "what is in this image?" },
      { type: "image_url", image_url: { url: IMG_URL } },
    ]);
  });

  it("ollama: a text-only turn is sent unchanged (no images key)", async () => {
    const getBody = mockFetch("ollama");
    await chatWithTools([{ role: "user", content: "plain text" }], {
      provider: "ollama",
      model: "qwen2",
      baseUrl: "http://localhost:11434",
    });
    const last = getBody().messages.at(-1);
    expect(last.content).toBe("plain text");
    expect(last.images).toBeUndefined();
  });
});
