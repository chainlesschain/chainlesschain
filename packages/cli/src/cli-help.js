/**
 * Phase-0 help rendering.
 *
 * This module deliberately depends only on the generated command manifest. It
 * must stay safe to import before Commander and every command registrar so
 * `cc --help` does not pay the full command graph's startup cost.
 */

export const CORE_COMMAND_GROUPS = Object.freeze([
  Object.freeze({
    label: "Code",
    commands: Object.freeze(["agent", "session", "skill"]),
  }),
  Object.freeze({
    label: "Integrations",
    commands: Object.freeze(["mcp", "plugin"]),
  }),
  Object.freeze({
    label: "Configuration",
    commands: Object.freeze(["config", "auth", "doctor", "status", "update"]),
  }),
]);

const CORE_COMMAND_NAMES = new Set(
  CORE_COMMAND_GROUPS.flatMap((group) => group.commands),
);
const CORE_CATEGORY_BY_COMMAND = new Map(
  CORE_COMMAND_GROUPS.flatMap((group) =>
    group.commands.map((command) => [command, group.label.toLowerCase()]),
  ),
);

function normalizeEntry(entry) {
  return {
    name: entry.name,
    aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
    summary: entry.summary || "",
    category: CORE_CATEGORY_BY_COMMAND.get(entry.name) || "compatibility",
    visibility: CORE_COMMAND_NAMES.has(entry.name) ? "core" : "extended",
  };
}

export function listVisibleCommands(manifest, { all = false } = {}) {
  const commands = Array.isArray(manifest?.commands) ? manifest.commands : [];
  return commands
    .filter((entry) => all || CORE_COMMAND_NAMES.has(entry.name))
    .map(normalizeEntry)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function commandLabel(entry) {
  const aliases = entry.aliases.length ? ` (${entry.aliases.join(", ")})` : "";
  return `${entry.name}${aliases}`;
}

function renderCommandLines(entries, indent = "  ") {
  const width = Math.max(
    0,
    ...entries.map((entry) => commandLabel(entry).length),
  );
  return entries.map((entry) => {
    const label = commandLabel(entry).padEnd(width);
    return `${indent}${label}  ${entry.summary}`.trimEnd();
  });
}

export function buildHelpDocument(manifest, { all = false } = {}) {
  return {
    schema: "chainlesschain.help.v1",
    scope: all ? "all" : "core",
    defaultCommand: "agent",
    commandCount: listVisibleCommands(manifest, { all }).length,
    commands: listVisibleCommands(manifest, { all }),
  };
}

export function formatRootHelp(manifest, { all = false } = {}) {
  const lines = [
    "Usage: cc [global options] [command]",
    "",
    "Start ChainlessChain's coding agent by running cc in a terminal.",
    "Pipe a prompt to cc for a non-interactive agent turn.",
    "",
  ];

  if (all) {
    const commands = listVisibleCommands(manifest, { all: true });
    lines.push(`All compatibility commands (${commands.length}):`);
    lines.push(...renderCommandLines(commands));
  } else {
    lines.push("Core commands:");
    for (const group of CORE_COMMAND_GROUPS) {
      const entries = group.commands
        .map((name) => manifest.commands.find((entry) => entry.name === name))
        .filter(Boolean)
        .map(normalizeEntry);
      if (!entries.length) continue;
      lines.push(`  ${group.label}:`);
      lines.push(...renderCommandLines(entries, "    "));
    }
  }

  lines.push(
    "",
    "Global options:",
    "  -v, --version                 Show the CLI version",
    "  -h, --help                    Show this help",
    "      --verbose                 Add diagnostics on stderr",
    "      --quiet                   Suppress non-error human output",
    "      --jsii-runtime <runtime>  JSII runtime: native | quickjs",
    "      --otlp-endpoint <url>     Export telemetry to an OTLP collector",
    "",
  );

  if (all) {
    lines.push("Run `cc help <command>` for command-specific help.");
  } else {
    lines.push("Run `cc help --all` for every compatibility command.");
    lines.push("Run `cc help <command>` for command-specific help.");
  }
  return `${lines.join("\n")}\n`;
}
