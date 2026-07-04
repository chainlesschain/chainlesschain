import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./complianceDashboardPanelUtils` import. Helpers are covered
// by complianceDashboardPanelUtils.test.js.
import ComplianceDashboardPanel from "@renderer/shell/ComplianceDashboardPanel.vue";

describe("ComplianceDashboardPanel.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(ComplianceDashboardPanel).toBeTruthy();
    expect(typeof ComplianceDashboardPanel).toBe("object");
  });
});
