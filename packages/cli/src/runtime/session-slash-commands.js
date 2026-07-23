/**
 * Read-only, session-scoped slash commands for the stream-json protocol.
 *
 * These commands are handled by the live headless-stream process so their
 * output describes this session (model, loaded memory, MCP connections, hooks,
 * permissions and background tasks). They never become a user/model turn.
 *
 * The first protocol version is deliberately read-only. Mutating REPL forms
 * such as `/agents new`, `/tasks kill` and `/permissions <mode>` fail with a
 * stable error code instead of silently discarding their arguments.
 */

export const SESSION_SLASH_COMMANDS = Object.freeze([
  "status",
  "doctor",
  "mcp",
  "hooks",
  "permissions",
  "agents",
  "tasks",
  "memory",
]);

const MAX_REQUEST_ID_LENGTH = 128;
const MAX_COMMAND_LENGTH = 128;
const MAX_ARGUMENT_LENGTH = 4096;
const MAX_OUTPUT_LENGTH = 256 * 1024;
const MAX_ERROR_LENGTH = 16 * 1024;

const hasOwn = (value, key) =>
  Object.prototype.hasOwnProperty.call(value || {}, key);

function normalizeArgs(raw) {
  if (raw == null) return { ok: true, args: "", text: "" };
  if (typeof raw === "string") {
    if (raw.length > MAX_ARGUMENT_LENGTH) {
      return {
        ok: false,
        args: "",
        text: "",
        error: `slash_command args exceed ${MAX_ARGUMENT_LENGTH} characters`,
      };
    }
    return { ok: true, args: raw, text: raw.trim() };
  }
  return {
    ok: false,
    args: raw,
    text: "",
    error: "slash_command args must be a string",
  };
}

/**
 * Parse a decoded stream-json object into the command shape consumed by the
 * dispatcher. Returns null for non-slash events.
 */
export function parseSessionSlashCommandEvent(value) {
  if (!value || typeof value !== "object" || value.type !== "slash_command") {
    return null;
  }

  const errors = [];
  const rawRequestId =
    typeof value.request_id === "string" ? value.request_id : "";
  const requestIdText = rawRequestId.trim();
  const requestId =
    requestIdText && rawRequestId.length <= MAX_REQUEST_ID_LENGTH
      ? rawRequestId
      : null;
  if (!requestId) {
    errors.push(
      rawRequestId.length > MAX_REQUEST_ID_LENGTH
        ? `slash_command request_id exceeds ${MAX_REQUEST_ID_LENGTH} characters`
        : "slash_command requires a non-empty string request_id",
    );
  }
  if (typeof value.command !== "string" || !value.command.trim()) {
    errors.push("slash_command requires a non-empty command");
    return {
      command: "",
      args: hasOwn(value, "args") ? value.args : "",
      argumentText: "",
      requestId,
      validationError: errors.join("; "),
    };
  }

  const raw = value.command.trim().replace(/^\/+/, "");
  if (raw.length > MAX_COMMAND_LENGTH) {
    errors.push(
      `slash_command command exceeds ${MAX_COMMAND_LENGTH} characters`,
    );
  }
  const boundedRaw = raw.slice(0, MAX_COMMAND_LENGTH);
  const splitAt = boundedRaw.search(/\s/);
  const commandText = splitAt < 0 ? boundedRaw : boundedRaw.slice(0, splitAt);
  const inlineArgs =
    raw.length > MAX_COMMAND_LENGTH || splitAt < 0
      ? ""
      : boundedRaw.slice(splitAt + 1).trim();
  if (!commandText) {
    errors.push("slash_command requires a non-empty command name");
  }
  const normalized = normalizeArgs(hasOwn(value, "args") ? value.args : null);
  if (!normalized.ok) errors.push(normalized.error);
  const argumentText = [inlineArgs, normalized.text].filter(Boolean).join(" ");

  return {
    command: commandText.toLowerCase(),
    args: normalized.args,
    argumentText,
    requestId,
    ...(errors.length ? { validationError: errors.join("; ") } : {}),
  };
}

function success(output, extra = {}) {
  const text = String(output == null ? "" : output);
  return {
    ok: true,
    output:
      text.length > MAX_OUTPUT_LENGTH
        ? `${text.slice(0, MAX_OUTPUT_LENGTH)}\n… (output truncated)`
        : text,
    ...extra,
  };
}

function failure(code, error, extra = {}) {
  const text = String(error || "Slash command failed");
  return {
    ok: false,
    code,
    error:
      text.length > MAX_ERROR_LENGTH
        ? `${text.slice(0, MAX_ERROR_LENGTH)}…`
        : text,
    ...extra,
  };
}

function unsupportedArguments(command, event, usage) {
  return failure(
    "UNSUPPORTED_ARGUMENTS",
    `/${command} does not support "${event.argumentText}" over stream-json. ${usage}`,
  );
}

function mcpServerList(mcp) {
  const client = mcp?.mcpClient;
  if (client && typeof client.listServers === "function") {
    const listed = client.listServers();
    return Array.isArray(listed) ? listed : [];
  }
  if (Array.isArray(mcp?.connected)) {
    return mcp.connected.map((server) =>
      typeof server === "string"
        ? { name: server, state: "connected" }
        : server,
    );
  }
  return [];
}

async function runStatus(context, deps) {
  if (context.event.argumentText) {
    return unsupportedArguments(
      "status",
      context.event,
      "Use /status without arguments.",
    );
  }
  const [{ VERSION }, versionModule, ideModule, statusModule] =
    await Promise.all([
      import("../constants.js"),
      import("../lib/version-skew.js"),
      import("../repl/ide-status.js"),
      import("../repl/status-summary.js"),
    ]);
  const servers = mcpServerList(context.mcp);
  const ideToolNames = deps.ideToolNames || ideModule.ideToolNames;
  const formatStatus = deps.formatStatus || statusModule.formatStatus;
  const readDiskVersion = deps.readDiskVersion || versionModule.readDiskVersion;
  const version = hasOwn(deps, "version") ? deps.version : VERSION;
  const installedVersion = await readDiskVersion();

  return success(
    formatStatus({
      version,
      installedVersion,
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      provider: context.provider,
      model: context.model,
      sessionId: context.sessionId,
      messageCount:
        context.messageCount ??
        (Array.isArray(context.messages) ? context.messages.length : 0),
      cwd: context.cwd,
      extraRoots:
        context.extraRoots ??
        (Array.isArray(context.additionalDirectories)
          ? context.additionalDirectories.length
          : 0),
      ideConnected: ideToolNames(context.mcp).length > 0,
      mcpServers: servers.length,
      hookEvents:
        context.settingsHooks &&
        typeof context.settingsHooks === "object" &&
        !Array.isArray(context.settingsHooks)
          ? Object.keys(context.settingsHooks).length
          : 0,
    }),
  );
}

async function runDoctor(context, deps) {
  if (context.event.argumentText) {
    return unsupportedArguments(
      "doctor",
      context.event,
      "Use /doctor without arguments.",
    );
  }
  const [configModule, doctorModule, ideModule] = await Promise.all([
    import("../lib/config-manager.js"),
    import("../repl/doctor-status.js"),
    import("../repl/ide-status.js"),
  ]);
  const loadConfig = deps.loadConfig || configModule.loadConfig;
  const buildDoctorChecks =
    deps.buildDoctorChecks || doctorModule.buildDoctorChecks;
  const renderDoctor = deps.renderDoctor || doctorModule.renderDoctor;
  const ideToolNames = deps.ideToolNames || ideModule.ideToolNames;

  let config = {};
  try {
    config = (await loadConfig()) || {};
  } catch {
    // Match the REPL: configuration discovery is best-effort.
  }
  config = {
    ...config,
    llm: {
      ...(config.llm || {}),
      ...(context.provider ? { provider: context.provider } : {}),
      ...(context.model ? { model: context.model } : {}),
      ...(context.apiKey ? { apiKey: context.apiKey } : {}),
    },
  };

  return success(
    renderDoctor(
      buildDoctorChecks({
        config,
        ideTools: ideToolNames(context.mcp),
        mcpServers: mcpServerList(context.mcp),
        permissionRules: context.permissionRules,
        settingsHooks: context.settingsHooks,
      }),
    ),
  );
}

function formatMcpServers(servers) {
  const lines = [`MCP servers (${servers.length}):`];
  if (servers.length === 0) {
    lines.push("  (none connected)");
  } else {
    for (const server of servers) {
      const name = server?.name || "?";
      const state = server?.state || "unknown";
      const counts = [
        Number.isFinite(Number(server?.tools))
          ? `${Number(server.tools)} tools`
          : null,
        Number.isFinite(Number(server?.resources))
          ? `${Number(server.resources)} resources`
          : null,
        Number.isFinite(Number(server?.prompts))
          ? `${Number(server.prompts)} prompts`
          : null,
      ].filter(Boolean);
      lines.push(
        `  ${name}: ${state}${counts.length ? ` (${counts.join(", ")})` : ""}`,
      );
    }
  }
  return lines.join("\n");
}

async function runMcp(context, deps) {
  if (context.event.argumentText) {
    return unsupportedArguments(
      "mcp",
      context.event,
      "Use /mcp without arguments.",
    );
  }
  const { renderMcpSurface: defaultRenderer } =
    await import("../repl/mcp-prompt.js");
  const renderMcpSurface = deps.renderMcpSurface || defaultRenderer;
  const client = context.mcp?.mcpClient || null;
  const servers = mcpServerList(context.mcp);
  return success(`${formatMcpServers(servers)}\n\n${renderMcpSurface(client)}`);
}

async function runHooks(context, deps) {
  if (context.event.argumentText) {
    return unsupportedArguments(
      "hooks",
      context.event,
      "Use /hooks without arguments.",
    );
  }
  const { formatSettingsHooks: defaultRenderer } =
    await import("../repl/hooks-status.js");
  const formatSettingsHooks = deps.formatSettingsHooks || defaultRenderer;
  return success(formatSettingsHooks(context.settingsHooks));
}

async function runPermissions(context, deps) {
  if (context.event.argumentText) {
    return failure(
      "UNSUPPORTED_ARGUMENTS",
      "Changing permission mode through /permissions is not supported over " +
        "stream-json. Start a new session with --permission-mode <mode>; use " +
        "/permissions without arguments to inspect the active rules.",
    );
  }
  const { renderPermissions: defaultRenderer } =
    await import("../repl/permissions-status.js");
  const renderPermissions = deps.renderPermissions || defaultRenderer;
  const output = renderPermissions(context.permissionRules, {
    files: Array.isArray(context.settingsFiles) ? context.settingsFiles : [],
  });
  return success(
    `${output}\n  Current mode: ${context.permissionMode || "default"}`,
  );
}

async function runTasks(context, deps) {
  const arg = context.event.argumentText.trim();
  if (arg && arg !== "list" && arg !== "ls") {
    return failure(
      "UNSUPPORTED_ARGUMENTS",
      "Only read-only /tasks list is supported over stream-json. " +
        "Use the terminal REPL for /tasks kill <id> or /tasks kill-all.",
    );
  }
  const [coreModule, tasksModule] = await Promise.all([
    import("./agent-core.js"),
    import("../repl/tasks-status.js"),
  ]);
  const listBackgroundShellTasks =
    deps.listBackgroundShellTasks || coreModule.listBackgroundShellTasks;
  const formatBackgroundTasks =
    deps.formatBackgroundTasks || tasksModule.formatBackgroundTasks;
  return success(formatBackgroundTasks(await listBackgroundShellTasks()));
}

function validateReadOnlyAgentArgs(event) {
  const text = event.argumentText.trim();
  if (!text || text === "list" || text === "ls") {
    return { ok: true, action: "list" };
  }
  if (/^new(?:\s|$)/.test(text)) {
    return {
      ok: false,
      error:
        "Creating agents is not supported over stream-json. " +
        "Use /agents new from the terminal REPL.",
    };
  }
  const show = /^show\s+(\S+)$/.exec(text);
  if (show) return { ok: true, action: "show", name: show[1] };
  if (/^\S+$/.test(text)) {
    return { ok: true, action: "show", name: text };
  }
  return {
    ok: false,
    error:
      "Only /agents list and /agents show <name> are supported over stream-json.",
  };
}

async function runAgents(context, deps) {
  const validated = validateReadOnlyAgentArgs(context.event);
  if (!validated.ok) {
    return failure("UNSUPPORTED_ARGUMENTS", validated.error);
  }
  const [statusModule, agentsModule, profilesModule] = await Promise.all([
    import("../repl/agents-status.js"),
    import("../lib/agents.js"),
    import("../lib/sub-agent-profiles.js"),
  ]);
  const parseAgentsCommand =
    deps.parseAgentsCommand || statusModule.parseAgentsCommand;
  const formatAgentsList =
    deps.formatAgentsList || statusModule.formatAgentsList;
  const formatAgentDetail =
    deps.formatAgentDetail || statusModule.formatAgentDetail;
  const discoverAgents = deps.discoverAgents || agentsModule.discoverAgents;
  const getAgent = deps.getAgent || agentsModule.getAgent;
  const listSubAgentProfiles =
    deps.listSubAgentProfiles || profilesModule.listSubAgentProfiles;

  // Keep the REPL parser as the source of truth after the read-only wire guard.
  const parsed = parseAgentsCommand(
    `/agents${context.event.argumentText ? ` ${context.event.argumentText}` : ""}`,
  );
  if (parsed.action === "list") {
    return success(
      formatAgentsList(
        await discoverAgents(context.cwd),
        await listSubAgentProfiles(),
      ),
    );
  }
  if (parsed.action === "show" && parsed.name) {
    const agent = await getAgent(parsed.name, context.cwd);
    if (!agent) {
      return failure("NOT_FOUND", `No such agent: ${parsed.name}`);
    }
    return success(formatAgentDetail(agent));
  }
  return failure(
    "UNSUPPORTED_ARGUMENTS",
    "Only /agents list and /agents show <name> are supported over stream-json.",
  );
}

async function runMemory(context, deps) {
  if (context.event.argumentText) {
    return unsupportedArguments(
      "memory",
      context.event,
      "Use /memory without arguments.",
    );
  }
  const { renderMemoryFiles: defaultRenderer } =
    await import("../repl/memory-status.js");
  const renderMemoryFiles = deps.renderMemoryFiles || defaultRenderer;
  // This must reflect what was captured when THIS session's system prompt was
  // composed. Re-scanning disk here could claim a newly-created file was loaded
  // even though the model has never seen it.
  const loaded = context.loadedInstructions || { files: [], warnings: [] };
  return success(
    renderMemoryFiles(loaded, {
      enabled: context.projectMemoryEnabled !== false,
    }),
  );
}

/**
 * Execute a parsed command against live session state.
 *
 * Returns a command-local result; callers decide how it is represented on the
 * wire. This function never throws for user-facing command failures.
 */
export async function executeSessionSlashCommand(
  event,
  context = {},
  deps = {},
) {
  const command = String(event?.command || "").toLowerCase();
  if (event?.validationError) {
    return failure("INVALID_REQUEST", event.validationError);
  }
  if (!SESSION_SLASH_COMMANDS.includes(command)) {
    return failure(
      "UNKNOWN_COMMAND",
      `Unknown session slash command "/${command || "?"}". Supported: ${SESSION_SLASH_COMMANDS.map((name) => `/${name}`).join(", ")}`,
    );
  }

  const scoped = { ...context, event };
  try {
    switch (command) {
      case "status":
        return await runStatus(scoped, deps);
      case "doctor":
        return await runDoctor(scoped, deps);
      case "mcp":
        return await runMcp(scoped, deps);
      case "hooks":
        return await runHooks(scoped, deps);
      case "permissions":
        return await runPermissions(scoped, deps);
      case "agents":
        return await runAgents(scoped, deps);
      case "tasks":
        return await runTasks(scoped, deps);
      case "memory":
        return await runMemory(scoped, deps);
      default:
        return failure("UNKNOWN_COMMAND", `Unknown command: /${command}`);
    }
  } catch (error) {
    return failure(
      "COMMAND_FAILED",
      `/${command} failed: ${String(error?.message || error)}`,
    );
  }
}
