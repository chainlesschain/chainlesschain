import { EventEmitter } from "node:events";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MCP_HEADERS_HELPER_MAX_HEADER_COUNT,
  MCP_HEADERS_HELPER_MAX_HEADER_VALUE_BYTES,
  MCP_HEADERS_HELPER_MAX_OUTPUT_BYTES,
  MCP_HEADERS_HELPER_TIMEOUT_MS,
  mergeMcpHeaders,
  resolveMcpHeadersHelperContext,
  runMcpHeadersHelper,
  sanitizeMcpHeadersHelperEnvironment,
  terminateMcpHeadersHelperTree,
} from "../../src/lib/mcp-headers-helper.js";
import { issueProjectMcpWorkspaceAuthority } from "../../src/lib/project-mcp-trust.js";

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function workspace() {
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "cc-mcp-helper-runner-")),
  );
  roots.push(root);
  return root;
}

function childProcess({ stdout = "{}", stderr = "", code = 0 } = {}) {
  const child = new EventEmitter();
  child.pid = 42420;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);
  queueMicrotask(() => {
    child.stdout.write(stdout);
    if (stderr) child.stderr.write(stderr);
    child.stdout.end();
    child.stderr.end();
    child.emit("close", code, null);
  });
  return child;
}

describe("MCP headersHelper runner", () => {
  it("runs with a clean environment and never inherits credential variables", () => {
    expect(
      sanitizeMcpHeadersHelperEnvironment({
        PATH: "/bin",
        HOME: "/home/runner",
        ANTHROPIC_API_KEY: "anthropic-secret",
        AWS_SECRET_ACCESS_KEY: "aws-secret",
        GITHUB_TOKEN: "github-secret",
        SSH_AUTH_SOCK: "/tmp/credential-capability",
      }),
    ).toEqual({ PATH: "/bin", HOME: "/home/runner" });
    expect(() =>
      sanitizeMcpHeadersHelperEnvironment(
        new Proxy({}, { ownKeys: () => ["PATH"] }),
      ),
    ).toThrow(/non-Proxy/);
  });

  it("uses an explicit shell with shell:false and injects server context", async () => {
    const root = workspace();
    const spawn = vi.fn(() =>
      childProcess({ stdout: '{"Authorization":"Bearer fresh"}' }),
    );

    await expect(
      runMcpHeadersHelper(
        {
          command: "get-auth --json",
          cwd: root,
          env: {
            PATH: "/bin",
            ANTHROPIC_API_KEY: "must-not-reach-helper",
          },
          serverName: "internal-api",
          serverUrl: "https://mcp.example.test",
        },
        { spawn, platform: "linux" },
      ),
    ).resolves.toEqual({ Authorization: "Bearer fresh" });
    expect(spawn).toHaveBeenCalledWith(
      "/bin/sh",
      ["-c", "get-auth --json"],
      expect.objectContaining({
        cwd: path.resolve(root),
        shell: false,
        detached: true,
        auditRedactArgIndexes: [1],
        env: expect.objectContaining({
          CLAUDE_CODE_MCP_SERVER_NAME: "internal-api",
          CLAUDE_CODE_MCP_SERVER_URL: "https://mcp.example.test",
        }),
      }),
    );
    expect(spawn.mock.calls[0][2].env).not.toHaveProperty("ANTHROPIC_API_KEY");
  });

  it("never exposes helper stderr in a failure", async () => {
    const root = workspace();
    const error = await runMcpHeadersHelper(
      { command: "plugin-auth", cwd: root, pluginRoot: root },
      {
        spawn: () => childProcess({ stderr: "Bearer super-secret", code: 7 }),
        platform: "linux",
      },
    ).catch((cause) => cause);

    expect(error.code).toBe("CC_MCP_HEADERS_HELPER_FAILED");
    expect(error.message).not.toContain("super-secret");
  });

  it("rejects malformed, non-string, and CRLF header output", async () => {
    const root = workspace();
    for (const stdout of [
      "not-json",
      "[]",
      '{"Authorization":42}',
      '{"Authorization":"ok\\r\\nInjected: yes"}',
    ]) {
      const error = await runMcpHeadersHelper(
        { command: "auth", cwd: root },
        { spawn: () => childProcess({ stdout }), platform: "linux" },
      ).catch((cause) => cause);
      expect(error.code).toBe("CC_MCP_HEADERS_HELPER_OUTPUT_INVALID");
      expect(error.message).not.toContain(stdout);
    }
  });

  it("keeps the 10s/64KiB/128-header/16KiB-value hard limits", () => {
    expect(MCP_HEADERS_HELPER_TIMEOUT_MS).toBe(10_000);
    expect(MCP_HEADERS_HELPER_MAX_OUTPUT_BYTES).toBe(64 * 1024);
    expect(MCP_HEADERS_HELPER_MAX_HEADER_COUNT).toBe(128);
    expect(MCP_HEADERS_HELPER_MAX_HEADER_VALUE_BYTES).toBe(16 * 1024);
    const tooMany = Object.fromEntries(
      Array.from({ length: 129 }, (_, index) => [`X-Limit-${index}`, "ok"]),
    );
    expect(() => mergeMcpHeaders({}, tooMany)).toThrow(/entry count/i);
    expect(() =>
      mergeMcpHeaders({}, { "X-Oversized": "x".repeat(16 * 1024 + 1) }),
    ).toThrow(/invalid name or value/i);
  });

  it("bounds stdout and terminates the helper process group", async () => {
    const root = workspace();
    const child = childProcess({ stdout: "x".repeat(2048) });
    const kill = vi.fn();
    const error = await runMcpHeadersHelper(
      { command: "auth", cwd: root },
      {
        spawn: () => child,
        platform: "linux",
        maxOutputBytes: 1024,
        kill,
        probeGroupGone: () => true,
      },
    ).catch((cause) => cause);

    expect(error.code).toBe("CC_MCP_HEADERS_HELPER_OUTPUT_TOO_LARGE");
    expect(kill).toHaveBeenCalledWith(-child.pid, "SIGKILL");
  });

  it("enforces the hard timeout and terminates the process group", async () => {
    const root = workspace();
    const child = new EventEmitter();
    child.pid = 42421;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn(() => true);
    const kill = vi.fn();

    let settled = false;
    const pending = runMcpHeadersHelper(
      { command: "hang", cwd: root },
      {
        spawn: () => child,
        platform: "linux",
        timeoutMs: 10,
        cleanupTimeoutMs: 100,
        kill,
        probeGroupGone: () => true,
      },
    ).catch((cause) => cause);
    pending.finally(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(settled).toBe(false);
    child.emit("close", null, "SIGKILL");
    const error = await pending;
    expect(error.code).toBe("CC_MCP_HEADERS_HELPER_TIMEOUT");
    expect(error.cleanupConfirmed).toBe(true);
    expect(kill).toHaveBeenCalledWith(-child.pid, "SIGKILL");
  });

  it("requires host authority for local/project sources", () => {
    const projectRoot = workspace();
    const nested = path.join(projectRoot, "packages", "app");
    expect(
      resolveMcpHeadersHelperContext(
        { configScope: "local", projectPath: projectRoot },
        {
          currentWorkspaceBinding: () => ({ workspaceRoot: nested }),
          resolveHostWorkspaceBinding: (binding) => binding,
          checkLocalMcpHeadersHelperTrust: () => ({ status: "trusted" }),
        },
      ),
    ).toEqual({ cwd: nested, pluginRoot: null, execution: null });
    expect(() =>
      resolveMcpHeadersHelperContext(
        {
          configScope: "local",
          projectPath: projectRoot,
          serverName: "api",
          url: "https://mcp.example.test",
          transport: "http",
          headersHelper: "auth-helper",
        },
        {
          currentWorkspaceBinding: () => ({ workspaceRoot: nested }),
          resolveHostWorkspaceBinding: (binding) => binding,
          checkLocalMcpHeadersHelperTrust: () => ({ status: "changed" }),
        },
      ),
    ).toThrow(
      expect.objectContaining({
        code: "CC_MCP_HEADERS_HELPER_UNTRUSTED_WORKSPACE",
      }),
    );
    expect(() =>
      resolveMcpHeadersHelperContext(
        { configScope: "project", projectPath: projectRoot },
        { currentWorkspaceBinding: null },
      ),
    ).toThrow(
      expect.objectContaining({
        code: "CC_MCP_HEADERS_HELPER_UNTRUSTED_WORKSPACE",
      }),
    );
  });

  it("requires a collector-issued authority for project helpers", () => {
    const projectRoot = workspace();
    const file = path.join(projectRoot, ".mcp.json");
    const content = JSON.stringify({ mcpServers: {} });
    writeFileSync(file, content, "utf8");
    const config = {
      configScope: "project",
      configSource: file,
      projectPath: projectRoot,
      serverName: "api",
      url: "https://mcp.example.test/rpc",
      transport: "https",
      headersHelper: "auth-helper",
    };
    const projectMcpWorkspaceAuthority = issueProjectMcpWorkspaceAuthority({
      file,
      content,
      workspaceRoot: projectRoot,
      serverName: config.serverName,
      config,
    });
    const deps = {
      currentWorkspaceBinding: () => ({ workspaceRoot: projectRoot }),
      resolveHostWorkspaceBinding: (binding) => binding,
    };

    expect(
      resolveMcpHeadersHelperContext(
        { ...config, projectMcpWorkspaceAuthority },
        deps,
      ),
    ).toEqual({ cwd: projectRoot, pluginRoot: null, execution: null });
    expect(() =>
      resolveMcpHeadersHelperContext(
        { ...config, projectMcpWorkspaceAuthority: {} },
        deps,
      ),
    ).toThrow(
      expect.objectContaining({
        code: "CC_MCP_HEADERS_HELPER_UNTRUSTED_WORKSPACE",
      }),
    );
  });

  it("preserves normalized sandbox policy for public helper scopes", () => {
    const projectRoot = workspace();
    const nested = path.join(projectRoot, "packages", "app");
    const declared = {
      requiredBoundaries: ["network", "filesystem", "network"],
    };
    const local = resolveMcpHeadersHelperContext(
      {
        configScope: "local",
        projectPath: projectRoot,
        sandboxPolicy: declared,
      },
      {
        currentWorkspaceBinding: () => ({ workspaceRoot: nested }),
        resolveHostWorkspaceBinding: (binding) => binding,
        checkLocalMcpHeadersHelperTrust: () => ({ status: "trusted" }),
      },
    );

    expect(local).toMatchObject({
      cwd: nested,
      pluginRoot: null,
      execution: {
        origin: "mcp:headers-helper:local",
        policy: "allow",
        scope: "mcp",
        sandboxPolicy: {
          requiredBoundaries: ["filesystem", "network"],
        },
      },
    });
    expect(Object.isFrozen(local.execution)).toBe(true);
    expect(Object.isFrozen(local.execution.sandboxPolicy)).toBe(true);
    expect(
      Object.isFrozen(local.execution.sandboxPolicy.requiredBoundaries),
    ).toBe(true);

    for (const configScope of ["user", "managed"]) {
      expect(
        resolveMcpHeadersHelperContext(
          { configScope, sandboxPolicy: declared },
          {
            currentWorkspaceBinding: () => ({ workspaceRoot: nested }),
            resolveHostWorkspaceBinding: (binding) => binding,
          },
        ),
      ).toMatchObject({
        cwd: nested,
        execution: {
          origin: `mcp:headers-helper:${configScope}`,
          sandboxPolicy: {
            requiredBoundaries: ["filesystem", "network"],
          },
        },
      });
    }
  });

  it("rejects policy-bearing public helpers without trusted workspace authority", () => {
    expect(() =>
      resolveMcpHeadersHelperContext(
        {
          configScope: "managed",
          sandboxPolicy: { requiredBoundaries: ["filesystem"] },
        },
        { currentWorkspaceBinding: null },
      ),
    ).toThrow(
      expect.objectContaining({
        code: "CC_MCP_HEADERS_HELPER_UNTRUSTED_WORKSPACE",
      }),
    );
  });

  it("does not execute a sandboxPolicy accessor or Proxy trap", () => {
    let getterCalls = 0;
    const accessor = { configScope: "user" };
    Object.defineProperty(accessor, "sandboxPolicy", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return { requiredBoundaries: ["filesystem"] };
      },
    });
    expect(() => resolveMcpHeadersHelperContext(accessor)).toThrow(
      expect.objectContaining({ code: "CC_MCP_SANDBOX_POLICY_INVALID" }),
    );
    expect(getterCalls).toBe(0);

    let proxyCalls = 0;
    const proxy = new Proxy(
      {
        configScope: "user",
        sandboxPolicy: { requiredBoundaries: ["filesystem"] },
      },
      {
        get() {
          proxyCalls += 1;
          return undefined;
        },
      },
    );
    expect(() => resolveMcpHeadersHelperContext(proxy)).toThrow(
      expect.objectContaining({ code: "CC_MCP_SANDBOX_POLICY_INVALID" }),
    );
    expect(proxyCalls).toBe(0);
  });

  it("preserves trusted plugin provenance and sandbox policy", async () => {
    const pluginRoot = workspace();
    const sandboxPolicy = { requiredBoundaries: ["filesystem", "network"] };
    const context = resolveMcpHeadersHelperContext(
      {
        origin: "plugin:mcp",
        pluginId: "secure-plugin",
        pluginVersion: "1.2.3",
        pluginSource: path.join(pluginRoot, ".mcp.json"),
        pluginWorkspaceAuthority: Object.freeze({}),
        sandboxPolicy,
      },
      { resolvePluginWorkspaceAuthority: () => pluginRoot },
    );
    const contract = Object.freeze({ contract: "opaque" });
    const issueSandboxExecutionContract = vi.fn(() => contract);
    const spawn = vi.fn(() => childProcess({ stdout: '{"X-Auth":"ok"}' }));

    await runMcpHeadersHelper(
      {
        command: "plugin-auth",
        cwd: context.cwd,
        pluginRoot: context.pluginRoot,
        execution: context.execution,
        serverName: "plugin-api",
      },
      { spawn, platform: "linux", issueSandboxExecutionContract },
    );

    expect(issueSandboxExecutionContract).toHaveBeenCalledWith(
      "/bin/sh",
      ["-c", "plugin-auth"],
      expect.objectContaining({
        detached: false,
        origin: "plugin:mcp",
        pluginId: "secure-plugin",
        pluginVersion: "1.2.3",
        sandboxPolicy,
      }),
      pluginRoot,
    );
    expect(spawn).toHaveBeenCalledWith(
      "/bin/sh",
      ["-c", "plugin-auth"],
      expect.objectContaining({
        detached: false,
        sandboxExecutionContract: contract,
        sandboxPolicy,
        pluginId: "secure-plugin",
      }),
    );
  });

  it("uses the sandbox close fence instead of a detached POSIX group", async () => {
    const root = workspace();
    const child = new EventEmitter();
    child.pid = 42422;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn(() => {
      queueMicrotask(() => child.emit("close", null, "SIGKILL"));
      return true;
    });
    const kill = vi.fn();
    const pending = runMcpHeadersHelper(
      {
        command: "hang",
        cwd: root,
        execution: {
          sandboxPolicy: { requiredBoundaries: ["filesystem"] },
        },
      },
      {
        spawn: (_file, _argv, options) => {
          expect(options.detached).toBe(false);
          return child;
        },
        platform: "linux",
        timeoutMs: 10,
        cleanupTimeoutMs: 100,
        kill,
        issueSandboxExecutionContract: (_file, _argv, options) => {
          expect(options.detached).toBe(false);
          return Object.freeze({ contract: "opaque" });
        },
      },
    ).catch((cause) => cause);

    const error = await pending;
    expect(error.code).toBe("CC_MCP_HEADERS_HELPER_TIMEOUT");
    expect(error.cleanupConfirmed).toBe(true);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(kill).not.toHaveBeenCalled();
  });

  it("uses taskkill and waits for Windows child close", async () => {
    const child = new EventEmitter();
    child.pid = 54321;
    child.kill = vi.fn();
    const spawnSync = vi.fn(() => {
      queueMicrotask(() => child.emit("close", null, "SIGKILL"));
      return { status: 0 };
    });
    await expect(
      terminateMcpHeadersHelperTree(child, {
        platform: "win32",
        spawnSync,
      }),
    ).resolves.toEqual({
      requested: true,
      closed: true,
      treeTerminated: true,
    });
    expect(spawnSync).toHaveBeenCalledWith(
      "taskkill",
      ["/PID", "54321", "/T", "/F"],
      expect.objectContaining({ shell: false, windowsHide: true }),
    );
  });
});

describe("MCP helper header merge", () => {
  it("overrides static names case-insensitively and blocks transport headers", () => {
    expect(
      mergeMcpHeaders(
        { Authorization: "old", "X-Static": "yes" },
        { authorization: "fresh", "X-Dynamic": "yes" },
      ),
    ).toEqual({
      authorization: "fresh",
      "X-Static": "yes",
      "X-Dynamic": "yes",
    });
    expect(() => mergeMcpHeaders({}, { "Mcp-Session-Id": "forged" })).toThrow(
      expect.objectContaining({ code: "CC_MCP_HEADERS_HELPER_OUTPUT_INVALID" }),
    );
    for (const dynamic of [
      { Accept: "application/json" },
      { "Content-Type": "text/plain" },
      { "X-Control": "unsafe\0value" },
    ]) {
      expect(() => mergeMcpHeaders({}, dynamic)).toThrow(
        expect.objectContaining({
          code: "CC_MCP_HEADERS_HELPER_OUTPUT_INVALID",
        }),
      );
    }
  });
});
