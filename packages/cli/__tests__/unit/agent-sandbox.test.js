import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SANDBOX_IMAGE,
  _deps,
  assertSandboxAvailable,
  enforceSandboxFailClosed,
  executeSandboxedShell,
  isolationLevel,
  normalizeAgentSandbox,
  normalizeAgentSandboxMode,
  normalizeSandboxPolicy,
  probeSandboxAvailability,
  sandboxSummary,
} from "../../src/lib/agent-sandbox.js";
import { executeTool } from "../../src/runtime/agent-core.js";
import { containsApiKeyArgument } from "../../src/commands/agent.js";

const originalSpawnSync = _deps.spawnSync;
afterEach(() => {
  _deps.spawnSync = originalSpawnSync;
});

describe("agent sandbox", () => {
  it("detects both supported API-key argv spellings for deprecation warnings", () => {
    expect(containsApiKeyArgument(["node", "cc", "--api-key", "secret"])).toBe(
      true,
    );
    expect(containsApiKeyArgument(["node", "cc", "--api-key=secret"])).toBe(
      true,
    );
    expect(containsApiKeyArgument(["node", "cc", "--api-key-helper=x"])).toBe(
      false,
    );
  });

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

  it("turns hard sandbox policy into fail-closed default isolation", () => {
    for (const settings of [
      { requireSandbox: true },
      { allowUnsandboxedCommands: false },
    ]) {
      const sandbox = normalizeAgentSandbox(undefined, { cwd: ".", settings });
      expect(sandbox).not.toBeNull();
      expect(sandbox.policy).toMatchObject({
        failIfUnavailable: true,
        allowUnsandboxedCommands: false,
      });
      expect(() =>
        normalizeAgentSandbox(false, { cwd: ".", settings }),
      ).toThrow(/prohibited/);
    }
  });

  it("does not let a CLI flag override managed network isolation", () => {
    const sandbox = normalizeAgentSandboxMode(undefined, true, {
      network: true,
      settings: { enabled: true, network: false },
      managedSettings: { enabled: true, network: false },
    });
    expect(sandbox.network).toBe(false);
  });

  it("does not require Docker when no container sandbox was requested", () => {
    expect(
      normalizeAgentSandboxMode(undefined, undefined, { cwd: "." }),
    ).toBeNull();
  });

  it("still honors settings that explicitly enable a fail-closed sandbox", () => {
    const sandbox = normalizeAgentSandboxMode(undefined, undefined, {
      cwd: ".",
      settings: { enabled: true, failIfUnavailable: true },
    });
    expect(sandbox).toMatchObject({ engine: "docker", network: false });
    expect(sandbox.policy.failIfUnavailable).toBe(true);
  });

  it("clamps an enabled sandbox for safe/auto runs", () => {
    const sandbox = enforceSandboxFailClosed(
      normalizeAgentSandbox(true),
      "auto",
    );
    expect(sandbox.failClosedReason).toBe("auto");
    expect(sandbox.policy).toMatchObject({
      allowUnsandboxedCommands: false,
      failIfUnavailable: true,
    });
  });

  it("maps explicit sandbox modes to fail-closed policies", () => {
    expect(normalizeAgentSandboxMode("off", true)).toBeNull();
    const workspace = normalizeAgentSandboxMode("workspace-write", true, {
      network: true,
    });
    expect(workspace).toMatchObject({ mode: "workspace-write", network: true });
    expect(workspace.policy).toMatchObject({
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
    });
    const strict = normalizeAgentSandboxMode("strict", true, {
      network: true,
    });
    expect(strict).toMatchObject({ mode: "strict", network: false });
    expect(strict.policy.failIfUnavailable).toBe(true);
  });

  it("rejects invalid modes and a policy-prohibited off mode", () => {
    expect(() => normalizeAgentSandboxMode("maybe", true)).toThrow(
      /Invalid sandbox mode/,
    );
    expect(() =>
      normalizeAgentSandboxMode("off", true, {
        settings: { allowUnsandboxedCommands: false },
      }),
    ).toThrow(/prohibited/);
    expect(() =>
      normalizeAgentSandboxMode("off", true, {
        settings: { enabled: true, allowUnsandboxedCommands: true },
        managedSettings: { enabled: true },
      }),
    ).toThrow(/prohibited/);
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
    expect(opts).toMatchObject({
      origin: "agent-sandbox:docker",
      scope: "sandbox",
      policy: "allow",
      shell: false,
    });
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
      isolationLevel: "container",
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
    expect(result.stderr).toMatch(/no non-bypassable backend enforcement/i);
  });

  it("does not mistake Docker proxy env for domain enforcement", () => {
    _deps.spawnSync = vi.fn(() => ({ status: 0, stdout: "ok\n", stderr: "" }));
    const sandbox = normalizeAgentSandbox(true, {
      network: true,
      settings: { network: { allowedDomains: ["registry.npmjs.org"] } },
    });
    const result = executeSandboxedShell("npm view chalk version", sandbox, {
      egressProxy: { port: 54321 },
    });
    expect(result.failedToStart).toBe(true);
    expect(result.stderr).toMatch(/no non-bypassable backend enforcement/i);
    expect(_deps.spawnSync).not.toHaveBeenCalled();
  });

  it("does not mistake bubblewrap proxy env for domain enforcement", () => {
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
    expect(result.failedToStart).toBe(true);
    expect(result.stderr).toMatch(/no non-bypassable backend enforcement/i);
    expect(_deps.spawnSync).not.toHaveBeenCalled();
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
    const [file, args, opts] = _deps.spawnSync.mock.calls[0];
    expect(file).toBe("bwrap");
    expect(args).toContain("--unshare-all");
    expect(args).toContain("--ro-bind");
    expect(args).toContain("--bind");
    expect(args).not.toContain("--share-net");
    expect(args.at(-1)).toBe("npm test");
    expect(opts).toMatchObject({
      origin: "agent-sandbox:bubblewrap",
      scope: "sandbox",
      policy: "allow",
      shell: false,
    });
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

describe("strict sandbox mode (gap 2026-07-11: failIfUnavailable + isolation level)", () => {
  it("isolationLevel maps engines to the true confinement tier", () => {
    expect(isolationLevel(null)).toBe("policy-only");
    expect(isolationLevel(normalizeAgentSandbox(true, { settings: {} }))).toBe(
      "container",
    );
    expect(
      isolationLevel(
        normalizeAgentSandbox(true, { settings: { engine: "bubblewrap" } }),
      ),
    ).toBe("os-sandbox");
  });

  it("sandboxSummary surfaces isolationLevel", () => {
    const summary = sandboxSummary(normalizeAgentSandbox(true));
    expect(summary.isolationLevel).toBe("container");
  });

  it("probeSandboxAvailability reports a missing engine binary", () => {
    const error = new Error("spawn docker ENOENT");
    error.code = "ENOENT";
    const deps = { spawnSync: vi.fn(() => ({ error, status: null })) };
    const probe = probeSandboxAvailability(normalizeAgentSandbox(true), deps);
    expect(probe.available).toBe(false);
    expect(probe.reason).toMatch(/docker is not installed/i);
    // docker installed but daemon down (probe exits non-zero)
    const daemonDown = {
      spawnSync: vi.fn(() => ({
        status: 1,
        stdout: "",
        stderr: "Cannot connect to the Docker daemon",
      })),
    };
    const probe2 = probeSandboxAvailability(
      normalizeAgentSandbox(true),
      daemonDown,
    );
    expect(probe2.available).toBe(false);
    expect(probe2.reason).toMatch(/daemon/i);
  });

  it("routes the default availability probe through the broker", () => {
    _deps.spawnSync = vi.fn(() => ({ status: 0, stdout: "27", stderr: "" }));

    expect(probeSandboxAvailability(normalizeAgentSandbox(true))).toEqual({
      available: true,
      reason: null,
    });
    expect(_deps.spawnSync).toHaveBeenCalledWith(
      "docker",
      ["version", "--format", "{{.Server.Version}}"],
      expect.objectContaining({
        origin: "agent-sandbox:probe",
        scope: "sandbox",
        policy: "allow",
        shell: false,
      }),
    );
  });

  it("assertSandboxAvailable refuses to start ONLY under failIfUnavailable", () => {
    const error = new Error("spawn bwrap ENOENT");
    error.code = "ENOENT";
    const deps = { spawnSync: vi.fn(() => ({ error, status: null })) };
    const strict = normalizeAgentSandbox(true, {
      settings: { engine: "bubblewrap", failIfUnavailable: true },
    });
    expect(() => assertSandboxAvailable(strict, deps)).toThrow(
      /refusing to start/i,
    );
    // Same broken engine WITHOUT the flag → no throw (per-command degradation)
    const lax = normalizeAgentSandbox(true, {
      settings: { engine: "bubblewrap" },
    });
    expect(() => assertSandboxAvailable(lax, deps)).not.toThrow();
    // Healthy engine + flag → no throw
    const healthy = { spawnSync: vi.fn(() => ({ status: 0, stdout: "27" })) };
    expect(() => assertSandboxAvailable(strict, healthy)).not.toThrow();
    // No sandbox at all → no probe, no throw
    expect(() => assertSandboxAvailable(null, deps)).not.toThrow();
  });
});
