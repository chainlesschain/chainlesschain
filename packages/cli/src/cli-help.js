/**
 * Phase-0 help rendering.
 *
 * This module deliberately depends only on the generated command manifest. It
 * must stay safe to import before Commander and every command registrar so
 * `cc --help` does not pay the full command graph's startup cost.
 */

import {
  CORE_COMMAND_GROUPS,
  DEFAULT_COMMAND,
  describeCommandSurface,
} from "./command-surface-policy.js";

export { CORE_COMMAND_GROUPS };

function commandSurface(manifest) {
  const groups = Array.isArray(manifest?.surface?.coreGroups)
    ? manifest.surface.coreGroups
    : CORE_COMMAND_GROUPS;
  return {
    defaultCommand: manifest?.surface?.defaultCommand || DEFAULT_COMMAND,
    groups,
  };
}

function normalizeEntry(entry) {
  const fallback = describeCommandSurface(entry.name);
  return {
    name: entry.name,
    aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
    summary: entry.summary || "",
    stability: entry.stability || fallback.stability,
    category: entry.category || fallback.category,
    visibility: entry.visibility || fallback.visibility,
    replacement: entry.replacement ?? fallback.replacement,
    lifecycle: entry.lifecycle || fallback.lifecycle,
  };
}

export function listCommandNamespaces(manifest) {
  const namespaces = Array.isArray(manifest?.surface?.namespaces)
    ? manifest.surface.namespaces
    : [];
  return namespaces
    .map((namespace) => ({
      name: namespace.name,
      summary: namespace.summary || "",
      visibility: namespace.visibility || "extended",
      commands: (Array.isArray(namespace.commands) ? namespace.commands : [])
        .map((name) => manifest.commands.find((entry) => entry.name === name))
        .filter(Boolean)
        .map(normalizeEntry)
        .sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function listVisibleCommands(manifest, { all = false } = {}) {
  const commands = Array.isArray(manifest?.commands) ? manifest.commands : [];
  return commands
    .map(normalizeEntry)
    .filter((entry) => all || entry.visibility === "core")
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
    const lifecycle =
      entry.lifecycle?.state === "deprecated"
        ? ` [deprecated; use cc ${entry.replacement}]`
        : "";
    return `${indent}${label}  ${entry.summary}${lifecycle}`.trimEnd();
  });
}

export function buildHelpDocument(manifest, { all = false } = {}) {
  const commands = listVisibleCommands(manifest, { all });
  return {
    schema: "chainlesschain.help.v1",
    scope: all ? "all" : "core",
    defaultCommand: commandSurface(manifest).defaultCommand,
    commandCount: commands.length,
    commands,
    namespaces: all ? listCommandNamespaces(manifest) : [],
  };
}

export function buildNamespaceHelpDocument(manifest, namespaceName) {
  const namespace = listCommandNamespaces(manifest).find(
    (candidate) => candidate.name === namespaceName,
  );
  if (!namespace) return null;
  return {
    schema: "chainlesschain.namespace-help.v1",
    name: namespace.name,
    summary: namespace.summary,
    commandCount: namespace.commands.length,
    commands: namespace.commands,
  };
}

export function formatNamespaceHelp(manifest, namespaceName) {
  const namespace = buildNamespaceHelpDocument(manifest, namespaceName);
  if (!namespace) return null;
  const lines = [
    `Usage: cc ${namespace.name} <command> [args...]`,
    "",
    namespace.summary,
    "",
    "Commands:",
    ...renderCommandLines(namespace.commands),
    "",
    `Run \`cc ${namespace.name} <command> --help\` for command-specific help.`,
  ];
  return `${lines.join("\n")}\n`;
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
    for (const namespace of listCommandNamespaces(manifest)) {
      lines.push(
        "",
        `Compatibility namespace: ${namespace.name}`,
        `  ${namespace.summary}`,
      );
    }
  } else {
    lines.push("Core commands:");
    for (const group of commandSurface(manifest).groups) {
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
