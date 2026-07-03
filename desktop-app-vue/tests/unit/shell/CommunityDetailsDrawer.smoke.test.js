import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./communityDetailsDrawerUtils` import. A full mount is avoided
// — this drawer wires the communityQuick store + antd Modal; the helpers are
// covered by communityDetailsDrawerUtils.test.js and the util-import-exposure
// pattern is proven by the MarketPage/OrganizationKnowledgePage suites.
import CommunityDetailsDrawer from "@renderer/shell/community/CommunityDetailsDrawer.vue";

describe("CommunityDetailsDrawer.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(CommunityDetailsDrawer).toBeTruthy();
    expect(typeof CommunityDetailsDrawer).toBe("object");
  });
});
