import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
const {
  createDesktopStructuredMemoryPostCompactVerifier,
} = require("../structured-memory-post-compact-hook");

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value)).digest("hex")}`;
}

const descriptor = {
  tenantId: "tenant-a",
  authorityId: "desktop-hook-system",
  authorityRevision: 1,
  handlerDigest: digest("desktop-post-compact-handler"),
};

function attestor() {
  const secret = "test-only-desktop-post-compact";
  return {
    sign: ({ message }) => ({
      algorithm: "hmac-sha256",
      keyId: "test:desktop-post-compact",
      value: crypto.createHmac("sha256", secret).update(message).digest("base64url"),
    }),
    verify: ({ message, result }) =>
      result.signature?.algorithm === "hmac-sha256" &&
      result.signature?.keyId === "test:desktop-post-compact" &&
      result.signature?.value ===
        crypto.createHmac("sha256", secret).update(message).digest("base64url"),
  };
}

function context() {
  const candidate = {
    tenantId: "tenant-a",
    requirements: ["retain"],
    decisions: ["verify"],
    openRisks: [],
    failedAttempts: [],
    tests: ["desktop-post-compact"],
    goalState: { status: "active" },
    delegatedTasks: [],
    memoryLineage: ["memory-1"],
  };
  const canonical = (value) =>
    value === null || typeof value !== "object"
      ? JSON.stringify(value)
      : Array.isArray(value)
        ? `[${value.map(canonical).join(",")}]`
        : `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
            .join(",")}}`;
  const hash = (value) =>
    `sha256:${crypto.createHash("sha256").update(canonical(value)).digest("hex")}`;
  return {
    previous: null,
    candidate,
    snapshotDigest: hash(candidate),
    projection: { tenantId: "tenant-a", projectionDigest: digest("projection") },
  };
}

describe("Desktop structured memory PostCompact hook adapter", () => {
  it("awaits HookSystem and accepts a complete attested success", async () => {
    const hookSystem = {
      trigger: vi.fn(async () => ({
        result: "continue",
        prevented: false,
        totalHooks: 1,
        executedHooks: 1,
        hookResults: [{ result: "continue", hookId: "memory-integrity" }],
      })),
    };
    const verifier = createDesktopStructuredMemoryPostCompactVerifier({
      descriptor,
      hookSystem,
      attestor: attestor(),
      clock: () => Date.parse("2026-09-02T00:00:00.000Z"),
    });
    await expect(verifier(context())).resolves.toBe(true);
    expect(hookSystem.trigger).toHaveBeenCalledWith(
      "PostCompact",
      expect.objectContaining({
        trigger: "structured-memory",
        tenantId: "tenant-a",
        candidate: context().candidate,
      }),
      { tenantId: "tenant-a", structuredMemory: true },
    );
  });

  it.each([
    { result: "continue", prevented: false, totalHooks: 0, executedHooks: 0, hookResults: [] },
    { result: "prevent", prevented: true, totalHooks: 1, executedHooks: 1,
      hookResults: [{ result: "prevent" }] },
    { result: "continue", prevented: false, totalHooks: 1, executedHooks: 1,
      hookResults: [{ result: "error" }] },
  ])("rejects absent, prevented, or failed Desktop hooks", async (outcome) => {
    const verifier = createDesktopStructuredMemoryPostCompactVerifier({
      descriptor,
      hookSystem: { trigger: async () => outcome },
      attestor: attestor(),
    });
    await expect(verifier(context())).resolves.toBe(false);
  });

  it("rejects an untrusted Desktop PostCompact attestation", async () => {
    const invalidAttestor = attestor();
    invalidAttestor.verify = async () => false;
    const verifier = createDesktopStructuredMemoryPostCompactVerifier({
      descriptor,
      hookSystem: { trigger: async () => ({ result: "continue", prevented: false,
        totalHooks: 1, executedHooks: 1, hookResults: [{ result: "continue" }] }) },
      attestor: invalidAttestor,
    });
    await expect(verifier(context())).rejects.toThrow(/attestation failed/);
  });
});
