import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./recordingPanelUtils` import. Helpers are covered by
// recordingPanelUtils.test.js.
import RecordingPanel from "@renderer/components/browser/RecordingPanel.vue";

describe("RecordingPanel.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(RecordingPanel).toBeTruthy();
    expect(typeof RecordingPanel).toBe("object");
  });
});
