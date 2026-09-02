import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createCliStructuredMemoryPostCompactVerifier } from "../../src/lib/evolution/structured-memory-post-compact-hook.js";

function digest(value) {
  return `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;
}

const descriptor = { tenantId: "tenant-a", authorityId: "cli-hooks-v2", authorityRevision: 1,
  handlerDigest: digest("cli-post-compact-handler") };

function attestor() {
  const secret = "test-only-post-compact-key";
  return { sign: ({ message }) => ({ algorithm: "hmac-sha256", keyId: "test:post-compact",
    value: createHmac("sha256", secret).update(message).digest("base64url") }),
  verify: ({ message, result }) => result.signature?.algorithm === "hmac-sha256" &&
    result.signature?.keyId === "test:post-compact" &&
    result.signature?.value === createHmac("sha256", secret).update(message).digest("base64url") };
}

function context() {
  const candidate = { tenantId: "tenant-a", requirements: ["retain"], decisions: ["verify"],
    openRisks: [], failedAttempts: [], tests: ["post-compact"], goalState: { status: "active" },
    delegatedTasks: [], memoryLineage: ["memory-1"] };
  const canonical = (value) => value === null || typeof value !== "object" ? JSON.stringify(value) :
    Array.isArray(value) ? `[${value.map(canonical).join(",")}]` :
      `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  const hash = (value) => `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
  return { previous: null, candidate, snapshotDigest: hash(candidate),
    projection: { tenantId: "tenant-a", projectionDigest: digest("projection") } };
}

describe("CLI structured memory PostCompact hook adapter", () => {
  it("awaits the real Hooks V2 contract and accepts an attested successful hook", async () => {
    const hookExecutor = vi.fn(async () => ({ success: true, blocked: false, decision: "continue",
      results: [{ status: "success", hookId: "post-compact-check" }] }));
    const verifier = createCliStructuredMemoryPostCompactVerifier({ descriptor, hookExecutor,
      attestor: attestor(), clock: () => Date.parse("2026-09-02T00:00:00.000Z") });
    await expect(verifier(context())).resolves.toBe(true);
    expect(hookExecutor).toHaveBeenCalledWith("PostCompact", expect.objectContaining({
      trigger: "structured-memory", tenant_id: "tenant-a", candidate: context().candidate }),
    { failClosed: true });
  });

  it.each([
    { success: true, blocked: false, decision: "continue", results: [] },
    { success: false, blocked: true, decision: "block", results: [{ status: "blocked" }] },
    { success: true, blocked: false, decision: "continue", results: [{ status: "failed" }] },
  ])("rejects missing, blocked, or failed PostCompact hooks", async (outcome) => {
    const verifier = createCliStructuredMemoryPostCompactVerifier({ descriptor,
      hookExecutor: async () => outcome, attestor: attestor(), clock: () => Date.parse("2026-09-02T00:00:00.000Z") });
    await expect(verifier(context())).resolves.toBe(false);
  });

  it("fails authentication when the PostCompact attestor is not trusted", async () => {
    const untrusted = attestor();
    untrusted.verify = async () => false;
    const verifier = createCliStructuredMemoryPostCompactVerifier({ descriptor,
      hookExecutor: async () => ({ success: true, blocked: false, decision: "continue",
        results: [{ status: "success" }] }), attestor: untrusted });
    await expect(verifier(context())).rejects.toThrow(/attestation failed/);
  });
});
