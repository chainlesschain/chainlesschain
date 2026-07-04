import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./enterpriseAuditPanelUtils` import (which now owns dayjs).
// Helpers are covered by enterpriseAuditPanelUtils.test.js.
import EnterpriseAuditPanel from "@renderer/shell/EnterpriseAuditPanel.vue";

describe("EnterpriseAuditPanel.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(EnterpriseAuditPanel).toBeTruthy();
    expect(typeof EnterpriseAuditPanel).toBe("object");
  });
});
