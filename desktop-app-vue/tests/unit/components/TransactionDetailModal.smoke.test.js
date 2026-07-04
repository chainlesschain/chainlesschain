import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./transactionDetailModalUtils` import. Helpers are covered by
// transactionDetailModalUtils.test.js.
import TransactionDetailModal from "@renderer/components/blockchain/TransactionDetailModal.vue";

describe("TransactionDetailModal.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(TransactionDetailModal).toBeTruthy();
    expect(typeof TransactionDetailModal).toBe("object");
  });
});
