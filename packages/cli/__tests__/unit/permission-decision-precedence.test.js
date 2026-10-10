import { describe, expect, it } from "vitest";
import { buildPermissionDecision } from "../../src/lib/permission-decision.js";

describe("PermissionDecision policy precedence", () => {
  it.each([
    ["deny", "allow"],
    ["allow", "deny"],
  ])(
    "reports policy %s when approval and the terminal chain say %s",
    (policyDecision, approvalDecision) => {
      const record = buildPermissionDecision({
        toolUseId: "tu-conflict",
        tool: "run_shell",
        result: {
          policy: {
            decision: policyDecision,
            via: "managed-policy",
            reason: "authoritative policy result",
          },
          approval: {
            decision: approvalDecision,
            via: "approval-gate",
            reason: "conflicting approval result",
          },
          permissionChain: [
            { layer: "approval-gate", outcome: approvalDecision },
          ],
        },
      });

      // This protocol record explains the runtime result; it must not replace
      // an explicit policy outcome with a conflicting approval outcome.
      expect(record).toMatchObject({
        id: "tu-conflict:perm:managed-policy",
        decision: policyDecision,
        via: "managed-policy",
        reason: "authoritative policy result",
      });
      expect(record.chain[0].outcome).toBe(approvalDecision);
    },
  );
});
