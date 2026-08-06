import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testHome = join(
  tmpdir(),
  `cc-mcp-recovery-store-${process.pid}-${Date.now()}`,
);

vi.mock("../../src/lib/paths.js", () => ({
  getHomeDir: () => testHome,
}));

const sessionStore = await import("../../src/harness/jsonl-session-store.js");
const { createMcpCallLedger } =
  await import("../../src/lib/mcp-call-ledger.js");
const { MCP_CALL_RECOVERY_ADJUDICATION_EVENT, createSessionMcpLedgerSink } =
  await import("../../src/lib/mcp-call-ledger-store.js");
const { adjudicateMcpRecovery, readMcpRecoveryAuthority } =
  await import("../../src/lib/mcp-recovery-adjudication.js");

async function createStartedOnlyCall(sessionId) {
  sessionStore.startSession(sessionId, { title: "MCP recovery test" });
  const ledger = createMcpCallLedger({
    sink: createSessionMcpLedgerSink(sessionId),
  });
  return ledger.begin({
    sessionId,
    turnId: "turn-1",
    serverName: "repo",
    toolName: "publish",
    input: { release: 7 },
    effectContract: { effect: "write" },
  });
}

describe("MCP recovery adjudication with the real JSONL authority store", () => {
  beforeEach(() => {
    mkdirSync(join(testHome, "sessions"), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testHome)) {
      rmSync(testHome, { recursive: true, force: true });
    }
  });

  it("accepts raw authority heads and leaves a fully verified adjudication", async () => {
    const sessionId = "mcp-real-store";
    const ticket = await createStartedOnlyCall(sessionId);
    const before = readMcpRecoveryAuthority(sessionId);

    expect(before.headHash).toMatch(/^[0-9a-f]{64}$/);
    expect(before.headHash).not.toContain("sha256:");
    const result = await adjudicateMcpRecovery(
      {
        sessionId,
        ledgerId: ticket.ledgerId,
        decision: "confirmed_applied",
        expectedHeadHash: before.headHash,
        expectedRecoveryDigest: before.recoveryDigest,
        reason: "confirmed in the release registry",
        requestId: "real-store-request-1",
      },
      { randomUUID: () => "unused" },
    );

    expect(result.headHash).toMatch(/^[0-9a-f]{64}$/);
    const events = sessionStore.readVerifiedEvents(sessionId);
    const persisted = events.at(-1);
    expect(persisted.type).toBe(MCP_CALL_RECOVERY_ADJUDICATION_EVENT);
    expect(persisted.prevHash).toBe(before.headHash);
    expect(Object.keys(persisted.data).sort()).toEqual(
      [
        "schemaVersion",
        "requestId",
        "sessionId",
        "ledgerId",
        "decision",
        "expectedHeadHash",
        "expectedRecoveryDigest",
        "authority",
        "confirmation",
        "reasonDigest",
      ].sort(),
    );
    expect(JSON.stringify(persisted.data)).not.toContain("release registry");

    const after = readMcpRecoveryAuthority(sessionId);
    expect(after.verified).toBe(true);
    expect(after.incidents).toEqual([]);
    expect(after.unsettled).toEqual([]);
    expect(after.records[0]).toMatchObject({
      ledgerId: ticket.ledgerId,
      status: "started",
      settledAt: null,
    });
    expect(after.replayDenied).toEqual([
      expect.objectContaining({
        ledgerId: ticket.ledgerId,
        inputBytes: expect.any(Number),
        replayDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      }),
    ]);
    expect(after.recoveryDigest).not.toBe(before.recoveryDigest);
  });

  it("performs one real CAS attempt and never retries a stale head", async () => {
    const sessionId = "mcp-real-store-stale";
    const ticket = await createStartedOnlyCall(sessionId);
    const before = readMcpRecoveryAuthority(sessionId);
    let attempts = 0;
    const racingAppend = (...args) => {
      attempts += 1;
      sessionStore.appendAuthorityEvent(sessionId, "concurrent_authority", {
        schemaVersion: 1,
      });
      return sessionStore.appendAuthorityEventIfHead(...args);
    };

    await expect(
      adjudicateMcpRecovery(
        {
          sessionId,
          ledgerId: ticket.ledgerId,
          decision: "confirmed_not_applied",
          expectedHeadHash: before.headHash,
          expectedRecoveryDigest: before.recoveryDigest,
          reason: "confirmed absent",
          requestId: "real-store-request-stale",
        },
        { appendAuthorityEventIfHead: racingAppend },
      ),
    ).rejects.toMatchObject({
      code: "CC_MCP_RECOVERY_ADJUDICATION_STALE",
    });
    expect(attempts).toBe(1);
    expect(
      sessionStore
        .readVerifiedEvents(sessionId)
        .filter((event) => event.type === MCP_CALL_RECOVERY_ADJUDICATION_EVENT),
    ).toEqual([]);
  });

  it("fences an old host after adjudication before its next ledger write", async () => {
    const sessionId = "mcp-real-store-host-fence";
    sessionStore.startSession(sessionId, { title: "MCP host fence test" });
    const initial = readMcpRecoveryAuthority(sessionId);
    const oldLedger = createMcpCallLedger({
      sink: createSessionMcpLedgerSink(sessionId, { recovery: initial }),
      randomUUID: () => "old-host",
    });
    const oldTicket = await oldLedger.begin({
      sessionId,
      turnId: "turn-old",
      serverName: "repo",
      toolName: "publish",
      input: { release: 8 },
      effectContract: { effect: "write" },
    });
    const beforeAdjudication = readMcpRecoveryAuthority(sessionId);

    await adjudicateMcpRecovery({
      sessionId,
      ledgerId: oldTicket.ledgerId,
      decision: "confirmed_not_applied",
      expectedHeadHash: beforeAdjudication.headHash,
      expectedRecoveryDigest: beforeAdjudication.recoveryDigest,
      reason: "confirmed absent from the release registry",
      requestId: "real-store-host-fence-adjudication",
    });

    await expect(
      oldTicket.settle({ output: { published: true } }),
    ).rejects.toSatisfy(
      (error) =>
        error?.code === "CC_MCP_LEDGER_SETTLE_FAILED" &&
        error?.cause?.code === "CC_MCP_LEDGER_HOST_FENCE_STALE",
    );
    await expect(
      oldLedger.begin({
        sessionId,
        turnId: "turn-old-next",
        serverName: "repo",
        toolName: "publish",
        input: { release: 9 },
        effectContract: { effect: "write" },
      }),
    ).rejects.toSatisfy(
      (error) =>
        error?.code === "CC_MCP_LEDGER_PREWRITE_FAILED" &&
        error?.cause?.code === "CC_MCP_LEDGER_HOST_FENCE_STALE",
    );

    const resumed = readMcpRecoveryAuthority(sessionId);
    const resumedLedger = createMcpCallLedger({
      sink: createSessionMcpLedgerSink(sessionId, { recovery: resumed }),
      randomUUID: () => "resumed-host",
    });
    const resumedTicket = await resumedLedger.begin({
      sessionId,
      turnId: "turn-resumed",
      serverName: "repo",
      toolName: "publish",
      input: { release: 9 },
      effectContract: { effect: "write" },
    });
    await expect(
      resumedTicket.settle({ output: { published: true } }),
    ).resolves.toMatchObject({ status: "completed" });

    const ledgerEvents = sessionStore
      .readVerifiedEvents(sessionId)
      .filter((event) => event.type === "mcp_call_ledger");
    expect(
      ledgerEvents.filter(
        (event) => event.data.record.ledgerId === oldTicket.ledgerId,
      ),
    ).toHaveLength(1);
    expect(
      ledgerEvents.filter(
        (event) => event.data.record.ledgerId === resumedTicket.ledgerId,
      ),
    ).toHaveLength(2);
  });
});
