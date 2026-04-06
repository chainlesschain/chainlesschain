import { ToolRegistry, createDefaultToolRegistry } from "./registry.js";

const LEGACY_TOOL_METADATA = {
  read_file: {
    title: "Read File",
    kind: "filesystem",
    permissions: {
      level: "readonly",
      scopes: ["filesystem:read"],
    },
    telemetry: {
      category: "filesystem",
      tags: ["tool:read_file", "legacy:agent-core"],
    },
  },
  write_file: {
    title: "Write File",
    kind: "filesystem",
    permissions: {
      level: "elevated",
      scopes: ["filesystem:write"],
    },
    telemetry: {
      category: "filesystem",
      tags: ["tool:write_file", "legacy:agent-core"],
    },
  },
  edit_file: {
    title: "Edit File",
    kind: "filesystem",
    permissions: {
      level: "elevated",
      scopes: ["filesystem:write"],
    },
    telemetry: {
      category: "filesystem",
      tags: ["tool:edit_file", "legacy:agent-core"],
    },
  },
  run_shell: {
    title: "Run Shell",
    kind: "shell",
    runtimeDescriptor: "shell",
    permissions: {
      level: "elevated",
      scopes: ["process:spawn", "filesystem:workspace"],
    },
    telemetry: {
      category: "shell",
      tags: ["tool:run_shell", "legacy:agent-core"],
    },
  },
  search_files: {
    title: "Search Files",
    kind: "filesystem",
    permissions: {
      level: "readonly",
      scopes: ["filesystem:read", "search:content"],
    },
    telemetry: {
      category: "filesystem",
      tags: ["tool:search_files", "legacy:agent-core"],
    },
  },
  list_dir: {
    title: "List Directory",
    kind: "filesystem",
    permissions: {
      level: "readonly",
      scopes: ["filesystem:read"],
    },
    telemetry: {
      category: "filesystem",
      tags: ["tool:list_dir", "legacy:agent-core"],
    },
  },
  run_skill: {
    title: "Run Skill",
    kind: "skill",
    permissions: {
      level: "standard",
      scopes: ["skill:invoke"],
    },
    telemetry: {
      category: "skill",
      tags: ["tool:run_skill", "legacy:agent-core"],
    },
  },
  list_skills: {
    title: "List Skills",
    kind: "skill",
    permissions: {
      level: "readonly",
      scopes: ["skill:read"],
    },
    telemetry: {
      category: "skill",
      tags: ["tool:list_skills", "legacy:agent-core"],
    },
  },
  run_code: {
    title: "Run Code",
    kind: "code",
    permissions: {
      level: "elevated",
      scopes: ["process:spawn", "filesystem:workspace", "runtime:script"],
    },
    telemetry: {
      category: "code",
      tags: ["tool:run_code", "legacy:agent-core"],
    },
  },
  spawn_sub_agent: {
    title: "Spawn Sub Agent",
    kind: "agent",
    permissions: {
      level: "elevated",
      scopes: ["agent:spawn"],
    },
    telemetry: {
      category: "agent",
      tags: ["tool:spawn_sub_agent", "legacy:agent-core"],
    },
  },
};

export function mapLegacyAgentToolDefinition(definition = {}) {
  const fn = definition.function || {};
  const name = fn.name;
  if (!name) {
    throw new Error("Legacy agent tool definition requires function.name.");
  }

  const metadata = LEGACY_TOOL_METADATA[name] || {
    title: name,
    kind: "legacy",
    permissions: { level: "standard", scopes: [] },
    telemetry: { category: "legacy", tags: [`tool:${name}`, "legacy:agent-core"] },
  };

  return {
    name,
    title: metadata.title || name,
    kind: metadata.kind,
    description: fn.description || "",
    schema: fn.parameters || { type: "object", properties: {} },
    permissions: metadata.permissions,
    telemetry: metadata.telemetry,
    source: "agent-core",
  };
}

export function createLegacyAgentToolRegistry(definitions = []) {
  const registry = new ToolRegistry();
  definitions.forEach((definition) => {
    registry.register(mapLegacyAgentToolDefinition(definition));
  });
  return registry;
}

export function listLegacyAgentToolNames() {
  return Object.keys(LEGACY_TOOL_METADATA);
}

const runtimeRegistry = createDefaultToolRegistry();

export function getRuntimeToolDescriptor(toolName) {
  const descriptorName = LEGACY_TOOL_METADATA[toolName]?.runtimeDescriptor;
  if (!descriptorName) return null;
  return runtimeRegistry.get(descriptorName) || null;
}
