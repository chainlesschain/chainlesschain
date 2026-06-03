"use strict";

import { describe, it, expect } from "vitest";

const { MockLLMClient, OllamaClient } = require("../lib/llm-client");

// ─── MockLLMClient ────────────────────────────────────────────────────────

describe("MockLLMClient", () => {
  it("isLocal is always true", () => {
    expect(new MockLLMClient().isLocal).toBe(true);
  });

  it("returns the configured static reply", async () => {
    const c = new MockLLMClient({ reply: "hello [evt-1]" });
    const r = await c.chat([{ role: "user", content: "x" }]);
    expect(r.text).toBe("hello [evt-1]");
    expect(r.model).toBe("mock-llm");
  });

  it("records every call for assertion", async () => {
    const c = new MockLLMClient({ reply: "ok" });
    await c.chat([{ role: "user", content: "a" }]);
    await c.chat([{ role: "user", content: "b" }]);
    expect(c.calls.length).toBe(2);
    expect(c.calls[0].messages[0].content).toBe("a");
    expect(c.calls[1].messages[0].content).toBe("b");
  });

  it("function reply gets the messages", async () => {
    const c = new MockLLMClient({ reply: (messages) => `you said: ${messages[0].content}` });
    const r = await c.chat([{ role: "user", content: "hi" }]);
    expect(r.text).toBe("you said: hi");
  });

  it("replies array exhausts and throws after", async () => {
    const c = new MockLLMClient({ replies: ["a", "b"] });
    expect((await c.chat([])).text).toBe("a");
    expect((await c.chat([])).text).toBe("b");
    await expect(c.chat([])).rejects.toThrow(/exhausted/);
  });

  it("returns a usage object even if it's an approximation", async () => {
    const c = new MockLLMClient({ reply: "reply text" });
    const r = await c.chat([{ role: "user", content: "question content" }]);
    expect(r.usage).toBeDefined();
    expect(typeof r.usage.promptTokens).toBe("number");
  });
});

// ─── OllamaClient ─────────────────────────────────────────────────────────

describe("OllamaClient", () => {
  it("declares isLocal = true unconditionally", () => {
    const c = new OllamaClient({ fetch: async () => ({ ok: true }) });
    expect(c.isLocal).toBe(true);
  });

  it("uses sensible defaults (baseUrl + model)", () => {
    const c = new OllamaClient({ fetch: async () => ({}) });
    expect(c.baseUrl).toBe("http://localhost:11434");
    expect(c.model).toContain("qwen2.5");
  });

  it("posts to /api/chat with the configured model + messages", async () => {
    let captured = null;
    const fakeFetch = async (url, init) => {
      captured = { url, body: JSON.parse(init.body) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          message: { role: "assistant", content: "hi" },
          prompt_eval_count: 12,
          eval_count: 7,
        }),
      };
    };
    const c = new OllamaClient({ fetch: fakeFetch, model: "llama3:8b" });
    const r = await c.chat([{ role: "user", content: "ping" }]);
    expect(captured.url).toBe("http://localhost:11434/api/chat");
    expect(captured.body.model).toBe("llama3:8b");
    expect(captured.body.stream).toBe(false);
    expect(captured.body.messages[0].content).toBe("ping");
    expect(r.text).toBe("hi");
    expect(r.usage.promptTokens).toBe(12);
    expect(r.usage.completionTokens).toBe(7);
    expect(r.usage.totalTokens).toBe(19);
  });

  it("wraps fetch errors with cause preserved", async () => {
    const fakeFetch = async () => { throw new Error("ECONNREFUSED"); };
    const c = new OllamaClient({ fetch: fakeFetch });
    await expect(c.chat([{ role: "user", content: "x" }])).rejects.toThrow(/request failed/);
  });

  it("throws on non-OK status with body excerpt", async () => {
    const fakeFetch = async () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "internal model crashed",
    });
    const c = new OllamaClient({ fetch: fakeFetch });
    await expect(c.chat([{ role: "user", content: "x" }])).rejects.toThrow(/500/);
  });

  it("health() returns ok when /api/tags responds 200", async () => {
    const fakeFetch = async () => ({ ok: true, status: 200 });
    const c = new OllamaClient({ fetch: fakeFetch });
    const h = await c.health();
    expect(h.ok).toBe(true);
  });

  it("health() returns ok=false on error", async () => {
    const fakeFetch = async () => { throw new Error("down"); };
    const c = new OllamaClient({ fetch: fakeFetch });
    const h = await c.health();
    expect(h.ok).toBe(false);
    expect(h.error).toContain("down");
  });
});
