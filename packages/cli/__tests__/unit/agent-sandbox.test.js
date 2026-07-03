import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SANDBOX_IMAGE,
  _deps,
  executeSandboxedShell,
  normalizeAgentSandbox,
  normalizeSandboxPolicy,
  sandboxSummary,
} from "../../src/lib/agent-sandbox.js";
import { executeTool } from "../../src/runtime/agent-core.js";

const originalSpawnSync = _deps.spawnSync;
afterEach(() => {
  _deps.spawnSync = originalSpawnSync;
});

describe("agent sandbox", () => {
  it("is opt-in and defaults to network isolation", () => {
    expect(normalizeAgentSandbox(undefined)).toBeNull();
    const sandbox = normalizeAgentSandbox(true, { cwd: "." });
    expect(sandbox.image).toBe(DEFAULT_SANDBOX_IMAGE);
    expect(sandbox.network).toBe(false);
  });

  it("loads an enabled settings policy without a CLI flag", () => {
    const sandbox = normalizeAgentSandbox(undefined, {
      cwd: ".",
      settings: {
        enabled: true,
        failIfUnavailable: true,
        filesystem: { denyRead: [".secrets"] },
        network: { allowedDomains: ["registry.npmjs.org"] },
      },
    });
    expect(sandbox).not.toBeNull();
    expect(sandbox.policy.failIfUnavailable).toBe(true);
    expect(sandbox.policy.denyRead[0]).toMatch(/\.secrets$/);
    expect(sandbox.policy.allowedDomains).toEqual(["registry.npmjs.org"]);
  });

  it("normalizes and de-duplicates policy entries", () => {
    const policy = normalizeSandboxPolicy(
      {
        filesystem: { allowWrite: ["tmp", "tmp"] },
        excludedCommands: ["docker", "docker"],
      },
      process.cwd(),
    );
    expect(policy.allowWrite).toHaveLength(1);
    expect(policy.excludedCommands).toEqual(["docker"]);
  });

  it("executes Docker with argv and only forwards agent identity", () => {
    _deps.spawnSync = vi.fn(() => ({
      status: 0,
      stdout: "ok\n",
      stderr: "",
      signal: null,
    }));
    const sandbox = normalizeAgentSandbox("node:22-alpine");
    const result = executeSandboxedShell("npm test && echo done", sandbox, {
      timeout: 1000,
      env: { CLAUDECODE: "1", SECRET: "must-not-cross" },
    });
    expect(result.exitCode).toBe(0);
    const [file, args, opts] = _deps.spawnSync.mock.calls[0];
    expect(file).toBe("docker");
    expect(args).toContain("none");
    expect(args).toContain("node:22-alpine");
    expect(args.at(-1)).toBe("npm test && echo done");
    expect(args.join(" ")).not.toContain("SECRET");
    expect(opts.timeout).toBe(1000);
  });

  it("fails closed when Docker is unavailable", () => {
    const error = new Error("spawn docker ENOENT");
    error.code = "ENOENT";
    _deps.spawnSync = vi.fn(() => ({
      error,
      status: null,
      stdout: "",
      stderr: "",
    }));
    const result = executeSandboxedShell(
      "echo unsafe",
      normalizeAgentSandbox(true),
    );
    expect(result.exitCode).toBe(1);
    expect(result.failedToStart).toBe(true);
    expect(result.stderr).toMatch(/not installed/i);
  });

  it("reports the effective boundary without host paths", () => {
    expect(sandboxSummary(normalizeAgentSandbox(true))).toEqual({
      engine: "docker",
      image: DEFAULT_SANDBOX_IMAGE,
      network: "disabled",
      workspace: "read-write",
      policy: {
        additionalReadPaths: 0,
        additionalWritePaths: 0,
        networkRestricted: false,
        failIfUnavailable: false,
      },
    });
  });

  it("fails closed instead of pretending domain filtering is active", () => {
    const result = executeSandboxedShell(
      "npm view chalk version",
      normalizeAgentSandbox(true, {
        network: true,
        settings: { network: { allowedDomains: ["registry.npmjs.org"] } },
      }),
    );
    expect(result.failedToStart).toBe(true);
    expect(result.stderr).toMatch(/requires a configured sandbox proxy/i);
  });

  it("ENFORCES the domain policy through an egress proxy instead of refusing (docker)", () => {
    _deps.spawnSync = vi.fn(() => ({ status: 0, stdout: "ok\n", stderr: "" }));
    const sandbox = normalizeAgentSandbox(true, {
      network: true,
      settings: { network: { allowedDomains: ["registry.npmjs.org"] } },
    });
    const result = executeSandboxedShell("npm view chalk version", sandbox, {
      egressProxy: { port: 54321 },
    });
    // No longer refuses — it ran, with proxy egress wired in.
    expect(result.failedToStart).toBeUndefined();
    expect(result.exitCode).toBe(0);
    const [, args] = _deps.spawnSync.mock.calls[0];
    const joined = args.join(" ");
    // Container reaches the host proxy via host.docker.internal.
    expect(joined).toContain("--add-host host.docker.internal:host-gateway");
    expect(joined).toContain("HTTP_PROXY=http://host.docker.internal:54321");
    expect(joined).toContain("HTTPS_PROXY=http://host.docker.internal:54321");
    // network is NOT "none" here (egress is filtered, not cut).
    expect(args).not.toContain("none");
  });

  it("wires the egress proxy env into a bubblewrap run (127.0.0.1 shared net)", () => {
    _deps.spawnSync = vi.fn(() => ({ status: 0, stdout: "ok\n", stderr: "" }));
    const sandbox = normalizeAgentSandbox(true, {
      cwd: process.cwd(),
      network: true,
      settings: {
        engine: "bubblewrap",
        network: { allowedDomains: ["registry.npmjs.org"] },
      },
    });
    const result = executeSandboxedShell("npm test", sandbox, {
      egressProxy: { port: 45678 },
    });
    expect(result.failedToStart).toBeUndefined();
    const [, args, opts] = _deps.spawnSync.mock.calls[0];
    expect(args).toContain("--share-net");
    expect(opts.env.HTTP_PROXY).toBe("http://127.0.0.1:45678");
    expect(opts.env.HTTPS_PROXY).toBe("http://127.0.0.1:45678");
  });

  it("builds a bubblewrap invocation with a read-only host and writable workspace", () => {
    _deps.spawnSync = vi.fn(() => ({ status: 0, stdout: "ok\n", stderr: "" }));
    const sandbox = normalizeAgentSandbox(true, {
      cwd: process.cwd(),
      settings: { engine: "bubblewrap" },
    });
    const result = executeSandboxedShell("npm test", sandbox, {
      timeout: 2000,
    });
    expect(result.exitCode).toBe(0);
    const [file, args] = _deps.spawnSync.mock.calls[0];
    expect(file).toBe("bwrap");
    expect(args).toContain("--unshare-all");
    expect(args).toContain("--ro-bind");
    expect(args).toContain("--bind");
    expect(args).not.toContain("--share-net");
    expect(args.at(-1)).toBe("npm test");
  });

  it("fails closed when bubblewrap is unavailable", () => {
    const error = new Error("spawn bwrap ENOENT");
    error.code = "ENOENT";
    _deps.spawnSync = vi.fn(() => ({
      error,
      status: null,
      stdout: "",
      stderr: "",
    }));
    const result = executeSandboxedShell(
      "echo unsafe",
      normalizeAgentSandbox(true, { settings: { engine: "bubblewrap" } }),
    );
    expect(result.failedToStart).toBe(true);
    expect(result.stderr).toMatch(/bubblewrap is not installed/i);
  });

  it("is enforced by run_shell and returns a decision trace", async () => {
    _deps.spawnSync = vi.fn(() => ({
      status: 0,
      stdout: "sandboxed\n",
      stderr: "",
      signal: null,
    }));
    const result = await executeTool(
      "run_shell",
      { command: "echo sandboxed" },
      { sandbox: normalizeAgentSandbox(true) },
    );
    expect(result.stdout).toBe("sandboxed\n");
    expect(result.sandbox.network).toBe("disabled");
    expect(result.policyTrace).toEqual(["shell-policy", "approval", "sandbox"]);
  });
});
