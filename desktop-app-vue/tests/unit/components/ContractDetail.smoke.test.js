import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./contractDetailUtils` import. Helpers are covered by
// contractDetailUtils.test.js. getEventIcon intentionally stays in the SFC.
import ContractDetail from "@renderer/components/trade/ContractDetail.vue";

describe("ContractDetail.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(ContractDetail).toBeTruthy();
    expect(typeof ContractDetail).toBe("object");
  });
});
