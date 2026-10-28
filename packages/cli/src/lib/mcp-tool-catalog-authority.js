import { createHash } from "node:crypto";

// Only host-owned publications can enlarge a live catalog. A plain object or a
// mutated startup array is not a catalog authority.
const authorities = new WeakMap();
const publishers = new WeakMap();

function freezeMetadata(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freezeMetadata(child, seen);
  return Object.freeze(value);
}

export function captureMcpToolCatalog(authority) {
  if (authority == null) return null;
  if (!authorities.has(authority)) {
    const error = new TypeError("MCP tool catalog authority is invalid");
    error.code = "CC_MCP_TOOL_CATALOG_AUTHORITY_INVALID";
    throw error;
  }
  return authority;
}

export function readMcpToolCatalog(authority) {
  return authorities.get(captureMcpToolCatalog(authority))?.read() || null;
}

function installAuthority(read, extendSelection = false, selectionBase = null) {
  const authority = Object.freeze({});
  authorities.set(authority, {
    read,
    extendSelection,
    selectionBase: Array.isArray(selectionBase)
      ? Object.freeze([...selectionBase])
      : null,
  });
  return authority;
}

/** Publish a completed, admitted host inventory; never expose a partial batch. */
export function publishMcpToolCatalog(mcp, { create = false } = {}) {
  let publisher = publishers.get(mcp);
  if (!publisher && !create) return null;
  if (!publisher) {
    publisher = { snapshot: null, records: new Map(), revision: 0 };
    publisher.authority = installAuthority(() => {
      publisher.refresh?.();
      return publisher.snapshot;
    });
    publishers.set(mcp, publisher);
    Object.defineProperty(mcp, "mcpToolCatalog", {
      value: publisher.authority,
      enumerable: true,
    });
  }
  const records = new Map();
  const identities = new Map();
  for (const definition of mcp.extraToolDefinitions || []) {
    const name = definition?.function?.name;
    const executor = mcp.externalToolExecutors?.[name];
    if (!name || !executor) continue;
    const full =
      executor.registry?.deferred?.get(name)?.definition || definition;
    freezeMetadata(full);
    freezeMetadata(definition);
    freezeMetadata(mcp.externalToolDescriptors?.[name]);
    for (const key of [
      "kind",
      "serverName",
      "toolName",
      "op",
      "toolResultConfig",
    ]) {
      if (!Object.hasOwn(executor, key)) continue;
      Object.defineProperty(executor, key, {
        value: freezeMetadata(executor[key]),
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          definition: full,
          descriptor: mcp.externalToolDescriptors?.[name] || null,
          route: {
            kind: executor.kind,
            serverName: executor.serverName,
            toolName: executor.toolName,
            op: executor.op,
            inheritable: executor.inheritable,
          },
        }),
      )
      .digest("hex");
    const previous = publisher.records.get(name);
    const identity =
      previous?.executor === executor && previous.fingerprint === fingerprint
        ? previous.identity
        : Object.freeze({});
    records.set(name, { executor, fingerprint, identity });
    identities.set(name, identity);
  }
  publisher.records = records;
  publisher.snapshot = Object.freeze({
    revision: ++publisher.revision,
    extraToolDefinitions: Object.freeze([...(mcp.extraToolDefinitions || [])]),
    externalToolDescriptors: Object.freeze({ ...mcp.externalToolDescriptors }),
    externalToolExecutors: Object.freeze({ ...mcp.externalToolExecutors }),
    mcpClient: mcp.mcpClient || null,
    identities,
  });
  return publisher.authority;
}

export function setMcpToolCatalogRefresh(mcp, refresh) {
  if (!publishers.has(mcp)) publishMcpToolCatalog(mcp, { create: true });
  publishers.get(mcp).refresh = refresh;
}

/** A derived authority can only remove names from its parent. */
export function projectMcpToolCatalog(
  authority,
  project,
  { extendSelection = false, selectionBase = null } = {},
) {
  captureMcpToolCatalog(authority);
  let previousSource;
  let previousResult;
  return installAuthority(
    () => {
      const source = readMcpToolCatalog(authority);
      if (source === previousSource) return previousResult;
      const result = project(source, previousResult);
      const permitted = new Set(
        source.extraToolDefinitions.map((def) => def.function.name),
      );
      const definitions = (result?.extraToolDefinitions || []).filter((def) =>
        permitted.has(def?.function?.name),
      );
      const names = new Set(definitions.map((def) => def.function.name));
      const subset = (values) =>
        Object.fromEntries(
          Object.entries(values || {}).filter(([name]) => names.has(name)),
        );
      previousSource = source;
      previousResult = Object.freeze({
        ...result,
        revision: source.revision,
        extraToolDefinitions: Object.freeze(definitions),
        externalToolDescriptors: Object.freeze(
          subset(result?.externalToolDescriptors),
        ),
        externalToolExecutors: Object.freeze(
          subset(result?.externalToolExecutors),
        ),
        mcpClient: source.mcpClient,
        identities: new Map(
          [...source.identities].filter(([name]) => names.has(name)),
        ),
      });
      return previousResult;
    },
    extendSelection,
    selectionBase,
  );
}

export function restrictMcpToolCatalog(snapshot, names) {
  const allowed = new Set(names);
  return {
    ...snapshot,
    extraToolDefinitions: snapshot.extraToolDefinitions.filter((def) =>
      allowed.has(def.function.name),
    ),
  };
}

export function assertMcpCatalogBinding(binding, name) {
  if (!binding) return;
  const current = readMcpToolCatalog(binding.authority);
  const identity = binding.snapshot.identities.get(name);
  if (!identity || current.identities.get(name) !== identity) {
    const error = new Error(
      `MCP tool catalog changed before dispatch of ${name}; request its current schema again`,
    );
    error.code = "CC_MCP_TOOL_CATALOG_STALE";
    error.dispatched = false;
    throw error;
  }
}

/** Replace catalog-owned fields while retaining unrelated host tools. */
export function mergeMcpToolCatalog(options, snapshot, authority) {
  const selection = authorities.get(captureMcpToolCatalog(authority));
  const mayExtendSelection =
    selection.extendSelection === true &&
    Array.isArray(selection.selectionBase) &&
    Array.isArray(options.enabledToolNames) &&
    options.enabledToolNames.length === selection.selectionBase.length &&
    options.enabledToolNames.every((name) =>
      selection.selectionBase.includes(name),
    );
  const owned = (name) =>
    name === "tool_search" ||
    name?.startsWith("mcp__") ||
    ["mcp", "mcp-resource", "tool-search"].includes(
      options.externalToolExecutors?.[name]?.kind,
    );
  const other = (map) =>
    Object.fromEntries(
      Object.entries(map || {}).filter(([name]) => !owned(name)),
    );
  return {
    ...options,
    extraToolDefinitions: [
      ...(options.extraToolDefinitions || []).filter(
        (def) => !owned(def?.function?.name),
      ),
      ...snapshot.extraToolDefinitions,
    ],
    externalToolDescriptors: {
      ...other(options.externalToolDescriptors),
      ...snapshot.externalToolDescriptors,
    },
    externalToolExecutors: {
      ...other(options.externalToolExecutors),
      ...snapshot.externalToolExecutors,
    },
    ...(mayExtendSelection
      ? {
          enabledToolNames: [
            ...new Set([
              ...options.enabledToolNames,
              ...snapshot.extraToolDefinitions.map((def) => def.function.name),
            ]),
          ],
        }
      : {}),
    mcpClient: snapshot.mcpClient,
  };
}
