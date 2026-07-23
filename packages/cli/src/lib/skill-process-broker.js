import executionBroker from "./process-execution-broker/index.js";

const defaultRunSync = executionBroker.spawnSync.bind(executionBroker);
const defaultRunFileSync = executionBroker.execFileSync.bind(executionBroker);
const defaultRun = executionBroker.spawn.bind(executionBroker);

function skillIdentity(skill = {}) {
  const identity = String(
    skill.id || skill.name || skill.skillName || "unknown",
  )
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, "-")
    .slice(0, 96);
  return identity || "unknown";
}

function declaresShellExecution(skill = {}) {
  return (
    Array.isArray(skill.capabilities) &&
    skill.capabilities.some(
      (capability) => String(capability).toLowerCase() === "shell-exec",
    )
  );
}

/**
 * Create the narrow process facade exposed to a skill handler.
 *
 * The host, not the handler, owns provenance and permission metadata. Generated
 * handlers can choose argv and ordinary process options, but cannot relabel the
 * execution or bypass the Broker boundary.
 */
export function createSkillProcessBroker(
  skill,
  {
    run = defaultRun,
    runSync = defaultRunSync,
    runFileSync = defaultRunFileSync,
  } = {},
) {
  if (!declaresShellExecution(skill)) return null;

  const identity = skillIdentity(skill);
  const metadata = Object.freeze({
    origin: `skill:${identity}`,
    policy: "allow",
    scope: "skill",
    pluginId: skill?.pluginId || skill?.plugin?.id || null,
    pluginVersion: skill?.pluginVersion || skill?.plugin?.version || null,
    pluginSource: skill?.pluginSource || skill?.plugin?.source || null,
  });

  return Object.freeze({
    run(file, args = [], options = {}) {
      return run(file, args, {
        ...options,
        ...metadata,
        shell: false,
      });
    },

    runSync(file, args = [], options = {}) {
      return runSync(file, args, {
        ...options,
        ...metadata,
      });
    },

    runFileSync(file, args = [], options = {}) {
      return runFileSync(file, args, {
        ...options,
        ...metadata,
        shell: false,
      });
    },
  });
}

export const _skillProcessDefaults = {
  run: defaultRun,
  runSync: defaultRunSync,
  runFileSync: defaultRunFileSync,
};

export { declaresShellExecution as skillDeclaresShellExecution };
