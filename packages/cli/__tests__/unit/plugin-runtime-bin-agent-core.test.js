import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  _agentToolProcessDeps,
  _backgroundProcessDeps,
  executeTool,
  killAllBackgroundShellTasksSync,
} from "../../src/runtime/agent-core.js";
import {
  executionBroker,
  SANDBOX_BOUNDARIES,
} from "../../src/lib/process-execution-broker/index.js";
import { _resetPluginBinSandboxPolicyPins } from "../../src/lib/plugin-runtime/bin.js";
import { pluginVersionDir } from "../../src/lib/plugin-runtime/scopes.js";

let cwd;
let originalNative;
let originalAdapter;
let originalRunCode;
let originalBackgroundPlatform;

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

function installMalformedPlugin() {
  const root = pluginVersionDir("local", "broken-run-code", "1.0.0", {
    cwd,
  });
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "plugin.json"), "{", "utf8");
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-bin-agent-"));
  originalNative = executionBroker._native;
  originalAdapter = executionBroker._sandboxAdapter;
  originalRunCode = _agentToolProcessDeps.runCode;
  originalBackgroundPlatform = _backgroundProcessDeps.platform;
  executionBroker.flushAuditLog();
  _resetPluginBinSandboxPolicyPins();
});

afterEach(() => {
  killAllBackgroundShellTasksSync();
  executionBroker._native = originalNative;
  executionBroker._sandboxAdapter = originalAdapter;
  _agentToolProcessDeps.runCode = originalRunCode;
  _backgroundProcessDeps.platform = originalBackgroundPlatform;
  executionBroker.flushAuditLog();
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe("agent-core strict plugin bin route", () => {
  it("applies the pinned strict Plugin workspace union to run_code", async () => {
    installStrictNodeBin();
    _agentToolProcessDeps.runCode = vi.fn(() => "run-code-output");

    const result = await executeTool(
      "run_code",
      { language: "node", code: "process.stdout.write('ok')" },
      { cwd },
    );

    expect(result).toMatchObject({
      success: true,
      output: "run-code-output",
    });
    expect(_agentToolProcessDeps.runCode).toHaveBeenCalledWith(
      "node",
      [expect.stringMatching(/cc-agent-\d+\.js$/)],
      expect.objectContaining({
        cwd,
        origin: "agent-core:run-code",
        policy: "allow",
        scope: "agent-core",
        shell: false,
        sandboxPolicy: {
          requiredBoundaries: ["filesystem", "network"],
        },
      }),
    );
  });

  it("fails closed before run_code persists a script or reaches Broker when Plugin policy discovery fails", async () => {
    installMalformedPlugin();
    _agentToolProcessDeps.runCode = vi.fn();

    const result = await executeTool(
      "run_code",
      {
        language: "node",
        code: "process.stdout.write('must-not-run')",
        persist: true,
      },
      { cwd },
    );

    expect(result).toMatchObject({
      policy: {
        decision: "deny",
        via: "plugin-bin-pinned-sandbox-policy",
        reason: "ERR_PLUGIN_BIN_DISCOVERY_FAILED",
      },
    });
    expect(result.error).toMatch(/plugin bin policy discovery failed/);
    expect(
      fs.existsSync(path.join(cwd, ".chainlesschain", "agent-scripts")),
    ).toBe(false);
    expect(_agentToolProcessDeps.runCode).not.toHaveBeenCalled();
  });

  it("preserves Broker's structured boundary refusal from run_code", async () => {
    installStrictNodeBin();
    const boundaryError = Object.assign(
      new Error("strict backend cannot satisfy filesystem, network"),
      {
        code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
        sandboxFailClosed: true,
        requiredBoundaries: ["filesystem", "network"],
        actualGuarantees: ["filesystem"],
        missingBoundaries: ["network"],
        sandboxBackend: "test-strict-backend",
      },
    );
    let scriptPath;
    _agentToolProcessDeps.runCode = vi.fn((_file, args) => {
      [scriptPath] = args;
      throw boundaryError;
    });

    await expect(
      executeTool(
        "run_code",
        { language: "node", code: "process.stdout.write('must-not-run')" },
        { cwd },
      ),
    ).rejects.toBe(boundaryError);
    expect(scriptPath).toMatch(/cc-agent-\d+\.js$/);
    expect(fs.existsSync(scriptPath)).toBe(false);
  });

  it("preserves Broker's generic sandbox startup failure from run_code", async () => {
    installStrictNodeBin();
    const sandboxError = Object.assign(
      new Error("strict backend startup failed"),
      {
        code: "ERR_PROCESS_SANDBOX",
        sandboxBackend: "test-strict-backend",
      },
    );
    _agentToolProcessDeps.runCode = vi.fn(() => {
      throw sandboxError;
    });

    await expect(
      executeTool(
        "run_code",
        { language: "node", code: "process.stdout.write('must-not-run')" },
        { cwd },
      ),
    ).rejects.toBe(sandboxError);
  });

  it("passes an attested absolute Node target and manifest boundaries to Broker", async () => {
    const supportsNodeExecutionContract =
      process.platform === "linux" || process.platform === "win32";
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
      supportsNodeExecutionContract ? canonicalRuntime : process.execPath,
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
    if (supportsNodeExecutionContract) {
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
      supportsNodeExecutionContract ? canonicalRuntime : process.execPath,
      [target, "--label", "hello world"],
      expect.objectContaining({
        cwd: supportsNodeExecutionContract
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
            kind: "strict-plugin-native-elf-bin",
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

  it.runIf(process.platform === "win32")(
    "rejects a strict Plugin Node bin background launch before task registration or native spawn on Windows",
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

  it.runIf(process.platform === "linux" || process.platform === "win32")(
    "runs a strict Plugin Node bin background launch through one async direct contract",
    async () => {
      _backgroundProcessDeps.platform = () => "linux";
      const target = installStrictNodeBin();
      const pluginRoot = fs.realpathSync.native(
        path.dirname(path.dirname(target)),
      );
      const child = new EventEmitter();
      child.pid = 44001;
      child.killed = false;
      child.stdout = Object.assign(new EventEmitter(), {
        setEncoding: vi.fn(),
        destroy: vi.fn(),
      });
      child.stderr = Object.assign(new EventEmitter(), {
        setEncoding: vi.fn(),
        destroy: vi.fn(),
      });
      child.kill = vi.fn((signal) => {
        child.killed = true;
        child.emit("exit", null, signal);
        child.emit("close", null, signal);
        return true;
      });
      const nativeSpawn = vi.fn(() => child);
      const cleanup = vi.fn();
      const applySandbox = vi.fn(
        (command, launchArgs, options, profile, _runtime, request) => ({
          contractVersion: 1,
          applied: true,
          platform: "linux",
          profile,
          command,
          args: launchArgs,
          options,
          enforcement: "linux-bwrap",
          backend: "linux-bwrap",
          guarantees: [...request.requiredBoundaries],
          policyAttested: true,
          reason: null,
          postSpawn: { required: false, mode: "none" },
          cleanup,
        }),
      );
      executionBroker._native = { spawn: nativeSpawn };
      executionBroker._sandboxAdapter = {
        applySandbox,
        postSpawnSandbox: vi.fn(),
      };

      const result = await executeTool(
        "run_shell",
        { command: "strict-tool --safe", run_in_background: true },
        { cwd },
      );

      expect(result).toMatchObject({
        background: true,
        status: "running",
        plugin_bin: {
          plugin: "strict-bin",
          name: "strict-tool",
          runtime: "node",
          target,
          launch_identity_reattested: true,
        },
      });
      expect(result.task_id).toMatch(/^bg_/);
      expect(applySandbox).toHaveBeenCalledWith(
        fs.realpathSync.native(process.execPath),
        [target, "--safe"],
        expect.objectContaining({
          cwd: pluginRoot,
          shell: false,
          detached: false,
        }),
        "default",
        undefined,
        expect.objectContaining({
          requiredBoundaries: ["filesystem", "network"],
          sync: false,
          executionContract: expect.objectContaining({
            kind: "strict-plugin-node-bin",
          }),
        }),
      );
      expect(nativeSpawn).toHaveBeenCalledTimes(1);
      expect(killAllBackgroundShellTasksSync()).toBeGreaterThanOrEqual(1);
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
      expect(cleanup).toHaveBeenCalledTimes(1);
    },
  );

  it.runIf(process.platform === "win32")(
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
