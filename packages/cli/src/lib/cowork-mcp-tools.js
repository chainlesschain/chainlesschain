/**
 * Cowork Template MCP Tools — mount a template's declared MCP servers and
 * expose their tools to the sub-agent's LLM.
 *
 * A template can declare `mcpServers: [{ name, command, args, env, cwd }]`
 * (same shape accepted by skill-mcp's validateMcpServerConfig). At task
 * start we spawn an MCPClient, connect each server, list their tools, and
 * build three parallel maps the agent-core runtime already consumes:
 *
 *  - `extraToolDefinitions`    — OpenAI-style function definitions appended
 *    to the tool list the LLM sees.
 *  - `externalToolDescriptors` — descriptor metadata keyed by tool name.
 *  - `externalToolExecutors`   — { kind: "mcp", serverName, toolName } routing
 *    handles that agent-core's default-case switch dispatches through
 *    `mcpClient.callTool(serverName, toolName, args)`.
 *
 * Tool names are prefixed `mcp__<serverName>__<toolName>` to avoid collisions
 * across servers and with built-in AGENT_TOOLS.
 *
 * @module cowork-mcp-tools
 */
import { validateMcpServerConfig } from "./skill-mcp.js";

export const _deps = {
  importMcpClient: async () => {
    const mod = await import("../harness/mcp-client.js");
    return mod.MCPClient;
  },
};

/** Build the namespaced tool name used on the wire. */
export function buildToolName(serverName, toolName) {
  return `mcp__${serverName}__${toolName}`;
}

/**
 * Convert a single MCP tool (from tools/list) into the three shapes
 * agent-core consumes.
 *
 * @param {string} serverName
 * @param {{ name: string, description?: string, inputSchema?: object }} tool
 * @returns {{ definition: object, descriptor: object, executor: object }}
 */
export function toAgentTool(serverName, tool) {
  const wireName = buildToolName(serverName, tool.name);
  return {
    definition: {
      type: "function",
      function: {
        name: wireName,
        description:
          tool.description ||
          `MCP tool "${tool.name}" from server "${serverName}"`,
        parameters: tool.inputSchema || {
          type: "object",
          properties: {},
        },
      },
    },
    descriptor: {
      name: wireName,
      kind: "mcp",
      category: "mcp",
      source: "cowork-template-mcp",
      serverName,
      originalName: tool.name,
    },
    executor: {
      kind: "mcp",
      serverName,
      toolName: tool.name,
    },
  };
}

/**
 * Mount a template's MCP servers and expose their tools. Returns maps ready
 * to hand to SubAgentContext + a cleanup() that disconnects all servers.
 *
 * Failures connecting individual servers are tolerated — the returned
 * `skipped` array lists them with error messages. The whole call only
 * throws if `template.mcpServers` is non-empty but validation produces zero
 * valid configs (caller likely mis-configured the template).
 *
 * @param {{ mcpServers?: Array<object> }} template
 * @param {object} [opts]
 * @param {(msg: string, err?: Error) => void} [opts.onWarn]
 * @returns {Promise<{
 *   mcpClient: object|null,
 *   mounted: string[],
 *   skipped: Array<{ name: string, error: string }>,
 *   extraToolDefinitions: Array<object>,
 *   externalToolDescriptors: Record<string, object>,
 *   externalToolExecutors: Record<string, object>,
 *   cleanup: () => Promise<void>,
 * }>}
 */
export async function mountTemplateMcpTools(template, opts = {}) {
  const empty = {
    mcpClient: null,
    mounted: [],
    skipped: [],
    extraToolDefinitions: [],
    externalToolDescriptors: {},
    externalToolExecutors: {},
    cleanup: async () => {},
  };

  const declared = Array.isArray(template?.mcpServers)
    ? template.mcpServers
    : [];
  if (declared.length === 0) return empty;

  const validated = declared
    .map((entry) => validateMcpServerConfig(entry))
    .filter(Boolean);
  if (validated.length === 0) return empty;

  const MCPClient = await _deps.importMcpClient();
  const mcpClient = new MCPClient();
  const mounted = [];
  const skipped = [];
  const extraToolDefinitions = [];
  const externalToolDescriptors = {};
  const externalToolExecutors = {};

  for (const server of validated) {
    try {
      await mcpClient.connect(server.name, server);
      mounted.push(server.name);
      const tools = mcpClient.listTools(server.name);
      for (const tool of tools) {
        const { definition, descriptor, executor } = toAgentTool(
          server.name,
          tool,
        );
        extraToolDefinitions.push(definition);
        externalToolDescriptors[definition.function.name] = descriptor;
        externalToolExecutors[definition.function.name] = executor;
      }
    } catch (err) {
      const message = err?.message || String(err);
      skipped.push({ name: server.name, error: message });
      if (typeof opts.onWarn === "function") {
        opts.onWarn(
          `[cowork-mcp] Failed to mount "${server.name}": ${message}`,
          err,
        );
      }
    }
  }

  const cleanup = async () => {
    if (typeof mcpClient.disconnectAll === "function") {
      try {
        await mcpClient.disconnectAll();
        return;
      } catch (_e) {
        // fall through to per-server disconnect
      }
    }
    for (const name of mounted) {
      try {
        if (typeof mcpClient.disconnect === "function") {
          await mcpClient.disconnect(name);
        }
      } catch (_e) {
        // swallow — cleanup must not fail the task
      }
    }
  };

  return {
    mcpClient,
    mounted,
    skipped,
    extraToolDefinitions,
    externalToolDescriptors,
    externalToolExecutors,
    cleanup,
  };
}
