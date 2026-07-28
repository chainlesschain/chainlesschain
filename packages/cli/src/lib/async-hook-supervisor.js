import supervisor from "./async-hook-supervisor.cjs";
import executionBroker from "./process-execution-broker/index.js";
import hookShellCommand from "./hook-shell-command.cjs";

const {
  issueTrustedHookSandboxContract,
  requireTrustedHookRoot,
  requiresExplicitHookShell,
  sandboxBoundaryError,
} = hookShellCommand;

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

function runAsyncHook(command, argsOrOptions = {}, maybeOptions) {
  const { args, options } = normalizeInvocation(argsOrOptions, maybeOptions);
  const callerOptions = { ...options };
  delete callerOptions.sandboxExecutionContract;
  const processOptions = {
    ...callerOptions,
    origin: callerOptions.origin || "async-hook:command",
    policy: "allow",
    scope: "async-hook",
  };
  const requiresContract = requiresExplicitHookShell(
    processOptions.sandboxPolicy,
  );
  const trustedRoot = requiresContract
    ? requireTrustedHookRoot(processOptions.cwd)
    : null;
  const sandboxExecutionContract = requiresContract
    ? issueTrustedHookSandboxContract({
        issuer: executionBroker.issueLinuxWorkspaceSandboxExecutionContract,
        receiver: executionBroker,
        file: command,
        args,
        options: processOptions,
        trustedRoot,
      })
    : null;
  if (
    process.platform === "linux" &&
    requiresContract &&
    !sandboxExecutionContract
  ) {
    throw sandboxBoundaryError(
      "trusted Linux async-hook sandbox contract could not be issued",
    );
  }
  return _processDeps.run(command, args, {
    ...processOptions,
    ...(sandboxExecutionContract ? { sandboxExecutionContract } : {}),
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
