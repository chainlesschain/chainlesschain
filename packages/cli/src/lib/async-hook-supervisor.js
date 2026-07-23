import supervisor from "./async-hook-supervisor.cjs";
import executionBroker from "./process-execution-broker/index.js";

const brokerRunner = executionBroker.spawn.bind(executionBroker);
const brokerSyncRunner = executionBroker.spawnSync.bind(executionBroker);

export const _processDeps = {
  run: brokerRunner,
  runSync: brokerSyncRunner,
};

function runAsyncHook(command, options = {}) {
  return _processDeps.run(command, [], {
    ...options,
    origin: options.origin || "async-hook:command",
    policy: "allow",
    scope: "async-hook",
  });
}

function runAsyncHookSupervisorCommand(command, args, options = {}) {
  return _processDeps.runSync(command, args, {
    ...options,
    origin: options.origin || "async-hook:supervisor",
    policy: "allow",
    scope: "async-hook",
  });
}

export class AsyncHookSupervisor extends supervisor.AsyncHookSupervisor {
  constructor(options = {}) {
    super({
      ...options,
      run: options.run || options.spawn || runAsyncHook,
      runSync:
        options.runSync || options.spawnSync || runAsyncHookSupervisorCommand,
    });
  }
}

export const { DEFAULT_TIMEOUT_MS, DEFAULT_MAX_CONCURRENT } = supervisor;

export default {
  AsyncHookSupervisor,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_CONCURRENT,
};
