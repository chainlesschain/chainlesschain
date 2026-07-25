"use strict";

import { describe, expect, it, vi } from "vitest";

const { collectQqNt } = require("../../lib/adapters/qq-pc/qqnt-sidecar");

describe("qq-pc sidecar invocation", () => {
  it("forwards the AbortSignal to the supervisor invocation", async () => {
    const controller = new AbortController();
    let invokeOptions;
    const result = { messages: [] };
    const supervisor = {
      start: vi.fn().mockResolvedValue(undefined),
      invoke: vi.fn().mockImplementation(async (_method, _params, options) => {
        invokeOptions = options;
        return result;
      }),
      stop: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      collectQqNt({
        passphrase: "test-passphrase",
        signal: controller.signal,
        bridgeDir: "/unused-in-injected-test",
        _supervisorFactory: () => supervisor,
      }),
    ).resolves.toBe(result);

    expect(invokeOptions.signal).toBe(controller.signal);
    expect(supervisor.stop).toHaveBeenCalledTimes(1);
  });

  it("forwards explicit cursor pages to the Python collector", async () => {
    let invokeParams;
    const page = {
      after: { c2c: "9007199254740993", group: "9007199254740994" },
      upper: { c2c: "9007199254740995", group: "9007199254740996" },
    };
    const result = {
      messages: [],
      upperBounds: page.upper,
      hasMore: { c2c: false, group: false },
    };
    const supervisor = {
      start: vi.fn().mockResolvedValue(undefined),
      invoke: vi.fn().mockImplementation(async (_method, params) => {
        invokeParams = params;
        return result;
      }),
      stop: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      collectQqNt({
        passphrase: "test-passphrase",
        page,
        bridgeDir: "/unused-in-injected-test",
        _supervisorFactory: () => supervisor,
      }),
    ).resolves.toBe(result);

    expect(invokeParams.page).toEqual(page);
    expect(supervisor.stop).toHaveBeenCalledTimes(1);
  });

  it("rethrows abort errors without trying another Python candidate", async () => {
    const abortError = Object.assign(new Error("collection aborted"), {
      name: "AbortError",
      code: "ABORT_ERR",
    });
    let factoryCalls = 0;
    const supervisor = {
      start: vi.fn().mockResolvedValue(undefined),
      invoke: vi.fn().mockRejectedValue(abortError),
      stop: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      collectQqNt({
        passphrase: "test-passphrase",
        bridgeDir: "/unused-in-injected-test",
        _supervisorFactory: () => {
          factoryCalls += 1;
          return supervisor;
        },
      }),
    ).rejects.toBe(abortError);

    expect(factoryCalls).toBe(1);
    expect(supervisor.invoke).toHaveBeenCalledTimes(1);
    expect(supervisor.stop).toHaveBeenCalledTimes(1);
  });
});
