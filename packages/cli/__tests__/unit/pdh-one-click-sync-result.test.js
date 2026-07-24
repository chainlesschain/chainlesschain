import { describe, expect, it } from "vitest";
import { finalizeOneClickSyncReport } from "../../src/lib/personal-data-hub-wiring.js";

describe("PDH one-click sync result", () => {
  it("only exposes ok:true when the Registry SyncReport is successful", () => {
    const report = {
      adapter: "social-bilibili",
      status: "ok",
      rawCount: 2,
      entityCounts: { events: 2 },
    };
    expect(finalizeOneClickSyncReport(report)).toEqual({ ok: true, report });
  });

  it.each([
    [{ status: "unhealthy", error: "NO_INPUT" }, "NO_INPUT"],
    [{ status: "error", error: "vault write failed" }, "vault write failed"],
    [null, "registry sync returned status=invalid"],
  ])(
    "maps Registry failures to the one-click failure contract",
    (report, message) => {
      expect(finalizeOneClickSyncReport(report)).toMatchObject({
        ok: false,
        reason: "SYNC_FAILED",
        message,
        report,
      });
    },
  );
});
