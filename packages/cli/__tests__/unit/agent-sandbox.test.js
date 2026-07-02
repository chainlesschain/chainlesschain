import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SANDBOX_IMAGE,
  _deps,
  executeSandboxedShell,
  normalizeAgentSandbox,
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
    });
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
