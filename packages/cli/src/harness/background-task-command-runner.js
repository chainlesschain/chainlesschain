import fs from "node:fs";
import path from "node:path";
import executionBroker from "../lib/process-execution-broker/index.js";

const SUPPORTED_BOUNDARIES = new Set(["filesystem", "network"]);

export const _backgroundTaskCommandDeps = {
  execSync: (...args) => executionBroker.execSync(...args),
  execFile: (...args) => executionBroker.execFile(...args),
  issueLinuxWorkspaceSandboxExecutionContract: (...args) =>
    executionBroker.issueLinuxWorkspaceSandboxExecutionContract(...args),
  platform: process.platform,
};

function sandboxError(code, reason, message, requiredBoundaries = []) {
  const error = new Error(message);
  error.code = code;
  error.sandboxReason = reason;
  error.sandboxFailClosed = true;
  error.requiredBoundaries = [...requiredBoundaries];
  error.actualGuarantees = [];
  error.missingBoundaries = [...requiredBoundaries];
  error.sandboxBackend = null;
  error.sandboxCandidateBackend =
    _backgroundTaskCommandDeps.platform === "linux"
      ? "linux-bwrap-workspace"
      : null;
  return error;
}

function normalizeRequiredBoundaries(raw) {
  if (raw === undefined || raw === null || raw === "") return [];
  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (cause) {
    const error = sandboxError(
      "ERR_BACKGROUND_TASK_SANDBOX_ENVELOPE_INVALID",
      "background_sandbox_envelope_invalid",
      "Background task sandbox boundary envelope is invalid.",
    );
    error.cause = cause;
    throw error;
  }
  if (!Array.isArray(parsed)) {
    throw sandboxError(
      "ERR_BACKGROUND_TASK_SANDBOX_ENVELOPE_INVALID",
      "background_sandbox_envelope_invalid",
      "Background task sandbox boundaries must use filesystem/network.",
    );
  }
  if (parsed.length === 0) return [];
  if (
    parsed.some(
      (boundary) =>
        typeof boundary !== "string" || !SUPPORTED_BOUNDARIES.has(boundary),
    )
  ) {
    throw sandboxError(
      "ERR_BACKGROUND_TASK_SANDBOX_ENVELOPE_INVALID",
      "background_sandbox_envelope_invalid",
      "Background task sandbox boundaries must use filesystem/network.",
    );
  }
  return [...new Set(parsed)].sort();
}

function canonicalBinding(workspaceCwd, executionCwd, boundaries) {
  try {
    if (
      typeof workspaceCwd !== "string" ||
      !path.isAbsolute(workspaceCwd) ||
      typeof executionCwd !== "string" ||
      !path.isAbsolute(executionCwd)
    ) {
      throw new Error("sandbox paths must be absolute");
    }
    const canonicalRoot = fs.realpathSync.native(workspaceCwd);
    const canonicalCwd = fs.realpathSync.native(executionCwd);
    if (
      canonicalRoot !== workspaceCwd ||
      canonicalCwd !== executionCwd ||
      !fs.statSync(canonicalRoot).isDirectory() ||
      !fs.statSync(canonicalCwd).isDirectory()
    ) {
      throw new Error("sandbox paths must be canonical directories");
    }
    const relative = path.relative(canonicalRoot, canonicalCwd);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error("execution cwd escapes workspace");
    }
    return { workspaceRoot: canonicalRoot, workingDirectory: canonicalCwd };
  } catch (cause) {
    const error = sandboxError(
      "ERR_BACKGROUND_TASK_SANDBOX_BINDING_INVALID",
      "background_sandbox_binding_invalid",
      "Background task sandbox workspace/cwd binding is invalid.",
      boundaries,
    );
    error.cause = cause;
    throw error;
  }
}

function explicitShellInvocation(command) {
  if (_backgroundTaskCommandDeps.platform === "win32") {
    return {
      file: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", command],
    };
  }
  return { file: "/bin/sh", args: ["-c", command] };
}

export function executeBackgroundTaskCommand({
  command,
  cwd,
  type,
  workspaceCwd = "",
  requiredBoundaries = [],
}) {
  if (
    typeof command !== "string" ||
    command.length === 0 ||
    command.includes("\0")
  ) {
    throw new TypeError("background task command must be non-empty");
  }
  const boundaries = normalizeRequiredBoundaries(requiredBoundaries);
  const hasSandboxEnvelope =
    typeof workspaceCwd === "string" && workspaceCwd.length > 0;
  if (hasSandboxEnvelope !== boundaries.length > 0) {
    throw sandboxError(
      "ERR_BACKGROUND_TASK_SANDBOX_ENVELOPE_INVALID",
      "background_sandbox_envelope_invalid",
      "Background task sandbox root and boundaries must be supplied together.",
      boundaries,
    );
  }
  if (
    boundaries.length > 0 &&
    _backgroundTaskCommandDeps.platform !== "linux"
  ) {
    throw sandboxError(
      "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      "background_platform_backend_unavailable",
      "Background task strong sandbox execution is only available on Linux.",
      boundaries,
    );
  }

  const commonOptions = {
    cwd: cwd || process.cwd(),
    encoding: "utf-8",
    timeout: 300000,
    maxBuffer: 10 * 1024 * 1024,
    origin: `background-task:command:${type || "unknown"}`,
    policy: "allow",
    scope: "background-task",
  };
  if (boundaries.length === 0) {
    return _backgroundTaskCommandDeps.execSync(command, {
      ...commonOptions,
      shell: true,
    });
  }

  const binding = canonicalBinding(workspaceCwd, commonOptions.cwd, boundaries);
  const sandboxPolicy = Object.freeze({
    requiredBoundaries: Object.freeze(boundaries),
  });
  const invocation = explicitShellInvocation(command);
  const spawnOptions = {
    ...commonOptions,
    cwd: binding.workingDirectory,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    sandboxPolicy,
  };
  let sandboxExecutionContract;
  try {
    sandboxExecutionContract =
      _backgroundTaskCommandDeps.issueLinuxWorkspaceSandboxExecutionContract(
        invocation.file,
        invocation.args,
        spawnOptions,
        binding.workspaceRoot,
        { sync: false },
      );
  } catch (cause) {
    const error = sandboxError(
      "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      "background_linux_execution_contract_unavailable",
      "Background task could not bind its Linux sandbox contract.",
      boundaries,
    );
    error.cause = cause;
    throw error;
  }
  if (
    _backgroundTaskCommandDeps.platform === "linux" &&
    !sandboxExecutionContract
  ) {
    throw sandboxError(
      "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      "background_linux_execution_contract_unavailable",
      "Background task could not bind its Linux sandbox contract.",
      boundaries,
    );
  }
  return new Promise((resolve, reject) => {
    const options = {
      ...spawnOptions,
      ...(sandboxExecutionContract ? { sandboxExecutionContract } : {}),
    };
    try {
      _backgroundTaskCommandDeps.execFile(
        invocation.file,
        invocation.args,
        options,
        (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout);
        },
      );
    } catch (error) {
      reject(error);
    }
  });
}
