/**
 * §3.5.10 接线6 — per-turn LLM override (PDH privacy-tier switch, design module
 * 101). The personal-data chat may attach
 *   {"type":"user","text":…,"llm":{"provider","model","baseUrl"?,"apiKey"?}}
 * to route THIS turn to a different model (e.g. cloud → your own PC Ollama)
 * without restarting the session. Reuses the same per-turn loopOptions seam as
 * the vision-model switch; vision still wins on image turns.
 */
import { describe, it, expect } from "vitest";
import {
  runAgentHeadlessStream,
  parseInputEvent,
  sanitizeLlmHint,
} from "../../src/runtime/headless-stream.js";

function harness({ inputObjs, runOptions }) {
  const seenOpts = [];
  async function* loop(_messages, opts) {
    seenOpts.push(opts || {});
    yield { type: "response-complete", content: "reply" };
    yield { type: "run-ended", reason: "complete" };
  }
  async function* input() {
    for (const o of inputObjs) yield JSON.stringify(o) + "\n";
  }
  const deps = {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => null,
    writeOut: () => {},
    writeErr: () => {},
    agentLoop: loop,
    input: input(),
  };
  return {
    run: () =>
      runAgentHeadlessStream({ expandFileRefs: false, ...runOptions }, deps),
    seenOpts,
  };
}

describe("sanitizeLlmHint (§3.5.10 接线6)", () => {
  it("keeps provider/model/baseUrl/apiKey", () => {
    expect(
      sanitizeLlmHint({
        provider: "ollama",
        model: "qwen2.5",
        baseUrl: "http://pc:11434",
        apiKey: "k",
      }),
    ).toEqual({
      provider: "ollama",
      model: "qwen2.5",
      baseUrl: "http://pc:11434",
      apiKey: "k",
    });
  });

  it("returns null without a provider or model", () => {
    expect(sanitizeLlmHint({ baseUrl: "http://x" })).toBe(null);
    expect(sanitizeLlmHint(null)).toBe(null);
    expect(sanitizeLlmHint("x")).toBe(null);
  });

  it("trims and drops blank fields", () => {
    expect(
      sanitizeLlmHint({ provider: "  ollama  ", model: "", apiKey: "  " }),
    ).toEqual({ provider: "ollama" });
  });
});

describe("parseInputEvent — llm hint", () => {
  it("carries a valid llm override alongside the text", () => {
    expect(
      parseInputEvent(
        '{"type":"user","text":"hi","llm":{"provider":"ollama","model":"qwen2.5"}}',
      ),
    ).toEqual({ text: "hi", llm: { provider: "ollama", model: "qwen2.5" } });
  });

  it("text-only events stay shape-identical (no llm key)", () => {
    expect(parseInputEvent('{"type":"user","text":"hi"}')).toEqual({
      text: "hi",
    });
  });

  it("ignores a malformed llm (no provider/model)", () => {
    expect(
      parseInputEvent('{"type":"user","text":"hi","llm":{"baseUrl":"x"}}'),
    ).toEqual({ text: "hi" });
  });
});

describe("stream per-turn llm override", () => {
  it("overrides THIS turn's provider/model/baseUrl/apiKey; default turn unchanged", async () => {
    const h = harness({
      runOptions: {
        provider: "volcengine",
        model: "doubao",
        baseUrl: "https://ark",
        apiKey: "K",
      },
      inputObjs: [
        { type: "user", text: "default turn" },
        {
          type: "user",
          text: "private turn",
          llm: {
            provider: "ollama",
            model: "qwen2.5",
            baseUrl: "http://pc:11434",
            apiKey: "L",
          },
        },
      ],
    });
    await h.run();
    expect(h.seenOpts).toHaveLength(2);
    // default turn keeps the session LLM
    expect(h.seenOpts[0].provider).toBe("volcengine");
    expect(h.seenOpts[0].model).toBe("doubao");
    // overridden turn switches to the per-turn LLM
    expect(h.seenOpts[1].provider).toBe("ollama");
    expect(h.seenOpts[1].model).toBe("qwen2.5");
    expect(h.seenOpts[1].baseUrl).toBe("http://pc:11434");
    expect(h.seenOpts[1].apiKey).toBe("L");
  });

  it("a partial override (model only) keeps the session provider", async () => {
    const h = harness({
      runOptions: { provider: "volcengine", model: "doubao", apiKey: "K" },
      inputObjs: [{ type: "user", text: "x", llm: { model: "doubao-pro" } }],
    });
    await h.run();
    expect(h.seenOpts[0].model).toBe("doubao-pro");
    expect(h.seenOpts[0].provider).toBe("volcengine"); // unchanged
  });
});
