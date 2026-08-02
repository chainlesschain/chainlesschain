/**
 * Stable command-surface policy used by the manifest generator.
 *
 * Keep this module dependency-free: phase-0 help and manifest generation both
 * consume it before the full Commander command graph is loaded.
 */

export const COMMAND_MANIFEST_SCHEMA = "chainlesschain.command-manifest.v3";
export const COMMAND_SURFACE_SCHEMA = "chainlesschain.command-surface.v2";
export const COMMAND_LIFECYCLE_SCHEMA = "chainlesschain.command-lifecycle.v1";
export const DEFAULT_COMMAND = "agent";

export const TOP_LEVEL_GROWTH_POLICY = Object.freeze({
  baselineCommandCount: 175,
  maximumNetGrowth: 0,
});

export const COMMAND_NAMESPACES = Object.freeze([
  Object.freeze({
    name: "lab",
    summary: "Compatibility namespace for long-tail and experimental commands",
    visibility: "extended",
  }),
]);

const MINIMUM_COMPATIBILITY_RELEASE_CYCLES = 2;

const COMMAND_MIGRATIONS = Object.freeze({
  dao: Object.freeze({
    namespace: "lab",
    deprecatedSince: "0.162.189",
    removalNotBefore: "0.164.0",
  }),
  evomap: Object.freeze({
    namespace: "lab",
    deprecatedSince: "0.162.189",
    removalNotBefore: "0.164.0",
  }),
});

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

function parseReleaseVersion(value, label) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) throw new Error(`${label} must be an exact semver release`);
  return match.slice(1).map(Number);
}

function releaseCycleDistance(from, to) {
  const [fromMajor, fromMinor] = parseReleaseVersion(from, "deprecatedSince");
  const [toMajor, toMinor] = parseReleaseVersion(to, "removalNotBefore");
  if (fromMajor !== toMajor) {
    throw new Error(
      "command migration windows may not cross a major release boundary",
    );
  }
  return toMinor - fromMinor;
}

function lifecycleForCommand(commandName) {
  const migration = COMMAND_MIGRATIONS[commandName];
  if (!migration) return Object.freeze({ state: "active" });

  const releaseCycles = releaseCycleDistance(
    migration.deprecatedSince,
    migration.removalNotBefore,
  );
  if (releaseCycles < MINIMUM_COMPATIBILITY_RELEASE_CYCLES) {
    throw new Error(
      `${commandName} must remain compatible for at least ${MINIMUM_COMPATIBILITY_RELEASE_CYCLES} release cycles`,
    );
  }

  return Object.freeze({
    state: "deprecated",
    deprecatedSince: migration.deprecatedSince,
    removalNotBefore: migration.removalNotBefore,
    minimumReleaseCycles: MINIMUM_COMPATIBILITY_RELEASE_CYCLES,
    releaseCycle: "minor",
  });
}

export function validateCommandSurface(entries) {
  if (!Array.isArray(entries)) {
    throw new TypeError("command surface entries must be an array");
  }
  const netGrowth =
    entries.length - TOP_LEVEL_GROWTH_POLICY.baselineCommandCount;
  if (netGrowth > TOP_LEVEL_GROWTH_POLICY.maximumNetGrowth) {
    throw new Error(
      `Top-level command net growth is ${netGrowth}; maximum is ${TOP_LEVEL_GROWTH_POLICY.maximumNetGrowth}`,
    );
  }

  const names = new Set(entries.map((entry) => entry.name));
  const topLevelTokens = new Set(
    entries.flatMap((entry) => [
      entry.name,
      ...(Array.isArray(entry.aliases) ? entry.aliases : []),
    ]),
  );
  for (const namespace of COMMAND_NAMESPACES) {
    if (topLevelTokens.has(namespace.name)) {
      throw new Error(
        `Virtual command namespace '${namespace.name}' collides with a registered top-level command or alias`,
      );
    }
  }
  for (const commandName of Object.keys(COMMAND_MIGRATIONS)) {
    if (!names.has(commandName)) {
      throw new Error(`Migrated command is not registered: ${commandName}`);
    }
  }

  const deprecatedCompatibilityCount = entries.filter(
    (entry) => entry.lifecycle?.state === "deprecated",
  ).length;
  const activeRegisteredCommandCount =
    entries.length - deprecatedCompatibilityCount;
  return {
    ...TOP_LEVEL_GROWTH_POLICY,
    registeredCommandCount: entries.length,
    activeRegisteredCommandCount,
    virtualNamespaceCount: COMMAND_NAMESPACES.length,
    deprecatedCompatibilityCount,
    recommendedTopLevelCommandCount:
      activeRegisteredCommandCount + COMMAND_NAMESPACES.length,
    netGrowth,
  };
}

export function describeCommandSurface(commandName) {
  const group = CORE_GROUP_BY_COMMAND.get(commandName);
  const migration = COMMAND_MIGRATIONS[commandName];
  return {
    stability: group ? "stable" : "compatibility",
    category: group?.id || "compatibility",
    visibility: group ? "core" : "extended",
    replacement: migration ? `${migration.namespace} ${commandName}` : null,
    lifecycle: lifecycleForCommand(commandName),
  };
}

export function buildCommandSurfaceDescriptor(entries = []) {
  const migrationCommands = Object.entries(COMMAND_MIGRATIONS).map(
    ([command, migration]) => ({
      command,
      replacement: `${migration.namespace} ${command}`,
    }),
  );
  return {
    schema: COMMAND_SURFACE_SCHEMA,
    defaultCommand: DEFAULT_COMMAND,
    lifecyclePolicy: {
      schema: COMMAND_LIFECYCLE_SCHEMA,
      minimumCompatibilityReleaseCycles: MINIMUM_COMPATIBILITY_RELEASE_CYCLES,
      releaseCycle: "minor",
    },
    topLevelGrowth: validateCommandSurface(entries),
    namespaces: COMMAND_NAMESPACES.map((namespace) => ({
      ...namespace,
      commands: migrationCommands
        .filter(({ replacement }) =>
          replacement.startsWith(`${namespace.name} `),
        )
        .map(({ command }) => command)
        .sort(),
    })),
    coreGroups: CORE_COMMAND_GROUPS.map((group) => ({
      id: group.id,
      label: group.label,
      commands: [...group.commands],
    })),
  };
}
