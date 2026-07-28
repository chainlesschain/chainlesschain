import runner from "./hook-runner.cjs";
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

function runHookProcess(file, argsOrOptions, maybeOptions) {
  const { args, options } = normalizeInvocation(argsOrOptions, maybeOptions);
  const callerOptions = { ...options };
  delete callerOptions.sandboxExecutionContract;
  const processOptions = {
    ...callerOptions,
    origin: callerOptions.origin || "hook",
    policy: "allow",
    scope: "hook",
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
        file,
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
      "trusted Linux hook sandbox contract could not be issued",
    );
  }
  return _processDeps.run(file, args, {
    ...processOptions,
    ...(sandboxExecutionContract ? { sandboxExecutionContract } : {}),
  });
}

function runHookProcessSync(file, argsOrOptions, maybeOptions) {
  const { args, options } = normalizeInvocation(argsOrOptions, maybeOptions);
  const callerOptions = { ...options };
  delete callerOptions.sandboxExecutionContract;
  const processOptions = {
    ...callerOptions,
    origin: callerOptions.origin || "hook",
    policy: "allow",
    scope: "hook",
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
        file,
        args,
        options: processOptions,
        trustedRoot,
        sync: true,
      })
    : null;
  if (
    process.platform === "linux" &&
    requiresContract &&
    !sandboxExecutionContract
  ) {
    throw sandboxBoundaryError(
      "trusted Linux hook sandbox contract could not be issued",
    );
  }
  return _processDeps.runSync(file, args, {
    ...processOptions,
    ...(sandboxExecutionContract ? { sandboxExecutionContract } : {}),
  });
}

export function _restoreProcessRunners() {
  runner._deps.run = runHookProcess;
  runner._deps.runSync = runHookProcessSync;
}

_restoreProcessRunners();

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
  resolveHookSandboxPolicy,
  _resetHookBreaker,
  _deps,
} = runner;

export default runner;
