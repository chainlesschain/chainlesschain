import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import {
  MCP_CALL_LEDGER_EVENT,
  McpCallRecoveryDecision,
  reduceMcpLedgerEvents,
} from "../../src/lib/mcp-call-ledger-store.js";
import {
  adjudicateMcpRecoveryCommand,
  registerSessionMcpRecoveryCommands,
  requireMcpRecoveryTypedChallenge,
  showMcpRecoveryCommand,
} from "../../src/commands/session-mcp-recovery.js";

const SESSION_ID = "session-tty-1";
const HEAD_1 = "1".repeat(64);
const HEAD_2 = "2".repeat(64);

function startedEvent() {
  return {
    type: MCP_CALL_LEDGER_EVENT,
    timestamp: 1,
    prevHash: null,
    hash: HEAD_1,
    data: {
      schemaVersion: 1,
      phase: "started",
      record: {
        schemaVersion: 1,
        ledgerId: "mcp-cli-1",
        sessionId: SESSION_ID,
        turnId: "turn-1",
        toolName: "publish",
        serverName: "repo",
        inputDigest: `sha256:${"a".repeat(64)}`,
        inputBytes: 17,
        effectContract: { effect: "write" },
        resourceScopes: [],
        networkScopes: [],
        prewritePolicy: "fail-closed",
        prewritePersistence: "pending",
        status: "started",
        startedAt: "2026-08-02T00:00:00.000Z",
        settledAt: null,
        outputSummary: null,
        outputDigest: null,
        errorSummary: null,
      },
    },
  };
}

function authority(events = [startedEvent()]) {
  return reduceMcpLedgerEvents(events, {
    sessionId: SESSION_ID,
    verified: true,
  });
}

function adjudicatedEvents(decision = "confirmed_applied") {
  const started = startedEvent();
  const before = authority([started]);
  return [
    started,
    {
      type: "mcp_call_recovery_adjudication",
      timestamp: 2,
      prevHash: HEAD_1,
      hash: HEAD_2,
      data: {
        schemaVersion: 1,
        requestId: "mcp-recovery-request-show",
        sessionId: SESSION_ID,
        ledgerId: "mcp-cli-1",
        decision,
        expectedHeadHash: HEAD_1,
        expectedRecoveryDigest: before.recoveryDigest,
        authority: "local-cli-tty",
        confirmation: "typed-digest-host-stopped",
        reasonDigest: `sha256:${"b".repeat(64)}`,
      },
    },
  ];
}

function ttyDependencies(overrides = {}) {
  return {
    stdin: { isTTY: true },
    stdout: { isTTY: true },
    resolveSessionId: () => SESSION_ID,
    readVerifiedEvents: () => [startedEvent()],
    randomUUID: () => "request-uuid",
    readReason: vi.fn(async () => "confirmed externally"),
    ...overrides,
  };
}

describe("session mcp-recovery CLI", () => {
  it("rejects non-TTY mutation before reading the typed challenge", async () => {
    const readChallenge = vi.fn();
    const appendAuthorityEventIfHead = vi.fn();
    const recovery = authority();

    await expect(
      adjudicateMcpRecoveryCommand(
        SESSION_ID,
        {
          ledgerId: "mcp-cli-1",
          decision: McpCallRecoveryDecision.CONFIRMED_APPLIED,
          expectedHeadHash: recovery.headHash,
          expectedRecoveryDigest: recovery.recoveryDigest,
        },
        ttyDependencies({
          stdin: { isTTY: false },
          readChallenge,
          appendAuthorityEventIfHead,
        }),
      ),
    ).rejects.toMatchObject({
      code: "CC_MCP_RECOVERY_ADJUDICATION_NON_INTERACTIVE",
    });
    expect(readChallenge).not.toHaveBeenCalled();
    expect(appendAuthorityEventIfHead).not.toHaveBeenCalled();
  });

  it("rejects a mismatched typed digest challenge without mutation", async () => {
    const appendAuthorityEventIfHead = vi.fn();
    await expect(
      requireMcpRecoveryTypedChallenge(
        {
          sessionId: SESSION_ID,
          ledgerId: "mcp-cli-1",
          decision: McpCallRecoveryDecision.CONFIRMED_NOT_APPLIED,
          recoveryDigest: authority().recoveryDigest,
        },
        ttyDependencies({
          readChallenge: vi.fn(async () => "ADJUDICATE something-else"),
          appendAuthorityEventIfHead,
        }),
      ),
    ).rejects.toMatchObject({
      code: "CC_MCP_RECOVERY_ADJUDICATION_CHALLENGE_FAILED",
    });
    expect(appendAuthorityEventIfHead).not.toHaveBeenCalled();
  });

  it("persists only a reason digest after an exact TTY challenge", async () => {
    const recovery = authority();
    const appendAuthorityEventIfHead = vi.fn(() => ({ hash: HEAD_2 }));
    const readChallenge = vi.fn(async (challenge) => challenge);
    const result = await adjudicateMcpRecoveryCommand(
      SESSION_ID,
      {
        ledgerId: "mcp-cli-1",
        decision: McpCallRecoveryDecision.CONFIRMED_APPLIED,
        expectedHeadHash: recovery.headHash,
        expectedRecoveryDigest: recovery.recoveryDigest,
      },
      ttyDependencies({
        readChallenge,
        readReason: vi.fn(async () => "ticket says the release already exists"),
        appendAuthorityEventIfHead,
      }),
    );

    expect(readChallenge).toHaveBeenCalledWith(
      `HOST STOPPED; ADJUDICATE ${SESSION_ID} mcp-cli-1 confirmed_applied ${recovery.recoveryDigest}`,
    );
    const persisted = appendAuthorityEventIfHead.mock.calls[0][2];
    expect(persisted).toMatchObject({
      requestId: "mcp-recovery-request-uuid",
      sessionId: SESSION_ID,
      authority: "local-cli-tty",
      confirmation: "typed-digest-host-stopped",
      expectedHeadHash: HEAD_1,
      expectedRecoveryDigest: recovery.recoveryDigest,
    });
    expect(JSON.stringify(persisted)).not.toContain("release already exists");
    expect(result).toMatchObject({
      runtimeReloadRequired: true,
      remediation: "restart_or_resume_before_mcp_calls",
    });
  });

  it("keeps show read-only and registers no --yes bypass", () => {
    const view = showMcpRecoveryCommand(
      SESSION_ID,
      ttyDependencies({ readVerifiedEvents: () => [startedEvent()] }),
    );
    expect(view).toMatchObject({
      verified: true,
      headHash: HEAD_1,
      unsettled: [{ ledgerId: "mcp-cli-1", status: "outcome_unknown" }],
    });
    const adjudicatedView = showMcpRecoveryCommand(
      SESSION_ID,
      ttyDependencies({ readVerifiedEvents: () => adjudicatedEvents() }),
    );
    expect(adjudicatedView.replayDenied).toEqual([
      expect.objectContaining({
        ledgerId: "mcp-cli-1",
        replayDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      }),
    ]);
    expect(adjudicatedView.replayDenied[0]).not.toHaveProperty("inputDigest");
    const notAppliedView = showMcpRecoveryCommand(
      SESSION_ID,
      ttyDependencies({
        readVerifiedEvents: () => adjudicatedEvents("confirmed_not_applied"),
      }),
    );
    expect(notAppliedView).toMatchObject({
      unsettled: [],
      replayDenied: [],
      adjudications: [
        {
          ledgerId: "mcp-cli-1",
          decision: "confirmed_not_applied",
          requestId: "mcp-recovery-request-show",
          authority: "local-cli-tty",
          confirmation: "typed-digest-host-stopped",
          reasonDigest: `sha256:${"b".repeat(64)}`,
        },
      ],
    });

    const root = new Command();
    const recovery = registerSessionMcpRecoveryCommands(
      root.command("session"),
    );
    const adjudicate = recovery.commands.find(
      (command) => command.name() === "adjudicate",
    );
    const optionNames = adjudicate.options.map((option) =>
      option.attributeName(),
    );
    expect(optionNames).not.toContain("yes");
    expect(optionNames).not.toContain("reason");
  });

  it("warns that a successful mutation does not downgrade the running host", async () => {
    const recoveryState = authority();
    const outputLogger = {
      log: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const root = new Command().name("cc");
    registerSessionMcpRecoveryCommands(root.command("session"), {
      ...ttyDependencies({
        readChallenge: vi.fn(async (challenge) => challenge),
        appendAuthorityEventIfHead: vi.fn(() => ({ hash: HEAD_2 })),
      }),
      logger: outputLogger,
    });

    await root.parseAsync([
      "node",
      "cc",
      "session",
      "mcp-recovery",
      "adjudicate",
      SESSION_ID,
      "--ledger-id",
      "mcp-cli-1",
      "--decision",
      "confirmed_not_applied",
      "--expected-head-hash",
      recoveryState.headHash,
      "--expected-recovery-digest",
      recoveryState.recoveryDigest,
    ]);

    expect(outputLogger.success).toHaveBeenCalledOnce();
    expect(outputLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /not adopted.*restart\/resume.*prior host stopped/i,
      ),
    );
    expect(outputLogger.error).not.toHaveBeenCalled();
  });
});
