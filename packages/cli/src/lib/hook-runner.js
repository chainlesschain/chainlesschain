import runner from "./hook-runner.cjs";
import executionBroker from "./process-execution-broker/index.js";

const brokerRunner = executionBroker.spawn.bind(executionBroker);
const brokerSyncRunner = executionBroker.spawnSync.bind(executionBroker);

export const _processDeps = {
  run: brokerRunner,
  runSync: brokerSyncRunner,
};

function normalizeInvocation(argsOrOptions, maybeOptions) {
  return Array.isArray(argsOrOptions)
    ? { args: argsOrOptions, options: maybeOptions || {} }
    : { args: [], options: argsOrOptions || {} };
}

function runHookProcess(file, argsOrOptions, maybeOptions) {
  const { args, options } = normalizeInvocation(argsOrOptions, maybeOptions);
  return _processDeps.run(file, args, {
    ...options,
    origin: options.origin || "hook",
    policy: "allow",
    scope: "hook",
  });
}

function runHookProcessSync(file, argsOrOptions, maybeOptions) {
  const { args, options } = normalizeInvocation(argsOrOptions, maybeOptions);
  return _processDeps.runSync(file, args, {
    ...options,
    origin: options.origin || "hook",
    policy: "allow",
    scope: "hook",
  });
}

runner._deps.run = runHookProcess;
runner._deps.runSync = runHookProcessSync;

export const {
  runCommandHook,
  runCommandHookAsync,
  runHooks,
  runHooksParallel,
  interpretHookOutcome,
  tryParseDecision,
  HOOK_DECISIONS,
  HOOK_PAYLOAD_SCHEMA_VERSION,
  hookBreakerConfig,
  _resetHookBreaker,
  _deps,
} = runner;

export default runner;
