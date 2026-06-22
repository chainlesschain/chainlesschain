import { describe, it, expect, vi } from "vitest";

vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import mod from "../control-flow.js";
const {
  ControlFlowManager,
  ConditionOperator,
  LoopType,
  parseConditionString,
  parseValue,
} = mod;

// Minimal VariableManager stand-in (the real one is covered separately).
function fakeVars(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: (k) => store.get(k),
    set: (k, v) => store.set(k, v),
    has: (k) => store.has(k),
    interpolate: (s) => s.replace(/\$\{(\w+)\}/g, (_, k) => String(store.get(k) ?? "")),
    clearScope: () => {},
  };
}

describe("control-flow", () => {
  describe("parseValue", () => {
    it("parses numbers, quoted strings, booleans, null, and variable refs", () => {
      expect(parseValue("42")).toBe(42);
      expect(parseValue("3.14")).toBe(3.14);
      expect(parseValue('"hi"')).toBe("hi");
      expect(parseValue("'yo'")).toBe("yo");
      expect(parseValue("true")).toBe(true);
      expect(parseValue("false")).toBe(false);
      expect(parseValue("null")).toBeNull();
      expect(parseValue("myVar")).toBe("myVar");
    });

    it("keeps empty / whitespace-only input as a string (regression: was 0)", () => {
      // Number("") and Number("  ") are 0, which used to silently turn a bare
      // empty token into the number 0.
      expect(parseValue("")).toBe("");
      expect(parseValue("  ")).toBe("  ");
      expect(parseValue("\t")).toBe("\t");
    });
  });

  describe("parseConditionString", () => {
    it("parses comparison operators with correct precedence (>= before >)", () => {
      expect(parseConditionString("a >= 5")).toEqual({ operator: ">=", left: "a", right: 5 });
      expect(parseConditionString("a > 5")).toEqual({ operator: ">", left: "a", right: 5 });
      expect(parseConditionString("x === \"foo\"")).toEqual({ operator: "===", left: "x", right: "foo" });
      expect(parseConditionString("a == 1")).toEqual({ operator: "==", left: "a", right: 1 });
    });

    it("parses logical and/or/not", () => {
      expect(parseConditionString("a and b")).toMatchObject({ operator: "and" });
      expect(parseConditionString("a or b")).toMatchObject({ operator: "or" });
      expect(parseConditionString("not done")).toMatchObject({
        operator: "not",
        conditions: ["done"],
      });
    });

    it("parses string + unary operators", () => {
      expect(parseConditionString("name contains bob")).toMatchObject({ operator: "contains" });
      expect(parseConditionString("x is null")).toMatchObject({ operator: "isNull", left: "x" });
      expect(parseConditionString("y is empty")).toMatchObject({ operator: "isEmpty", left: "y" });
    });

    it("falls back to a bare variable reference", () => {
      expect(parseConditionString("isReady")).toBe("isReady");
    });
  });

  describe("evaluateCondition", () => {
    const cf = new ControlFlowManager(fakeVars({ n: 5, name: "alice", arr: [1, 2], empty: "", nul: null }));

    it("handles literal booleans and variable-name strings", () => {
      expect(cf.evaluateCondition(true)).toBe(true);
      expect(cf.evaluateCondition("name")).toBe(true); // truthy var
      expect(cf.evaluateCondition("empty")).toBe(false); // falsy var
    });

    it("evaluates comparison operators", () => {
      expect(cf.evaluateCondition({ operator: ">", left: "n", right: 3 })).toBe(true);
      expect(cf.evaluateCondition({ operator: ">=", left: "n", right: 5 })).toBe(true);
      expect(cf.evaluateCondition({ operator: "<", left: "n", right: 3 })).toBe(false);
      expect(cf.evaluateCondition({ operator: "==", left: "n", right: 5 })).toBe(true);
      expect(cf.evaluateCondition({ operator: "!=", left: "n", right: 9 })).toBe(true);
    });

    it("evaluates string operators", () => {
      expect(cf.evaluateCondition({ operator: "contains", left: "name", right: "lic" })).toBe(true);
      expect(cf.evaluateCondition({ operator: "startsWith", left: "name", right: "al" })).toBe(true);
      expect(cf.evaluateCondition({ operator: "endsWith", left: "name", right: "ce" })).toBe(true);
      expect(cf.evaluateCondition({ operator: "matches", left: "name", right: "^a.*e$" })).toBe(true);
    });

    it("returns false for an invalid matches regex (no throw)", () => {
      expect(cf.evaluateCondition({ operator: "matches", left: "name", right: "[" })).toBe(false);
    });

    it("evaluates null/empty checks", () => {
      expect(cf.evaluateCondition({ operator: "isNull", left: "nul" })).toBe(true);
      expect(cf.evaluateCondition({ operator: "isNotNull", left: "n" })).toBe(true);
      expect(cf.evaluateCondition({ operator: "isEmpty", left: "empty" })).toBe(true);
      expect(cf.evaluateCondition({ operator: "isEmpty", left: "arr" })).toBe(false);
      expect(cf.evaluateCondition({ operator: "isNotEmpty", left: "arr" })).toBe(true);
    });

    it("evaluates AND/OR/NOT", () => {
      expect(
        cf.evaluateCondition({
          operator: "and",
          conditions: [
            { operator: ">", left: "n", right: 1 },
            { operator: "<", left: "n", right: 10 },
          ],
        }),
      ).toBe(true);
      expect(
        cf.evaluateCondition({
          operator: "or",
          conditions: [{ operator: ">", left: "n", right: 100 }, "name"],
        }),
      ).toBe(true);
      expect(cf.evaluateCondition({ operator: "not", conditions: ["empty"] })).toBe(true);
    });

    it("returns false for an unknown operator", () => {
      expect(cf.evaluateCondition({ operator: "???", left: "n", right: 1 })).toBe(false);
    });
  });

  describe("_isEmpty", () => {
    const cf = new ControlFlowManager(fakeVars());
    it("classifies empties across types", () => {
      expect(cf._isEmpty(null)).toBe(true);
      expect(cf._isEmpty(undefined)).toBe(true);
      expect(cf._isEmpty("")).toBe(true);
      expect(cf._isEmpty([])).toBe(true);
      expect(cf._isEmpty({})).toBe(true);
      expect(cf._isEmpty("x")).toBe(false);
      expect(cf._isEmpty([1])).toBe(false);
      expect(cf._isEmpty({ a: 1 })).toBe(false);
      expect(cf._isEmpty(0)).toBe(false); // 0 is not "empty"
    });
  });

  describe("createLoopIterator", () => {
    const collect = async (gen) => {
      const out = [];
      for await (const v of gen) out.push(v.value);
      return out;
    };

    it("iterates a FOR range with start/end/step", async () => {
      const cf = new ControlFlowManager(fakeVars());
      expect(await collect(cf.createLoopIterator({ type: LoopType.FOR, start: 0, end: 5, step: 1 })))
        .toEqual([0, 1, 2, 3, 4]);
    });

    it("iterates FOR_EACH over an array", async () => {
      const cf = new ControlFlowManager(fakeVars({ list: ["a", "b", "c"] }));
      expect(await collect(cf.createLoopIterator({ type: LoopType.FOR_EACH, items: "list" })))
        .toEqual(["a", "b", "c"]);
    });

    it("skips FOR_EACH when items is not an array", async () => {
      const cf = new ControlFlowManager(fakeVars({ x: 42 }));
      expect(await collect(cf.createLoopIterator({ type: LoopType.FOR_EACH, items: "x" }))).toEqual([]);
    });

    it("caps a WHILE loop at maxIterations", async () => {
      const cf = new ControlFlowManager(fakeVars({ flag: true }));
      const out = await collect(
        cf.createLoopIterator({ type: LoopType.WHILE, condition: "flag", maxIterations: 3 }),
      );
      expect(out).toHaveLength(3); // would be infinite without the cap
    });

    it("throws on an unknown loop type", async () => {
      const cf = new ControlFlowManager(fakeVars());
      await expect(collect(cf.createLoopIterator({ type: "bogus" }))).rejects.toThrow(
        /Unknown loop type/,
      );
    });
  });
});
