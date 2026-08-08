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
  readProjectMcpRows,
  removeProjectMcpServer,
  registerMcpCommand,
  writeProjectMcpServer,
} from "../../src/commands/mcp.js";
import { consumeMcpStdioExecutionAuthority } from "../../src/lib/mcp-stdio-execution-authority.js";

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

describe("cc mcp add scope default", () => {
  it("registers an explicit executable-byte trust command", () => {
    expect(registeredMcpSubcommands()).toContain("trust-executable");
  });

  it("uses local scope when --scope is omitted", () => {
    expect(parseMcpAddOptions().scope).toBe("local");
  });

  it("parses explicit stdio runtime semantics", () => {
    expect(parseMcpAddOptions(["--runtime-kind", "node"]).runtimeKind).toBe(
      "node",
    );
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
        }),
      ]);
      expect(removeProjectMcpServer("shared-project", nested)).toBe(true);
      expect(readProjectMcpRows(nested)).toEqual([]);
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
