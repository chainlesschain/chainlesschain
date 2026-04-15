/**
 * Sub-Agent Profiles — declarative registry of subagent roles.
 *
 * Inspired by open-agents SUBAGENT_REGISTRY. Separate from the runtime
 * `sub-agent-registry.js` which tracks *instances*; this module describes
 * the *kinds* (explorer/executor/design) a parent agent may delegate to.
 *
 * Each profile defines:
 *  - name           stable identifier used by spawn_sub_agent
 *  - shortDescription  one-line hook for the parent prompt
 *  - systemPrompt      prepended to sub-agent messages[0]
 *  - toolAllowlist     array of tool names the sub-agent may call
 *                      (null = inherit all)
 *  - maxIterations     optional per-profile iteration cap
 *  - modelHint         optional { category } hint for llm-manager
 */

const READONLY_TOOLS = Object.freeze([
  "read_file",
  "list_dir",
  "search_files",
  "search_sessions",
  "web_fetch",
  "list_skills",
]);

const FULL_TOOLS = Object.freeze([
  "read_file",
  "write_file",
  "edit_file",
  "edit_file_hashed",
  "list_dir",
  "search_files",
  "search_sessions",
  "run_shell",
  "git",
  "run_code",
  "run_skill",
  "list_skills",
  "web_fetch",
  "todo_write",
  "ask_user_question",
]);

const DESIGN_TOOLS = Object.freeze([
  "read_file",
  "write_file",
  "edit_file",
  "edit_file_hashed",
  "list_dir",
  "search_files",
  "web_fetch",
  "run_skill",
  "list_skills",
  "todo_write",
]);

const _builtinProfiles = {
  explorer: {
    name: "explorer",
    shortDescription:
      "Read-only researcher. Investigates code, searches files/sessions, fetches web docs. Cannot write or execute.",
    systemPrompt:
      "You are a read-only research sub-agent. Your job is to gather facts and report back concisely. You MUST NOT write files or execute commands. When done, return a structured summary of findings.",
    toolAllowlist: READONLY_TOOLS,
    maxIterations: 20,
    modelHint: { category: "quick" },
  },
  executor: {
    name: "executor",
    shortDescription:
      "Full-permission implementer. Writes code, runs tests, executes shell/git. Use for end-to-end task completion.",
    systemPrompt:
      "You are a full-permission execution sub-agent. Implement the task to completion. Prefer edit_file_hashed over edit_file. Always verify with tests/build when relevant. Return a summary plus list of files changed.",
    toolAllowlist: FULL_TOOLS,
    maxIterations: 40,
    modelHint: { category: "deep" },
  },
  design: {
    name: "design",
    shortDescription:
      "Frontend/UI specialist. Produces polished Vue/React/HTML with distinctive aesthetics. No shell/git access.",
    systemPrompt:
      "You are a frontend design sub-agent. Produce high-quality, production-grade UI code. Avoid generic AI aesthetics. Prefer semantic HTML, accessible components, and thoughtful typography. You may read/write files and fetch references from the web, but cannot run shell or git.",
    toolAllowlist: DESIGN_TOOLS,
    maxIterations: 30,
    modelHint: { category: "creative" },
  },
};

const _registry = new Map(Object.entries(_builtinProfiles));

export function getSubAgentProfile(name) {
  if (!name) return null;
  const entry = _registry.get(name);
  if (!entry) return null;
  return {
    ...entry,
    toolAllowlist: Array.isArray(entry.toolAllowlist)
      ? [...entry.toolAllowlist]
      : null,
  };
}

export function listSubAgentProfiles() {
  return Array.from(_registry.values()).map((p) => ({
    ...p,
    toolAllowlist: Array.isArray(p.toolAllowlist) ? [...p.toolAllowlist] : null,
  }));
}

/**
 * Register a custom profile (or override a built-in).
 * Returns true on success, false on invalid input.
 */
export function registerSubAgentProfile(profile) {
  if (!profile || typeof profile.name !== "string" || !profile.name) {
    return false;
  }
  if (typeof profile.shortDescription !== "string") return false;
  if (typeof profile.systemPrompt !== "string") return false;
  const toolAllowlist = Array.isArray(profile.toolAllowlist)
    ? [...profile.toolAllowlist]
    : null;
  _registry.set(profile.name, {
    name: profile.name,
    shortDescription: profile.shortDescription,
    systemPrompt: profile.systemPrompt,
    toolAllowlist,
    maxIterations:
      typeof profile.maxIterations === "number" ? profile.maxIterations : 20,
    modelHint: profile.modelHint || null,
  });
  return true;
}

export function unregisterSubAgentProfile(name) {
  return _registry.delete(name);
}

export function resetToBuiltins() {
  _registry.clear();
  for (const [k, v] of Object.entries(_builtinProfiles)) {
    _registry.set(k, v);
  }
}

/**
 * Build a one-section system-prompt snippet listing available subagents.
 * Inspired by open-agents buildSubagentSummaryLines.
 *
 * @returns {string}
 */
export function buildSubagentSummaryLines() {
  const profiles = listSubAgentProfiles();
  if (profiles.length === 0) return "";
  const lines = ["## Available sub-agents (via spawn_sub_agent)"];
  for (const p of profiles) {
    lines.push(`- **${p.name}**: ${p.shortDescription}`);
  }
  return lines.join("\n");
}

export const _deps = { _registry, _builtinProfiles };
