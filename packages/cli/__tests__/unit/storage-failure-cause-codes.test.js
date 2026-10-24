import { describe, expect, it, vi } from "vitest";
import {
  storageFailureCauseCodes as codes,
  storageFailureCauseSuffix as suffix,
  storageFailureCodesFromMessage as parse,
} from "../../src/lib/storage-failure-cause-codes.js";

describe("bounded storage failure diagnostics", () => {
  it("preserves known nested failure codes without copying error text or paths", () => {
    const original = Object.assign(new Error("private path and payload"), {
      code: "EPERM",
    });
    const artifact = Object.assign(
      new Error("private artifact", { cause: original }),
      { code: "CC_EVOLUTION_ARTIFACT_STORE_FAILED" },
    );
    const outer = new Error("opaque wrapper", { cause: artifact });
    expect(codes(outer)).toEqual([
      "CC_EVOLUTION_ARTIFACT_STORE_FAILED",
      "EPERM",
    ]);
    const marker = suffix(outer);
    expect(marker).not.toContain("private");
    expect(parse("original operator error" + marker)).toEqual(codes(outer));
    expect(outer.cause).toBe(artifact);
    expect(artifact.cause).toBe(original);
  });
  it("never invokes code/cause accessors, Proxy traps or coercion hooks", () => {
    const touched = vi.fn(() => {
      throw new Error("diagnostic must not call user code");
    });
    const getters = {};
    Object.defineProperties(getters, {
      code: { get: touched },
      cause: { get: touched },
    });
    const proxy = new Proxy(
      {},
      {
        get: touched,
        getOwnPropertyDescriptor: touched,
        getPrototypeOf: touched,
      },
    );
    const hostileCode = { toString: touched, [Symbol.toPrimitive]: touched };
    for (const error of [
      getters,
      proxy,
      { code: hostileCode },
      Object.create(proxy),
    ])
      expect(codes(error)).toEqual([]);
    expect(parse(hostileCode)).toEqual([]);
    expect(touched).not.toHaveBeenCalled();
  });
  it("bounds cyclic/deep causes and omits arbitrary lookalike codes", () => {
    const first = { code: "EPERM" },
      second = { code: "EIO", cause: first };
    first.cause = second;
    expect(codes(first)).toEqual(["EPERM", "EIO"]);
    expect(
      codes({ code: "CC_EVOLUTION_PRIVATE_CREDENTIAL_MUST_NOT_LEAK" }),
    ).toEqual([]);
    let deep = { code: "ENOSPC" };
    for (let i = 0; i < 6; i++) deep = { cause: deep };
    expect(codes(deep)).toEqual([]);
  });
  it("strictly reprojects only supported complete markers with owned identifiers", () => {
    expect(parse("secret [storage_cause_codes: EPERM -> EIO]")).toEqual([
      "EPERM",
      "EIO",
    ]);
    for (const value of [
      "private EPERM",
      "[storage_cause_codes: EPERM]", // missing exact marker boundary
      "secret [storage_cause_codes: EPERM",
      "secret [storage_cause_codes: SECRET]",
      "secret [storage_cause_codes: EPERM] trailing",
      "secret [storage_cause_codes: ]",
      "secret [storage_cause_codes: " +
        Array(7).fill("EPERM").join(" -> ") +
        "]",
    ])
      expect(parse(value)).toEqual([]);
    const result = parse("x".repeat(10000) + " [storage_cause_codes: EPERM]");
    expect(result).toEqual(["EPERM"]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(suffix({ message: "private", code: "unknown" })).toBe("");
  });
});
