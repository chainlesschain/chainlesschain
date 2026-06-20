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
import path from "path";
import { MCPClient } from "../harness/mcp-client.js";
import { projectRootBase } from "../lib/project-root.cjs";
import {
  discoverIdeServer,
  ideServerToMcpConfig,
  isInIdeTerminal,
} from "../lib/ide-bridge.js";
import {
  discoverPdhServer,
  pdhServerToMcpConfig,
  isInPdhTerminal,
} from "../lib/pdh-bridge.js";

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
      headers:
        cfg.headers && typeof cfg.headers === "object" ? cfg.headers : {},
    };
  }
  return out;
}

/** Namespaced tool name exposed to the LLM. */
export function mcpToolName(server, tool) {
  return `mcp__${server}__${tool}`;
}

/**
 * When an MCP connect fails with an authentication error (HTTP 401/403, or an
 * explicit Unauthorized/Forbidden) on a URL-based server, return an actionable
 * one-line hint pointing the user at `cc mcp login`. Returns null for non-auth
 * errors or stdio servers (no url). cc's mcp-client throws `HTTP 401: …` /
 * `HTTP 403: …` from its transport on these — the common path for an MCP server
 * that requires OAuth but has no stored token (Claude-Code 2.1.183 surfaced the
 * same auth-required class; cc already exposes no tools from such a server, so
 * the residual gap was the missing actionable guidance).
 *
 * @param {string|undefined} url   the server's `url` (stdio servers pass none)
 * @param {string} errMessage      the thrown connect error message
 * @returns {string|null}
 */
export function mcpAuthHint(url, errMessage) {
  if (!url) return null;
  const m = String(errMessage || "");
  const isAuth =
    /\bHTTP\s*40[13]\b/i.test(m) ||
    /\bunauthor/i.test(m) ||
    /\bforbidden\b/i.test(m);
  if (!isAuth) return null;
  return `    → "${url}" requires authentication; run: cc mcp login ${url}\n`;
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
    resources: [],
    prompts: [],
  };
  // Back-fill the resource/prompt accumulators when an older `deps.into` object
  // (created before this field existed) is passed in.
  if (!Array.isArray(result.resources)) result.resources = [];
  if (!Array.isArray(result.prompts)) result.prompts = [];
  const {
    mcpClient,
    extraToolDefinitions,
    externalToolExecutors,
    externalToolDescriptors,
    connected,
  } = result;

  // Advertise the agent session id to stdio MCP servers spawned below
  // (CC_SESSION_ID / CLAUDE_CODE_SESSION_ID + CLAUDECODE marker). Idempotent —
  // safe when an accumulating `into` client was already given one.
  if (deps.sessionId != null && typeof mcpClient.setSessionId === "function") {
    mcpClient.setSessionId(deps.sessionId);
  }

  for (const [name, cfg] of Object.entries(servers)) {
    // Skip a name already connected — an earlier batch (ad-hoc --mcp-config)
    // wins over a later one (registered) on a clash.
    if (mcpClient.servers?.has?.(name)) continue;
    // Inject a stored OAuth bearer token for remote servers (`cc mcp login`),
    // unless the config already supplies an Authorization header. Best-effort:
    // no token / a refresh failure just connects unauthenticated.
    let connectCfg = cfg;
    if (cfg.url && !cfg.headers?.Authorization && !cfg.headers?.authorization) {
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
      let line = `  mcp: failed to connect "${name}": ${err.message}\n`;
      const hint = mcpAuthHint(cfg.url, err.message);
      if (hint) line += hint;
      writeErr(line);
      continue;
    }
    const tools = Array.isArray(res?.tools) ? res.tools : [];
    const resources = Array.isArray(res?.resources) ? res.resources : [];
    const prompts = Array.isArray(res?.prompts) ? res.prompts : [];
    connected.push({
      server: name,
      tools: tools.length,
      resources: resources.length,
      prompts: prompts.length,
    });
    for (const r of resources) {
      if (!r || !r.uri) continue;
      result.resources.push({ ...r, server: name });
    }
    for (const p of prompts) {
      if (!p || !p.name) continue;
      result.prompts.push({ ...p, server: name });
    }
    for (const t of tools) {
      if (!t || !t.name) continue;
      const full = mcpToolName(name, t.name);
      extraToolDefinitions.push({
        type: "function",
        function: {
          name: full,
          description:
            t.description || `MCP tool "${t.name}" on server "${name}"`,
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

  // Expose MCP resources to the LLM as two generic tools (Claude-Code parity:
  // ListMcpResourcesTool / ReadMcpResourceTool). Registered once, only when at
  // least one connected server advertises a resource, and re-entrant safe for
  // accumulating `deps.into` batches.
  if (result.resources.length > 0) {
    registerMcpResourceTools(result);
  }

  return result;
}

/**
 * Register the `list_mcp_resources` + `read_mcp_resource` generic tools on the
 * agent wiring object, unless already present. Their executors are dispatched
 * by agent-core via `kind: "mcp-resource"`.
 */
export function registerMcpResourceTools(result) {
  const {
    extraToolDefinitions,
    externalToolExecutors,
    externalToolDescriptors,
  } = result;
  if (externalToolExecutors.read_mcp_resource) return; // already registered

  extraToolDefinitions.push(
    {
      type: "function",
      function: {
        name: "list_mcp_resources",
        description:
          "List resources exposed by connected MCP servers (documents, files, " +
          "or data the server makes available). Optionally filter by server.",
        parameters: {
          type: "object",
          properties: {
            server: {
              type: "string",
              description: "Optional MCP server name to filter by.",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_mcp_resource",
        description:
          "Read the contents of an MCP resource by its URI. Use " +
          "list_mcp_resources first to discover available URIs.",
        parameters: {
          type: "object",
          properties: {
            server: {
              type: "string",
              description:
                "MCP server name that owns the resource (from list_mcp_resources).",
            },
            uri: {
              type: "string",
              description: "Resource URI to read.",
            },
          },
          required: ["uri"],
        },
      },
    },
  );

  externalToolExecutors.list_mcp_resources = {
    kind: "mcp-resource",
    op: "list",
  };
  externalToolExecutors.read_mcp_resource = {
    kind: "mcp-resource",
    op: "read",
  };
  externalToolDescriptors.list_mcp_resources = {
    name: "list_mcp_resources",
    kind: "mcp-resource",
    category: "mcp",
    source: "mcp",
  };
  externalToolDescriptors.read_mcp_resource = {
    name: "read_mcp_resource",
    kind: "mcp-resource",
    category: "mcp",
    source: "mcp",
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
 * Discover a running IDE's MCP server (lockfile / env fast-path) and connect it
 * as the reserved server `ide`. Best-effort: returns `deps.into` (or null) on
 * no IDE found / bad config, never throws. An explicit user registration of a
 * server named `ide` wins — IDE auto-discovery yields with a one-line warning.
 *
 * @param {object} opts  { cwd?, env?, force? }
 * @param {object} [deps] { writeErr, into, discoverIdeServer, ideServerToMcpConfig }
 */
export async function loadIdeMcp(opts = {}, deps = {}) {
  const discover = deps.discoverIdeServer || discoverIdeServer;
  const toCfg = deps.ideServerToMcpConfig || ideServerToMcpConfig;
  const lock = discover({
    cwd: opts.cwd,
    env: opts.env,
    force: opts.force === true,
  });
  if (!lock) return deps.into || null;
  if (deps.into?.mcpClient?.servers?.has?.("ide")) {
    (deps.writeErr || (() => {}))(
      `  ide: server "ide" already registered explicitly — ` +
        `skipping IDE auto-discovery\n`,
    );
    return deps.into;
  }
  const cfg = toCfg(lock);
  if (!cfg) return deps.into || null;
  const out = await setupMcpFromConfig({ ide: cfg }, deps);
  // Hot reconnect: a window reload / extension update restarts the editor's
  // MCP server on a NEW port with a NEW token. Register a reconnector so a
  // failed mcp__ide__* call re-scans the lockfiles mid-session and retries,
  // instead of the IDE tools (and selection/diagnostics injection) silently
  // dying for the rest of the run. Note the stale CHAINLESSCHAIN_IDE_PORT in
  // our env no longer matches any live lock, so discovery falls through to
  // the workspace scan — exactly the path that finds the restarted instance.
  if (out?.mcpClient?.setReconnector) {
    out.mcpClient.setReconnector("ide", () => {
      const fresh = discover({
        cwd: opts.cwd,
        env: opts.env,
        force: opts.force === true,
      });
      return fresh ? toCfg(fresh) : null;
    });
  }
  return out;
}

/**
 * Discover a running PDH bridge (the Android app's device-capability MCP server)
 * and connect it as the reserved server `pdh`. Best-effort: returns `deps.into`
 * (or null) on nothing found / bad config, never throws. An explicit user
 * registration of a server named `pdh` wins — PDH auto-discovery yields with a
 * one-line warning. Reserved name `pdh` → tools `mcp__pdh__*`.
 *
 * Mirrors loadIdeMcp, but PDH has no workspace concept (a device has one
 * server): env CHAINLESSCHAIN_PDH_PORT fast-path, else the newest live lock.
 *
 * @param {object} opts  { env?, force? }
 * @param {object} [deps] { writeErr, into, discoverPdhServer, pdhServerToMcpConfig }
 */
export async function loadPdhMcp(opts = {}, deps = {}) {
  const discover = deps.discoverPdhServer || discoverPdhServer;
  const toCfg = deps.pdhServerToMcpConfig || pdhServerToMcpConfig;
  const lock = discover({ env: opts.env, force: opts.force === true });
  if (!lock) return deps.into || null;
  if (deps.into?.mcpClient?.servers?.has?.("pdh")) {
    (deps.writeErr || (() => {}))(
      `  pdh: server "pdh" already registered explicitly — ` +
        `skipping PDH auto-discovery\n`,
    );
    return deps.into;
  }
  const cfg = toCfg(lock);
  if (!cfg) return deps.into || null;
  const out = await setupMcpFromConfig({ pdh: cfg }, deps);
  // Hot reconnect: the app restarts its bridge on a NEW port + token (process
  // restart / sentinel re-extract). Register a reconnector so a failed
  // mcp__pdh__* call re-scans the lockfiles mid-session and retries — the stale
  // CHAINLESSCHAIN_PDH_PORT no longer matches a live lock, so discovery falls
  // through to the newest live lock (exactly the restarted instance).
  if (out?.mcpClient?.setReconnector) {
    out.mcpClient.setReconnector("pdh", () => {
      const fresh = discover({ env: opts.env, force: opts.force === true });
      return fresh ? toCfg(fresh) : null;
    });
  }
  return out;
}

/**
 * Discover + connect a project-scoped `.mcp.json` (Claude-Code parity). Reads a
 * `.mcp.json` from the git project root (walked up from cwd, same as the
 * `.claude` config layers) and from cwd itself, merging their `mcpServers`
 * (cwd wins on a name clash — closest wins). Best-effort: a missing / empty /
 * malformed file contributes nothing and never throws.
 *
 * SECURITY: a checked-in `.mcp.json` can spawn arbitrary commands, so this layer
 * is OPT-IN (default-off) — it only runs when explicitly enabled with
 * `--project-mcp` / `CC_PROJECT_MCP=1` (truthy). When enabled, the servers it
 * loads are announced via writeErr. Connected into `deps.into`, so an explicit
 * `--mcp-config` server or a registered (`cc mcp add`) server WINS on a name
 * clash (the first batch wins in setupMcpFromConfig).
 *
 * @param {object} opts  { cwd?, env? }
 * @param {object} [deps] { writeErr, into, readFile, fileExists, createClient }
 */
export async function loadProjectMcp(opts = {}, deps = {}) {
  const env = opts.env || process.env;
  // Opt-in gate (default-off): only load a project `.mcp.json` when explicitly
  // enabled — a checked-in file spawning commands in any cloned repo is a
  // supply-chain risk, so the user must turn it on per run / per shell.
  const flag = String(env.CC_PROJECT_MCP || "").toLowerCase();
  if (flag !== "1" && flag !== "true") return deps.into || null;
  const cwd = opts.cwd || process.cwd();
  const readFile = deps.readFile || ((p) => fs.readFileSync(p, "utf-8"));
  const fileExists = deps.fileExists || ((p) => fs.existsSync(p));
  const writeErr = deps.writeErr || (() => {});

  // Project-root `.mcp.json` (below cwd's), then cwd's own — so a cwd-local file
  // overrides the root on a name clash. projectRootBase() is null when cwd IS
  // the root (its own file already covers it) or there is no git project.
  const files = [];
  const root = projectRootBase(cwd, { fs, path });
  if (root) files.push(path.join(root, ".mcp.json"));
  files.push(path.join(cwd, ".mcp.json"));

  const servers = {};
  const seenFiles = [];
  for (const file of files) {
    if (!fileExists(file)) continue;
    let raw;
    try {
      raw = JSON.parse(readFile(file));
    } catch (err) {
      writeErr(`  mcp: ignoring malformed ${file} (${err.message})\n`);
      continue;
    }
    const parsed = parseMcpServers(raw);
    if (Object.keys(parsed).length > 0) {
      Object.assign(servers, parsed); // later file (cwd) overrides earlier (root)
      seenFiles.push(file);
    }
  }
  if (Object.keys(servers).length === 0) return deps.into || null;
  writeErr(
    `  mcp: ${Object.keys(servers).length} server(s) from project .mcp.json ` +
      `(${seenFiles.join(", ")}) — loaded via --project-mcp\n`,
  );
  return setupMcpFromConfig(servers, deps);
}

/**
 * Resolve the full MCP tool surface for one agent run: the ad-hoc
 * `--mcp-config` file (if any) PLUS registered auto-connect servers (unless
 * disabled) PLUS a project-scoped `.mcp.json` (opt-in, `--project-mcp`) PLUS an
 * auto-discovered IDE bridge, connected into a single client.
 * Returns the combined `{mcpClient, extraToolDefinitions, ...}` or null when
 * there's nothing. Throws only on a bad `--mcp-config` file (explicit request).
 *
 * IDE discovery: default ON only inside an IDE integrated terminal; `ide:true`
 * (`--ide`) forces it; `ide:false` (`--no-ide`) disables it.
 *
 * @param {object} args { mcpConfigPath?, db?, includeRegistered=true, allRegistered=false, ide?, pdh?, cwd?, env? }
 * @param {object} [deps] { writeErr, loadMcpConfig, loadRegisteredMcp, loadIdeMcp, loadPdhMcp, isInIdeTerminal, isInPdhTerminal }
 */
export async function resolveAgentMcp(args = {}, deps = {}) {
  const doFile = deps.loadMcpConfig || loadMcpConfig;
  const doReg = deps.loadRegisteredMcp || loadRegisteredMcp;
  const doProject = deps.loadProjectMcp || loadProjectMcp;
  const doIde = deps.loadIdeMcp || loadIdeMcp;
  const doPdh = deps.loadPdhMcp || loadPdhMcp;
  // Thread the agent session id down to setupMcpFromConfig so spawned stdio MCP
  // servers get CC_SESSION_ID / CLAUDE_CODE_SESSION_ID (Claude-Code parity).
  const fwd =
    args.sessionId != null ? { ...deps, sessionId: args.sessionId } : deps;
  let result = null;
  if (args.mcpConfigPath) {
    result = await doFile(args.mcpConfigPath, fwd); // fail-fast on bad file
  }
  // --strict-mcp-config: use ONLY the explicit --mcp-config servers; ignore the
  // registered (cc mcp add) set and IDE-bridge auto-discovery so the run's MCP
  // surface is fully reproducible (Claude-Code parity).
  if (args.strict) {
    return result;
  }
  if (args.includeRegistered !== false && args.db) {
    result = await doReg(args.db, {
      ...fwd,
      all: args.allRegistered === true,
      into: result || undefined,
    });
  }
  // Project-scoped `.mcp.json` (Claude-Code parity). After --mcp-config +
  // registered (those win on a name clash), before IDE auto-discovery. Skipped
  // under --strict-mcp-config (returned above). OPT-IN: loadProjectMcp is a
  // no-op unless --project-mcp / CC_PROJECT_MCP=1 is set (default-off — a
  // checked-in .mcp.json can spawn commands). `projectMcp:false` hard-skips it.
  if (args.projectMcp !== false) {
    result = await doProject(
      { cwd: args.cwd, env: args.env || process.env },
      { ...fwd, into: result || undefined },
    );
  }
  if (args.ide !== false) {
    const env = args.env || process.env;
    const inIde = (deps.isInIdeTerminal || isInIdeTerminal)(env);
    if (args.ide === true || inIde) {
      result = await doIde(
        { cwd: args.cwd, env, force: args.ide === true },
        { ...fwd, into: result || undefined },
      );
    }
  }
  // PDH bridge auto-discovery (the Android app's device-capability MCP server).
  // Same gating shape as IDE: default ON only when env-wired (app-spawned cc),
  // `pdh:true` (--pdh) forces it, `pdh:false` (--no-pdh) disables it. Reserved
  // name `pdh` → mcp__pdh__*. Skipped under --strict-mcp-config (returned above).
  if (args.pdh !== false) {
    const env = args.env || process.env;
    const inPdh = (deps.isInPdhTerminal || isInPdhTerminal)(env);
    if (args.pdh === true || inPdh) {
      result = await doPdh(
        { env, force: args.pdh === true },
        { ...fwd, into: result || undefined },
      );
    }
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
        writeErr(
          `  permission(${ctx?.tool}): deny (tool error: ${err.message})\n`,
        );
      }
      return false; // fail-closed
    }
  };
}
