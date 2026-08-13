import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  attachTurnChildTerminationSettlement,
  deliverAfterDurableInteractionCleanup,
} from "../../src/workers/background-agent-worker.js";

describe("background agent worker child termination settlement", () => {
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
