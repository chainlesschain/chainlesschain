/**
 * MCP tool search — context-scaling for large MCP tool surfaces (gap-analysis
 * 第二阶段 items 1-3).
 *
 * Problem: every connected MCP server's full tool inputSchema is injected into
 * the LLM `tools` parameter on EVERY agent-loop iteration. A handful of big
 * servers easily burns 10-30% of the context window before the conversation
 * even starts, and (on the Anthropic path) any change to that tool block busts
 * the prompt-cache prefix (agent-core marks the LAST tool schema with
 * `cache_control` — the whole tools array must stay byte-stable for a hit).
 *
 * Solution (Claude-Code ToolSearch parity, adapted to cc's dispatch model):
 *   - When the estimated token cost of the MCP tool schemas crosses a threshold
 *     (default 10% of the model's context window), each MCP tool definition is
 *     replaced IN PLACE by a compact stub — name + "[deferred]" one-line
 *     description + permissive empty parameters — and one extra internal tool
 *     `tool_search` is appended.
 *   - The model calls `tool_search` with `select:<name>` or keywords; the full
 *     schemas come back in the TOOL RESULT (conversation content — append-only,
 *     prompt-cache friendly), never by rewriting the tools array. The stubs are
 *     permanent for the session, so the cached prefix stays stable even as
 *     schemas are progressively "loaded".
 *   - cc dispatches MCP calls itself (executor map — providers don't validate
 *     arguments), so a stub-defined tool is technically callable. Calling a
 *     deferred tool BEFORE loading its schema returns a self-healing error that
 *     embeds the schema and marks it loaded, so at most one round-trip is lost.
 *
 * Config (closest layer wins, same settings files as the rest of cc):
 *   settings.json  { "mcp": { "toolSearch": {
 *       "enabled": "auto" | true | false,   // default "auto" (threshold)
 *       "thresholdRatio": 0.1,              // auto: defer when schemas > 10% window
 *       "maxResults": 5,                    // tool_search default result cap
 *       "catalogMode": "stubs" | "compact", // compact provider projection (opt-in)
 *       "alwaysLoad": ["serverName", "mcp__srv__tool", "mcp__srv__*"]
 *   } } }
 *   env CC_TOOL_SEARCH=1|0|auto             // overrides settings.enabled
 *   env CC_TOOL_SEARCH_CATALOG=compact|stubs // provider projection only
 *
 * OFF / below-threshold path is byte-identical: `maybeApplyToolSearch` returns
 * null without touching the mcp wiring object.
 */

import settingsLoader from "../lib/settings-loader.cjs";
import { rankMcpToolSearchEntries } from "./mcp-tool-search-ranking.js";
import {
  estimateTokens as defaultEstimateTokens,
  getContextWindow,
} from "../harness/prompt-compressor.js";

const { loadManagedSettings, readSettingsFile, settingsPaths } = settingsLoader;

export const TOOL_SEARCH_TOOL_NAME = "tool_search";

export const TOOL_SEARCH_DEFAULTS = Object.freeze({
  enabled: "auto",
  thresholdRatio: 0.1,
  maxResults: 5,
  catalogMode: "stubs",
  alwaysLoad: Object.freeze([]),
});

const MAX_ACCOUNTED_TOOL_TOKENS = Number.MAX_SAFE_INTEGER;

function boundedTokenSum(left, right) {
  if (!Number.isSafeInteger(left) || left < 0) {
    return MAX_ACCOUNTED_TOOL_TOKENS;
  }
  if (!Number.isSafeInteger(right) || right < 0) {
    return MAX_ACCOUNTED_TOOL_TOKENS;
  }
  return Math.min(MAX_ACCOUNTED_TOOL_TOKENS, left + right);
}

// ─── config ────────────────────────────────────────────────────────────────

function sanitizeToolSearchSettings(raw, into) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return into;
  const out = { ...into };
  if (raw.enabled === true || raw.enabled === false) {
    out.enabled = raw.enabled;
  } else if (typeof raw.enabled === "string") {
    const v = raw.enabled.toLowerCase();
    if (v === "auto") out.enabled = "auto";
    else if (v === "true" || v === "1") out.enabled = true;
    else if (v === "false" || v === "0") out.enabled = false;
    // anything else: ignore (fail-to-defaults, matches autoMode.decisions)
  }
  if (
    typeof raw.thresholdRatio === "number" &&
    Number.isFinite(raw.thresholdRatio) &&
    raw.thresholdRatio > 0 &&
    raw.thresholdRatio <= 1
  ) {
    out.thresholdRatio = raw.thresholdRatio;
  }
  if (
    typeof raw.maxResults === "number" &&
    Number.isInteger(raw.maxResults) &&
    raw.maxResults > 0 &&
    raw.maxResults <= 50
  ) {
    out.maxResults = raw.maxResults;
  }
  if (Array.isArray(raw.alwaysLoad)) {
    out.alwaysLoad = raw.alwaysLoad.filter(
      (p) => typeof p === "string" && p.length > 0,
    );
  }
  if (raw.catalogMode === "stubs" || raw.catalogMode === "compact") {
    out.catalogMode = raw.catalogMode;
  }
  return out;
}

/**
 * Resolve the effective tool-search config from settings layers (closest wins)
 * + managed settings + the CC_TOOL_SEARCH env override. Never throws.
 *
 * @param {object} [opts] { env, cwd, settingsFile, onWarn }
 * @returns {{enabled:(boolean|"auto"), thresholdRatio:number, maxResults:number, catalogMode:string, alwaysLoad:string[]}}
 */
export function resolveToolSearchConfig(opts = {}) {
  const env = opts.env || process.env;
  const cwd = opts.cwd || process.cwd();
  let effective = {
    enabled: TOOL_SEARCH_DEFAULTS.enabled,
    thresholdRatio: TOOL_SEARCH_DEFAULTS.thresholdRatio,
    maxResults: TOOL_SEARCH_DEFAULTS.maxResults,
    catalogMode: TOOL_SEARCH_DEFAULTS.catalogMode,
    alwaysLoad: [...TOOL_SEARCH_DEFAULTS.alwaysLoad],
  };
  try {
    for (const file of settingsPaths(cwd, opts.settingsFile)) {
      const data = readSettingsFile(file, { onWarn: opts.onWarn });
      effective = sanitizeToolSearchSettings(data?.mcp?.toolSearch, effective);
    }
    const managed = loadManagedSettings({ env });
    if (managed?.settings) {
      effective = sanitizeToolSearchSettings(
        managed.settings?.mcp?.toolSearch,
        effective,
      );
    }
  } catch {
    // settings are best-effort — defaults (auto) still apply
  }
  const flag = String(env.CC_TOOL_SEARCH ?? "")
    .trim()
    .toLowerCase();
  if (flag === "1" || flag === "true") effective.enabled = true;
  else if (flag === "0" || flag === "false") effective.enabled = false;
  else if (flag === "auto") effective.enabled = "auto";
  const catalogMode = String(env.CC_TOOL_SEARCH_CATALOG || "")
    .trim()
    .toLowerCase();
  if (catalogMode === "stubs" || catalogMode === "compact")
    effective.catalogMode = catalogMode;
  return effective;
}

// ─── token accounting ──────────────────────────────────────────────────────

/** Estimated token cost of one OpenAI-shape tool definition as sent. */
export function estimateToolDefTokens(def, estimate = defaultEstimateTokens) {
  let serialized;
  try {
    serialized = JSON.stringify(def);
  } catch {
    return MAX_ACCOUNTED_TOOL_TOKENS;
  }
  if (typeof serialized !== "string" || serialized.length === 0) {
    return MAX_ACCOUNTED_TOOL_TOKENS;
  }
  try {
    const estimated = estimate(serialized);
    if (Number.isFinite(estimated) && estimated > 0) {
      return Math.min(
        MAX_ACCOUNTED_TOOL_TOKENS,
        Math.max(1, Math.ceil(estimated)),
      );
    }
  } catch {
    // Fall through to a conservative UTF-8 byte upper bound. Tool definitions
    // are non-empty, so zero would incorrectly disable automatic deferral.
  }
  return Math.min(
    MAX_ACCOUNTED_TOOL_TOKENS,
    Math.max(1, Buffer.byteLength(serialized, "utf8")),
  );
}

// ─── alwaysLoad matching ───────────────────────────────────────────────────

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, (ch) =>
    ch === "*" ? "\u0000" : `\\${ch}`,
  );
  return new RegExp(`^${escaped.split("\u0000").join(".*")}$`);
}

/**
 * Does an alwaysLoad pattern list pin this tool as fully loaded?
 * A pattern matches when it equals the server name, equals the full
 * `mcp__<server>__<tool>` name, or is a `*` glob over the full name.
 */
export function matchesAlwaysLoad(fullName, serverName, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return false;
  for (const p of patterns) {
    if (typeof p !== "string" || !p) continue;
    if (p === serverName || p === fullName) return true;
    if (p.includes("*")) {
      try {
        if (globToRegExp(p).test(fullName)) return true;
      } catch {
        // malformed pattern — ignore
      }
    }
  }
  return false;
}

// ─── stub + tool_search definitions ────────────────────────────────────────

function firstLine(text, max = 120) {
  const line = String(text || "")
    .split("\n")[0]
    .trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function buildStubDefinition(fullDef) {
  return {
    type: "function",
    function: {
      name: fullDef.function.name,
      description: `[deferred] ${firstLine(fullDef.function.description)}`,
      // Permissive empty schema: cc dispatches MCP calls itself, so nothing
      // provider-side validates against this. Kept minimal to save tokens.
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: true,
      },
    },
  };
}

export function buildToolSearchDefinition({ catalogMode = "stubs" } = {}) {
  const definition = {
    type: "function",
    function: {
      name: TOOL_SEARCH_TOOL_NAME,
      description:
        'Load the full input schemas of deferred MCP tools. Tools marked "[deferred]" ' +
        "in your tool list have their schemas hidden to save context — fetch a schema " +
        'with this tool BEFORE calling one. Query forms: "select:<tool_name>" ' +
        "(comma-separate several names) fetches exact tools; plain keywords search " +
        "tool names + descriptions; prefix a term with '+' to require it in the tool " +
        "name. Returns the matched tools' full parameter schemas; after that, call " +
        "them directly.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              'Search query: "select:name1,name2" for exact tools, or keywords.',
          },
          max_results: {
            type: "number",
            description: "Maximum number of results (default 5).",
          },
        },
        required: ["query"],
      },
    },
  };
  if (catalogMode === "compact") {
    definition.function.description =
      "Discover connected MCP tools that are omitted from the initial tool list. " +
      'Search tool names and descriptions with keywords, or use "select:<exact_name>". ' +
      'Use "servers:" with offset/max_results for a paged server directory. ' +
      "Search returns full schemas and makes the selected tools available in the next model request. " +
      "Search first, then call the selected tool by its returned name in a later request. " +
      "Discovery does not grant execution permission.";
    definition.function.parameters.properties.offset = {
      type: "integer",
      minimum: 0,
      description: 'Server directory offset, used only with query "servers:".',
    };
  }
  return definition;
}

/** Provider-only projection. The host's complete capability ceiling stays intact. */
export function projectMcpToolDefinitions(definitions, executors) {
  const search = executors?.[TOOL_SEARCH_TOOL_NAME];
  const registry = search?.kind === "tool-search" ? search.registry : null;
  if (
    registry?.catalogMode !== "compact" ||
    !definitions.some((def) => def?.function?.name === TOOL_SEARCH_TOOL_NAME)
  )
    return definitions;
  const allowed = new Set(definitions.map((def) => def?.function?.name));
  const projected = definitions
    .filter((def) => {
      const name = def?.function?.name;
      const exec = executors[name];
      return (
        !registry.deferred.has(name) &&
        !(exec?.deferred === true && exec.registry === registry) &&
        !(name?.startsWith("mcp__") && !exec)
      );
    })
    .map((def) =>
      def?.function?.name === TOOL_SEARCH_TOOL_NAME
        ? registry.compactSearchDefinition
        : def,
    );
  // Insertion order keeps already-discovered schemas ahead of later additions.
  for (const name of registry.loaded) {
    const entry = registry.deferred.get(name);
    if (
      allowed.has(name) &&
      entry &&
      entry.stale !== true &&
      entry.executor === executors[name]
    )
      projected.push(entry.definition);
  }
  return projected;
}

// ─── deferral transform ────────────────────────────────────────────────────

/**
 * Rewrite the resolved MCP wiring (`{extraToolDefinitions, externalToolExecutors,
 * externalToolDescriptors, ...}`) in place: replace every deferrable MCP tool
 * definition with a compact stub, append the `tool_search` tool, and attach a
 * registry that maps names back to the full definitions.
 *
 * Deferrable = executor kind "mcp" and not pinned by alwaysLoad. The generic
 * mcp-resource tools, alwaysLoad pins, and anything already stubbed (re-entrant
 * call after a late server connect) keep their position; stubs are sorted by
 * name so the tools block is deterministic regardless of connect order
 * (prompt-cache stability), with late additions appended after the existing
 * stub block (append-only — never reorders what a cache prefix already saw).
 *
 * @returns {{registry:object, deferredCount:number, savedTokens:number}|null}
 */
export function applyToolSearchDeferral(mcp, opts = {}) {
  if (!mcp || !Array.isArray(mcp.extraToolDefinitions)) return null;
  const estimate = opts.estimate || defaultEstimateTokens;
  const alwaysLoad = Array.isArray(opts.alwaysLoad) ? opts.alwaysLoad : [];

  const registry = mcp.toolSearchRegistry || {
    deferred: new Map(), // fullName → { definition, serverName, toolName }
    loaded: new Set(),
    alwaysLoad,
    instructionsByServer:
      mcp.instructionsByServer && typeof mcp.instructionsByServer === "object"
        ? mcp.instructionsByServer
        : {},
  };
  const firstApplication = !mcp.toolSearchRegistry;
  registry.catalogMode =
    opts.catalogMode === "compact" || opts.catalogMode === "stubs"
      ? opts.catalogMode
      : registry.catalogMode || "stubs";
  registry.compactSearchDefinition ||= buildToolSearchDefinition({
    catalogMode: "compact",
  });

  const activeNames = new Set(
    mcp.extraToolDefinitions.map((def) => def?.function?.name),
  );
  for (const name of registry.deferred.keys()) {
    if (
      !activeNames.has(name) ||
      mcp.externalToolExecutors?.[name]?.kind !== "mcp"
    ) {
      registry.deferred.delete(name);
      registry.loaded.delete(name);
    }
  }

  const keep = [];
  const newStubs = [];
  let savedTokens = 0;
  for (const def of mcp.extraToolDefinitions) {
    const name = def?.function?.name;
    const exec = name ? mcp.externalToolExecutors?.[name] : null;
    const previous = registry.deferred.get(name);
    if (
      previous &&
      def === previous.stub &&
      exec === previous.executor &&
      exec?.serverName === previous.serverName &&
      exec?.toolName === previous.toolName
    ) {
      keep.push(def);
      continue;
    }
    if (previous && def === previous.stub && exec?.kind === "mcp") {
      registry.loaded.delete(name);
      registry.deferred.set(name, { ...previous, executor: exec, stale: true });
      exec.deferred = true;
      exec.registry = registry;
      keep.push(def);
      continue;
    }
    if (previous) {
      registry.deferred.delete(name);
      registry.loaded.delete(name);
    }
    const deferrable =
      exec?.kind === "mcp" &&
      name !== TOOL_SEARCH_TOOL_NAME &&
      !matchesAlwaysLoad(name, exec.serverName, alwaysLoad);
    if (!deferrable) {
      keep.push(def);
      continue;
    }
    const stub = buildStubDefinition(def);
    registry.deferred.set(name, {
      definition: structuredClone(def),
      stub,
      executor: exec,
      serverName: exec.serverName,
      toolName: exec.toolName,
    });
    savedTokens = boundedTokenSum(
      savedTokens,
      Math.max(
        0,
        estimateToolDefTokens(def, estimate) -
          estimateToolDefTokens(stub, estimate),
      ),
    );
    newStubs.push(stub);
    // Mark the executor so agent-core's mcp dispatch can gate an unloaded call.
    exec.deferred = true;
    exec.registry = registry;
  }
  if (newStubs.length === 0 && firstApplication) return null;

  newStubs.sort((a, b) => a.function.name.localeCompare(b.function.name));
  if (firstApplication) {
    mcp.extraToolDefinitions.length = 0;
    mcp.extraToolDefinitions.push(...keep, ...newStubs);
    mcp.extraToolDefinitions.push(buildToolSearchDefinition());
    mcp.externalToolExecutors[TOOL_SEARCH_TOOL_NAME] = {
      kind: "tool-search",
      registry,
    };
    mcp.externalToolDescriptors[TOOL_SEARCH_TOOL_NAME] = {
      name: TOOL_SEARCH_TOOL_NAME,
      kind: "tool-search",
      category: "mcp",
      source: "tool-search",
    };
    mcp.toolSearchRegistry = registry;
  } else {
    // Re-entrant (late-connected server): swap the new full defs for stubs in
    // place and append them AFTER everything the cached prefix already saw.
    const stubNames = new Set(newStubs.map((s) => s.function.name));
    const remaining = mcp.extraToolDefinitions.filter(
      (d) => !stubNames.has(d?.function?.name),
    );
    mcp.extraToolDefinitions.length = 0;
    mcp.extraToolDefinitions.push(...remaining, ...newStubs);
  }

  if (registry.catalogMode === "compact") {
    savedTokens =
      describeMcpToolContext(mcp, { estimate, config: TOOL_SEARCH_DEFAULTS })
        ?.savedTokens || 0;
  }
  return { registry, deferredCount: newStubs.length, savedTokens };
}

/**
 * Decide + apply tool-search deferral for one resolved MCP wiring object.
 * Returns the applyToolSearchDeferral summary when deferral activated, else
 * null — and on the null path the wiring object is untouched (byte-identical
 * request shapes downstream).
 *
 * @param {object} mcp  resolveAgentMcp result (mutated in place when deferring)
 * @param {object} [opts] { model, provider, env, cwd, settingsFile, estimate, writeErr }
 */
export function maybeApplyToolSearch(mcp, opts = {}) {
  if (!mcp || !Array.isArray(mcp.extraToolDefinitions)) return null;
  if (mcp.extraToolDefinitions.length === 0) return null;
  const config = opts.config || resolveToolSearchConfig(opts);
  if (config.enabled === false) return null;

  const estimate = opts.estimate || defaultEstimateTokens;
  // Once a session has a deferred catalog, later connections must keep using
  // it even when the compact stubs bring the current request below threshold.
  // Rechecking only the shrunken request would expose late schemas in full.
  if (config.enabled === "auto" && !mcp.toolSearchRegistry) {
    const window = getContextWindow(opts.model, opts.provider);
    let mcpTokens = 0;
    for (const def of mcp.extraToolDefinitions) {
      const name = def?.function?.name;
      if (mcp.externalToolExecutors?.[name]?.kind !== "mcp") continue;
      mcpTokens = boundedTokenSum(
        mcpTokens,
        estimateToolDefTokens(def, estimate),
      );
    }
    if (mcpTokens <= config.thresholdRatio * window) return null;
  }

  const summary = applyToolSearchDeferral(mcp, {
    estimate,
    alwaysLoad: config.alwaysLoad,
    catalogMode: config.catalogMode,
  });
  if (summary) {
    summary.maxResults = config.maxResults;
    if (mcp.toolSearchRegistry) {
      mcp.toolSearchRegistry.maxResults = config.maxResults;
    }
    if (typeof opts.writeErr === "function") {
      opts.writeErr(
        `  mcp: tool search active — ${summary.deferredCount} schema(s) ` +
          `deferred (~${summary.savedTokens} tok saved); ` +
          `the agent loads them on demand via ${TOOL_SEARCH_TOOL_NAME}\n`,
      );
    }
  }
  return summary;
}

// ─── search ────────────────────────────────────────────────────────────────

function searchResultLimit(registry, requested) {
  const configuredMaxResults = registry?.maxResults;
  return Number.isInteger(requested) && requested > 0
    ? Math.min(requested, 50)
    : Number.isInteger(configuredMaxResults) && configuredMaxResults > 0
      ? Math.min(configuredMaxResults, 50)
      : TOOL_SEARCH_DEFAULTS.maxResults;
}

/**
 * Search exact `select:` names or ranked keywords without marking schemas
 * loaded. Optional allowedToolNames restricts discovery to the host ceiling.
 */
export function searchDeferredTools(registry, query, opts = {}) {
  const q = String(query || "").trim();
  const maxResults = searchResultLimit(registry, opts.maxResults);
  const selectMode = /^select:/i.test(q);
  const allowed =
    opts.allowedToolNames == null ? null : new Set(opts.allowedToolNames);
  const eligible = function* () {
    for (const [name, entry] of registry?.deferred || []) {
      if (entry.stale !== true && (!allowed || allowed.has(name)))
        yield [name, entry];
    }
  };
  // Keyword ranking already checks liveness while scanning. Avoid cloning the
  // whole directory on every query; only exact selection needs keyed lookup.
  const entries = selectMode ? new Map(eligible()) : eligible();

  if (selectMode) {
    const wanted = q
      .slice(q.indexOf(":") + 1)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const results = [];
    const notFound = [];
    const seen = new Set();
    let omittedCount = 0;
    for (const w of wanted) {
      let match = null;
      if (entries.has(w)) {
        match = w;
      } else {
        // bare tool name → unique suffix match
        const matches = [...entries.keys()].filter(
          (k) => k.endsWith(`__${w}`) || entries.get(k).toolName === w,
        );
        if (matches.length === 1) match = matches[0];
      }
      if (!match) {
        notFound.push(w);
      } else if (!seen.has(match)) {
        seen.add(match);
        if (results.length < maxResults) {
          results.push({ name: match, entry: entries.get(match) });
        } else {
          omittedCount += 1;
        }
      }
    }
    return { mode: "select", results, notFound, omittedCount };
  }

  return {
    mode: "keyword",
    results: rankMcpToolSearchEntries(entries, q, maxResults),
    notFound: [],
  };
}

/**
 * Execute a `tool_search` call from the model: search, mark hits as loaded,
 * and shape a result whose text carries the full schemas (this is the
 * prompt-cache-friendly delivery channel — conversation content, not the
 * tools array).
 */
export function executeToolSearch(registry, args = {}, options = {}) {
  const query = typeof args.query === "string" ? args.query : "";
  if (!query.trim()) {
    return {
      error:
        'tool_search requires a "query" argument — use "select:<tool_name>" or keywords.',
    };
  }
  if (query.length > 8192) {
    return {
      error:
        "tool_search query is too long; select fewer tool names or use shorter keywords.",
    };
  }
  if (registry.catalogMode === "compact" && /^servers:$/i.test(query.trim())) {
    const offset = args.offset === undefined ? 0 : args.offset;
    if (!Number.isSafeInteger(offset) || offset < 0)
      return {
        error: "Server directory offset must be a non-negative integer.",
      };
    const allowed =
      options.allowedToolNames == null
        ? null
        : new Set(options.allowedToolNames);
    const servers = new Map();
    for (const [name, entry] of registry.deferred) {
      if (entry.stale === true || (allowed && !allowed.has(name))) continue;
      if (typeof entry.serverName !== "string" || !entry.serverName) continue;
      const previous = servers.get(entry.serverName);
      if (previous) previous.toolCount++;
      else
        servers.set(entry.serverName, { toolCount: 1, exampleToolName: name });
    }
    const names = [...servers.keys()].sort();
    const limit = searchResultLimit(
      registry,
      typeof args.max_results === "number"
        ? Math.floor(args.max_results)
        : undefined,
    );
    const page = names.slice(offset, offset + limit).map((name) => {
      const entry = servers.get(name);
      if (name.length <= 192) return { name, toolCount: entry.toolCount };
      let label = name.slice(0, 191);
      if (/[\uD800-\uDBFF]$/.test(label)) label = label.slice(0, -1);
      return {
        name: label + "…",
        nameTruncated: true,
        toolCount: entry.toolCount,
        ...(entry.exampleToolName.length <= 128
          ? { exampleToolName: entry.exampleToolName }
          : {}),
      };
    });
    return {
      servers: page,
      totalServers: names.length,
      offset,
      nextOffset:
        offset + page.length < names.length ? offset + page.length : null,
      note: "Directory only; no schemas loaded. Search keywords across all permitted servers or select an exact tool name. Offsets address the current live directory.",
    };
  }
  const {
    mode,
    results,
    notFound,
    omittedCount = 0,
  } = searchDeferredTools(registry, query, {
    allowedToolNames: options.allowedToolNames,
    maxResults:
      typeof args.max_results === "number"
        ? Math.floor(args.max_results)
        : undefined,
  });
  const tools = results.map(({ name, entry }) => {
    registry.loaded.add(name);
    const fn = entry.definition?.function || {};
    const out = {
      name,
      server: entry.serverName,
      description: fn.description || "",
      parameters: fn.parameters || { type: "object", properties: {} },
    };
    const instructions = Object.hasOwn(
      registry.instructionsByServer || {},
      entry.serverName,
    )
      ? registry.instructionsByServer[entry.serverName]
      : null;
    if (typeof instructions === "string" && instructions)
      out.serverInstructions = instructions;
    return out;
  });
  const payload = {
    count: tools.length,
    tools,
  };
  if (notFound.length > 0) payload.notFound = notFound;
  if (omittedCount > 0) payload.omittedCount = omittedCount;
  if (tools.length === 0) {
    payload.note =
      mode === "select"
        ? "No deferred tool matched those names. Names must be the full mcp__<server>__<tool> form (or a unique bare tool name)."
        : "No deferred tool matched. Try different keywords, or select by exact name.";
    if (registry.catalogMode === "compact") {
      payload.note +=
        ' Use query "servers:" to inspect the permitted server directory.';
    } else {
      const allowed =
        options.allowedToolNames == null
          ? null
          : new Set(options.allowedToolNames);
      payload.available = [...(registry?.deferred || [])]
        .filter(
          ([name, entry]) =>
            entry.stale !== true && (!allowed || allowed.has(name)),
        )
        .map(([name]) => name)
        .slice(0, 100);
    }
  } else {
    payload.note =
      (registry.catalogMode === "compact"
        ? "Schemas loaded — these tools are available by their returned names in the next model request. Call them with arguments matching `parameters`."
        : "Schemas loaded — call these tools directly with arguments matching `parameters`.") +
      (omittedCount > 0
        ? " Some selected tools were omitted by max_results; select those tools in a separate search before calling them."
        : "");
  }
  return payload;
}

/**
 * Gate for a direct call to a deferred MCP tool whose schema was never loaded:
 * return a self-healing error embedding the schema, and mark it loaded so the
 * immediate retry goes through. Returns null when the call may proceed.
 */
export function gateDeferredMcpCall(name, executor) {
  const registry = executor?.registry;
  if (executor?.deferred === true && registry) {
    const current = registry.deferred.get(name);
    if (
      !current ||
      current.stale === true ||
      (current.executor && current.executor !== executor)
    ) {
      return {
        error: `"${name}" is no longer available through this MCP connection. Refresh the tool catalog before calling it.`,
        code: "CC_MCP_TOOL_CATALOG_STALE",
      };
    }
  }
  if (
    executor?.deferred !== true ||
    !registry ||
    registry.loaded.has(name) ||
    !registry.deferred.has(name)
  ) {
    return null;
  }
  registry.loaded.add(name);
  const entry = registry.deferred.get(name);
  const fn = entry.definition?.function || {};
  return {
    error:
      `"${name}" is a deferred MCP tool — its input schema was not loaded before this call. ` +
      `The schema is included below and is now loaded; retry with arguments matching it. ` +
      `(Next time, call ${TOOL_SEARCH_TOOL_NAME} first.)`,
    description: fn.description || "",
    schema: fn.parameters || { type: "object", properties: {} },
  };
}

// ─── /context reporting ────────────────────────────────────────────────────

/**
 * Token accounting of the MCP tool surface for `/context`: per-server rows,
 * as-sent vs fully-loaded totals, and plain-language optimization advice.
 *
 * @param {object} mcp  resolveAgentMcp result (possibly deferral-rewritten)
 * @param {object} [opts] { estimate, model, provider, config }
 */
export function describeMcpToolContext(mcp, opts = {}) {
  if (!mcp || !Array.isArray(mcp.extraToolDefinitions)) return null;
  const estimate = opts.estimate || defaultEstimateTokens;
  const registry = mcp.toolSearchRegistry || null;
  const config = opts.config || resolveToolSearchConfig(opts);
  const window = getContextWindow(opts.model, opts.provider);

  const servers = new Map(); // server → {tools, sentTokens, fullTokens, deferred}
  const projected = projectMcpToolDefinitions(
    mcp.extraToolDefinitions,
    mcp.externalToolExecutors,
  );
  const visible = new Map(projected.map((def) => [def?.function?.name, def]));
  let sentTokens = 0;
  let fullTokens = 0;
  for (const def of mcp.extraToolDefinitions) {
    const name = def?.function?.name;
    if (!name) continue;
    const exec = mcp.externalToolExecutors?.[name];
    const isSearchTool = name === TOOL_SEARCH_TOOL_NAME;
    const isMcp = exec?.kind === "mcp" || exec?.kind === "mcp-resource";
    if (!isMcp && !isSearchTool) continue;
    const server =
      exec?.kind === "mcp"
        ? exec.serverName
        : isSearchTool
          ? "(tool_search)"
          : "(resources)";
    const sentDef = visible.get(name);
    const sent = sentDef ? estimateToolDefTokens(sentDef, estimate) : 0;
    const fullDef = registry?.deferred?.get(name)?.definition || def;
    const full =
      fullDef === sentDef ? sent : estimateToolDefTokens(fullDef, estimate);
    const row = servers.get(server) || {
      server,
      tools: 0,
      sentTokens: 0,
      fullTokens: 0,
      deferred: 0,
    };
    row.tools += 1;
    row.sentTokens = boundedTokenSum(row.sentTokens, sent);
    row.fullTokens = boundedTokenSum(row.fullTokens, full);
    if (registry?.deferred?.has(name)) row.deferred += 1;
    servers.set(server, row);
    sentTokens = boundedTokenSum(sentTokens, sent);
    fullTokens = boundedTokenSum(fullTokens, full);
  }
  if (servers.size === 0) return null;

  const rows = [...servers.values()].sort(
    (a, b) => b.sentTokens - a.sentTokens,
  );
  const active = !!registry;
  const loadedCount = registry ? registry.loaded.size : 0;
  const deferredCount = registry ? registry.deferred.size : 0;

  const advice = [];
  const threshold = config.thresholdRatio * window;
  if (!active && config.enabled === false && sentTokens > threshold) {
    advice.push(
      `MCP tool schemas take ~${Math.round((sentTokens / window) * 100)}% of the ` +
        `context window but tool search is disabled — re-enable it ` +
        `(settings mcp.toolSearch.enabled or CC_TOOL_SEARCH=1) to defer schemas.`,
    );
  } else if (!active && sentTokens > threshold) {
    advice.push(
      `MCP tool schemas take ~${Math.round((sentTokens / window) * 100)}% of the ` +
        `context window — enable tool search (CC_TOOL_SEARCH=1 or settings ` +
        `mcp.toolSearch.enabled=true) to defer schemas until needed.`,
    );
  }
  if (active && fullTokens > sentTokens) {
    advice.push(
      `Tool search is saving ~${fullTokens - sentTokens} tokens ` +
        `(${deferredCount} deferred, ${loadedCount} loaded on demand).`,
    );
  }
  const biggest = rows[0];
  if (biggest && rows.length > 1 && biggest.fullTokens > threshold) {
    advice.push(
      `Largest server: "${biggest.server}" (${biggest.tools} tools, ` +
        `~${biggest.fullTokens} tok full) — if unused, disconnect it or scope ` +
        `alwaysLoad to only the tools you need.`,
    );
  }

  return {
    sentTokens,
    fullTokens,
    savedTokens: Math.max(0, fullTokens - sentTokens),
    window,
    servers: rows,
    toolSearch: {
      active,
      deferredCount,
      loadedCount,
      ...(registry?.catalogMode === "compact"
        ? {
            catalogMode: "compact",
            visibleDeferredCount: projected.filter((def) =>
              registry.deferred.has(def?.function?.name),
            ).length,
          }
        : {}),
    },
    advice,
  };
}
