import { describe, expect, it, vi } from "vitest";
import {
  BACKGROUND_AGENT_KEEPER_CLEANUP_CONFIRM_TIMEOUT_MS,
  BACKGROUND_AGENT_KEEPER_CLEANUP_TARGET_LIMIT,
  BACKGROUND_AGENT_KEEPER_HEARTBEAT_TIMEOUT_MS,
  BACKGROUND_AGENT_KEEPER_IDENTITY_PROBE_DELAY_MS,
  BACKGROUND_AGENT_KEEPER_IDENTITY_PROBE_TIMEOUT_MS,
  BACKGROUND_AGENT_KEEPER_PERSIST_RETRY_TIMEOUT_MS,
  BACKGROUND_AGENT_KEEPER_RETIRE_TIMEOUT_MARGIN_MS,
  BACKGROUND_AGENT_KEEPER_RETIRE_TIMEOUT_MS,
  BACKGROUND_AGENT_KEEPER_STATE_LOCK_TIMEOUT_MS,
  BACKGROUND_AGENT_KEEPER_TASKKILL_TIMEOUT_MS,
  POSIX_KEEPER_SOCKET_PATH_MAX_BYTES,
  backgroundAgentKeeperLaunchClaimPath,
  backgroundAgentKeeperPipePath,
  createBackgroundAgentKeeperLaunchClaim,
  matchesBackgroundAgentKeeperLaunchClaim,
  normalizeBackgroundAgentKeeperHello,
  normalizeBackgroundAgentKeeperTurn,
  resolveBackgroundAgentKeeperRetireTimeoutMs,
  sameBackgroundAgentKeeperTurn,
} from "../../src/lib/background-agent-keeper-protocol.js";
import {
  keeperWorkerIdentityAlive,
  retryKeeperPersistence,
  runBackgroundAgentKeeperHeartbeat,
  stopBackgroundAgentKeeperTurnTrees,
  waitForBackgroundAgentKeeperTurnTreesToStop,
} from "../../src/workers/background-agent-keeper.js";

const turn = {
  id: "bg-keeper-test",
  workerGeneration: "generation-1",
  turnLaunchToken: "turn-token-1",
  attempt: 2,
  agentPid: 4321,
  agentStartedAt: 1_000,
  agentRuntimePid: 5432,
  agentRuntimeStartedAt: 1_001,
};

describe("background agent keeper protocol", () => {
  it("binds the post-lock launch claim to the exact keeper generation", () => {
    const claim = createBackgroundAgentKeeperLaunchClaim({
      id: turn.id,
      workerGeneration: turn.workerGeneration,
      keeperGeneration: "keeper-generation-1",
      keeperPid: 6789,
      token: "a".repeat(64),
    });

    expect(
      backgroundAgentKeeperLaunchClaimPath(
        turn.id,
        claim.keeperGeneration,
        "/private/state",
      ).replaceAll("\\", "/"),
    ).toMatch(
      /\/\.bg-keeper-test\.keeper-keeper-generation-1\.launch-claim\.json$/u,
    );
    expect(matchesBackgroundAgentKeeperLaunchClaim(claim, claim)).toBe(true);
    expect(
      matchesBackgroundAgentKeeperLaunchClaim(
        { ...claim, keeperPid: claim.keeperPid + 1 },
        claim,
      ),
    ).toBe(false);
  });

  it("binds the exact wrapper and runtime identities for one turn", () => {
    expect(normalizeBackgroundAgentKeeperTurn(turn)).toEqual(turn);
    expect(sameBackgroundAgentKeeperTurn(turn, { ...turn })).toBe(true);
    expect(
      sameBackgroundAgentKeeperTurn(turn, {
        ...turn,
        agentRuntimePid: turn.agentRuntimePid + 1,
      }),
    ).toBe(false);
  });

  it("rejects forged credentials and invalid process identities", () => {
    expect(() =>
      normalizeBackgroundAgentKeeperHello({
        id: turn.id,
        workerGeneration: turn.workerGeneration,
        token: "not-a-capability",
        workerPid: 1234,
      }),
    ).toThrow(/token/u);
    expect(() =>
      normalizeBackgroundAgentKeeperTurn({ ...turn, agentPid: 0 }),
    ).toThrow(/agent pid/u);
    expect(() => backgroundAgentKeeperPipePath("../escape", "C:\\tmp")).toThrow(
      /id/u,
    );
  });

  it("hashes long POSIX endpoints before Darwin can truncate their identity", () => {
    const directory = `/private/var/folders/${"nested/".repeat(12)}background-agents`;
    const options = { platform: "darwin", tempDirectory: "/tmp", uid: 501 };
    const first = backgroundAgentKeeperPipePath(
      "bg-1786854302136-5be605",
      directory,
      options,
    );
    const second = backgroundAgentKeeperPipePath(
      "bg-1786854302136-5be606",
      directory,
      options,
    );
    const otherRoot = backgroundAgentKeeperPipePath(
      "bg-1786854302136-5be605",
      `${directory}-other`,
      options,
    );

    expect(first).toMatch(/^\/tmp\/cc-bgk-[a-f0-9]{24}\/[a-f0-9]{32}\.sock$/u);
    expect(Buffer.byteLength(first, "utf8")).toBeLessThanOrEqual(
      POSIX_KEEPER_SOCKET_PATH_MAX_BYTES,
    );
    expect(new Set([first, second, otherRoot]).size).toBe(3);
    expect(
      backgroundAgentKeeperPipePath("bg-short", "/tmp/agents", options),
    ).toBe("/tmp/agents/bg-short.keeper.sock");
  });

  it("checks worker liveness against its durable launch anchor", () => {
    const probe = vi.fn(() => false);
    expect(keeperWorkerIdentityAlive(2468, 1_234_567, probe)).toBe(false);
    expect(probe).toHaveBeenCalledWith(2468, 1_234_567);
  });

  it("retries cleanup-critical persistence through a transient lock fence", async () => {
    let clock = 0;
    const sleep = vi.fn(async (ms) => {
      clock += ms;
    });
    const operation = vi
      .fn()
      .mockImplementationOnce(() => {
        throw Object.assign(new Error("locked"), {
          code: "STATE_LOCK_UNAVAILABLE",
        });
      })
      .mockImplementationOnce(() => {
        throw Object.assign(new Error("still locked"), {
          code: "STATE_LOCK_UNAVAILABLE",
        });
      })
      .mockReturnValue({ applied: true });

    await expect(
      retryKeeperPersistence(operation, {
        timeoutMs: 20,
        retryDelayMs: 5,
        now: () => clock,
        sleep,
      }),
    ).resolves.toEqual({
      result: { applied: true },
      error: null,
      attempts: 3,
    });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("fails closed when cleanup-critical persistence exhausts its deadline", async () => {
    let clock = 0;
    const sleep = vi.fn(async (ms) => {
      clock += ms;
    });
    const unavailable = Object.assign(new Error("lock stayed unavailable"), {
      code: "STATE_LOCK_UNAVAILABLE",
    });
    const operation = vi.fn(() => {
      throw unavailable;
    });

    await expect(
      retryKeeperPersistence(operation, {
        timeoutMs: 10,
        retryDelayMs: 5,
        now: () => clock,
        sleep,
      }),
    ).resolves.toEqual({
      result: null,
      error: unavailable,
      attempts: 3,
    });
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("skips heartbeat persistence immediately after finishing starts", () => {
    const persistKeeper = vi.fn();
    const workerIdentityAlive = vi.fn();

    expect(
      runBackgroundAgentKeeperHeartbeat({
        finishing: true,
        persistKeeper,
        workerIdentityAlive,
      }),
    ).toBe(false);
    expect(workerIdentityAlive).not.toHaveBeenCalled();
    expect(persistKeeper).not.toHaveBeenCalled();
  });

  it("stays read-only until the worker is authenticated", () => {
    const persistKeeper = vi.fn();

    expect(
      runBackgroundAgentKeeperHeartbeat({
        finishing: false,
        persistKeeper,
      }),
    ).toBe(false);
    expect(persistKeeper).not.toHaveBeenCalled();
  });

  it("disconnects a worker after its authenticated heartbeat expires", () => {
    const persistKeeper = vi.fn();
    const finishForWorkerDisconnect = vi.fn();
    const workerSocket = { destroy: vi.fn() };
    const workerIdentityAlive = vi.fn(() => true);

    expect(
      runBackgroundAgentKeeperHeartbeat({
        finishing: false,
        workerSocket,
        authenticatedHello: { workerPid: 2468 },
        authenticatedWorkerStartedAt: 1_234_567,
        workerHeartbeatAt: 1_000,
        armedTurn: null,
        persistKeeper,
        finishForWorkerDisconnect,
        now: () => 1_000 + BACKGROUND_AGENT_KEEPER_HEARTBEAT_TIMEOUT_MS + 1,
        workerIdentityAlive,
      }),
    ).toBe(false);
    expect(finishForWorkerDisconnect).toHaveBeenCalledOnce();
    expect(workerSocket.destroy).toHaveBeenCalledOnce();
    expect(workerIdentityAlive).not.toHaveBeenCalled();
    expect(persistKeeper).not.toHaveBeenCalled();
  });

  it("keeps a live worker through the observed hosted Windows scheduling tail", () => {
    const persistKeeper = vi.fn();
    const finishForWorkerDisconnect = vi.fn();
    const workerSocket = { destroy: vi.fn() };
    const workerIdentityAlive = vi.fn(() => true);

    expect(
      runBackgroundAgentKeeperHeartbeat({
        finishing: false,
        workerSocket,
        authenticatedHello: { workerPid: 2468 },
        authenticatedWorkerStartedAt: 1_234_567,
        workerHeartbeatAt: 1_000,
        armedTurn: turn,
        persistKeeper,
        finishForWorkerDisconnect,
        now: () => 1_000 + 37_391,
        workerIdentityAlive,
      }),
    ).toBe(true);
    expect(workerIdentityAlive).toHaveBeenCalledWith(2468, 1_234_567);
    expect(finishForWorkerDisconnect).not.toHaveBeenCalled();
    expect(workerSocket.destroy).not.toHaveBeenCalled();
    expect(persistKeeper).toHaveBeenCalledWith({ keeperHeartbeatAt: 38_391 });
  });

  it("does not probe worker identity while application heartbeats are fresh", () => {
    const persistKeeper = vi.fn();
    const finishForWorkerDisconnect = vi.fn();
    const workerIdentityAlive = vi.fn(() => true);

    expect(
      runBackgroundAgentKeeperHeartbeat({
        finishing: false,
        workerSocket: { destroy: vi.fn() },
        authenticatedHello: { workerPid: 2468 },
        authenticatedWorkerStartedAt: 1_234_567,
        workerHeartbeatAt: 1_000,
        armedTurn: turn,
        persistKeeper,
        finishForWorkerDisconnect,
        now: () => 1_000 + BACKGROUND_AGENT_KEEPER_IDENTITY_PROBE_DELAY_MS - 1,
        workerIdentityAlive,
      }),
    ).toBe(true);
    expect(workerIdentityAlive).not.toHaveBeenCalled();
    expect(finishForWorkerDisconnect).not.toHaveBeenCalled();
  });

  it("contains and reports heartbeat persistence errors", () => {
    const persistenceError = Object.assign(new Error("lock unavailable"), {
      code: "STATE_LOCK_UNAVAILABLE",
    });
    const persistKeeper = vi.fn(() => {
      throw persistenceError;
    });
    const reportPersistenceFailure = vi.fn();

    expect(
      runBackgroundAgentKeeperHeartbeat({
        finishing: false,
        workerSocket: {},
        authenticatedHello: { workerPid: 2468 },
        workerHeartbeatAt: 1_234,
        persistKeeper,
        now: () => 1_234,
        reportPersistenceFailure,
      }),
    ).toBe(false);
    expect(persistKeeper).toHaveBeenCalledWith({ keeperHeartbeatAt: 1_234 });
    expect(reportPersistenceFailure).toHaveBeenCalledWith(
      "heartbeat",
      persistenceError,
    );
  });

  it("skips a runtime target already retired by the preceding tree stop", () => {
    const alive = new Set([4321, 5432]);
    const stopProcessTree = vi.fn((pid) => {
      expect(pid).toBe(4321);
      alive.clear();
    });

    expect(
      stopBackgroundAgentKeeperTurnTrees(
        [
          { pid: 4321, startedAt: 1_000, processGroup: true },
          { pid: 5432, startedAt: 1_001, processGroup: false },
        ],
        {
          isProcessAlive: (pid) => alive.has(pid),
          stopProcessTree,
        },
      ),
    ).toEqual([]);
    expect(stopProcessTree).toHaveBeenCalledOnce();
    expect(stopProcessTree).toHaveBeenCalledWith(4321, {
      signal: "SIGKILL",
      expectedStartedAt: 1_000,
      processGroup: true,
      strictIdentity: true,
      allowDirectFallback: false,
    });
  });

  it("still signals the first POSIX group after its leader pid retires", () => {
    const stopProcessTree = vi.fn();

    expect(
      stopBackgroundAgentKeeperTurnTrees(
        [
          { pid: 4321, startedAt: 1_000, processGroup: true },
          { pid: 5432, startedAt: 1_001, processGroup: false },
        ],
        {
          isProcessAlive: () => false,
          stopProcessTree,
        },
      ),
    ).toEqual([]);
    expect(stopProcessTree).toHaveBeenCalledOnce();
    expect(stopProcessTree).toHaveBeenCalledWith(4321, {
      signal: "SIGKILL",
      expectedStartedAt: 1_000,
      processGroup: true,
      strictIdentity: true,
      allowDirectFallback: false,
    });
  });

  it("retains a strict group-stop failure while leaderless descendants execute", () => {
    const stopError = new Error(
      "process-group-owner-not-verifiable for pid 4321",
    );
    const processTreeExecutionAlive = vi.fn(() => true);

    expect(
      stopBackgroundAgentKeeperTurnTrees(
        [{ pid: 4321, startedAt: 1_000, processGroup: true }],
        {
          platform: "linux",
          isProcessAlive: () => false,
          isProcessTreeExecutionAlive: processTreeExecutionAlive,
          stopProcessTree: () => {
            throw stopError;
          },
        },
      ),
    ).toEqual([stopError.message]);
    expect(processTreeExecutionAlive).toHaveBeenCalledWith(4321, 1_000, {
      processGroup: true,
    });
  });

  it("keeps a keeper cleanup failure only while the target remains alive", () => {
    const alive = new Set([4321]);
    const stopProcessTree = vi
      .fn()
      .mockImplementationOnce(() => {
        alive.delete(4321);
        throw new Error("retired during taskkill");
      })
      .mockImplementationOnce(() => {
        throw new Error("persistent denial");
      });

    expect(
      stopBackgroundAgentKeeperTurnTrees(
        [{ pid: 4321, startedAt: 1_000, processGroup: true }],
        {
          isProcessAlive: (pid) => alive.has(pid),
          isProcessTreeExecutionAlive: (pid) => alive.has(pid),
          stopProcessTree,
        },
      ),
    ).toEqual([]);
    alive.add(5432);
    expect(
      stopBackgroundAgentKeeperTurnTrees(
        [{ pid: 5432, startedAt: 1_001, processGroup: false }],
        {
          isProcessAlive: (pid) => alive.has(pid),
          stopProcessTree,
        },
      ),
    ).toEqual(["persistent denial"]);
    expect(stopProcessTree).toHaveBeenNthCalledWith(1, 4321, {
      signal: "SIGKILL",
      expectedStartedAt: 1_000,
      processGroup: true,
      strictIdentity: true,
      allowDirectFallback: false,
    });
    expect(stopProcessTree).toHaveBeenNthCalledWith(2, 5432, {
      signal: "SIGKILL",
      expectedStartedAt: 1_001,
      processGroup: false,
      strictIdentity: true,
      allowDirectFallback: false,
    });
  });

  it("allows a bounded macOS reap delay without probing direct targets as groups", async () => {
    let now = 0;
    const sleep = vi.fn(async (milliseconds) => {
      now += milliseconds;
    });
    const isProcessTreeExecutionAlive = vi.fn(() => now < 5_000);
    const targets = [
      { pid: 4321, startedAt: 1_000, processGroup: true },
      { pid: 5432, startedAt: 1_001, processGroup: false },
    ];

    await expect(
      waitForBackgroundAgentKeeperTurnTreesToStop(targets, {
        timeoutMs: 10_000,
        pollMs: 1_000,
        now: () => now,
        sleep,
        isProcessTreeExecutionAlive,
      }),
    ).resolves.toEqual([]);
    expect(now).toBe(5_000);
    expect(sleep).toHaveBeenCalledTimes(5);
    expect(isProcessTreeExecutionAlive).toHaveBeenCalledWith(4321, 1_000, {
      processGroup: true,
    });
    expect(isProcessTreeExecutionAlive).toHaveBeenCalledWith(5432, 1_001, {
      processGroup: false,
    });
  });

  it("keeps an executable tree fail-closed after the confirmation budget", async () => {
    let now = 0;
    const target = { pid: 4321, startedAt: 1_000, processGroup: true };

    await expect(
      waitForBackgroundAgentKeeperTurnTreesToStop([target], {
        timeoutMs: 3_000,
        pollMs: 1_000,
        now: () => now,
        sleep: async (milliseconds) => {
          now += milliseconds;
        },
        isProcessTreeExecutionAlive: () => true,
      }),
    ).resolves.toEqual([target]);
    expect(now).toBe(3_000);
  });

  it("gives RETIRE an independent budget covering bounded Windows cleanup", () => {
    const boundedCleanupMs =
      BACKGROUND_AGENT_KEEPER_CLEANUP_TARGET_LIMIT *
        (BACKGROUND_AGENT_KEEPER_TASKKILL_TIMEOUT_MS +
          2 * BACKGROUND_AGENT_KEEPER_IDENTITY_PROBE_TIMEOUT_MS) +
      2 * BACKGROUND_AGENT_KEEPER_PERSIST_RETRY_TIMEOUT_MS +
      BACKGROUND_AGENT_KEEPER_CLEANUP_CONFIRM_TIMEOUT_MS;

    expect(BACKGROUND_AGENT_KEEPER_PERSIST_RETRY_TIMEOUT_MS).toBe(
      3 * BACKGROUND_AGENT_KEEPER_STATE_LOCK_TIMEOUT_MS,
    );
    expect(BACKGROUND_AGENT_KEEPER_PERSIST_RETRY_TIMEOUT_MS).toBe(15_000);
    expect(BACKGROUND_AGENT_KEEPER_RETIRE_TIMEOUT_MS).toBe(
      boundedCleanupMs + BACKGROUND_AGENT_KEEPER_RETIRE_TIMEOUT_MARGIN_MS,
    );
    expect(BACKGROUND_AGENT_KEEPER_RETIRE_TIMEOUT_MS).toBe(128_000);
    expect(resolveBackgroundAgentKeeperRetireTimeoutMs(undefined)).toBe(
      128_000,
    );
    expect(resolveBackgroundAgentKeeperRetireTimeoutMs(Infinity)).toBe(128_000);
    expect(resolveBackgroundAgentKeeperRetireTimeoutMs(200_000)).toBe(128_000);
    expect(resolveBackgroundAgentKeeperRetireTimeoutMs(100_000)).toBe(100_000);
    expect(resolveBackgroundAgentKeeperRetireTimeoutMs(1_234.9)).toBe(1_234);
  });
});
