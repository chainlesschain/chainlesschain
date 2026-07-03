import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./taskDetailUtils` import. Helpers are covered by
// taskDetailUtils.test.js.
import TaskDetail from "@renderer/components/task/TaskDetail.vue";

describe("TaskDetail.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(TaskDetail).toBeTruthy();
    expect(typeof TaskDetail).toBe("object");
  });
});
