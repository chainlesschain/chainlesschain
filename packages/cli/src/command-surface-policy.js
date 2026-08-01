/**
 * Stable command-surface policy used by the manifest generator.
 *
 * Keep this module dependency-free: phase-0 help and manifest generation both
 * consume it before the full Commander command graph is loaded.
 */

export const COMMAND_MANIFEST_SCHEMA = "chainlesschain.command-manifest.v2";
export const COMMAND_SURFACE_SCHEMA = "chainlesschain.command-surface.v1";
export const DEFAULT_COMMAND = "agent";

export const CORE_COMMAND_GROUPS = Object.freeze([
  Object.freeze({
    id: "code",
    label: "Code",
    commands: Object.freeze(["agent", "session", "skill"]),
  }),
  Object.freeze({
    id: "integrations",
    label: "Integrations",
    commands: Object.freeze(["mcp", "plugin"]),
  }),
  Object.freeze({
    id: "configuration",
    label: "Configuration",
    commands: Object.freeze(["config", "auth", "doctor", "status", "update"]),
  }),
]);

const CORE_GROUP_BY_COMMAND = new Map(
  CORE_COMMAND_GROUPS.flatMap((group) =>
    group.commands.map((command) => [command, group]),
  ),
);

export function describeCommandSurface(commandName) {
  const group = CORE_GROUP_BY_COMMAND.get(commandName);
  return {
    stability: group ? "stable" : "compatibility",
    category: group?.id || "compatibility",
    visibility: group ? "core" : "extended",
    replacement: null,
  };
}

export function buildCommandSurfaceDescriptor() {
  return {
    schema: COMMAND_SURFACE_SCHEMA,
    defaultCommand: DEFAULT_COMMAND,
    coreGroups: CORE_COMMAND_GROUPS.map((group) => ({
      id: group.id,
      label: group.label,
      commands: [...group.commands],
    })),
  };
}
