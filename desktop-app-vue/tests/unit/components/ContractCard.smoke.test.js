import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./contractCardUtils` import. Helpers are covered by
// contractCardUtils.test.js. isCurrentUser + can* computeds stay in the SFC.
import ContractCard from "@renderer/components/trade/common/ContractCard.vue";

describe("ContractCard.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(ContractCard).toBeTruthy();
    expect(typeof ContractCard).toBe("object");
  });
});
