import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./assetDetailUtils` import. Helpers are covered by
// assetDetailUtils.test.js. getAssetIcon + isCurrentUser stay in the SFC.
import AssetDetail from "@renderer/components/trade/AssetDetail.vue";

describe("AssetDetail.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(AssetDetail).toBeTruthy();
    expect(typeof AssetDetail).toBe("object");
  });
});
