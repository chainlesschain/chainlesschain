"use strict";

import { describe, it, expect } from "vitest";

const { assertAdapter, SENSITIVITY_LEVELS } = require("../lib/adapter-spec");
const { MockAdapter } = require("../lib/mock-adapter");

describe("assertAdapter", () => {
  it("accepts a fully-valid adapter (MockAdapter)", () => {
    const r = assertAdapter(new MockAdapter());
    expect(r.ok).toBe(true);
  });

  it("rejects non-object input", () => {
    expect(assertAdapter(null).ok).toBe(false);
    expect(assertAdapter(undefined).ok).toBe(false);
    expect(assertAdapter("oops").ok).toBe(false);
  });

  it("rejects missing required fields (collects all errors, no throw)", () => {
    const r = assertAdapter({});
    expect(r.ok).toBe(false);
    // Many fields missing — at least name + version + capabilities + dataDisclosure + methods.
    expect(r.errors.length).toBeGreaterThan(4);
    expect(r.errors.some((e) => e.includes("name"))).toBe(true);
    expect(r.errors.some((e) => e.includes("version"))).toBe(true);
    expect(r.errors.some((e) => e.includes("authenticate"))).toBe(true);
    expect(r.errors.some((e) => e.includes("sync"))).toBe(true);
  });

  it("rejects invalid sensitivity", () => {
    const a = new MockAdapter();
    a.dataDisclosure = { ...a.dataDisclosure, sensitivity: "extreme" };
    const r = assertAdapter(a);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("sensitivity"))).toBe(true);
  });

  it("rejects non-boolean legalGate", () => {
    const a = new MockAdapter();
    a.dataDisclosure = { ...a.dataDisclosure, legalGate: "yes" };
    const r = assertAdapter(a);
    expect(r.ok).toBe(false);
  });

  it("rejects non-array capabilities", () => {
    const a = new MockAdapter();
    a.capabilities = "sync";
    const r = assertAdapter(a);
    expect(r.ok).toBe(false);
  });

  it("requires rateLimits to be non-negative safe integers", () => {
    const a = new MockAdapter();
    a.rateLimits = { perMinute: -1 };
    expect(assertAdapter(a).ok).toBe(false);

    a.rateLimits = { perMinute: 1.5, perDay: Number.MAX_SAFE_INTEGER + 1 };
    const result = assertAdapter(a);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("perMinute"))).toBe(
      true,
    );
    expect(result.errors.some((error) => error.includes("perDay"))).toBe(true);
  });

  it("accepts adapter without rateLimits (optional field)", () => {
    const a = new MockAdapter();
    delete a.rateLimits;
    expect(assertAdapter(a).ok).toBe(true);
  });

  it("accepts known watermark strategies and rejects unknown values", () => {
    const a = new MockAdapter();
    a.watermarkStrategy = "max-captured-at";
    expect(assertAdapter(a).ok).toBe(true);

    a.watermarkStrategy = "latest-ish";
    const result = assertAdapter(a);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("watermarkStrategy"))).toBe(
      true,
    );
  });

  it("validates the optional complete-scan watermark flag", () => {
    const a = new MockAdapter();
    a.watermarkRequiresCompleteScan = true;
    expect(assertAdapter(a).ok).toBe(true);

    a.watermarkRequiresCompleteScan = "sometimes";
    const result = assertAdapter(a);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.includes("watermarkRequiresCompleteScan")),
    ).toBe(true);
  });

  it("validates lookback windows and adaptive initial page budgets", () => {
    const a = new MockAdapter();
    a.watermarkLookbackMs = 86_400_000;
    a.initialPageBudget = 12;
    expect(assertAdapter(a).ok).toBe(true);

    a.watermarkLookbackMs = -1;
    a.initialPageBudget = 0;
    const result = assertAdapter(a);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((error) => error.includes("watermarkLookbackMs")),
    ).toBe(true);
    expect(
      result.errors.some((error) => error.includes("initialPageBudget")),
    ).toBe(true);
  });

  it("validates the optional account-backed default scope", () => {
    const a = new MockAdapter();
    a.defaultScope = "account:mock:abc123";
    expect(assertAdapter(a).ok).toBe(true);

    a.defaultScope = "";
    const result = assertAdapter(a);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("defaultScope"))).toBe(true);
  });

  it("validates optional snapshot account scope hints", () => {
    const a = new MockAdapter();
    a.snapshotScopeIdentityFields = ["email"];
    a.snapshotScopeTopLevelFields = ["user"];
    a.snapshotScopeIdentityIncludesField = false;
    expect(assertAdapter(a).ok).toBe(true);

    a.snapshotScopeIdentityFields = ["email", ""];
    a.snapshotScopeIdentityIncludesField = "no";
    const result = assertAdapter(a);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.includes("snapshotScopeIdentityFields")),
    ).toBe(true);
    expect(
      result.errors.some((e) =>
        e.includes("snapshotScopeIdentityIncludesField"),
      ),
    ).toBe(true);
  });

  it("rejects non-function authenticate / sync / normalize / healthCheck", () => {
    const a = new MockAdapter();
    a.authenticate = "not a function";
    expect(assertAdapter(a).ok).toBe(false);

    const b = new MockAdapter();
    b.normalize = 42;
    expect(assertAdapter(b).ok).toBe(false);
  });

  it("SENSITIVITY_LEVELS lists low/medium/high", () => {
    expect(SENSITIVITY_LEVELS).toEqual(["low", "medium", "high"]);
  });
});
