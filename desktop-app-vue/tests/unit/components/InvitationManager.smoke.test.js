import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./invitationManagerUtils` import. Helpers are covered by
// invitationManagerUtils.test.js.
import InvitationManager from "@renderer/components/InvitationManager.vue";

describe("InvitationManager.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(InvitationManager).toBeTruthy();
    expect(typeof InvitationManager).toBe("object");
  });
});
