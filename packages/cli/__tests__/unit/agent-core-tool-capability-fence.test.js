import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { agentLoop } from "../../src/runtime/agent-core.js";

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-tool-fence-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function drive(toolCall, options = {}) {
  let calls = 0;
  const chatFn = vi.fn(async () => {
    calls += 1;
    if (calls === 1) {
      return {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [toolCall],
        },
        usage: {},
      };
    }
    return {
      message: { role: "assistant", content: "done" },
      usage: {},
    };
  });
  const events = [];
  for await (const event of agentLoop(
    [{ role: "user", content: "test capability fence" }],
    {
      cwd: tmp,
      chatFn,
      autoCompact: false,
      runnableProviderFallback: false,
      ...options,
    },
  )) {
    events.push(event);
  }
  return events;
}

describe("agent-loop execution-time tool capability fence", () => {
  it("blocks a provider-emitted built-in tool omitted from the schema", async () => {
    const target = path.join(tmp, "must-not-exist.txt");
    const events = await drive(
      {
        id: "call-write",
        type: "function",
        function: {
          name: "write_file",
          arguments: JSON.stringify({ path: target, content: "forbidden" }),
        },
      },
      { enabledToolNames: ["read_file"] },
    );

    const result = events.find((event) => event.type === "tool-result")?.result;
    expect(result).toMatchObject({
      policy: { decision: "blocked", via: "effective-tool-set" },
    });
    expect(result.error).toContain("outside this run's effective tool set");
    expect(fs.existsSync(target)).toBe(false);
  });

  it("blocks an external executor when the effective allowlist is empty", async () => {
    const mcpClient = { callTool: vi.fn() };
    const name = "mcp__weather__delete";
    const events = await drive(
      {
        id: "call-mcp",
        type: "function",
        function: { name, arguments: "{}" },
      },
      {
        enabledToolNames: [],
        extraToolDefinitions: [
          {
            type: "function",
            function: {
              name,
              description: "Delete weather data",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
        externalToolDescriptors: { [name]: { name, kind: "mcp" } },
        externalToolExecutors: {
          [name]: { kind: "mcp", serverName: "weather", toolName: "delete" },
        },
        mcpClient,
      },
    );

    const result = events.find((event) => event.type === "tool-result")?.result;
    expect(result).toMatchObject({
      policy: { decision: "blocked", via: "effective-tool-set" },
    });
    expect(mcpClient.callTool).not.toHaveBeenCalled();
  });

  it("blocks an external executor outside a non-empty exact child ceiling", async () => {
    const mcpClient = { callTool: vi.fn() };
    const name = "mcp__weather__delete";
    const events = await drive(
      {
        id: "call-mcp-exact",
        type: "function",
        function: { name, arguments: "{}" },
      },
      {
        enabledToolNames: ["read_file"],
        exactToolNames: true,
        extraToolDefinitions: [
          {
            type: "function",
            function: {
              name,
              description: "Delete weather data",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
        externalToolDescriptors: { [name]: { name, kind: "mcp" } },
        externalToolExecutors: {
          [name]: { kind: "mcp", serverName: "weather", toolName: "delete" },
        },
        mcpClient,
      },
    );

    const result = events.find((event) => event.type === "tool-result")?.result;
    expect(result).toMatchObject({
      policy: { decision: "blocked", via: "effective-tool-set" },
    });
    expect(mcpClient.callTool).not.toHaveBeenCalled();
  });
});
