import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./orderCardUtils` import. Helpers are covered by
// orderCardUtils.test.js. getAssetIcon stays in the SFC.
import OrderCard from "@renderer/components/trade/common/OrderCard.vue";

describe("OrderCard.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(OrderCard).toBeTruthy();
    expect(typeof OrderCard).toBe("object");
  });
});
