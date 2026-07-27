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
  return fs.realpathSync.native(target);
}

function installStrictNativeBin() {
  const root = pluginVersionDir("local", "strict-native", "1.0.0", { cwd });
  const target = path.join(root, "bin", "strict-native-tool");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const elfHeader = Buffer.alloc(64);
  elfHeader.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]);
  elfHeader.writeUInt16LE(2, 16);
  elfHeader.writeUInt16LE(
    process.arch === "arm64" ? 183 : process.arch === "riscv64" ? 243 : 62,
    18,
  );
  elfHeader.writeUInt32LE(1, 20);
  elfHeader.writeBigUInt64LE(64n, 24);
  elfHeader.writeUInt16LE(64, 52);
  fs.writeFileSync(target, elfHeader);
  fs.chmodSync(target, 0o755);
  fs.writeFileSync(
    path.join(root, "plugin.json"),
    JSON.stringify({
      name: "strict-native",
      version: "1.0.0",
      permissions: { process: true },
      sandboxPolicy: {
        requiredBoundaries: ["filesystem", "network"],
      },
      bin: { "strict-native-tool": "bin/strict-native-tool" },
    }),
    "utf8",
  );
  return {
    root: fs.realpathSync.native(root),
    target: fs.realpathSync.native(target),
  };
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
    const pluginSource = path.join(
      pluginVersionDir("local", "strict-bin", "1.0.0", { cwd }),
      "plugin.json",
    );
    const canonicalRuntime = fs.realpathSync.native(process.execPath);
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
      process.platform === "linux" ? canonicalRuntime : process.execPath,
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
    const executionContract = applySandbox.mock.calls[0][5].executionContract;
    if (process.platform === "linux") {
      expect(executionContract).toEqual(
        expect.objectContaining({
          contractVersion: 1,
          kind: "strict-plugin-node-bin",
          pluginRoot: path.dirname(path.dirname(target)),
          workingDirectory: path.dirname(path.dirname(target)),
          runtimePath: canonicalRuntime,
          rootIdentity: expect.objectContaining({
            realPath: path.dirname(path.dirname(target)),
            fileId: {
              dev: expect.any(String),
              ino: expect.any(String),
            },
          }),
          entryIdentity: expect.objectContaining({
            realPath: target,
            sha256: result.plugin_bin.sha256,
          }),
          runtimeIdentity: expect.objectContaining({
            realPath: canonicalRuntime,
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        }),
      );
      expect(Object.isFrozen(executionContract)).toBe(true);
      expect(Object.isFrozen(executionContract.rootIdentity)).toBe(true);
      expect(Object.isFrozen(executionContract.entryIdentity)).toBe(true);
      expect(Object.isFrozen(executionContract.runtimeIdentity)).toBe(true);
    } else {
      expect(executionContract).toBeUndefined();
    }
    expect(nativeSpawnSync).toHaveBeenCalledWith(
      process.platform === "linux" ? canonicalRuntime : process.execPath,
      [target, "--label", "hello world"],
      expect.objectContaining({
        cwd:
          process.platform === "linux"
            ? path.dirname(path.dirname(target))
            : cwd,
        shell: false,
      }),
    );
    const audit = executionBroker.getAuditLog(1)[0];
    expect(audit).toMatchObject({
      origin: "plugin:bin",
      pluginId: "strict-bin",
      pluginVersion: "1.0.0",
      pluginSource,
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
    expect(nativeSpawnSync.mock.calls[0][2]).not.toHaveProperty(
      "sandboxExecutionContract",
    );
  });

  it.runIf(process.platform === "linux")(
    "passes a strict native entry, literal argv, and plugin cwd through the new contract",
    async () => {
      const { root, target } = installStrictNativeBin();
      const canonicalRuntime = fs.realpathSync.native(process.execPath);
      const nativeSpawnSync = vi.fn(() => ({
        status: 0,
        stdout: "native-broker-output",
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
          enforcement: "test-attested-native-sandbox",
          backend: "test-attested-native-sandbox",
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
        {
          command:
            'strict-native-tool --label "hello world" --mode literal-argv',
        },
        { cwd },
      );

      expect(result).toMatchObject({
        stdout: "native-broker-output",
        plugin_bin: {
          plugin: "strict-native",
          name: "strict-native-tool",
          target,
          runtime: "native",
          identity_attested: true,
          launch_identity_reattested: true,
          direct_argv: true,
        },
      });
      expect(applySandbox).toHaveBeenCalledWith(
        target,
        ["--label", "hello world", "--mode", "literal-argv"],
        expect.objectContaining({
          cwd: root,
          shell: false,
        }),
        "default",
        undefined,
        expect.objectContaining({
          profile: "default",
          requiredBoundaries: [
            SANDBOX_BOUNDARIES.FILESYSTEM,
            SANDBOX_BOUNDARIES.NETWORK,
          ],
          executionContract: expect.objectContaining({
            contractVersion: 1,
            kind: "strict-plugin-native-static-elf-bin",
            pluginRoot: root,
            workingDirectory: root,
            runtimePath: canonicalRuntime,
            entryIdentity: expect.objectContaining({
              realPath: target,
              sha256: result.plugin_bin.sha256,
            }),
            runtimeIdentity: expect.objectContaining({
              realPath: canonicalRuntime,
            }),
          }),
        }),
      );
      expect(nativeSpawnSync).toHaveBeenCalledWith(
        target,
        ["--label", "hello world", "--mode", "literal-argv"],
        expect.objectContaining({
          cwd: root,
          shell: false,
        }),
      );
      expect(nativeSpawnSync.mock.calls[0][0]).not.toBe(canonicalRuntime);
    },
  );

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

  it.runIf(process.platform === "linux")(
    "rejects a strict Plugin Node bin background launch before task registration or native spawn",
    async () => {
      installStrictNodeBin();
      const nativeSpawn = vi.fn();
      executionBroker._native = { spawn: nativeSpawn };

      const result = await executeTool(
        "run_shell",
        { command: "strict-tool", run_in_background: true },
        { cwd },
      );

      expect(result).toMatchObject({
        policy: {
          decision: "deny",
          via: "plugin-bin-pinned-sandbox-policy",
          reason: "background_execution_unsupported",
        },
        plugin_bin: {
          plugin: "strict-bin",
          name: "strict-tool",
          runtime: "node",
        },
      });
      expect(result.error).toMatch(/foreground execution only/);
      expect(result).not.toHaveProperty("task_id");
      expect(nativeSpawn).not.toHaveBeenCalled();
    },
  );

  it.runIf(process.platform === "linux")(
    "rejects a strict native background launch before task registration or native spawn",
    async () => {
      installStrictNativeBin();
      const nativeSpawn = vi.fn();
      executionBroker._native = { spawn: nativeSpawn };

      const result = await executeTool(
        "run_shell",
        { command: "strict-native-tool", run_in_background: true },
        { cwd },
      );

      expect(result).toMatchObject({
        policy: {
          decision: "deny",
          via: "plugin-bin-pinned-sandbox-policy",
          reason: "background_execution_unsupported",
        },
        plugin_bin: {
          plugin: "strict-native",
          name: "strict-native-tool",
          runtime: "native",
        },
      });
      expect(result.error).toMatch(/foreground execution only/);
      expect(result).not.toHaveProperty("task_id");
      expect(nativeSpawn).not.toHaveBeenCalled();
    },
  );

  it.runIf(process.platform === "linux")(
    "rejects an ordinary background command under the pinned strict-bin union before native spawn",
    async () => {
      installStrictNodeBin();
      const nativeSpawn = vi.fn();
      executionBroker._native = { spawn: nativeSpawn };

      const result = await executeTool(
        "run_shell",
        { command: "echo safe", run_in_background: true },
        { cwd },
      );

      expect(result).toMatchObject({
        policy: {
          decision: "deny",
          via: "plugin-bin-pinned-sandbox-policy",
          reason: "background_execution_unsupported",
        },
      });
      expect(result.error).toMatch(/foreground execution only/);
      expect(result).not.toHaveProperty("task_id");
      expect(nativeSpawn).not.toHaveBeenCalled();
    },
  );

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

  it.runIf(process.platform === "linux")(
    "rejects the legacy ephemeral sandbox for a strict native invocation",
    async () => {
      installStrictNativeBin();
      const nativeSpawnSync = vi.fn();
      executionBroker._native = { spawnSync: nativeSpawnSync };

      const result = await executeTool(
        "run_shell",
        { command: "strict-native-tool --mode sandbox-conflict" },
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
        plugin_bin: {
          plugin: "strict-native",
          name: "strict-native-tool",
          runtime: "native",
        },
      });
      expect(result.error).toMatch(/strict plugin bin policy/);
      expect(nativeSpawnSync).not.toHaveBeenCalled();
    },
  );
});
