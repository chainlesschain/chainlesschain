import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: guards ContractList after removing 7 dead display
// helpers (getStatusColor/getStatusName/getType*/getEscrowType*/formatTime —
// referenced nowhere in the SFC). Proves the component still compiles.
import ContractList from "@renderer/components/trade/ContractList.vue";

describe("ContractList.vue (compile smoke, post-dead-code-removal)", () => {
  it("compiles after dead helper removal", () => {
    expect(ContractList).toBeTruthy();
    expect(typeof ContractList).toBe("object");
  });
});
