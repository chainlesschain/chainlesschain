import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./teamDetailPanelUtils` import (which owns the date-fns
// dependency now). Helpers are covered by teamDetailPanelUtils.test.js.
import TeamDetailPanel from "@renderer/components/cowork/TeamDetailPanel.vue";

describe("TeamDetailPanel.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(TeamDetailPanel).toBeTruthy();
    expect(typeof TeamDetailPanel).toBe("object");
  });
});
