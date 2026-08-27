import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CompressionOperationRegistry,
  DEFAULT_COMPRESSION_LIMITS,
  HARD_COMPRESSION_LIMITS,
  compressData,
  compressPayloadInPage,
  decompressData,
  decompressPayloadInPage,
  validateCompressionFormat,
  validateCompressionInput,
  validateDecompressionInput,
} from "../../../../../src/main/remote/browser-extension/handlers/compression.js";

function createChromeMock({ execute } = {}) {
  const executeScript = vi.fn(async ({ func, args = [] }) => [
    {
      result: execute ? await execute({ func, args }) : await func(...args),
    },
  ]);
  vi.stubGlobal("chrome", { scripting: { executeScript } });
  return { executeScript };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CompressionOperationRegistry", () => {
  it("uses finite defaults and clamps custom limits to hard ceilings", () => {
    expect(new CompressionOperationRegistry().getStats().limits).toEqual(
      DEFAULT_COMPRESSION_LIMITS,
    );
    const registry = new CompressionOperationRegistry(
      Object.fromEntries(
        Object.keys(HARD_COMPRESSION_LIMITS).map((key) => [
          key,
          Number.MAX_SAFE_INTEGER,
        ]),
      ),
    );
    expect(registry.getStats().limits).toEqual(HARD_COMPRESSION_LIMITS);
  });

  it("bounds global concurrency and permits only one operation per tab", () => {
    const registry = new CompressionOperationRegistry({
      maxActiveOperations: 2,
    });
    const first = registry.admit(1, "compress");
    const second = registry.admit(2, "decompress");
    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
    expect(registry.admit(1, "decompress")).toMatchObject({
      code: "OVERLOADED",
      scope: "compression_tab",
    });
    expect(registry.admit(3, "compress")).toMatchObject({
      code: "OVERLOADED",
      scope: "compression_operations",
    });
    expect(registry.release(first.lease)).toBe(true);
    expect(registry.admit(3, "compress").accepted).toBe(true);
    expect(registry.release(first.lease)).toBe(false);
  });
});

describe("compression boundaries", () => {
  it("validates formats, UTF-8 input bytes, and decompression byte arrays", () => {
    expect(validateCompressionFormat("brotli")).toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    expect(validateCompressionInput("你", 2)).toMatchObject({
      code: "OVERLOADED",
      scope: "compression_input",
    });
    expect(validateCompressionInput("你", 3)).toMatchObject({
      accepted: true,
      bytes: 3,
    });
    expect(validateDecompressionInput([0, 255], 2).accepted).toBe(true);
    expect(validateDecompressionInput([256], 2)).toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    expect(validateDecompressionInput([1, 2, 3], 2)).toMatchObject({
      code: "OVERLOADED",
      scope: "decompression_input",
    });
  });

  it("round-trips Unicode payloads through the self-contained page functions", async () => {
    const input = "bounded compression 你好 ".repeat(50);
    expect(compressPayloadInPage.toString()).not.toContain("overloaded(");
    expect(decompressPayloadInPage.toString()).not.toContain("overloaded(");
    const compressed = await compressPayloadInPage(input, "gzip", 64 * 1024);
    expect(compressed).toMatchObject({
      originalSize: new TextEncoder().encode(input).byteLength,
    });
    expect(compressed.compressedSize).toBeGreaterThan(0);

    await expect(
      decompressPayloadInPage(compressed.compressed, "gzip", 64 * 1024),
    ).resolves.toEqual({
      decompressed: input,
      decompressedSize: new TextEncoder().encode(input).byteLength,
    });
  });

  it("cancels page streams when compressed or decompressed output exceeds limits", async () => {
    const input = "output boundary ".repeat(100);
    await expect(
      compressPayloadInPage(input, "gzip", 1),
    ).resolves.toMatchObject({
      code: "OVERLOADED",
      scope: "compression_output",
    });
    const compressed = await compressPayloadInPage(input, "gzip", 64 * 1024);
    await expect(
      decompressPayloadInPage(compressed.compressed, "gzip", 8),
    ).resolves.toMatchObject({
      code: "OVERLOADED",
      scope: "decompression_output",
    });
  });
});

describe("bounded compression handlers", () => {
  it("round-trips through scripting.executeScript and reports UTF-8 sizes", async () => {
    const mock = createChromeMock();
    const input = "handler 你好";
    const compressed = await compressData(901, input, "gzip");
    expect(compressed.originalSize).toBe(
      new TextEncoder().encode(input).length,
    );
    await expect(
      decompressData(901, compressed.compressed, "gzip"),
    ).resolves.toMatchObject({ decompressed: input });
    expect(mock.executeScript).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid inputs before invoking Chrome", async () => {
    const mock = createChromeMock();
    await expect(compressData(902, null, "gzip")).resolves.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    await expect(compressData(902, "data", "brotli")).resolves.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    await expect(decompressData(902, [300], "gzip")).resolves.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    expect(mock.executeScript).not.toHaveBeenCalled();
  });

  it("serializes same-tab work and releases the operation after failure", async () => {
    let resolveExecution;
    createChromeMock({
      execute: () =>
        new Promise((resolveExecutionPromise) => {
          resolveExecution = resolveExecutionPromise;
        }),
    });
    const first = compressData(903, "first", "gzip");
    await vi.waitFor(() => expect(resolveExecution).toBeTypeOf("function"));
    await expect(compressData(903, "second", "gzip")).resolves.toMatchObject({
      code: "OVERLOADED",
      scope: "compression_tab",
    });
    resolveExecution({ error: "injected failure" });
    await expect(first).resolves.toEqual({ error: "injected failure" });

    globalThis.chrome.scripting.executeScript.mockRejectedValueOnce(
      new Error("Chrome failed"),
    );
    await expect(compressData(903, "third", "gzip")).resolves.toEqual({
      error: "Chrome failed",
    });
    globalThis.chrome.scripting.executeScript.mockResolvedValueOnce([
      { result: { compressed: [], originalSize: 0, compressedSize: 0 } },
    ]);
    await expect(compressData(903, "fourth", "gzip")).resolves.toMatchObject({
      compressed: [],
    });
  });
});
