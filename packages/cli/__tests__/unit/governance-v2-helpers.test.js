import { describe, it, expect } from "vitest";
import {
  positiveInteger,
  createTransitionChecker,
  createCapRegistry,
  countBy,
  buildTransitionMap,
} from "../../src/lib/governance-v2-helpers.js";

describe("positiveInteger", () => {
  it("returns floored positive int", () => {
    expect(positiveInteger(5, "x")).toBe(5);
    expect(positiveInteger(5.7, "x")).toBe(5);
    expect(positiveInteger("8", "x")).toBe(8);
  });

  it("rejects zero, negative, NaN, Infinity", () => {
    expect(() => positiveInteger(0, "cap")).toThrow(/cap must be positive/);
    expect(() => positiveInteger(-1, "cap")).toThrow(/cap must be positive/);
    expect(() => positiveInteger(NaN, "cap")).toThrow(/cap must be positive/);
    expect(() => positiveInteger(Infinity, "cap")).toThrow(
      /cap must be positive/,
    );
  });
});

describe("buildTransitionMap + createTransitionChecker", () => {
  it("accepts declared transitions", () => {
    const m = buildTransitionMap({
      pending: ["active"],
      active: ["paused", "archived"],
      paused: ["active"],
    });
    const check = createTransitionChecker(m, "profile");
    expect(() => check("pending", "active")).not.toThrow();
    expect(() => check("active", "paused")).not.toThrow();
    expect(() => check("paused", "active")).not.toThrow();
  });

  it("rejects undeclared transitions with labelled error", () => {
    const m = buildTransitionMap({ pending: ["active"] });
    const check = createTransitionChecker(m, "share");
    expect(() => check("pending", "archived")).toThrow(
      /invalid share transition pending → archived/,
    );
    expect(() => check("bogus", "active")).toThrow(
      /invalid share transition bogus → active/,
    );
  });
});

describe("createCapRegistry", () => {
  it("exposes get/set pairs and caps live-object", () => {
    const { caps, setters, getters } = createCapRegistry({
      maxActive: 8,
      idleMs: 60_000,
    });
    expect(caps.maxActive).toBe(8);
    expect(getters.maxActive()).toBe(8);
    setters.maxActive(20);
    expect(caps.maxActive).toBe(20);
    expect(getters.maxActive()).toBe(20);
  });

  it("set validates positivity via positiveInteger", () => {
    const { setters } = createCapRegistry({ idleMs: 1000 });
    expect(() => setters.idleMs(0)).toThrow(/idleMs must be positive/);
    expect(() => setters.idleMs(-10)).toThrow(/idleMs must be positive/);
  });

  it("resetCaps restores declared defaults", () => {
    const { caps, setters, resetCaps } = createCapRegistry({
      maxActive: 8,
      idleMs: 60_000,
    });
    setters.maxActive(100);
    setters.idleMs(999);
    expect(caps.maxActive).toBe(100);
    resetCaps();
    expect(caps.maxActive).toBe(8);
    expect(caps.idleMs).toBe(60_000);
  });

  it("rejects invalid defaults at construction time", () => {
    expect(() => createCapRegistry({ bad: 0 })).toThrow(
      /default for bad must be a positive number/,
    );
    expect(() => createCapRegistry({ bad: -5 })).toThrow(/bad/);
    expect(() => createCapRegistry({ bad: NaN })).toThrow(/bad/);
  });
});

describe("countBy", () => {
  it("counts map values matching predicate", () => {
    const m = new Map([
      ["a", { status: "active", owner: "u1" }],
      ["b", { status: "active", owner: "u2" }],
      ["c", { status: "paused", owner: "u1" }],
    ]);
    expect(countBy(m, (v) => v.status === "active")).toBe(2);
    expect(countBy(m, (v) => v.owner === "u1")).toBe(2);
    expect(countBy(m, () => false)).toBe(0);
  });

  it("returns 0 on empty map", () => {
    expect(countBy(new Map(), () => true)).toBe(0);
  });
});
