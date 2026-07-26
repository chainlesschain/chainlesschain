import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {
  collectPluginBinCommands,
  collectPluginBinDirs,
  collectPluginBinSandboxPolicy,
  applyPluginBinPath,
  _resetPluginBinSandboxPolicyPins,
  consumeIssuedPluginNodeSandboxExecutionContract,
  createPluginNodeSandboxExecutionContract,
  parsePluginBinCommand,
  reattestPluginBinInvocation,
  resolvePluginBinCommand,
  resolvePluginBinInvocation,
  verifyIssuedPluginNodeSandboxExecutionContract,
} from "../../src/lib/plugin-runtime/bin.js";
import { pluginVersionDir } from "../../src/lib/plugin-runtime/scopes.js";
import {
  trustPlugin,
  untrustPlugin,
  _deps as trustDeps,
  _resetTrustWarnings,
} from "../../src/lib/plugin-runtime/trust.js";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";

let cwd;
let storeFile;
let savedStorePath;

function installBinPlugin(scope, name, binFiles, { manifest = {} } = {}) {
  const dir = pluginVersionDir(scope, name, "1.0.0", { cwd });
  fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plugin.json"),
    JSON.stringify({ name, version: "1.0.0", ...manifest }),
    "utf8",
  );
  for (const f of binFiles) {
    fs.writeFileSync(path.join(dir, "bin", f), "#!/bin/sh\necho hi\n", {
      encoding: "utf8",
      mode: 0o755,
    });
  }
  return path.join(dir, "bin");
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pbin-"));
  storeFile = path.join(cwd, "trust.json");
  savedStorePath = trustDeps.storePath;
  trustDeps.storePath = () => storeFile;
  _resetTrustWarnings();
  _resetPluginBinSandboxPolicyPins();
});
afterEach(() => {
  trustDeps.storePath = savedStorePath;
  try {
    fs.rmSync(cwd, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("collectPluginBinDirs — component-level capability gate", () => {
  it("refuses a bin dir when the plugin declared permissions but not 'process'", () => {
    installBinPlugin("local", "p", ["tool"], {
      manifest: { permissions: {} }, // opted in, but no process capability
    });
    expect(collectPluginBinDirs({ cwd, scopes: ["local"] })).toEqual([]);
  });

  it("allows the bin dir once 'process' is declared", () => {
    installBinPlugin("local", "p", ["tool"], {
      manifest: { permissions: { process: true } },
    });
    expect(collectPluginBinDirs({ cwd, scopes: ["local"] })).toHaveLength(1);
  });

  it("a legacy plugin (no permissions block) is unaffected", () => {
    installBinPlugin("local", "p", ["tool"]);
    expect(collectPluginBinDirs({ cwd, scopes: ["local"] })).toHaveLength(1);
  });
});

describe("collectPluginBinDirs", () => {
  it("returns a trusted plugin's bin dir (deduped per dir)", () => {
    const binDir = installBinPlugin("local", "toolkit", ["a", "b"]);
    const dirs = collectPluginBinDirs({ cwd, scopes: ["local"] });
    expect(dirs).toHaveLength(1); // two bins, one dir
    expect(dirs[0].dir).toBe(binDir);
    expect(dirs[0].plugin).toBe("toolkit");
  });

  it("returns [] when no plugin ships a bin", () => {
    const dir = pluginVersionDir("local", "nobins", "1.0.0", { cwd });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "plugin.json"),
      JSON.stringify({ name: "nobins", version: "1.0.0" }),
      "utf8",
    );
    expect(collectPluginBinDirs({ cwd, scopes: ["local"] })).toEqual([]);
  });

  it("trust-gates: an untrusted project plugin contributes no bin dir until trusted", () => {
    installBinPlugin("project", "toolkit", ["a"]);
    expect(collectPluginBinDirs({ cwd, scopes: ["project"] })).toEqual([]);
    trustPlugin("toolkit", { scope: "project", version: "1.0.0" });
    expect(collectPluginBinDirs({ cwd, scopes: ["project"] })).toHaveLength(1);
  });
});

describe("applyPluginBinPath", () => {
  it("preserves PATH compatibility for a legacy bin", () => {
    const binDir = installBinPlugin("local", "toolkit", ["mytool"]);
    const env = { PATH: "/usr/bin" };
    const res = applyPluginBinPath({ cwd, scopes: ["local"], env });
    expect(res.added).toEqual([binDir]);
    expect(env.PATH.split(path.delimiter)[0]).toBe(binDir);
    res.restore();
    expect(env.PATH).toBe("/usr/bin");
  });

  it("never exposes a policy-bearing bin directory through PATH", () => {
    installBinPlugin("local", "toolkit", ["mytool"], {
      manifest: {
        sandboxPolicy: { requiredBoundaries: ["filesystem"] },
      },
    });
    const env = { PATH: "/usr/bin" };
    const res = applyPluginBinPath({ cwd, scopes: ["local"], env });
    expect(res.added).toEqual([]);
    expect(env.PATH).toBe("/usr/bin");
  });

  it("excludes a whole mixed directory so a strict sibling cannot leak", () => {
    const dir = pluginVersionDir("local", "toolkit", "1.0.0", { cwd });
    fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
    fs.writeFileSync(path.join(dir, "bin", "legacy.js"), "", "utf8");
    fs.writeFileSync(path.join(dir, "bin", "strict.js"), "", "utf8");
    fs.writeFileSync(
      path.join(dir, "plugin.json"),
      JSON.stringify({
        name: "toolkit",
        version: "1.0.0",
        bin: {
          legacy: "bin/legacy.js",
          strict: {
            path: "bin/strict.js",
            sandboxPolicy: { requiredBoundaries: ["network"] },
          },
        },
      }),
      "utf8",
    );
    const env = { PATH: "/usr/bin" };
    const res = applyPluginBinPath({ cwd, scopes: ["local"], env });
    expect(res.added).toEqual([]);
    expect(env.PATH).toBe("/usr/bin");
  });

  it("is a no-op (empty added) when nothing is installed", () => {
    const env = { PATH: "/usr/bin" };
    const res = applyPluginBinPath({ cwd, scopes: ["local"], env });
    expect(res.added).toEqual([]);
    expect(env.PATH).toBe("/usr/bin");
    expect(() => res.restore()).not.toThrow();
  });

  it("does not rewrite an existing PATH entry", () => {
    const binDir = installBinPlugin("local", "toolkit", ["mytool"]);
    const env = { PATH: `${binDir}${path.delimiter}/usr/bin` };
    const res = applyPluginBinPath({ cwd, scopes: ["local"], env });
    expect(res.added).toEqual([]);
    expect(env.PATH).toBe(`${binDir}${path.delimiter}/usr/bin`);
  });
});

describe("collectPluginBinSandboxPolicy", () => {
  it("pins a tighten-only union when a strict manifest is weakened on disk", () => {
    const binDir = installBinPlugin("local", "toolkit", ["mytool"], {
      manifest: {
        sandboxPolicy: { requiredBoundaries: ["filesystem", "network"] },
      },
    });
    expect(collectPluginBinSandboxPolicy({ cwd, scopes: ["local"] })).toEqual({
      requiredBoundaries: ["filesystem", "network"],
    });

    fs.writeFileSync(
      path.join(path.dirname(binDir), "plugin.json"),
      JSON.stringify({
        name: "toolkit",
        version: "1.0.0",
        bin: { mytool: "bin/mytool" },
      }),
      "utf8",
    );
    expect(collectPluginBinSandboxPolicy({ cwd, scopes: ["local"] })).toEqual({
      requiredBoundaries: ["filesystem", "network"],
    });
  });

  it("fails closed when an installed manifest cannot be loaded safely", () => {
    const binDir = installBinPlugin("local", "broken", ["mytool"]);
    fs.writeFileSync(
      path.join(path.dirname(binDir), "plugin.json"),
      "{ invalid json",
      "utf8",
    );

    expect(() =>
      collectPluginBinSandboxPolicy({ cwd, scopes: ["local"] }),
    ).toThrow(/plugin bin policy discovery failed/);
  });
});

describe("parsePluginBinCommand", () => {
  it("parses quoted arguments into literal argv", () => {
    expect(
      parsePluginBinCommand(`mytool --label "hello world" 'semi;literal'`),
    ).toEqual(["mytool", "--label", "hello world", "semi;literal"]);
  });

  it.each([
    "mytool && node evil.js",
    "mytool | node evil.js",
    "mytool; node evil.js",
    "mytool $(node evil.js)",
    "mytool\nnode evil.js",
  ])("rejects shell composition: %s", (command) => {
    expect(() => parsePluginBinCommand(command)).toThrow(
      /single direct invocation|command substitution/,
    );
  });
});

describe("resolvePluginBinCommand", () => {
  it("returns provenance for a trusted plugin executable token", () => {
    const binDir = installBinPlugin("local", "toolkit", ["mytool"]);
    const target = fs.realpathSync.native(path.join(binDir, "mytool"));
    expect(
      resolvePluginBinCommand("mytool --version", {
        cwd,
        scopes: ["local"],
      }),
    ).toMatchObject({
      pluginId: "toolkit",
      pluginVersion: "1.0.0",
      binPath: target,
    });
  });

  it("does not attribute an ordinary command or an untrusted plugin", () => {
    installBinPlugin("project", "toolkit", ["mytool"]);
    expect(
      resolvePluginBinCommand("mytool", {
        cwd,
        scopes: ["project"],
      }),
    ).toBeNull();
    expect(
      resolvePluginBinCommand("node --version", {
        cwd,
        scopes: ["local"],
      }),
    ).toBeNull();
  });
});

describe("resolvePluginBinInvocation", () => {
  it("resolves a declared alias to exact argv and attests a Node target", () => {
    const dir = pluginVersionDir("local", "toolkit", "1.0.0", { cwd });
    fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
    const source = "process.stdout.write(process.argv.slice(2).join('|'));\n";
    fs.writeFileSync(path.join(dir, "bin", "entry.js"), source, "utf8");
    fs.writeFileSync(
      path.join(dir, "plugin.json"),
      JSON.stringify({
        name: "toolkit",
        version: "1.0.0",
        permissions: { process: true },
        sandboxPolicy: { requiredBoundaries: ["filesystem"] },
        bin: { mytool: "bin/entry.js" },
      }),
      "utf8",
    );
    const target = fs.realpathSync.native(path.join(dir, "bin", "entry.js"));

    const invocation = resolvePluginBinInvocation(
      `mytool --label "hello world"`,
      { cwd, scopes: ["local"] },
    );

    expect(invocation).toMatchObject({
      command: process.execPath,
      args: [target, "--label", "hello world"],
      shell: false,
      runtime: "node",
      pluginId: "toolkit",
      binName: "mytool",
      sandboxPolicy: { requiredBoundaries: ["filesystem"] },
      executableIdentity: {
        realPath: target,
        bytes: Buffer.byteLength(source),
      },
    });
    expect(invocation.executableIdentity.sha256).toMatch(/^[a-f0-9]{64}$/);

    const contract = createPluginNodeSandboxExecutionContract(invocation);
    const canonicalRuntime = fs.realpathSync.native(process.execPath);
    const provenance = {
      origin: "plugin:bin",
      command: canonicalRuntime,
      args: invocation.args,
      cwd: contract.workingDirectory,
      pluginId: invocation.pluginId,
      pluginVersion: invocation.pluginVersion,
      pluginSource: invocation.pluginSource,
      pluginExecutableIdentity: invocation.executableIdentity,
      requiredBoundaries: ["filesystem"],
      sync: true,
    };
    expect(contract).toMatchObject({
      rootIdentity: {
        realPath: fs.realpathSync.native(dir),
        dev: expect.any(String),
        ino: expect.any(String),
      },
      runtimePath: canonicalRuntime,
      runtimeIdentity: {
        requestedPath: path.resolve(process.execPath),
        realPath: canonicalRuntime,
      },
    });
    expect(Object.isFrozen(contract)).toBe(true);
    expect(
      verifyIssuedPluginNodeSandboxExecutionContract(contract, provenance),
    ).toBe(true);
    expect(() => createPluginNodeSandboxExecutionContract(invocation)).toThrow(
      /resolver-issued invocation/,
    );
    expect(
      verifyIssuedPluginNodeSandboxExecutionContract(
        Object.freeze({ ...contract }),
        provenance,
      ),
    ).toBe(false);
    expect(() =>
      createPluginNodeSandboxExecutionContract(
        Object.freeze({ ...invocation }),
      ),
    ).toThrow(/resolver-issued invocation/);
    expect(
      consumeIssuedPluginNodeSandboxExecutionContract(contract, provenance),
    ).toBe(true);
    expect(
      consumeIssuedPluginNodeSandboxExecutionContract(contract, provenance),
    ).toBe(false);
  });

  it("refuses contract issuance after the resolver trust decision is revoked", () => {
    installBinPlugin("project", "toolkit", ["entry.js"], {
      manifest: {
        permissions: { process: true },
        sandboxPolicy: { requiredBoundaries: ["filesystem"] },
        bin: { mytool: "bin/entry.js" },
      },
    });
    trustPlugin("toolkit", {
      scope: "project",
      version: "1.0.0",
    });
    const invocation = resolvePluginBinInvocation("mytool --safe", {
      cwd,
      scopes: ["project"],
    });
    expect(invocation).toMatchObject({
      pluginId: "toolkit",
      runtime: "node",
    });

    untrustPlugin("toolkit", { scope: "project" });

    expect(() => createPluginNodeSandboxExecutionContract(invocation)).toThrow(
      expect.objectContaining({
        code: "ERR_PLUGIN_NODE_SANDBOX_CONTRACT_STALE",
        pluginBinFailClosed: true,
      }),
    );
    expect(() => createPluginNodeSandboxExecutionContract(invocation)).toThrow(
      /resolver-issued invocation/,
    );
  });

  it("fails closed rather than accepting a compound plugin command", () => {
    installBinPlugin("local", "toolkit", ["mytool"], {
      manifest: {
        sandboxPolicy: { requiredBoundaries: ["filesystem"] },
      },
    });
    expect(() =>
      resolvePluginBinInvocation("mytool && node evil.js", {
        cwd,
        scopes: ["local"],
      }),
    ).toThrow(/single direct invocation/);
  });

  it("rejects a real issued contract on the Broker async path before execution", () => {
    const dir = pluginVersionDir("local", "toolkit", "1.0.0", { cwd });
    const entryPath = path.join(dir, "bin", "entry.js");
    fs.mkdirSync(path.dirname(entryPath), { recursive: true });
    fs.writeFileSync(entryPath, "process.stdout.write('ready');\n", "utf8");
    fs.writeFileSync(
      path.join(dir, "plugin.json"),
      JSON.stringify({
        name: "toolkit",
        version: "1.0.0",
        permissions: { process: true },
        sandboxPolicy: {
          requiredBoundaries: ["filesystem", "network"],
        },
        bin: { mytool: "bin/entry.js" },
      }),
      "utf8",
    );
    const invocation = resolvePluginBinInvocation("mytool --safe", {
      cwd,
      scopes: ["local"],
    });
    const contract = createPluginNodeSandboxExecutionContract(invocation);
    const provenance = {
      origin: "plugin:bin",
      command: contract.runtimePath,
      args: invocation.args,
      cwd: contract.workingDirectory,
      pluginId: invocation.pluginId,
      pluginVersion: invocation.pluginVersion,
      pluginSource: invocation.pluginSource,
      pluginExecutableIdentity: invocation.executableIdentity,
      requiredBoundaries: invocation.sandboxPolicy.requiredBoundaries,
      sync: true,
    };
    const originalNative = executionBroker._native;
    const originalAdapter = executionBroker._sandboxAdapter;
    const nativeSpawn = vi.fn();
    const applySandbox = vi.fn();
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox,
      postSpawnSandbox: vi.fn(),
    };
    executionBroker.flushAuditLog();

    try {
      expect(() =>
        executionBroker.spawn(contract.runtimePath, invocation.args, {
          cwd: contract.workingDirectory,
          origin: "plugin:bin",
          policy: "allow",
          scope: "agent",
          shell: false,
          pluginId: invocation.pluginId,
          pluginVersion: invocation.pluginVersion,
          pluginSource: invocation.pluginSource,
          pluginExecutableIdentity: invocation.executableIdentity,
          sandboxPolicy: invocation.sandboxPolicy,
          sandboxExecutionContract: contract,
        }),
      ).toThrow(
        expect.objectContaining({
          code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
          sandboxReason: "invalid_sandbox_execution_contract",
          sandboxFailClosed: true,
        }),
      );
      expect(applySandbox).not.toHaveBeenCalled();
      expect(nativeSpawn).not.toHaveBeenCalled();
      expect(
        verifyIssuedPluginNodeSandboxExecutionContract(contract, provenance),
      ).toBe(true);
    } finally {
      consumeIssuedPluginNodeSandboxExecutionContract(contract, provenance);
      executionBroker._native = originalNative;
      executionBroker._sandboxAdapter = originalAdapter;
      executionBroker.flushAuditLog();
    }
  });

  it("recognizes a strict alias assembled from adjacent quoted segments", () => {
    installBinPlugin("local", "toolkit", ["mytool"], {
      manifest: {
        sandboxPolicy: { requiredBoundaries: ["filesystem"] },
      },
    });
    const invocation = resolvePluginBinInvocation(`""my"tool" --safe`, {
      cwd,
      scopes: ["local"],
    });
    expect(invocation).toMatchObject({
      binName: "mytool",
      args: ["--safe"],
      shell: false,
      sandboxPolicy: { requiredBoundaries: ["filesystem"] },
    });
  });

  it("preserves legacy compound commands for the historical PATH route", () => {
    installBinPlugin("local", "toolkit", ["mytool"]);
    expect(
      resolvePluginBinInvocation("mytool && node legacy.js", {
        cwd,
        scopes: ["local"],
      }),
    ).toBeNull();
  });

  it("fails closed on duplicate trusted aliases", () => {
    const first = pluginVersionDir("local", "one", "1.0.0", { cwd });
    const second = pluginVersionDir("local", "two", "1.0.0", { cwd });
    for (const [dir, name] of [
      [first, "one"],
      [second, "two"],
    ]) {
      fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
      fs.writeFileSync(path.join(dir, "bin", "entry.js"), "", "utf8");
      fs.writeFileSync(
        path.join(dir, "plugin.json"),
        JSON.stringify({
          name,
          version: "1.0.0",
          sandboxPolicy: { requiredBoundaries: ["filesystem"] },
          bin: { collide: "bin/entry.js" },
        }),
        "utf8",
      );
    }
    expect(() =>
      resolvePluginBinInvocation("collide", {
        cwd,
        scopes: ["local"],
      }),
    ).toThrow(/multiple trusted plugins/);
  });

  it("collects exact aliases instead of every sibling file in a bin dir", () => {
    const dir = pluginVersionDir("local", "toolkit", "1.0.0", { cwd });
    fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
    fs.writeFileSync(path.join(dir, "bin", "entry.js"), "", "utf8");
    fs.writeFileSync(path.join(dir, "bin", "undeclared.js"), "", "utf8");
    fs.writeFileSync(
      path.join(dir, "plugin.json"),
      JSON.stringify({
        name: "toolkit",
        version: "1.0.0",
        bin: { declared: "bin/entry.js" },
      }),
      "utf8",
    );

    expect(
      collectPluginBinCommands({ cwd, scopes: ["local"] }).map((b) => b.name),
    ).toEqual(["declared"]);
    expect(
      resolvePluginBinInvocation("undeclared.js", {
        cwd,
        scopes: ["local"],
      }),
    ).toBeNull();
  });

  it.runIf(process.platform === "win32")(
    "refuses cmd/bat/PowerShell wrappers that require another shell",
    () => {
      installBinPlugin("local", "toolkit", ["wrapper.cmd"], {
        manifest: {
          sandboxPolicy: { requiredBoundaries: ["filesystem"] },
        },
      });
      expect(() =>
        resolvePluginBinInvocation("wrapper.cmd", {
          cwd,
          scopes: ["local"],
        }),
      ).toThrow(/wrapper \.cmd is not supported/);
    },
  );

  it.runIf(process.platform === "win32")(
    "accepts the optional .exe suffix for a manifest alias",
    () => {
      const dir = pluginVersionDir("local", "toolkit", "1.0.0", { cwd });
      const target = path.join(dir, "bin", "native.exe");
      fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
      fs.writeFileSync(target, "MZ", "utf8");
      fs.writeFileSync(
        path.join(dir, "plugin.json"),
        JSON.stringify({
          name: "toolkit",
          version: "1.0.0",
          sandboxPolicy: { requiredBoundaries: ["filesystem"] },
          bin: { mytool: "bin/native.exe" },
        }),
        "utf8",
      );

      expect(
        resolvePluginBinInvocation("mytool.exe --version", {
          cwd,
          scopes: ["local"],
        }),
      ).toMatchObject({
        command: fs.realpathSync.native(target),
        args: ["--version"],
        runtime: "native",
      });
    },
  );

  it("detects a target mutation in the second pre-launch attestation", () => {
    const dir = pluginVersionDir("local", "toolkit", "1.0.0", { cwd });
    fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
    const target = path.join(dir, "bin", "entry.js");
    fs.writeFileSync(target, "process.stdout.write('before');\n", "utf8");
    fs.writeFileSync(
      path.join(dir, "plugin.json"),
      JSON.stringify({
        name: "toolkit",
        version: "1.0.0",
        sandboxPolicy: { requiredBoundaries: ["filesystem"] },
        bin: { mytool: "bin/entry.js" },
      }),
      "utf8",
    );
    const invocation = resolvePluginBinInvocation("mytool", {
      cwd,
      scopes: ["local"],
    });

    fs.writeFileSync(target, "process.stdout.write('after');\n", "utf8");

    expect(() => reattestPluginBinInvocation(invocation)).toThrow(
      /identity changed before launch/,
    );
  });

  it("detects a same-content path replacement with a different inode", () => {
    const dir = pluginVersionDir("local", "toolkit", "1.0.0", { cwd });
    const binDir = path.join(dir, "bin");
    const target = path.join(binDir, "entry.js");
    const replacement = path.join(binDir, "replacement.js");
    const displaced = path.join(binDir, "displaced.js");
    const source = "process.stdout.write('same');\n";
    const fixedTime = new Date("2024-01-01T00:00:00.000Z");
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(target, source, "utf8");
    fs.writeFileSync(replacement, source, "utf8");
    fs.utimesSync(target, fixedTime, fixedTime);
    fs.utimesSync(replacement, fixedTime, fixedTime);
    fs.writeFileSync(
      path.join(dir, "plugin.json"),
      JSON.stringify({
        name: "toolkit",
        version: "1.0.0",
        sandboxPolicy: { requiredBoundaries: ["filesystem"] },
        bin: { mytool: "bin/entry.js" },
      }),
      "utf8",
    );
    const targetStat = fs.statSync(target, { bigint: true });
    const replacementStat = fs.statSync(replacement, { bigint: true });
    expect(replacementStat.dev).toBe(targetStat.dev);
    expect(replacementStat.ino).not.toBe(targetStat.ino);
    expect(replacementStat.size).toBe(targetStat.size);
    expect(replacementStat.mtimeMs).toBe(targetStat.mtimeMs);

    const invocation = resolvePluginBinInvocation("mytool", {
      cwd,
      scopes: ["local"],
    });
    fs.renameSync(target, displaced);
    fs.renameSync(replacement, target);

    expect(fs.readFileSync(target, "utf8")).toBe(source);
    expect(() => reattestPluginBinInvocation(invocation)).toThrow(
      /identity changed before launch \(ino\)/,
    );
  });

  it("rejects a policy-bearing target that resolves outside its plugin root", () => {
    const dir = pluginVersionDir("local", "toolkit", "1.0.0", { cwd });
    const outside = path.join(cwd, "outside-bin");
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "entry.js"), "", "utf8");
    fs.symlinkSync(
      outside,
      path.join(dir, "bin"),
      process.platform === "win32" ? "junction" : "dir",
    );
    fs.writeFileSync(
      path.join(dir, "plugin.json"),
      JSON.stringify({
        name: "toolkit",
        version: "1.0.0",
        sandboxPolicy: { requiredBoundaries: ["filesystem"] },
        bin: { mytool: "bin/entry.js" },
      }),
      "utf8",
    );

    expect(() =>
      resolvePluginBinInvocation("mytool", {
        cwd,
        scopes: ["local"],
      }),
    ).toThrow(/resolves outside the plugin root/);
  });

  it("rejects a policy-bearing hard-linked target", () => {
    const dir = pluginVersionDir("local", "toolkit", "1.0.0", { cwd });
    const outside = path.join(cwd, "outside.js");
    fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
    fs.writeFileSync(outside, "", "utf8");
    fs.linkSync(outside, path.join(dir, "bin", "entry.js"));
    fs.writeFileSync(
      path.join(dir, "plugin.json"),
      JSON.stringify({
        name: "toolkit",
        version: "1.0.0",
        sandboxPolicy: { requiredBoundaries: ["filesystem"] },
        bin: { mytool: "bin/entry.js" },
      }),
      "utf8",
    );

    expect(() =>
      resolvePluginBinInvocation("mytool", {
        cwd,
        scopes: ["local"],
      }),
    ).toThrow(/must not be hard-linked/);
  });
});
