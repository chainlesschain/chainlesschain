import { describe, expect, it, vi } from "vitest";

const { resolveIPFSBoundaries } = require("../ipfs-boundaries.js");
const { IPFSContentRuntime } = require("../ipfs-content-runtime.js");

function createRuntime(overrides = {}) {
  const boundaries = resolveIPFSBoundaries(overrides);
  return new IPFSContentRuntime(() => boundaries);
}

describe("IPFSContentRuntime", () => {
  it("collects bounded binary chunks and releases admission", async () => {
    const runtime = createRuntime();
    const unixfs = {
      cat: vi.fn(async function* () {
        yield Buffer.from("ab");
        yield new Uint8Array([99, 100]);
      }),
    };

    await expect(runtime.read(unixfs, {}, 4)).resolves.toEqual(
      Buffer.from("abcd"),
    );
    expect(runtime.activeReads.size).toBe(0);
  });

  it("closes a stream before retaining bytes above the budget", async () => {
    const runtime = createRuntime();
    const iterator = {
      index: 0,
      next: vi.fn(async function () {
        const values = [Buffer.from("abc"), Buffer.from("def")];
        return this.index < values.length
          ? { value: values[this.index++], done: false }
          : { done: true };
      }),
      return: vi.fn(async () => ({ done: true })),
    };
    const unixfs = {
      cat: () => ({ [Symbol.asyncIterator]: () => iterator }),
    };

    await expect(runtime.read(unixfs, {}, 5)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      limitBytes: 5,
    });
    expect(iterator.return).toHaveBeenCalledOnce();
    expect(runtime.activeReads.size).toBe(0);
  });

  it("returns overload and stop cancels an admitted stalled read", async () => {
    const runtime = createRuntime({
      maxConcurrentReads: 1,
      readTimeoutMs: 1000,
      retryAfterMs: 25,
    });
    const iterator = {
      next: vi.fn(() => new Promise(() => {})),
      return: vi.fn(async () => ({ done: true })),
    };
    const unixfs = {
      cat: () => ({ [Symbol.asyncIterator]: () => iterator }),
    };

    const first = runtime.read(unixfs, {}, 10).catch((error) => error);
    expect(runtime.activeReads.size).toBe(1);
    await expect(runtime.read(unixfs, {}, 10)).rejects.toMatchObject({
      code: "OVERLOADED",
      retryAfterMs: 25,
    });

    runtime.stop();
    expect(await first).toMatchObject({ code: "CANCELLED" });
    expect(iterator.return).toHaveBeenCalledOnce();
    expect(runtime.activeReads.size).toBe(0);
  });

  it("bounds writes and fences tokens across stop", () => {
    const runtime = createRuntime({
      maxConcurrentWrites: 1,
      retryAfterMs: 25,
    });
    const token = runtime.acquireWrite();
    expect(() => runtime.acquireWrite()).toThrowError(
      expect.objectContaining({
        code: "OVERLOADED",
        reason: "write admission full",
      }),
    );

    runtime.stop();
    expect(() => runtime.assertWriteActive(token)).toThrowError(
      expect.objectContaining({ code: "CANCELLED" }),
    );
    runtime.releaseWrite(token);
    expect(runtime.activeWrites.size).toBe(0);
  });
});
