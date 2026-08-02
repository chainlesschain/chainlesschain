import { describe, expect, it, vi } from "vitest";
import {
  McpCallStatus,
  computeMcpExactReplayDigest,
} from "../../src/lib/mcp-call-ledger.js";
import {
  MCP_CALL_LEDGER_EVENT,
  MCP_CALL_RECOVERY_ADJUDICATION_EVENT,
  McpCallRecoveryDecision,
  computeMcpRecoveryDigest,
  reduceMcpLedgerEvents,
} from "../../src/lib/mcp-call-ledger-store.js";
import {
  adjudicateMcpRecovery,
  publicMcpRecoveryAuthority,
  readMcpRecoveryAuthority,
} from "../../src/lib/mcp-recovery-adjudication.js";

const HEAD_0 = "0".repeat(64);
const HEAD_1 = "1".repeat(64);
const HEAD_2 = "2".repeat(64);
const HEAD_3 = "3".repeat(64);
const HEAD_4 = "4".repeat(64);

function startedRecord(overrides = {}) {
  return {
    schemaVersion: 1,
    ledgerId: "mcp-ledger-1",
    sessionId: "session-1",
    turnId: "turn-1",
    // Historical agent-core records used the model-facing alias. Recovery
    // canonicalizes only this exact server-bound prefix to the raw MCP name.
    toolName: "mcp__repo__publish",
    serverName: "repo",
    inputDigest: `sha256:${"a".repeat(64)}`,
    inputBytes: 17,
    effectContract: { effect: "write" },
    resourceScopes: [],
    networkScopes: [],
    prewritePolicy: "fail-closed",
    prewritePersistence: "pending",
    status: McpCallStatus.STARTED,
    startedAt: "2026-08-02T00:00:00.000Z",
    settledAt: null,
    outputSummary: null,
    outputDigest: null,
    errorSummary: null,
    ...overrides,
  };
}

function startedEvent(overrides = {}, eventOverrides = {}) {
  return {
    type: MCP_CALL_LEDGER_EVENT,
    timestamp: 1,
    prevHash: null,
    hash: HEAD_1,
    data: {
      schemaVersion: 1,
      phase: "started",
      record: startedRecord(overrides),
    },
    ...eventOverrides,
  };
}

function expectedReplayDigest() {
  return computeMcpExactReplayDigest({
    ...startedRecord(),
    toolName: "publish",
  });
}

function adjudicationEvent(started, decision, overrides = {}) {
  const before = reduceMcpLedgerEvents([started], {
    sessionId: "session-1",
    verified: true,
  });
  return {
    type: MCP_CALL_RECOVERY_ADJUDICATION_EVENT,
    timestamp: 2,
    prevHash: HEAD_1,
    hash: HEAD_2,
    data: {
      schemaVersion: 1,
      requestId: "mcp-recovery-request-1",
      sessionId: "session-1",
      ledgerId: "mcp-ledger-1",
      decision,
      expectedHeadHash: HEAD_1,
      expectedRecoveryDigest: before.recoveryDigest,
      authority: "local-cli-tty",
      confirmation: "typed-digest-host-stopped",
      reasonDigest: `sha256:${"b".repeat(64)}`,
      ...overrides,
    },
  };
}

describe("MCP recovery adjudication authority", () => {
  it("derives a complete exact-replay deny without fabricating settlement", () => {
    const started = startedEvent();
    const adjudication = adjudicationEvent(
      started,
      McpCallRecoveryDecision.CONFIRMED_APPLIED,
    );
    const recovery = reduceMcpLedgerEvents([started, adjudication], {
      sessionId: "session-1",
      verified: true,
    });

    expect(recovery.incidents).toEqual([]);
    expect(recovery.unsettled).toEqual([]);
    expect(recovery.records).toHaveLength(1);
    expect(recovery.records[0].status).toBe(McpCallStatus.STARTED);
    expect(recovery.records[0].settledAt).toBeNull();
    expect(recovery.replayDenied).toEqual([
      {
        ledgerId: "mcp-ledger-1",
        serverName: "repo",
        toolName: "mcp__repo__publish",
        inputBytes: 17,
        replayDigest: computeMcpExactReplayDigest(startedRecord()),
      },
      {
        ledgerId: "mcp-ledger-1",
        serverName: "repo",
        toolName: "publish",
        inputBytes: 17,
        replayDigest: expectedReplayDigest(),
      },
    ]);
    expect(recovery.remediation).toBe("exact_replay_denied");
  });

  it("resolves confirmed-not-applied without creating a replay deny", () => {
    const started = startedEvent();
    const recovery = reduceMcpLedgerEvents(
      [
        started,
        adjudicationEvent(
          started,
          McpCallRecoveryDecision.CONFIRMED_NOT_APPLIED,
        ),
      ],
      { sessionId: "session-1", verified: true },
    );

    expect(recovery.incidents).toEqual([]);
    expect(recovery.unsettled).toEqual([]);
    expect(recovery.replayDenied).toEqual([]);
    expect(recovery.records[0].status).toBe(McpCallStatus.STARTED);
  });

  it.each([
    ["mcp__repo__publish", "publish"],
    ["publish", "mcp__repo__publish"],
  ])(
    "detects a post-adjudication replay across %s and %s tool identities",
    (adjudicatedToolName, replayedToolName) => {
      const started = startedEvent({ toolName: adjudicatedToolName });
      const adjudication = adjudicationEvent(
        started,
        McpCallRecoveryDecision.CONFIRMED_APPLIED,
      );
      const replay = startedEvent(
        { ledgerId: "mcp-ledger-replay", toolName: replayedToolName },
        { timestamp: 3, prevHash: HEAD_2, hash: HEAD_3 },
      );
      const recovery = reduceMcpLedgerEvents([started, adjudication, replay], {
        sessionId: "session-1",
        verified: true,
      });

      expect(recovery.incidents).toEqual([
        {
          code: "CC_MCP_LEDGER_EXACT_REPLAY_RECORDED",
          ledgerId: "mcp-ledger-replay",
        },
      ]);
    },
  );

  it("turns a post-attestation settlement from an allegedly stopped host into an incident", () => {
    const started = startedEvent();
    const adjudication = adjudicationEvent(
      started,
      McpCallRecoveryDecision.CONFIRMED_NOT_APPLIED,
    );
    const settled = {
      type: MCP_CALL_LEDGER_EVENT,
      timestamp: 3,
      prevHash: HEAD_2,
      hash: HEAD_3,
      data: {
        schemaVersion: 1,
        phase: "settled",
        record: startedRecord({
          prewritePersistence: "persisted",
          status: McpCallStatus.COMPLETED,
          settledAt: "2026-08-02T00:01:00.000Z",
          settlementPersistence: "pending",
        }),
      },
    };
    const recovery = reduceMcpLedgerEvents([started, adjudication, settled], {
      sessionId: "session-1",
      verified: true,
    });

    expect(recovery.incidents).toEqual([
      {
        code: "CC_MCP_LEDGER_ADJUDICATED_REWRITTEN",
        ledgerId: "mcp-ledger-1",
      },
    ]);
    expect(recovery.remediation).toBe("inspect_transcript");
  });

  it("preserves the first deny origin when two ledger IDs share one exact identity", () => {
    const first = startedEvent({ ledgerId: "mcp-ledger-first" });
    const second = startedEvent(
      { ledgerId: "mcp-ledger-second" },
      { timestamp: 2, prevHash: HEAD_1, hash: HEAD_2 },
    );
    const prefix = [first, second];
    const beforeFirst = reduceMcpLedgerEvents(prefix, {
      sessionId: "session-1",
      verified: true,
    });
    const firstDecision = {
      type: MCP_CALL_RECOVERY_ADJUDICATION_EVENT,
      timestamp: 3,
      prevHash: HEAD_2,
      hash: HEAD_3,
      data: {
        schemaVersion: 1,
        requestId: "request-first",
        sessionId: "session-1",
        ledgerId: "mcp-ledger-first",
        decision: "confirmed_applied",
        expectedHeadHash: HEAD_2,
        expectedRecoveryDigest: beforeFirst.recoveryDigest,
        authority: "local-cli-tty",
        confirmation: "typed-digest-host-stopped",
        reasonDigest: `sha256:${"b".repeat(64)}`,
      },
    };
    const beforeSecond = reduceMcpLedgerEvents([...prefix, firstDecision], {
      sessionId: "session-1",
      verified: true,
    });
    const secondDecision = {
      ...firstDecision,
      timestamp: 4,
      prevHash: HEAD_3,
      hash: HEAD_4,
      data: {
        ...firstDecision.data,
        requestId: "request-second",
        ledgerId: "mcp-ledger-second",
        expectedHeadHash: HEAD_3,
        expectedRecoveryDigest: beforeSecond.recoveryDigest,
      },
    };
    const recovery = reduceMcpLedgerEvents(
      [...prefix, firstDecision, secondDecision],
      { sessionId: "session-1", verified: true },
    );

    expect(recovery.incidents).toEqual([]);
    expect(recovery.adjudications).toHaveLength(2);
    expect(recovery.replayDenied).toHaveLength(2);
    expect(
      recovery.replayDenied.every(
        (entry) => entry.ledgerId === "mcp-ledger-first",
      ),
    ).toBe(true);
  });

  it("rejects extra event keys, digest drift, unverified input, and incidents", () => {
    const started = startedEvent();
    const extraKey = adjudicationEvent(
      started,
      McpCallRecoveryDecision.CONFIRMED_APPLIED,
      { settled: true },
    );
    expect(
      reduceMcpLedgerEvents([started, extraKey], {
        sessionId: "session-1",
        verified: true,
      }).incidents,
    ).toEqual([
      expect.objectContaining({
        code: "CC_MCP_RECOVERY_ADJUDICATION_CORRUPT",
      }),
    ]);

    const digestDrift = adjudicationEvent(
      started,
      McpCallRecoveryDecision.CONFIRMED_APPLIED,
      { expectedRecoveryDigest: `sha256:${"c".repeat(64)}` },
    );
    expect(
      reduceMcpLedgerEvents([started, digestDrift], {
        sessionId: "session-1",
        verified: true,
      }).incidents,
    ).toEqual([
      expect.objectContaining({
        code: "CC_MCP_RECOVERY_ADJUDICATION_DIGEST_MISMATCH",
      }),
    ]);

    expect(
      reduceMcpLedgerEvents(
        [
          started,
          adjudicationEvent(started, McpCallRecoveryDecision.CONFIRMED_APPLIED),
        ],
        { sessionId: "session-1" },
      ).incidents,
    ).toEqual([
      expect.objectContaining({
        code: "CC_MCP_RECOVERY_ADJUDICATION_UNVERIFIED",
      }),
    ]);

    const corrupt = {
      type: MCP_CALL_LEDGER_EVENT,
      prevHash: null,
      hash: HEAD_0,
      data: { bad: true },
    };
    const linkedStarted = startedEvent({}, { prevHash: HEAD_0 });
    const beforeIncident = reduceMcpLedgerEvents([corrupt, linkedStarted], {
      sessionId: "session-1",
      verified: true,
    });
    const incidentBound = adjudicationEvent(
      linkedStarted,
      McpCallRecoveryDecision.CONFIRMED_APPLIED,
      {
        expectedRecoveryDigest: beforeIncident.recoveryDigest,
        expectedHeadHash: HEAD_1,
      },
    );
    expect(
      reduceMcpLedgerEvents([corrupt, linkedStarted, incidentBound], {
        sessionId: "session-1",
        verified: true,
      }).incidents.map((incident) => incident.code),
    ).toEqual([
      "CC_MCP_LEDGER_EVENT_CORRUPT",
      "CC_MCP_RECOVERY_ADJUDICATION_INCIDENTS_PRESENT",
    ]);
  });

  it("computes a deterministic digest independent of projection ordering", () => {
    const first = startedRecord({ ledgerId: "mcp-a", toolName: "工具乙" });
    const second = startedRecord({ ledgerId: "mcp-b", toolName: "工具甲" });
    const left = computeMcpRecoveryDigest({
      unsettled: [first, second],
      incidents: [],
      replayDenied: [],
    });
    const right = computeMcpRecoveryDigest({
      replayDenied: [],
      incidents: [],
      unsettled: [second, first],
    });
    expect(left).toBe(right);
  });

  it("binds recovery digests to session, head, adjudications, and replay denies", () => {
    const base = {
      sessionId: "session-1",
      headHash: HEAD_1,
      unsettled: [startedRecord()],
      incidents: [],
      adjudications: [],
      replayDenied: [],
    };
    const baseline = computeMcpRecoveryDigest(base);
    const variants = [
      { ...base, sessionId: "session-2" },
      { ...base, headHash: HEAD_2 },
      {
        ...base,
        adjudications: [
          { requestId: "request-prior", decision: "confirmed_not_applied" },
        ],
      },
      {
        ...base,
        replayDenied: [
          {
            ledgerId: "mcp-prior",
            serverName: "repo",
            toolName: "publish",
            inputBytes: 17,
            replayDigest: expectedReplayDigest(),
          },
        ],
      },
    ];

    for (const variant of variants) {
      expect(computeMcpRecoveryDigest(variant)).not.toBe(baseline);
    }
  });

  it("projects only frozen content-free MCP recovery authority", () => {
    const recovery = reduceMcpLedgerEvents([startedEvent()], {
      sessionId: "session-1",
      verified: true,
    });
    const projected = publicMcpRecoveryAuthority("session-1", recovery);

    expect(projected).toMatchObject({
      verified: true,
      blockMode: "unsafe",
      unsettled: [
        {
          ledgerId: "mcp-ledger-1",
          serverName: "repo",
          toolName: "mcp__repo__publish",
          status: "outcome_unknown",
        },
      ],
    });
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.unsettled)).toBe(true);
    expect(Object.isFrozen(projected.unsettled[0])).toBe(true);
    expect(JSON.stringify(projected)).not.toContain("inputDigest");
    expect(JSON.stringify(projected)).not.toContain("effectContract");
  });

  it("never launders asynchronous or object-valued authority into a clean projection", () => {
    const recovery = reduceMcpLedgerEvents([startedEvent()], {
      sessionId: "session-1",
      verified: true,
    });
    const toJSON = vi.fn(() => "PRIVATE_RECOVERY_CONTENT");
    const poisoned = {
      ...recovery,
      unsettled: [
        {
          ...recovery.unsettled[0],
          toolName: { toJSON },
        },
      ],
    };

    for (const candidate of [
      Promise.resolve(recovery),
      { ...recovery, then: vi.fn() },
      poisoned,
      new Proxy(recovery, {
        get() {
          throw new Error("must-not-read-proxy");
        },
      }),
    ]) {
      expect(() =>
        publicMcpRecoveryAuthority("session-1", candidate),
      ).toThrowError(
        expect.objectContaining({
          code: "CC_MCP_RECOVERY_ADJUDICATION_UNVERIFIED",
        }),
      );
    }
    expect(toJSON).not.toHaveBeenCalled();
  });

  it("rejects Proxy or accessor verified-event containers without invoking them", () => {
    let eventReads = 0;
    const accessorEvent = { ...startedEvent() };
    Object.defineProperty(accessorEvent, "type", {
      enumerable: true,
      get() {
        eventReads += 1;
        return MCP_CALL_LEDGER_EVENT;
      },
    });
    const proxyEvents = new Proxy([startedEvent()], {
      get() {
        eventReads += 1;
        throw new Error("must-not-read-proxy-array");
      },
    });

    for (const events of [[accessorEvent], proxyEvents]) {
      expect(() =>
        readMcpRecoveryAuthority("session-1", {
          readVerifiedEvents: () => events,
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "CC_MCP_RECOVERY_ADJUDICATION_UNVERIFIED",
        }),
      );
    }
    expect(eventReads).toBe(0);
  });

  it("appends one exact-key authority event under the verified head CAS", async () => {
    const started = startedEvent();
    const recovery = readMcpRecoveryAuthority("session-1", {
      readVerifiedEvents: () => [started],
    });
    const appendAuthorityEventIfHead = vi.fn(() => ({ hash: HEAD_2 }));

    const result = await adjudicateMcpRecovery(
      {
        sessionId: "session-1",
        ledgerId: "mcp-ledger-1",
        decision: McpCallRecoveryDecision.CONFIRMED_APPLIED,
        expectedHeadHash: recovery.headHash,
        expectedRecoveryDigest: recovery.recoveryDigest,
        reason: "verified in the external system: already applied",
      },
      {
        readVerifiedEvents: () => [started],
        appendAuthorityEventIfHead,
        randomUUID: () => "request-uuid",
      },
    );

    expect(appendAuthorityEventIfHead).toHaveBeenCalledOnce();
    expect(appendAuthorityEventIfHead).toHaveBeenCalledWith(
      "session-1",
      MCP_CALL_RECOVERY_ADJUDICATION_EVENT,
      expect.any(Object),
      HEAD_1,
    );
    const persisted = appendAuthorityEventIfHead.mock.calls[0][2];
    expect(Object.keys(persisted).sort()).toEqual(
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
    expect(JSON.stringify(persisted)).not.toContain("external system");
    expect(persisted).not.toHaveProperty("status");
    expect(persisted).not.toHaveProperty("settledAt");
    expect(result).toMatchObject({
      decision: McpCallRecoveryDecision.CONFIRMED_APPLIED,
      replayDenied: true,
      previousHeadHash: HEAD_1,
      headHash: HEAD_2,
      runtimeReloadRequired: true,
      remediation: "restart_or_resume_before_mcp_calls",
      replayDigests: [
        computeMcpExactReplayDigest(startedRecord()),
        expectedReplayDigest(),
      ],
    });
  });

  it("does not retry a stale CAS and never mutates unverified recovery", async () => {
    const started = startedEvent();
    const recovery = readMcpRecoveryAuthority("session-1", {
      readVerifiedEvents: () => [started],
    });
    const stale = Object.assign(new Error("stale"), {
      code: "SESSION_REVISION_STALE",
    });
    const appendAuthorityEventIfHead = vi.fn(() => {
      throw stale;
    });
    await expect(
      adjudicateMcpRecovery(
        {
          sessionId: "session-1",
          ledgerId: "mcp-ledger-1",
          decision: McpCallRecoveryDecision.CONFIRMED_NOT_APPLIED,
          expectedHeadHash: recovery.headHash,
          expectedRecoveryDigest: recovery.recoveryDigest,
          reason: "verified not applied",
        },
        {
          readVerifiedEvents: () => [started],
          appendAuthorityEventIfHead,
          randomUUID: () => "request-uuid",
        },
      ),
    ).rejects.toMatchObject({
      code: "CC_MCP_RECOVERY_ADJUDICATION_STALE",
    });
    expect(appendAuthorityEventIfHead).toHaveBeenCalledOnce();

    const neverAppend = vi.fn();
    await expect(
      adjudicateMcpRecovery(
        {
          sessionId: "session-1",
          ledgerId: "mcp-ledger-1",
          decision: McpCallRecoveryDecision.CONFIRMED_NOT_APPLIED,
          expectedHeadHash: HEAD_1,
          expectedRecoveryDigest: recovery.recoveryDigest,
          reason: "unverified transcript",
        },
        {
          readVerifiedEvents: () => {
            throw new Error("chain broken");
          },
          appendAuthorityEventIfHead: neverAppend,
          randomUUID: () => "request-uuid",
        },
      ),
    ).rejects.toMatchObject({
      code: "CC_MCP_RECOVERY_ADJUDICATION_UNVERIFIED",
    });
    expect(neverAppend).not.toHaveBeenCalled();
  });
});
