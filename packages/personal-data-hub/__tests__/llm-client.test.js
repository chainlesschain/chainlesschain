"use strict";

import { describe, it, expect } from "vitest";

const { MockLLMClient, OllamaClient } = require("../lib/llm-client");
const { MODEL_EGRESS_INGRESS_FAILED } = require("../lib/model-egress-guard");
const { ollamaEmbed } = require("../lib/entity-resolver/embedding-stage");

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

  it("rejects model content before calling the configured transport", async () => {
    let calls = 0;
    const c = new OllamaClient({
      fetch: async () => {
        calls += 1;
        throw new Error("transport must not run");
      },
      model: "llama3:8b",
    });

    await expect(c.chat([{ role: "user", content: "canary" }])).rejects.toMatchObject({
      code: MODEL_EGRESS_INGRESS_FAILED,
    });
    expect(calls).toBe(0);
  });

  it("rejects default embedding before it can call global fetch", async () => {
    const priorFetch = global.fetch;
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      throw new Error("transport must not run");
    };

    try {
      await expect(ollamaEmbed("http://localhost:11434", "nomic-embed-text", "canary"))
        .rejects.toMatchObject({ code: MODEL_EGRESS_INGRESS_FAILED });
      expect(calls).toBe(0);
    } finally {
      global.fetch = priorFetch;
    }
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
