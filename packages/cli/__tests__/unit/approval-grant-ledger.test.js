import { describe, expect, it } from "vitest";
import {
  APPROVAL_GRANTS_SCHEMA,
  ApprovalGrantLedger,
  approvalPermissionForContext,
} from "../../src/lib/approval-grant-ledger.js";

const NOW = Date.parse("2026-08-25T00:00:00.000Z");

function permission(command = "npm test", cwd = "C:/repo") {
  return approvalPermissionForContext({ tool: "run_shell", command }, { cwd });
}

describe("ApprovalGrantLedger", () => {
  it("reuses only the exact tool, args and cwd within one turn", () => {
    const ledger = new ApprovalGrantLedger({
      sessionId: "session-1",
      now: () => NOW,
    });
    ledger.beginTurn("turn-1");
    const required = permission();
    const applied = ledger.applyDecision(
      { kind: "acceptForTurn", permissions: [required] },
      required,
      "ab_binding",
    );
    expect(applied.decision).toEqual({
      kind: "acceptForTurn",
      permissions: [required],
    });
    expect(ledger.allows(required)).toBe(true);
    expect(ledger.allows(permission("npm publish"))).toBe(false);
    expect(ledger.allows(permission("npm test", "C:/other"))).toBe(false);
    expect(
      ledger.allows(
        approvalPermissionForContext(
          { tool: "run_shell", command: "npm test", riskLevel: "high" },
          { cwd: "C:/repo" },
        ),
      ),
    ).toBe(false);
    ledger.beginTurn("turn-2");
    expect(ledger.allows(required)).toBe(false);
  });

  it("persists session grants and restores only a matching verified shape", () => {
    const ledger = new ApprovalGrantLedger({
      sessionId: "session-1",
      now: () => NOW,
    });
    const required = permission();
    const applied = ledger.applyDecision(
      { kind: "acceptForSession" },
      required,
      "ab_binding",
    );
    expect(applied.persistedScope).toBe(true);
    expect(applied.decision.permissions).toEqual([required]);
    const saved = ledger.toJSON();
    expect(saved).toMatchObject({
      schema: APPROVAL_GRANTS_SCHEMA,
      sessionId: "session-1",
      revision: 1,
    });
    const restored = ApprovalGrantLedger.fromJSON(saved, {
      sessionId: "session-1",
      now: () => NOW,
    });
    expect(restored.allows(required)).toBe(true);
    expect(() =>
      ApprovalGrantLedger.fromJSON(
        { ...saved, sessionId: "different-session" },
        { sessionId: "session-1", now: () => NOW },
      ),
    ).toThrow(/invalid persisted approval grant ledger/u);
  });

  it("drops expired grants and clamps broader requested permissions", () => {
    const ledger = new ApprovalGrantLedger({
      sessionId: "session-1",
      now: () => NOW,
    });
    const required = permission();
    const broader = permission("npm *");
    const applied = ledger.applyDecision(
      {
        kind: "acceptForSession",
        permissions: [broader],
      },
      required,
      "ab_binding",
    );
    expect(applied.decision.permissions).toEqual([]);
    expect(ledger.allows(required)).toBe(false);

    const expired = {
      ...required,
      expiresAt: "2026-08-24T00:00:00.000Z",
    };
    expect(
      ledger.applyDecision(
        { kind: "acceptForSession", permissions: [expired] },
        expired,
        "ab_binding",
      ).granted,
    ).toEqual([]);
  });
});
