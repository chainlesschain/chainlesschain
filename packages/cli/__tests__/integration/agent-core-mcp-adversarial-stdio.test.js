import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeTool } from "../../src/runtime/agent-core.js";
import { MCPClient } from "../../src/harness/mcp-client.js";
import { createMcpCallLedger } from "../../src/lib/mcp-call-ledger.js";
import { mcpEffectDescriptorFields } from "../../src/lib/mcp-effect-contract.js";
import { issueMcpStdioExecutionAuthority } from "../../src/lib/mcp-stdio-execution-authority.js";

const fixturePath = fileURLToPath(
  new URL("../fixtures/mcp-adversarial-effect-server.mjs", import.meta.url),
);
const SERVER = "adversarial";

describe("agent-core adversarial MCP stdio admission", () => {
  let workspace;
  let client;
  let originalTrust;
  let originalTrustStore;

  beforeEach(async () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-adversarial-"));
    originalTrust = process.env.CC_MCP_EXECUTABLE_TRUST;
    originalTrustStore = process.env.CC_MCP_EXECUTABLE_TRUST_STORE;
    process.env.CC_MCP_EXECUTABLE_TRUST = "1";
    process.env.CC_MCP_EXECUTABLE_TRUST_STORE = path.join(
      workspace,
      "executable-identities.json",
    );

    client = new MCPClient();
    const config = {
      command: process.execPath,
      args: [fixturePath],
      env: {
        ...process.env,
        CC_MCP_ADVERSARIAL_MARKER_ROOT: workspace,
      },
      requestTimeoutMs: 10_000,
      processTreeCleanupTimeoutMs: 5_000,
    };
    config.mcpStdioExecutionAuthority = issueMcpStdioExecutionAuthority({
      serverName: SERVER,
      config,
      approvalKind: "explicit-config",
      approvalSource: "adversarial-integration-fixture",
    });
    await client.connect(SERVER, config);
  }, 30_000);

  afterEach(async () => {
    try {
      await client?.disconnect(SERVER);
    } finally {
      if (originalTrust === undefined) {
        delete process.env.CC_MCP_EXECUTABLE_TRUST;
      } else {
        process.env.CC_MCP_EXECUTABLE_TRUST = originalTrust;
      }
      if (originalTrustStore === undefined) {
        delete process.env.CC_MCP_EXECUTABLE_TRUST_STORE;
      } else {
        process.env.CC_MCP_EXECUTABLE_TRUST_STORE = originalTrustStore;
      }
      fs.rmSync(workspace, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 50,
      });
    }
  }, 20_000);

  function toolContext(rawTool, { permissionConfirm } = {}) {
    const name = `mcp__${SERVER}__${rawTool.name}`;
    const records = [];
    const ledger = createMcpCallLedger({
      sink: async (record) => records.push(record),
    });
    return {
      name,
      records,
      context: {
        cwd: workspace,
        sessionId: "adversarial-session",
        turnId: "adversarial-turn",
        mcpClient: client,
        mcpCallLedger: ledger,
        ...(permissionConfirm ? { permissionConfirm } : {}),
        externalToolDescriptors: {
          [name]: {
            name,
            kind: "mcp",
            category: "mcp",
            source: `mcp:${SERVER}`,
            ...mcpEffectDescriptorFields(rawTool, {
              sourceTrusted: false,
              provenance: "project:adversarial-fixture",
            }),
          },
        },
        externalToolExecutors: {
          [name]: {
            kind: "mcp",
            serverName: SERVER,
            toolName: rawTool.name,
          },
        },
      },
    };
  }

  function transportCalls() {
    const logPath = path.join(workspace, "transport-calls.jsonl");
    if (!fs.existsSync(logPath)) return [];
    return fs
      .readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  it.each([
    ["claimed_read_mutation", "claimed-read.txt"],
    ["unknown_mutation", "unknown.txt"],
    ["declared_write", "write.txt"],
  ])(
    "blocks real stdio %s before transport and mutation without approval",
    async (toolName, markerName) => {
      const rawTool = client
        .listTools(SERVER)
        .find((tool) => tool.name === toolName);
      const harness = toolContext(rawTool);

      const result = await executeTool(
        harness.name,
        { path: markerName },
        harness.context,
      );

      expect(result).toMatchObject({
        policy: {
          decision: "ask",
          via: "mcp-effect-contract",
          code: "CC_MCP_EFFECT_CONFIRMATION_REQUIRED",
          trusted: false,
        },
      });
      expect(transportCalls()).toEqual([]);
      expect(fs.existsSync(path.join(workspace, markerName))).toBe(false);
      expect(harness.records).toEqual([]);
    },
  );

  it("executes only after request approval and records the claimed read as unknown", async () => {
    const rawTool = client
      .listTools(SERVER)
      .find((tool) => tool.name === "claimed_read_mutation");
    const permissionConfirm = vi.fn(async () => true);
    const harness = toolContext(rawTool, { permissionConfirm });
    const markerName = "approved-claimed-read.txt";

    const result = await executeTool(
      harness.name,
      { path: markerName },
      harness.context,
    );

    expect(result.error).toBeUndefined();
    expect(permissionConfirm).toHaveBeenCalledOnce();
    expect(transportCalls()).toEqual([
      { tool: "claimed_read_mutation", path: markerName },
    ]);
    expect(fs.readFileSync(path.join(workspace, markerName), "utf8")).toContain(
      "claimed_read_mutation",
    );
    expect(harness.records[0]).toMatchObject({
      status: "started",
      effectContract: { effect: "unknown", trusted: false },
      resourceScopes: [`path:${markerName}`],
    });
    expect(harness.records.at(-1).status).toBe("completed");
  });
});
