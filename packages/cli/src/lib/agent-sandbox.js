/** OS-isolated shell execution for the coding agent. */
import { spawnSync } from "node:child_process";
import path from "node:path";

export const DEFAULT_SANDBOX_IMAGE = "node:22-bookworm-slim";
export const _deps = { spawnSync };

export function normalizeAgentSandbox(value, options = {}) {
  if (!value) return null;
  const image =
    typeof value === "string" && value.trim() && value !== "true"
      ? value.trim()
      : DEFAULT_SANDBOX_IMAGE;
  return {
    engine: "docker",
    image,
    cwd: path.resolve(options.cwd || process.cwd()),
    network: options.network === true,
  };
}

export function executeSandboxedShell(command, sandbox, options = {}) {
  if (!sandbox || sandbox.engine !== "docker") {
    throw new Error("A supported agent sandbox configuration is required");
  }
  const hostCwd = path.resolve(options.cwd || sandbox.cwd);
  const args = ["run", "--rm", "--init"];
  if (!sandbox.network) args.push("--network", "none");
  args.push("--mount", `type=bind,source=${hostCwd},target=/workspace`);
  args.push("--workdir", "/workspace");
  if (process.platform !== "win32" && process.getuid && process.getgid) {
    args.push("--user", `${process.getuid()}:${process.getgid()}`);
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

export function sandboxSummary(sandbox) {
  if (!sandbox) return null;
  return {
    engine: sandbox.engine,
    image: sandbox.image,
    network: sandbox.network ? "enabled" : "disabled",
    workspace: "read-write",
  };
}
