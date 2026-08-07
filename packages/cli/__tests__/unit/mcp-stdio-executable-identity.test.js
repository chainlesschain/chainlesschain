import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeMcpStdioExecutionAuthority,
  issueMcpStdioExecutionAuthority,
  materializeApprovedMcpStdioInvocation,
} from "../../src/lib/mcp-stdio-execution-authority.js";
import {
  consumeMcpStdioExecutableIdentityAuthority,
  getMcpStdioExecutableTrustStorePath,
  MCP_STDIO_DYNAMIC_LAUNCHER_UNPINNED_CODE,
  MCP_STDIO_EXECUTABLE_AUTHORITY_REPLAYED_CODE,
  MCP_STDIO_EXECUTABLE_CHANGED_CODE,
  MCP_STDIO_EXECUTABLE_IDENTITY_ROLLBACK_CODE,
  MCP_STDIO_EXECUTABLE_TRUST_REQUIRED_CODE,
  prepareMcpStdioExecutableIdentity,
} from "../../src/lib/mcp-stdio-executable-identity.js";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";

function approvedInvocation(serverName, config) {
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
    config: materializeApprovedMcpStdioInvocation(approval),
  };
}

function canonicalRealPath(file) {
  return fs.realpathSync.native?.(file) || fs.realpathSync(file);
}

describe("MCP stdio executable byte identity", () => {
  let root;
  let script;
  let storePath;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-identity-"));
    script = path.join(root, "server.mjs");
    storePath = path.join(root, "state", "identities.json");
    fs.writeFileSync(script, "process.stdin.resume();\n", "utf8");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("fails closed on first use and reports the exact reviewed hashes", () => {
    const invocation = approvedInvocation("first", {
      command: process.execPath,
      args: [script],
      env: { PRIVATE_TOKEN: "must-not-be-persisted" },
      transport: "stdio",
    });

    let failure;
    try {
      prepareMcpStdioExecutableIdentity({
        serverName: "first",
        ...invocation,
        storePath,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure?.code).toBe(MCP_STDIO_EXECUTABLE_TRUST_REQUIRED_CODE);
    expect(failure?.message).toContain(canonicalRealPath(process.execPath));
    expect(failure?.message).toContain(canonicalRealPath(script));
    expect(failure?.message).toMatch(/sha256:[a-f0-9]{64}/);
    expect(fs.existsSync(storePath)).toBe(false);
  });

  it("persists no environment values and issues a one-shot launch token", () => {
    const invocation = approvedInvocation("trusted", {
      command: process.execPath,
      args: [script],
      env: { PRIVATE_TOKEN: "must-not-be-persisted" },
      transport: "stdio",
    });
    const prepared = prepareMcpStdioExecutableIdentity({
      serverName: "trusted",
      ...invocation,
      retrust: true,
      storePath,
    });

    expect(prepared.command).toBe(canonicalRealPath(process.execPath));
    expect(prepared.args).toEqual([canonicalRealPath(script)]);
    expect(prepared.identity.entrypoints[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.readFileSync(storePath, "utf8")).not.toContain(
      "must-not-be-persisted",
    );
    expect(
      consumeMcpStdioExecutableIdentityAuthority(prepared.authority, {
        command: prepared.command,
        args: prepared.args,
      }),
    ).toEqual({ identityDigest: prepared.identityDigest });
    expect(() =>
      consumeMcpStdioExecutableIdentityAuthority(prepared.authority, {
        command: prepared.command,
        args: prepared.args,
      }),
    ).toThrow(
      expect.objectContaining({
        code: MCP_STDIO_EXECUTABLE_AUTHORITY_REPLAYED_CODE,
      }),
    );
  });

  it("keeps default trust outside CLI home and survives a home rollback", () => {
    const homeDir = path.join(root, "configured-home");
    const securityAnchorDir = path.join(root, "independent-security-state");
    const originalHome = process.env.CHAINLESSCHAIN_HOME;
    const originalSecurityAnchor =
      process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME;
    const originalTrustStore = process.env.CC_MCP_EXECUTABLE_TRUST_STORE;
    try {
      process.env.CHAINLESSCHAIN_HOME = homeDir;
      process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME = securityAnchorDir;
      delete process.env.CC_MCP_EXECUTABLE_TRUST_STORE;
      const invocation = approvedInvocation("independent-store", {
        command: process.execPath,
        args: [script],
        transport: "stdio",
      });

      const first = prepareMcpStdioExecutableIdentity({
        serverName: "independent-store",
        ...invocation,
        retrust: true,
      });
      const defaultStore = getMcpStdioExecutableTrustStorePath();
      expect(path.dirname(defaultStore)).toBe(path.resolve(securityAnchorDir));
      expect(path.relative(homeDir, defaultStore)).toMatch(/^\.\./);
      const trustedBytes = fs.readFileSync(defaultStore, "utf8");

      fs.mkdirSync(homeDir, { recursive: true });
      fs.writeFileSync(path.join(homeDir, "stale-state"), "rollback", "utf8");
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.mkdirSync(homeDir, { recursive: true });

      const afterRollback = prepareMcpStdioExecutableIdentity({
        serverName: "independent-store",
        ...invocation,
      });
      expect(first.trustStatus).toBe("trusted-first-use");
      expect(afterRollback.trustStatus).toBe("trusted");
      expect(fs.readFileSync(defaultStore, "utf8")).toBe(trustedBytes);
    } finally {
      if (originalHome === undefined) delete process.env.CHAINLESSCHAIN_HOME;
      else process.env.CHAINLESSCHAIN_HOME = originalHome;
      if (originalSecurityAnchor === undefined) {
        delete process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME;
      } else {
        process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME =
          originalSecurityAnchor;
      }
      if (originalTrustStore === undefined) {
        delete process.env.CC_MCP_EXECUTABLE_TRUST_STORE;
      } else {
        process.env.CC_MCP_EXECUTABLE_TRUST_STORE = originalTrustStore;
      }
    }
  });

  it("rejects changed entrypoint bytes until they are explicitly retrusted", () => {
    const invocation = approvedInvocation("changed", {
      command: process.execPath,
      args: [script],
      transport: "stdio",
    });
    prepareMcpStdioExecutableIdentity({
      serverName: "changed",
      ...invocation,
      retrust: true,
      storePath,
    });
    fs.appendFileSync(script, "// changed\n", "utf8");

    expect(() =>
      prepareMcpStdioExecutableIdentity({
        serverName: "changed",
        ...invocation,
        storePath,
      }),
    ).toThrow(
      expect.objectContaining({ code: MCP_STDIO_EXECUTABLE_CHANGED_CODE }),
    );

    const retrusted = prepareMcpStdioExecutableIdentity({
      serverName: "changed",
      ...invocation,
      retrust: true,
      storePath,
    });
    expect(retrusted.trustStatus).toBe("retrusted");
  });

  it("rejects a trust-store snapshot restored behind its independent witness", () => {
    const invocation = approvedInvocation("rollback", {
      command: process.execPath,
      args: [script],
      transport: "stdio",
    });
    prepareMcpStdioExecutableIdentity({
      serverName: "rollback",
      ...invocation,
      retrust: true,
      storePath,
    });
    const originalScript = fs.readFileSync(script);
    const originalStore = fs.readFileSync(storePath);
    const witnessPath = `${storePath}.anti-rollback-v1.json`;

    fs.appendFileSync(script, "// explicitly retrusted successor\n", "utf8");
    prepareMcpStdioExecutableIdentity({
      serverName: "rollback",
      ...invocation,
      retrust: true,
      storePath,
    });

    fs.writeFileSync(script, originalScript);
    fs.writeFileSync(storePath, originalStore);
    expect(() =>
      prepareMcpStdioExecutableIdentity({
        serverName: "rollback",
        ...invocation,
        storePath,
      }),
    ).toThrow(
      expect.objectContaining({
        code: MCP_STDIO_EXECUTABLE_IDENTITY_ROLLBACK_CODE,
      }),
    );
    expect(JSON.parse(fs.readFileSync(witnessPath, "utf8"))).toMatchObject({
      version: 1,
      generation: "2",
    });
  });

  it("deterministically recovers both sides of an interrupted trust mutation", () => {
    const invocation = approvedInvocation("pending-recovery", {
      command: process.execPath,
      args: [script],
      transport: "stdio",
    });
    prepareMcpStdioExecutableIdentity({
      serverName: "pending-recovery",
      ...invocation,
      retrust: true,
      storePath,
    });
    const witnessPath = `${storePath}.anti-rollback-v1.json`;
    const scriptBefore = fs.readFileSync(script);
    const storeBefore = fs.readFileSync(storePath);
    const witnessBefore = JSON.parse(fs.readFileSync(witnessPath, "utf8"));

    fs.appendFileSync(script, "// successor bytes\n", "utf8");
    prepareMcpStdioExecutableIdentity({
      serverName: "pending-recovery",
      ...invocation,
      retrust: true,
      storePath,
    });
    const scriptAfter = fs.readFileSync(script);
    const storeAfter = fs.readFileSync(storePath);
    const witnessAfter = JSON.parse(fs.readFileSync(witnessPath, "utf8"));
    const pending = { ...witnessAfter.events.at(-1) };
    delete pending.committedAt;

    fs.writeFileSync(script, scriptBefore);
    fs.writeFileSync(storePath, storeBefore);
    fs.writeFileSync(
      witnessPath,
      `${JSON.stringify({ ...witnessBefore, pending }, null, 2)}\n`,
      "utf8",
    );
    expect(() =>
      prepareMcpStdioExecutableIdentity({
        serverName: "pending-recovery",
        ...invocation,
        storePath,
      }),
    ).toThrow(
      expect.objectContaining({ code: MCP_STDIO_EXECUTABLE_CHANGED_CODE }),
    );
    expect(JSON.parse(fs.readFileSync(witnessPath, "utf8"))).toMatchObject({
      generation: "1",
      pending: null,
    });

    fs.writeFileSync(script, scriptAfter);
    fs.writeFileSync(storePath, storeAfter);
    fs.writeFileSync(
      witnessPath,
      `${JSON.stringify({ ...witnessBefore, pending }, null, 2)}\n`,
      "utf8",
    );
    expect(() =>
      prepareMcpStdioExecutableIdentity({
        serverName: "pending-recovery",
        ...invocation,
        storePath,
      }),
    ).toThrow(
      expect.objectContaining({ code: MCP_STDIO_EXECUTABLE_CHANGED_CODE }),
    );
    expect(JSON.parse(fs.readFileSync(witnessPath, "utf8"))).toMatchObject({
      generation: "2",
      pending: null,
      events: [witnessBefore.events[0], expect.objectContaining(pending)],
    });
  });

  it("re-attests immediately before spawn and rejects a post-approval change", () => {
    const invocation = approvedInvocation("race", {
      command: process.execPath,
      args: [script],
      transport: "stdio",
    });
    const prepared = prepareMcpStdioExecutableIdentity({
      serverName: "race",
      ...invocation,
      retrust: true,
      storePath,
    });
    fs.appendFileSync(script, "// replaced before spawn\n", "utf8");

    expect(() =>
      consumeMcpStdioExecutableIdentityAuthority(prepared.authority, {
        command: prepared.command,
        args: prepared.args,
      }),
    ).toThrow(
      expect.objectContaining({ code: MCP_STDIO_EXECUTABLE_CHANGED_CODE }),
    );
  });

  it("lets the Broker consume the private token and strips it from native spawn", () => {
    const invocation = approvedInvocation("broker", {
      command: process.execPath,
      args: [script],
      transport: "stdio",
    });
    const prepared = prepareMcpStdioExecutableIdentity({
      serverName: "broker",
      ...invocation,
      retrust: true,
      storePath,
    });
    const nativeSpawn = vi.fn(() => {
      const child = new EventEmitter();
      child.pid = 7391;
      return child;
    });
    const previousNative = executionBroker._native;
    const previousSandboxEnabled = executionBroker._platformSandboxEnabled;
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._platformSandboxEnabled = false;
    executionBroker.flushAuditLog();
    try {
      executionBroker.spawn(prepared.command, prepared.args, {
        origin: "test:mcp-byte-identity",
        policy: "allow",
        shell: false,
        mcpStdioExecutableIdentityAuthority: prepared.authority,
      });
      expect(nativeSpawn).toHaveBeenCalledOnce();
      expect(nativeSpawn.mock.calls[0][2]).not.toHaveProperty(
        "mcpStdioExecutableIdentityAuthority",
      );
      expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
        mcpStdioExecutableIdentityDigest: prepared.identityDigest,
      });

      const changedBeforeSpawn = prepareMcpStdioExecutableIdentity({
        serverName: "broker",
        ...invocation,
        storePath,
      });
      fs.appendFileSync(script, "// broker must reject this change\n", "utf8");
      nativeSpawn.mockClear();
      expect(() =>
        executionBroker.spawn(
          changedBeforeSpawn.command,
          changedBeforeSpawn.args,
          {
            origin: "test:mcp-byte-identity",
            policy: "allow",
            shell: false,
            mcpStdioExecutableIdentityAuthority: changedBeforeSpawn.authority,
          },
        ),
      ).toThrow(
        expect.objectContaining({ code: MCP_STDIO_EXECUTABLE_CHANGED_CODE }),
      );
      expect(nativeSpawn).not.toHaveBeenCalled();
    } finally {
      executionBroker._native = previousNative;
      executionBroker._platformSandboxEnabled = previousSandboxEnabled;
      executionBroker.flushAuditLog();
    }
  });

  it.each(["npx", "uvx", "bunx"])(
    "rejects the unpinned dynamic launcher %s",
    (command) => {
      const invocation = approvedInvocation(command, {
        command,
        args: ["example-package"],
        transport: "stdio",
      });
      expect(() =>
        prepareMcpStdioExecutableIdentity({
          serverName: command,
          ...invocation,
          retrust: true,
          storePath,
        }),
      ).toThrow(
        expect.objectContaining({
          code: MCP_STDIO_DYNAMIC_LAUNCHER_UNPINNED_CODE,
        }),
      );
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects direct shebang launchers whose interpreter bytes are not bound",
    () => {
      fs.writeFileSync(script, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      fs.chmodSync(script, 0o755);
      const invocation = approvedInvocation("shebang", {
        command: script,
        args: [],
        transport: "stdio",
      });
      expect(() =>
        prepareMcpStdioExecutableIdentity({
          serverName: "shebang",
          ...invocation,
          retrust: true,
          storePath,
        }),
      ).toThrow(
        expect.objectContaining({
          code: MCP_STDIO_DYNAMIC_LAUNCHER_UNPINNED_CODE,
        }),
      );
    },
  );

  it("fails closed when the durable trust store is corrupt", () => {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, "{not-json", "utf8");
    const invocation = approvedInvocation("corrupt", {
      command: process.execPath,
      args: [script],
      transport: "stdio",
    });

    expect(() =>
      prepareMcpStdioExecutableIdentity({
        serverName: "corrupt",
        ...invocation,
        retrust: true,
        storePath,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "DURABLE_SECURITY_STORE_CORRUPT_FAILED",
      }),
    );
  });
});
