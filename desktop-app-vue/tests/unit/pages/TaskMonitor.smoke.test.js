import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./taskMonitorUtils` import. A full mount is avoided — this page
// uses the cowork store + echarts + polling; the helpers are covered by
// taskMonitorUtils.test.js and the util-import-exposure pattern is proven by the
// MarketPage/OrganizationKnowledgePage component suites.
import TaskMonitor from "@renderer/pages/TaskMonitor.vue";

describe("TaskMonitor.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(TaskMonitor).toBeTruthy();
    expect(typeof TaskMonitor).toBe("object");
  });
});
