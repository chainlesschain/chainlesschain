import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  attachTurnChildBootstrapRelease,
  attachTurnChildTerminationSettlement,
  deliverAfterDurableInteractionCleanup,
  hasDurableKeeperTurnRetirement,
  spawnTurnAfterDurableIntent,
} from "../../src/workers/background-agent-worker.js";
import {
  BACKGROUND_TURN_BOOTSTRAP_PROTOCOL_VERSION,
  BACKGROUND_TURN_BOOTSTRAP_READY,
  BACKGROUND_TURN_BOOTSTRAP_RELEASE,
} from "../../src/lib/background-turn-bootstrap-protocol.js";

describe("background agent worker child termination settlement", () => {
  const keeperTurn = Object.freeze({
    id: "bg-exact-turn",
    workerGeneration: "worker-generation-1",
    turnLaunchToken: "turn-token-1",
    attempt: 7,
    agentPid: 4321,
    agentStartedAt: 10_000,
    agentRuntimePid: 8765,
    agentRuntimeStartedAt: 10_000,
  });
  const retiredState = Object.freeze({
    id: keeperTurn.id,
    workerGeneration: keeperTurn.workerGeneration,
    turnLaunchResolution: {
      token: keeperTurn.turnLaunchToken,
      attempt: keeperTurn.attempt,
      outcome: "spawned",
    },
    agentPid: keeperTurn.agentPid,
    agentStartedAt: keeperTurn.agentStartedAt,
    agentRuntimePid: keeperTurn.agentRuntimePid,
    agentRuntimeStartedAt: keeperTurn.agentRuntimeStartedAt,
    turnKeeperStatus: "retired",
    turnKeeperCleanupRequestedAt: 20_000,
    turnKeeperCleanupConfirmedAt: 20_100,
    turnKeeperCleanupError: null,
    turnLaunchFinalizationUncertain: false,
  });

  it("accepts exact durable keeper retirement after a lost response", () => {
    expect(hasDurableKeeperTurnRetirement(retiredState, keeperTurn)).toBe(true);
  });

  it.each([
    ["worker generation", { workerGeneration: "worker-generation-2" }],
    [
      "turn token",
      {
        turnLaunchResolution: {
          ...retiredState.turnLaunchResolution,
          token: "turn-token-2",
        },
      },
    ],
    [
      "turn attempt",
      {
        turnLaunchResolution: {
          ...retiredState.turnLaunchResolution,
          attempt: keeperTurn.attempt + 1,
        },
      },
    ],
    ["wrapper pid", { agentPid: keeperTurn.agentPid + 1 }],
    ["runtime pid", { agentRuntimePid: keeperTurn.agentRuntimePid + 1 }],
    ["wrapper start", { agentStartedAt: keeperTurn.agentStartedAt + 1 }],
    [
      "runtime start",
      { agentRuntimeStartedAt: keeperTurn.agentRuntimeStartedAt + 1 },
    ],
    ["unconfirmed cleanup", { turnKeeperCleanupConfirmedAt: null }],
    ["cleanup error", { turnKeeperCleanupError: "tree still executable" }],
    ["uncertain launch", { turnLaunchFinalizationUncertain: true }],
  ])("rejects retired state with mismatched %s", (_label, patch) => {
    expect(
      hasDurableKeeperTurnRetirement({ ...retiredState, ...patch }, keeperTurn),
    ).toBe(false);
  });

  it("does not hold the PID commit transaction through native spawn", () => {
    const order = [];
    const child = { pid: 4321 };
    const result = spawnTurnAfterDurableIntent({
      now: () => 1234,
      spawnTurn() {
        order.push("native-spawn");
        return child;
      },
      commitSpawn(spawned, startedAt) {
        order.push("pid-commit");
        expect(spawned).toBe(child);
        expect(startedAt).toBe(1234);
        return { applied: true, state: { agentPid: spawned.pid } };
      },
    });

    expect(order).toEqual(["native-spawn", "pid-commit"]);
    expect(result).toMatchObject({
      committed: true,
      spawned: child,
      agentStartedAt: 1234,
      error: null,
    });
  });

  it("retains the blocked child when stop wins before PID commit", () => {
    const child = { pid: 7654 };
    const result = spawnTurnAfterDurableIntent({
      spawnTurn: () => child,
      commitSpawn: () => ({ applied: false, state: { stopRequestedAt: 1 } }),
    });

    expect(result.committed).toBe(false);
    expect(result.spawned).toBe(child);
    expect(result.error.message).toMatch(/stopped before PID commit/u);
  });

  it("retains a partially spawned child when native spawn throws", () => {
    const child = { pid: 8765 };
    const error = Object.assign(new Error("spawn finalization failed"), {
      spawnedProcess: child,
    });
    const commitSpawn = vi.fn();
    const result = spawnTurnAfterDurableIntent({
      spawnTurn() {
        throw error;
      },
      commitSpawn,
    });

    expect(result).toMatchObject({
      committed: false,
      spawned: child,
      error,
    });
    expect(commitSpawn).not.toHaveBeenCalled();
  });

  it("retains the blocked child when the PID commit transaction throws", () => {
    const child = { pid: 9876 };
    const error = new Error("state lock unavailable");
    const result = spawnTurnAfterDurableIntent({
      spawnTurn: () => child,
      commitSpawn() {
        throw error;
      },
    });

    expect(result).toMatchObject({
      committed: false,
      spawned: child,
      error,
    });
  });

  it("commits the actual runtime pid before releasing pre-main execution", async () => {
    const child = new EventEmitter();
    const sent = [];
    child.send = vi.fn((message, callback) => {
      sent.push(message);
      callback?.(null);
    });
    let finishDurableCommit;
    const commitReady = vi.fn(
      () =>
        new Promise((resolve) => {
          finishDurableCommit = resolve;
        }),
    );
    const onFailure = vi.fn();
    attachTurnChildBootstrapRelease(
      child,
      { nonce: "nonce-1", workerGeneration: "generation-1", attempt: 2 },
      commitReady,
      onFailure,
    );

    const ready = {
      type: BACKGROUND_TURN_BOOTSTRAP_READY,
      protocolVersion: BACKGROUND_TURN_BOOTSTRAP_PROTOCOL_VERSION,
      nonce: "nonce-1",
      workerGeneration: "generation-1",
      attempt: 2,
      pid: 4321,
    };
    child.emit("message", ready);
    child.emit("message", ready);

    await vi.waitFor(() => expect(commitReady).toHaveBeenCalledOnce());
    expect(sent).toEqual([]);
    finishDurableCommit(true);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    child.emit("message", ready);
    await vi.waitFor(() => expect(sent).toHaveLength(2));

    expect(commitReady).toHaveBeenCalledOnce();
    expect(commitReady).toHaveBeenCalledWith({
      nonce: "nonce-1",
      workerGeneration: "generation-1",
      attempt: 2,
      pid: 4321,
    });
    expect(sent).toEqual([
      {
        type: BACKGROUND_TURN_BOOTSTRAP_RELEASE,
        protocolVersion: BACKGROUND_TURN_BOOTSTRAP_PROTOCOL_VERSION,
        nonce: "nonce-1",
        workerGeneration: "generation-1",
        attempt: 2,
        pid: 4321,
      },
      {
        type: BACKGROUND_TURN_BOOTSTRAP_RELEASE,
        protocolVersion: BACKGROUND_TURN_BOOTSTRAP_PROTOCOL_VERSION,
        nonce: "nonce-1",
        workerGeneration: "generation-1",
        attempt: 2,
        pid: 4321,
      },
    ]);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("fails closed without release when the runtime pid commit is rejected", async () => {
    const child = new EventEmitter();
    child.send = vi.fn();
    const onFailure = vi.fn();
    attachTurnChildBootstrapRelease(
      child,
      { nonce: "nonce-2", workerGeneration: "generation-2", attempt: 3 },
      () => false,
      onFailure,
    );
    child.emit("message", {
      type: BACKGROUND_TURN_BOOTSTRAP_READY,
      protocolVersion: BACKGROUND_TURN_BOOTSTRAP_PROTOCOL_VERSION,
      nonce: "nonce-2",
      workerGeneration: "generation-2",
      attempt: 3,
      pid: 7654,
    });
    await vi.waitFor(() => expect(onFailure).toHaveBeenCalledOnce());
    expect(child.send).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure.mock.calls[0][0].message).toMatch(/commit was rejected/u);
  });

  it("ignores a late release EPIPE after an intentional bootstrap detach", async () => {
    const child = new EventEmitter();
    let finishSend;
    child.send = vi.fn((_message, callback) => {
      finishSend = callback;
    });
    const onFailure = vi.fn();
    const detach = attachTurnChildBootstrapRelease(
      child,
      { nonce: "nonce-stop", workerGeneration: "generation-stop", attempt: 1 },
      () => true,
      onFailure,
    );
    child.emit("message", {
      type: BACKGROUND_TURN_BOOTSTRAP_READY,
      protocolVersion: BACKGROUND_TURN_BOOTSTRAP_PROTOCOL_VERSION,
      nonce: "nonce-stop",
      workerGeneration: "generation-stop",
      attempt: 1,
      pid: 8765,
    });
    await vi.waitFor(() => expect(child.send).toHaveBeenCalledOnce());

    detach();
    finishSend(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));

    expect(onFailure).not.toHaveBeenCalled();
  });

  it("settles error followed by close even when exit is never emitted", () => {
    const child = new EventEmitter();
    const settlementOrder = [];
    const settle = vi.fn((outcome) => {
      settlementOrder.push("final-sweep");
      expect(outcome).toMatchObject({
        source: "close",
        code: 1,
        signal: null,
        errorMessage: "child channel failed",
      });
      settlementOrder.push("finalize");
    });
    attachTurnChildTerminationSettlement(child, settle);

    const error = new Error("child channel failed");
    child.emit("error", error);
    expect(settle).not.toHaveBeenCalled();

    child.emit("close", null, null);
    expect(settle).toHaveBeenCalledOnce();
    expect(settle.mock.calls[0][0].error).toBe(error);
    expect(settlementOrder).toEqual(["final-sweep", "finalize"]);

    // A synthetic late exit cannot repeat the shared final sweep/finalize path.
    child.emit("exit", 0, null);
    expect(settle).toHaveBeenCalledOnce();
  });

  it("settles the ordinary exit then close sequence exactly once", () => {
    const child = new EventEmitter();
    const settle = vi.fn();
    attachTurnChildTerminationSettlement(child, settle);

    child.emit("exit", 0, null);
    child.emit("close", 0, null);

    expect(settle).toHaveBeenCalledOnce();
    expect(settle).toHaveBeenCalledWith({
      source: "exit",
      code: 0,
      signal: null,
      error: null,
      errorMessage: null,
    });
  });

  it("delivers a durable answer when worker-state cleanup fails", () => {
    const cleanupError = new Error("state projection write failed");
    const durableAnswer = { approved: true };
    let deliveredAnswer = null;
    const recordCleanupFailure = vi.fn(() => {
      throw new Error("diagnostic projection also unavailable");
    });
    const detachAbort = vi.fn();

    const result = deliverAfterDurableInteractionCleanup({
      cleanupProjection() {
        throw cleanupError;
      },
      recordCleanupFailure,
      detachAbort,
      deliver() {
        deliveredAnswer = durableAnswer;
      },
    });

    expect(result.cleanupError).toBe(cleanupError);
    expect(recordCleanupFailure).toHaveBeenCalledOnce();
    expect(recordCleanupFailure).toHaveBeenCalledWith(cleanupError);
    expect(detachAbort).toHaveBeenCalledOnce();
    expect(deliveredAnswer).toBe(durableAnswer);
  });
});
