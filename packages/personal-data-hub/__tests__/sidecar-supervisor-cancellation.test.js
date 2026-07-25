"use strict";

import { describe, expect, it, vi } from "vitest";

const { SidecarAbortError, SidecarSupervisor } = require("../lib/sidecar");

function makeHarness() {
  const writes = [];
  const supervisor = new SidecarSupervisor({
    command: "unused-in-unit-test",
    healthCheckIntervalMs: 0,
  });
  supervisor._proc = {
    killed: false,
    stdin: {
      destroyed: false,
      write(line, _encoding, callback) {
        writes.push(JSON.parse(line));
        callback();
      },
    },
  };
  return { supervisor, writes };
}

describe("SidecarSupervisor cancellation", () => {
  it("rejects a pre-aborted invoke without writing a request", async () => {
    const { supervisor, writes } = makeHarness();
    const controller = new AbortController();
    const reason = new Error("caller already stopped");
    controller.abort(reason);

    await expect(
      supervisor.invoke("slow.method", {}, { signal: controller.signal }),
    ).rejects.toMatchObject({
      name: "AbortError",
      code: "ABORT_ERR",
      cause: reason,
    });
    expect(writes).toEqual([]);
    expect(supervisor._pending.size).toBe(0);
  });

  it("sends request.cancel and rejects promptly when AbortSignal fires", async () => {
    const { supervisor, writes } = makeHarness();
    const controller = new AbortController();
    const reason = new Error("user cancelled");
    const invocation = supervisor.invoke(
      "slow.method",
      { value: 1 },
      { signal: controller.signal, timeoutMs: 30_000 },
    );

    await vi.waitFor(() => expect(writes).toHaveLength(1));
    const requestId = writes[0].id;
    controller.abort(reason);

    await expect(invocation).rejects.toMatchObject({
      name: "AbortError",
      code: "ABORT_ERR",
      cause: reason,
    });
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toMatchObject({
      method: "request.cancel",
      params: { id: requestId },
    });
    expect(supervisor._pending.size).toBe(0);
  });

  it("aborting one concurrent invoke does not disconnect another", async () => {
    const { supervisor, writes } = makeHarness();
    const controller = new AbortController();
    const first = supervisor.invoke(
      "slow.first",
      {},
      { signal: controller.signal },
    );
    const second = supervisor.invoke("fast.second");

    await vi.waitFor(() => expect(writes).toHaveLength(2));
    const firstId = writes.find((entry) => entry.method === "slow.first").id;
    const secondId = writes.find((entry) => entry.method === "fast.second").id;
    controller.abort();

    await expect(first).rejects.toBeInstanceOf(SidecarAbortError);
    supervisor._handleEnvelope({
      id: secondId,
      type: "result",
      data: { ok: true },
    });
    await expect(second).resolves.toEqual({ ok: true });

    const orphans = [];
    supervisor.on("orphan", (envelope) => orphans.push(envelope));
    supervisor._handleEnvelope({
      id: firstId,
      type: "result",
      data: { tooLate: true },
    });
    expect(orphans).toEqual([
      {
        id: firstId,
        type: "result",
        data: { tooLate: true },
      },
    ]);
    expect(supervisor._pending.size).toBe(0);
  });
});
