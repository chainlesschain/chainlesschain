import { describe, expect, it, vi } from "vitest";
import { resolveAgentObservabilityScope } from "../../src/commands/agent.js";
import {
  resolveHeadlessSession,
  runAgentHeadless,
} from "../../src/runtime/headless-runner.js";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";
import {
  prepareReplStartupResume,
  runReplStartupBoundary,
  startReplJsonlSession,
} from "../../src/repl/agent-repl.js";
import { resolveAgentPolicy } from "../../src/runtime/policies/agent-policy.js";

const SCOPE = Object.freeze({
  workspaceId: "workspace-1",
  teamId: null,
  policyId: null,
});

function verifiedRecovery(sessionId) {
  return {
    sessionId,
    records: [],
    unsettled: [],
    incidents: [],
    adjudications: [],
    replayDenied: [],
    verified: true,
    headHash: "b".repeat(64),
    recoveryDigest: `sha256:${"c".repeat(64)}`,
    remediation: null,
  };
}

function verifiedResumeState(sessionId) {
  const recovery = verifiedRecovery(sessionId);
  return {
    snapshot: {
      schema: "chainlesschain.session-host-snapshot/v1",
      schemaVersion: 1,
      sessionId,
      verified: true,
      revision: `sha256:${"a".repeat(64)}`,
      head: { hash: recovery.headHash, eventCount: 1 },
      recoveryAuthority: { recoveryDigest: recovery.recoveryDigest },
    },
    messages: [{ role: "user", content: "restored" }],
    recovery,
  };
}

function makeHeadlessDeps(overrides = {}) {
  return {
    bootstrap: vi.fn(async () => ({ db: null })),
    getApprovalGate: vi.fn(async () => null),
    executeHooksV2Event: vi.fn(async () => ({
      blocked: false,
      decision: "continue",
      results: [],
    })),
    resolveAgentMcp: vi.fn(async () => null),
    expandFileRefs: vi.fn(async (prompt) => ({ prompt, warnings: [] })),
    writeOut: vi.fn(),
    writeErr: vi.fn(),
    ...overrides,
  };
}

function makeStreamDeps(overrides = {}) {
  async function* input() {
    yield '{"type":"user","text":"go"}\n';
  }
  return {
    bootstrap: vi.fn(async () => ({ db: null })),
    getApprovalGate: vi.fn(async () => null),
    input: input(),
    writeOut: vi.fn(),
    writeErr: vi.fn(),
    ...overrides,
  };
}

describe("agent observability scope validation", () => {
  it("distinguishes absent scope flags from empty values", () => {
    expect(resolveAgentObservabilityScope({})).toBeUndefined();
    expect(() =>
      resolveAgentObservabilityScope({ observabilityWorkspace: "   " }),
    ).toThrow(/non-empty id/);
  });

  it("normalizes ids and rejects ephemeral scope", () => {
    expect(
      resolveAgentObservabilityScope({
        observabilityWorkspace: " workspace-1 ",
      }),
    ).toEqual(SCOPE);
    expect(() =>
      resolveAgentObservabilityScope({
        observabilityWorkspace: "workspace-1",
        ephemeral: true,
      }),
    ).toThrow(/cannot be combined with --ephemeral/);
  });

  it("rejects every scope flag when forking but preserves unscoped forks", () => {
    expect(() =>
      resolveAgentObservabilityScope({
        observabilityTeam: "team-1",
        forkSession: true,
      }),
    ).toThrow(/cannot be combined with --fork-session.*inherits.*immutable/i);
    expect(
      resolveAgentObservabilityScope({ forkSession: true }),
    ).toBeUndefined();
  });
});

describe("agent policy observability compatibility", () => {
  it("does not change the legacy policy shape when scope is absent", () => {
    const policy = resolveAgentPolicy({ overrides: { model: "test-model" } });

    expect(policy).not.toHaveProperty("observabilityScope");
  });

  it("copies an explicitly provided scope into the policy", () => {
    const mutableScope = { ...SCOPE };
    const policy = resolveAgentPolicy({
      overrides: { observabilityScope: mutableScope },
    });

    expect(policy.observabilityScope).toEqual(SCOPE);
    expect(policy.observabilityScope).not.toBe(mutableScope);
  });
});

describe("headless observability persistence", () => {
  it("forces persistence for a new scoped run", () => {
    expect(
      resolveHeadlessSession({ observabilityScope: SCOPE }, {}, "generated"),
    ).toMatchObject({ sessionId: "generated", persist: true });
  });

  it("creates a durable session with the exact scope before the model", async () => {
    const startSession = vi.fn((id) => id);
    const agentLoop = vi.fn(async function* (_messages, loopOptions) {
      expect(loopOptions.strictUsageTelemetry).toBe(true);
      expect(typeof loopOptions.onUsageBoundary).toBe("function");
      yield { type: "response-complete", content: "done" };
      yield { type: "run-ended", reason: "complete" };
    });
    const deps = makeHeadlessDeps({
      sessionExists: vi.fn(() => false),
      startSession,
      appendUserMessage: vi.fn(),
      appendAssistantMessage: vi.fn(),
      appendTokenUsage: vi.fn(),
      appendEvent: vi.fn(),
      appendAuthorityEvent: vi.fn(),
      readEvents: vi.fn(() => []),
      agentLoop,
    });

    const outcome = await runAgentHeadless(
      {
        prompt: "go",
        expandFileRefs: false,
        observabilityScope: SCOPE,
      },
      deps,
    );

    expect(outcome.exitCode).toBe(0);
    expect(startSession).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        observabilityScope: SCOPE,
        executionLocation: expect.objectContaining({
          schema: "cc-execution-location-binding/v1",
          observed: true,
        }),
      }),
    );
    expect(agentLoop).toHaveBeenCalledOnce();
  });

  it("refuses existing authority instead of overwriting its scope", async () => {
    const startSession = vi.fn();
    const agentLoop = vi.fn();
    const outcome = await runAgentHeadless(
      {
        prompt: "go",
        sessionId: "existing",
        observabilityScope: SCOPE,
      },
      makeHeadlessDeps({
        sessionExists: vi.fn(() => true),
        startSession,
        agentLoop,
      }),
    );

    expect(outcome).toMatchObject({
      exitCode: 1,
      result: expect.stringContaining("CC_OBSERVABILITY_SCOPE_IMMUTABLE"),
    });
    expect(startSession).not.toHaveBeenCalled();
    expect(agentLoop).not.toHaveBeenCalled();
  });

  it("rejects scoped ephemeral mode before startup", async () => {
    await expect(
      runAgentHeadless(
        {
          prompt: "go",
          ephemeral: true,
          observabilityScope: SCOPE,
        },
        makeHeadlessDeps(),
      ),
    ).rejects.toThrow(/durable session persistence/);
  });
});

describe("stream observability persistence", () => {
  it("persists a generated session and its exact scope", async () => {
    const startSession = vi.fn((id) => id);
    const agentLoop = vi.fn(async function* (_messages, loopOptions) {
      expect(loopOptions.strictUsageTelemetry).toBe(true);
      expect(typeof loopOptions.onUsageBoundary).toBe("function");
      yield { type: "response-complete", content: "done" };
      yield { type: "run-ended", reason: "complete" };
    });
    const deps = makeStreamDeps({
      sessionExists: vi.fn(() => false),
      startSession,
      appendUserMessage: vi.fn(),
      appendAssistantMessage: vi.fn(),
      appendEvent: vi.fn(),
      readEvents: vi.fn(() => []),
      loadSideEffectLedger: vi.fn(() => null),
      agentLoop,
    });

    const outcome = await runAgentHeadlessStream(
      {
        expandFileRefs: false,
        observabilityScope: SCOPE,
      },
      deps,
    );

    expect(outcome).toEqual({ exitCode: 0, turns: 1 });
    expect(startSession).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        observabilityScope: SCOPE,
        executionLocation: expect.objectContaining({
          schema: "cc-execution-location-binding/v1",
          observed: true,
        }),
      }),
    );
    expect(agentLoop).toHaveBeenCalledOnce();
  });

  it("refuses an existing stream session before model startup", async () => {
    const startSession = vi.fn();
    const agentLoop = vi.fn();
    const deps = makeStreamDeps({
      sessionExists: vi.fn(() => true),
      startSession,
      agentLoop,
    });

    const outcome = await runAgentHeadlessStream(
      {
        sessionId: "existing",
        observabilityScope: SCOPE,
      },
      deps,
    );

    expect(outcome).toEqual({ exitCode: 1, turns: 0 });
    expect(startSession).not.toHaveBeenCalled();
    expect(agentLoop).not.toHaveBeenCalled();
    expect(deps.writeErr.mock.calls[0]?.[0]).toContain(
      "CC_OBSERVABILITY_SCOPE_IMMUTABLE",
    );
  });

  it("rejects scoped ephemeral mode before reading input", async () => {
    await expect(
      runAgentHeadlessStream(
        { ephemeral: true, observabilityScope: SCOPE },
        makeStreamDeps(),
      ),
    ).rejects.toThrow(/durable session persistence/);
  });
});

describe("REPL observability persistence", () => {
  const unusedHostDependencies = {
    cwd: vi.fn(),
    runWithHostHooksV2Workspace: vi.fn(),
    startAgentReplInWorkspace: vi.fn(),
  };

  it("requires JSONL authority before entering the workspace", async () => {
    const admission = prepareReplStartupResume(null, { feature: () => false });
    await expect(
      runReplStartupBoundary(
        { observabilityScope: SCOPE },
        {
          prepareReplStartupResume: () => admission,
          ...unusedHostDependencies,
        },
      ),
    ).rejects.toMatchObject({ code: "CC_OBSERVABILITY_SCOPE_JSONL_REQUIRED" });
  });

  it("refuses a verified existing session instead of replacing its scope", async () => {
    const admission = prepareReplStartupResume("existing", {
      readSessionHostResumeState: () => verifiedResumeState("existing"),
      formatMcpLedgerRecoveryNotice: () => null,
    });
    await expect(
      runReplStartupBoundary(
        { sessionId: "existing", observabilityScope: SCOPE },
        {
          prepareReplStartupResume: () => admission,
          ...unusedHostDependencies,
        },
      ),
    ).rejects.toMatchObject({ code: "CC_OBSERVABILITY_SCOPE_IMMUTABLE" });
  });

  it("rejects scoped ephemeral mode before resolving storage", async () => {
    const prepareReplStartupResume = vi.fn();
    await expect(
      runReplStartupBoundary(
        { ephemeral: true, observabilityScope: SCOPE },
        { prepareReplStartupResume },
      ),
    ).rejects.toMatchObject({
      code: "CC_OBSERVABILITY_SCOPE_EPHEMERAL_CONFLICT",
    });
    expect(prepareReplStartupResume).not.toHaveBeenCalled();
  });

  it("makes scoped startSession failures fatal but preserves legacy best effort", () => {
    const failure = vi.fn(() => {
      throw new Error("disk full");
    });
    expect(() => startReplJsonlSession(failure, null, {}, SCOPE)).toThrow(
      expect.objectContaining({ code: "CC_OBSERVABILITY_SCOPE_START_FAILED" }),
    );
    expect(startReplJsonlSession(failure, null, {}, undefined)).toBeNull();
    expect(() => startReplJsonlSession(() => null, null, {}, SCOPE)).toThrow(
      expect.objectContaining({ code: "CC_OBSERVABILITY_SCOPE_START_FAILED" }),
    );
  });
});
