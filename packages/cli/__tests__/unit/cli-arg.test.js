import { describe, it, expect } from "vitest";
import { Command, InvalidArgumentError } from "commander";
import { intArg, floatArg } from "../../src/lib/cli-arg.js";

describe("cli-arg validating coercers", () => {
  describe("intArg", () => {
    const coerce = intArg("--limit");
    it("parses a valid integer string", () => {
      expect(coerce("50")).toBe(50);
    });
    it("throws InvalidArgumentError on a non-numeric value", () => {
      expect(() => coerce("abc")).toThrow(InvalidArgumentError);
      expect(() => coerce("abc")).toThrow(/--limit must be a whole number/);
    });
    it("enforces bounds", () => {
      expect(() => intArg("--lvl", { min: 0, max: 4 })("9")).toThrow(/<= 4/);
      expect(() => intArg("--lvl", { min: 1 })("0")).toThrow(/>= 1/);
    });
  });

  describe("floatArg", () => {
    const coerce = floatArg("--rate");
    it("parses a valid float string", () => {
      expect(coerce("0.25")).toBe(0.25);
    });
    it("throws InvalidArgumentError on a non-numeric value", () => {
      expect(() => coerce("x")).toThrow(InvalidArgumentError);
      expect(() => coerce("x")).toThrow(/--rate must be a number/);
    });
  });

  describe("commander integration", () => {
    const build = () => {
      const p = new Command();
      p.exitOverride();
      p.configureOutput({ writeErr: () => {} });
      p.option("--limit <n>", "max", intArg("--limit"));
      p.option("--rate <n>", "rate", floatArg("--rate", { min: 0 }));
      p.action(() => {});
      return p;
    };

    it("accepts valid values", async () => {
      const p = build();
      await p.parseAsync(["--limit", "10", "--rate", "0.5"], { from: "user" });
      expect(p.opts()).toEqual({ limit: 10, rate: 0.5 });
    });

    it("rejects bad input with commander.invalidArgument", async () => {
      let err;
      try {
        await build().parseAsync(["--limit", "abc"], { from: "user" });
      } catch (e) {
        err = e;
      }
      expect(err?.code).toBe("commander.invalidArgument");
    });
  });
});
