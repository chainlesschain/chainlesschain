import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./bridgeHistoryUtils` import. Helpers are covered by
// bridgeHistoryUtils.test.js. getStatusIcon + getNetworkName stay in the SFC.
import BridgeHistory from "@renderer/components/blockchain/BridgeHistory.vue";

describe("BridgeHistory.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(BridgeHistory).toBeTruthy();
    expect(typeof BridgeHistory).toBe("object");
  });
});
