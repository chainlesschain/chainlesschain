import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./systemSettingsUtils` import. A full mount is avoided — this
// page has 17 config tabs + pane subcomponents + onMounted config loading; the
// deepMerge helper is covered by systemSettingsUtils.test.js.
import SystemSettings from "@renderer/pages/settings/SystemSettings.vue";

describe("SystemSettings.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(SystemSettings).toBeTruthy();
    expect(typeof SystemSettings).toBe("object");
  });
});
