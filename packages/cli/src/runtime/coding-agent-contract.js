import { ToolRegistry, createDefaultToolRegistry } from "../tools/registry.js";
import sharedCodingAgentPolicy from "./coding-agent-policy.cjs";

const { TOOL_POLICY_METADATA } = sharedCodingAgentPolicy;

const CODING_AGENT_TOOL_CONTRACTS = Object.freeze([
  {
    name: "read_file",
    title: "Read File",
    kind: "filesystem",
    tier: "mvp",
    ...TOOL_POLICY_METADATA.read_file,
    permissions: {
      level: "readonly",
      scopes: ["filesystem:read"],
    },
    telemetry: {
      category: "filesystem",
      tags: ["tool:read_file", "contract:coding-agent", "tier:mvp"],
    },
  },
  {
    name: "write_file",
    title: "Write File",
    kind: "filesystem",
    tier: "mvp",
    ...TOOL_POLICY_METADATA.write_file,
    permissions: {
      level: "elevated",
      scopes: ["filesystem:write"],
    },
    telemetry: {
      category: "filesystem",
      tags: ["tool:write_file", "contract:coding-agent", "tier:mvp"],
    },
  },
  {
    name: "edit_file",
    title: "Edit File",
    kind: "filesystem",
    tier: "mvp",
    ...TOOL_POLICY_METADATA.edit_file,
    permissions: {
      level: "elevated",
      scopes: ["filesystem:write"],
    },
    telemetry: {
      category: "filesystem",
      tags: ["tool:edit_file", "contract:coding-agent", "tier:mvp"],
    },
  },
  {
    name: "run_shell",
    title: "Run Shell",
    kind: "shell",
    tier: "mvp",
    ...TOOL_POLICY_METADATA.run_shell,
    runtimeDescriptor: "shell",
    permissions: {
      level: "elevated",
      scopes: ["process:spawn", "filesystem:workspace"],
    },
    telemetry: {
      category: "shell",
      tags: ["tool:run_shell", "contract:coding-agent", "tier:mvp"],
    },
  },
  {
    name: "git",
    title: "Git",
    kind: "git",
    tier: "mvp",
    ...TOOL_POLICY_METADATA.git,
    runtimeDescriptor: "git",
    permissions: {
      level: "elevated",
      scopes: ["process:spawn", "filesystem:workspace", "vcs:git"],
    },
    telemetry: {
      category: "git",
      tags: ["tool:git", "contract:coding-agent", "tier:mvp"],
    },
  },
  {
    name: "search_files",
    title: "Search Files",
    kind: "filesystem",
    tier: "mvp",
    ...TOOL_POLICY_METADATA.search_files,
    permissions: {
      level: "readonly",
      scopes: ["filesystem:read", "search:content"],
    },
    telemetry: {
      category: "filesystem",
      tags: ["tool:search_files", "contract:coding-agent", "tier:mvp"],
    },
  },
  {
    name: "list_dir",
    title: "List Directory",
    kind: "filesystem",
    tier: "mvp",
    ...TOOL_POLICY_METADATA.list_dir,
    permissions: {
      level: "readonly",
      scopes: ["filesystem:read"],
    },
    telemetry: {
      category: "filesystem",
      tags: ["tool:list_dir", "contract:coding-agent", "tier:mvp"],
    },
  },
  {
    name: "run_skill",
    title: "Run Skill",
    kind: "skill",
    tier: "extension",
    ...TOOL_POLICY_METADATA.run_skill,
    permissions: {
      level: "standard",
      scopes: ["skill:invoke"],
    },
    telemetry: {
      category: "skill",
      tags: ["tool:run_skill", "contract:coding-agent", "tier:extension"],
    },
  },
  {
    name: "list_skills",
    title: "List Skills",
    kind: "skill",
    tier: "extension",
    ...TOOL_POLICY_METADATA.list_skills,
    permissions: {
      level: "readonly",
      scopes: ["skill:read"],
    },
    telemetry: {
      category: "skill",
      tags: ["tool:list_skills", "contract:coding-agent", "tier:extension"],
    },
  },
  {
    name: "run_code",
    title: "Run Code",
    kind: "code",
    tier: "extension",
    ...TOOL_POLICY_METADATA.run_code,
    permissions: {
      level: "elevated",
      scopes: ["process:spawn", "filesystem:workspace", "runtime:script"],
    },
    telemetry: {
      category: "code",
      tags: ["tool:run_code", "contract:coding-agent", "tier:extension"],
    },
  },
  {
    name: "spawn_sub_agent",
    title: "Spawn Sub Agent",
    kind: "agent",
    tier: "extension",
    ...TOOL_POLICY_METADATA.spawn_sub_agent,
    permissions: {
      level: "elevated",
      scopes: ["agent:spawn"],
    },
    telemetry: {
      category: "agent",
      tags: ["tool:spawn_sub_agent", "contract:coding-agent", "tier:extension"],
    },
  },
]);

export const CODING_AGENT_MVP_TOOL_NAMES = Object.freeze(
  CODING_AGENT_TOOL_CONTRACTS.filter((tool) => tool.tier === "mvp").map(
    (tool) => tool.name,
  ),
);

export const CODING_AGENT_EXTENSION_TOOL_NAMES = Object.freeze(
  CODING_AGENT_TOOL_CONTRACTS.filter((tool) => tool.tier === "extension").map(
    (tool) => tool.name,
  ),
);

const TOOL_CONTRACT_MAP = new Map(
  CODING_AGENT_TOOL_CONTRACTS.map((tool) => [tool.name, tool]),
);
const runtimeRegistry = createDefaultToolRegistry();

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function getFallbackToolContract(name) {
  return {
    name,
    title: name,
    kind: "legacy",
    tier: "legacy",
    riskLevel: "medium",
    availableInPlanMode: false,
    planModeBehavior: "blocked",
    requiresPlanApproval: false,
    approvalFlow: "policy",
    permissions: {
      level: "standard",
      scopes: [],
    },
    telemetry: {
      category: "legacy",
      tags: [`tool:${name}`, "contract:coding-agent", "tier:legacy"],
    },
  };
}

export function getCodingAgentToolContract(name) {
  const tool = TOOL_CONTRACT_MAP.get(name);
  return tool ? cloneValue(tool) : null;
}

export function getCodingAgentToolContracts({ tier = null } = {}) {
  return CODING_AGENT_TOOL_CONTRACTS.filter((tool) => {
    if (tier && tool.tier !== tier) {
      return false;
    }
    return true;
  }).map(cloneValue);
}

export function listCodingAgentToolNames({ tier = null } = {}) {
  return getCodingAgentToolContracts({ tier }).map((tool) => tool.name);
}

export function isCodingAgentMvpTool(name) {
  return CODING_AGENT_MVP_TOOL_NAMES.includes(name);
}

export function getCodingAgentToolPolicy(name) {
  const tool = TOOL_CONTRACT_MAP.get(name);
  if (!tool) {
    return null;
  }

  return {
    tier: tool.tier,
    riskLevel: tool.riskLevel,
    availableInPlanMode: tool.availableInPlanMode,
    planModeBehavior: tool.planModeBehavior || "standard",
    requiresPlanApproval: tool.requiresPlanApproval,
    approvalFlow: tool.approvalFlow,
    permissions: cloneValue(tool.permissions),
  };
}

export function mapCodingAgentToolDefinition(definition = {}, options = {}) {
  const fn = definition.function || {};
  const name = fn.name;
  if (!name) {
    throw new Error("Coding agent tool definition requires function.name.");
  }

  const contract =
    getCodingAgentToolContract(name) || getFallbackToolContract(name);

  return {
    name,
    title: contract.title || name,
    kind: contract.kind,
    description: fn.description || "",
    schema: fn.parameters || { type: "object", properties: {} },
    permissions: cloneValue(contract.permissions),
    telemetry: cloneValue(contract.telemetry),
    source: options.source || "agent-core",
  };
}

export function createCodingAgentToolRegistry(definitions = [], options = {}) {
  const registry = new ToolRegistry();
  definitions.forEach((definition) => {
    registry.register(mapCodingAgentToolDefinition(definition, options));
  });
  return registry;
}

export function getCodingAgentRuntimeDescriptor(toolName) {
  const descriptorName = TOOL_CONTRACT_MAP.get(toolName)?.runtimeDescriptor;
  if (!descriptorName) {
    return null;
  }
  return runtimeRegistry.get(descriptorName) || null;
}
