import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  DEFAULT_MTC_RUNTIME_LIMITS,
  jsonBytesWithinLimit,
  resolveMtcRuntimeLimits,
  waitForTasksBounded,
} = require("../mtc-runtime-boundaries.js");
const { MtcFederationManager } = require("../mtc-federation-manager.js");
const { ChannelEventBatcher } = require("../channel-event-batch.js");

describe("MTC runtime boundaries", () => {
  it("resolves strict positive limits and rejects unknown or oversized values", () => {
    expect(resolveMtcRuntimeLimits()).toEqual(DEFAULT_MTC_RUNTIME_LIMITS);
    expect(() => resolveMtcRuntimeLimits({ maxInboundTasks: 0 })).toThrow(
      RangeError,
    );
    expect(() =>
      resolveMtcRuntimeLimits({ maxPayloadBytes: 5 * 1024 ** 2 }),
    ).toThrow(RangeError);
    expect(() => resolveMtcRuntimeLimits({ typo: 1 })).toThrow(TypeError);
  });

  it("admits JSON by UTF-8 bytes and rejects oversized payloads", () => {
    expect(jsonBytesWithinLimit({ value: "好" }, 32).bytes).toBeGreaterThan(0);
    expect(() => jsonBytesWithinLimit({ value: "好".repeat(32) }, 32)).toThrow(
      RangeError,
    );
  });

  it("bounds federation subscriptions and unregisters them during close", async () => {
    const unhook = vi.fn();
    const transport = {
      subscribeRaw: vi.fn(() => unhook),
      publishRaw: vi.fn(),
      peerIdString: vi.fn(() => "peer"),
      multiaddrs: vi.fn(() => []),
      close: vi.fn(async () => {}),
    };
    const manager = new MtcFederationManager({
      limits: { maxSubscriptions: 1 },
      transportFactory: async () => transport,
    });
    await manager.initialize();
    await manager.subscribeCommunity("one", () => {});
    await expect(manager.subscribeCommunity("two", () => {})).rejects.toThrow(
      /subscription limit/,
    );
    await manager.close();
    expect(unhook).toHaveBeenCalledOnce();
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it("bounds batch-close listener ownership", () => {
    const batcher = new ChannelEventBatcher({
      rootDir: path.join(process.cwd(), ".mtc-boundary-unused"),
      getCurrentIdentity: () => ({}),
      limits: { maxBatchClosedHandlers: 1 },
    });
    batcher.onBatchClosed(() => {});
    expect(() => batcher.onBatchClosed(() => {})).toThrow(/capacity/);
    batcher.close();
  });

  it("reports a completed bounded task drain", async () => {
    await expect(
      waitForTasksBounded(new Set([Promise.resolve()]), 50),
    ).resolves.toEqual({ timedOut: false });
  });

  it("keeps active MTC owners on the shared boundary adapter", () => {
    const current = path.dirname(fileURLToPath(import.meta.url));
    for (const file of [
      "channel-event-batch.js",
      "channel-envelope-distribution.js",
      "mtc-federation-manager.js",
      "auto-archive-scheduler.js",
    ]) {
      const source = fs.readFileSync(path.join(current, "..", file), "utf8");
      expect(source).toContain("resolveMtcRuntimeLimits");
    }
  });
});
