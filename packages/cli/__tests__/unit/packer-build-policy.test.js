import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";
import { applySandbox } from "../../src/lib/process-execution-broker/platform-sandbox.js";
import { createPackerBuildPolicy } from "../../src/lib/process-execution-broker/packer-build-policy.js";

describe("packer build CPU policy admission", () => {
  let original;
  let spawn;
  beforeEach(() => {
    original = {
      native: executionBroker._native,
      adapter: executionBroker._sandboxAdapter,
      sandbox: executionBroker._sandboxEnabled,
      platformSandbox: executionBroker._platformSandboxEnabled,
    };
    vi.stubEnv("CC_SANDBOX_STRICT", "0");
    vi.stubEnv("CC_SANDBOX_DISABLE", "0");
    vi.spyOn(executionBroker, "_credentialBoundaryEnabled").mockReturnValue(
      false,
    );
    executionBroker._sandboxEnabled = true;
    executionBroker._platformSandboxEnabled = true;
    spawn = vi.fn(() => ({ status: 0, stdout: "", stderr: "" }));
    executionBroker._native = { spawnSync: spawn };
    executionBroker._sandboxAdapter = {
      applySandbox(command, args, options, profile, unused, request) {
        return applySandbox(
          command,
          args,
          options,
          profile,
          { platform: "linux", fs: { existsSync: () => true } },
          request,
        );
      },
    };
  });
  afterEach(() => {
    executionBroker._native = original.native;
    executionBroker._sandboxAdapter = original.adapter;
    executionBroker._sandboxEnabled = original.sandbox;
    executionBroker._platformSandboxEnabled = original.platformSandbox;
    executionBroker.flushAuditLog();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  function options(origin = "packer:pkg") {
    return {
      origin,
      scope: "pack",
      policy: "allow",
      shell: false,
      sandboxPolicy: createPackerBuildPolicy(origin),
      timeout: 900000,
      killSignal: "SIGKILL",
    };
  }
  it.each(["packer:pkg", "packer:web-panel-build"])(
    "applies finite CPU600 with unchanged nofile256 for %s",
    (origin) => {
      executionBroker.spawnSync("node", ["build.js"], options(origin));
      expect(spawn).toHaveBeenCalledWith(
        "/usr/bin/prlimit",
        ["--cpu=600", "--nofile=256", "--", "node", "build.js"],
        expect.objectContaining({ timeout: 900000, killSignal: "SIGKILL" }),
      );
    },
  );
  it.each(["deny", "prompt"])(
    "retains the %s process-permission gate",
    (policy) => {
      expect(() =>
        executionBroker.spawnSync("node", ["build.js"], {
          ...options(),
          policy,
        }),
      ).toThrow(`policy_${policy}`);
      expect(spawn).not.toHaveBeenCalled();
    },
  );
  it.each(["json", "copy", "plain", "origin", "scope"])(
    "rejects forged or rebound build requests: %s",
    (kind) => {
      const input = options();
      if (kind === "json")
        input.sandboxPolicy = JSON.parse(JSON.stringify(input.sandboxPolicy));
      if (kind === "copy") input.sandboxPolicy = { ...input.sandboxPolicy };
      if (kind === "plain") input.sandboxPolicy = { profile: "build" };
      if (kind === "origin") input.origin = "packer:web-panel-build";
      if (kind === "scope") input.scope = "agent";
      expect(() =>
        executionBroker.spawnSync("node", ["build.js"], input),
      ).toThrow(/original packer policy/);
      expect(spawn).not.toHaveBeenCalled();
    },
  );
  it("keeps the ordinary default at CPU30", () => {
    const input = options();
    delete input.sandboxPolicy;
    executionBroker.spawnSync("node", ["build.js"], input);
    expect(spawn.mock.calls[0][1][0]).toBe("--cpu=30");
  });

  it.each([
    { shell: true },
    { detached: true },
    { detached: "true" },
    { timeout: 0 },
    { timeout: 900001 },
    { killSignal: "SIGTERM" },
  ])("rejects an unbounded or indirect launch %j", (override) => {
    expect(() =>
      executionBroker.spawnSync("node", ["build.js"], {
        ...options(),
        ...override,
      }),
    ).toThrow(/original packer policy/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects using a synchronous build request for an asynchronous spawn", () => {
    expect(() =>
      executionBroker.spawn("node", ["build.js"], options()),
    ).toThrow(/original packer policy/);
    expect(spawn).not.toHaveBeenCalled();
  });
  it("keeps strict configuration authoritative over the branded build request", () => {
    vi.stubEnv("CC_SANDBOX_STRICT", "1");
    executionBroker.spawnSync("node", ["build.js"], options());
    expect(spawn.mock.calls[0][1]).toEqual([
      "--cpu=10",
      "--as=268435456",
      "--nofile=64",
      "--",
      "node",
      "build.js",
    ]);
  });
});
