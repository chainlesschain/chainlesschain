import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const {
  LEGACY_SKILL_INVOCATION_RECEIPT_SCHEMA,
  SKILL_INVOCATION_RECEIPT_SCHEMA,
  buildSkillInvocationTraceProjection,
  startSkillInvocation,
  settleSkillInvocation,
  verifySkillInvocationReceipt,
} = require("../lib/skill-invocation-receipt.js");

const digest = (character) => `sha256:${character.repeat(64)}`;

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function redigest(value) {
  const core = { ...value };
  delete core.receiptDigest;
  return {
    ...core,
    receiptDigest: `sha256:${crypto
      .createHash("sha256")
      .update(`${SKILL_INVOCATION_RECEIPT_SCHEMA}\0${canonicalJson(core)}`)
      .digest("hex")}`,
  };
}

function started(overrides = {}) {
  return startSkillInvocation(
    {
      receiptId: "receipt:test",
      selectedSkillDigest: digest("a"),
      routerCandidates: [
        { digest: digest("a"), score: 1, reason: "canonical match" },
      ],
      evolutionRunId: "evolution:test",
      traceId: "trace:test",
      trajectorySegmentId: "segment:test",
      providerModelVersion: "provider/model@1",
      toolSetDigest: digest("b"),
      osSandboxPermissionPolicyDigest: digest("c"),
      taskCohort: "test",
      environmentDigest: digest("e"),
      attributionRequired: true,
      ...overrides,
    },
    { clock: () => "2026-09-03T00:00:00.000Z" },
  );
}

function settled() {
  return settleSkillInvocation(
    started(),
    {
      executionStatus: "completed",
      graderReceipts: [digest("d")],
      tokensInput: 1,
      tokensOutput: 2,
      costUsd: 0.01,
      latencyMs: 3,
    },
    { clock: () => "2026-09-03T00:00:01.000Z" },
  );
}

describe("Skill invocation receipt structural verifier", () => {
  it("accepts the exact canonical settled structure", () => {
    const value = settled();
    expect(verifySkillInvocationReceipt(value)).toBe(value);
  });

  it("rejects redigested extra fields and malformed nested values", () => {
    const value = settled();
    expect(() =>
      verifySkillInvocationReceipt(redigest({ ...value, hidden: "claim" })),
    ).toThrow(/structure is invalid/u);
    expect(() =>
      verifySkillInvocationReceipt(
        redigest({
          ...value,
          routerCandidates: [{ ...value.routerCandidates[0], score: "1" }],
        }),
      ),
    ).toThrow(/structure is invalid/u);
    expect(() =>
      verifySkillInvocationReceipt(
        redigest({
          ...value,
          routerCandidates: [
            value.routerCandidates[0],
            value.routerCandidates[0],
          ],
        }),
      ),
    ).toThrow(/structure is invalid/u);
  });

  it("rejects a redigested inconsistent attribution claim", () => {
    const value = settled();
    expect(() =>
      verifySkillInvocationReceipt(
        redigest({
          ...value,
          attributionStatus: "incomplete",
          missingAttribution: ["traceId"],
        }),
      ),
    ).toThrow(/attribution is invalid/u);
  });

  it("reads v1 receipts but keeps their missing environment binding ineligible", () => {
    const current = settled();
    const legacyCore = { ...current };
    delete legacyCore.environmentDigest;
    delete legacyCore.receiptDigest;
    legacyCore.schema = LEGACY_SKILL_INVOCATION_RECEIPT_SCHEMA;
    const legacy = Object.freeze({
      ...legacyCore,
      receiptDigest: `sha256:${crypto
        .createHash("sha256")
        .update(
          `${LEGACY_SKILL_INVOCATION_RECEIPT_SCHEMA}\0${canonicalJson(legacyCore)}`,
        )
        .digest("hex")}`,
    });

    expect(verifySkillInvocationReceipt(legacy)).toBe(legacy);
    expect(
      buildSkillInvocationTraceProjection([legacy], "trace:test"),
    ).toMatchObject({
      complete: false,
      environmentBound: false,
      invocations: [
        { environmentDigest: null, legacyEnvironmentUnbound: true },
      ],
    });
  });

  it("refuses to settle a forged started receipt", () => {
    expect(() =>
      settleSkillInvocation(
        { ...started(), injectedAuthority: true },
        { executionStatus: "completed" },
      ),
    ).toThrow(/structure is invalid/u);
  });

  it("rejects accessor and proxy receipts without invoking their traps", () => {
    const getter = vi.fn(() => SKILL_INVOCATION_RECEIPT_SCHEMA);
    const accessor = { ...settled() };
    Object.defineProperty(accessor, "schema", {
      enumerable: true,
      get: getter,
    });
    expect(() => verifySkillInvocationReceipt(accessor)).toThrow(/structure/u);
    expect(getter).not.toHaveBeenCalled();

    const trap = vi.fn(() => {
      throw new Error("proxy trap must not run");
    });
    const proxy = new Proxy({}, { get: trap });
    expect(() => verifySkillInvocationReceipt(proxy)).toThrow(/structure/u);
    expect(trap).not.toHaveBeenCalled();
  });

  it("enforces canonical monotonic time, integer tokens, and unique graders", () => {
    const value = settled();
    expect(() =>
      verifySkillInvocationReceipt(
        redigest({ ...value, completedAt: "not-an-instant" }),
      ),
    ).toThrow(/settled.*invalid/u);
    expect(() =>
      settleSkillInvocation(
        started(),
        { executionStatus: "completed", tokensInput: 0.5 },
        { clock: () => "2026-09-03T00:00:01.000Z" },
      ),
    ).toThrow(/token counts/u);
    expect(() =>
      settleSkillInvocation(
        started(),
        {
          executionStatus: "completed",
          graderReceipts: [digest("d"), digest("d")],
        },
        { clock: () => "2026-09-03T00:00:01.000Z" },
      ),
    ).toThrow(/duplicate/u);
    expect(() =>
      settleSkillInvocation(
        started(),
        { executionStatus: "completed" },
        { clock: () => "2026-09-02T23:59:59.000Z" },
      ),
    ).toThrow(/at or after/u);
  });
});
