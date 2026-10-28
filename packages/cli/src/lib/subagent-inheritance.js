/**
 * Subagent capability INHERITANCE + INTERSECT (P1 §"补齐 Subagent 契约").
 *
 * A spawned sub-agent inherits the parent loop's MCP tools and Pre/PostToolUse
 * hooks ONLY through these filters, keyed off the resolved contract's
 * `mcpServers` / `hooks` allow-lists. The tri-state matches
 * `resolveSubagentContract` (see subagent-contract.js):
 *
 *   allow === null   → inherit ALL (context:fork with an unrestricted parent)
 *   allow === []     → inherit NONE (the silent-`fresh` default = today's
 *                      behavior: a spawned child gets no MCP tools / no hooks)
 *   allow === [...]  → inherit only the named servers / hook matchers
 *
 * Because the default is `[]` = none, wiring these is byte-identical for a
 * plain sub-agent and only grants capabilities when the contract explicitly
 * opts in (fork context or an explicit list). Pure — no I/O.
 *
 * @module subagent-inheritance
 */
import {
  projectMcpToolCatalog,
  restrictMcpToolCatalog,
} from "./mcp-tool-catalog-authority.js";

/** Keep a child's directory live without broadening its captured contract. */
export function createInheritedMcpToolCatalog(
  parent,
  allow,
  requestedTools,
  effectiveTools,
) {
  const servers = Array.isArray(allow) ? Object.freeze([...allow]) : null;
  const names = Array.isArray(requestedTools)
    ? Object.freeze([...requestedTools])
    : null;
  const staticParentNames =
    parent.mcpCatalogBinding?.authority !== parent.mcpToolCatalog &&
    Array.isArray(parent.effectiveAllowedToolNames)
      ? Object.freeze([...parent.effectiveAllowedToolNames])
      : null;
  return projectMcpToolCatalog(
    parent.mcpToolCatalog,
    (snapshot, previous) => {
      let inherited = filterInheritedMcp(snapshot, servers) || {
        extraToolDefinitions: [],
        externalToolDescriptors: {},
        externalToolExecutors: {},
      };
      if (names) inherited = restrictMcpToolCatalog(inherited, names);
      if (staticParentNames)
        inherited = restrictMcpToolCatalog(inherited, staticParentNames);
      if (previous) {
        const registries = new Set(
          Object.values(inherited.externalToolExecutors)
            .map((executor) => executor.registry)
            .filter(Boolean),
        );
        for (const registry of registries) registry.loaded.clear();
        for (const [name, executor] of Object.entries(
          inherited.externalToolExecutors,
        )) {
          if (
            executor.registry &&
            previous.identities.get(name) === snapshot.identities.get(name) &&
            previous.externalToolExecutors[name]?.registry?.loaded.has(name)
          )
            executor.registry.loaded.add(name);
        }
      }
      return inherited;
    },
    { extendSelection: names === null, selectionBase: effectiveTools },
  );
}

/** Extract the server segment from an `mcp__<server>__<tool>` wire name. */
export function mcpServerOf(name) {
  const s = String(name || "");
  if (!s.startsWith("mcp__")) return null;
  const rest = s.slice(5);
  const idx = rest.indexOf("__");
  return idx === -1 ? rest || null : rest.slice(0, idx) || null;
}

/**
 * Discovery state belongs to one loop. Keep the inherited snapshot bounded to
 * its tools, while observing revocation of the source entries. Sharing the
 * parent's registry would expose excluded schemas and let one child's search
 * change the provider projection of its parent and siblings.
 */
function forkDiscoveryRegistries(parent, definitions, descriptors, executors) {
  const registries = new Map();
  const definitionsByName = new Map(
    definitions.map((definition) => [definition?.function?.name, definition]),
  );
  for (const [name, sourceExecutor] of Object.entries(executors)) {
    const source = sourceExecutor?.registry;
    if (sourceExecutor?.deferred !== true || !(source?.deferred instanceof Map))
      continue;
    let registry = registries.get(source);
    if (!registry) {
      registry = {
        catalogMode: source.catalogMode,
        maxResults: source.maxResults,
        compactSearchDefinition: source.compactSearchDefinition
          ? structuredClone(source.compactSearchDefinition)
          : undefined,
        deferred: new Map(),
        loaded: new Set(),
        instructionsByServer: Object.create(null),
      };
      registries.set(source, registry);
    }
    const executor = { ...sourceExecutor, registry };
    executors[name] = executor;
    const entry = source.deferred.get(name);
    // A missing/mismatched entry remains unavailable through the ordinary
    // deferred-call gate; never reconstruct a schema from a stale stub.
    if (
      !entry ||
      !definitionsByName.has(name) ||
      entry.executor !== sourceExecutor ||
      entry.serverName !== sourceExecutor.serverName ||
      entry.toolName !== sourceExecutor.toolName
    )
      continue;
    const sourceDescriptor = parent.externalToolDescriptors?.[name];
    const inherited = {
      definition: structuredClone(entry.definition),
      stub: structuredClone(entry.stub),
      executor,
      serverName: entry.serverName,
      toolName: entry.toolName,
      get stale() {
        return (
          entry.stale === true ||
          source.deferred.get(name) !== entry ||
          parent.externalToolExecutors?.[name] !== sourceExecutor ||
          parent.externalToolDescriptors?.[name] !== sourceDescriptor ||
          sourceExecutor.inheritable === false ||
          sourceDescriptor?.inheritable === false
        );
      },
    };
    registry.deferred.set(name, inherited);
    if (source.loaded?.has(name) && !inherited.stale) registry.loaded.add(name);
    if (definitionsByName.get(name) === entry.stub)
      definitionsByName.set(name, inherited.stub);
    if (Object.hasOwn(source.instructionsByServer || {}, entry.serverName)) {
      registry.instructionsByServer[entry.serverName] =
        source.instructionsByServer[entry.serverName];
    }
  }

  const searchName = "tool_search";
  const search = parent?.externalToolExecutors?.[searchName];
  const searchDescriptor = parent?.externalToolDescriptors?.[searchName];
  const searchDefinition = Array.isArray(parent?.extraToolDefinitions)
    ? parent.extraToolDefinitions.find(
        (definition) => definition?.function?.name === searchName,
      )
    : null;
  const registry = registries.get(search?.registry);
  // Search is a directory helper, not a server capability of its own. Restore
  // it only for an inherited deferred directory and only if the parent grants
  // inheritance of the helper itself. Execution still checks the tool ceiling.
  if (
    search?.kind === "tool-search" &&
    search.inheritable !== false &&
    searchDescriptor?.inheritable !== false &&
    searchDefinition &&
    registry?.deferred.size > 0
  ) {
    definitionsByName.set(searchName, structuredClone(searchDefinition));
    executors[searchName] = { ...search, registry };
    if (searchDescriptor) descriptors[searchName] = { ...searchDescriptor };
  }
  return [...definitionsByName.values()];
}

/**
 * Filter the parent's MCP plumbing to the servers the child may use.
 *
 * @param {object} parent  { extraToolDefinitions[], externalToolDescriptors{},
 *                            externalToolExecutors{}, mcpClient }
 * @param {string[]|null} allow  null=all, []=none, list=subset of server names
 * @returns {object|null}  filtered plumbing, or null when nothing is inherited
 */
export function filterInheritedMcp(parent, allow) {
  if (Array.isArray(allow) && allow.length === 0) return null; // none
  const allowSet = Array.isArray(allow) ? new Set(allow) : null; // null = all
  const serverAllowed = (server) =>
    !allowSet || (server != null && allowSet.has(server));

  const defs = Array.isArray(parent?.extraToolDefinitions)
    ? parent.extraToolDefinitions
    : [];
  const descs =
    parent?.externalToolDescriptors &&
    typeof parent.externalToolDescriptors === "object"
      ? parent.externalToolDescriptors
      : {};
  const execs =
    parent?.externalToolExecutors &&
    typeof parent.externalToolExecutors === "object"
      ? parent.externalToolExecutors
      : {};
  const inheritable = (name) =>
    descs[name]?.inheritable !== false && execs[name]?.inheritable !== false;

  let outDefs = defs.filter((d) => {
    const name = d?.function?.name;
    return (
      name &&
      name !== "tool_search" &&
      inheritable(name) &&
      serverAllowed(mcpServerOf(name))
    );
  });
  const outDescs = {};
  for (const [name, desc] of Object.entries(descs)) {
    if (name === "tool_search") continue;
    const server = desc?.serverName || mcpServerOf(name);
    if (inheritable(name) && serverAllowed(server)) outDescs[name] = desc;
  }
  const outExecs = {};
  for (const [name, exec] of Object.entries(execs)) {
    if (name === "tool_search") continue;
    const server = exec?.serverName || mcpServerOf(name);
    if (inheritable(name) && serverAllowed(server)) outExecs[name] = exec;
  }

  outDefs = forkDiscoveryRegistries(parent, outDefs, outDescs, outExecs);

  if (
    outDefs.length === 0 &&
    Object.keys(outDescs).length === 0 &&
    Object.keys(outExecs).length === 0
  ) {
    return null; // nothing survived the filter — inherit no MCP
  }
  return {
    extraToolDefinitions: outDefs,
    externalToolDescriptors: outDescs,
    externalToolExecutors: outExecs,
    mcpClient: parent?.mcpClient || null,
  };
}

/**
 * Filter the parent's settings hooks to the matchers the child may fire. Hooks
 * have no name; a group's `matcher` (normalized: null/""→"*") is its identity.
 *
 * @param {object|null} settingsHooks  { [event]: [{matcher, hooks:[...]}] }
 * @param {string[]|null} allow  null=all, []=none, list=subset of matchers
 * @returns {object|null}  filtered hooks, or null when nothing is inherited
 */
export function filterInheritedHooks(settingsHooks, allow) {
  if (Array.isArray(allow) && allow.length === 0) return null; // none
  if (!settingsHooks || typeof settingsHooks !== "object") return null;
  if (!Array.isArray(allow)) return settingsHooks; // null = inherit all as-is

  const allowSet = new Set(allow);
  const matcherKey = (g) =>
    g?.matcher == null || g.matcher === "" ? "*" : String(g.matcher);

  const out = {};
  for (const [event, groups] of Object.entries(settingsHooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = groups.filter((g) => allowSet.has(matcherKey(g)));
    if (kept.length > 0) out[event] = kept;
  }
  return Object.keys(out).length > 0 ? out : null;
}
