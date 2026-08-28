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

  it("lists stable review records and revokes turn or session grants", () => {
    const ledger = new ApprovalGrantLedger({
      sessionId: "session-1",
      now: () => NOW,
    });
    ledger.beginTurn("turn-1");
    const turnPermission = permission("npm test");
    const sessionPermission = permission("npm run build");
    ledger.applyDecision({ kind: "acceptForTurn" }, turnPermission, "ab_turn");
    ledger.applyDecision(
      { kind: "acceptForSession" },
      sessionPermission,
      "ab_session",
    );

    const grants = ledger.listGrants();
    expect(grants).toHaveLength(2);
    expect(grants.map((grant) => grant.lifetime).sort()).toEqual([
      "session",
      "turn",
    ]);
    expect(grants.every((grant) => grant.grantId.startsWith("grant_"))).toBe(
      true,
    );

    const turnGrant = grants.find((grant) => grant.lifetime === "turn");
    const sessionGrant = grants.find((grant) => grant.lifetime === "session");
    expect(ledger.revoke(turnGrant.grantId)).toMatchObject({
      revoked: true,
      persistedScope: false,
    });
    expect(ledger.allows(turnPermission)).toBe(false);
    const revision = ledger.revision;
    expect(ledger.revoke(sessionGrant.grantId)).toMatchObject({
      revoked: true,
      persistedScope: true,
    });
    expect(ledger.revision).toBe(revision + 1);
    expect(ledger.allows(sessionPermission)).toBe(false);
  });
});
