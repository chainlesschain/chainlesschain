/** OS-isolated shell execution for the coding agent. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { proxyEnv } from "./sandbox-egress-proxy.js";
import executionBroker from "./process-execution-broker/index.js";

export const DEFAULT_SANDBOX_IMAGE = "node:22-bookworm-slim";
export const AGENT_SANDBOX_MODES = Object.freeze([
  "off",
  "workspace-write",
  "strict",
]);
export const AGENT_SANDBOX_CAPABILITY_SCHEMA =
  "chainlesschain.agent-sandbox-capabilities/v1";
export const _deps = {
  spawnSync: (...args) => executionBroker.spawnSync(...args),
  host: () => ({
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
  }),
};

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.map((entry) => String(entry || "").trim()).filter(Boolean),
    ),
  ];
}

function resolvePolicyPaths(entries, cwd) {
  return stringList(entries).map((entry) => {
    if (entry.startsWith("~/")) {
      return path.resolve(
        process.env.HOME || process.env.USERPROFILE || "",
        entry.slice(2),
      );
    }
    return path.resolve(cwd, entry);
  });
}

function pathEntryExists(candidate, fsImpl) {
  try {
    fsImpl.lstatSync(candidate);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
    throw error;
  }
}

/**
 * Resolve a path for policy comparison without requiring the final target to
 * exist. Existing ancestors are resolved through symlinks/junctions before the
 * missing suffix is appended. This is important for writes: checking only the
 * lexical target lets `workspace/link/new-file` escape when `link` points
 * outside the workspace.
 */
function canonicalPolicyPath(candidate, fsImpl) {
  const absolute = path.resolve(candidate);
  let existing = absolute;
  const missing = [];

  while (!pathEntryExists(existing, fsImpl)) {
    const parent = path.dirname(existing);
    if (parent === existing) {
      throw new Error(`No existing ancestor for path: ${absolute}`);
    }
    missing.unshift(path.basename(existing));
    existing = parent;
  }

  const realpath =
    typeof fsImpl.realpathSync?.native === "function"
      ? fsImpl.realpathSync.native
      : fsImpl.realpathSync;
  if (typeof realpath !== "function") {
    throw new Error("Filesystem realpath support is unavailable");
  }
  return path.resolve(realpath(existing), ...missing);
}

function pathIsWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function normalizeWorkspaceRoots(entries, cwd) {
  const roots = Array.isArray(entries) && entries.length > 0 ? entries : [cwd];
  return stringList(roots).map((entry) => path.resolve(cwd, entry));
}

/**
 * Resolve and authorize one built-in agent file-tool path.
 *
 * The workspace roots are always allowed. A normalized sandbox policy may add
 * explicit read/write roots and may deny narrower paths. Both existing targets
 * and the nearest existing ancestor are realpath-resolved, so an in-workspace
 * symlink/junction cannot redirect a read or write outside the declared roots.
 *
 * @returns {{
 *   ok:boolean,
 *   path?:string,
 *   canonicalPath?:string,
 *   reason?:string,
 *   error?:string
 * }}
 */
export function resolveSandboxPolicyPath(
  requestedPath,
  {
    access = "read",
    cwd = process.cwd(),
    workspaceRoots = null,
    sandbox = null,
    policy = sandbox?.policy || null,
    fsImpl = null,
  } = {},
) {
  if (access !== "read" && access !== "write") {
    return {
      ok: false,
      reason: "invalid-access",
      error: `Unsupported filesystem access mode: ${access}`,
    };
  }
  if (
    typeof requestedPath !== "string" ||
    requestedPath.length === 0 ||
    requestedPath.includes("\0")
  ) {
    return {
      ok: false,
      reason: "invalid-path",
      error: "A non-empty filesystem path is required",
    };
  }

  const resolvedCwd = path.resolve(cwd);
  const resolvedPath = path.resolve(resolvedCwd, requestedPath);
  const effectiveFs = fsImpl || fs;
  const normalizedPolicy = policy || {};
  const policyAllows =
    access === "write"
      ? normalizedPolicy.allowWrite
      : normalizedPolicy.allowRead;
  const policyDenies =
    access === "write" ? normalizedPolicy.denyWrite : normalizedPolicy.denyRead;
  const allowedInputs = [
    ...normalizeWorkspaceRoots(workspaceRoots, resolvedCwd),
    ...resolvePolicyPaths(policyAllows, resolvedCwd),
  ];
  const deniedInputs = resolvePolicyPaths(policyDenies, resolvedCwd);

  try {
    const canonicalPath = canonicalPolicyPath(resolvedPath, effectiveFs);
    const allowedRoots = allowedInputs.map((root) =>
      canonicalPolicyPath(root, effectiveFs),
    );
    if (!allowedRoots.some((root) => pathIsWithin(canonicalPath, root))) {
      return {
        ok: false,
        path: resolvedPath,
        canonicalPath,
        reason: "outside-workspace",
        error: `${access} path resolves outside the allowed workspace roots`,
      };
    }

    const deniedRoots = deniedInputs.map((root) =>
      canonicalPolicyPath(root, effectiveFs),
    );
    if (deniedRoots.some((root) => pathIsWithin(canonicalPath, root))) {
      return {
        ok: false,
        path: resolvedPath,
        canonicalPath,
        reason: "denied-by-policy",
        error: `${access} path is denied by the sandbox filesystem policy`,
      };
    }

    return { ok: true, path: resolvedPath, canonicalPath };
  } catch (error) {
    return {
      ok: false,
      path: resolvedPath,
      reason: "realpath-failed",
      error: `Unable to safely resolve filesystem path: ${error.message}`,
    };
  }
}

export function normalizeSandboxPolicy(settings = {}, cwd = process.cwd()) {
  const filesystem = settings.filesystem || {};
  const network = settings.network || {};
  return {
    allowRead: resolvePolicyPaths(filesystem.allowRead, cwd),
    denyRead: resolvePolicyPaths(filesystem.denyRead, cwd),
    allowWrite: resolvePolicyPaths(filesystem.allowWrite, cwd),
    denyWrite: resolvePolicyPaths(filesystem.denyWrite, cwd),
    allowedDomains: stringList(network.allowedDomains),
    deniedDomains: stringList(network.deniedDomains),
    excludedCommands: stringList(settings.excludedCommands),
    allowUnsandboxedCommands: settings.allowUnsandboxedCommands !== false,
    failIfUnavailable: settings.failIfUnavailable === true,
  };
}

export function normalizeAgentSandbox(value, options = {}) {
  const settings = options.settings || {};
  const policyRequiresSandbox =
    settings.requireSandbox === true ||
    settings.allowUnsandboxedCommands === false;
  if (!value && settings.enabled !== true && !policyRequiresSandbox)
    return null;
  if (value === false || settings.enabled === false) {
    if (policyRequiresSandbox) {
      const error = new Error(
        "Sandbox disablement is prohibited by effective sandbox policy",
      );
      error.code = "CONFIG_SANDBOX_OFF_PROHIBITED";
      throw error;
    }
    return null;
  }
  const effectiveSettings = policyRequiresSandbox
    ? {
        ...settings,
        enabled: true,
        failIfUnavailable: true,
        allowUnsandboxedCommands: false,
      }
    : settings;
  const managedNetworkDisabled = options.managedSettings?.network === false;
  const image =
    typeof value === "string" && value.trim() && value !== "true"
      ? value.trim()
      : DEFAULT_SANDBOX_IMAGE;
  return {
    engine: effectiveSettings.engine || "docker",
    image: effectiveSettings.image || image,
    cwd: path.resolve(options.cwd || process.cwd()),
    network: managedNetworkDisabled
      ? false
      : options.network === true || effectiveSettings.network === true,
    policy: normalizeSandboxPolicy(
      effectiveSettings,
      options.cwd || process.cwd(),
    ),
  };
}

/**
 * Resolve the explicit public sandbox posture. Both isolation modes fail
 * closed when the selected engine is unavailable; `strict` additionally
 * forbids per-command unsandboxed escape hatches and network access.
 */
export function normalizeAgentSandboxMode(mode, value, options = {}) {
  if (mode == null || mode === "") {
    // Keep the container sandbox opt-in unless CLI/settings policy explicitly
    // enables it. The platform process broker still applies its native
    // boundary, but starting a normal agent must not require Docker.
    return normalizeAgentSandbox(value, options);
  }
  if (!AGENT_SANDBOX_MODES.includes(mode)) {
    const error = new Error(
      `Invalid sandbox mode "${mode}"; expected off, workspace-write, or strict`,
    );
    error.code = "CONFIG_SANDBOX_MODE_INVALID";
    throw error;
  }
  const settings = { ...(options.settings || {}) };
  if (mode === "off") {
    const managedSettings = options.managedSettings || {};
    if (
      managedSettings.enabled === true ||
      managedSettings.requireSandbox === true ||
      managedSettings.allowUnsandboxedCommands === false ||
      settings.requireSandbox === true ||
      settings.allowUnsandboxedCommands === false
    ) {
      const error = new Error(
        "Sandbox mode off is prohibited by managed/effective sandbox policy",
      );
      error.code = "CONFIG_SANDBOX_OFF_PROHIBITED";
      throw error;
    }
    return null;
  }
  settings.enabled = true;
  settings.failIfUnavailable = true;
  settings.allowUnsandboxedCommands = false;
  if (mode === "strict") {
    settings.network = false;
  }
  const sandbox = normalizeAgentSandbox(value || true, {
    ...options,
    network: mode === "strict" ? false : options.network,
    settings,
  });
  sandbox.mode = mode;
  return sandbox;
}

/**
 * Clamp an already-enabled sandbox to fail closed for safety-oriented run
 * modes. This never turns isolation on implicitly; it only prevents a selected
 * sandbox from degrading to bare host execution when its engine is missing.
 */
export function enforceSandboxFailClosed(sandbox, reason = "safe") {
  if (!sandbox) return null;
  return {
    ...sandbox,
    failClosedReason: reason,
    policy: {
      ...(sandbox.policy || {}),
      allowUnsandboxedCommands: false,
      failIfUnavailable: true,
    },
  };
}

function capability(id, details = {}) {
  return { id, ...details };
}

function addUniqueCapability(target, entry) {
  if (!target.some((candidate) => candidate.id === entry.id)) {
    target.push(entry);
  }
}

/**
 * Describe the exact legacy agent-shell sandbox request without claiming that
 * a command has run. `enforceable` is backend capability; `applied` is only
 * populated after a child was successfully started through that backend.
 */
export function assessAgentSandboxCapabilities(sandbox, options = {}) {
  const host = options.host || {
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
  };
  const execution = options.execution || null;
  const availability = options.availability || null;
  const requested = [];
  const enforceable = [];
  const unsupported = [];

  if (!sandbox) {
    return {
      schema: AGENT_SANDBOX_CAPABILITY_SCHEMA,
      host: {
        platform: String(host.platform),
        release: String(host.release),
        arch: String(host.arch),
      },
      backend: {
        engine: null,
        isolationLevel: "policy-only",
        availabilityChecked: false,
        available: null,
        reason: null,
      },
      status: "disabled",
      execution: {
        observed: false,
        attempted: false,
        started: false,
      },
      requested,
      enforceable,
      applied: [],
      unsupported,
    };
  }

  const engine = String(sandbox.engine || "");
  const policy = sandbox.policy || normalizeSandboxPolicy({}, sandbox.cwd);
  const supportedEngine = engine === "docker" || engine === "bubblewrap";
  const supportedPlatform =
    engine !== "bubblewrap" || host.platform === "linux";
  const isolationCapability =
    engine === "docker"
      ? "isolation.container"
      : engine === "bubblewrap"
        ? "isolation.linux-namespace"
        : "isolation.unknown";
  const networkCapability = sandbox.network
    ? "network.unrestricted"
    : "network.none";

  addUniqueCapability(requested, capability(isolationCapability));
  addUniqueCapability(requested, capability("filesystem.workspace-read-write"));
  addUniqueCapability(requested, capability(networkCapability));

  const filesystemRequests = [
    ["filesystem.additional-read", policy.allowRead],
    ["filesystem.deny-read", policy.denyRead],
    ["filesystem.additional-write", policy.allowWrite],
    ["filesystem.deny-write", policy.denyWrite],
  ];
  for (const [id, values] of filesystemRequests) {
    if (values?.length) {
      addUniqueCapability(
        requested,
        capability(id, { entries: values.length }),
      );
    }
  }
  const domainRuleCount =
    (policy.allowedDomains?.length || 0) + (policy.deniedDomains?.length || 0);
  if (domainRuleCount > 0) {
    addUniqueCapability(
      requested,
      capability("network.domain-policy", { entries: domainRuleCount }),
    );
  }

  if (!supportedEngine) {
    unsupported.push(
      capability("backend.engine", {
        reason: "unsupported_engine",
        message: `Unsupported agent sandbox engine: ${engine || "<empty>"}`,
        remediation: "Use engine=docker or engine=bubblewrap.",
      }),
    );
  } else if (!supportedPlatform) {
    unsupported.push(
      capability("backend.platform", {
        reason: "bubblewrap_requires_linux",
        message: `bubblewrap is only supported on Linux; host platform is ${host.platform}`,
        remediation: "Use Docker on this host or run bubblewrap on Linux.",
      }),
    );
  } else {
    addUniqueCapability(
      enforceable,
      capability(isolationCapability, {
        enforcement:
          engine === "docker" ? "docker-container" : "bubblewrap-namespaces",
      }),
    );
    addUniqueCapability(
      enforceable,
      capability("filesystem.workspace-read-write", {
        enforcement:
          engine === "docker" ? "docker-bind-mount" : "bubblewrap-bind-mount",
      }),
    );
    addUniqueCapability(
      enforceable,
      capability(networkCapability, {
        enforcement:
          engine === "docker"
            ? sandbox.network
              ? "docker-default-network"
              : "docker-network-none"
            : sandbox.network
              ? "bubblewrap-share-net"
              : "bubblewrap-unshared-network-namespace",
      }),
    );

    for (const [id, values] of filesystemRequests) {
      if (!values?.length) continue;
      if (engine === "docker") {
        unsupported.push(
          capability(id, {
            reason: "docker_fine_grained_filesystem_unsupported",
            message:
              "The Docker sandbox backend cannot enforce fine-grained filesystem policy; use engine=bubblewrap",
            remediation:
              "Use engine=bubblewrap on Linux or remove the fine-grained rule.",
          }),
        );
      } else if (id === "filesystem.additional-read") {
        unsupported.push(
          capability(id, {
            reason: "bubblewrap_additional_read_not_isolated",
            message:
              "The bubblewrap agent-shell backend exposes the host root read-only and cannot make allowRead an exclusive read boundary",
            remediation:
              "Remove allowRead or use the attested ProcessExecutionBroker sandbox for a supported execution contract.",
          }),
        );
      } else {
        addUniqueCapability(
          enforceable,
          capability(id, {
            entries: values.length,
            enforcement: `bubblewrap-${id.replace("filesystem.", "")}-mount`,
          }),
        );
      }
    }

    if (domainRuleCount > 0) {
      unsupported.push(
        capability("network.domain-policy", {
          reason: "domain_policy_has_no_non_bypassable_backend",
          message:
            "Domain-restricted sandbox networking has no non-bypassable backend enforcement; refusing unrestricted network access",
          remediation:
            "Disable sandbox networking or use a separately attested dependency-fetch service.",
        }),
      );
    }
  }

  const executionObserved = execution !== null;
  const executionAttempted = execution?.attempted === true;
  const executionStarted = execution?.started === true;
  const availabilityChecked = availability !== null || executionStarted;
  const available = executionStarted
    ? true
    : availability === null
      ? null
      : availability.available === true;
  const availabilityReason = executionStarted
    ? null
    : availability?.reason || null;
  let status = "ready";
  if (unsupported.length > 0) status = "unsupported";
  else if (executionStarted) status = "applied";
  else if (executionAttempted) status = "failed-to-start";
  else if (availabilityChecked && !available) status = "unavailable";

  return {
    schema: AGENT_SANDBOX_CAPABILITY_SCHEMA,
    host: {
      platform: String(host.platform),
      release: String(host.release),
      arch: String(host.arch),
    },
    backend: {
      engine,
      isolationLevel: isolationLevel(sandbox),
      availabilityChecked,
      available,
      reason: availabilityReason,
    },
    status,
    execution: {
      observed: executionObserved,
      attempted: executionAttempted,
      started: executionStarted,
    },
    requested,
    enforceable,
    applied: executionStarted ? enforceable.map((entry) => ({ ...entry })) : [],
    unsupported,
  };
}

export function assertSandboxCapabilities(sandbox, options = {}) {
  const report = assessAgentSandboxCapabilities(sandbox, options);
  if (report.unsupported.length === 0) return report;
  const error = new Error(
    `Unsupported sandbox capability request: ${report.unsupported
      .map((entry) => `${entry.id} (${entry.message})`)
      .join("; ")}`,
  );
  error.code = "CONFIG_SANDBOX_CAPABILITY_UNSUPPORTED";
  error.capabilityReport = report;
  throw error;
}

function attachSandboxCapabilityReport(
  result,
  sandbox,
  execution,
  availability,
  host,
) {
  return {
    ...result,
    sandboxCapabilities: assessAgentSandboxCapabilities(sandbox, {
      execution,
      availability,
      host,
    }),
  };
}

export function executeSandboxedShell(command, sandbox, options = {}) {
  if (!sandbox || !["docker", "bubblewrap"].includes(sandbox.engine)) {
    throw new Error("A supported agent sandbox configuration is required");
  }
  const hostCwd = path.resolve(options.cwd || sandbox.cwd);
  const policy = sandbox.policy || normalizeSandboxPolicy({}, hostCwd);
  const capabilityHost = _deps.host();
  const capabilityReport = assessAgentSandboxCapabilities(sandbox, {
    host: capabilityHost,
  });
  if (capabilityReport.unsupported.length > 0) {
    return {
      stdout: "",
      stderr: capabilityReport.unsupported
        .map((entry) => entry.message)
        .join("; "),
      exitCode: 1,
      failedToStart: true,
      sandboxCapabilities: capabilityReport,
    };
  }
  // Proxy environment variables are advisory: a child can clear them or open a
  // raw socket. Until a backend can enforce egress below the process layer,
  // domain-restricted networking must fail closed instead of granting the
  // sandbox an unrestricted network namespace.
  const egress = options.egressProxy || null;
  if (sandbox.engine === "bubblewrap") {
    return executeBubblewrapShell(command, sandbox, options, hostCwd, policy);
  }
  const args = ["run", "--rm", "--init"];
  if (!sandbox.network) args.push("--network", "none");
  args.push("--mount", `type=bind,source=${hostCwd},target=/workspace`);
  args.push("--workdir", "/workspace");
  if (process.platform !== "win32" && process.getuid && process.getgid) {
    args.push("--user", `${process.getuid()}:${process.getgid()}`);
  }
  // Proxy variables remain useful for unrestricted networking, but are not a
  // security boundary. Domain-restricted requests have already failed closed.
  if (egress && egress.port && sandbox.network) {
    args.push("--add-host", "host.docker.internal:host-gateway");
    const penv = proxyEnv(egress.port, "host.docker.internal");
    for (const [k, v] of Object.entries(penv)) {
      args.push("--env", `${k}=${v}`);
    }
  }
  const env = options.env || {};
  for (const key of ["CLAUDECODE", "CC_SESSION_ID", "CLAUDE_CODE_SESSION_ID"]) {
    if (env[key] != null) args.push("--env", `${key}=${env[key]}`);
  }
  args.push(sandbox.image, "sh", "-lc", String(command || ""));
  const result = _deps.spawnSync("docker", args, {
    origin: "agent-sandbox:docker",
    scope: "sandbox",
    policy: "allow",
    shell: false,
    encoding: "utf8",
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
    windowsHide: true,
    requirePersistentAudit: true,
    auditRedactArgIndexes: [args.length - 1],
    auditContext: options.auditContext,
  });
  if (result.error) {
    return attachSandboxCapabilityReport(
      {
        stdout: result.stdout || "",
        stderr:
          result.error.code === "ENOENT"
            ? "Docker is not installed"
            : result.error.message,
        exitCode: typeof result.status === "number" ? result.status : 1,
        failedToStart: true,
      },
      sandbox,
      { attempted: true, started: false },
      { available: false, reason: result.error.message },
      capabilityHost,
    );
  }
  return attachSandboxCapabilityReport(
    {
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      exitCode: typeof result.status === "number" ? result.status : 1,
      signal: result.signal || null,
    },
    sandbox,
    { attempted: true, started: true },
    { available: true, reason: null },
    capabilityHost,
  );
}

function executeBubblewrapShell(command, sandbox, options, hostCwd, policy) {
  // Mount ORDER matters: bwrap applies mounts sequentially and a later mount
  // shadows an earlier one. `--tmpfs /tmp` must come BEFORE the workspace
  // bind — with the old order (bind first, tmpfs last) any workspace living
  // UNDER /tmp was wiped by the tmpfs overlay and the --chdir failed with
  // "Can't chdir …: No such file or directory" (caught by the live bwrap CI
  // suite, whose temp workspace is exactly such a directory).
  const args = [
    "--die-with-parent",
    "--new-session",
    "--unshare-all",
    "--ro-bind",
    "/",
    "/",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    "--bind",
    hostCwd,
    hostCwd,
    "--chdir",
    hostCwd,
  ];
  if (sandbox.network) args.push("--share-net");
  for (const target of policy.allowWrite) args.push("--bind", target, target);
  for (const target of policy.denyWrite) args.push("--ro-bind", target, target);
  for (const target of policy.denyRead) args.push("--tmpfs", target);
  args.push("--", "sh", "-lc", String(command || ""));
  // bwrap `--share-net` shares the host network namespace. Proxy variables are
  // convenience only; domain-restricted requests have already failed closed.
  const egress = options.egressProxy || null;
  const bwrapEnv =
    egress && egress.port && sandbox.network
      ? { ...(options.env || {}), ...proxyEnv(egress.port, "127.0.0.1") }
      : options.env;
  const result = _deps.spawnSync("bwrap", args, {
    origin: "agent-sandbox:bubblewrap",
    scope: "sandbox",
    policy: "allow",
    shell: false,
    cwd: hostCwd,
    env: bwrapEnv,
    encoding: "utf8",
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
    windowsHide: true,
    requirePersistentAudit: true,
    auditRedactArgIndexes: [args.length - 1],
    auditContext: options.auditContext,
  });
  if (result.error) {
    return attachSandboxCapabilityReport(
      {
        stdout: result.stdout || "",
        stderr:
          result.error.code === "ENOENT"
            ? "bubblewrap is not installed"
            : result.error.message,
        exitCode: typeof result.status === "number" ? result.status : 1,
        failedToStart: true,
      },
      sandbox,
      { attempted: true, started: false },
      { available: false, reason: result.error.message },
      _deps.host(),
    );
  }
  return attachSandboxCapabilityReport(
    {
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      exitCode: typeof result.status === "number" ? result.status : 1,
      signal: result.signal || null,
    },
    sandbox,
    { attempted: true, started: true },
    { available: true, reason: null },
    _deps.host(),
  );
}

/**
 * The run's TRUE isolation level (gap-analysis 2026-07-11 P0 "OS 级沙箱"):
 *  - "os-sandbox"  : bubblewrap — kernel namespaces confine the child
 *  - "container"   : docker — container boundary confines the child
 *  - "policy-only" : no sandbox — permission rules/shell policy are advisory
 *                    for already-spawned subprocesses
 * Surfaced in the headless init event and sandboxSummary so a caller can see
 * what actually confines tool subprocesses instead of assuming.
 */
export function isolationLevel(sandbox) {
  if (!sandbox) return "policy-only";
  if (sandbox.engine === "bubblewrap") return "os-sandbox";
  if (sandbox.engine === "docker") return "container";
  return "policy-only";
}

/**
 * Probe whether the configured sandbox ENGINE is actually runnable on this
 * host (binary present + responds to a version query). Cheap: one spawnSync
 * with a short timeout; no container is started.
 * @returns {{available:boolean, reason:string|null}}
 */
export function probeSandboxAvailability(sandbox, deps = _deps) {
  if (!sandbox) return { available: true, reason: null };
  const probeArgs =
    sandbox.engine === "bubblewrap"
      ? ["bwrap", ["--version"]]
      : ["docker", ["version", "--format", "{{.Server.Version}}"]];
  const result = deps.spawnSync(probeArgs[0], probeArgs[1], {
    origin: "agent-sandbox:probe",
    scope: "sandbox",
    policy: "allow",
    shell: false,
    encoding: "utf8",
    timeout: 10000,
    windowsHide: true,
  });
  if (result.error) {
    return {
      available: false,
      reason:
        result.error.code === "ENOENT"
          ? `${probeArgs[0]} is not installed`
          : result.error.message,
    };
  }
  if (typeof result.status === "number" && result.status !== 0) {
    return {
      available: false,
      reason: `${probeArgs[0]} probe exited ${result.status}: ${(result.stderr || "").trim().slice(0, 200)}`,
    };
  }
  return { available: true, reason: null };
}

/**
 * Strict mode (`sandbox.failIfUnavailable: true` in settings): refuse to
 * START the agent when the configured sandbox engine is unavailable, instead
 * of silently degrading per command. Throws with an actionable message; a
 * no-op when the flag is unset or the sandbox is fine.
 */
export function assertSandboxAvailable(sandbox, deps = _deps) {
  if (!sandbox || sandbox.policy?.failIfUnavailable !== true) return;
  const probe = probeSandboxAvailability(sandbox, deps);
  if (!probe.available) {
    throw new Error(
      `sandbox.failIfUnavailable: ${sandbox.engine} sandbox is unavailable (${probe.reason}) — refusing to start. Install/start ${sandbox.engine === "bubblewrap" ? "bubblewrap" : "Docker"}, or unset failIfUnavailable to allow per-command degradation.`,
    );
  }
}

export function sandboxSummary(sandbox) {
  if (!sandbox) return null;
  const summary = {
    engine: sandbox.engine,
    image: sandbox.image,
    isolationLevel: isolationLevel(sandbox),
    network: sandbox.network ? "enabled" : "disabled",
    workspace: "read-write",
    policy: {
      additionalReadPaths: sandbox.policy?.allowRead?.length || 0,
      additionalWritePaths: sandbox.policy?.allowWrite?.length || 0,
      networkRestricted:
        Boolean(sandbox.policy?.allowedDomains?.length) ||
        Boolean(sandbox.policy?.deniedDomains?.length),
      failIfUnavailable: sandbox.policy?.failIfUnavailable === true,
    },
  };
  if (sandbox.mode) summary.mode = sandbox.mode;
  return summary;
}
