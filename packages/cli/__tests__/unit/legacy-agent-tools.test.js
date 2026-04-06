import { describe, it, expect } from "vitest";
import {
  mapLegacyAgentToolDefinition,
  createLegacyAgentToolRegistry,
  listLegacyAgentToolNames,
} from "../../src/tools/legacy-agent-tools.js";

const LEGACY_AGENT_TOOLS = [
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
      name: "spawn_sub_agent",
      description: "Spawn a sub agent",
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

describe("legacy agent tools bridge", () => {
  it("maps legacy agent-core tool definitions into registry descriptors", () => {
    expect(mapLegacyAgentToolDefinition(LEGACY_AGENT_TOOLS[0])).toEqual(
      expect.objectContaining({
        name: "read_file",
        kind: "filesystem",
        source: "agent-core",
        permissions: expect.objectContaining({
          level: "readonly",
          scopes: ["filesystem:read"],
        }),
      }),
    );

    expect(mapLegacyAgentToolDefinition(LEGACY_AGENT_TOOLS[1])).toEqual(
      expect.objectContaining({
        name: "run_shell",
        kind: "shell",
        permissions: expect.objectContaining({
          level: "elevated",
        }),
      }),
    );
  });

  it("creates a registry from legacy agent-core definitions", () => {
    const registry = createLegacyAgentToolRegistry(LEGACY_AGENT_TOOLS);
    expect(registry.list().map((tool) => tool.name)).toEqual([
      "read_file",
      "run_shell",
      "spawn_sub_agent",
    ]);
  });

  it("exposes known legacy agent tool names", () => {
    expect(listLegacyAgentToolNames()).toEqual(
      expect.arrayContaining([
        "read_file",
        "write_file",
        "edit_file",
        "run_shell",
        "search_files",
        "list_dir",
        "run_skill",
        "list_skills",
        "run_code",
        "spawn_sub_agent",
      ]),
    );
  });
});
