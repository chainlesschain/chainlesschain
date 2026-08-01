import { describe, expect, it, vi } from "vitest";
import {
  createMcpCallLedger,
  LedgerFailureAction,
  McpCallLedger,
  McpEffect,
  sha256PayloadDigest,
} from "../../src/lib/mcp-call-ledger.js";

function clock(...values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

describe("McpCallLedger", () => {
  it("prewrites and settles a privacy-safe host-owned call record", async () => {
    const persisted = [];
    const sink = vi.fn(async (record, meta) => {
      persisted.push({ record, meta });
    });
    const ledger = createMcpCallLedger({
      sink,
      randomUUID: () => "uuid-1",
      now: clock("2026-08-01T01:00:00.000Z", "2026-08-01T01:00:01.000Z"),
    });

    const call = await ledger.begin({
      sessionId: "session-1",
      turnId: 7,
      toolName: "mcp__files__write",
      serverName: "files",
      input: {
        path: "C:/repo/private.txt",
        token: "input-secret-token",
        nested: { password: "input-secret-password" },
      },
      effectContract: {
        effect: "write",
        idempotent: false,
        openWorld: false,
        trusted: true,
        source: "managed:files",
      },
      resourceScopes: ["file:C:/repo/private.txt"],
      networkScopes: [
        "https://user:network-secret@example.com/v1/write?token=query-secret",
      ],
    });

    expect(call).toMatchObject({
      ledgerId: "mcp-uuid-1-1",
      prewritePersisted: true,
      prewritePolicy: LedgerFailureAction.FAIL_CLOSED,
    });
    expect(persisted[0]).toMatchObject({
      meta: { phase: "started" },
      record: {
        ledgerId: "mcp-uuid-1-1",
        sessionId: "session-1",
        turnId: "7",
        toolName: "mcp__files__write",
        serverName: "files",
        status: "started",
        startedAt: "2026-08-01T01:00:00.000Z",
        settledAt: null,
        effectContract: {
          effect: "write",
          sideEffecting: true,
          trusted: true,
        },
        resourceScopes: ["file:C:/repo/private.txt"],
        networkScopes: ["https://example.com"],
      },
    });
    expect(persisted[0].record.inputDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(persisted[0].record).not.toHaveProperty("input");

    const settled = await call.settle({
      status: "completed",
      output: { ok: true, secret: "output-secret-token" },
    });
    expect(settled).toMatchObject({
      ledgerId: call.ledgerId,
      status: "completed",
      settledAt: "2026-08-01T01:00:01.000Z",
      settlementPersistence: "persisted",
      outputSummary: { kind: "object" },
    });
    expect(settled.outputDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(persisted[1].meta.phase).toBe("settled");

    const atRest = JSON.stringify(persisted);
    expect(atRest).not.toContain("input-secret-token");
    expect(atRest).not.toContain("input-secret-password");
    expect(atRest).not.toContain("network-secret");
    expect(atRest).not.toContain("query-secret");
    expect(atRest).not.toContain("output-secret-token");
  });

  it("issues a unique ledger id for every call even with a repeated UUID seam", async () => {
    const ledger = new McpCallLedger({ randomUUID: () => "same" });
    const first = await ledger.beginCall({
      tool: "read_a",
      server: "one",
      input: {},
      effect: "read",
    });
    const second = await ledger.begin({
      tool: "read_b",
      server: "one",
      input: {},
      effect: { effect: "read" },
    });

    expect(first.ledgerId).toBe("mcp-same-1");
    expect(second.ledgerId).toBe("mcp-same-2");
    expect(second.ledgerId).not.toBe(first.ledgerId);
    await expect(
      ledger.settleCall(first, { status: "completed" }),
    ).resolves.toMatchObject({ status: "completed" });
  });

  it.each([McpEffect.WRITE, McpEffect.DESTRUCTIVE])(
    "fails closed when a %s call cannot be prewritten",
    async (effect) => {
      const ledger = new McpCallLedger({
        sink: async () => {
          throw new Error("ledger disk unavailable");
        },
        randomUUID: () => effect,
        now: clock("2026-08-01T02:00:00.000Z", "2026-08-01T02:00:01.000Z"),
      });

      await expect(
        ledger.begin({
          toolName: "mutate",
          serverName: "danger",
          input: { bearer: "must-not-persist" },
          effectContract: { effect },
        }),
      ).rejects.toMatchObject({
        code: "CC_MCP_LEDGER_PREWRITE_FAILED",
        effect,
        phase: "started",
      });
      expect(ledger.list()[0]).toMatchObject({
        status: "failed",
        prewritePersistence: "failed-closed",
        settledAt: "2026-08-01T02:00:01.000Z",
      });
      expect(JSON.stringify(ledger.list())).not.toContain("must-not-persist");
    },
  );

  it("makes the read prewrite failure policy explicitly fail-open", async () => {
    let attempts = 0;
    const sink = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary outage");
    });
    const ledger = new McpCallLedger({ sink, randomUUID: () => "read" });

    const call = await ledger.begin({
      toolName: "lookup",
      serverName: "catalog",
      input: { query: "private-query" },
      effectContract: { effect: "read", trusted: true },
    });

    expect(call).toMatchObject({
      prewritePersisted: false,
      prewritePolicy: LedgerFailureAction.FAIL_OPEN,
      record: { prewritePersistence: "failed-open", status: "started" },
    });
    await expect(
      call.settle({ output: { found: true } }),
    ).resolves.toMatchObject({
      status: "completed",
      prewritePersistence: "failed-open",
      settlementPersistence: "skipped-no-prewrite",
    });
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it("fails closed for unknown effects by default and exposes an explicit override", async () => {
    const failingSink = async () => {
      throw new Error("unavailable");
    };
    const closed = new McpCallLedger({ sink: failingSink });
    await expect(
      closed.begin({
        toolName: "mystery",
        serverName: "unknown",
        input: {},
        effectContract: {},
      }),
    ).rejects.toMatchObject({
      code: "CC_MCP_LEDGER_PREWRITE_FAILED",
      effect: McpEffect.UNKNOWN,
    });

    let attempts = 0;
    const open = new McpCallLedger({
      sink: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("unavailable once");
      },
      prewriteFailurePolicy: {
        [McpEffect.UNKNOWN]: LedgerFailureAction.FAIL_OPEN,
      },
    });
    const call = await open.begin({
      toolName: "mystery",
      serverName: "unknown",
      input: {},
      effectContract: {},
    });
    expect(call).toMatchObject({
      prewritePolicy: LedgerFailureAction.FAIL_OPEN,
      record: { prewritePersistence: "failed-open" },
    });
    await call.settle({ status: "completed" });
  });

  it("does not allow policy options to weaken write or destructive prewrites", () => {
    const ledger = new McpCallLedger({
      prewriteFailurePolicy: {
        write: LedgerFailureAction.FAIL_OPEN,
        destructive: LedgerFailureAction.FAIL_OPEN,
      },
    });
    expect(ledger.prewriteFailurePolicy).toMatchObject({
      write: LedgerFailureAction.FAIL_CLOSED,
      destructive: LedgerFailureAction.FAIL_CLOSED,
    });
  });

  it("records failed and cancelled calls without persisting raw error text", async () => {
    const ledger = new McpCallLedger({ randomUUID: () => "terminal" });
    const failed = await ledger.begin({
      toolName: "one",
      serverName: "server",
      input: {},
      effectContract: { effect: "read" },
    });
    const failedRecord = await failed.settle({
      error: Object.assign(new Error("secret failure detail"), {
        code: "REMOTE_FAILURE",
      }),
    });
    expect(failedRecord).toMatchObject({
      status: "failed",
      errorSummary: {
        name: "Error",
        code: "REMOTE_FAILURE",
      },
    });
    expect(failedRecord.errorSummary.messageDigest).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );

    const cancelled = await ledger.begin({
      toolName: "two",
      serverName: "server",
      input: {},
      effectContract: { effect: "read" },
    });
    const cancelledRecord = await cancelled.settle({
      error: Object.assign(new Error("secret cancellation reason"), {
        name: "AbortError",
      }),
    });
    expect(cancelledRecord.status).toBe("cancelled");
    const serialized = JSON.stringify(ledger.list());
    expect(serialized).not.toContain("secret failure detail");
    expect(serialized).not.toContain("secret cancellation reason");
  });

  it("settles idempotently for the same terminal status and rejects rewrites", async () => {
    const sink = vi.fn(async () => {});
    const ledger = new McpCallLedger({ sink });
    const call = await ledger.begin({
      toolName: "read",
      serverName: "server",
      input: {},
      effectContract: { effect: "read" },
    });
    const first = await call.settle({
      status: "completed",
      output: { ok: true },
    });
    const second = await call.settle({ status: "completed" });

    expect(second).toEqual(first);
    expect(sink).toHaveBeenCalledTimes(2);
    await expect(call.settle({ status: "failed" })).rejects.toMatchObject({
      code: "CC_MCP_LEDGER_ALREADY_SETTLED",
    });
  });

  it("uses stable object-key ordering for payload digests", () => {
    expect(sha256PayloadDigest({ a: 1, b: 2 })).toBe(
      sha256PayloadDigest({ b: 2, a: 1 }),
    );
  });
});
