import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
  const attestation = options?.hostInputAttestation;
  const spawnOptions = { ...options };
  delete spawnOptions.hostInputAttestation;
  if (!attestation) return spawnSync(command, args, spawnOptions);
  attestation.beforeSpawn();
  try {
    return spawnSync(command, args, spawnOptions);
  } finally {
    attestation.afterSpawn();
  }
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
    _deps.processBrokerRunSync = null;
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

  it("locks the complete transitive tree and replaces a launcher with a direct Node entrypoint", () => {
    const builderInvocations = [];
    _deps.processBrokerRunSync = (command, args, options) => {
      const realpath = fs.realpathSync.native || fs.realpathSync;
      builderInvocations.push({
        args,
        cwd: options.cwd,
        cwdIsCanonical: options.cwd === realpath(options.cwd),
        inputSource: Buffer.from(options.input).toString("utf8"),
      });
      return brokerSpawnSync(command, args, options);
    };
    const config = {
      command: "bunx",
      args: ["--yes", "@scope/mcp-server@1.2.3", "--stdio"],
      transport: "stdio",
    };
    const authority = approved(config);
    const result = materializeMcpStdioNpmPackage({
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
      schema: "chainlesschain.mcp-stdio-node-capsule/v1",
      relativePath: "capsule/server.cjs",
      builder: "esbuild",
      builderVersion: "0.28.1",
      nodeTarget: "node22",
      inputCount: 3,
      wrapperSchema: "chainlesschain.mcp-stdio-capsule-stdin-wrapper/v1",
      wrapperSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(result.identity.capsule.sha256).toMatch(/^[a-f0-9]{64}$/);
    const capsuleSource = fs.readFileSync(
      path.join(result.root, "capsule", "server.cjs"),
      "utf8",
    );
    expect(capsuleSource).toContain("transitive-dependency/index.js");
    const repeated = materializeMcpStdioNpmPackage({
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
    expect(builderInvocations).toHaveLength(2);
    for (const invocation of builderInvocations) {
      expect(invocation.cwdIsCanonical).toBe(true);
      expect(invocation.inputSource).toBe(
        '"use strict";\nrequire("./node_modules/@scope/mcp-server/bin/server.js");\n',
      );
      expect(invocation.args.filter((arg) => !arg.startsWith("--"))).toEqual(
        [],
      );
      expect(invocation.args).toContain(
        "--sourcefile=chainlesschain-capsule-entry.cjs",
      );
      expect(invocation.args).toContain("--loader=js");
      expect(capsuleSource).not.toContain(invocation.cwd);
      expect(capsuleSource).not.toContain(invocation.cwd.replaceAll("\\", "/"));
    }

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

  it("accepts stable descriptor IDs across divergent Windows pathname stat projections", () => {
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
          return options?.bigint && String(file).includes(".capsule-source-")
            ? shiftedStat(stat)
            : stat;
        };
      },
    });
    const config = {
      command: "npx",
      args: ["@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, "windows-stat-view-server");

    const result = materializeMcpStdioNpmPackage({
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
      schema: "chainlesschain.mcp-stdio-node-capsule/v1",
      inputCount: 3,
    });
  });

  it("rejects a pathname re-open that resolves to a different descriptor file ID", () => {
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
              normalized.includes(".capsule-source-") &&
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

    expect(() =>
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
    ).toThrow(
      expect.objectContaining({
        code: MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED_CODE,
        message: expect.stringContaining(
          "build input identity changed before read",
        ),
      }),
    );
    expect(sawVerifierReopen).toBe(true);
    expect(fs.existsSync(indexPath)).toBe(false);
  });

  it("detects an added transitive file before the Broker can spawn", () => {
    const config = {
      command: "npx",
      args: ["@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, "race-server");
    const result = materializeMcpStdioNpmPackage({
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
  });

  it("detects capsule replacement before the Broker can spawn", () => {
    const config = {
      command: "npx",
      args: ["@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, "capsule-race-server");
    const result = materializeMcpStdioNpmPackage({
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
  });

  it("rejects source-tree mutation during capsule construction", () => {
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
    const normalRunSync = _deps.processBrokerRunSync;
    let mutated = false;
    _deps.processBrokerRunSync = (command, args, options) => {
      if (!mutated) {
        mutated = true;
        fs.appendFileSync(
          sourceToMutate,
          "globalThis.compromised = true;\n",
          "utf8",
        );
      }
      return normalRunSync(command, args, options);
    };

    expect(() =>
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
    ).toThrow(
      expect.objectContaining({
        code: MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED_CODE,
        message: expect.stringContaining(
          "dependency closure changed during bundling",
        ),
      }),
    );
    expect(fs.existsSync(indexPath)).toBe(false);
  });

  it.each([
    ["entrypoint bytes", "node_modules/@scope/mcp-server/bin/server.js", false],
    [
      "dependency identity",
      "node_modules/transitive-dependency/index.js",
      true,
    ],
  ])(
    "rejects snapshot %s mutation between attestation and esbuild read",
    (_label, relativeInput, replaceWithIdenticalBytes) => {
      const config = {
        command: "npx",
        args: ["@scope/mcp-server@1.2.3"],
        transport: "stdio",
      };
      const authority = approved(config, `snapshot-race-${_label}`);
      const normalRunSync = _deps.processBrokerRunSync;
      let mutated = false;
      _deps.processBrokerRunSync = (command, args, options) => {
        if (!mutated) {
          mutated = true;
          const inputPath = path.join(options.cwd, ...relativeInput.split("/"));
          if (replaceWithIdenticalBytes) {
            const replacementPath = `${inputPath}.replacement`;
            const originalStat = fs.statSync(inputPath);
            fs.writeFileSync(replacementPath, fs.readFileSync(inputPath));
            fs.chmodSync(replacementPath, originalStat.mode & 0o777);
            fs.rmSync(inputPath);
            fs.renameSync(replacementPath, inputPath);
          } else {
            fs.appendFileSync(
              inputPath,
              "\nglobalThis.snapshotCompromised = true;\n",
              "utf8",
            );
          }
        }
        return normalRunSync(command, args, options);
      };

      expect(() =>
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
      ).toThrow(
        expect.objectContaining({
          code: MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED_CODE,
          message: expect.stringContaining(
            "build input changed during bundling",
          ),
        }),
      );
      expect(fs.existsSync(indexPath)).toBe(false);
    },
  );

  it("rejects a temporary snapshot-root substitution around the build", () => {
    const config = {
      command: "npx",
      args: ["@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, "snapshot-root-swap");
    const normalRunSync = _deps.processBrokerRunSync;
    let substituted = false;
    _deps.processBrokerRunSync = (command, args, options) => {
      if (substituted) return normalRunSync(command, args, options);
      substituted = true;
      const attestedRoot = `${options.cwd}.attested`;
      fs.renameSync(options.cwd, attestedRoot);
      fs.cpSync(attestedRoot, options.cwd, {
        recursive: true,
        preserveTimestamps: true,
      });
      const runtimePath = path.join(
        options.cwd,
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
      try {
        return normalRunSync(command, args, options);
      } finally {
        fs.rmSync(options.cwd, { recursive: true, force: true });
        fs.renameSync(attestedRoot, options.cwd);
      }
    };

    expect(() =>
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
    ).toThrow(
      expect.objectContaining({
        code: MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED_CODE,
        message: expect.stringContaining(
          "build input changed during bundling at broker pre-spawn",
        ),
      }),
    );
    expect(fs.existsSync(indexPath)).toBe(false);
  });

  it("rejects a runner that omits the Broker spawn-boundary attestation", () => {
    const config = {
      command: "npx",
      args: ["@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, "missing-broker-boundary");
    _deps.processBrokerRunSync = spawnSync;

    expect(() =>
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
    ).toThrow(
      expect.objectContaining({
        code: MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED_CODE,
        message: expect.stringContaining(
          "Process Broker omitted spawn-boundary input attestation",
        ),
      }),
    );
    expect(fs.existsSync(indexPath)).toBe(false);
  });

  it.each([
    [
      "resolved target",
      (wrapperImport) => {
        wrapperImport.path = "node_modules/transitive-dependency/index.js";
      },
    ],
    [
      "external edge",
      (wrapperImport) => {
        wrapperImport.external = true;
      },
    ],
  ])("rejects a forged wrapper metafile %s", (_label, forge) => {
    const config = {
      command: "npx",
      args: ["@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, `forged-metafile-${_label}`);
    const normalRunSync = _deps.processBrokerRunSync;
    _deps.processBrokerRunSync = (command, args, options) => {
      const result = normalRunSync(command, args, options);
      if (!result.error && result.status === 0) {
        const metafileArgument = args.find((arg) =>
          arg.startsWith("--metafile="),
        );
        const metafilePath = metafileArgument.slice("--metafile=".length);
        const metafile = JSON.parse(fs.readFileSync(metafilePath, "utf8"));
        const wrapperInput =
          metafile.inputs["chainlesschain-capsule-entry.cjs"];
        forge(wrapperInput.imports[0]);
        writeJson(metafilePath, metafile);
      }
      return result;
    };

    expect(() =>
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
    ).toThrow(
      expect.objectContaining({
        code: MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED_CODE,
        message: expect.stringContaining("did not bind its stdin wrapper"),
      }),
    );
    expect(fs.existsSync(indexPath)).toBe(false);
  });

  it.each(["require(target);", "import(target);"])(
    "blocks a dynamic external module retained by the bundle: %s",
    (loadExpression) => {
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
        result = materializeMcpStdioNpmPackage({
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
        "MCP stdio capsule blocked external module loading: ./late-external.js",
      );
    },
  );

  it("fails closed when the package depends on a native addon", () => {
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

    expect(() =>
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
    ).toThrow(
      expect.objectContaining({
        code: MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED_CODE,
      }),
    );
    expect(fs.existsSync(indexPath)).toBe(false);
  });

  it("rejects a transitive lock entry without registry integrity", () => {
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

    expect(() =>
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
    ).toThrow(
      expect.objectContaining({
        code: MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
      }),
    );
    expect(fs.existsSync(indexPath)).toBe(false);
  });

  it("cannot roll the materialization index back to a previously trusted closure", () => {
    const config = {
      command: "npx",
      args: ["@scope/mcp-server@1.2.3"],
      transport: "stdio",
    };
    const authority = approved(config, "index-rollback");
    materializeMcpStdioNpmPackage({
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
    materializeMcpStdioNpmPackage({
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
  });

  it("runs npm with lifecycle scripts disabled and an exact package spec", () => {
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
      expect(path.basename(command)).toMatch(/^esbuild(?:\.exe)?$/);
      expect(args).toContain("--bundle");
      return originalProcessBrokerRunSync(command, args, options);
    });
    _deps.processBrokerRunSync = processBrokerRunSync;
    try {
      materializeMcpStdioNpmPackage({
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
      expect(processBrokerRunSync).toHaveBeenCalledTimes(2);
    } finally {
      _deps.processBrokerRunSync = originalProcessBrokerRunSync;
    }
  });
});
