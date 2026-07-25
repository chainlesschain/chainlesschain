"use strict";

import { describe, expect, it } from "vitest";

const {
  PythonSidecarAdapter,
} = require("../lib/adapters/_python-sidecar-base");

class CancelAwareAdapter extends PythonSidecarAdapter {
  async _runSidecar(opts, emit) {
    this.runSignal = opts.signal;
    this.emit = emit;
    emit({ entityType: "event", payload: { id: "first" } });
    await new Promise((resolve, reject) => {
      opts.signal.addEventListener("abort", () => reject(opts.signal.reason), {
        once: true,
      });
    });
  }
}

class WaitingAdapter extends PythonSidecarAdapter {
  async _runSidecar(opts) {
    this.runSignal = opts.signal;
    await new Promise((resolve, reject) => {
      opts.signal.addEventListener("abort", () => reject(opts.signal.reason), {
        once: true,
      });
    });
  }
}

function unusedSupervisor() {
  return {
    invoke() {
      throw new Error("not used by this unit test");
    },
  };
}

describe("PythonSidecarAdapter cancellation", () => {
  it("consumer return aborts the producer and drops late queue writes", async () => {
    const adapter = new CancelAwareAdapter({
      supervisor: unusedSupervisor(),
    });
    const iterator = adapter.sync();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { payload: { id: "first" } },
    });
    await expect(iterator.return()).resolves.toEqual({
      done: true,
      value: undefined,
    });

    expect(adapter.runSignal.aborted).toBe(true);
    expect(adapter.runSignal.reason).toMatchObject({
      name: "AbortError",
      code: "ABORT_ERR",
    });
    expect(adapter.emit({ payload: { id: "late" } })).toBe(false);
  });

  it("external AbortSignal wakes a waiting consumer and reaches the producer", async () => {
    const adapter = new WaitingAdapter({ supervisor: unusedSupervisor() });
    const controller = new AbortController();
    const reason = new Error("registry stopped");
    const next = adapter.sync({ signal: controller.signal }).next();

    controller.abort(reason);

    await expect(next).rejects.toMatchObject({
      name: "AbortError",
      code: "ABORT_ERR",
      cause: reason,
    });
    expect(adapter.runSignal.aborted).toBe(true);
    expect(adapter.runSignal.reason).toBe(reason);
  });

  it("consumer return does not wait for a producer that ignores cancellation", async () => {
    class NonCooperativeAdapter extends PythonSidecarAdapter {
      async _runSidecar(_opts, emit) {
        this.emit = emit;
        emit({ entityType: "event", payload: { id: "first" } });
        await new Promise(() => {});
      }
    }

    const adapter = new NonCooperativeAdapter({
      supervisor: unusedSupervisor(),
    });
    const iterator = adapter.sync();
    await iterator.next();

    const outcome = await Promise.race([
      iterator.return().then(() => "returned"),
      new Promise((resolve) => setTimeout(() => resolve("timed-out"), 100)),
    ]);

    expect(outcome).toBe("returned");
    expect(adapter.emit({ payload: { id: "late" } })).toBe(false);
  });
});
