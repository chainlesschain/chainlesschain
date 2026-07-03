import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./vcManagementUtils` import. Helpers are covered by
// vcManagementUtils.test.js; the util-import-exposure pattern is proven by the
// MarketPage/OrganizationKnowledgePage component suites.
import VCManagement from "@renderer/components/VCManagement.vue";

describe("VCManagement.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(VCManagement).toBeTruthy();
    expect(typeof VCManagement).toBe("object");
  });
});
