import { describe, it, expect, vi } from "vitest";
import { BetaFlags, FeatureNotEnabledError } from "../lib/beta-flags.js";

describe("BetaFlags.validFlag", () => {
  it("accepts feature-YYYY-MM-DD format", () => {
    expect(BetaFlags.validFlag("idle-park-2026-05-01")).toBe(true);
    expect(BetaFlags.validFlag("a-2026-01-01")).toBe(true);
  });
  it("rejects malformed", () => {
    expect(BetaFlags.validFlag("no-date")).toBe(false);
    expect(BetaFlags.validFlag("2026-05-01")).toBe(false);
    expect(BetaFlags.validFlag("UPPER-2026-01-01")).toBe(false);
    expect(BetaFlags.validFlag("")).toBe(false);
    expect(BetaFlags.validFlag(null)).toBe(false);
  });
});

describe("BetaFlags enable/disable/isEnabled", () => {
  it("enable + isEnabled works", () => {
    const b = new BetaFlags();
    expect(b.isEnabled("x-2026-01-01")).toBe(false);
    expect(b.enable("x-2026-01-01")).toBe(true);
    expect(b.isEnabled("x-2026-01-01")).toBe(true);
    expect(b.enable("x-2026-01-01")).toBe(false); // already enabled
  });

  it("disable returns changed flag", () => {
    const b = new BetaFlags();
    b.enable("y-2026-01-01");
    expect(b.disable("y-2026-01-01")).toBe(true);
    expect(b.disable("y-2026-01-01")).toBe(false);
    expect(b.isEnabled("y-2026-01-01")).toBe(false);
  });

  it("strict mode rejects invalid flags", () => {
    const b = new BetaFlags();
    expect(() => b.enable("not-valid")).toThrow(/invalid flag/);
  });

  it("non-strict accepts any string", () => {
    const b = new BetaFlags({ strict: false });
    expect(() => b.enable("anything")).not.toThrow();
    expect(b.isEnabled("anything")).toBe(true);
  });

  it("initial flags are enabled", () => {
    const b = new BetaFlags({ initial: ["a-2026-01-01", "b-2026-02-01"] });
    expect(b.isEnabled("a-2026-01-01")).toBe(true);
    expect(b.isEnabled("b-2026-02-01")).toBe(true);
  });
});

describe("BetaFlags register / list", () => {
  it("register adds to known without enabling", () => {
    const b = new BetaFlags();
    b.register("opt-2026-06-01", { description: "optional" });
    expect(b.isEnabled("opt-2026-06-01")).toBe(false);
    expect(b.list().known).toContain("opt-2026-06-01");
  });

  it("list returns sorted arrays", () => {
    const b = new BetaFlags();
    b.enable("z-2026-01-01");
    b.enable("a-2026-01-01");
    const out = b.list();
    expect(out.enabled).toEqual(["a-2026-01-01", "z-2026-01-01"]);
  });
});

describe("BetaFlags.requireFeature", () => {
  it("passes when enabled", () => {
    const b = new BetaFlags({ initial: ["x-2026-01-01"] });
    expect(b.requireFeature("x-2026-01-01")).toBe(true);
  });

  it("throws FeatureNotEnabledError when disabled", () => {
    const b = new BetaFlags();
    expect(() => b.requireFeature("x-2026-01-01")).toThrow(FeatureNotEnabledError);
    try {
      b.requireFeature("x-2026-01-01");
    } catch (e) {
      expect(e.code).toBe("feature_not_enabled");
      expect(e.flag).toBe("x-2026-01-01");
    }
  });
});

describe("BetaFlags events", () => {
  it("emits enabled/disabled/registered", () => {
    const b = new BetaFlags();
    const enabled = vi.fn();
    const disabled = vi.fn();
    const registered = vi.fn();
    b.on("enabled", enabled);
    b.on("disabled", disabled);
    b.on("registered", registered);
    b.register("r-2026-01-01");
    b.enable("e-2026-01-01");
    b.disable("e-2026-01-01");
    expect(registered).toHaveBeenCalledOnce();
    expect(enabled).toHaveBeenCalledWith("e-2026-01-01");
    expect(disabled).toHaveBeenCalledWith("e-2026-01-01");
  });
});

describe("BetaFlags store integration", () => {
  it("load() populates from store", async () => {
    const store = { load: vi.fn(async () => ["x-2026-01-01", "y-2026-02-01"]) };
    const b = new BetaFlags({ store });
    await b.load();
    expect(b.isEnabled("x-2026-01-01")).toBe(true);
    expect(b.isEnabled("y-2026-02-01")).toBe(true);
  });

  it("save() called on enable/disable", async () => {
    const save = vi.fn().mockResolvedValue();
    const b = new BetaFlags({ store: { save } });
    b.enable("x-2026-01-01");
    await new Promise((r) => setImmediate(r));
    expect(save).toHaveBeenCalledWith(["x-2026-01-01"]);
    b.disable("x-2026-01-01");
    await new Promise((r) => setImmediate(r));
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("emits store-error when save throws", async () => {
    const save = vi.fn().mockRejectedValue(new Error("disk full"));
    const b = new BetaFlags({ store: { save } });
    const spy = vi.fn();
    b.on("store-error", spy);
    b.enable("x-2026-01-01");
    await new Promise((r) => setImmediate(r));
    expect(spy).toHaveBeenCalledOnce();
  });

  it("load() tolerates missing store", async () => {
    const b = new BetaFlags();
    await expect(b.load()).resolves.toBeUndefined();
  });
});
