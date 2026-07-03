import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./commandLogsPageUtils` import. Helpers are covered by
// commandLogsPageUtils.test.js. dayjs stays in the SFC (used by the chart path).
import CommandLogsPage from "@renderer/pages/CommandLogsPage.vue";

describe("CommandLogsPage.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(CommandLogsPage).toBeTruthy();
    expect(typeof CommandLogsPage).toBe("object");
  });
});
