import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executeTool } from "../../src/runtime/agent-core.js";
import {
  executionBroker,
  SANDBOX_BOUNDARIES,
} from "../../src/lib/process-execution-broker/index.js";
import { _resetPluginBinSandboxPolicyPins } from "../../src/lib/plugin-runtime/bin.js";
import { pluginVersionDir } from "../../src/lib/plugin-runtime/scopes.js";

let cwd;
let originalNative;
let originalAdapter;

function installStrictNodeBin() {
  const root = pluginVersionDir("local", "strict-bin", "1.0.0", { cwd });
  const target = path.join(root, "bin", "strict-tool.js");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "process.stdout.write('real target');\n", "utf8");
  fs.writeFileSync(
    path.join(root, "plugin.json"),
    JSON.stringify({
      name: "strict-bin",
      version: "1.0.0",
      permissions: { process: true },
      sandboxPolicy: {
        requiredBoundaries: ["filesystem", "network"],
      },
      bin: { "strict-tool": "bin/strict-tool.js" },
    }),
    "utf8",
  );
  return target;
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-bin-agent-"));
  originalNative = executionBroker._native;
  originalAdapter = executionBroker._sandboxAdapter;
  executionBroker.flushAuditLog();
  _resetPluginBinSandboxPolicyPins();
});

afterEach(() => {
  executionBroker._native = originalNative;
  executionBroker._sandboxAdapter = originalAdapter;
  executionBroker.flushAuditLog();
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe("agent-core strict plugin bin route", () => {
  it("passes an attested absolute Node target and manifest boundaries to Broker", async () => {
    const target = installStrictNodeBin();
    const nativeSpawnSync = vi.fn(() => ({
      status: 0,
      stdout: "broker-output",
      stderr: "",
    }));
    const applySandbox = vi.fn(
      (command, args, options, profile, _runtime, request) => ({
        contractVersion: 1,
        applied: true,
        platform: "test",
        profile,
        command,
        args,
        options,
        enforcement: "test-attested-sandbox",
        backend: "test-attested-sandbox",
        guarantees: [...request.requiredBoundaries],
        policyAttested: true,
        reason: null,
        postSpawn: { required: false, mode: "none" },
      }),
    );
    executionBroker._native = { spawnSync: nativeSpawnSync };
    executionBroker._sandboxAdapter = {
      applySandbox,
      postSpawnSandbox: vi.fn(),
    };

    const result = await executeTool(
      "run_shell",
      { command: `strict-tool --label "hello world"` },
      { cwd },
    );

    expect(result).toMatchObject({
      stdout: "broker-output",
      plugin_bin: {
        plugin: "strict-bin",
        name: "strict-tool",
        target,
        runtime: "node",
        identity_attested: true,
        launch_identity_reattested: true,
        direct_argv: true,
      },
    });
    expect(result.plugin_bin.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(applySandbox).toHaveBeenCalledWith(
      process.execPath,
      [target, "--label", "hello world"],
      expect.objectContaining({ shell: false }),
      "default",
      undefined,
      expect.objectContaining({
        profile: "default",
        requiredBoundaries: [
          SANDBOX_BOUNDARIES.FILESYSTEM,
          SANDBOX_BOUNDARIES.NETWORK,
        ],
      }),
    );
    expect(nativeSpawnSync).toHaveBeenCalledWith(
      process.execPath,
      [target, "--label", "hello world"],
      expect.objectContaining({ shell: false }),
    );
    const audit = executionBroker.getAuditLog(1)[0];
    expect(audit).toMatchObject({
      origin: "plugin:bin",
      pluginId: "strict-bin",
      pluginVersion: "1.0.0",
      pluginSource: path.join(
        path.dirname(path.dirname(target)),
        "plugin.json",
      ),
      pluginExecutableIdentity: {
        contractVersion: 1,
        realPath: target,
        sha256: result.plugin_bin.sha256,
        bytes: fs.statSync(target).size,
        attestation: "realpath-file-id-sha256",
      },
      sandboxRequired: ["filesystem", "network"],
      sandboxGuarantees: ["filesystem", "network"],
      sandboxPolicyAttested: true,
    });
    expect(nativeSpawnSync.mock.calls[0][2]).not.toHaveProperty(
      "pluginExecutableIdentity",
    );
  });

  it("rejects a strict compound command before any Broker native spawn", async () => {
    installStrictNodeBin();
    const nativeSpawnSync = vi.fn();
    executionBroker._native = { spawnSync: nativeSpawnSync };

    const result = await executeTool(
      "run_shell",
      { command: "strict-tool && node evil.js" },
      { cwd },
    );

    expect(result.error).toMatch(/single direct invocation/);
    expect(result.policy).toMatchObject({
      decision: "deny",
      via: "plugin-bin-direct-invocation",
      reason: "ERR_PLUGIN_BIN_COMPOUND_COMMAND",
    });
    expect(nativeSpawnSync).not.toHaveBeenCalled();
  });

  it("applies the pinned strict-bin union to an interpreter wrapper shell", async () => {
    const target = installStrictNodeBin();
    const nativeSpawnSync = vi.fn(() => ({
      status: 0,
      stdout: "wrapped-output",
      stderr: "",
    }));
    const applySandbox = vi.fn(
      (command, args, options, profile, _runtime, request) => ({
        contractVersion: 1,
        applied: true,
        platform: "test",
        profile,
        command,
        args,
        options,
        enforcement: "test-attested-sandbox",
        backend: "test-attested-sandbox",
        guarantees: [...request.requiredBoundaries],
        policyAttested: true,
        reason: null,
        postSpawn: { required: false, mode: "none" },
      }),
    );
    executionBroker._native = { spawnSync: nativeSpawnSync };
    executionBroker._sandboxAdapter = {
      applySandbox,
      postSpawnSandbox: vi.fn(),
    };

    const command = `node ${JSON.stringify(target)}`;
    const result = await executeTool("run_shell", { command }, { cwd });

    expect(result).toMatchObject({ stdout: "wrapped-output" });
    expect(result).not.toHaveProperty("plugin_bin");
    expect(applySandbox).toHaveBeenCalledWith(
      command,
      [],
      expect.objectContaining({ shell: true }),
      "default",
      undefined,
      expect.objectContaining({
        requiredBoundaries: [
          SANDBOX_BOUNDARIES.FILESYSTEM,
          SANDBOX_BOUNDARIES.NETWORK,
        ],
      }),
    );
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      origin: "tool:run_shell",
      pluginId: null,
      pluginExecutableIdentity: null,
      sandboxRequired: ["filesystem", "network"],
      sandboxGuarantees: ["filesystem", "network"],
    });
  });

  it("rejects the legacy ephemeral sandbox when a strict-bin union is pinned", async () => {
    installStrictNodeBin();
    const nativeSpawnSync = vi.fn();
    executionBroker._native = { spawnSync: nativeSpawnSync };

    const result = await executeTool(
      "run_shell",
      { command: "echo safe" },
      {
        cwd,
        sandbox: {
          filesystem: { denyRead: [], denyWrite: [] },
          network: false,
        },
      },
    );

    expect(result).toMatchObject({
      policy: {
        decision: "deny",
        via: "plugin-bin-pinned-sandbox-policy",
        reason: "conflicting_sandbox_routes",
      },
    });
    expect(result.error).toMatch(/strict plugin bin policy/);
    expect(nativeSpawnSync).not.toHaveBeenCalled();
  });
});
