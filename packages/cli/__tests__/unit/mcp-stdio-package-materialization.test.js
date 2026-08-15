import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";
import {
  consumeMcpStdioExecutionAuthority,
  issueMcpStdioExecutionAuthority,
  materializeApprovedMcpStdioInvocation,
  resolveMcpStdioExecutionApproval,
} from "../../src/lib/mcp-stdio-execution-authority.js";
import {
  consumeMcpStdioExecutableIdentityAuthority,
  MCP_STDIO_CAPSULE_REQUIRED_BOUNDARIES,
  MCP_STDIO_CAPSULE_SANDBOX_CONTRACT_KIND,
  MCP_STDIO_EXECUTABLE_CHANGED_CODE,
  prepareMcpStdioExecutableIdentity,
} from "../../src/lib/mcp-stdio-executable-identity.js";
import {
  _deps,
  esbuildRelativeEntrypointArg,
  materializeMcpStdioNpmPackage,
  MCP_STDIO_PACKAGE_MATERIALIZATION_CHANGED_CODE,
  MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED_CODE,
  MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
  parseExactNpmPackageSpec,
  parseNpmPackageLauncherInvocation,
  parseNpxMaterializationInvocation,
  resolveMcpStdioPackageMaterialization,
} from "../../src/lib/mcp-stdio-package-materialization.js";

const roots = [];
const nativeWorker = _deps.Worker;

function useScriptedWorker(script) {
  const instances = [];
  _deps.Worker = class ScriptedWorker extends EventEmitter {
    constructor(source, options) {
      super();
      this.source = source;
      this.options = options;
      this.terminated = false;
      instances.push(this);
      queueMicrotask(() => script(this, options.workerData));
    }

    async terminate() {
      this.terminated = true;
      return 1;
    }
  };
  return instances;
}

function successfulWorkerResult(workerData, overrides = {}) {
  const loaded = workerData.files.map(([file]) => file).sort();
  const inputs = Object.fromEntries(
    workerData.files.map(([file, contents]) => [
      `cc-immutable-vfs:${file}`,
      { bytes: contents.byteLength, imports: [] },
    ]),
  );
  return {
    ok: true,
    nonce: workerData.nonce,
    output: new TextEncoder().encode('"use strict";\n'),
    metafile: {
      inputs,
      outputs: {
        "/chainlesschain-output/server.cjs": { imports: [] },
      },
    },
    warnings: [],
    audit: {
      root: workerData.vfsRoot,
      fileCount: workerData.fileCount,
      loaded,
      resolutions: [],
    },
    ...overrides,
  };
}

function overrideStat(stat, overrides) {
  return new Proxy(stat, {
    get(target, property) {
      if (Object.prototype.hasOwnProperty.call(overrides, property)) {
        return overrides[property];
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function createAssetTamperingFs({
  matches,
  onRead,
  onDescriptorStat,
  onPathStat,
}) {
  const descriptors = new Map();
  return new Proxy(fs, {
    get(target, property) {
      if (property === "openSync") {
        return (file, ...args) => {
          const descriptor = fs.openSync(file, ...args);
          if (matches(String(file))) descriptors.set(descriptor, String(file));
          return descriptor;
        };
      }
      if (property === "closeSync") {
        return (descriptor) => {
          descriptors.delete(descriptor);
          return fs.closeSync(descriptor);
        };
      }
      if (property === "readSync") {
        return (descriptor, buffer, offset, length, position) => {
          const count = fs.readSync(
            descriptor,
            buffer,
            offset,
            length,
            position,
          );
          const file = descriptors.get(descriptor);
          if (file && onRead) {
            onRead({ file, buffer, offset, count, position });
          }
          return count;
        };
      }
      if (property === "fstatSync") {
        return (descriptor, options) => {
          const stat = fs.fstatSync(descriptor, options);
          const file = descriptors.get(descriptor);
          return file && onDescriptorStat ? onDescriptorStat(file, stat) : stat;
        };
      }
      if (property === "lstatSync") {
        return (file, options) => {
          const stat = fs.lstatSync(file, options);
          return matches(String(file)) && onPathStat
            ? onPathStat(String(file), stat)
            : stat;
        };
      }
      return Reflect.get(target, property, target);
    },
  });
}

it("binds the canonical entrypoint to an esbuild stdin source label", () => {
  const snapshotRoot = path.resolve("capsule-snapshot-root");
  const canonicalEntrypoint = path.join(
    snapshotRoot,
    "node_modules",
    "@scope",
    "mcp-server",
    "bin",
    "server.js",
  );
  expect(
    esbuildRelativeEntrypointArg(
      "node_modules/@scope/mcp-server/bin/server.js",
      snapshotRoot,
      canonicalEntrypoint,
    ),
  ).toBe("node_modules/@scope/mcp-server/bin/server.js");
  for (const unsafe of [
    "",
    ".",
    "../outside.js",
    "node_modules/../outside.js",
    "./node_modules/package/server.js",
    "node_modules\\package\\server.js",
    "/node_modules/package/server.js",
    "C:/node_modules/package/server.js",
    "node_modules/package/server.js\0ignored",
  ]) {
    expect(() =>
      esbuildRelativeEntrypointArg(unsafe, snapshotRoot, canonicalEntrypoint),
    ).toThrow(
      "MCP capsule entrypoint must be one canonical relative POSIX path",
    );
  }
  for (const unsafeRoot of [
    "relative-snapshot",
    `${snapshotRoot}${path.sep}.`,
    `${snapshotRoot}\0ignored`,
  ]) {
    expect(() =>
      esbuildRelativeEntrypointArg(
        "node_modules/@scope/mcp-server/bin/server.js",
        unsafeRoot,
        canonicalEntrypoint,
      ),
    ).toThrow("MCP capsule snapshot root must be canonical and absolute");
  }
  expect(() =>
    esbuildRelativeEntrypointArg(
      "node_modules/@scope/mcp-server/bin/server.js",
      snapshotRoot,
      path.join(snapshotRoot, "outside.js"),
    ),
  ).toThrow("MCP capsule entrypoint escaped its canonical snapshot");
});

function createRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-package-lock-"));
  roots.push(root);
  return root;
}

function approved(config, serverName = "package-server") {
  const token = issueMcpStdioExecutionAuthority({
    serverName,
    config,
    approvalKind: "explicit-config",
    approvalSource: `test:${serverName}`,
  });
  const approval = consumeMcpStdioExecutionAuthority(token, {
    serverName,
    config,
  });
  return {
    approval,
    approvalRecord: resolveMcpStdioExecutionApproval(approval),
    invocation: materializeApprovedMcpStdioInvocation(approval),
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function brokerSpawnSync(command, args, options) {
  return spawnSync(command, args, options);
}

function fakeInstall({ directory, packageSpec }) {
  expect(packageSpec).toBe("@scope/mcp-server@1.2.3");
  writeJson(path.join(directory, "package-lock.json"), {
    name: "chainlesschain-mcp-materialization",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { "@scope/mcp-server": "1.2.3" } },
      "node_modules/@scope/mcp-server": {
        version: "1.2.3",
        resolved:
          "https://registry.npmjs.org/@scope/mcp-server/-/mcp-server-1.2.3.tgz",
        integrity: `sha512-${"A".repeat(86)}==`,
      },
      "node_modules/transitive-dependency": {
        version: "4.5.6",
        resolved:
          "https://registry.npmjs.org/transitive-dependency/-/transitive-dependency-4.5.6.tgz",
        integrity: `sha512-${"B".repeat(86)}==`,
      },
    },
  });
  const packageRoot = path.join(
    directory,
    "node_modules",
    "@scope",
    "mcp-server",
  );
  writeJson(path.join(packageRoot, "package.json"), {
    name: "@scope/mcp-server",
    version: "1.2.3",
    bin: { "scope-mcp": "bin/server.js" },
  });
  fs.mkdirSync(path.join(packageRoot, "bin"), { recursive: true });
  fs.writeFileSync(
    path.join(packageRoot, "bin", "server.js"),
    "#!/usr/bin/env node\nimport '../runtime.js';\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(packageRoot, "runtime.js"),
    'import answer from "transitive-dependency";\nexport const ready = answer === 42;\n',
    "utf8",
  );
  const dependencyRoot = path.join(
    directory,
    "node_modules",
    "transitive-dependency",
  );
  writeJson(path.join(dependencyRoot, "package.json"), {
    name: "transitive-dependency",
    version: "4.5.6",
  });
  fs.writeFileSync(
    path.join(dependencyRoot, "index.js"),
    "export default 42;\n",
    "utf8",
  );
}

describe("MCP stdio fixed npm package materialization", () => {
  let root;
  let materializationRoot;
  let indexPath;
  let npmCli;
  let storePath;

  beforeEach(() => {
    root = createRoot();
    materializationRoot = path.join(root, "materializations");
    indexPath = path.join(root, "security", "index.json");
    npmCli = path.join(root, "npm-cli.js");
    storePath = path.join(root, "security", "executable-identities.json");
    fs.writeFileSync(npmCli, "// fixture npm cli\n", "utf8");
    _deps.fs = fs;
    _deps.processBrokerRunSync = brokerSpawnSync;
  });

  afterEach(() => {
    _deps.fs = fs;
    _deps.onVfsSnapshotCaptured = null;
    _deps.processBrokerRunSync = null;
    _deps.Worker = nativeWorker;
    for (const directory of roots.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("accepts exact registry specs and rejects tags, ranges, or invocation drift", () => {
    expect(parseExactNpmPackageSpec("@scope/mcp-server@1.2.3")).toEqual({
      name: "@scope/mcp-server",
      version: "1.2.3",
      spec: "@scope/mcp-server@1.2.3",
    });
    expect(() => parseExactNpmPackageSpec("pkg@latest")).toThrow(
      expect.objectContaining({
        code: MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
      }),
    );
    expect(() => parseExactNpmPackageSpec("pkg@^1.2.3")).toThrow(
      expect.objectContaining({
        code: MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
      }),
    );
    expect(() =>
      parseNpxMaterializationInvocation(
        { command: "npx", args: ["-y", "pkg@1.0.0"] },
        "pkg@1.0.1",
      ),
    ).toThrow(
      expect.objectContaining({
        code: MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
      }),
    );
  });

  it.each([
    ["npx", ["-y", "pkg@1.2.3", "--stdio"], "npx"],
    ["npm", ["exec", "--yes", "--", "pkg@1.2.3", "--stdio"], "npm-exec"],
    ["bunx", ["--yes", "pkg@1.2.3", "--stdio"], "bunx"],
    ["pnpx", ["pkg@1.2.3", "--stdio"], "pnpx"],
    ["pnpm", ["dlx", "pkg@1.2.3", "--stdio"], "pnpm-dlx"],
    ["yarn", ["dlx", "pkg@1.2.3", "--stdio"], "yarn-dlx"],
    ["yarnpkg", ["dlx", "pkg@1.2.3", "--stdio"], "yarnpkg-dlx"],
    ["corepack", ["pnpm", "dlx", "pkg@1.2.3", "--stdio"], "corepack-pnpm-dlx"],
    ["corepack", ["yarn", "dlx", "pkg@1.2.3", "--stdio"], "corepack-yarn-dlx"],
  ])(
    "normalizes the exact JavaScript package launcher %s",
    (command, args, launcher) => {
      expect(
        parseNpmPackageLauncherInvocation({ command, args }, "pkg@1.2.3"),
      ).toEqual({
        name: "pkg",
        version: "1.2.3",
        spec: "pkg@1.2.3",
        launcher,
        passthroughArgs: ["--stdio"],
      });
    },
  );

  it.each([
    ["npm", ["install", "pkg@1.2.3"]],
    ["bunx", ["--bun", "pkg@1.2.3"]],
    ["pnpm", ["--package", "pkg@1.2.3", "dlx", "pkg"]],
    ["corepack", ["npm", "exec", "pkg@1.2.3"]],
    ["uvx", ["pkg@1.2.3"]],
    ["pipx", ["run", "pkg@1.2.3"]],
  ])(
    "fails closed on unsupported or ambiguous launcher argv for %s",
    (command, args) => {
      expect(() =>
        parseNpmPackageLauncherInvocation({ command, args }, "pkg@1.2.3"),
      ).toThrow(
        expect.objectContaining({
          code: MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
        }),
      );
    },
  );

  it("locks the complete transitive tree and replaces a launcher with a direct Node entrypoint", async () => {
    const config = {
      command: "bunx",
      args: ["--yes", "@scope/mcp-server@1.2.3", "--stdio"],
      transport: "stdio",
    };
    const authority = approved(config);
    const result = await materializeMcpStdioNpmPackage({
      approvalRecord: authority.approvalRecord,
      config: authority.invocation,
      packageSpec: "@scope/mcp-server@1.2.3",
      binName: "scope-mcp",
      root: materializationRoot,
      indexPath,
      npmCli,
      installRunner: fakeInstall,
      now: Date.parse("2026-08-07T00:00:00.000Z"),
    });

    expect(result.identity).toMatchObject({
      package: { name: "@scope/mcp-server", version: "1.2.3" },
      packageCount: 2,
      entrypointRelative: "node_modules/@scope/mcp-server/bin/server.js",
    });
    expect(result.identity.fileCount).toBeGreaterThanOrEqual(7);
    expect(result.identity.closureDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.identity.capsule).toMatchObject({
      schema: "chainlesschain.mcp-stdio-node-capsule/v3",
      relativePath: "capsule/server.cjs",
      builder: "esbuild-wasm",
      builderVersion: "0.28.1",
      nodeTarget: "node22",
      inputCount: 3,
      resolverSchema: "chainlesschain.mcp-stdio-immutable-vfs-resolver/v1",
      wrapperSchema: "chainlesschain.mcp-stdio-capsule-stdin-wrapper/v1",
      wrapperSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      builtinPolicy: {
        schema: "chainlesschain.mcp-stdio-static-builtin-policy/v1",
        mode: "static-external-only",
        allowedBuiltins: [],
      },
    });
    expect(result.identity.capsule.builderWasmSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.identity.capsule.builderApiSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.identity.capsule.builderWorkerSha256).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(result.identity.capsule.resolverSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.identity.capsule.sha256).toMatch(/^[a-f0-9]{64}$/);
    const capsuleSource = fs.readFileSync(
      path.join(result.root, "capsule", "server.cjs"),
      "utf8",
    );
    expect(capsuleSource).toContain("transitive-dependency/index.js");
    const repeated = await materializeMcpStdioNpmPackage({
      approvalRecord: authority.approvalRecord,
      config: authority.invocation,
      packageSpec: "@scope/mcp-server@1.2.3",
      binName: "scope-mcp",
      root: materializationRoot,
      indexPath,
      npmCli,
      installRunner: fakeInstall,
      now: Date.parse("2026-08-08T00:00:00.000Z"),
    });
    expect(repeated.generation).toBe(result.generation);
    expect(repeated.manifestDigest).toBe(result.manifestDigest);
    expect(capsuleSource).not.toContain(result.root);
    expect(capsuleSource).not.toContain(result.root.replaceAll("\\", "/"));

    const resolved = resolveMcpStdioPackageMaterialization({
      approvalRecord: authority.approvalRecord,
      root: materializationRoot,
      indexPath,
    });
    expect(resolved.command).toBe(process.execPath);
    expect(resolved.args[0]).toBe(
      path.join(result.root, "capsule", "server.cjs"),
    );
    expect(resolved.args.slice(1)).toEqual(["--stdio"]);
    expect(resolved.capsuleRoot).toBe(path.join(result.root, "capsule"));
    expect(
      spawnSync(resolved.command, resolved.args, {
        cwd: resolved.capsuleRoot,
        encoding: "utf8",
      }).status,
    ).toBe(0);

    const prepared = prepareMcpStdioExecutableIdentity({
      serverName: "package-server",
      config: authority.invocation,
      approval: authority.approval,
      retrust: true,
      storePath,
      materializationRoot,
      materializationIndexPath: indexPath,
      env: { ...process.env, NODE_OPTIONS: "--require ambient-evil.js" },
    });
    expect(prepared.command).toBe(fs.realpathSync(process.execPath));
    expect(prepared.identity.materialization).toMatchObject({
      generation: result.generation,
      closureDigest: result.identity.closureDigest,
      capsule: { sha256: result.identity.capsule.sha256 },
    });
    expect(prepared.workingDirectory).toBe(
      (fs.realpathSync.native || fs.realpathSync)(
        path.join(result.root, "capsule"),
      ),
    );
    expect(prepared.env).not.toHaveProperty("NODE_OPTIONS");
    expect(prepared.sandboxExecutionContract).toMatchObject({
      contractVersion: 1,
      kind: MCP_STDIO_CAPSULE_SANDBOX_CONTRACT_KIND,
      pluginRoot: prepared.workingDirectory,
      workingDirectory: prepared.workingDirectory,
      runtimePath: prepared.command,
      entryIdentity: {
        realPath: prepared.args[0],
        sha256: result.identity.capsule.sha256,
      },
    });
    const sandboxProvenance = {
      origin: "mcp:server:package-server",
      command: prepared.command,
      args: prepared.args,
      cwd: prepared.workingDirectory,
      shell: false,
      sync: false,
      identityDigest: prepared.identityDigest,
      requiredBoundaries: MCP_STDIO_CAPSULE_REQUIRED_BOUNDARIES,
    };
    expect(
      executionBroker._normalizeSandboxExecutionContract(
        prepared.sandboxExecutionContract,
        {
          origin: sandboxProvenance.origin,
          cwd: sandboxProvenance.cwd,
          shell: sandboxProvenance.shell,
          mcpStdioExecutableIdentityDigest: sandboxProvenance.identityDigest,
        },
        sandboxProvenance.requiredBoundaries,
        {
          command: sandboxProvenance.command,
          args: sandboxProvenance.args,
          sync: false,
        },
      ),
    ).toMatchObject({
      kind: MCP_STDIO_CAPSULE_SANDBOX_CONTRACT_KIND,
      pluginRoot: prepared.workingDirectory,
      entryIdentity: { sha256: result.identity.capsule.sha256 },
    });
    expect(() =>
      executionBroker._normalizeSandboxExecutionContract(
        prepared.sandboxExecutionContract,
        {
          origin: sandboxProvenance.origin,
          cwd: sandboxProvenance.cwd,
          shell: sandboxProvenance.shell,
          mcpStdioExecutableIdentityDigest: sandboxProvenance.identityDigest,
        },
        sandboxProvenance.requiredBoundaries,
        {
          command: sandboxProvenance.command,
          args: sandboxProvenance.args,
          sync: false,
        },
      ),
    ).toThrow(/was not issued/);
    expect(
      consumeMcpStdioExecutableIdentityAuthority(prepared.authority, {
        command: prepared.command,
        args: prepared.args,
      }),
    ).toEqual({ identityDigest: prepared.identityDigest });
  }, 30_000);

  it("rejects a source file above the immutable VFS per-file budget before Worker creation", async () => {
    const workers = useScriptedWorker(() => {
      throw new Error("oversized source must not reach the Worker");
    });
    const oversizedInstall = (input) => {
      fakeInstall(input);
      const oversized = path.join(input.directory, "oversized-source.js");
      fs.writeFileSync(oversized, "", "utf8");
      fs.truncateSync(oversized, 16 * 1024 * 1024 + 1);
    };
    const config = {
      command: "npx",
      args: ["@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, "source-file-budget-server");

    await expect(
      materializeMcpStdioNpmPackage({
        approvalRecord: authority.approvalRecord,
        config: authority.invocation,
        packageSpec: "@scope/mcp-server@1.2.3",
        binName: "scope-mcp",
        root: materializationRoot,
        indexPath,
        npmCli,
        installRunner: oversizedInstall,
      }),
    ).rejects.toMatchObject({
      code: MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED_CODE,
      cause: expect.objectContaining({
        message: expect.stringContaining("exceeds the size limit"),
      }),
    });
    expect(workers).toHaveLength(0);
  });

  it("rejects a near-limit aggregate source closure before Worker creation", async () => {
    const workers = useScriptedWorker(() => {
      throw new Error("oversized closure must not reach the Worker");
    });
    const aggregateInstall = (input) => {
      fakeInstall(input);
      for (let index = 0; index < 4; index += 1) {
        const file = path.join(input.directory, `00-budget-${index}.js`);
        fs.writeFileSync(file, "", "utf8");
        fs.truncateSync(file, 16 * 1024 * 1024);
      }
    };
    const config = {
      command: "npx",
      args: ["@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, "source-aggregate-budget-server");

    await expect(
      materializeMcpStdioNpmPackage({
        approvalRecord: authority.approvalRecord,
        config: authority.invocation,
        packageSpec: "@scope/mcp-server@1.2.3",
        binName: "scope-mcp",
        root: materializationRoot,
        indexPath,
        npmCli,
        installRunner: aggregateInstall,
      }),
    ).rejects.toMatchObject({
      code: MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED_CODE,
      cause: expect.objectContaining({
        message: expect.stringContaining("exceeds its aggregate budget"),
      }),
    });
    expect(workers).toHaveLength(0);
  }, 30_000);

  it("accepts stable descriptor IDs across divergent Windows pathname stat projections", async () => {
    let divergentPathStats = 0;
    const shiftedStat = (stat) =>
      new Proxy(stat, {
        get(target, property) {
          if (property === "dev") return target[property] + 10_000n;
          if (property === "ino") return target[property] + 20_000n;
          if (property === "mtimeNs" || property === "ctimeNs") {
            return target[property] + 100n;
          }
          if (property === "mode") return target[property] ^ 0o111n;
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    _deps.fs = new Proxy(fs, {
      get(target, property) {
        if (property !== "lstatSync") {
          return Reflect.get(target, property, target);
        }
        return (file, options) => {
          const stat = fs.lstatSync(file, options);
          if (options?.bigint && String(file).includes(".staging-")) {
            divergentPathStats += 1;
            return shiftedStat(stat);
          }
          return stat;
        };
      },
    });
    const config = {
      command: "npx",
      args: ["@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, "windows-stat-view-server");

    const result = await materializeMcpStdioNpmPackage({
      approvalRecord: authority.approvalRecord,
      config: authority.invocation,
      packageSpec: "@scope/mcp-server@1.2.3",
      binName: "scope-mcp",
      root: materializationRoot,
      indexPath,
      npmCli,
      installRunner: fakeInstall,
    });

    expect(result.identity.capsule).toMatchObject({
      schema: "chainlesschain.mcp-stdio-node-capsule/v3",
      inputCount: 3,
    });
    expect(divergentPathStats).toBeGreaterThan(0);
  }, 30_000);

  it.each([
    [
      "package version",
      () =>
        createAssetTamperingFs({
          matches: (file) =>
            file.endsWith(`${path.sep}esbuild-wasm${path.sep}package.json`),
          onRead: ({ buffer, offset, count }) => {
            const view = buffer.subarray(offset, offset + count);
            const versionOffset = view.indexOf(Buffer.from("0.28.1"));
            if (versionOffset >= 0) {
              Buffer.from("9.99.9").copy(view, versionOffset);
            }
          },
        }),
      "must be esbuild-wasm@0.28.1",
    ],
    [
      "browser API hash",
      () =>
        createAssetTamperingFs({
          matches: (file) =>
            file.endsWith(
              `${path.sep}esbuild-wasm${path.sep}lib${path.sep}browser.js`,
            ),
          onRead: ({ buffer, offset, count, position }) => {
            if (position === 0 && count > 0) buffer[offset] ^= 1;
          },
        }),
      "builder API identity is invalid",
    ],
    [
      "WASM size",
      () =>
        createAssetTamperingFs({
          matches: (file) =>
            file.endsWith(`${path.sep}esbuild-wasm${path.sep}esbuild.wasm`),
          onDescriptorStat: (_file, stat) =>
            overrideStat(stat, { size: stat.size - 1n }),
          onPathStat: (_file, stat) =>
            overrideStat(stat, { size: stat.size - 1n }),
        }),
      "builder WASM identity is invalid",
    ],
    [
      "descriptor re-open identity",
      () => {
        let descriptorStats = 0;
        return createAssetTamperingFs({
          matches: (file) =>
            file.endsWith(
              `${path.sep}esbuild-wasm${path.sep}lib${path.sep}browser.js`,
            ),
          onDescriptorStat: (_file, stat) => {
            descriptorStats += 1;
            return descriptorStats === 2
              ? overrideStat(stat, { ino: stat.ino + 1n })
              : stat;
          },
        });
      },
      "input identity changed before read",
    ],
  ])("rejects pinned builder %s tampering", async (_label, tamper, message) => {
    const config = {
      command: "npx",
      args: ["@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, `builder-tamper-${_label}`);
    _deps.fs = tamper();

    await expect(
      materializeMcpStdioNpmPackage({
        approvalRecord: authority.approvalRecord,
        config: authority.invocation,
        packageSpec: "@scope/mcp-server@1.2.3",
        binName: "scope-mcp",
        root: materializationRoot,
        indexPath,
        npmCli,
        installRunner: fakeInstall,
      }),
    ).rejects.toThrow(
      expect.objectContaining({
        code: MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED_CODE,
        message: expect.stringContaining(message),
      }),
    );
    expect(fs.existsSync(indexPath)).toBe(false);
    expect(
      fs
        .readdirSync(materializationRoot)
        .some((entry) => entry.startsWith(".staging-")),
    ).toBe(false);
  });

  it("rejects a pathname re-open that resolves to a different descriptor file ID", async () => {
    const activeTargetDescriptors = new Set();
    const mismatchedDescriptors = new Set();
    let sawVerifierReopen = false;
    _deps.fs = new Proxy(fs, {
      get(target, property) {
        if (property === "openSync") {
          return (file, flags, mode) => {
            const descriptor = fs.openSync(file, flags, mode);
            const normalized = String(file).replaceAll("\\", "/");
            if (
              normalized.includes(".staging-") &&
              normalized.endsWith("/node_modules/@scope/mcp-server/runtime.js")
            ) {
              if (activeTargetDescriptors.size > 0) {
                mismatchedDescriptors.add(descriptor);
                sawVerifierReopen = true;
              }
              activeTargetDescriptors.add(descriptor);
            }
            return descriptor;
          };
        }
        if (property === "fstatSync") {
          return (descriptor, options) => {
            const stat = fs.fstatSync(descriptor, options);
            if (options?.bigint && mismatchedDescriptors.has(descriptor)) {
              return new Proxy(stat, {
                get(statTarget, statProperty) {
                  if (statProperty === "ino") return statTarget.ino + 1n;
                  const value = Reflect.get(
                    statTarget,
                    statProperty,
                    statTarget,
                  );
                  return typeof value === "function"
                    ? value.bind(statTarget)
                    : value;
                },
              });
            }
            return stat;
          };
        }
        if (property === "closeSync") {
          return (descriptor) => {
            activeTargetDescriptors.delete(descriptor);
            mismatchedDescriptors.delete(descriptor);
            return fs.closeSync(descriptor);
          };
        }
        return Reflect.get(target, property, target);
      },
    });
    const config = {
      command: "npx",
      args: ["@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, "descriptor-reopen-race-server");

    await expect(
      materializeMcpStdioNpmPackage({
        approvalRecord: authority.approvalRecord,
        config: authority.invocation,
        packageSpec: "@scope/mcp-server@1.2.3",
        binName: "scope-mcp",
        root: materializationRoot,
        indexPath,
        npmCli,
        installRunner: fakeInstall,
      }),
    ).rejects.toThrow(
      expect.objectContaining({
        code: MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED_CODE,
        message: expect.stringContaining(
          "build input identity changed before read",
        ),
      }),
    );
    expect(sawVerifierReopen).toBe(true);
    expect(fs.existsSync(indexPath)).toBe(false);
    expect(
      fs
        .readdirSync(materializationRoot)
        .some((entry) => entry.startsWith(".staging-")),
    ).toBe(false);
  }, 30_000);

  it("creates the capsule with O_EXCL and fsyncs it before publication", async () => {
    let capsuleDescriptor;
    let capsuleFlags;
    let capsuleMode;
    let capsuleFsynced = false;
    _deps.fs = new Proxy(fs, {
      get(target, property) {
        if (property === "openSync") {
          return (file, flags, mode) => {
            const descriptor = fs.openSync(file, flags, mode);
            if (
              String(file).endsWith(
                `${path.sep}capsule${path.sep}server.cjs`,
              ) &&
              (Number(flags) & Number(fs.constants.O_WRONLY)) !== 0
            ) {
              capsuleDescriptor = descriptor;
              capsuleFlags = Number(flags);
              capsuleMode = mode;
            }
            return descriptor;
          };
        }
        if (property === "fsyncSync") {
          return (descriptor) => {
            if (descriptor === capsuleDescriptor) capsuleFsynced = true;
            return fs.fsyncSync(descriptor);
          };
        }
        return Reflect.get(target, property, target);
      },
    });
    const config = {
      command: "npx",
      args: ["@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, "capsule-exclusive-create");
    await materializeMcpStdioNpmPackage({
      approvalRecord: authority.approvalRecord,
      config: authority.invocation,
      packageSpec: "@scope/mcp-server@1.2.3",
      binName: "scope-mcp",
      root: materializationRoot,
      indexPath,
      npmCli,
      installRunner: fakeInstall,
    });

    expect(capsuleDescriptor).toBeTypeOf("number");
    expect(capsuleFlags & Number(fs.constants.O_EXCL)).not.toBe(0);
    if (Number(fs.constants.O_NOFOLLOW || 0) !== 0) {
      expect(capsuleFlags & Number(fs.constants.O_NOFOLLOW)).not.toBe(0);
    }
    expect(capsuleMode).toBe(0o600);
    expect(capsuleFsynced).toBe(true);
  }, 30_000);

  it("fails O_EXCL output races and removes the unpublished staging tree", async () => {
    let raced = false;
    _deps.fs = new Proxy(fs, {
      get(target, property) {
        if (property !== "openSync") {
          return Reflect.get(target, property, target);
        }
        return (file, flags, mode) => {
          if (
            !raced &&
            String(file).endsWith(`${path.sep}capsule${path.sep}server.cjs`) &&
            (Number(flags) & Number(fs.constants.O_WRONLY)) !== 0
          ) {
            raced = true;
            fs.writeFileSync(file, "attacker-won-the-race", "utf8");
          }
          return fs.openSync(file, flags, mode);
        };
      },
    });
    const config = {
      command: "npx",
      args: ["@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, "capsule-output-race");

    await expect(
      materializeMcpStdioNpmPackage({
        approvalRecord: authority.approvalRecord,
        config: authority.invocation,
        packageSpec: "@scope/mcp-server@1.2.3",
        binName: "scope-mcp",
        root: materializationRoot,
        indexPath,
        npmCli,
        installRunner: fakeInstall,
      }),
    ).rejects.toThrow(
      expect.objectContaining({
        code: MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED_CODE,
      }),
    );
    expect(raced).toBe(true);
    expect(fs.existsSync(indexPath)).toBe(false);
    expect(
      fs
        .readdirSync(materializationRoot)
        .some((entry) => entry.startsWith(".staging-")),
    ).toBe(false);
  }, 30_000);

  it("detects an added transitive file before the Broker can spawn", async () => {
    const config = {
      command: "npx",
      args: ["@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, "race-server");
    const result = await materializeMcpStdioNpmPackage({
      approvalRecord: authority.approvalRecord,
      config: authority.invocation,
      packageSpec: "@scope/mcp-server@1.2.3",
      binName: "scope-mcp",
      root: materializationRoot,
      indexPath,
      npmCli,
      installRunner: fakeInstall,
    });
    const prepared = prepareMcpStdioExecutableIdentity({
      serverName: "race-server",
      config: authority.invocation,
      approval: authority.approval,
      retrust: true,
      storePath,
      materializationRoot,
      materializationIndexPath: indexPath,
    });
    fs.writeFileSync(
      path.join(result.root, "tree", "node_modules", "late-injection.js"),
      "globalThis.compromised = true;\n",
      "utf8",
    );

    expect(() =>
      consumeMcpStdioExecutableIdentityAuthority(prepared.authority, {
        command: prepared.command,
        args: prepared.args,
      }),
    ).toThrow(
      expect.objectContaining({
        code: MCP_STDIO_PACKAGE_MATERIALIZATION_CHANGED_CODE,
      }),
    );
  }, 30_000);

  it("detects capsule replacement before the Broker can spawn", async () => {
    const config = {
      command: "npx",
      args: ["@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, "capsule-race-server");
    const result = await materializeMcpStdioNpmPackage({
      approvalRecord: authority.approvalRecord,
      config: authority.invocation,
      packageSpec: "@scope/mcp-server@1.2.3",
      binName: "scope-mcp",
      root: materializationRoot,
      indexPath,
      npmCli,
      installRunner: fakeInstall,
    });
    const prepared = prepareMcpStdioExecutableIdentity({
      serverName: "capsule-race-server",
      config: authority.invocation,
      approval: authority.approval,
      retrust: true,
      storePath,
      materializationRoot,
      materializationIndexPath: indexPath,
    });
    fs.appendFileSync(
      path.join(result.root, "capsule", "server.cjs"),
      "globalThis.compromised = true;\n",
      "utf8",
    );

    expect(() =>
      consumeMcpStdioExecutableIdentityAuthority(prepared.authority, {
        command: prepared.command,
        args: prepared.args,
      }),
    ).toThrow(
      expect.objectContaining({
        code: MCP_STDIO_PACKAGE_MATERIALIZATION_CHANGED_CODE,
      }),
    );
  }, 30_000);

  it("rejects source-tree mutation after immutable VFS capture", async () => {
    const config = {
      command: "npx",
      args: ["@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, "capsule-build-race-server");
    let sourceToMutate;
    const raceInstall = (input) => {
      fakeInstall(input);
      sourceToMutate = path.join(
        input.directory,
        "node_modules",
        "@scope",
        "mcp-server",
        "runtime.js",
      );
    };
    _deps.onVfsSnapshotCaptured = () => {
      fs.appendFileSync(
        sourceToMutate,
        "globalThis.compromised = true;\n",
        "utf8",
      );
    };

    await expect(
      materializeMcpStdioNpmPackage({
        approvalRecord: authority.approvalRecord,
        config: authority.invocation,
        packageSpec: "@scope/mcp-server@1.2.3",
        binName: "scope-mcp",
        root: materializationRoot,
        indexPath,
        npmCli,
        installRunner: raceInstall,
      }),
    ).rejects.toThrow(
      expect.objectContaining({
        code: MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED_CODE,
        message: expect.stringContaining(
          "dependency closure changed during bundling",
        ),
      }),
    );
    expect(fs.existsSync(indexPath)).toBe(false);
  }, 30_000);

  it.each([
    ["entrypoint", "node_modules/@scope/mcp-server/bin/server.js"],
    ["dependency", "node_modules/transitive-dependency/index.js"],
  ])(
    "rejects post-capture %s mutation without exposing it to esbuild",
    async (_label, relativeInput) => {
      const config = {
        command: "npx",
        args: ["@scope/mcp-server@1.2.3"],
        transport: "stdio",
      };
      const authority = approved(config, `snapshot-race-${_label}`);
      _deps.onVfsSnapshotCaptured = ({ treeRoot }) => {
        fs.appendFileSync(
          path.join(treeRoot, ...relativeInput.split("/")),
          "\nglobalThis.snapshotCompromised = true;\n",
          "utf8",
        );
      };

      await expect(
        materializeMcpStdioNpmPackage({
          approvalRecord: authority.approvalRecord,
          config: authority.invocation,
          packageSpec: "@scope/mcp-server@1.2.3",
          binName: "scope-mcp",
          root: materializationRoot,
          indexPath,
          npmCli,
          installRunner: fakeInstall,
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          code: MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED_CODE,
          message: expect.stringContaining(
            "dependency closure changed during bundling",
          ),
        }),
      );
      expect(fs.existsSync(indexPath)).toBe(false);
    },
    30_000,
  );

  it("binds process.getBuiltinModule to the statically imported builtin set", async () => {
    const config = {
      command: "npx",
      args: ["@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, "builtin-policy-server");
    const builtinInstall = (input) => {
      fakeInstall(input);
      fs.writeFileSync(
        path.join(
          input.directory,
          "node_modules",
          "@scope",
          "mcp-server",
          "bin",
          "server.js",
        ),
        `#!/usr/bin/env node
const path = require("node:path");
const operation = process.argv[2];
if (operation === "allowed") {
  process.stdout.write(process.getBuiltinModule("path") === path ? "allowed" : "mismatch");
} else if (operation === "unlisted") {
  process.getBuiltinModule("node:fs");
} else if (operation === "unlisted-require") {
  require(process.argv[3]);
} else if (operation === "binding") {
  process.binding("fs");
} else if (operation === "linked-binding") {
  process._linkedBinding("fs");
}
`,
        "utf8",
      );
    };

    const result = await materializeMcpStdioNpmPackage({
      approvalRecord: authority.approvalRecord,
      config: authority.invocation,
      packageSpec: "@scope/mcp-server@1.2.3",
      binName: "scope-mcp",
      root: materializationRoot,
      indexPath,
      npmCli,
      installRunner: builtinInstall,
    });
    expect(result.identity.capsule.builtinPolicy).toEqual({
      schema: "chainlesschain.mcp-stdio-static-builtin-policy/v1",
      mode: "static-external-only",
      allowedBuiltins: ["node:path", "path"],
    });
    const capsule = path.join(result.root, "capsule", "server.cjs");
    const allowed = spawnSync(process.execPath, [capsule, "allowed"], {
      encoding: "utf8",
    });
    expect(allowed).toMatchObject({ status: 0, stdout: "allowed" });

    for (const [operation, extraArgs] of [
      ["unlisted", []],
      ["unlisted-require", ["node:fs"]],
      ["binding", []],
      ["linked-binding", []],
    ]) {
      const denied = spawnSync(
        process.execPath,
        [capsule, operation, ...extraArgs],
        { encoding: "utf8" },
      );
      expect(denied.status).not.toBe(0);
      expect(denied.stderr).toContain("CC_MCP_STDIO_BUILTIN_MODULE_BLOCKED");
    }
  }, 30_000);

  it("rejects a changed snapshot-root substitution after VFS capture", async () => {
    const config = {
      command: "npx",
      args: ["@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, "snapshot-root-swap");
    _deps.onVfsSnapshotCaptured = ({ treeRoot }) => {
      const attestedRoot = `${treeRoot}.attested`;
      fs.renameSync(treeRoot, attestedRoot);
      fs.cpSync(attestedRoot, treeRoot, {
        recursive: true,
        preserveTimestamps: true,
      });
      const runtimePath = path.join(
        treeRoot,
        "node_modules",
        "@scope",
        "mcp-server",
        "runtime.js",
      );
      const originalRuntime = fs.readFileSync(runtimePath, "utf8");
      const substitutedRuntime = originalRuntime.replace(
        "answer === 42",
        "answer !== 42",
      );
      expect(substitutedRuntime).toHaveLength(originalRuntime.length);
      fs.writeFileSync(runtimePath, substitutedRuntime, "utf8");
    };

    await expect(
      materializeMcpStdioNpmPackage({
        approvalRecord: authority.approvalRecord,
        config: authority.invocation,
        packageSpec: "@scope/mcp-server@1.2.3",
        binName: "scope-mcp",
        root: materializationRoot,
        indexPath,
        npmCli,
        installRunner: fakeInstall,
      }),
    ).rejects.toThrow(
      expect.objectContaining({
        code: MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED_CODE,
        message: expect.stringContaining(
          "dependency closure changed during bundling",
        ),
      }),
    );
    expect(fs.existsSync(indexPath)).toBe(false);
  }, 30_000);

  it("builds only captured bytes during a swap-build-restore attack", async () => {
    const config = {
      command: "npx",
      args: ["@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, "snapshot-swap-restore");
    let restoreTree;
    let maliciousRuntimePath;
    let sawMaliciousTree = false;
    _deps.onVfsSnapshotCaptured = ({ treeRoot }) => {
      const originalRoot = `${treeRoot}.captured-original`;
      fs.renameSync(treeRoot, originalRoot);
      fs.cpSync(originalRoot, treeRoot, {
        recursive: true,
        preserveTimestamps: true,
      });
      maliciousRuntimePath = path.join(
        treeRoot,
        "node_modules",
        "@scope",
        "mcp-server",
        "runtime.js",
      );
      const original = fs.readFileSync(maliciousRuntimePath, "utf8");
      const malicious = original.replace("answer === 42", "answer !== 42");
      expect(malicious).toHaveLength(original.length);
      fs.writeFileSync(maliciousRuntimePath, malicious, "utf8");
      restoreTree = () => {
        if (!fs.existsSync(originalRoot)) return;
        fs.rmSync(treeRoot, { recursive: true, force: true });
        fs.renameSync(originalRoot, treeRoot);
      };
    };
    _deps.Worker = class SwapRestoreWorker extends nativeWorker {
      constructor(source, options) {
        super(source, options);
        sawMaliciousTree = fs
          .readFileSync(maliciousRuntimePath, "utf8")
          .includes("answer !== 42");
        this.once("message", () => restoreTree());
      }
    };

    const result = await materializeMcpStdioNpmPackage({
      approvalRecord: authority.approvalRecord,
      config: authority.invocation,
      packageSpec: "@scope/mcp-server@1.2.3",
      binName: "scope-mcp",
      root: materializationRoot,
      indexPath,
      npmCli,
      installRunner: fakeInstall,
    });
    expect(sawMaliciousTree).toBe(true);
    const capsule = fs.readFileSync(
      path.join(result.root, "capsule", "server.cjs"),
      "utf8",
    );
    expect(capsule).toContain("transitive_dependency_default === 42");
    expect(capsule).not.toContain("transitive_dependency_default !== 42");
  }, 30_000);

  it("fails closed when the capsule Worker exits without a result", async () => {
    const config = {
      command: "npx",
      args: ["@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, "worker-early-exit");
    const workers = useScriptedWorker((worker) => worker.emit("exit", 0));

    await expect(
      materializeMcpStdioNpmPackage({
        approvalRecord: authority.approvalRecord,
        config: authority.invocation,
        packageSpec: "@scope/mcp-server@1.2.3",
        binName: "scope-mcp",
        root: materializationRoot,
        indexPath,
        npmCli,
        installRunner: fakeInstall,
      }),
    ).rejects.toThrow(
      expect.objectContaining({
        code: MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED_CODE,
        message: expect.stringContaining("Worker exited without a result"),
      }),
    );
    expect(workers).toHaveLength(1);
    expect(workers[0].terminated).toBe(true);
    expect(fs.existsSync(indexPath)).toBe(false);
  });

  it.each([
    [
      "nonce mismatch",
      (worker, workerData) =>
        worker.emit("message", {
          ...successfulWorkerResult(workerData),
          nonce: "0".repeat(64),
        }),
      "nonce mismatch",
    ],
    [
      "message cloning failure",
      (worker) => worker.emit("messageerror", new Error("clone failed")),
      "message was not cloneable",
    ],
    [
      "uncaught Worker error",
      (worker) => worker.emit("error", new Error("worker exploded")),
      "worker exploded",
    ],
    [
      "non-zero exit",
      (worker) => worker.emit("exit", 9),
      "exited with status 9",
    ],
    [
      "double terminal message",
      (worker, workerData) => {
        const result = successfulWorkerResult(workerData);
        worker.emit("message", result);
        worker.emit("message", result);
      },
      "two terminal messages",
    ],
    [
      "terminal failure",
      (worker, workerData) => {
        worker.emit("message", {
          ok: false,
          nonce: workerData.nonce,
          error: { name: "Error", message: "pinned build failed" },
        });
        worker.emit("exit", 0);
      },
      "pinned build failed",
    ],
  ])("fails closed on capsule Worker %s", async (_label, script, message) => {
    const config = {
      command: "npx",
      args: ["@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, `worker-failure-${_label}`);
    const workers = useScriptedWorker(script);

    await expect(
      materializeMcpStdioNpmPackage({
        approvalRecord: authority.approvalRecord,
        config: authority.invocation,
        packageSpec: "@scope/mcp-server@1.2.3",
        binName: "scope-mcp",
        root: materializationRoot,
        indexPath,
        npmCli,
        installRunner: fakeInstall,
      }),
    ).rejects.toThrow(
      expect.objectContaining({
        code: MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED_CODE,
        message: expect.stringContaining(message),
      }),
    );
    expect(workers).toHaveLength(1);
    expect(workers[0].terminated).toBe(true);
    expect(fs.existsSync(indexPath)).toBe(false);
  });

  it.each([
    [
      "missing builtin-policy marker",
      () => {},
      "did not retain exactly one host builtin-policy marker",
    ],
    [
      "duplicate builtin-policy marker",
      (result) => {
        result.output = new TextEncoder().encode(
          '"__CHAINLESSCHAIN_MCP_STATIC_BUILTIN_ALLOWLIST_8F43C70E__" + "__CHAINLESSCHAIN_MCP_STATIC_BUILTIN_ALLOWLIST_8F43C70E__";',
        );
      },
      "did not retain exactly one host builtin-policy marker",
    ],
    [
      "non-VFS metafile input",
      (result) => {
        result.metafile.inputs["C:/host/escape.js"] = {
          bytes: 1,
          imports: [],
        };
      },
      "non-VFS input",
    ],
    [
      "metafile/audit mismatch",
      (result) => {
        result.audit.loaded = result.audit.loaded.slice(1);
      },
      "metafile did not match immutable VFS loads",
    ],
    [
      "non-builtin external",
      (result) => {
        result.metafile.outputs["/chainlesschain-output/server.cjs"].imports = [
          { external: true, path: "left-pad" },
        ];
      },
      "retained an external dependency",
    ],
  ])("rejects forged Worker output: %s", async (_label, forge, message) => {
    const config = {
      command: "npx",
      args: ["@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, `forged-worker-${_label}`);
    useScriptedWorker((worker, workerData) => {
      const result = successfulWorkerResult(workerData);
      forge(result);
      worker.emit("message", result);
      worker.emit("exit", 0);
    });

    await expect(
      materializeMcpStdioNpmPackage({
        approvalRecord: authority.approvalRecord,
        config: authority.invocation,
        packageSpec: "@scope/mcp-server@1.2.3",
        binName: "scope-mcp",
        root: materializationRoot,
        indexPath,
        npmCli,
        installRunner: fakeInstall,
      }),
    ).rejects.toThrow(
      expect.objectContaining({
        code: MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED_CODE,
        message: expect.stringContaining(message),
      }),
    );
    expect(fs.existsSync(indexPath)).toBe(false);
  });

  it("rejects an oversized capsule Worker output", async () => {
    const config = {
      command: "npx",
      args: ["@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, "oversized-worker-output");
    useScriptedWorker((worker, workerData) => {
      worker.emit(
        "message",
        successfulWorkerResult(workerData, {
          output: new Uint8Array(32 * 1024 * 1024 + 1),
        }),
      );
      worker.emit("exit", 0);
    });

    await expect(
      materializeMcpStdioNpmPackage({
        approvalRecord: authority.approvalRecord,
        config: authority.invocation,
        packageSpec: "@scope/mcp-server@1.2.3",
        binName: "scope-mcp",
        root: materializationRoot,
        indexPath,
        npmCli,
        installRunner: fakeInstall,
      }),
    ).rejects.toThrow(
      expect.objectContaining({
        code: MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED_CODE,
        message: expect.stringContaining("Worker result is invalid"),
      }),
    );
  });

  it("times out a silent capsule Worker and terminates it", async () => {
    vi.useFakeTimers();
    try {
      const config = {
        command: "npx",
        args: ["@scope/mcp-server@1.2.3"],
        transport: "stdio",
      };
      const authority = approved(config, "silent-worker-timeout");
      const workers = useScriptedWorker(() => {});
      const materialization = materializeMcpStdioNpmPackage({
        approvalRecord: authority.approvalRecord,
        config: authority.invocation,
        packageSpec: "@scope/mcp-server@1.2.3",
        binName: "scope-mcp",
        root: materializationRoot,
        indexPath,
        npmCli,
        installRunner: fakeInstall,
      });
      const rejection = expect(materialization).rejects.toThrow(
        expect.objectContaining({
          code: MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED_CODE,
          message: expect.stringContaining("Worker timed out"),
        }),
      );
      await vi.advanceTimersByTimeAsync(120_001);
      await rejection;
      expect(workers).toHaveLength(1);
      expect(workers[0].terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("awaits capsule Worker termination before rejecting", async () => {
    let instance;
    let releaseTermination;
    _deps.Worker = class DeferredTerminationWorker extends EventEmitter {
      constructor(_source, options) {
        super();
        this.options = options;
        this.terminationStarted = false;
        instance = this;
        queueMicrotask(() => this.emit("exit", 0));
      }

      terminate() {
        this.terminationStarted = true;
        return new Promise((resolve) => {
          releaseTermination = resolve;
        });
      }
    };
    const config = {
      command: "npx",
      args: ["@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, "await-worker-termination");
    let settled = false;
    const materialization = materializeMcpStdioNpmPackage({
      approvalRecord: authority.approvalRecord,
      config: authority.invocation,
      packageSpec: "@scope/mcp-server@1.2.3",
      binName: "scope-mcp",
      root: materializationRoot,
      indexPath,
      npmCli,
      installRunner: fakeInstall,
    });
    materialization.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await vi.waitFor(() => expect(instance?.terminationStarted).toBe(true));
    expect(settled).toBe(false);
    releaseTermination(1);
    await expect(materialization).rejects.toThrow(
      "Worker exited without a result",
    );
    expect(settled).toBe(true);
  });

  it.each([
    ["require(target);", "external module loading"],
    ["import(target);", "external module loading"],
    ["require.resolve(target);", "external module resolution"],
  ])(
    "blocks a dynamic external module retained by the bundle: %s",
    async (loadExpression, blockedKind) => {
      const config = {
        command: "npx",
        args: ["@scope/mcp-server@1.2.3"],
        transport: "stdio",
      };
      const authority = approved(
        config,
        `dynamic-module-server-${loadExpression.slice(0, 6)}`,
      );
      const dynamicInstall = (input) => {
        fakeInstall(input);
        fs.writeFileSync(
          path.join(
            input.directory,
            "node_modules",
            "@scope",
            "mcp-server",
            "bin",
            "server.js",
          ),
          `#!/usr/bin/env node\nconst target = process.argv[2];\n${loadExpression}\n`,
          "utf8",
        );
      };

      let result;
      try {
        result = await materializeMcpStdioNpmPackage({
          approvalRecord: authority.approvalRecord,
          config: authority.invocation,
          packageSpec: "@scope/mcp-server@1.2.3",
          binName: "scope-mcp",
          root: materializationRoot,
          indexPath,
          npmCli,
          installRunner: dynamicInstall,
        });
      } catch (error) {
        expect(error).toEqual(
          expect.objectContaining({
            code: MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED_CODE,
          }),
        );
        expect(fs.existsSync(indexPath)).toBe(false);
        return;
      }
      const execution = spawnSync(
        process.execPath,
        [path.join(result.root, "capsule", "server.cjs"), "./late-external.js"],
        { cwd: path.join(result.root, "capsule"), encoding: "utf8" },
      );
      expect(execution.status).not.toBe(0);
      expect(execution.stderr).toContain(
        `MCP stdio capsule blocked ${blockedKind}: ./late-external.js`,
      );
    },
    30_000,
  );

  it("fails closed when the package depends on a native addon", async () => {
    const config = {
      command: "npx",
      args: ["@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, "native-addon-server");
    const nativeInstall = (input) => {
      fakeInstall(input);
      const packageRoot = path.join(
        input.directory,
        "node_modules",
        "@scope",
        "mcp-server",
      );
      fs.writeFileSync(
        path.join(packageRoot, "bin", "server.js"),
        '#!/usr/bin/env node\nrequire("../addon.node");\n',
        "utf8",
      );
      fs.writeFileSync(path.join(packageRoot, "addon.node"), "not-native");
    };

    await expect(
      materializeMcpStdioNpmPackage({
        approvalRecord: authority.approvalRecord,
        config: authority.invocation,
        packageSpec: "@scope/mcp-server@1.2.3",
        binName: "scope-mcp",
        root: materializationRoot,
        indexPath,
        npmCli,
        installRunner: nativeInstall,
      }),
    ).rejects.toThrow(
      expect.objectContaining({
        code: MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED_CODE,
      }),
    );
    expect(fs.existsSync(indexPath)).toBe(false);
  }, 30_000);

  it("rejects a transitive lock entry without registry integrity", async () => {
    const config = {
      command: "npx",
      args: ["@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, "invalid-lock");
    const invalidInstall = (input) => {
      fakeInstall(input);
      const lockPath = path.join(input.directory, "package-lock.json");
      const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      delete lock.packages["node_modules/transitive-dependency"].integrity;
      writeJson(lockPath, lock);
    };

    await expect(
      materializeMcpStdioNpmPackage({
        approvalRecord: authority.approvalRecord,
        config: authority.invocation,
        packageSpec: "@scope/mcp-server@1.2.3",
        binName: "scope-mcp",
        root: materializationRoot,
        indexPath,
        npmCli,
        installRunner: invalidInstall,
      }),
    ).rejects.toThrow(
      expect.objectContaining({
        code: MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
      }),
    );
    expect(fs.existsSync(indexPath)).toBe(false);
  });

  it("cannot roll the materialization index back to a previously trusted closure", async () => {
    const config = {
      command: "npx",
      args: ["@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, "index-rollback");
    await materializeMcpStdioNpmPackage({
      approvalRecord: authority.approvalRecord,
      config: authority.invocation,
      packageSpec: "@scope/mcp-server@1.2.3",
      binName: "scope-mcp",
      root: materializationRoot,
      indexPath,
      npmCli,
      installRunner: fakeInstall,
    });
    prepareMcpStdioExecutableIdentity({
      serverName: "index-rollback",
      config: authority.invocation,
      approval: authority.approval,
      retrust: true,
      storePath,
      materializationRoot,
      materializationIndexPath: indexPath,
    });
    const oldIndex = fs.readFileSync(indexPath);

    const successorInstall = (input) => {
      fakeInstall(input);
      fs.appendFileSync(
        path.join(
          input.directory,
          "node_modules",
          "transitive-dependency",
          "index.js",
        ),
        "export const successor = true;\n",
        "utf8",
      );
    };
    await materializeMcpStdioNpmPackage({
      approvalRecord: authority.approvalRecord,
      config: authority.invocation,
      packageSpec: "@scope/mcp-server@1.2.3",
      binName: "scope-mcp",
      root: materializationRoot,
      indexPath,
      npmCli,
      installRunner: successorInstall,
    });
    prepareMcpStdioExecutableIdentity({
      serverName: "index-rollback",
      config: authority.invocation,
      approval: authority.approval,
      retrust: true,
      storePath,
      materializationRoot,
      materializationIndexPath: indexPath,
    });

    fs.writeFileSync(indexPath, oldIndex);
    expect(() =>
      prepareMcpStdioExecutableIdentity({
        serverName: "index-rollback",
        config: authority.invocation,
        approval: authority.approval,
        storePath,
        materializationRoot,
        materializationIndexPath: indexPath,
      }),
    ).toThrow(
      expect.objectContaining({ code: MCP_STDIO_EXECUTABLE_CHANGED_CODE }),
    );
  }, 30_000);

  it("runs npm with lifecycle scripts disabled and an exact package spec", async () => {
    const config = {
      command: "npx",
      args: ["-y", "@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, "default-installer");
    const originalProcessBrokerRunSync = _deps.processBrokerRunSync;
    const processBrokerRunSync = vi.fn((command, args, options) => {
      expect(options).toMatchObject({ shell: false, windowsHide: true });
      expect(options.env).not.toHaveProperty("NODE_OPTIONS");
      expect(options.env).not.toHaveProperty("NPM_CONFIG_NODE_OPTIONS");
      if (command === process.execPath) {
        expect(args).toContain("--ignore-scripts");
        expect(args).toContain("--save-exact");
        expect(args.at(-1)).toBe("@scope/mcp-server@1.2.3");
        fakeInstall({
          directory: options.cwd,
          packageSpec: args.at(-1),
        });
        return { status: 0, stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected Broker command: ${command}`);
    });
    _deps.processBrokerRunSync = processBrokerRunSync;
    try {
      await materializeMcpStdioNpmPackage({
        approvalRecord: authority.approvalRecord,
        config: authority.invocation,
        packageSpec: "@scope/mcp-server@1.2.3",
        binName: "scope-mcp",
        root: materializationRoot,
        indexPath,
        npmCli,
        env: {
          PATH: process.env.PATH || "",
          NODE_OPTIONS: "--require ambient-evil.js",
          NPM_CONFIG_NODE_OPTIONS: "--require npm-evil.js",
        },
      });
      expect(processBrokerRunSync).toHaveBeenCalledTimes(1);
    } finally {
      _deps.processBrokerRunSync = originalProcessBrokerRunSync;
    }
  }, 30_000);
});
