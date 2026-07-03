import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./transactionTimelineUtils` import. Helpers are covered by
// transactionTimelineUtils.test.js. getTimelineIcon stays in the SFC.
import TransactionTimeline from "@renderer/components/trade/common/TransactionTimeline.vue";

describe("TransactionTimeline.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(TransactionTimeline).toBeTruthy();
    expect(typeof TransactionTimeline).toBe("object");
  });
});
