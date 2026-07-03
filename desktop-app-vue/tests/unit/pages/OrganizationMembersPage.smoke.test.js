import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./organizationMembersPageUtils` import. Helpers are covered by
// organizationMembersPageUtils.test.js.
import OrganizationMembersPage from "@renderer/pages/OrganizationMembersPage.vue";

describe("OrganizationMembersPage.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(OrganizationMembersPage).toBeTruthy();
    expect(typeof OrganizationMembersPage).toBe("object");
  });
});
