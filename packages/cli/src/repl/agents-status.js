/**
 * `/agents` REPL command (Claude-Code parity) — manage user-defined sub-agent
 * DEFINITIONS (`.chainlesschain/agents/*.md` / `.claude/agents/*.md`) from
 * inside an interactive session: list / show / new. Mirrors the `cc agents`
 * CLI; the discovery + scaffold live in lib/agents.js (single source of truth),
 * this module is the pure arg-parse + render layer. Distinct from `/sub-agents`
 * which shows running instances.
 */

function stripQuotes(s) {
  const t = String(s || "").trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * Parse a `/agents …` line.
 * Forms: `/agents [list]`, `/agents show <name>`, `/agents <name>` (= show),
 *        `/agents new <name> [--tools a,b] [--claude|--personal] [--description <text>]`,
 *        `/agents help`.
 * @returns {{action:string, name?:string|null, description?:string|null,
 *            tools?:string|null, location?:string}}
 */
export function parseAgentsCommand(line) {
  let rest = String(line || "")
    .trim()
    .replace(/^\/agents\b/, "")
    .trim();

  let location = "project";
  if (/(^|\s)--personal(\s|$)/.test(rest)) {
    location = "personal";
    rest = rest.replace(/(^|\s)--personal(\s|$)/, " ");
  }
  if (/(^|\s)--claude(\s|$)/.test(rest)) {
    if (location !== "personal") location = "claude";
    rest = rest.replace(/(^|\s)--claude(\s|$)/, " ");
  }

  let tools = null;
  const tm = rest.match(/(^|\s)--tools\s+("[^"]*"|'[^']*'|\S+)/);
  if (tm) {
    tools = stripQuotes(tm[2]);
    rest = rest.replace(tm[0], " ");
  }

  // --description takes the rest of the line (may contain spaces).
  let description = null;
  const dm = rest.match(/(^|\s)--description\s+(.*)$/);
  if (dm) {
    description = stripQuotes(dm[2].trim()) || null;
    rest = rest.slice(0, dm.index).trim();
  }

  rest = rest.replace(/\s+/g, " ").trim();
  const tokens = rest.length ? rest.split(" ") : [];
  const first = tokens[0] || "";

  if (!first || first === "list" || first === "ls") return { action: "list" };
  if (first === "help") return { action: "help" };
  if (first === "show") return { action: "show", name: tokens[1] || null };
  if (first === "new") {
    return {
      action: "new",
      name: tokens[1] || null,
      description,
      tools,
      location,
    };
  }
  // A bare token is treated as a name to show.
  return { action: "show", name: first };
}

/** Render the list of agent definitions + built-in profiles. */
export function formatAgentsList(agents, profiles) {
  const list = Array.isArray(agents) ? agents : [];
  const profs = Array.isArray(profiles) ? profiles : [];
  const lines = [
    `Agent definitions (${list.length}) — .chainlesschain/agents · .claude/agents · ~/.claude/agents:`,
  ];
  if (list.length === 0) {
    lines.push("  (none — create one with /agents new <name>)");
  } else {
    for (const a of list) {
      const tools = a.tools ? a.tools.join(",") : "(all)";
      lines.push(`  ${a.name}  [${a.scope}]  ${a.description || ""}`.trimEnd());
      lines.push(`    tools: ${tools}${a.model ? ` · model: ${a.model}` : ""}`);
    }
  }
  if (profs.length) {
    lines.push("", "Built-in profiles (spawn_sub_agent profile:):");
    for (const p of profs) {
      lines.push(`  ${p.name} — ${p.shortDescription || ""}`.trimEnd());
    }
  }
  lines.push(
    "",
    'Manage: /agents show <name> · /agents new <name> · run via `cc agents run <name> "<task>"`',
  );
  return lines.join("\n");
}

/** Render one agent definition's metadata + system prompt. */
export function formatAgentDetail(agent) {
  if (!agent) return null;
  const tools = agent.tools ? agent.tools.join(",") : "(all)";
  const lines = [
    `${agent.name}  [${agent.scope}]`,
    agent.description ? `  ${agent.description}` : null,
    `  tools: ${tools}${agent.model ? ` · model: ${agent.model}` : ""}`,
    `  file: ${agent.file}`,
    "",
    agent.systemPrompt || "(empty system prompt)",
  ].filter((l) => l != null);
  return lines.join("\n");
}
