/**
 * Stream-mode PDH egress reporting (design module 101 §3.5.18 — 出境台账).
 *
 * The cc agent makes the actual cloud-LLM call and runs egress-classed tools
 * inside its subprocess, invisible to the Android transparency ledger. In a PDH
 * session headless-stream emits a structured `egress` event per turn so the
 * Android ledger can record what left the device. Gated to PDH context; a
 * local-only turn emits nothing (honest "0 条出境"). Non-PDH (IDE/coding)
 * sessions are never polluted.
 */
import { describe, it, expect } from "vitest";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";

/**
 * @param {object} p
 * @param {Array<object>} p.inputObjs   NDJSON user events
 * @param {Array<string>} [p.toolsPerTurn] tool name yielded each turn (one each)
 * @param {object} [p.options]          runAgentHeadlessStream options
 */
function harness({ inputObjs, toolsPerTurn = [], options = {} } = {}) {
  const lines = [];
  let turnIdx = 0;
  async function* loop(messages) {
    const tool = toolsPerTurn[turnIdx++];
    if (tool) {
      yield { type: "tool-executing", tool, args: {} };
      yield { type: "tool-result", tool, result: { ok: true } };
    }
    yield {
      type: "token-usage",
      usage: { input_tokens: 10, output_tokens: 5 },
      provider: options.provider,
      model: options.model,
    };
    yield { type: "response-complete", content: "reply" };
    yield { type: "run-ended", reason: "complete" };
  }
  async function* input() {
    for (const o of inputObjs) yield JSON.stringify(o) + "\n";
  }
  const deps = {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => null,
    writeOut: (s) => lines.push(s),
    writeErr: () => {},
    agentLoop: loop,
    input: input(),
  };
  return {
    run: () =>
      runAgentHeadlessStream({ expandFileRefs: false, ...options }, deps),
    egress: () =>
      lines
        .join("")
        .trimEnd()
        .split("\n")
        .map((l) => JSON.parse(l))
        .filter((e) => e.type === "egress"),
  };
}

describe("headless-stream — PDH egress reporting (§3.5.18)", () => {
  it("a cloud-LLM PDH turn emits a cloud_llm egress event", async () => {
    const h = harness({
      inputObjs: [{ type: "user", text: "我最近发了什么微博" }],
      options: { pdh: true, provider: "volcengine", model: "doubao-seed-1-6" },
    });
    await h.run();
    const egress = h.egress();
    expect(egress).toHaveLength(1);
    expect(egress[0]).toMatchObject({
      type: "egress",
      kind: "cloud_llm",
      channel: "volcengine",
      provider: "volcengine",
      tokens: 15,
      turn: 1,
    });
  });

  it("a local-only PDH turn emits NO egress (honest 0 条出境)", async () => {
    const h = harness({
      inputObjs: [{ type: "user", text: "采集本机系统数据" }],
      toolsPerTurn: ["mcp__pdh__collect_system_data"],
      options: { pdh: true, provider: "ollama" },
    });
    await h.run();
    expect(h.egress()).toEqual([]);
  });

  it("a cookie-API tool emits a remote_api egress even on a local LLM", async () => {
    const h = harness({
      inputObjs: [{ type: "user", text: "查我的微博收藏" }],
      toolsPerTurn: ["mcp__pdh__query_app_data"],
      options: { pdh: true, provider: "ollama" },
    });
    await h.run();
    const egress = h.egress();
    expect(egress).toHaveLength(1);
    expect(egress[0]).toMatchObject({
      kind: "tool",
      channel: "remote_api",
      tool: "mcp__pdh__query_app_data",
    });
  });

  it("a cloud LLM + cookie-API tool emits both egress events", async () => {
    const h = harness({
      inputObjs: [{ type: "user", text: "查微博并总结" }],
      toolsPerTurn: ["mcp__pdh__collect_app_data"],
      options: { pdh: true, provider: "openai" },
    });
    await h.run();
    expect(h.egress().map((e) => `${e.kind}:${e.channel}`)).toEqual([
      "cloud_llm:openai",
      "tool:remote_api",
    ]);
  });

  it("does NOT report egress outside a PDH session (IDE/coding)", async () => {
    const h = harness({
      inputObjs: [{ type: "user", text: "refactor this" }],
      toolsPerTurn: ["mcp__pdh__query_app_data"],
      options: { pdh: false, provider: "openai" },
    });
    await h.run();
    expect(h.egress()).toEqual([]);
  });
});
