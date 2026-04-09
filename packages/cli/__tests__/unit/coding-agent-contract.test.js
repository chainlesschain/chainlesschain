import { describe, it, expect } from "vitest";
import {
  CODING_AGENT_EXTENSION_TOOL_NAMES,
  CODING_AGENT_MVP_TOOL_NAMES,
  createCodingAgentToolRegistry,
  getCodingAgentFunctionToolDefinitions,
  getCodingAgentRuntimeDescriptor,
  getCodingAgentRuntimeDescriptorByCommand,
  getCodingAgentToolContract,
  getCodingAgentToolPolicy,
  isCodingAgentMvpTool,
  listCodingAgentToolNames,
  mapCodingAgentToolDefinition,
} from "../../src/runtime/coding-agent-contract.js";

const CODING_AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_shell",
      description: "Run shell command",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "git",
      description: "Run git command",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "spawn_sub_agent",
      description: "Spawn a sub-agent",
      parameters: {
        type: "object",
        properties: {
          role: { type: "string" },
          task: { type: "string" },
        },
        required: ["role", "task"],
      },
    },
  },
];

describe("coding-agent contract", () => {
  it("exposes the MVP and extension tool partitions", () => {
    expect(CODING_AGENT_MVP_TOOL_NAMES).toEqual(
      expect.arrayContaining([
        "read_file",
        "write_file",
        "edit_file",
        "run_shell",
        "git",
        "search_files",
        "list_dir",
      ]),
    );
    expect(CODING_AGENT_EXTENSION_TOOL_NAMES).toEqual(
      expect.arrayContaining([
        "run_skill",
        "list_skills",
        "run_code",
        "spawn_sub_agent",
      ]),
    );
  });

  it("returns contract and policy metadata for a known tool", () => {
    expect(getCodingAgentToolContract("run_shell")).toMatchObject({
      name: "run_shell",
      tier: "mvp",
      description: expect.stringContaining("shell command"),
      riskLevel: "high",
      availableInPlanMode: false,
      requiresPlanApproval: true,
      approvalFlow: "policy",
    });

    expect(getCodingAgentToolPolicy("edit_file")).toMatchObject({
      tier: "mvp",
      riskLevel: "medium",
      availableInPlanMode: false,
      requiresPlanApproval: true,
    });
  });

  it("derives function-calling definitions from the canonical contract", () => {
    const definitions = getCodingAgentFunctionToolDefinitions({
      names: ["read_file", "run_shell"],
    });

    expect(definitions).toEqual([
      {
        type: "function",
        function: {
          name: "read_file",
          description: "Read a file's content",
          parameters: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "File path to read",
              },
            },
            required: ["path"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "run_shell",
          description: expect.stringContaining("shell command"),
          parameters: expect.objectContaining({
            type: "object",
            required: ["command"],
          }),
        },
      },
    ]);
  });

  it("maps tool definitions into registry descriptors using the contract", () => {
    expect(mapCodingAgentToolDefinition(CODING_AGENT_TOOLS[0])).toEqual(
      expect.objectContaining({
        name: "read_file",
        kind: "filesystem",
        source: "agent-core",
        permissions: expect.objectContaining({
          level: "readonly",
        }),
      }),
    );

    const registry = createCodingAgentToolRegistry(CODING_AGENT_TOOLS);
    expect(registry.list().map((tool) => tool.name)).toEqual([
      "read_file",
      "run_shell",
      "git",
      "spawn_sub_agent",
    ]);
  });

  it("exposes runtime descriptors for runtime-managed tools", () => {
    expect(getCodingAgentRuntimeDescriptor("run_shell")).toMatchObject({
      name: "shell",
    });
    expect(getCodingAgentRuntimeDescriptor("git")).toMatchObject({
      name: "git",
    });
    expect(getCodingAgentRuntimeDescriptor("read_file")).toBeNull();
  });

  it("resolves runtime descriptors from shell command strings", () => {
    expect(getCodingAgentRuntimeDescriptorByCommand("git status")).toMatchObject(
      {
        name: "git",
      },
    );
    expect(
      getCodingAgentRuntimeDescriptorByCommand(
        "chainlesschain mcp call tools list",
      ),
    ).toMatchObject({
      name: "mcp",
    });
    expect(getCodingAgentRuntimeDescriptorByCommand("echo hello")).toMatchObject(
      {
        name: "shell",
      },
    );
  });

  it("can distinguish MVP tools from extension tools", () => {
    expect(isCodingAgentMvpTool("read_file")).toBe(true);
    expect(isCodingAgentMvpTool("run_code")).toBe(false);
    expect(listCodingAgentToolNames()).toEqual(
      expect.arrayContaining(["read_file", "git", "run_code"]),
    );
  });
});
