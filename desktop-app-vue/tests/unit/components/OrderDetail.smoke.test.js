import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./orderDetailUtils` import. Helpers are covered by
// orderDetailUtils.test.js.
import OrderDetail from "@renderer/components/trade/OrderDetail.vue";

describe("OrderDetail.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(OrderDetail).toBeTruthy();
    expect(typeof OrderDetail).toBe("object");
  });
});
