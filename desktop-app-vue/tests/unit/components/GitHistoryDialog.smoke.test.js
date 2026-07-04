import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./gitHistoryDialogUtils` import (which now owns date-fns).
// Helpers are covered by gitHistoryDialogUtils.test.js. Icon getters stay.
import GitHistoryDialog from "@renderer/components/projects/GitHistoryDialog.vue";

describe("GitHistoryDialog.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(GitHistoryDialog).toBeTruthy();
    expect(typeof GitHistoryDialog).toBe("object");
  });
});
