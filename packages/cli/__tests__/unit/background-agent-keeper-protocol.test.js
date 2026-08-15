import { describe, expect, it, vi } from "vitest";
import {
  BACKGROUND_AGENT_KEEPER_CLEANUP_CONFIRM_TIMEOUT_MS,
  BACKGROUND_AGENT_KEEPER_CLEANUP_TARGET_LIMIT,
  BACKGROUND_AGENT_KEEPER_POWERSHELL_TIMEOUT_MS,
  BACKGROUND_AGENT_KEEPER_RETIRE_TIMEOUT_MARGIN_MS,
  BACKGROUND_AGENT_KEEPER_RETIRE_TIMEOUT_MS,
  BACKGROUND_AGENT_KEEPER_STATE_LOCK_TIMEOUT_MS,
  BACKGROUND_AGENT_KEEPER_TASKKILL_TIMEOUT_MS,
  BACKGROUND_AGENT_KEEPER_WMIC_TIMEOUT_MS,
  backgroundAgentKeeperPipePath,
  normalizeBackgroundAgentKeeperHello,
  normalizeBackgroundAgentKeeperTurn,
  resolveBackgroundAgentKeeperRetireTimeoutMs,
  sameBackgroundAgentKeeperTurn,
} from "../../src/lib/background-agent-keeper-protocol.js";
import { keeperWorkerIdentityAlive } from "../../src/workers/background-agent-keeper.js";

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

  it("checks worker liveness against its durable launch anchor", () => {
    const probe = vi.fn(() => false);
    expect(keeperWorkerIdentityAlive(2468, 1_234_567, probe)).toBe(false);
    expect(probe).toHaveBeenCalledWith(2468, 1_234_567);
  });

  it("gives RETIRE an independent budget covering bounded Windows cleanup", () => {
    const boundedCleanupMs =
      BACKGROUND_AGENT_KEEPER_CLEANUP_TARGET_LIMIT *
        (BACKGROUND_AGENT_KEEPER_TASKKILL_TIMEOUT_MS +
          BACKGROUND_AGENT_KEEPER_WMIC_TIMEOUT_MS +
          BACKGROUND_AGENT_KEEPER_POWERSHELL_TIMEOUT_MS) +
      2 * BACKGROUND_AGENT_KEEPER_STATE_LOCK_TIMEOUT_MS +
      BACKGROUND_AGENT_KEEPER_CLEANUP_CONFIRM_TIMEOUT_MS;

    expect(BACKGROUND_AGENT_KEEPER_RETIRE_TIMEOUT_MS).toBe(
      boundedCleanupMs + BACKGROUND_AGENT_KEEPER_RETIRE_TIMEOUT_MARGIN_MS,
    );
    expect(BACKGROUND_AGENT_KEEPER_RETIRE_TIMEOUT_MS).toBe(70_000);
    expect(resolveBackgroundAgentKeeperRetireTimeoutMs(undefined)).toBe(70_000);
    expect(resolveBackgroundAgentKeeperRetireTimeoutMs(Infinity)).toBe(70_000);
    expect(resolveBackgroundAgentKeeperRetireTimeoutMs(100_000)).toBe(70_000);
    expect(resolveBackgroundAgentKeeperRetireTimeoutMs(1_234.9)).toBe(1_234);
  });
});
