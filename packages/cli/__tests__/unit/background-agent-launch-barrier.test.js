import { describe, expect, it, vi } from "vitest";
import { waitForBackgroundAgentLaunchBarrier } from "../../src/lib/background-agent-launch-barrier.js";

describe("background agent launch barrier", () => {
  const pending = {
    id: "bg-launch-barrier",
    status: "running",
    workerGeneration: "generation-1",
    workerPid: null,
    keeperPid: null,
    launchFinalizationUncertain: true,
  };

  it("waits read-only until the launcher publishes the exact worker pid", async () => {
    const ready = {
      ...pending,
      workerPid: 4321,
      keeperPid: 4322,
      launchFinalizationUncertain: false,
    };
    const readState = vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockReturnValueOnce(pending)
      .mockReturnValue(ready);
    let now = 100;
    const sleep = vi.fn(async (milliseconds) => {
      now += milliseconds;
    });

    await expect(
      waitForBackgroundAgentLaunchBarrier({
        id: pending.id,
        workerGeneration: pending.workerGeneration,
        expectedPid: ready.workerPid,
        pidField: "workerPid",
        readState,
        now: () => now,
        sleep,
        timeoutMs: 100,
        pollMs: 10,
      }),
    ).resolves.toEqual({ status: "ready", state: ready });
    expect(readState).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("can wait for the keeper's first claim after pid finalization", async () => {
    const finalized = {
      ...pending,
      workerPid: 4321,
      keeperPid: 4322,
      keeperStatus: "starting",
      launchFinalizationUncertain: false,
    };
    const listening = { ...finalized, keeperStatus: "listening" };
    const readState = vi
      .fn()
      .mockReturnValueOnce(finalized)
      .mockReturnValue(listening);
    let now = 100;

    await expect(
      waitForBackgroundAgentLaunchBarrier({
        id: pending.id,
        workerGeneration: pending.workerGeneration,
        expectedPid: finalized.workerPid,
        pidField: "workerPid",
        readState,
        readyWhen: (state) => state.keeperStatus === "listening",
        now: () => now,
        sleep: async (milliseconds) => {
          now += milliseconds;
        },
        timeoutMs: 100,
      }),
    ).resolves.toEqual({ status: "ready", state: listening });
    expect(readState).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the finalized pid does not bind this child", async () => {
    const state = {
      ...pending,
      workerPid: 9999,
      launchFinalizationUncertain: false,
    };
    await expect(
      waitForBackgroundAgentLaunchBarrier({
        id: pending.id,
        workerGeneration: pending.workerGeneration,
        expectedPid: 4321,
        pidField: "workerPid",
        readState: () => state,
      }),
    ).resolves.toEqual({ status: "identity-mismatch", state });
  });

  it("stops waiting when the record becomes terminal or changes generation", async () => {
    const changed = { ...pending, workerGeneration: "generation-2" };
    await expect(
      waitForBackgroundAgentLaunchBarrier({
        id: pending.id,
        workerGeneration: pending.workerGeneration,
        expectedPid: 4321,
        pidField: "workerPid",
        readState: () => changed,
      }),
    ).resolves.toEqual({ status: "terminal", state: changed });
  });

  it("uses a bounded deadline without mutating pending state", async () => {
    let now = 100;
    const readState = vi.fn(() => pending);
    const sleep = vi.fn(async (milliseconds) => {
      now += milliseconds;
    });
    await expect(
      waitForBackgroundAgentLaunchBarrier({
        id: pending.id,
        workerGeneration: pending.workerGeneration,
        expectedPid: 4322,
        pidField: "keeperPid",
        readState,
        now: () => now,
        sleep,
        timeoutMs: 20,
        pollMs: 25,
      }),
    ).resolves.toEqual({ status: "timeout", state: pending });
    expect(readState).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(20);
  });
});
