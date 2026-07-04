import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./taskDetailPanelUtils` import. Helpers are covered by
// taskDetailPanelUtils.test.js.
import TaskDetailPanel from "@renderer/components/cowork/TaskDetailPanel.vue";

describe("TaskDetailPanel.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(TaskDetailPanel).toBeTruthy();
    expect(typeof TaskDetailPanel).toBe("object");
  });
});
