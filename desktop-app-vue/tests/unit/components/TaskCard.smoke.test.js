import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./taskCardUtils` import. Helpers are covered by
// taskCardUtils.test.js. getAvatarText / getAssignedUserName / getDueDateTooltip
// stay in the SFC (they read the reactive workspace store / props).
import TaskCard from "@renderer/components/task/TaskCard.vue";

describe("TaskCard.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(TaskCard).toBeTruthy();
    expect(typeof TaskCard).toBe("object");
  });
});
