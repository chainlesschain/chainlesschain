/**
 * Integration: Skill-Embedded MCP → ContextEngineering filter
 *
 * Verifies that when a skill mounts MCP servers and we forward the active
 * server names through `buildOptimizedPrompt({ activeMcpServers })`, the
 * resulting LLM prompt only exposes those servers' MCP tools.
 *
 * Boundary: ContextEngineering's tool-list filter — no real LLM round-trip.
 */

import { describe, it, expect, beforeEach } from "vitest";

const {
  ContextEngineering,
} = require("../../src/main/llm/context-engineering");

function fcTool(name) {
  return { name, source: "function-caller", tags: [], description: name };
}

function mcpTool(name, serverName) {
  return {
    name,
    source: "mcp",
    serverName,
    tags: ["mcp", serverName, `server:${serverName}`],
    description: `${serverName} tool`,
  };
}

describe("integration: skill-embedded MCP filter through ContextEngineering", () => {
  let ctx;

  beforeEach(() => {
    ctx = new ContextEngineering({ enableKVCacheOptimization: true });
  });

  it("end-to-end: only the active skill's MCP servers reach the prompt", () => {
    const tools = [
      fcTool("read_file"),
      fcTool("edit_file"),
      mcpTool("mcp_weather_today", "weather"),
      mcpTool("mcp_weather_forecast", "weather"),
      mcpTool("mcp_github_issues", "github"),
      mcpTool("mcp_slack_post", "slack"),
    ];

    // Skill `weather-agent` mounted only the "weather" server.
    const result = ctx.buildOptimizedPrompt({
      systemPrompt: "You are a weather assistant",
      tools,
      activeMcpServers: new Set(["weather"]),
    });

    const toolMsg = result.messages.find((m) =>
      m.content?.startsWith("## Available Tools"),
    );
    expect(toolMsg).toBeTruthy();

    // Function-caller tools always pass through
    expect(toolMsg.content).toContain("read_file");
    expect(toolMsg.content).toContain("edit_file");

    // Allowed MCP server tools present
    expect(toolMsg.content).toContain("mcp_weather_today");
    expect(toolMsg.content).toContain("mcp_weather_forecast");

    // Other MCP servers stripped out
    expect(toolMsg.content).not.toContain("mcp_github_issues");
    expect(toolMsg.content).not.toContain("mcp_slack_post");
  });

  it("switching skills changes the visible MCP tool surface", () => {
    const tools = [
      mcpTool("mcp_weather_today", "weather"),
      mcpTool("mcp_github_issues", "github"),
    ];

    const r1 = ctx.buildOptimizedPrompt({
      systemPrompt: "sys",
      tools,
      activeMcpServers: ["weather"],
    });
    const r2 = ctx.buildOptimizedPrompt({
      systemPrompt: "sys",
      tools,
      activeMcpServers: ["github"],
    });

    const t1 = r1.messages.find((m) =>
      m.content?.startsWith("## Available Tools"),
    ).content;
    const t2 = r2.messages.find((m) =>
      m.content?.startsWith("## Available Tools"),
    ).content;

    expect(t1).toContain("mcp_weather_today");
    expect(t1).not.toContain("mcp_github_issues");
    expect(t2).toContain("mcp_github_issues");
    expect(t2).not.toContain("mcp_weather_today");
  });

  it("null whitelist preserves the legacy full-MCP behavior", () => {
    const tools = [
      mcpTool("mcp_weather_today", "weather"),
      mcpTool("mcp_github_issues", "github"),
    ];
    const r = ctx.buildOptimizedPrompt({
      systemPrompt: "sys",
      tools,
      // activeMcpServers omitted
    });
    const t = r.messages.find((m) =>
      m.content?.startsWith("## Available Tools"),
    ).content;
    expect(t).toContain("mcp_weather_today");
    expect(t).toContain("mcp_github_issues");
  });
});
