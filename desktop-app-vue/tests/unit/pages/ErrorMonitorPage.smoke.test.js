import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./errorMonitorPageUtils` import. A full mount is avoided — this
// page's onMounted loads stats + inits echarts + polls; the helpers are covered
// by errorMonitorPageUtils.test.js and the util-import-exposure pattern is
// proven by the MarketPage/OrganizationKnowledgePage component suites.
import ErrorMonitorPage from "@renderer/pages/ErrorMonitorPage.vue";

describe("ErrorMonitorPage.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(ErrorMonitorPage).toBeTruthy();
    expect(typeof ErrorMonitorPage).toBe("object");
  });
});
