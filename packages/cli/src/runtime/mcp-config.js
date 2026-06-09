/**
 * Ad-hoc MCP config loader for headless agent runs (`cc agent --mcp-config`).
 *
 * Claude-Code parity: load a JSON file describing MCP servers, connect them for
 * the duration of one headless run, and expose each server's tools to the LLM.
 *
 * The agent loop already knows how to *call* an MCP tool — it just needs three
 * things wired into its options (see agent-core.js):
 *   - extraToolDefinitions     → the LLM sees the tools (OpenAI function shape)
 *   - externalToolExecutors    → name → {kind:"mcp", serverName, toolName}
 *   - mcpClient                → executes mcpClient.callTool(server, tool, args)
 *
 * Tools are namespaced `mcp__<server>__<tool>` (Claude-Code convention) so they
 * never collide with built-in agent tools or across servers.
 */

import fs from "fs";
import { MCPClient } from "../harness/mcp-client.js";

/**
 * Normalize a parsed config object into a `{ name: serverConfig }` map.
 * Accepts the Claude-Code shape `{ "mcpServers": { ... } }`, the bundle shape
 * `{ "servers": { ... } }`, or a bare `{ name: cfg }` map.
 */
export function parseMcpServers(raw) {
  const block =
    (raw && typeof raw === "object" && (raw.mcpServers || raw.servers)) ||
    raw ||
    {};
  const out = {};
  for (const [name, cfg] of Object.entries(block)) {
    if (!cfg || typeof cfg !== "object") continue;
    out[name] = {
      command: cfg.command,
      args: Array.isArray(cfg.args) ? cfg.args : [],
      env: cfg.env && typeof cfg.env === "object" ? cfg.env : {},
      url: cfg.url,
      transport: cfg.transport,
      headers: cfg.headers && typeof cfg.headers === "object" ? cfg.headers : {},
    };
  }
  return out;
}

/** Namespaced tool name exposed to the LLM. */
export function mcpToolName(server, tool) {
  return `mcp__${server}__${tool}`;
}

/**
 * Connect the given servers and build the agent-loop wiring. Connection
 * failures are reported (writeErr) but never abort the run — a broken server
 * just contributes no tools.
 *
 * @param {object} servers  `{ name: { command|url, args, env, transport, headers } }`
 * @param {object} [deps]   { writeErr, createClient }
 * @returns {Promise<{mcpClient, extraToolDefinitions, externalToolExecutors,
 *                     externalToolDescriptors, connected}>}
 */
export async function setupMcpFromConfig(servers, deps = {}) {
  const writeErr = deps.writeErr || (() => {});
  const createClient = deps.createClient || (() => new MCPClient());

  const mcpClient = createClient();
  const extraToolDefinitions = [];
  const externalToolExecutors = {};
  const externalToolDescriptors = {};
  const connected = [];

  for (const [name, cfg] of Object.entries(servers)) {
    let result;
    try {
      result = await mcpClient.connect(name, cfg);
    } catch (err) {
      writeErr(`  mcp: failed to connect "${name}": ${err.message}\n`);
      continue;
    }
    const tools = Array.isArray(result?.tools) ? result.tools : [];
    connected.push({ server: name, tools: tools.length });
    for (const t of tools) {
      if (!t || !t.name) continue;
      const full = mcpToolName(name, t.name);
      extraToolDefinitions.push({
        type: "function",
        function: {
          name: full,
          description: t.description || `MCP tool "${t.name}" on server "${name}"`,
          parameters: t.inputSchema || { type: "object", properties: {} },
        },
      });
      externalToolExecutors[full] = {
        kind: "mcp",
        serverName: name,
        toolName: t.name,
      };
      externalToolDescriptors[full] = {
        name: full,
        kind: "mcp",
        category: "mcp",
        source: name,
      };
    }
  }

  return {
    mcpClient,
    extraToolDefinitions,
    externalToolExecutors,
    externalToolDescriptors,
    connected,
  };
}

/**
 * Read + parse a `--mcp-config` file and connect its servers.
 * Throws on an unreadable/empty config (fail fast — the user asked for MCP).
 *
 * @param {string} filePath
 * @param {object} [deps]  { writeErr, createClient, readFile }
 */
export async function loadMcpConfig(filePath, deps = {}) {
  const readFile = deps.readFile || ((p) => fs.readFileSync(p, "utf-8"));
  let raw;
  try {
    raw = JSON.parse(readFile(filePath));
  } catch (err) {
    throw new Error(
      `--mcp-config: cannot read/parse "${filePath}": ${err.message}`,
    );
  }
  const servers = parseMcpServers(raw);
  if (Object.keys(servers).length === 0) {
    throw new Error(
      `--mcp-config: no servers found in "${filePath}" ` +
        `(expected {"mcpServers": {"name": {"command": "..."}}}).`,
    );
  }
  return setupMcpFromConfig(servers, deps);
}
