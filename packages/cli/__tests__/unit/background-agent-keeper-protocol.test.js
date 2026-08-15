import { describe, expect, it } from "vitest";
import {
  backgroundAgentKeeperPipePath,
  normalizeBackgroundAgentKeeperHello,
  normalizeBackgroundAgentKeeperTurn,
  sameBackgroundAgentKeeperTurn,
} from "../../src/lib/background-agent-keeper-protocol.js";

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
});
