/**
 * Stream-driver notices the IDE chat panel renders:
 *  - Layer 2: a cross-vendor provider fallback is surfaced as a visible `raw`
 *    line (never a silent vendor switch), via loopOptions.onProviderFallback.
 *  - Layer 1: an up-to-date session emits NO version_skew notice (no false alarm).
 *
 * Both notices use `type:"raw"` so the currently-shipped extension (which maps
 * `raw` → an info line) renders them without a plugin rebuild.
 */
import { describe, it, expect } from "vitest";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";

/** Collect emitted NDJSON events; optionally let the fake loop poke loopOptions. */
function harness({ inputObjs, runOptions, onLoop }) {
  const events = [];
  const seenOpts = [];
  async function* loop(_messages, opts) {
    seenOpts.push(opts || {});
    if (typeof onLoop === "function") onLoop(opts || {});
    yield { type: "response-complete", content: "reply" };
    yield { type: "run-ended", reason: "complete" };
  }
  async function* input() {
    for (const o of inputObjs) yield JSON.stringify(o) + "\n";
  }
  const deps = {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => null,
    writeOut: (s) => {
      for (const line of String(s).split("\n")) {
        const t = line.trim();
        if (!t) continue;
        try {
          events.push(JSON.parse(t));
        } catch {
          /* non-JSON noise */
        }
      }
    },
    writeErr: () => {},
    agentLoop: loop,
    input: input(),
  };
  return {
    run: () =>
      runAgentHeadlessStream({ expandFileRefs: false, ...runOptions }, deps),
    events,
    seenOpts,
  };
}

describe("headless-stream — provider fallback notice (Layer 2)", () => {
  it("emits a visible raw provider_fallback line when the loop reports a fallback", async () => {
    const h = harness({
      runOptions: { provider: "volcengine", model: "doubao", apiKey: "K" },
      inputObjs: [{ type: "user", text: "hi" }],
      onLoop: (opts) => {
        // agent-core calls this with the built message when a vendor switch
        // happens; the driver must turn it into a rendered event.
        opts.onProviderFallback?.({
          from: "volcengine",
          to: "anthropic",
          reason: "env-key",
          message: '"volcengine" 鉴权失败，已临时切换到不同厂商 "anthropic"。',
        });
      },
    });
    await h.run();
    const fb = h.events.find(
      (e) => e.type === "raw" && e.subtype === "provider_fallback",
    );
    expect(fb).toBeTruthy();
    expect(fb.from).toBe("volcengine");
    expect(fb.to).toBe("anthropic");
    expect(fb.reason).toBe("env-key");
    expect(fb.text).toContain("anthropic");
  });

  it("passes an onProviderFallback into the loop options", async () => {
    const h = harness({
      runOptions: { provider: "volcengine", model: "doubao", apiKey: "K" },
      inputObjs: [{ type: "user", text: "hi" }],
    });
    await h.run();
    expect(typeof h.seenOpts[0].onProviderFallback).toBe("function");
  });
});

describe("headless-stream — version-skew notice (Layer 1)", () => {
  it("stays silent for an up-to-date session (loaded === installed)", async () => {
    const h = harness({
      runOptions: { provider: "volcengine", model: "doubao", apiKey: "K" },
      inputObjs: [{ type: "user", text: "hi" }],
    });
    await h.run();
    const skew = h.events.find(
      (e) => e.type === "raw" && e.subtype === "version_skew",
    );
    expect(skew).toBeUndefined();
  });
});
