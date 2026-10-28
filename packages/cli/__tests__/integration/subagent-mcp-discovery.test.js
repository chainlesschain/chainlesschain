import "../helpers/test-model-egress.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executeTool } from "../../src/runtime/agent-core.js";
import {
  applyToolSearchDeferral,
  projectMcpToolDefinitions,
} from "../../src/runtime/mcp-tool-search.js";

let cwd;
beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-child-mcp-discovery-"));
});
afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

const weather = "mcp__weather__get";
const privateTool = "mcp__private__lookup";

function toolReply(name, args, id) {
  return {
    message: {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id,
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
    },
    usage: {},
  };
}

async function runChild({
  mode = "compact",
  revoke = false,
  denySearch = false,
  denyTool = false,
  fresh = false,
} = {}) {
  const dispatchAdmission = vi.fn((_metadata, dispatch) => dispatch());
  const callTool = vi.fn(async (_server, _name, _args, options) => {
    const dispatch = () => ({ content: [{ type: "text", text: "cloudy" }] });
    return options?.dispatchAdmission
      ? options.dispatchAdmission({}, dispatch)
      : dispatch();
  });
  const parent = {
    mcpClient: { callTool },
    extraToolDefinitions: [],
    externalToolDescriptors: {},
    externalToolExecutors: {},
    instructionsByServer: {
      weather: "Use city names.",
      private: "Never expose this instruction.",
    },
  };
  for (const [server, tool] of [
    ["weather", "get"],
    ["private", "lookup"],
  ]) {
    const name = `mcp__${server}__${tool}`;
    parent.extraToolDefinitions.push({
      type: "function",
      function: {
        name,
        description: `Get ${server} data`,
        parameters: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    });
    parent.externalToolDescriptors[name] = {
      kind: "mcp",
      serverName: server,
      effectContract: { declaredEffect: "read" },
    };
    parent.externalToolExecutors[name] = {
      kind: "mcp",
      serverName: server,
      toolName: tool,
    };
  }
  applyToolSearchDeferral(parent, { catalogMode: mode });
  const requests = [];
  let toolResults = [];
  const chatFn = vi.fn(async (messages, options) => {
    requests.push(
      (options.extraToolDefinitions || []).map((def) => def.function.name),
    );
    if (requests.length === 1)
      return toolReply(
        "tool_search",
        { query: `select:${weather},${privateTool}` },
        "discover",
      );
    if (requests.length === 2) {
      if (revoke) {
        parent.extraToolDefinitions = parent.extraToolDefinitions.filter(
          (def) => def.function.name !== weather,
        );
        delete parent.externalToolExecutors[weather];
        applyToolSearchDeferral(parent);
      }
      return toolReply(weather, { city: "Shanghai" }, "weather");
    }
    toolResults = messages
      .filter((message) => message.role === "tool")
      .map((message) => JSON.parse(message.content));
    return {
      message: {
        role: "assistant",
        content: "Finished the requested attempts.",
      },
      usage: {},
    };
  });
  const result = await executeTool(
    "spawn_sub_agent",
    {
      role: "worker",
      task: "Search and use weather only",
      ...(fresh ? {} : { contextMode: "fork", mcpServers: ["weather"] }),
      permissionMode: "bypassPermissions",
    },
    {
      ...parent,
      cwd,
      parentMessages: [],
      llmOptions: { chatFn, runnableProviderFallback: false },
      effectiveAllowedToolNames: [
        "spawn_sub_agent",
        weather,
        privateTool,
        ...(denySearch ? [] : ["tool_search"]),
      ],
      subAgentContract: {
        permissionMode: "bypassPermissions",
        mcpServers: null,
      },
      mcpDispatchAdmission: dispatchAdmission,
      ...(denyTool
        ? {
            hostManagedToolPolicy: { tools: { [weather]: { allowed: false } } },
          }
        : {}),
    },
  );
  return { result, requests, toolResults, parent, callTool, dispatchAdmission };
}

describe("spawn_sub_agent MCP discovery", () => {
  it.each(["compact", "stubs"])(
    "discovers and invokes only its allowed server in %s mode",
    async (mode) => {
      const observed = await runChild({ mode });
      expect(observed.result.error).toBeUndefined();
      expect(observed.requests).toHaveLength(3);
      if (mode === "compact")
        expect(observed.requests[0]).toEqual(["tool_search"]);
      expect(observed.requests[1]).toContain(weather);
      expect(observed.requests.flat()).not.toContain(privateTool);
      expect(observed.toolResults[0]).toMatchObject({
        count: 1,
        notFound: [privateTool],
      });
      expect(JSON.stringify(observed.toolResults[0])).not.toContain(
        "Never expose this instruction",
      );
      expect(observed.toolResults[1].error).toBeUndefined();
      expect(observed.callTool).toHaveBeenCalledTimes(1);
      expect(observed.callTool.mock.calls[0].slice(0, 3)).toEqual([
        "weather",
        "get",
        { city: "Shanghai" },
      ]);
      expect(observed.dispatchAdmission).toHaveBeenCalledTimes(1);
      expect(observed.parent.toolSearchRegistry.loaded.size).toBe(0);
      if (mode === "compact")
        expect(
          projectMcpToolDefinitions(
            observed.parent.extraToolDefinitions,
            observed.parent.externalToolExecutors,
          ).map((def) => def.function.name),
        ).toEqual(["tool_search"]);
    },
  );

  it("rejects a removed parent tool after child discovery and before dispatch", async () => {
    const observed = await runChild({ revoke: true });
    expect(observed.result.error).toBeUndefined();
    expect(observed.toolResults[0].count).toBe(1);
    expect(observed.toolResults[1]).toMatchObject({
      code: "CC_MCP_TOOL_CATALOG_STALE",
    });
    expect(observed.callTool).not.toHaveBeenCalled();
    expect(observed.dispatchAdmission).not.toHaveBeenCalled();
  });

  it.each([{ denySearch: true }, { denyTool: true }, { fresh: true }])(
    "preserves parent capability, host policy and fresh-default restrictions: %j",
    async (options) => {
      const observed = await runChild(options);
      expect(observed.result.error).toBeUndefined();
      expect(observed.toolResults).toHaveLength(2);
      expect(observed.toolResults[1].error).toBeTruthy();
      expect(observed.callTool).not.toHaveBeenCalled();
      expect(observed.dispatchAdmission).not.toHaveBeenCalled();
      expect(observed.parent.toolSearchRegistry.loaded.size).toBe(0);
    },
  );
});
