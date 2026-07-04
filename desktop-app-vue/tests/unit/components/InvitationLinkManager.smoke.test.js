import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./invitationLinkManagerUtils` import (which now owns the
// dayjs + relativeTime + zh-cn setup). Helpers are covered by
// invitationLinkManagerUtils.test.js.
import InvitationLinkManager from "@renderer/components/organization/InvitationLinkManager.vue";

describe("InvitationLinkManager.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(InvitationLinkManager).toBeTruthy();
    expect(typeof InvitationLinkManager).toBe("object");
  });
});
