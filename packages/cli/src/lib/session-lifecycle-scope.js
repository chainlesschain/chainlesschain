/**
 * Trusted storage scope for durable live-session sidecars.
 *
 * The session-core parked store, session message fabric, and workbench
 * authority used to select only `getHomeDir()`.  That is correct for native
 * and legacy CLI launches, but it lets two Claude-compatible project buckets
 * under one config root share a same-id sidecar.  This module is deliberately
 * narrow: it derives storage only from the validated launcher environment and
 * current working directory.  RPC payloads, settings values, and caller
 * supplied paths are never part of the scope decision.
 */

import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import {
  ensureClaudeProjectStorageTree,
  getClaudeProjectStorageDir,
  resolveConfigDataRoot,
} from "./paths.js";

const issuedScopes = new WeakSet();

function lifecycleScopeError(
  message,
  code = "CC_SESSION_LIFECYCLE_SCOPE_UNSAFE",
) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function trustedLaunchEnvironment(options) {
  if (options.launchEnv === undefined || options.launchEnv === null) {
    return process.env;
  }
  if (
    !options.launchEnv ||
    typeof options.launchEnv !== "object" ||
    Array.isArray(options.launchEnv)
  ) {
    throw lifecycleScopeError(
      "Lifecycle launch environment must be an object captured at process startup",
    );
  }
  return options.launchEnv;
}

function trustedCwd(options) {
  if (options.cwd === undefined || options.cwd === null) return process.cwd();
  if (typeof options.cwd !== "string" || !options.cwd.trim()) {
    throw lifecycleScopeError(
      "Lifecycle working directory must be a non-empty trusted path",
    );
  }
  return options.cwd;
}

function opaqueProjectScopeKey(projectStorageDir) {
  const normalized =
    process.platform === "win32"
      ? resolve(projectStorageDir).toLowerCase()
      : resolve(projectStorageDir);
  return `claude-project:${createHash("sha256")
    .update(normalized, "utf8")
    .digest("hex")}`;
}

function issue(scope) {
  const frozen = Object.freeze(scope);
  issuedScopes.add(frozen);
  return frozen;
}

/**
 * Resolve the only valid lifecycle storage scope for this process boundary.
 *
 * `launchEnv` is an internal launch-time snapshot seam used by the agent REPL
 * and tests.  It is intentionally not a general settings/RPC option: callers
 * cannot provide a project path, a scope id, or a durable file path here.
 */
export function resolveTrustedSessionLifecycleScope(options = {}) {
  const launchEnv = trustedLaunchEnvironment(options);
  const cwd = trustedCwd(options);
  const config = resolveConfigDataRoot({ env: launchEnv, cwd });
  const projectStorageDir =
    config.source === "claude"
      ? getClaudeProjectStorageDir({ env: launchEnv, cwd })
      : null;

  if (!projectStorageDir) {
    return issue({
      kind: "legacy",
      key: "legacy",
      configRoot: config.path,
      projectStorageDir: null,
      parkedSessionsPath: join(config.path, "parked-sessions.json"),
      messageFabricStatePath: join(
        config.path,
        "session-message-fabric",
        "state.json",
      ),
      workbenchStatePath: join(config.path, "session-workbench.json"),
    });
  }

  const projectDir = resolve(projectStorageDir);
  return issue({
    kind: "project",
    key: opaqueProjectScopeKey(projectDir),
    configRoot: config.path,
    projectStorageDir: projectDir,
    parkedSessionsPath: join(projectDir, "parked-sessions.json"),
    messageFabricStatePath: join(
      projectDir,
      "session-message-fabric",
      "state.json",
    ),
    workbenchStatePath: join(projectDir, "session-workbench.json"),
  });
}

/**
 * Establish the owner-only project tree before a default lifecycle sidecar is
 * read or written.  Only scope objects issued by the resolver are accepted so
 * an embedding/RPC caller cannot redirect a durable state file with a forged
 * project directory.
 */
export function ensureTrustedSessionLifecycleScope(scope, options = {}) {
  if (!issuedScopes.has(scope)) {
    throw lifecycleScopeError(
      "Lifecycle storage scope was not issued by the trusted resolver",
    );
  }
  if (scope.kind !== "project") return scope;

  const extraDirectories = Array.isArray(options.extraDirectories)
    ? options.extraDirectories.map((entry) => resolve(entry))
    : [];
  ensureClaudeProjectStorageTree(scope.configRoot, scope.projectStorageDir, {
    extraDirectories,
  });
  return scope;
}

/** Convenience helper for the default message-fabric state directory. */
export function sessionLifecycleFabricDirectory(scope) {
  if (!issuedScopes.has(scope)) {
    throw lifecycleScopeError(
      "Lifecycle storage scope was not issued by the trusted resolver",
    );
  }
  return dirname(scope.messageFabricStatePath);
}
