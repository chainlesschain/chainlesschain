"use strict";

/**
 * Production ProcessExecutionBroker adapter for reviewed bundled Skills.
 */

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const {
  execFileSyncWithDesktopBroker,
} = require("../../../process/desktop-process-broker");
const {
  BUNDLED_SKILL_PROCESS_POLICIES,
  createBundledSkillProcessBroker,
} = require("./bundled-skill-process-broker");

const MINIMAL_ENVIRONMENT_KEYS = Object.freeze([
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "HOME",
  "USERPROFILE",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
]);

function authorityError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isWithinRoot(candidate, root) {
  const relative = nodePath.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${nodePath.sep}`) &&
      relative !== ".." &&
      !nodePath.isAbsolute(relative))
  );
}

function canonicalDirectory(directory, code) {
  if (typeof directory !== "string" || !directory.trim()) {
    throw authorityError(code, "A configured process directory is required");
  }
  let canonical;
  try {
    canonical = nodeFs.realpathSync(nodePath.resolve(directory));
  } catch {
    throw authorityError(
      code,
      "The configured process directory is unavailable",
    );
  }
  if (!nodeFs.statSync(canonical).isDirectory()) {
    throw authorityError(
      code,
      "The configured process path is not a directory",
    );
  }
  return canonical;
}

function minimalEnvironment(source = process.env) {
  const result = {};
  for (const key of MINIMAL_ENVIRONMENT_KEYS) {
    if (typeof source[key] === "string") {
      result[key] = source[key];
    }
  }
  return Object.freeze(result);
}

function createDesktopProcessExecutionAdapter(options = {}) {
  const execute =
    options.execFileSyncWithDesktopBroker || execFileSyncWithDesktopBroker;
  const baseEnvironment = minimalEnvironment(options.runtimeEnvironment);
  return (request) =>
    execute(request.file, [...request.args], {
      cwd: request.cwd,
      timeout: request.timeout,
      encoding: request.encoding,
      maxBuffer: request.maxBuffer,
      windowsHide: true,
      shell: false,
      env: request.env ? { ...request.env } : { ...baseEnvironment },
      ...(request.input !== undefined ? { input: request.input } : {}),
      origin: `skill:${request.skillId}`,
      provenance: {
        pluginId: `bundled-skill:${request.skillId}`,
      },
    });
}

function createBundledSkillProcessAuthorityFactory(options = {}) {
  const workspaceResolver =
    typeof options.getWorkspacePath === "function"
      ? options.getWorkspacePath
      : () => options.workspacePath;
  const entrypointResolver = options.entrypointResolver || (() => []);
  const invocationResolver = options.invocationResolver || (() => []);
  const executeFileSync =
    options.executeFileSync || createDesktopProcessExecutionAdapter(options);

  return async function createProcessAuthority(request = {}) {
    const skillId = String(request.skillId || "").trim();
    if (!BUNDLED_SKILL_PROCESS_POLICIES[skillId]) {
      throw authorityError(
        "CC_BUNDLED_SKILL_PROCESS_POLICY_REQUIRED",
        `No reviewed process policy exists for ${skillId || "unknown"}`,
      );
    }
    if (
      request.executionDecision?.approved !== true ||
      request.executionDecision?.policyAuthorized !== true
    ) {
      throw authorityError(
        "CC_BUNDLED_SKILL_PROCESS_APPROVAL_REQUIRED",
        `An approved host execution decision is required for ${skillId}`,
      );
    }

    const workspaceRoot = canonicalDirectory(
      workspaceResolver(),
      "CC_BUNDLED_SKILL_PROCESS_WORKSPACE_REQUIRED",
    );
    const requestedCwd =
      request.context?.projectRoot ||
      request.context?.workspaceRoot ||
      request.context?.workspacePath ||
      workspaceRoot;
    const cwd = canonicalDirectory(
      requestedCwd,
      "CC_BUNDLED_SKILL_PROCESS_CWD_INVALID",
    );
    if (!isWithinRoot(cwd, workspaceRoot)) {
      throw authorityError(
        "CC_BUNDLED_SKILL_PROCESS_CWD_DENIED",
        "The requested Skill working directory is outside the configured workspace",
      );
    }

    const resolvedEntrypoints = entrypointResolver({
      skillId,
      task: request.task,
      workspaceRoot,
      cwd,
    });
    const resolvedInvocations = invocationResolver({
      skillId,
      task: request.task,
      workspaceRoot,
      cwd,
    });
    const allowedEntrypoints = Array.isArray(resolvedEntrypoints)
      ? resolvedEntrypoints
      : [];
    const approvedInvocations = Array.isArray(resolvedInvocations)
      ? resolvedInvocations
      : [];
    const processBroker = createBundledSkillProcessBroker(
      {
        skillId,
        authorityId: request.executionDecision.authorityId,
        allowedRoots: [workspaceRoot],
        allowedEntrypoints,
        approvedInvocations,
      },
      {
        executeFileSync,
        auditSink: options.auditSink,
      },
    );

    const cliEntrypoint =
      skillId === "skill-creator" && allowedEntrypoints.length > 0
        ? allowedEntrypoints[0]
        : null;
    return Object.freeze({ processBroker, workspaceRoot: cwd, cliEntrypoint });
  };
}

module.exports = {
  createBundledSkillProcessAuthorityFactory,
  createDesktopProcessExecutionAdapter,
  minimalEnvironment,
};
