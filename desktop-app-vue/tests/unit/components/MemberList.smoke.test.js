import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./memberListUtils` import. Helpers are covered by
// memberListUtils.test.js. getMembersByRole stays in the SFC.
import MemberList from "@renderer/components/organization/MemberList.vue";

describe("MemberList.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(MemberList).toBeTruthy();
    expect(typeof MemberList).toBe("object");
  });
});
