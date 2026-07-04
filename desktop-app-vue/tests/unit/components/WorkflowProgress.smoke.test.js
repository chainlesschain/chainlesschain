import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./workflowProgressUtils` import. Helpers are covered by
// workflowProgressUtils.test.js. The status computeds + toggle* handlers stay
// in the SFC (they read/mutate reactive refs).
import WorkflowProgress from "@renderer/components/workflow/WorkflowProgress.vue";

describe("WorkflowProgress.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(WorkflowProgress).toBeTruthy();
    expect(typeof WorkflowProgress).toBe("object");
  });
});
