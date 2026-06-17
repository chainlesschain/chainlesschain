/**
 * data-compression 测试 — src/renderer/utils/data-compression.ts
 *
 * DataCompressor over pako (present in node_modules) — real compress/decompress
 * round-trips. threshold:0 forces compression of small payloads; logger mocked.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
// The source does `const m = await import("pako"); this.pako = m` then calls
// m.deflate/m.inflate. Under vitest's interop pako lands only on `.default`, so
// re-export the real impl flat to match that access pattern (still real codec).
vi.mock("pako", async () => {
  const actual: any = await vi.importActual("pako");
  const p = actual.default ?? actual;
  return { default: p, ...p };
});

import DataCompressor, { getDataCompressor } from "@/utils/data-compression";

let c: DataCompressor;
beforeEach(async () => {
  // autoCompress:false → always compress (threshold:0 wouldn't work: the
  // constructor does `options.threshold || 1024`, so 0 falls back to 1024).
  c = new DataCompressor({ autoCompress: false });
  await c.init(); // load pako before use
});

describe("data-compression — round-trips", () => {
  it("compress→decompress returns the original string and updates stats", async () => {
    const text = "hello world ".repeat(8);
    const compressed = await c.compress(text);
    expect(compressed).toBeInstanceOf(Uint8Array);
    const back = await c.decompress(compressed);
    expect(back).toBe(text);
    expect(c.getStats().totalCompressed).toBe(1);
    expect(c.getStats().totalDecompressed).toBe(1);
  });

  it("base64 mode round-trips through a string", async () => {
    const text = "data ".repeat(10);
    const s = await c.compress(text, { base64: true });
    expect(typeof s).toBe("string");
    const back = await c.decompress(s as string, { fromBase64: true });
    expect(back).toBe(text);
  });

  it("compressJSON / decompressJSON preserve the object", async () => {
    const obj = { a: 1, b: [1, 2, 3], c: "x", nested: { y: true } };
    const comp = await c.compressJSON(obj);
    const back = await c.decompressJSON(comp);
    expect(back).toEqual(obj);
  });
});

describe("data-compression — threshold + stats", () => {
  it("returns data unchanged below the threshold (no compression)", async () => {
    const big = new DataCompressor(); // default threshold 1024, autoCompress on
    await big.init();
    const r = await big.compress("tiny");
    expect(r).toBe("tiny");
    expect(big.getStats().totalCompressed).toBe(0);
  });

  it("getCompressionRatio + getStats + resetStats", async () => {
    expect(c.getCompressionRatio(100, 25)).toBe("75.00");
    await c.compress("compress me ".repeat(20));
    const s = c.getStats();
    expect(s.totalCompressed).toBe(1);
    expect(s.averageCompressionRatio).toMatch(/%$/);
    c.resetStats();
    expect(c.getStats().totalCompressed).toBe(0);
  });
});

describe("data-compression — singleton", () => {
  it("getDataCompressor memoizes the instance", () => {
    expect(getDataCompressor()).toBe(getDataCompressor());
  });
});
