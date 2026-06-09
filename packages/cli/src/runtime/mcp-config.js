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

  // `deps.into` lets a second batch (e.g. registered servers) accumulate into
  // the SAME client + channel objects as a first batch (e.g. --mcp-config), so
  // the agent loop sees one mcpClient with every server's tools.
  const result = deps.into || {
    mcpClient: createClient(),
    extraToolDefinitions: [],
    externalToolExecutors: {},
    externalToolDescriptors: {},
    connected: [],
  };
  const {
    mcpClient,
    extraToolDefinitions,
    externalToolExecutors,
    externalToolDescriptors,
    connected,
  } = result;

  for (const [name, cfg] of Object.entries(servers)) {
    // Skip a name already connected — an earlier batch (ad-hoc --mcp-config)
    // wins over a later one (registered) on a clash.
    if (mcpClient.servers?.has?.(name)) continue;
    // Inject a stored OAuth bearer token for remote servers (`cc mcp login`),
    // unless the config already supplies an Authorization header. Best-effort:
    // no token / a refresh failure just connects unauthenticated.
    let connectCfg = cfg;
    if (
      cfg.url &&
      !cfg.headers?.Authorization &&
      !cfg.headers?.authorization
    ) {
      try {
        const { ensureValidToken } = await import("../lib/mcp-oauth.js");
        const token = await ensureValidToken(cfg.url);
        if (token) {
          connectCfg = {
            ...cfg,
            headers: { ...cfg.headers, Authorization: `Bearer ${token}` },
          };
        }
      } catch {
        // OAuth wiring is best-effort
      }
    }
    let res;
    try {
      res = await mcpClient.connect(name, connectCfg);
    } catch (err) {
      writeErr(`  mcp: failed to connect "${name}": ${err.message}\n`);
      continue;
    }
    const tools = Array.isArray(res?.tools) ? res.tools : [];
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

  return result;
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

/**
 * Connect MCP servers registered with `cc mcp add` (the persistent mcp_servers
 * table). By default only `--auto-connect` servers are surfaced; pass
 * `deps.all` for every registered server. Best-effort — returns `deps.into`
 * (or null) on no db / no servers / any read error, never throws.
 *
 * @param {object} rawDb  better-sqlite3 handle (e.g. ctx.db.getDatabase())
 * @param {object} [deps] { writeErr, all, into, makeServerConfig }
 */
export async function loadRegisteredMcp(rawDb, deps = {}) {
  if (!rawDb) return deps.into || null;
  let rows;
  try {
    let make = deps.makeServerConfig;
    if (!make) {
      const { MCPServerConfig } = await import("../harness/mcp-client.js");
      make = (db) => new MCPServerConfig(db);
    }
    const cfg = make(rawDb);
    rows = deps.all ? cfg.list() : cfg.getAutoConnect();
  } catch {
    return deps.into || null; // registry unavailable — non-fatal
  }
  const servers = {};
  for (const r of rows || []) {
    if (!r || !r.name) continue;
    servers[r.name] = {
      command: r.command,
      args: r.args,
      env: r.env,
      url: r.url,
      transport: r.transport,
      headers: r.headers,
    };
  }
  if (Object.keys(servers).length === 0) return deps.into || null;
  return setupMcpFromConfig(servers, deps);
}

/**
 * Resolve the full MCP tool surface for one agent run: the ad-hoc
 * `--mcp-config` file (if any) PLUS registered auto-connect servers (unless
 * disabled), connected into a single client. Returns the combined
 * `{mcpClient, extraToolDefinitions, ...}` or null when there's nothing.
 * Throws only on a bad `--mcp-config` file (that's an explicit user request).
 *
 * @param {object} args { mcpConfigPath?, db?, includeRegistered=true, allRegistered=false }
 * @param {object} [deps] { writeErr, loadMcpConfig, loadRegisteredMcp }
 */
export async function resolveAgentMcp(args = {}, deps = {}) {
  const doFile = deps.loadMcpConfig || loadMcpConfig;
  const doReg = deps.loadRegisteredMcp || loadRegisteredMcp;
  let result = null;
  if (args.mcpConfigPath) {
    result = await doFile(args.mcpConfigPath, deps); // fail-fast on bad file
  }
  if (args.includeRegistered !== false && args.db) {
    result = await doReg(args.db, {
      ...deps,
      all: args.allRegistered === true,
      into: result || undefined,
    });
  }
  return result;
}

// ─── --permission-prompt-tool (programmable headless approval) ──────────────
//
// Claude-Code parity: instead of headless fail-closed (auto-deny risky tools),
// route every CONFIRM-tier decision to an MCP tool that returns the verdict.
// The named tool must come from a server loaded via --mcp-config.

/**
 * Resolve a `mcp__<server>__<tool>` permission-prompt-tool name to its server +
 * tool, validating it was actually loaded. Throws (fail fast) otherwise.
 */
export function resolvePermissionPromptTool(mcp, toolName) {
  if (!mcp || !mcp.externalToolExecutors) {
    throw new Error(
      `--permission-prompt-tool "${toolName}" requires --mcp-config ` +
        `(the tool must come from a loaded MCP server).`,
    );
  }
  const exec = mcp.externalToolExecutors[toolName];
  if (!exec || exec.kind !== "mcp") {
    const avail = Object.keys(mcp.externalToolExecutors).join(", ") || "(none)";
    throw new Error(
      `--permission-prompt-tool "${toolName}" not found among loaded MCP ` +
        `tools. Available: ${avail}`,
    );
  }
  return { server: exec.serverName, tool: exec.toolName };
}

/**
 * Interpret an MCP `tools/call` result as an allow/deny verdict. Liberal: reads
 * a JSON `{behavior:"allow"|"deny"}` (Claude-Code shape) from a text content
 * block, or a top-level `behavior`/`decision`/`allow`. Anything not clearly an
 * allow is treated as deny (fail-closed).
 */
export function parsePermissionDecision(result) {
  if (!result || result.isError) {
    return { allow: false, reason: "permission tool returned no/err result" };
  }
  let payload = result;
  if (Array.isArray(result.content)) {
    const textBlock = result.content.find(
      (b) => b && b.type === "text" && typeof b.text === "string",
    );
    if (textBlock) {
      try {
        payload = JSON.parse(textBlock.text);
      } catch {
        payload = { behavior: textBlock.text.trim() };
      }
    }
  }
  const behavior =
    payload?.behavior ??
    payload?.decision ??
    (payload?.allow === true ? "allow" : undefined);
  const allow = behavior === "allow" || payload?.allow === true;
  return {
    allow,
    reason: payload?.message || payload?.reason || null,
    updatedInput: payload?.updatedInput,
  };
}

/**
 * Build an ApprovalGate confirmer that defers each CONFIRM-tier decision to the
 * given MCP tool. Fail-closed: any tool error → deny.
 *
 * @param {object} args { mcpClient, server, tool, writeErr?, isText? }
 * @returns {(ctx:{tool:string,args:object})=>Promise<boolean>}
 */
export function makePermissionPromptConfirmer({
  mcpClient,
  server,
  tool,
  writeErr = () => {},
  isText = false,
}) {
  return async (ctx) => {
    try {
      const result = await mcpClient.callTool(server, tool, {
        tool_name: ctx?.tool,
        input: ctx?.args || {},
      });
      const { allow, reason } = parsePermissionDecision(result);
      if (isText) {
        writeErr(
          `  permission(${ctx?.tool}): ${allow ? "allow" : "deny"}` +
            `${reason ? " — " + reason : ""}\n`,
        );
      }
      return allow;
    } catch (err) {
      if (isText) {
        writeErr(`  permission(${ctx?.tool}): deny (tool error: ${err.message})\n`);
      }
      return false; // fail-closed
    }
  };
}
