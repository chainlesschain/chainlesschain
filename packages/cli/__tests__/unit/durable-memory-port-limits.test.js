import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDurableMemoryFixture } from "../../scripts/persistent-capacity-benchmark.mjs";
import {
  DurableJsonMemoryPort,
  stateDigest,
} from "../../src/lib/context-memory-kernel/durable-memory-port.js";

const roots = [];
function location() {
  const root = mkdtempSync(join(tmpdir(), "cc-memory-limits-"));
  roots.push(root);
  return join(root, "kernel-v1.json");
}
function seed(filePath, state) {
  state.digest = stateDigest(state);
  const bytes = Buffer.from(`${JSON.stringify(state)}\n`);
  writeFileSync(filePath, bytes);
  return bytes;
}
function proposal() {
  const state = createDurableMemoryFixture(2);
  return { record: Object.values(state.records)[1], event: state.events[1] };
}

afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

describe("durable memory storage limits", () => {
  it("bounds a file that grows after fstat and closes its descriptor", async () => {
    const filePath = location();
    const before = seed(filePath, createDurableMemoryFixture(1));
    const maximum = before.length + 8;
    const originalStat = fs.fstatSync;
    const originalRead = fs.readSync;
    let target = null;
    let readBytes = 0;
    const closed = vi.spyOn(fs, "closeSync");
    vi.spyOn(fs, "fstatSync").mockImplementation((descriptor, ...args) => {
      const stat = originalStat(descriptor, ...args);
      if (stat.size === before.length && target === null) {
        target = descriptor;
        fs.appendFileSync(filePath, Buffer.alloc(1024, 32));
      }
      return stat;
    });
    vi.spyOn(fs, "readSync").mockImplementation((descriptor, ...args) => {
      const count = originalRead(descriptor, ...args);
      if (descriptor === target) readBytes += count;
      return count;
    });
    syncBuiltinESMExports();
    const port = new DurableJsonMemoryPort({
      filePath,
      maxStoreBytes: maximum,
    });
    await expect(port.query()).rejects.toMatchObject({
      code: "CONTEXT_MEMORY_STORE_CORRUPT",
    });
    expect(target).not.toBeNull();
    expect(readBytes).toBe(maximum + 1);
    expect(closed).toHaveBeenCalledWith(target);
  });

  it.each(["commit", "reconciliation"])(
    "rejects an oversized %s without losing readable records or audit history",
    async (operation) => {
      const filePath = location();
      const state = createDurableMemoryFixture(1);
      const before = seed(filePath, state);
      const port = new DurableJsonMemoryPort({
        filePath,
        maxStoreBytes: before.length,
      });
      await expect(port.getRevision()).resolves.toBe(1);
      await expect(
        operation === "commit"
          ? port.commit(proposal(), 0)
          : port.putReconciliation({ requestId: "larger", text: "中文😀" }),
      ).rejects.toMatchObject({ code: "CONTEXT_MEMORY_STORE_LIMIT" });
      expect(readFileSync(filePath)).toEqual(before);
      expect(readdirSync(join(filePath, ".."))).toEqual(["kernel-v1.json"]);
      const restarted = new DurableJsonMemoryPort({ filePath });
      await expect(restarted.getRevision()).resolves.toBe(1);
      await expect(restarted.query()).resolves.toEqual(
        Object.values(state.records),
      );
      await expect(restarted.getReconciliation("larger")).resolves.toBeNull();
      // Failed capacity checks must leave the lock reusable.
      await expect(restarted.commit(proposal(), 0)).resolves.toMatchObject({
        ok: true,
        storeRevision: 2,
      });
    },
  );

  it("rejects an oversized first commit before creating a store", async () => {
    const filePath = location();
    const port = new DurableJsonMemoryPort({ filePath, maxStoreBytes: 1 });
    await expect(port.commit(proposal(), 0)).rejects.toMatchObject({
      code: "CONTEXT_MEMORY_STORE_LIMIT",
    });
    expect(existsSync(filePath)).toBe(false);
    expect(readdirSync(join(filePath, ".."))).toEqual([]);
  });

  it("accepts the exact UTF-8 byte boundary, including the newline", async () => {
    const reference = location();
    await new DurableJsonMemoryPort({ filePath: reference }).commit(
      proposal(),
      0,
    );
    const expected = readFileSync(reference);
    const filePath = location();
    const port = new DurableJsonMemoryPort({
      filePath,
      maxStoreBytes: expected.length,
    });
    await expect(port.commit(proposal(), 0)).resolves.toMatchObject({
      ok: true,
    });
    expect(readFileSync(filePath)).toEqual(expected);
    await expect(port.query()).resolves.toHaveLength(1);
    const tooSmall = new DurableJsonMemoryPort({
      filePath,
      maxStoreBytes: expected.length - 1,
    });
    await expect(tooSmall.query()).rejects.toMatchObject({
      code: "CONTEXT_MEMORY_STORE_CORRUPT",
    });
    expect(readFileSync(filePath)).toEqual(expected);
  });

  it("counts multibyte reconciliation content in bytes", async () => {
    const reference = location();
    const operation = { requestId: "unicode", text: "中文😀".repeat(100) };
    await new DurableJsonMemoryPort({ filePath: reference }).putReconciliation(
      operation,
    );
    const expected = readFileSync(reference);
    const filePath = location();
    const port = new DurableJsonMemoryPort({
      filePath,
      maxStoreBytes: expected.toString("utf8").length,
    });
    await expect(port.putReconciliation(operation)).rejects.toMatchObject({
      code: "CONTEXT_MEMORY_STORE_LIMIT",
    });
    expect(existsSync(filePath)).toBe(false);
    const exact = new DurableJsonMemoryPort({
      filePath,
      maxStoreBytes: expected.length,
    });
    await expect(exact.putReconciliation(operation)).resolves.toMatchObject({
      ok: true,
    });
    await expect(exact.getReconciliation("unicode")).resolves.toEqual(
      operation,
    );
  });

  it.each(["commit", "reconciliation"])(
    "rejects exhausted store revisions during %s without persisting an unreadable state",
    async (operation) => {
      const filePath = location();
      const state = createDurableMemoryFixture(1);
      state.storeRevision = Number.MAX_SAFE_INTEGER;
      const before = seed(filePath, state);
      const port = new DurableJsonMemoryPort({ filePath });
      await expect(
        operation === "commit"
          ? port.commit(proposal(), 0)
          : port.putReconciliation({ requestId: "overflow" }),
      ).rejects.toMatchObject({ code: "CONTEXT_MEMORY_STORE_LIMIT" });
      expect(readFileSync(filePath)).toEqual(before);
      await expect(port.getRevision()).resolves.toBe(Number.MAX_SAFE_INTEGER);
      await expect(port.commit(proposal(), 3)).resolves.toMatchObject({
        ok: false,
        currentRevision: 0,
        storeRevision: Number.MAX_SAFE_INTEGER,
      });
    },
  );

  it("permits the final safe revision", async () => {
    const filePath = location();
    const state = createDurableMemoryFixture(1);
    state.storeRevision = Number.MAX_SAFE_INTEGER - 1;
    seed(filePath, state);
    const port = new DurableJsonMemoryPort({ filePath });
    await expect(port.commit(proposal(), 0)).resolves.toMatchObject({
      ok: true,
      storeRevision: Number.MAX_SAFE_INTEGER,
    });
    await expect(
      new DurableJsonMemoryPort({ filePath }).query(),
    ).resolves.toHaveLength(2);
  });

  it.each(["maxStoreBytes", "maxEvents"])(
    "rejects invalid %s configuration",
    (key) => {
      for (const value of [
        0,
        -1,
        1.5,
        NaN,
        Infinity,
        Number.MAX_SAFE_INTEGER + 1,
        "64",
      ]) {
        expect(() => new DurableJsonMemoryPort({ [key]: value })).toThrow(
          TypeError,
        );
      }
    },
  );
});
