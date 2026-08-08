import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerHostHooksV2Workspace,
  releaseRegisteredHostHooksV2Workspace,
} from "../../src/lib/hooks-v2-workspace-context.js";
import {
  MCP_STDIO_SANDBOX_CWD_INVALID_CODE,
  MCP_STDIO_SANDBOX_WORKSPACE_REQUIRED_CODE,
  resolveMcpStdioSandboxContext,
} from "../../src/lib/mcp-stdio-workspace-authority.js";
import { issuePluginWorkspaceAuthority } from "../../src/lib/plugin-runtime/sandbox-policy.js";
import { issueProjectMcpWorkspaceAuthority } from "../../src/lib/project-mcp-trust.js";

const roots = [];
const bindings = [];

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-workspace-"));
  roots.push(root);
  return fs.realpathSync.native(root);
}

function binding(root) {
  const value = registerHostHooksV2Workspace(root);
  bindings.push(value.bindingId);
  return value;
}

function strictConfig(overrides = {}) {
  return {
    command: "node",
    args: ["server.mjs"],
    sandboxPolicy: { requiredBoundaries: ["network", "filesystem"] },
    ...overrides,
  };
}

afterEach(() => {
  for (const bindingId of bindings.splice(0)) {
    releaseRegisteredHostHooksV2Workspace(bindingId);
  }
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("MCP stdio sandbox workspace authority", () => {
  it("binds a normalized policy to the exact host workspace", () => {
    const root = workspace();
    const context = resolveMcpStdioSandboxContext({
      serverName: "managed",
      config: strictConfig({ configScope: "managed" }),
      workspaceBinding: binding(root),
    });

    expect(context).toEqual({
      sandboxPolicy: {
        requiredBoundaries: ["filesystem", "network"],
      },
      pluginWorkspaceRoot: null,
      workingDirectory: root,
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.sandboxPolicy)).toBe(true);
  });

  it("rejects absent and forged host workspace bindings", () => {
    const root = workspace();
    for (const workspaceBinding of [
      null,
      { bindingId: "a".repeat(64), workspaceRoot: root },
    ]) {
      expect(() =>
        resolveMcpStdioSandboxContext({
          serverName: "strict",
          config: strictConfig(),
          workspaceBinding,
        }),
      ).toThrow(
        expect.objectContaining({
          code: MCP_STDIO_SANDBOX_WORKSPACE_REQUIRED_CODE,
        }),
      );
    }
  });

  it("canonicalizes an in-workspace cwd and rejects escape or missing paths", () => {
    const root = workspace();
    const nested = path.join(root, "packages", "server");
    fs.mkdirSync(nested, { recursive: true });
    const hostBinding = binding(root);

    expect(
      resolveMcpStdioSandboxContext({
        serverName: "nested",
        config: strictConfig({ cwd: path.join("packages", "server") }),
        workspaceBinding: hostBinding,
      }).workingDirectory,
    ).toBe(fs.realpathSync.native(nested));

    for (const cwd of [workspace(), path.join(root, "missing")]) {
      expect(() =>
        resolveMcpStdioSandboxContext({
          serverName: "escape",
          config: strictConfig({ cwd }),
          workspaceBinding: hostBinding,
        }),
      ).toThrow(
        expect.objectContaining({ code: MCP_STDIO_SANDBOX_CWD_INVALID_CODE }),
      );
    }
  });

  it("requires the exact project file authority and current fingerprint", () => {
    const root = workspace();
    const file = path.join(root, ".mcp.json");
    const content = JSON.stringify({ mcpServers: { project: {} } });
    fs.writeFileSync(file, content);
    const config = strictConfig({
      configScope: "project",
      configSource: file,
      projectPath: root,
    });
    config.projectMcpWorkspaceAuthority = issueProjectMcpWorkspaceAuthority({
      file,
      content,
      workspaceRoot: root,
      serverName: "project",
      config,
    });
    const hostBinding = binding(root);

    expect(
      resolveMcpStdioSandboxContext({
        serverName: "project",
        config,
        workspaceBinding: hostBinding,
      }).workingDirectory,
    ).toBe(root);

    expect(() =>
      resolveMcpStdioSandboxContext({
        serverName: "project",
        config: { ...config, projectPath: null },
        workspaceBinding: hostBinding,
      }),
    ).toThrow(
      expect.objectContaining({
        code: MCP_STDIO_SANDBOX_WORKSPACE_REQUIRED_CODE,
      }),
    );

    fs.writeFileSync(file, `${content}\n`);
    expect(() =>
      resolveMcpStdioSandboxContext({
        serverName: "project",
        config,
        workspaceBinding: hostBinding,
      }),
    ).toThrow(
      expect.objectContaining({
        code: MCP_STDIO_SANDBOX_WORKSPACE_REQUIRED_CODE,
      }),
    );
  });

  it("rejects a local source bound to a different project", () => {
    const root = workspace();
    const other = workspace();
    expect(() =>
      resolveMcpStdioSandboxContext({
        serverName: "local",
        config: strictConfig({ configScope: "local", projectPath: other }),
        workspaceBinding: binding(root),
      }),
    ).toThrow(
      expect.objectContaining({
        code: MCP_STDIO_SANDBOX_WORKSPACE_REQUIRED_CODE,
      }),
    );
  });

  it("uses only an exact plugin authority and contains plugin cwd", () => {
    const root = workspace();
    const nested = path.join(root, "server");
    fs.mkdirSync(nested);
    const provenance = {
      origin: "plugin:mcp",
      pluginId: "weather",
      pluginVersion: "1.0.0",
      pluginSource: path.join(root, ".mcp.json"),
    };
    const pluginWorkspaceAuthority = issuePluginWorkspaceAuthority({
      root,
      ...provenance,
    });
    const config = strictConfig({
      ...provenance,
      pluginWorkspaceAuthority,
      cwd: "server",
    });

    expect(
      resolveMcpStdioSandboxContext({
        serverName: "weather",
        config,
        workspaceBinding: null,
      }),
    ).toMatchObject({
      pluginWorkspaceRoot: root,
      workingDirectory: fs.realpathSync.native(nested),
    });

    expect(() =>
      resolveMcpStdioSandboxContext({
        serverName: "weather",
        config: { ...config, pluginVersion: "2.0.0" },
        workspaceBinding: null,
      }),
    ).toThrow(
      expect.objectContaining({
        code: MCP_STDIO_SANDBOX_WORKSPACE_REQUIRED_CODE,
      }),
    );
  });

  it("invalidates a plugin authority when its directory is replaced", () => {
    const root = workspace();
    const moved = `${root}-moved`;
    const provenance = {
      origin: "plugin:mcp",
      pluginId: "weather",
      pluginVersion: "1.0.0",
      pluginSource: path.join(root, ".mcp.json"),
    };
    const pluginWorkspaceAuthority = issuePluginWorkspaceAuthority({
      root,
      ...provenance,
    });
    const config = strictConfig({
      ...provenance,
      pluginWorkspaceAuthority,
    });

    fs.renameSync(root, moved);
    roots.push(moved);
    fs.mkdirSync(root);

    expect(() =>
      resolveMcpStdioSandboxContext({
        serverName: "weather",
        config,
        workspaceBinding: null,
      }),
    ).toThrow(
      expect.objectContaining({
        code: MCP_STDIO_SANDBOX_WORKSPACE_REQUIRED_CODE,
      }),
    );
  });

  it("preserves the legacy no-policy fallback without trusting cwd", () => {
    const context = resolveMcpStdioSandboxContext({
      serverName: "legacy",
      config: { command: "node", cwd: "untrusted-relative-path" },
      workspaceBinding: null,
    });
    expect(context).toEqual({
      sandboxPolicy: null,
      pluginWorkspaceRoot: null,
      workingDirectory: null,
    });
  });

  it("does not execute config accessors or Proxy traps", () => {
    let getterCalls = 0;
    const accessor = { command: "node" };
    Object.defineProperty(accessor, "sandboxPolicy", {
      get() {
        getterCalls += 1;
        return { requiredBoundaries: ["filesystem"] };
      },
    });
    expect(() =>
      resolveMcpStdioSandboxContext({
        serverName: "accessor",
        config: accessor,
        workspaceBinding: null,
      }),
    ).toThrow();
    expect(getterCalls).toBe(0);

    const get = vi.fn();
    expect(() =>
      resolveMcpStdioSandboxContext({
        serverName: "proxy",
        config: new Proxy({}, { get }),
        workspaceBinding: null,
      }),
    ).toThrow();
    expect(get).not.toHaveBeenCalled();
  });
});
