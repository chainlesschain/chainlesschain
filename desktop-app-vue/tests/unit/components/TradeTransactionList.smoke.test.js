import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./transactionListUtils` import. Helpers are covered by
// tradeTransactionListUtils.test.js. isCurrentUser stays in the SFC (props).
import TransactionList from "@renderer/components/trade/TransactionList.vue";

describe("trade/TransactionList.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(TransactionList).toBeTruthy();
    expect(typeof TransactionList).toBe("object");
  });
});
