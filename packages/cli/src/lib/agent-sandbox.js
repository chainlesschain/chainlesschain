/** OS-isolated shell execution for the coding agent. */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { proxyEnv } from "./sandbox-egress-proxy.js";

export const DEFAULT_SANDBOX_IMAGE = "node:22-bookworm-slim";
export const _deps = { spawnSync };

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
  if (!value && settings.enabled !== true) return null;
  if (value === false || settings.enabled === false) return null;
  const image =
    typeof value === "string" && value.trim() && value !== "true"
      ? value.trim()
      : DEFAULT_SANDBOX_IMAGE;
  return {
    engine: settings.engine || "docker",
    image: settings.image || image,
    cwd: path.resolve(options.cwd || process.cwd()),
    network: options.network === true || settings.network === true,
    policy: normalizeSandboxPolicy(settings, options.cwd || process.cwd()),
  };
}

export function executeSandboxedShell(command, sandbox, options = {}) {
  if (!sandbox || !["docker", "bubblewrap"].includes(sandbox.engine)) {
    throw new Error("A supported agent sandbox configuration is required");
  }
  const hostCwd = path.resolve(options.cwd || sandbox.cwd);
  const policy = sandbox.policy || normalizeSandboxPolicy({}, hostCwd);
  // An egress proxy (see sandbox-egress-proxy.js) ENFORCES the domain allow/deny
  // policy: the caller starts it and passes `{ env }` here, and the sandboxed
  // process routes its HTTP(S) traffic through it. Without a proxy, a
  // domain-restricted network request has no enforcement point, so we refuse
  // rather than grant unrestricted access.
  const egress = options.egressProxy || null;
  if (
    (policy.allowedDomains.length || policy.deniedDomains.length) &&
    sandbox.network &&
    !egress
  ) {
    return {
      stdout: "",
      stderr:
        "Domain-restricted sandbox networking requires a configured sandbox proxy; refusing unrestricted network access",
      exitCode: 1,
      failedToStart: true,
    };
  }
  if (sandbox.engine === "bubblewrap") {
    return executeBubblewrapShell(command, sandbox, options, hostCwd, policy);
  }
  if (
    policy.allowRead.length ||
    policy.denyRead.length ||
    policy.allowWrite.length ||
    policy.denyWrite.length
  ) {
    return {
      stdout: "",
      stderr:
        "The Docker sandbox backend cannot enforce fine-grained filesystem policy; use engine=bubblewrap",
      exitCode: 1,
      failedToStart: true,
    };
  }
  const args = ["run", "--rm", "--init"];
  if (!sandbox.network) args.push("--network", "none");
  args.push("--mount", `type=bind,source=${hostCwd},target=/workspace`);
  args.push("--workdir", "/workspace");
  if (process.platform !== "win32" && process.getuid && process.getgid) {
    args.push("--user", `${process.getuid()}:${process.getgid()}`);
  }
  // Route egress through the host proxy so the domain policy is enforced. The
  // container reaches the host proxy via host.docker.internal (mapped to the
  // gateway on Linux via host-gateway); the caller builds `egress.env` with that
  // hostname (proxyEnv(port, "host.docker.internal")).
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
    encoding: "utf8",
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
    windowsHide: true,
  });
  if (result.error) {
    return {
      stdout: result.stdout || "",
      stderr:
        result.error.code === "ENOENT"
          ? "Docker is not installed"
          : result.error.message,
      exitCode: typeof result.status === "number" ? result.status : 1,
      failedToStart: true,
    };
  }
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: typeof result.status === "number" ? result.status : 1,
    signal: result.signal || null,
  };
}

function executeBubblewrapShell(command, sandbox, options, hostCwd, policy) {
  const args = [
    "--die-with-parent",
    "--new-session",
    "--unshare-all",
    "--ro-bind",
    "/",
    "/",
    "--bind",
    hostCwd,
    hostCwd,
    "--chdir",
    hostCwd,
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
  ];
  if (sandbox.network) args.push("--share-net");
  for (const target of policy.allowWrite) args.push("--bind", target, target);
  for (const target of policy.denyWrite) args.push("--ro-bind", target, target);
  for (const target of policy.denyRead) args.push("--tmpfs", target);
  args.push("--", "sh", "-lc", String(command || ""));
  // bwrap `--share-net` shares the host network namespace, so the egress proxy
  // is reachable at 127.0.0.1 directly — merge its env into the child's.
  const egress = options.egressProxy || null;
  const bwrapEnv =
    egress && egress.port && sandbox.network
      ? { ...(options.env || {}), ...proxyEnv(egress.port, "127.0.0.1") }
      : options.env;
  const result = _deps.spawnSync("bwrap", args, {
    cwd: hostCwd,
    env: bwrapEnv,
    encoding: "utf8",
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
    windowsHide: true,
  });
  if (result.error) {
    return {
      stdout: result.stdout || "",
      stderr:
        result.error.code === "ENOENT"
          ? "bubblewrap is not installed"
          : result.error.message,
      exitCode: typeof result.status === "number" ? result.status : 1,
      failedToStart: true,
    };
  }
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: typeof result.status === "number" ? result.status : 1,
    signal: result.signal || null,
  };
}

export function sandboxSummary(sandbox) {
  if (!sandbox) return null;
  return {
    engine: sandbox.engine,
    image: sandbox.image,
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
}
