import { describe, it, expect, vi } from "vitest";

vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import mod from "../workflow-variables.js";
const { VariableManager, VariableScope, createLoopContext } = mod;

describe("workflow-variables", () => {
  describe("set / get / scopes", () => {
    it("gets an initial global variable", () => {
      const vm = new VariableManager({ a: 1, name: "Bob" });
      expect(vm.get("a")).toBe(1);
      expect(vm.get("name")).toBe("Bob");
    });

    it("resolves most-specific scope first (loop > step > extracted > global)", () => {
      const vm = new VariableManager({ x: "global" });
      vm.set("x", "step", VariableScope.STEP);
      vm.set("x", "loop", VariableScope.LOOP);
      expect(vm.get("x")).toBe("loop");
      vm.delete("x", VariableScope.LOOP);
      expect(vm.get("x")).toBe("step");
    });

    it("supports dot notation for nested objects", () => {
      const vm = new VariableManager({ user: { name: "Alice", addr: { city: "X" } } });
      expect(vm.get("user.name")).toBe("Alice");
      expect(vm.get("user.addr.city")).toBe("X");
      expect(vm.get("user.missing")).toBeUndefined();
    });

    it("throws on an invalid scope", () => {
      const vm = new VariableManager();
      expect(() => vm.set("a", 1, "nope")).toThrow(/Invalid scope/);
    });

    it("has() reflects presence", () => {
      const vm = new VariableManager({ a: 0 });
      expect(vm.has("a")).toBe(true); // 0 is defined
      expect(vm.has("missing")).toBe(false);
    });

    it("clearScope wipes one scope only", () => {
      const vm = new VariableManager({ g: 1 });
      vm.set("s", 2, VariableScope.STEP);
      vm.clearScope(VariableScope.STEP);
      expect(vm.get("s")).toBeUndefined();
      expect(vm.get("g")).toBe(1);
    });
  });

  describe("getAll / snapshot / restore", () => {
    it("getAll merges scopes with specific overriding global", () => {
      const vm = new VariableManager({ a: "global" });
      vm.set("a", "loop", VariableScope.LOOP);
      expect(vm.getAll().a).toBe("loop");
    });

    it("snapshot + restore round-trips scope state", () => {
      const vm = new VariableManager({ a: 1 });
      vm.set("b", 2, VariableScope.STEP);
      const snap = vm.snapshot();
      vm.set("a", 99);
      vm.delete("b", VariableScope.STEP);
      vm.restore(snap);
      expect(vm.get("a")).toBe(1);
      expect(vm.get("b")).toBe(2);
    });
  });

  describe("interpolate", () => {
    const vm = new VariableManager({ a: 5, name: "Bob", user: { name: "Alice" } });

    it("substitutes a plain variable", () => {
      expect(vm.interpolate("hi ${name}")).toBe("hi Bob");
    });

    it("substitutes a dotted path", () => {
      expect(vm.interpolate("${user.name}")).toBe("Alice");
    });

    it("keeps the placeholder verbatim for an undefined variable", () => {
      expect(vm.interpolate("x${nope}y")).toBe("x${nope}y");
    });

    it("returns non-strings unchanged", () => {
      expect(vm.interpolate(42)).toBe(42);
      expect(vm.interpolate(null)).toBe(null);
    });

    it("evaluates arithmetic on a variable and a literal (regression: was NaN)", () => {
      // The single-token operand "3" previously resolved via get() -> undefined,
      // so `${a + 3}` produced NaN. It must now compute 8.
      expect(vm.interpolate("${a + 3}")).toBe("8");
      expect(vm.interpolate("${a * 2}")).toBe("10");
      expect(vm.interpolate("${a - 1}")).toBe("4");
    });

    it("evaluates comparisons on a variable and a literal (regression: was false)", () => {
      expect(vm.interpolate("${a == 5}")).toBe("true");
      expect(vm.interpolate("${a > 10}")).toBe("false");
      expect(vm.interpolate("${a >= 5}")).toBe("true");
    });

    it("applies built-in string functions", () => {
      expect(vm.interpolate("${upper(name)}")).toBe("BOB");
      expect(vm.interpolate("${lower(name)}")).toBe("bob");
      expect(vm.interpolate("${length(name)}")).toBe("3");
    });
  });

  describe("interpolateDeep", () => {
    it("walks strings inside arrays and objects", () => {
      const vm = new VariableManager({ who: "world" });
      const out = vm.interpolateDeep({
        msg: "hi ${who}",
        list: ["${who}", 7],
        nested: { deep: "${who}!" },
      });
      expect(out).toEqual({
        msg: "hi world",
        list: ["world", 7],
        nested: { deep: "world!" },
      });
    });
  });

  describe("createLoopContext", () => {
    it("flags first/last/even/odd correctly", () => {
      expect(createLoopContext(0, "a", 3)).toMatchObject({
        index: 0,
        value: "a",
        first: true,
        last: false,
        even: true,
        odd: false,
        count: 3,
      });
      expect(createLoopContext(2, "c", 3)).toMatchObject({
        first: false,
        last: true,
        even: true,
        odd: false,
      });
      expect(createLoopContext(1, "b", 3)).toMatchObject({
        even: false,
        odd: true,
      });
    });
  });
});
