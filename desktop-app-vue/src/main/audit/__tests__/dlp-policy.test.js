// @vitest-environment node

/**
 * DLPPolicyManager.getActivePoliciesForChannel — fail-open regression.
 *
 * scanContent() (dlp-engine) has no try/catch and calls this method. An
 * unguarded JSON.parse(p.channels) used to throw on a single corrupt channels
 * column, propagating all the way out and making dlp:scan-content return
 * {success:false} — so content that should be BLOCK/QUARANTINE was never
 * evaluated against ANY policy (DLP silently failed OPEN).
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { DLPPolicyManager } = require("../dlp-policy.js");

describe("DLPPolicyManager.getActivePoliciesForChannel", () => {
  function mgrWith(policies) {
    const m = new DLPPolicyManager(null); // ctor doesn't touch the db
    for (const p of policies) {
      m._policies.set(p.id, p);
    }
    return m;
  }

  it("does not throw/fail-open when one policy has corrupt channels JSON", async () => {
    const mgr = mgrWith([
      { id: "good", enabled: 1, channels: JSON.stringify(["email"]) },
      { id: "corrupt", enabled: 1, channels: "{not-valid-json" },
      { id: "chat-only", enabled: 1, channels: JSON.stringify(["chat"]) },
      { id: "disabled", enabled: 0, channels: "also-corrupt[" },
    ]);

    // Before the fix this REJECTED (JSON.parse threw inside the filter).
    const result = await mgr.getActivePoliciesForChannel("email");
    const ids = result.map((p) => p.id).sort();

    // good (matches "email") + corrupt (defaulted to all-channels = fail-safe);
    // NOT chat-only (different channel) and NOT disabled.
    expect(ids).toEqual(["corrupt", "good"]);
  });

  it("treats an empty channels list as applies-to-all", async () => {
    const mgr = mgrWith([
      { id: "all", enabled: 1, channels: JSON.stringify([]) },
    ]);
    const result = await mgr.getActivePoliciesForChannel("anything");
    expect(result.map((p) => p.id)).toEqual(["all"]);
  });

  it("accepts an already-parsed channels array (non-string)", async () => {
    const mgr = mgrWith([
      { id: "arr", enabled: 1, channels: ["email", "chat"] },
    ]);
    const result = await mgr.getActivePoliciesForChannel("chat");
    expect(result.map((p) => p.id)).toEqual(["arr"]);
  });
});
