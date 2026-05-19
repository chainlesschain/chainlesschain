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

  it("rejects rateLimits with negative value", () => {
    const a = new MockAdapter();
    a.rateLimits = { perMinute: -1 };
    expect(assertAdapter(a).ok).toBe(false);
  });

  it("accepts adapter without rateLimits (optional field)", () => {
    const a = new MockAdapter();
    delete a.rateLimits;
    expect(assertAdapter(a).ok).toBe(true);
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
