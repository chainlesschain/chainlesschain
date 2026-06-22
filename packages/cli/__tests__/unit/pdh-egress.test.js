/**
 * PDH egress classification (design module 101 §3.5.18 — 出境台账).
 * Pure-function coverage: provider local/cloud split, tool channel mapping,
 * and the per-turn event composition (honest "0 条出境" for local turns).
 */
import { describe, it, expect } from "vitest";
import {
  isLocalProvider,
  isCloudProvider,
  classifyEgressTool,
  buildEgressEvent,
  turnEgressEvents,
} from "../../src/lib/pdh-egress.js";

describe("isLocalProvider / isCloudProvider", () => {
  it("treats known on-device engines as local", () => {
    for (const p of ["ollama", "Ollama", "llamacpp", "mediapipe", "local"]) {
      expect(isLocalProvider(p)).toBe(true);
      expect(isCloudProvider(p)).toBe(false);
    }
  });

  it("treats cloud providers as egress", () => {
    for (const p of ["volcengine", "openai", "anthropic", "deepseek"]) {
      expect(isLocalProvider(p)).toBe(false);
      expect(isCloudProvider(p)).toBe(true);
    }
  });

  it("a localhost/LAN baseUrl is local even for an unknown provider", () => {
    expect(isLocalProvider("custom", "http://localhost:11434")).toBe(true);
    expect(isLocalProvider("custom", "http://127.0.0.1:8080")).toBe(true);
    expect(isLocalProvider("custom", "http://192.168.1.5:1234/v1")).toBe(true);
    expect(isCloudProvider("custom", "http://localhost:11434")).toBe(false);
  });

  it("an unknown provider with a public baseUrl is cloud (never hide egress)", () => {
    expect(isCloudProvider("mystery", "https://api.example.com/v1")).toBe(true);
  });

  it("a known cloud provider stays cloud even with a default localhost baseUrl", () => {
    // headless-stream's baseUrl defaults to ollama's localhost:11434; a cloud
    // provider selected without an explicit baseUrl must NOT be hidden as local.
    expect(isCloudProvider("volcengine", "http://localhost:11434")).toBe(true);
    expect(isLocalProvider("openai", "http://localhost:11434")).toBe(false);
  });

  it("an empty provider is not cloud (no LLM ran)", () => {
    expect(isCloudProvider("")).toBe(false);
    expect(isCloudProvider(null)).toBe(false);
    expect(isCloudProvider(undefined)).toBe(false);
  });
});

describe("classifyEgressTool", () => {
  it("maps the data-sending channels", () => {
    expect(classifyEgressTool("send_message")).toBe("message");
    expect(classifyEgressTool("send_dm")).toBe("message");
    expect(classifyEgressTool("export_vault")).toBe("export");
    expect(classifyEgressTool("cross_device_send")).toBe("cross_device");
    expect(classifyEgressTool("backup_to_device")).toBe("cross_device");
    expect(classifyEgressTool("web_search")).toBe("web");
  });

  it("classifies the PDH cookie-API tools as remote_api (cookie+query leave)", () => {
    expect(classifyEgressTool("collect_app_data")).toBe("remote_api");
    expect(classifyEgressTool("query_app_data")).toBe("remote_api");
    // MCP-prefixed form resolves the same.
    expect(classifyEgressTool("mcp__pdh__collect_app_data")).toBe("remote_api");
    expect(classifyEgressTool("mcp__pdh__query_app_data")).toBe("remote_api");
  });

  it("returns null for purely on-device tools", () => {
    for (const t of [
      "collect_files",
      "collect_system_data",
      "salvage_app_data",
      "collect_app_data_root", // root DB read — local, NOT remote_api
      "list_collectors",
      "pdh_ping",
      "mcp__pdh__collect_system_data",
      "",
      null,
    ]) {
      expect(classifyEgressTool(t)).toBe(null);
    }
  });
});

describe("buildEgressEvent", () => {
  it("includes only the provided fields", () => {
    expect(
      buildEgressEvent({ kind: "cloud_llm", channel: "volcengine" }),
    ).toEqual({ type: "egress", kind: "cloud_llm", channel: "volcengine" });
    expect(
      buildEgressEvent({
        kind: "tool",
        channel: "remote_api",
        tool: "mcp__pdh__query_app_data",
        sessionId: "s1",
        turn: 2,
      }),
    ).toEqual({
      type: "egress",
      kind: "tool",
      channel: "remote_api",
      tool: "mcp__pdh__query_app_data",
      session_id: "s1",
      turn: 2,
    });
  });

  it("keeps tokens:0 but drops null tokens", () => {
    expect(buildEgressEvent({ kind: "cloud_llm", tokens: 0 }).tokens).toBe(0);
    expect(
      "tokens" in buildEgressEvent({ kind: "cloud_llm", tokens: null }),
    ).toBe(false);
  });
});

describe("turnEgressEvents", () => {
  it("a cloud turn reports a cloud_llm egress with token magnitude", () => {
    const evs = turnEgressEvents({
      provider: "volcengine",
      model: "doubao-seed-1-6",
      usage: { input_tokens: 1200, output_tokens: 300 },
      sessionId: "s9",
      turn: 1,
    });
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({
      type: "egress",
      kind: "cloud_llm",
      channel: "volcengine",
      provider: "volcengine",
      model: "doubao-seed-1-6",
      tokens: 1500,
      session_id: "s9",
      turn: 1,
    });
  });

  it("a local turn with only on-device tools reports nothing (0 条出境)", () => {
    expect(
      turnEgressEvents({
        provider: "ollama",
        baseUrl: "http://localhost:11434",
        toolCalls: [
          { tool: "mcp__pdh__collect_system_data" },
          { tool: "mcp__pdh__salvage_app_data" },
        ],
      }),
    ).toEqual([]);
  });

  it("reports cloud_llm + one event per egress tool, skipping local tools", () => {
    const evs = turnEgressEvents({
      provider: "openai",
      toolCalls: [
        { tool: "mcp__pdh__collect_system_data" }, // local → skipped
        { tool: "mcp__pdh__query_app_data" }, // remote_api
        { tool: "send_message" }, // message
      ],
      turn: 3,
    });
    expect(evs.map((e) => `${e.kind}:${e.channel}`)).toEqual([
      "cloud_llm:openai",
      "tool:remote_api",
      "tool:message",
    ]);
  });

  it("a local provider still reports egress tools (cookie left even on-device LLM)", () => {
    const evs = turnEgressEvents({
      provider: "ollama",
      baseUrl: "http://localhost:11434",
      toolCalls: [{ tool: "mcp__pdh__collect_app_data" }],
    });
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ kind: "tool", channel: "remote_api" });
  });

  it("tolerates a missing/empty toolCalls and usage", () => {
    expect(turnEgressEvents({ provider: "ollama" })).toEqual([]);
    expect(
      turnEgressEvents({ provider: "anthropic", toolCalls: null }),
    ).toHaveLength(1);
  });
});
