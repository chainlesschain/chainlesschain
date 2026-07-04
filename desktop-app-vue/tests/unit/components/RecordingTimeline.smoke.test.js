import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./recordingTimelineUtils` import. Helpers are covered by
// recordingTimelineUtils.test.js. getEventTooltip stays in the SFC and calls
// the imported truncate; getEventIcon returns ant components (stays).
import RecordingTimeline from "@renderer/components/browser/recording/RecordingTimeline.vue";

describe("RecordingTimeline.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(RecordingTimeline).toBeTruthy();
    expect(typeof RecordingTimeline).toBe("object");
  });
});
