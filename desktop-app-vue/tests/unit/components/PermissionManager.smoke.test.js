import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./permissionManagerUtils` import. Helpers are covered by
// permissionManagerUtils.test.js. Role/permission predicates that read the
// reactive `roles` ref stay in the SFC.
import PermissionManager from "@renderer/components/organization/PermissionManager.vue";

describe("PermissionManager.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(PermissionManager).toBeTruthy();
    expect(typeof PermissionManager).toBe("object");
  });
});
