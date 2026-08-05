import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { executeTool } from "../../src/runtime/agent-core.js";
import {
  MCPClient,
  ServerState,
  _deps as mcpDeps,
} from "../../src/harness/mcp-client.js";
import {
  computeMcpExactReplayDigest,
  createMcpCallLedger,
  summarizeMcpPayload,
} from "../../src/lib/mcp-call-ledger.js";
import {
  MCP_EXACT_REPLAY_DENIED_CODE,
  createMcpRecoveryAdmissionController,
  guardMcpLedgerForRecovery,
} from "../../src/lib/mcp-ledger-recovery-admission.js";

const TOOL_NAME = "mcp__files__update";
const originalMcpDeps = { ...mcpDeps };

function rpcErrorResponse(requestId, message, data = {}) {
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-type"
          ? "application/json"
          : null;
      },
    },
    async text() {
      return JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        error: { code: -32000, message, data },
      });
    },
  };
}

function actualHttpMcpClient() {
  const client = new MCPClient();
  const url = "https://mcp.example.test/rpc";
  client.servers.set("files", {
    state: ServerState.CONNECTED,
    tools: [],
    resources: [],
    resourceTemplates: [],
    prompts: [],
    config: { url, longRunning: true },
    transportKind: "https",
    httpUrl: url,
    httpHeaders: {},
    httpSessionId: "session-1",
    protocolVersion: "2025-11-25",
    _httpRequestControllers: new Set(),
  });
  return client;
}

function toolOptions(
  cwd,
  mcpClient,
  mcpCallLedger,
  effectContract,
  hostToolPolicy = null,
) {
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
    ...(hostToolPolicy
      ? {
          hostManagedToolPolicy: {
            tools: { [TOOL_NAME]: hostToolPolicy },
          },
        }
      : {}),
  };
}

function hostEffectPolicy(effect, trusted) {
  return {
    authorizedEffect: effect,
    sourceTrusted: trusted,
    effectContract: {
      authorizedEffect: effect,
      trusted,
      provenance: "test:host-policy",
    },
  };
}

function guardedLedger(options = {}) {
  const rawLedger = createMcpCallLedger(options);
  const settle = vi.spyOn(rawLedger, "settle");
  const controller = createMcpRecoveryAdmissionController();
  const ledger = guardMcpLedgerForRecovery(rawLedger, controller);
  return { controller, ledger, rawLedger, settle };
}

function expectOutcomeUnknown(result, phase) {
  expect(result).toMatchObject({
    code: "CC_MCP_LEDGER_OUTCOME_UNKNOWN",
    status: "outcome_unknown",
    outcomeUnknown: true,
    retryable: false,
    mcpLedgerIncident: { phase },
  });
  expect(result.error).toContain("do not retry automatically");
}

describe("agent-core MCP call ledger", () => {
  let cwd;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-ledger-"));
  });

  afterEach(() => {
    Object.assign(mcpDeps, originalMcpDeps);
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

  it.each([
    {
      label: "write transport rejection",
      effectContract: { declaredEffect: "write" },
      hostToolPolicy: null,
      abort: false,
    },
    {
      label: "unknown transport rejection",
      effectContract: { declaredEffect: "unknown" },
      hostToolPolicy: null,
      abort: false,
    },
    {
      label: "untrusted read transport rejection",
      effectContract: { declaredEffect: "read" },
      hostToolPolicy: hostEffectPolicy("read", false),
      abort: false,
    },
    {
      label: "write rejection after abort",
      effectContract: { declaredEffect: "write" },
      hostToolPolicy: null,
      abort: true,
    },
  ])(
    "keeps $label outcome unknown and leaves the ledger started",
    async ({ label, effectContract, hostToolPolicy, abort }) => {
      const harness = guardedLedger({ randomUUID: () => label });
      const abortController = new AbortController();
      const callTool = vi.fn(async (_server, _tool, _input, callOptions) => {
        if (abort) {
          expect(callOptions?.signal).toBe(abortController.signal);
          abortController.abort();
        }
        const error = new Error(`private transport detail: ${label}`);
        if (abort) error.name = "AbortError";
        throw error;
      });
      const options = toolOptions(
        cwd,
        { callTool },
        harness.ledger,
        effectContract,
        hostToolPolicy,
      );
      if (abort) options.signal = abortController.signal;

      const result = await executeTool(TOOL_NAME, {}, options);

      expectOutcomeUnknown(result, "call");
      expect(result.mcpLedgerIncident.code).toBe(
        "CC_MCP_TRANSPORT_OUTCOME_UNKNOWN",
      );
      expect(JSON.stringify(result)).not.toContain("private transport detail");
      expect(harness.settle).not.toHaveBeenCalled();
      expect(harness.rawLedger.list()).toHaveLength(1);
      expect(harness.rawLedger.list()[0].status).toBe("started");
      expect(harness.controller.admission).toMatchObject({
        blockMode: "unsafe",
        reasonCode: "CC_MCP_TRANSPORT_OUTCOME_UNKNOWN",
      });
    },
  );

  it("blocks a second unsafe MCP call after an outcome-unknown latch", async () => {
    const harness = guardedLedger({ randomUUID: () => "retry-latch" });
    const callTool = vi
      .fn()
      .mockRejectedValueOnce(new Error("transport outcome unknown"))
      .mockResolvedValue({ content: [] });
    const options = toolOptions(cwd, { callTool }, harness.ledger, {
      declaredEffect: "write",
    });

    expectOutcomeUnknown(
      await executeTool(TOOL_NAME, { release: 1 }, options),
      "call",
    );
    const retry = await executeTool(TOOL_NAME, { release: 2 }, options);

    expect(retry).toMatchObject({
      policy: {
        decision: "blocked",
        via: "mcp-ledger-prewrite",
        code: "CC_MCP_TRANSPORT_OUTCOME_UNKNOWN",
        blockMode: "unsafe",
      },
    });
    expect(callTool).toHaveBeenCalledOnce();
  });

  it("settles a trusted read transport rejection exactly once as failed", async () => {
    const harness = guardedLedger({ randomUUID: () => "trusted-read" });
    const callTool = vi.fn(async () => {
      throw new Error("trusted read transport failed");
    });

    const result = await executeTool(
      TOOL_NAME,
      {},
      toolOptions(
        cwd,
        { callTool },
        harness.ledger,
        { declaredEffect: "read" },
        hostEffectPolicy("read", true),
      ),
    );

    expect(result.outcomeUnknown).toBeUndefined();
    expect(result.error).toContain("trusted read transport failed");
    expect(harness.settle).toHaveBeenCalledOnce();
    expect(harness.settle.mock.calls[0][1]).toMatchObject({ status: "failed" });
    expect(harness.rawLedger.list()[0]).toMatchObject({
      status: "failed",
      effectContract: { effect: "read", trusted: true },
    });
    expect(harness.controller.admission.blockMode).toBeNull();
  });

  it("does not project an HTTP status body's peer-controlled detail into a trusted-read result", async () => {
    const canary = "HTTP_BODY_SECRET_PROMPT_CANARY";
    const harness = guardedLedger({ randomUUID: () => "http-status" });
    const callTool = vi.fn(async () => {
      const error = new Error(`HTTP 503: ${canary}`);
      error.code = "CC_MCP_HTTP_STATUS";
      error.status = 503;
      throw error;
    });

    const result = await executeTool(
      TOOL_NAME,
      {},
      toolOptions(
        cwd,
        { callTool },
        harness.ledger,
        { declaredEffect: "read" },
        hostEffectPolicy("read", true),
      ),
    );

    expect(result).toMatchObject({
      error:
        "MCP tool execution failed: MCP HTTP request failed with status 503",
    });
    expect(JSON.stringify(result)).not.toContain(canary);
    expect(harness.settle).toHaveBeenCalledOnce();
    expect(JSON.stringify(harness.rawLedger.list())).not.toContain(canary);
    expect(harness.rawLedger.list()[0].status).toBe("failed");
  });

  it("settles branded RPC rejections as known failures without message-dependent digests", async () => {
    const canaries = [
      "RPC_MESSAGE_DATA_SECRET_CANARY_ONE",
      "RPC_MESSAGE_DATA_SECRET_CANARY_TWO",
    ];
    const harness = guardedLedger({ randomUUID: () => "rpc-error" });
    const client = actualHttpMcpClient();
    let responseIndex = 0;
    mcpDeps.fetch = vi.fn(async (_url, options) => {
      const request = JSON.parse(options.body);
      const canary = canaries[responseIndex++];
      return rpcErrorResponse(request.id, `not connected HTTP 503: ${canary}`, {
        secret: canary,
      });
    });
    const options = toolOptions(
      cwd,
      client,
      harness.ledger,
      { declaredEffect: "write" },
      hostEffectPolicy("write", true),
    );

    const first = await executeTool(TOOL_NAME, { revision: 1 }, options);
    const second = await executeTool(TOOL_NAME, { revision: 2 }, options);

    for (const result of [first, second]) {
      expect(result).toMatchObject({
        error:
          "MCP tool execution failed: MCP server returned a JSON-RPC error (code -32000)",
      });
      expect(result.outcomeUnknown).toBeUndefined();
    }
    expect(mcpDeps.fetch).toHaveBeenCalledTimes(2);
    expect(harness.settle).toHaveBeenCalledTimes(2);
    const records = harness.rawLedger.list();
    expect(records.map((record) => record.status)).toEqual([
      "failed",
      "failed",
    ]);
    expect(records[0].errorSummary.messageDigest).toBe(
      records[1].errorSummary.messageDigest,
    );
    const publicState = JSON.stringify({ first, second, records });
    for (const canary of canaries) expect(publicState).not.toContain(canary);
    expect(harness.controller.admission.blockMode).toBeNull();
  });

  it.each(["accessor", "proxy"])(
    "settles a trusted-read %s rejection without executing peer traps",
    async (kind) => {
      const canary = `RPC_TRAP_SECRET_${kind}`;
      const harness = guardedLedger({ randomUUID: () => `rpc-${kind}` });
      let trapReads = 0;
      let hostileError;
      if (kind === "proxy") {
        hostileError = new Proxy(
          {},
          {
            get() {
              trapReads += 1;
              throw new Error(canary);
            },
            getOwnPropertyDescriptor() {
              trapReads += 1;
              throw new Error(canary);
            },
          },
        );
      } else {
        hostileError = {
          mcpErrorCode: "CC_MCP_RPC_ERROR",
          rpcCode: -32000,
        };
        Object.defineProperty(hostileError, "message", {
          get() {
            trapReads += 1;
            return canary;
          },
        });
      }
      const callTool = vi.fn(async () => {
        throw hostileError;
      });

      const result = await executeTool(
        TOOL_NAME,
        {},
        toolOptions(
          cwd,
          { callTool },
          harness.ledger,
          { declaredEffect: "read" },
          hostEffectPolicy("read", true),
        ),
      );

      expect(trapReads).toBe(0);
      expect(harness.settle).toHaveBeenCalledOnce();
      expect(harness.rawLedger.list()[0].status).toBe("failed");
      expect(JSON.stringify(result)).not.toContain(canary);
      expect(JSON.stringify(harness.rawLedger.list())).not.toContain(canary);
    },
  );

  it.each([
    [
      "Proxy result",
      () =>
        new Proxy(
          {},
          {
            get() {
              throw new Error("private result detail");
            },
          },
        ),
    ],
    [
      "throwing isError getter",
      () => {
        const result = {};
        Object.defineProperty(result, "isError", {
          get() {
            throw new Error("private result detail");
          },
        });
        return result;
      },
    ],
    [
      "throwing custom then getter",
      () => {
        const result = {};
        Object.defineProperty(result, "then", {
          get() {
            throw new Error("private result detail");
          },
        });
        return result;
      },
    ],
    [
      "rejecting custom thenable",
      () => ({
        then(_resolve, reject) {
          reject(new Error("private result detail"));
        },
      }),
    ],
    [
      "rejecting foreign promise",
      () =>
        vm.runInNewContext(
          "Promise.reject(new Error('private result detail'))",
        ),
    ],
  ])(
    "leaves a %s outcome unknown without settlement",
    async (_label, makeResult) => {
      const harness = guardedLedger({ randomUUID: () => "invalid-result" });
      const callTool = vi.fn(() => makeResult());

      const result = await executeTool(
        TOOL_NAME,
        {},
        toolOptions(cwd, { callTool }, harness.ledger, {
          declaredEffect: "write",
        }),
      );

      expectOutcomeUnknown(result, "result");
      expect(result.mcpLedgerIncident.code).toBe(
        "CC_MCP_PROTOCOL_RESULT_INVALID",
      );
      expect(JSON.stringify(result)).not.toContain("private result detail");
      expect(harness.settle).not.toHaveBeenCalled();
      expect(harness.rawLedger.list()[0].status).toBe("started");
      expect(harness.controller.admission).toMatchObject({
        blockMode: "unsafe",
        reasonCode: "CC_MCP_PROTOCOL_RESULT_INVALID",
      });
    },
  );

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

  it("matches an exact replay deny against the raw tool behind a model alias", async () => {
    const harness = guardedLedger();
    const input = { path: "src/a.js", content: "same input" };
    const summary = summarizeMcpPayload(input);
    harness.controller.replaceVerifiedRecovery({
      incidents: [],
      unsettled: [],
      replayDenied: [
        {
          ledgerId: "mcp-confirmed-applied",
          serverName: "files",
          toolName: "update",
          inputBytes: summary.bytes,
          replayDigest: computeMcpExactReplayDigest({
            serverName: "files",
            toolName: "update",
            inputBytes: summary.bytes,
            inputDigest: summary.sha256,
          }),
        },
      ],
    });
    const callTool = vi.fn();

    const result = await executeTool(
      TOOL_NAME,
      input,
      toolOptions(cwd, { callTool }, harness.ledger, {
        declaredEffect: "write",
      }),
    );

    expect(result.policy).toMatchObject({
      decision: "blocked",
      via: "mcp-ledger-prewrite",
      code: MCP_EXACT_REPLAY_DENIED_CODE,
      ledgerId: "mcp-confirmed-applied",
    });
    expect(callTool).not.toHaveBeenCalled();
    expect(harness.rawLedger.list()).toEqual([]);
  });

  it("rejects ambiguous MCP arguments before ledger or transport", async () => {
    const begin = vi.fn();
    const callTool = vi.fn();
    const toJSON = vi.fn(() => ({ path: "src/a.js" }));
    const result = await executeTool(
      TOOL_NAME,
      { path: "src/a.js", toJSON },
      toolOptions(cwd, { callTool }, { begin }, { declaredEffect: "write" }),
    );

    expect(result).toMatchObject({
      policy: {
        decision: "blocked",
        via: "mcp-wire-input",
        code: "CC_MCP_WIRE_INPUT_INVALID",
      },
    });
    expect(toJSON).not.toHaveBeenCalled();
    expect(begin).not.toHaveBeenCalled();
    expect(callTool).not.toHaveBeenCalled();
  });

  it("passes the same immutable MCP snapshot to ledger and raw transport", async () => {
    let releaseBegin;
    const beginGate = new Promise((resolve) => {
      releaseBegin = resolve;
    });
    const settle = vi.fn(async () => ({}));
    const begin = vi.fn(async () => {
      await beginGate;
      return { ledgerId: "same-wire-snapshot", settle };
    });
    const callTool = vi.fn(async () => ({ content: [] }));
    const original = { path: "src/a.js", nested: { release: 7 } };

    const execution = executeTool(
      TOOL_NAME,
      original,
      toolOptions(cwd, { callTool }, { begin }, { declaredEffect: "write" }),
    );
    await vi.waitFor(() => expect(begin).toHaveBeenCalledOnce());
    original.nested.release = 8;
    releaseBegin();
    await execution;

    const ledgerInput = begin.mock.calls[0][0].input;
    const sentInput = callTool.mock.calls[0][2];
    expect(sentInput).toBe(ledgerInput);
    expect(sentInput).toEqual({
      nested: { release: 7 },
      path: "src/a.js",
    });
    expect(Object.isFrozen(sentInput)).toBe(true);
    expect(Object.isFrozen(sentInput.nested)).toBe(true);
    expect(settle).toHaveBeenCalledOnce();
  });

  it("returns outcome unknown when settlement throws without settling twice", async () => {
    const harness = guardedLedger({
      sink: async (_record, { phase }) => {
        if (phase === "settled") {
          throw new Error("private settlement detail");
        }
      },
    });
    const callTool = vi.fn(async () => ({ ok: true }));

    const result = await executeTool(
      TOOL_NAME,
      {},
      toolOptions(cwd, { callTool }, harness.ledger, {
        declaredEffect: "write",
        authorizedEffect: null,
        annotations: { readOnlyHint: false },
      }),
    );

    expect(callTool).toHaveBeenCalledOnce();
    expectOutcomeUnknown(result, "settled");
    expect(result.mcpLedgerIncident).toMatchObject({
      phase: "settled",
      code: "CC_MCP_LEDGER_SETTLE_FAILED",
    });
    expect(JSON.stringify(result)).not.toContain("private settlement detail");
    expect(harness.settle).toHaveBeenCalledOnce();
    expect(harness.controller.admission).toMatchObject({
      blockMode: "unsafe",
      reasonCode: "CC_MCP_LEDGER_SETTLE_FAILED",
    });
  });

  it("does not settle again when result projection throws after settlement", async () => {
    const harness = guardedLedger({ randomUUID: () => "projection" });
    let payloadReads = 0;
    const callResult = {};
    Object.defineProperty(callResult, "payload", {
      enumerable: true,
      get() {
        payloadReads += 1;
        if (payloadReads === 1) return "safe result";
        throw new Error("private projection detail");
      },
    });
    const callTool = vi.fn(() => callResult);

    const result = await executeTool(
      TOOL_NAME,
      {},
      toolOptions(cwd, { callTool }, harness.ledger, {
        declaredEffect: "write",
      }),
    );

    expect(result).toMatchObject({
      code: "CC_MCP_RESULT_PROJECTION_FAILED",
      retryable: false,
      mcpLedgerIncident: {
        phase: "result",
        code: "CC_MCP_RESULT_PROJECTION_FAILED",
      },
    });
    expect(result.outcomeUnknown).toBeUndefined();
    expect(result.error).toContain("completed");
    expect(result.error).toContain("do not retry automatically");
    expect(JSON.stringify(result)).not.toContain("private projection detail");
    expect(payloadReads).toBe(2);
    expect(harness.settle).toHaveBeenCalledOnce();
    expect(harness.rawLedger.list()[0].status).toBe("completed");
    expect(harness.controller.admission.blockMode).toBeNull();
  });
});
