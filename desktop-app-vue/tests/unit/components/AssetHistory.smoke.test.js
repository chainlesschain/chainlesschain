import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./assetHistoryUtils` import. Helpers are covered by
// assetHistoryUtils.test.js. Icon getters + prop-reading predicates stay in SFC.
import AssetHistory from "@renderer/components/trade/AssetHistory.vue";

describe("AssetHistory.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(AssetHistory).toBeTruthy();
    expect(typeof AssetHistory).toBe("object");
  });
});
