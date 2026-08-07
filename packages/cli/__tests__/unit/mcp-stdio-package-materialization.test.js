import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeMcpStdioExecutionAuthority,
  issueMcpStdioExecutionAuthority,
  materializeApprovedMcpStdioInvocation,
  resolveMcpStdioExecutionApproval,
} from "../../src/lib/mcp-stdio-execution-authority.js";
import {
  consumeMcpStdioExecutableIdentityAuthority,
  MCP_STDIO_EXECUTABLE_CHANGED_CODE,
  prepareMcpStdioExecutableIdentity,
} from "../../src/lib/mcp-stdio-executable-identity.js";
import {
  _deps,
  materializeMcpStdioNpmPackage,
  MCP_STDIO_PACKAGE_MATERIALIZATION_CHANGED_CODE,
  MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
  parseExactNpmPackageSpec,
  parseNpxMaterializationInvocation,
  resolveMcpStdioPackageMaterialization,
} from "../../src/lib/mcp-stdio-package-materialization.js";

const roots = [];

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
    "export const ready = true;\n",
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
  });

  afterEach(() => {
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

  it("locks the complete transitive tree and replaces npx with a direct Node entrypoint", () => {
    const config = {
      command: "npx",
      args: ["-y", "@scope/mcp-server@1.2.3", "--stdio"],
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

    const resolved = resolveMcpStdioPackageMaterialization({
      approvalRecord: authority.approvalRecord,
      root: materializationRoot,
      indexPath,
    });
    expect(resolved.command).toBe(process.execPath);
    expect(resolved.args[0]).toBe("--no-global-search-paths");
    expect(resolved.args[1]).toMatch(
      /node_modules[\\/]@scope[\\/]mcp-server[\\/]bin[\\/]server\.js$/,
    );
    expect(resolved.args.slice(2)).toEqual(["--stdio"]);

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
    });
    expect(prepared.env).not.toHaveProperty("NODE_OPTIONS");
    expect(
      consumeMcpStdioExecutableIdentityAuthority(prepared.authority, {
        command: prepared.command,
        args: prepared.args,
      }),
    ).toEqual({ identityDigest: prepared.identityDigest });
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
      expect(command).toBe(process.execPath);
      expect(args).toContain("--ignore-scripts");
      expect(args).toContain("--save-exact");
      expect(args.at(-1)).toBe("@scope/mcp-server@1.2.3");
      expect(options).toMatchObject({ shell: false, windowsHide: true });
      expect(options.env).not.toHaveProperty("NODE_OPTIONS");
      expect(options.env).not.toHaveProperty("NPM_CONFIG_NODE_OPTIONS");
      fakeInstall({
        directory: options.cwd,
        packageSpec: args.at(-1),
      });
      return { status: 0, stdout: "", stderr: "" };
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
      expect(processBrokerRunSync).toHaveBeenCalledOnce();
    } finally {
      _deps.processBrokerRunSync = originalProcessBrokerRunSync;
    }
  });
});
