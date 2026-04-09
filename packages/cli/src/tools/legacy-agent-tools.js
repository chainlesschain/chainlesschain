import {
  createCodingAgentToolRegistry,
  getCodingAgentRuntimeDescriptor,
  getCodingAgentRuntimeDescriptorByCommand,
  listCodingAgentToolNames,
  mapCodingAgentToolDefinition,
} from "../runtime/coding-agent-contract.js";

export function mapLegacyAgentToolDefinition(definition = {}) {
  return mapCodingAgentToolDefinition(definition, {
    source: "agent-core",
  });
}

export function createLegacyAgentToolRegistry(definitions = []) {
  return createCodingAgentToolRegistry(definitions, {
    source: "agent-core",
  });
}

export function listLegacyAgentToolNames() {
  return listCodingAgentToolNames();
}

export function getRuntimeToolDescriptor(toolName) {
  return getCodingAgentRuntimeDescriptor(toolName);
}

export function getRuntimeToolDescriptorByCommand(command) {
  return getCodingAgentRuntimeDescriptorByCommand(command);
}
