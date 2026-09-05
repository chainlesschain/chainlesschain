import { describe, expect, it } from "vitest";
import {
  WORKBENCH_ROLLBACK_AUTHORIZATION_SCHEMA,
  digestWorkbenchRollbackAuthorization,
  verifyWorkbenchRollbackAuthorization,
} from "../../src/lib/evolution/evolution-workbench-rollback-authorization.js";

const NOW = Date.parse("2026-09-06T00:00:00.000Z");
const plan = {
  tenantId: "tenant:rollback",
  skillName: "safe-refactor",
  planDigest: `sha256:${"1".repeat(64)}`,
  requestedBy: "human:alice",
  reason: "Revert regression.",
};
// Pure protocol tests do not authenticate signatures; the real adapter must
// separately invoke the deployment's current cryptographic verifier.
function authorization(overrides = {}) {
  const core = {
    schema: WORKBENCH_ROLLBACK_AUTHORIZATION_SCHEMA,
    ...plan,
    automated: false,
    issuedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 600_000).toISOString(),
    ...overrides,
  };
  return {
    ...core,
    receiptDigest: digestWorkbenchRollbackAuthorization(core),
    signature: "test-only-protocol-signature-not-an-authority",
  };
}
describe("Workbench rollback authorization protocol", () => {
  it("accepts exact bounded fresh data without claiming signature authenticity", () => {
    const input = authorization();
    expect(verifyWorkbenchRollbackAuthorization(input, plan, NOW)).toEqual(
      input,
    );
    expect(
      Object.isFrozen(verifyWorkbenchRollbackAuthorization(input, plan, NOW)),
    ).toBe(true);
  });
  it.each([
    { automated: true },
    { requestedBy: "human:bob" },
    { tenantId: "tenant:other" },
    { reason: "Different reason." },
    { planDigest: `sha256:${"2".repeat(64)}` },
    { issuedAt: new Date(NOW + 1).toISOString() },
    { expiresAt: new Date(NOW).toISOString() },
    { expiresAt: new Date(NOW + 600_001).toISOString() },
    { issuedAt: NOW },
  ])("rejects recomputed but mismatched authorization: %j", (overrides) => {
    expect(() =>
      verifyWorkbenchRollbackAuthorization(authorization(overrides), plan, NOW),
    ).toThrow();
  });
  it("rejects extra fields, accessors, proxies and invalid clocks", () => {
    const input = authorization();
    expect(() =>
      verifyWorkbenchRollbackAuthorization(
        { ...input, authenticated: true },
        plan,
        NOW,
      ),
    ).toThrow();
    const getter = { ...input };
    Object.defineProperty(getter, "requestedBy", {
      get() {
        throw new Error("must not execute getter");
      },
      enumerable: true,
    });
    expect(() =>
      verifyWorkbenchRollbackAuthorization(getter, plan, NOW),
    ).toThrow();
    expect(() =>
      verifyWorkbenchRollbackAuthorization(new Proxy(input, {}), plan, NOW),
    ).toThrow();
    expect(() =>
      verifyWorkbenchRollbackAuthorization(input, plan, NaN),
    ).toThrow();
  });
});
