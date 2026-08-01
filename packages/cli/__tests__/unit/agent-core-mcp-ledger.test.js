import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executeTool } from "../../src/runtime/agent-core.js";
import { createMcpCallLedger } from "../../src/lib/mcp-call-ledger.js";

const TOOL_NAME = "mcp__files__update";

function toolOptions(cwd, mcpClient, mcpCallLedger, effectContract) {
  return {
    cwd,
    sessionId: "session-ledger",
    turnId: "turn-ledger",
    mcpClient,
    mcpCallLedger,
    externalToolDescriptors: {
      [TOOL_NAME]: {
        name: TOOL_NAME,
        kind: "mcp",
        category: "mcp",
        source: "mcp:files",
        effectContract,
      },
    },
    externalToolExecutors: {
      [TOOL_NAME]: {
        kind: "mcp",
        serverName: "files",
        toolName: "update",
      },
    },
  };
}

describe("agent-core MCP call ledger", () => {
  let cwd;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-ledger-"));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("prewrites before execution, settles, and exposes the ledger id", async () => {
    const events = [];
    const ledger = createMcpCallLedger({
      sink: async (record, { phase }) => events.push({ phase, record }),
      randomUUID: () => "stable-id",
    });
    const callTool = vi.fn(async () => {
      expect(events.map((event) => event.phase)).toEqual(["started"]);
      return { content: [{ type: "text", text: "updated" }] };
    });

    const result = await executeTool(
      TOOL_NAME,
      { path: "src/a.js", content: "secret-input" },
      toolOptions(cwd, { callTool }, ledger, {
        declaredEffect: "write",
        authorizedEffect: null,
        sourceTrusted: false,
        provenance: "project:mcp",
        annotations: { idempotentHint: false, openWorldHint: false },
      }),
    );

    expect(callTool).toHaveBeenCalledOnce();
    expect(result.mcpLedgerId).toBe("mcp-stable-id-1");
    expect(events.map((event) => event.phase)).toEqual(["started", "settled"]);
    expect(events[0].record).toMatchObject({
      sessionId: "session-ledger",
      turnId: "turn-ledger",
      toolName: "update",
      serverName: "files",
      effectContract: { effect: "write", trusted: false },
      resourceScopes: ["path:src/a.js"],
      status: "started",
    });
    expect(JSON.stringify(events)).not.toContain("secret-input");
    expect(events[1].record.status).toBe("completed");
  });

  it("does not treat an MCP server's read-only claim as host authorization", async () => {
    const records = [];
    const ledger = createMcpCallLedger({
      sink: async (record) => records.push(record),
    });

    await executeTool(
      TOOL_NAME,
      { uri: "https://user:credential@example.test/private?q=query-secret" },
      toolOptions(
        cwd,
        { callTool: vi.fn(async () => ({ ok: true })) },
        ledger,
        {
          declaredEffect: "read",
          authorizedEffect: null,
          sourceTrusted: true,
          annotations: { readOnlyHint: true, openWorldHint: true },
        },
      ),
    );

    expect(records[0].effectContract).toMatchObject({
      effect: "unknown",
      readOnly: false,
      trusted: false,
    });
    expect(records[0].networkScopes).toEqual(["https://example.test"]);
    expect(records[0].resourceScopes).toEqual([]);
    const atRest = JSON.stringify(records);
    expect(atRest).not.toContain("credential");
    expect(atRest).not.toContain("query-secret");
    expect(atRest).not.toContain("/private");
  });

  it("blocks a write MCP call when the prewrite cannot be persisted", async () => {
    const callTool = vi.fn();
    const ledger = createMcpCallLedger({
      sink: async (_record, { phase }) => {
        if (phase === "started") throw new Error("ledger offline");
      },
    });

    const result = await executeTool(
      TOOL_NAME,
      { path: "src/a.js" },
      toolOptions(cwd, { callTool }, ledger, {
        declaredEffect: "write",
        authorizedEffect: null,
        annotations: { readOnlyHint: false },
      }),
    );

    expect(result).toMatchObject({
      policy: { decision: "blocked", via: "mcp-ledger-prewrite" },
    });
    expect(result.error).toContain("ledger prewrite failed");
    expect(callTool).not.toHaveBeenCalled();
  });

  it("surfaces a settlement incident after an already-completed call", async () => {
    const ledger = createMcpCallLedger({
      sink: async (_record, { phase }) => {
        if (phase === "settled") throw new Error("settlement unavailable");
      },
    });
    const callTool = vi.fn(async () => ({ ok: true }));

    const result = await executeTool(
      TOOL_NAME,
      {},
      toolOptions(cwd, { callTool }, ledger, {
        declaredEffect: "write",
        authorizedEffect: null,
        annotations: { readOnlyHint: false },
      }),
    );

    expect(callTool).toHaveBeenCalledOnce();
    expect(result.error).toContain("may have completed");
    expect(result.error).toContain("do not retry automatically");
    expect(result.mcpLedgerIncident).toMatchObject({
      phase: "settled",
      code: "CC_MCP_LEDGER_SETTLE_FAILED",
    });
  });
});
