import { ToolRegistry, createDefaultToolRegistry } from "../tools/registry.js";
import sharedContract from "./coding-agent-contract-shared.cjs";

const {
  CODING_AGENT_EXTENSION_TOOL_NAMES,
  CODING_AGENT_MVP_TOOL_NAMES,
  getCodingAgentFunctionToolDefinition,
  getCodingAgentFunctionToolDefinitions,
  getCodingAgentToolContract,
  getCodingAgentToolContracts,
  getCodingAgentToolPolicy,
  isCodingAgentMvpTool,
  listCodingAgentToolNames,
} = sharedContract;

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

export {
  CODING_AGENT_EXTENSION_TOOL_NAMES,
  CODING_AGENT_MVP_TOOL_NAMES,
  getCodingAgentFunctionToolDefinition,
  getCodingAgentFunctionToolDefinitions,
  getCodingAgentToolContract,
  getCodingAgentToolContracts,
  getCodingAgentToolPolicy,
  isCodingAgentMvpTool,
  listCodingAgentToolNames,
};

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
    description: fn.description || contract.description || "",
    schema: fn.parameters ||
      (contract.inputSchema
        ? cloneValue(contract.inputSchema)
        : {
            type: "object",
            properties: {},
          }),
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
  const descriptorName = getCodingAgentToolContract(toolName)?.runtimeDescriptor;
  if (!descriptorName) {
    return null;
  }
  return runtimeRegistry.get(descriptorName) || null;
}

export function getCodingAgentRuntimeDescriptorByCommand(command) {
  const trimmed = String(command || "").trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(/\s+/);
  if (parts[0] === "git") {
    return runtimeRegistry.get("git") || null;
  }
  if (parts[0] === "mcp" || parts.includes("mcp")) {
    return runtimeRegistry.get("mcp") || null;
  }
  return runtimeRegistry.get("shell") || null;
}
