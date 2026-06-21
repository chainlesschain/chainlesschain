/**
 * Anthropic prompt caching (Claude-Code parity).
 *
 * The system prompt + the (large, stable) tool-schema block are re-sent on
 * every agent-loop iteration. cc marks the last tool and the system block as
 * `cache_control: {type:"ephemeral"}` breakpoints so Anthropic serves that
 * prefix from cache (~10% the input cost, lower latency). Default-on; opt out
 * with CC_PROMPT_CACHE=0 or options.promptCaching:false (e.g. a custom gateway
 * that rejects the field). These tests capture the request body sent to the
 * Anthropic Messages endpoint and assert the breakpoint shape.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import os from "os";
import { chatWithTools } from "../../src/runtime/agent-core.js";

// Capture the JSON body of the (single) Anthropic request and return a minimal
// valid Messages response so chatWithTools finalizes cleanly.
function stubCapturingFetch() {
  const captured = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      captured.body = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "ok" }],
          usage: { input_tokens: 5, output_tokens: 2 },
          stop_reason: "end_turn",
        }),
      };
    }),
  );
  return captured;
}

const baseOpts = (over = {}) => ({
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  apiKey: "test-key",
  cwd: os.tmpdir(),
  ...over,
});

const msgs = [
  { role: "system", content: "You are a careful coding agent." },
  { role: "user", content: "hi" },
];

describe("anthropic prompt caching", () => {
  const prev = process.env.CC_PROMPT_CACHE;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (prev === undefined) delete process.env.CC_PROMPT_CACHE;
    else process.env.CC_PROMPT_CACHE = prev;
  });

  it("marks the last tool and the system block as cache breakpoints by default", async () => {
    delete process.env.CC_PROMPT_CACHE;
    const cap = stubCapturingFetch();
    await chatWithTools(msgs, baseOpts());

    // System becomes an array of content blocks with a cache breakpoint.
    expect(Array.isArray(cap.body.system)).toBe(true);
    expect(cap.body.system[0]).toMatchObject({
      type: "text",
      text: "You are a careful coding agent.",
      cache_control: { type: "ephemeral" },
    });

    // Exactly one tool breakpoint, and it is on the LAST tool.
    const tools = cap.body.tools;
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[tools.length - 1].cache_control).toEqual({
      type: "ephemeral",
    });
    const withCC = tools.filter((t) => t.cache_control);
    expect(withCC).toHaveLength(1);
  });

  it("never exceeds Anthropic's 4-breakpoint limit", async () => {
    delete process.env.CC_PROMPT_CACHE;
    const cap = stubCapturingFetch();
    await chatWithTools(msgs, baseOpts());
    const sysBreaks = (
      Array.isArray(cap.body.system) ? cap.body.system : []
    ).filter((b) => b.cache_control).length;
    const toolBreaks = cap.body.tools.filter((t) => t.cache_control).length;
    expect(sysBreaks + toolBreaks).toBeLessThanOrEqual(4);
  });

  it("emits no breakpoints and a string system when promptCaching:false", async () => {
    const cap = stubCapturingFetch();
    await chatWithTools(msgs, baseOpts({ promptCaching: false }));
    expect(typeof cap.body.system).toBe("string");
    expect(cap.body.tools.some((t) => t.cache_control)).toBe(false);
  });

  it("respects the CC_PROMPT_CACHE=0 kill switch", async () => {
    process.env.CC_PROMPT_CACHE = "0";
    const cap = stubCapturingFetch();
    await chatWithTools(msgs, baseOpts());
    expect(typeof cap.body.system).toBe("string");
    expect(cap.body.tools.some((t) => t.cache_control)).toBe(false);
  });
});
