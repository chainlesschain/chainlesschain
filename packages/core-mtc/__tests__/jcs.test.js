import { describe, it, expect } from "vitest";

const { jcs } = require("../lib/jcs.js");

describe("JCS (RFC 8785) — canonicalize wrapper", () => {
  it("returns Buffer", () => {
    const out = jcs({ a: 1 });
    expect(Buffer.isBuffer(out)).toBe(true);
  });

  it("sorts object keys by Unicode code point", () => {
    const a = jcs({ b: 2, a: 1 }).toString("utf-8");
    const b = jcs({ a: 1, b: 2 }).toString("utf-8");
    expect(a).toBe(b);
    expect(a).toBe('{"a":1,"b":2}');
  });

  it("preserves array order", () => {
    const out = jcs([3, 1, 2]).toString("utf-8");
    expect(out).toBe("[3,1,2]");
  });

  it("emits no whitespace", () => {
    const out = jcs({ x: [1, { y: 2 }] }).toString("utf-8");
    expect(out).toBe('{"x":[1,{"y":2}]}');
  });

  it("normalizes nested objects", () => {
    const out = jcs({
      outer: { z: 26, a: 1 },
      arr: [{ b: 2, a: 1 }],
    }).toString("utf-8");
    expect(out).toBe('{"arr":[{"a":1,"b":2}],"outer":{"a":1,"z":26}}');
  });

  it("produces identical bytes regardless of input key order", () => {
    const v1 = jcs({ ns: "mtc/v1/did/000001", size: 1, root: "abc" });
    const v2 = jcs({ root: "abc", ns: "mtc/v1/did/000001", size: 1 });
    const v3 = jcs({ size: 1, root: "abc", ns: "mtc/v1/did/000001" });
    expect(v1.equals(v2)).toBe(true);
    expect(v2.equals(v3)).toBe(true);
  });

  it("handles strings with special characters per RFC 8785", () => {
    const out = jcs({ msg: "hello\nworld" }).toString("utf-8");
    expect(out).toBe('{"msg":"hello\\nworld"}');
  });
});
