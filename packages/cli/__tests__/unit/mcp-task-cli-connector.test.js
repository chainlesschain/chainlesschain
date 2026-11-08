import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Command } from "commander";

const root = mkdtempSync(join(tmpdir(), "cc-task-cli-connector-"));
const controls = vi.hoisted(() => ({
  databaseAvailable: true,
  configured: true,
  bootstrap: vi.fn(),
  shutdown: vi.fn(async () => {}),
}));
vi.mock("../../src/lib/paths.js", () => ({
  getHomeDir: () => join(root, "home"),
  getSessionStoreDir: () => join(root, "home", "sessions"),
  getClaudeProjectStorageDir: () => null,
  getStatePath: () => join(root, "home", "state"),
  getMachineSecurityAnchorDir: () => join(root, "security"),
}));
vi.mock("../../src/runtime/bootstrap.js", () => ({
  bootstrap: controls.bootstrap,
  shutdown: controls.shutdown,
}));
vi.mock("../../src/lib/settings-loader.cjs", () => ({
  loadManagedSettings: () => ({ settings: {}, file: null }),
}));
vi.mock("../../src/lib/project-root.cjs", () => ({
  findGitProjectRoot: () => root,
}));
vi.mock("../../src/harness/mcp-client.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    MCPServerConfig: class {
      list({ scope }) {
        return controls.configured && scope === "user"
          ? [
              {
                name: "remote",
                transport: "https",
                url: "https://example.invalid/mcp",
                configScope: "user",
              },
            ]
          : [];
      }
    },
  };
});
const { startSession } =
  await import("../../src/harness/jsonl-session-store.js");
const { acquireSessionHostLease, readSessionHostAuthority } =
  await import("../../src/lib/session-host-lease.js");
const { MCPClient } = await import("../../src/harness/mcp-client.js");
const { registerMcpCommand } = await import("../../src/commands/mcp.js");

beforeEach(() => {
  controls.databaseAvailable = true;
  controls.configured = true;
  controls.bootstrap.mockReset();
  controls.bootstrap.mockImplementation(async () => ({
    db: controls.databaseAvailable ? { getDatabase: () => ({}) } : null,
  }));
  controls.shutdown.mockClear();
});
afterEach(() => {
  process.exitCode = 0;
  vi.restoreAllMocks();
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("MCP Tasks real command registration and strict connector", () => {
  it.each([
    ["connect", "CC_MCP_TASK_CONNECTION_REQUIRED"],
    ["database", "CC_MCP_TASK_CONFIG_UNAVAILABLE"],
    ["server", "CC_MCP_TASK_SERVER_NOT_CONFIGURED"],
  ])(
    "keeps %s failures private, machine readable and lease scoped",
    async (mode, code) => {
      const canary = "PRIVATE_CONNECTOR_CANARY_credential_source";
      controls.databaseAvailable = mode !== "database";
      controls.configured = mode !== "server";
      const sessionId = "connector-" + randomUUID();
      startSession(sessionId, { provider: "test", model: "test" });
      const connect = vi
        .spyOn(MCPClient.prototype, "connect")
        .mockImplementation(async () => {
          throw new Error(canary);
        });
      const disconnect = vi
        .spyOn(MCPClient.prototype, "disconnectAll")
        .mockResolvedValue();
      const exit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit bypassed command cleanup");
      });
      const output = vi.spyOn(console, "log").mockImplementation(() => {});
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
      const program = new Command().option("--verbose");
      registerMcpCommand(program);
      await program.parseAsync(
        [
          "--verbose",
          "mcp",
          "tasks",
          "create",
          "export",
          "--server",
          "remote",
          "--session",
          sessionId,
          "--json",
        ],
        { from: "user" },
      );

      expect(exit).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(controls.bootstrap).toHaveBeenCalledWith({ verbose: false });
      expect(output).toHaveBeenCalledTimes(1);
      expect(errors).not.toHaveBeenCalled();
      expect(warnings).not.toHaveBeenCalled();
      const report = JSON.parse(output.mock.calls[0][0]);
      expect(report).toEqual({
        error: {
          code,
          message:
            "MCP task operation could not complete. Inspect session tasks and recovery before retrying a tool call.",
          outcomeUnknown: false,
        },
      });
      expect(
        JSON.stringify([
          ...output.mock.calls,
          ...errors.mock.calls,
          ...warnings.mock.calls,
        ]),
      ).not.toContain(canary);
      expect(connect).toHaveBeenCalledTimes(mode === "connect" ? 1 : 0);
      expect(disconnect).toHaveBeenCalledTimes(mode === "connect" ? 1 : 0);
      expect(controls.shutdown).toHaveBeenCalledTimes(1);
      expect(readSessionHostAuthority(sessionId).active).toBeNull();
      // Prove cleanup left the session usable for a successor, not just an empty display.
      const successor = acquireSessionHostLease(sessionId, {
        hostKind: "connector-successor",
      });
      try {
        expect(successor.assert()).not.toBeNull();
      } finally {
        successor.release();
      }
    },
  );
});

describe("MCP HTTPS recovery identity (fake TLS identity, no TLS handshake)", () => {
  function fixture() {
    const client = new MCPClient();
    const entry = {
      state: "connected",
      transportKind: "https",
      httpUrl: "https://example.invalid/mcp?tenant=private",
      httpHeaders: { Authorization: "private-credential" },
      httpSessionId: "transport-session-a",
      protocolVersion: "2025-11-25",
      capabilities: { tasks: { requests: { tools: { call: {} } } } },
      _tlsIdentityDigest: "sha256:" + "a".repeat(64),
      config: {
        configScope: "managed",
        tls: { serverName: "example.invalid", rejectUnauthorized: true },
      },
    };
    client.servers.set("remote", entry);
    return { client, entry, key: "b".repeat(64) };
  }

  it("accepts HTTPS while keeping HMAC and live-session binding separate", () => {
    const { client, entry, key } = fixture();
    const first = client.getTaskRecoveryIdentity("remote", key);
    expect(first).toMatch(/^hmac-sha256:[a-f0-9]{64}$/u);
    expect(first).not.toContain("private");
    entry.httpSessionId = "transport-session-b";
    expect(client.getTaskRecoveryIdentity("remote", key)).toBe(first);
    expect(client.getTaskRecoveryIdentity("remote", "c".repeat(64))).not.toBe(
      first,
    );
  });

  it.each([
    "tls-material",
    "tls-name",
    "tls-verification",
    "headers",
    "endpoint",
  ])("binds %s changes using a fake TLS identity snapshot", (change) => {
    const { client, entry, key } = fixture();
    const first = client.getTaskRecoveryIdentity("remote", key);
    if (change === "tls-material")
      entry._tlsIdentityDigest = "sha256:" + "d".repeat(64);
    if (change === "tls-name") entry.config.tls.serverName = "other.invalid";
    if (change === "tls-verification")
      entry.config.tls.rejectUnauthorized = false;
    if (change === "headers")
      entry.httpHeaders.Authorization = "rotated-credential";
    if (change === "endpoint") entry.httpUrl = "https://other.invalid/mcp";
    expect(client.getTaskRecoveryIdentity("remote", key)).not.toBe(first);
  });
});
