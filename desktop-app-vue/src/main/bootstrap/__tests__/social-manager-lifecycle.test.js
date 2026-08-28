import { describe, expect, it, vi } from "vitest";

const {
  MAX_MANAGER_CLOSE_TIMEOUT_MS,
  cleanupOwnedManagers,
} = require("../social-manager-lifecycle");

function createLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
  };
}

describe("social manager lifecycle", () => {
  it("fences ownership before closing managers in dependency order", async () => {
    const calls = [];
    const owner = {
      downstream: {
        close: vi.fn(async () => {
          expect(owner.downstream).toBeNull();
          calls.push("downstream");
        }),
      },
      foundation: {
        stop: vi.fn(async () => {
          expect(owner.foundation).toBeNull();
          calls.push("foundation");
        }),
      },
    };

    const outcomes = await cleanupOwnedManagers(
      owner,
      [
        ["downstream", "close"],
        ["foundation", "stop"],
      ],
      { logger: createLogger(), closeTimeoutMs: 100 },
    );

    expect(calls).toEqual(["downstream", "foundation"]);
    expect(outcomes.map(({ status }) => status)).toEqual(["closed", "closed"]);
  });

  it("isolates errors and timeout without skipping later managers", async () => {
    const logger = createLogger();
    const owner = {
      broken: { close: vi.fn(() => Promise.reject(new Error("boom"))) },
      stuck: { close: vi.fn(() => new Promise(() => {})) },
      final: { close: vi.fn() },
    };

    const outcomes = await cleanupOwnedManagers(
      owner,
      [
        ["broken", "close"],
        ["stuck", "close"],
        ["final", "close"],
      ],
      { logger, closeTimeoutMs: 5 },
    );

    expect(outcomes.map(({ status }) => status)).toEqual([
      "error",
      "timeout",
      "closed",
    ]);
    expect(owner).toEqual({ broken: null, stuck: null, final: null });
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed or unbounded lifecycle policy", async () => {
    await expect(
      cleanupOwnedManagers({}, [["manager"]], { logger: createLogger() }),
    ).rejects.toThrow(/cleanup entries/);
    await expect(
      cleanupOwnedManagers({}, [], {
        logger: createLogger(),
        closeTimeoutMs: MAX_MANAGER_CLOSE_TIMEOUT_MS + 1,
      }),
    ).rejects.toThrow(/closeTimeoutMs/);
  });
});
