import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./escrowDetailUtils` import. Helpers are covered by
// escrowDetailUtils.test.js. isCurrentUser stays in the SFC (reads a ref).
import EscrowDetail from "@renderer/components/trade/EscrowDetail.vue";

describe("EscrowDetail.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(EscrowDetail).toBeTruthy();
    expect(typeof EscrowDetail).toBe("object");
  });
});
