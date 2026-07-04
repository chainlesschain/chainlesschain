import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./stageDetailUtils` import. Helpers are covered by
// stageDetailUtils.test.js.
import StageDetail from "@renderer/components/workflow/StageDetail.vue";

describe("StageDetail.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(StageDetail).toBeTruthy();
    expect(typeof StageDetail).toBe("object");
  });
});
