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

/** Extract the server segment from an `mcp__<server>__<tool>` wire name. */
export function mcpServerOf(name) {
  const s = String(name || "");
  if (!s.startsWith("mcp__")) return null;
  const rest = s.slice(5);
  const idx = rest.indexOf("__");
  return idx === -1 ? rest || null : rest.slice(0, idx) || null;
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

  const outDefs = defs.filter((d) => {
    const name = d?.function?.name;
    return name && serverAllowed(mcpServerOf(name));
  });
  const outDescs = {};
  for (const [name, desc] of Object.entries(descs)) {
    const server = desc?.serverName || mcpServerOf(name);
    if (serverAllowed(server)) outDescs[name] = desc;
  }
  const outExecs = {};
  for (const [name, exec] of Object.entries(execs)) {
    const server = exec?.serverName || mcpServerOf(name);
    if (serverAllowed(server)) outExecs[name] = exec;
  }

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
