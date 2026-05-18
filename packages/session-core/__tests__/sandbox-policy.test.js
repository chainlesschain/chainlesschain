import { describe, it, expect } from "vitest";
import {
  SCOPES,
  SCOPE_DEFAULTS,
  DEFAULT_SANDBOX_POLICY,
  validateSandboxPolicy,
  mergeSandboxPolicy,
  isSandboxExpired,
  isSandboxIdleExpired,
  shouldReuseSandbox,
  resolveBundleSandboxPolicy,
} from "../lib/sandbox-policy.js";

describe("validateSandboxPolicy", () => {
  it("accepts a sane policy", () => {
    expect(
      validateSandboxPolicy({
        scope: "thread",
        ttlMs: 1000,
        cleanupOnExit: true,
      }),
    ).toEqual([]);
  });
  it("rejects unknown scope", () => {
    const errs = validateSandboxPolicy({ scope: "container" });
    expect(errs[0]).toMatch(/scope/);
  });
  it("rejects negative numeric fields", () => {
    const errs = validateSandboxPolicy({ ttlMs: -1, maxRunMs: 1.5 });
    expect(errs).toHaveLength(2);
  });
  it("requires booleans for boolean fields", () => {
    const errs = validateSandboxPolicy({ cleanupOnExit: "yes" });
    expect(errs[0]).toMatch(/cleanupOnExit/);
  });
  it("rejects non-object", () => {
    expect(validateSandboxPolicy(null)[0]).toMatch(/object/);
  });
  it("allows null to clear a numeric field", () => {
    expect(validateSandboxPolicy({ ttlMs: null })).toEqual([]);
  });
});

describe("mergeSandboxPolicy", () => {
  it("falls back to thread defaults", () => {
    const out = mergeSandboxPolicy();
    expect(out.scope).toBe("thread");
    expect(out).toEqual(SCOPE_DEFAULTS.thread);
  });
  it("switches scope swaps defaults", () => {
    const out = mergeSandboxPolicy({}, { scope: "assistant" });
    expect(out.ttlMs).toBe(SCOPE_DEFAULTS.assistant.ttlMs);
    expect(out.reuseAcrossRuns).toBe(true);
  });
  it("override beats base beats scope defaults", () => {
    const out = mergeSandboxPolicy(
      { ttlMs: 1000, maxRunMs: 9000 },
      { ttlMs: 2000 },
    );
    expect(out.ttlMs).toBe(2000);
    expect(out.maxRunMs).toBe(9000);
  });
  it("explicit null overrides", () => {
    const out = mergeSandboxPolicy({}, { ttlMs: null, scope: "thread" });
    expect(out.ttlMs).toBeNull();
  });
  it("undefined fields do not override", () => {
    const out = mergeSandboxPolicy(
      { maxFileBytes: 1234 },
      { maxFileBytes: undefined },
    );
    expect(out.maxFileBytes).toBe(1234);
  });
  it("throws on invalid scope", () => {
    expect(() => mergeSandboxPolicy({}, { scope: "bogus" })).toThrow(/scope/);
  });
});

describe("isSandboxExpired / isSandboxIdleExpired", () => {
  it("ttlMs=null means never expires", () => {
    expect(isSandboxExpired({ ttlMs: null }, 0, 1e12)).toBe(false);
  });
  it("expires when now-createdAt >= ttl", () => {
    expect(isSandboxExpired({ ttlMs: 100 }, 0, 100)).toBe(true);
    expect(isSandboxExpired({ ttlMs: 100 }, 0, 99)).toBe(false);
  });
  it("idle ttl works the same", () => {
    expect(isSandboxIdleExpired({ idleTtlMs: 50 }, 100, 200)).toBe(true);
    expect(isSandboxIdleExpired({ idleTtlMs: null }, 0, 1e12)).toBe(false);
  });
});

describe("shouldReuseSandbox", () => {
  const fresh = { createdAt: 0, lastUsedAt: 0 };
  it("denies when reuseAcrossRuns=false", () => {
    expect(
      shouldReuseSandbox(
        { reuseAcrossRuns: false, ttlMs: null, idleTtlMs: null },
        fresh,
        100,
      ),
    ).toBe(false);
  });
  it("denies when ttl exceeded", () => {
    expect(
      shouldReuseSandbox(
        {
          reuseAcrossRuns: true,
          ttlMs: 50,
          idleTtlMs: null,
        },
        fresh,
        100,
      ),
    ).toBe(false);
  });
  it("denies when idle exceeded", () => {
    expect(
      shouldReuseSandbox(
        {
          reuseAcrossRuns: true,
          ttlMs: null,
          idleTtlMs: 50,
        },
        { createdAt: 0, lastUsedAt: 10 },
        100,
      ),
    ).toBe(false);
  });
  it("allows fresh assistant sandbox", () => {
    expect(
      shouldReuseSandbox(
        SCOPE_DEFAULTS.assistant,
        { createdAt: Date.now(), lastUsedAt: Date.now() },
      ),
    ).toBe(true);
  });
  it("denies when sandbox state missing", () => {
    expect(shouldReuseSandbox(SCOPE_DEFAULTS.assistant, null)).toBe(false);
  });
});

describe("resolveBundleSandboxPolicy", () => {
  it("falls back to thread default for empty bundle", () => {
    expect(resolveBundleSandboxPolicy(null)).toEqual(DEFAULT_SANDBOX_POLICY);
    expect(resolveBundleSandboxPolicy({})).toEqual(DEFAULT_SANDBOX_POLICY);
  });
  it("uses manifest.sandbox scope", () => {
    const out = resolveBundleSandboxPolicy({
      manifest: { sandbox: "assistant" },
    });
    expect(out.scope).toBe("assistant");
    expect(out.reuseAcrossRuns).toBe(true);
  });
  it("policies/sandbox.json overrides manifest scope numeric fields", () => {
    const out = resolveBundleSandboxPolicy({
      manifest: { sandbox: "assistant" },
      sandboxPolicy: { ttlMs: 1000, maxRunMs: 500 },
    });
    expect(out.scope).toBe("assistant");
    expect(out.ttlMs).toBe(1000);
    expect(out.maxRunMs).toBe(500);
    expect(out.cleanupOnExit).toBe(false); // assistant default
  });
  it("ignores bogus manifest scope, falls to thread", () => {
    const out = resolveBundleSandboxPolicy({
      manifest: { sandbox: "container" },
    });
    expect(out.scope).toBe("thread");
  });
  it("policies/sandbox.json scope wins over manifest scope", () => {
    const out = resolveBundleSandboxPolicy({
      manifest: { sandbox: "thread" },
      sandboxPolicy: { scope: "assistant" },
    });
    expect(out.scope).toBe("assistant");
  });
});

describe("SCOPES constants", () => {
  it("defines thread and assistant", () => {
    expect(Object.values(SCOPES).sort()).toEqual(["assistant", "thread"]);
  });
});
