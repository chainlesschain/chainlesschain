import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./organizationActivityLogPageUtils` import (which now owns the
// dayjs relativeTime + zh-cn setup). Helpers are covered by the util test.
// getActorName/getActorAvatar stay in the SFC.
import OrganizationActivityLogPage from "@renderer/pages/OrganizationActivityLogPage.vue";

describe("OrganizationActivityLogPage.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(OrganizationActivityLogPage).toBeTruthy();
    expect(typeof OrganizationActivityLogPage).toBe("object");
  });
});
