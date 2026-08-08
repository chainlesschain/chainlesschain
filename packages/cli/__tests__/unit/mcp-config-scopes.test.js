import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  MCPServerConfig,
  normalizeMcpConfigScope,
} from "../../src/harness/mcp-client.js";
import {
  authorizeMcpRowForConnect,
  diagnoseMcpTransportConfig,
  managedMcpRowsFromSettings,
  mcpSandboxPolicyUpdateFromAddOptions,
  readProjectMcpRows,
  removeProjectMcpServer,
  registerMcpCommand,
  resolveMcpCommandStdioWorkingDirectory,
  writeProjectMcpServer,
} from "../../src/commands/mcp.js";
import {
  consumeMcpStdioExecutionAuthority,
  issueMcpStdioExecutionAuthority,
} from "../../src/lib/mcp-stdio-execution-authority.js";
import {
  registerHostHooksV2Workspace,
  releaseRegisteredHostHooksV2Workspace,
} from "../../src/lib/hooks-v2-workspace-context.js";

function parseMcpAddOptions(argv = []) {
  const program = new Command();
  registerMcpCommand(program);
  const mcp = program.commands.find((command) => command.name() === "mcp");
  const add = mcp.commands.find((command) => command.name() === "add");
  add.parseOptions(["example", "--command", "node", ...argv]);
  return add.opts();
}

function registeredMcpSubcommands() {
  const program = new Command();
  registerMcpCommand(program);
  const mcp = program.commands.find((command) => command.name() === "mcp");
  return mcp.commands.map((command) => command.name());
}

function storedMcpRow(db, name, configScope, projectPath = null) {
  const row = (db.data.get("mcp_servers") || []).find(
    (candidate) =>
      candidate.display_name === name &&
      candidate.config_scope === configScope &&
      (projectPath == null || candidate.project_path === projectPath),
  );
  if (!row) {
    throw new Error(
      `Missing stored MCP row ${configScope}:${projectPath || "global"}:${name}`,
    );
  }
  return row;
}

function corruptStoredMcpPolicy(db, name, configScope, projectPath = null) {
  const row = storedMcpRow(db, name, configScope, projectPath);
  row.sandbox_policy = "{not-json";
  return row;
}

describe("cc mcp add scope default", () => {
  it("registers an explicit executable-byte trust command", () => {
    expect(registeredMcpSubcommands()).toContain("trust-executable");
  });

  it("resolves executable trust against the same canonical strict cwd as connect", () => {
    const root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-trust-cwd-")),
    );
    const service = path.join(root, "service");
    fs.mkdirSync(service);
    const workspaceBinding = registerHostHooksV2Workspace(root);
    const config = {
      command: "node",
      cwd: "service",
      sandboxPolicy: { requiredBoundaries: ["filesystem"] },
    };
    const token = issueMcpStdioExecutionAuthority({
      serverName: "strict",
      config,
      approvalKind: "explicit-config",
      approvalSource: "test:strict",
      workspaceBinding,
    });
    const approval = consumeMcpStdioExecutionAuthority(token, {
      serverName: "strict",
      config,
    });

    try {
      expect(
        resolveMcpCommandStdioWorkingDirectory(
          "strict",
          config,
          approval,
          workspaceBinding,
        ),
      ).toBe(fs.realpathSync.native(service));
    } finally {
      releaseRegisteredHostHooksV2Workspace(workspaceBinding.bindingId);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses local scope when --scope is omitted", () => {
    expect(parseMcpAddOptions().scope).toBe("local");
  });

  it("parses explicit stdio runtime semantics", () => {
    expect(parseMcpAddOptions(["--runtime-kind", "node"]).runtimeKind).toBe(
      "node",
    );
  });

  it("parses repeatable explicit sandbox boundaries", () => {
    const options = parseMcpAddOptions([
      "--sandbox-boundary",
      "network",
      "--sandbox-boundary",
      "filesystem",
      "--sandbox-boundary",
      "network",
    ]);
    expect(options.sandboxBoundary).toEqual([
      "network",
      "filesystem",
      "network",
    ]);
    expect(mcpSandboxPolicyUpdateFromAddOptions(options)).toEqual({
      requiredBoundaries: ["filesystem", "network"],
    });
  });

  it("distinguishes omitted, explicit clear, and invalid boundary updates", () => {
    expect(mcpSandboxPolicyUpdateFromAddOptions({})).toBeUndefined();
    expect(
      mcpSandboxPolicyUpdateFromAddOptions({ clearSandboxBoundaries: true }),
    ).toBeNull();
    expect(() =>
      mcpSandboxPolicyUpdateFromAddOptions({
        sandboxBoundary: ["process-tree"],
      }),
    ).toThrow(
      expect.objectContaining({ code: "CC_MCP_SANDBOX_POLICY_INVALID" }),
    );
    expect(() =>
      mcpSandboxPolicyUpdateFromAddOptions({
        sandboxBoundary: ["network"],
        clearSandboxBoundaries: true,
      }),
    ).toThrow(/cannot be combined/);
  });

  it("honours an explicit user scope", () => {
    expect(parseMcpAddOptions(["--scope", "user"]).scope).toBe("user");
  });

  it("registers the dynamic headers helper option without printing its value", () => {
    expect(
      parseMcpAddOptions([
        "--headers-helper",
        "credential-helper --profile production",
      ]).headersHelper,
    ).toBe("credential-helper --profile production");
  });

  it("keeps the programmatic and legacy default at user scope", () => {
    expect(normalizeMcpConfigScope()).toBe("user");

    const config = new MCPServerConfig(new MockDatabase());
    config.add("legacy", { command: "node" });
    expect(config.get("legacy", { allScopes: true }).configScope).toBe("user");
  });
});

describe("MCP configuration scopes", () => {
  it("authorizes a registered stdio row with a one-shot bound capability", () => {
    const row = {
      name: "registered",
      command: "node",
      args: ["server.mjs"],
      configScope: "user",
      configSource: "database",
    };
    const authorized = authorizeMcpRowForConnect(row);

    expect(
      consumeMcpStdioExecutionAuthority(authorized.mcpStdioExecutionAuthority, {
        serverName: row.name,
        config: authorized,
      }),
    ).toMatchObject({ approvalKind: "registered-config" });
  });

  it("validates the four public scopes", () => {
    for (const scope of ["local", "project", "user", "managed"]) {
      expect(normalizeMcpConfigScope(scope.toUpperCase())).toBe(scope);
    }
    expect(() => normalizeMcpConfigScope("global")).toThrow(
      /Invalid MCP scope/,
    );
  });

  it("persists headers, scope, source, and project authority", () => {
    const config = new MCPServerConfig(new MockDatabase());
    config.add("project-api", {
      url: "wss://example.test/mcp",
      transport: "wss",
      headers: { Authorization: "Bearer test" },
      configScope: "project",
      projectPath: "C:\\work\\alpha",
    });

    const row = config.get("project-api", { allScopes: true });
    expect(row).toMatchObject({
      configScope: "project",
      configSource: "project:C:\\work\\alpha",
      projectPath: "C:\\work\\alpha",
      headers: { Authorization: "Bearer test" },
    });
  });

  it("normalizes managed sandbox policy without losing runtimeKind", () => {
    const [row] = managedMcpRowsFromSettings(
      {
        managedMcpServers: {
          corporate: {
            command: "renamed-node",
            args: ["server.mjs"],
            runtimeKind: "node",
            cwd: "services/corporate",
            sandboxPolicy: {
              requiredBoundaries: ["network", "filesystem", "network"],
            },
          },
        },
      },
      "C:\\managed-settings.json",
    );

    expect(row).toMatchObject({
      name: "corporate",
      runtimeKind: "node",
      cwd: "services/corporate",
      configScope: "managed",
      sandboxPolicy: {
        requiredBoundaries: ["filesystem", "network"],
      },
    });
    expect(Object.isFrozen(row.sandboxPolicy)).toBe(true);
  });

  it("fails closed on a corrupt managed sandbox policy", () => {
    expect(() =>
      managedMcpRowsFromSettings(
        {
          mcpServers: {
            corporate: {
              command: "node",
              sandboxPolicy: { requiredBoundaries: ["process-tree"] },
            },
          },
        },
        "managed-settings.json",
      ),
    ).toThrow(
      expect.objectContaining({ code: "CC_MCP_SANDBOX_POLICY_INVALID" }),
    );
  });

  it("fails closed instead of widening a strict server with invalid cwd", () => {
    expect(() =>
      managedMcpRowsFromSettings(
        {
          mcpServers: {
            corporate: {
              command: "node",
              cwd: { intended: "services/narrow" },
              sandboxPolicy: { requiredBoundaries: ["filesystem"] },
            },
          },
        },
        "managed-settings.json",
      ),
    ).toThrow(
      expect.objectContaining({ code: "CC_MCP_STDIO_SANDBOX_CWD_INVALID" }),
    );

    const config = new MCPServerConfig(new MockDatabase());
    expect(() =>
      config.add("strict", {
        command: "node",
        cwd: { intended: "services/narrow" },
        sandboxPolicy: { requiredBoundaries: ["filesystem"] },
      }),
    ).toThrow(
      expect.objectContaining({ code: "CC_MCP_STDIO_SANDBOX_CWD_INVALID" }),
    );
  });

  it("does not surface local/project rows in an unrelated workspace", () => {
    const config = new MCPServerConfig(new MockDatabase());
    config.add("private", {
      command: "node",
      configScope: "local",
      projectPath: "C:\\work\\alpha",
    });
    expect(config.list({ cwd: "C:\\work\\beta" })).toEqual([]);
    expect(config.list({ allScopes: true })).toHaveLength(1);
  });

  it("round-trips and preserves a registered strict cwd until explicitly cleared", () => {
    const config = new MCPServerConfig(new MockDatabase());
    config.add("strict", {
      command: "node",
      cwd: "services/strict",
      sandboxPolicy: { requiredBoundaries: ["filesystem"] },
    });
    expect(config.get("strict", { allScopes: true })).toMatchObject({
      cwd: "services/strict",
      sandboxPolicy: { requiredBoundaries: ["filesystem"] },
    });

    config.add("strict", { command: "renamed-node" });
    expect(config.get("strict", { allScopes: true })).toMatchObject({
      command: "renamed-node",
      cwd: "services/strict",
      sandboxPolicy: { requiredBoundaries: ["filesystem"] },
    });

    config.add("strict", {
      command: "renamed-node",
      cwd: null,
      sandboxPolicy: null,
    });
    expect(config.get("strict", { allScopes: true })).not.toHaveProperty("cwd");
  });

  it("keeps same-name scopes distinct and applies local > project > user", () => {
    const config = new MCPServerConfig(new MockDatabase());
    config.add("shared", { command: "user-command", configScope: "user" });
    config.add("shared", {
      command: "project-command",
      configScope: "project",
      projectPath: process.cwd(),
    });
    config.add("shared", {
      command: "local-command",
      configScope: "local",
      projectPath: process.cwd(),
    });

    expect(config.list({ allScopes: true })).toHaveLength(3);
    expect(config.get("shared").command).toBe("local-command");
    expect(config.get("shared", { scope: "project" }).command).toBe(
      "project-command",
    );
    expect(config.remove("shared", { scope: "local" })).toBe(true);
    expect(config.get("shared").command).toBe("project-command");
  });

  it.each([
    ["managed", "local"],
    ["local", "project"],
    ["project", "user"],
    ["user", null],
  ])(
    "treats a corrupt %s row as a fail-closed tombstone over lower scopes",
    (corruptScope, lowerScope) => {
      const db = new MockDatabase();
      const config = new MCPServerConfig(db);
      const workspace = path.resolve(process.cwd(), "mcp-corrupt-matrix");
      const cwd = path.join(workspace, "nested");
      const name = `blocked-${corruptScope}`;
      const scopedConfig = (scope, command, autoConnect = true) => ({
        command,
        autoConnect,
        configScope: scope,
        ...(scope === "local" || scope === "project"
          ? { projectPath: workspace }
          : {}),
        ...(scope === "managed" ? { allowManagedWrite: true } : {}),
      });

      if (lowerScope) {
        config.add(name, scopedConfig(lowerScope, "lower-command"));
      }
      config.add(name, scopedConfig(corruptScope, "corrupt-command"));
      config.add("healthy-sibling", {
        command: "healthy-command",
        configScope: "user",
      });
      corruptStoredMcpPolicy(
        db,
        name,
        corruptScope,
        corruptScope === "local" || corruptScope === "project"
          ? workspace
          : null,
      );
      const invalidRows = [];

      expect(
        config.list({
          cwd,
          onInvalidRow: (error, row) => invalidRows.push({ error, row }),
        }),
      ).toEqual([
        expect.objectContaining({
          name: "healthy-sibling",
          command: "healthy-command",
        }),
      ]);
      expect(config.get(name, { cwd })).toBeNull();
      expect(invalidRows).toHaveLength(1);
      expect(invalidRows[0].row.display_name).toBe(name);
      expect(invalidRows[0].error).toMatchObject({
        code: "CC_MCP_SANDBOX_POLICY_INVALID",
      });
    },
  );

  it.each([
    ["managed", "local"],
    ["local", "project"],
    ["project", "user"],
  ])(
    "does not let a corrupt lower %s > %s candidate shadow the valid higher scope",
    (higherScope, lowerScope) => {
      const db = new MockDatabase();
      const config = new MCPServerConfig(db);
      const workspace = path.resolve(process.cwd(), "mcp-lower-corrupt");
      const cwd = path.join(workspace, "nested");
      const name = `higher-${higherScope}`;
      const addAtScope = (scope, command) =>
        config.add(name, {
          command,
          configScope: scope,
          ...(scope === "local" || scope === "project"
            ? { projectPath: workspace }
            : {}),
          ...(scope === "managed" ? { allowManagedWrite: true } : {}),
        });

      addAtScope(lowerScope, "corrupt-lower-command");
      addAtScope(higherScope, "valid-higher-command");
      corruptStoredMcpPolicy(
        db,
        name,
        lowerScope,
        lowerScope === "local" || lowerScope === "project" ? workspace : null,
      );
      const invalidRows = [];

      expect(
        config.get(name, {
          cwd,
          onInvalidRow: (error, row) => invalidRows.push({ error, row }),
        }),
      ).toMatchObject({
        command: "valid-higher-command",
        configScope: higherScope,
      });
      expect(invalidRows).toEqual([]);
    },
  );

  it("ignores corrupt local/project rows outside the active workspace", () => {
    const db = new MockDatabase();
    const config = new MCPServerConfig(db);
    const activeWorkspace = path.resolve(process.cwd(), "mcp-active-workspace");
    const unrelatedWorkspace = path.resolve(
      process.cwd(),
      "mcp-unrelated-workspace",
    );

    for (const scope of ["local", "project"]) {
      const name = `unrelated-${scope}`;
      config.add(name, {
        command: "user-command",
        configScope: "user",
      });
      config.add(name, {
        command: "unrelated-command",
        configScope: scope,
        projectPath: unrelatedWorkspace,
      });
      corruptStoredMcpPolicy(db, name, scope, unrelatedWorkspace);
    }
    const invalidRows = [];

    expect(
      config.list({
        cwd: path.join(activeWorkspace, "nested"),
        onInvalidRow: (error, row) => invalidRows.push({ error, row }),
      }),
    ).toEqual([
      expect.objectContaining({
        name: "unrelated-local",
        command: "user-command",
        configScope: "user",
      }),
      expect.objectContaining({
        name: "unrelated-project",
        command: "user-command",
        configScope: "user",
      }),
    ]);
    expect(invalidRows).toEqual([]);
  });

  it("lets a higher autoConnect=false row suppress a lower auto-connect row", () => {
    const db = new MockDatabase();
    const config = new MCPServerConfig(db);
    const workspace = path.resolve(process.cwd(), "mcp-auto-connect");
    const cwd = path.join(workspace, "nested");
    config.add("disabled", {
      command: "user-command",
      autoConnect: true,
      configScope: "user",
    });
    config.add("disabled", {
      command: "project-command",
      autoConnect: false,
      configScope: "project",
      projectPath: workspace,
    });
    config.add("enabled-sibling", {
      command: "enabled-command",
      autoConnect: true,
      configScope: "user",
    });

    expect(config.get("disabled", { cwd })).toMatchObject({
      configScope: "project",
      autoConnect: false,
    });
    expect(config.getAutoConnect({ cwd })).toEqual([
      expect.objectContaining({ name: "enabled-sibling", autoConnect: true }),
    ]);
  });

  it("uses the most specific same-scope project and fails closed on corrupt child/tie rows", () => {
    const db = new MockDatabase();
    const config = new MCPServerConfig(db);
    const root = path.resolve(process.cwd(), "mcp-project-root");
    const child = path.join(root, "packages", "app");
    const cwd = path.join(child, "src");

    config.add("nested", {
      command: "root-command",
      configScope: "project",
      projectPath: root,
    });
    config.add("nested", {
      command: "child-command",
      configScope: "project",
      projectPath: child,
    });

    config.add("child-blocked", {
      command: "parent-command",
      configScope: "project",
      projectPath: root,
    });
    config.add("child-blocked-storage", {
      command: "corrupt-child-command",
      configScope: "project",
      projectPath: child,
    });
    const corruptChild = corruptStoredMcpPolicy(
      db,
      "child-blocked-storage",
      "project",
      child,
    );
    corruptChild.display_name = "child-blocked";

    config.add("tied", {
      command: "valid-tied-command",
      configScope: "project",
      projectPath: child,
    });
    config.add("tied-corrupt-storage", {
      command: "corrupt-tied-command",
      configScope: "project",
      projectPath: child,
    });
    const corruptTie = corruptStoredMcpPolicy(
      db,
      "tied-corrupt-storage",
      "project",
      child,
    );
    corruptTie.display_name = "tied";
    const invalidRows = [];

    expect(config.get("nested", { cwd })).toMatchObject({
      command: "child-command",
      projectPath: child,
    });
    expect(config.get("nested", { cwd, scope: "project" })).toMatchObject({
      command: "child-command",
      projectPath: child,
    });
    expect(
      config.list({
        cwd,
        scope: "project",
        onInvalidRow: (error, row) => invalidRows.push({ error, row }),
      }),
    ).toEqual([
      expect.objectContaining({ name: "nested", command: "child-command" }),
    ]);
    expect(config.get("child-blocked", { cwd })).toBeNull();
    expect(config.get("tied", { cwd })).toBeNull();
    expect(invalidRows).toHaveLength(2);
    expect(invalidRows.map(({ row }) => row.display_name).sort()).toEqual([
      "child-blocked",
      "tied",
    ]);
  });

  it("keeps default tombstones while allowing explicit scoped and all-scope inspection", () => {
    const db = new MockDatabase();
    const config = new MCPServerConfig(db);
    config.add("scope-view", {
      command: "user-command",
      configScope: "user",
    });
    config.add("scope-view", {
      command: "managed-command",
      configScope: "managed",
      allowManagedWrite: true,
    });
    corruptStoredMcpPolicy(db, "scope-view", "managed");

    expect(config.get("scope-view")).toBeNull();
    expect(config.list()).toEqual([]);
    expect(config.get("scope-view", { scope: "user" })).toMatchObject({
      command: "user-command",
      configScope: "user",
    });
    expect(config.list({ scope: "user" })).toEqual([
      expect.objectContaining({ name: "scope-view", configScope: "user" }),
    ]);
    expect(config.get("scope-view", { scope: "managed" })).toBeNull();
    expect(config.list({ scope: "managed" })).toEqual([]);
    expect(config.get("scope-view", { allScopes: true })).toMatchObject({
      command: "user-command",
      configScope: "user",
    });
    expect(config.list({ allScopes: true })).toEqual([
      expect.objectContaining({ name: "scope-view", configScope: "user" }),
    ]);
  });

  it("keeps managed rows read-only", () => {
    const config = new MCPServerConfig(new MockDatabase());
    expect(() =>
      config.add("managed", {
        command: "node",
        configScope: "managed",
      }),
    ).toThrow(/read-only/);
    config.add("managed", {
      command: "node",
      configScope: "managed",
      allowManagedWrite: true,
    });
    expect(() => config.remove("managed")).toThrow(/read-only/);
  });

  it("persists project scope in the shared project-root .mcp.json", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-scope-"));
    const nested = path.join(root, "packages", "app");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(root, ".git"), "gitdir: test\n");
    try {
      const source = writeProjectMcpServer(
        "shared-project",
        {
          command: "custom-node",
          args: ["server.mjs"],
          runtimeKind: "node",
          cwd: "services/shared-project",
          sandboxPolicy: {
            requiredBoundaries: ["network", "filesystem"],
          },
          transport: "stdio",
        },
        nested,
      );
      expect(source).toBe(path.join(root, ".mcp.json"));
      expect(readProjectMcpRows(nested)).toEqual([
        expect.objectContaining({
          name: "shared-project",
          configScope: "project",
          configSource: source,
          projectPath: root,
          runtimeKind: "node",
          cwd: "services/shared-project",
          sandboxPolicy: {
            requiredBoundaries: ["filesystem", "network"],
          },
        }),
      ]);
      expect(removeProjectMcpServer("shared-project", nested)).toBe(true);
      expect(readProjectMcpRows(nested)).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves a hand-written project sandbox policy on CLI-style update", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-policy-keep-"));
    fs.writeFileSync(path.join(root, ".git"), "gitdir: test\n");
    const file = path.join(root, ".mcp.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        mcpServers: {
          strict: {
            command: "old-node",
            cwd: "safe-subdir",
            sandboxPolicy: { requiredBoundaries: ["network"] },
          },
        },
      }),
    );
    try {
      writeProjectMcpServer("strict", { command: "new-node" }, root);
      const document = JSON.parse(fs.readFileSync(file, "utf8"));
      expect(document.mcpServers.strict).toMatchObject({
        command: "new-node",
        cwd: "safe-subdir",
        sandboxPolicy: { requiredBoundaries: ["network"] },
      });

      writeProjectMcpServer(
        "strict",
        { command: "new-node", sandboxPolicy: null },
        root,
      );
      const cleared = JSON.parse(fs.readFileSync(file, "utf8"));
      expect(cleared.mcpServers.strict.cwd).toBe("safe-subdir");
      expect(cleared.mcpServers.strict).not.toHaveProperty("sandboxPolicy");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite a corrupt hand-written project sandbox policy", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-policy-bad-"));
    fs.writeFileSync(path.join(root, ".git"), "gitdir: test\n");
    const file = path.join(root, ".mcp.json");
    const original = JSON.stringify({
      mcpServers: {
        strict: {
          command: "old-node",
          sandboxPolicy: { requiredBoundaries: ["process-tree"] },
        },
      },
    });
    fs.writeFileSync(file, original);
    try {
      expect(() =>
        writeProjectMcpServer("strict", { command: "new-node" }, root),
      ).toThrow(
        expect.objectContaining({ code: "CC_MCP_SANDBOX_POLICY_INVALID" }),
      );
      expect(fs.readFileSync(file, "utf8")).toBe(original);
      expect(() => readProjectMcpRows(root)).toThrow(
        expect.objectContaining({ code: "CC_MCP_SANDBOX_POLICY_INVALID" }),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite a project strict server with invalid cwd", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-cwd-bad-"));
    fs.writeFileSync(path.join(root, ".git"), "gitdir: test\n");
    const file = path.join(root, ".mcp.json");
    const original = JSON.stringify({
      mcpServers: {
        strict: {
          command: "old-node",
          cwd: { intended: "safe-subdir" },
          sandboxPolicy: { requiredBoundaries: ["filesystem"] },
        },
      },
    });
    fs.writeFileSync(file, original);
    try {
      expect(() =>
        writeProjectMcpServer("strict", { command: "new-node" }, root),
      ).toThrow(
        expect.objectContaining({
          code: "CC_MCP_STDIO_SANDBOX_CWD_INVALID",
        }),
      );
      expect(fs.readFileSync(file, "utf8")).toBe(original);
      expect(() => readProjectMcpRows(root)).toThrow(
        expect.objectContaining({
          code: "CC_MCP_STDIO_SANDBOX_CWD_INVALID",
        }),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses an untrusted project-file stdio row", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-untrusted-"));
    fs.writeFileSync(path.join(root, ".git"), "gitdir: test\n");
    fs.writeFileSync(
      path.join(root, ".mcp.json"),
      JSON.stringify({ mcpServers: { local: { command: "node" } } }),
    );
    try {
      const [row] = readProjectMcpRows(root);
      expect(() => authorizeMcpRowForConnect(row)).toThrow(
        expect.objectContaining({
          code: "CC_MCP_STDIO_LOCAL_CODE_TRUST_REQUIRED",
        }),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("MCP transport doctor diagnostics", () => {
  it("accepts a valid WebSocket endpoint", () => {
    expect(
      diagnoseMcpTransportConfig({
        transport: "wss",
        url: "wss://example.test/mcp",
      }),
    ).toMatchObject({ ok: true, code: "ok", transport: "wss" });
  });

  it("reports malformed and scheme-mismatched URLs structurally", () => {
    expect(
      diagnoseMcpTransportConfig({ transport: "ws", url: "not a URL" }),
    ).toMatchObject({ ok: false, code: "malformed_url" });
    expect(
      diagnoseMcpTransportConfig({
        transport: "ws",
        url: "https://example.test/mcp",
      }),
    ).toMatchObject({ ok: false, code: "scheme_mismatch" });
  });
});
