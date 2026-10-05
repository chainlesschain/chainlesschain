import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  linkSync,
  mkdirSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMemoryCommand } from "@chainlesschain/context-memory-kernel";
import { createDurableMemoryFixture } from "../../scripts/persistent-capacity-benchmark.mjs";
import {
  DurableJsonMemoryPort,
  stateDigest,
} from "../../src/lib/context-memory-kernel/durable-memory-port.js";
import {
  SegmentedMemoryPort,
  SEGMENTED_STORE_SCHEMA,
} from "../../src/lib/context-memory-kernel/segmented-memory-port.js";

const roots = [];
function location() {
  const root = mkdtempSync(join(tmpdir(), "cc-segmented-memory-"));
  roots.push(root);
  return join(root, "kernel-v1.json");
}
function reinforce(record) {
  return applyMemoryCommand(record, {
    type: "reinforce",
    expectedRevision: record.revision,
    confidenceDelta: 0.01,
    authority: "test",
    at: "2026-10-04T00:00:00.000Z",
  });
}
afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

describe("segmented memory authority", () => {
  it.skipIf(process.platform === "win32")(
    "reports post-publication failure when durable removal of superseded shards cannot be synced",
    async () => {
      const filePath = location();
      const port = new SegmentedMemoryPort({ filePath });
      const state = createDurableMemoryFixture(2);
      await port.importSnapshot(state);
      const transition = reinforce(Object.values(state.records)[0]);
      const rename = fs.renameSync;
      const sync = fs.fsyncSync;
      let published = false;
      let directorySyncs = 0;
      vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
        rename(from, to);
        if (to === filePath) published = true;
      });
      vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
        if (
          published &&
          fs.fstatSync(fd).isDirectory() &&
          ++directorySyncs === 2
        )
          throw new Error("injected GC directory sync");
        return sync(fd);
      });
      syncBuiltinESMExports();
      await expect(port.commit(transition, 1)).rejects.toMatchObject({
        code: "CONTEXT_MEMORY_COMMIT_PUBLISHED",
        committed: true,
        cleanupComplete: false,
      });
      expect(directorySyncs).toBe(2);
      vi.restoreAllMocks();
      syncBuiltinESMExports();
      expect(
        await new SegmentedMemoryPort({ filePath }).read(
          transition.record.memoryId,
        ),
      ).toEqual(transition.record);
    },
  );
  it("exports concentrated legacy audit without an argument-count limit", async () => {
    const state = createDurableMemoryFixture(1);
    state.events = Array.from({ length: 140000 }, () => ({
      type: "legacy.event",
    }));
    state.storeRevision = state.events.length;
    state.digest = stateDigest(state);
    const port = new SegmentedMemoryPort({ filePath: location() });
    await port.importSnapshot(state);
    expect((await port.exportSnapshot()).digest).toBe(state.digest);
  }, 30000);
  it("keeps the manifest bound independent from smaller bucket limits on reopen", async () => {
    const filePath = location();
    const port = new SegmentedMemoryPort({ filePath, maxStoreBytes: 8192 });
    await port.importSnapshot(createDurableMemoryFixture(100));
    expect(readFileSync(filePath).length).toBeGreaterThan(8192);
    expect(
      await new SegmentedMemoryPort({ filePath, maxStoreBytes: 8192 }).query(),
    ).toHaveLength(100);
  });
  it("rejects a symlink or junction parent before creating authority directories through it", async () => {
    const filePath = location();
    const root = join(filePath, "..");
    const target = join(root, "target");
    mkdirSync(target);
    const link = join(root, "linked");
    symlinkSync(
      target,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
    const port = new SegmentedMemoryPort({
      filePath: join(link, "nested", "authority.json"),
    });
    await expect(port.query()).rejects.toMatchObject({
      code: "CONTEXT_MEMORY_STORE_CORRUPT",
    });
    expect(readdirSync(target)).toEqual([]);
  });
  it("never confuses inherited object keys with stored record or reconciliation entries", async () => {
    const port = new SegmentedMemoryPort({ filePath: location() });
    expect(await port.read("constructor")).toBeNull();
    expect(await port.getReconciliation("constructor")).toBeNull();
    const operation = { requestId: "__proto__", status: "pending" };
    await port.putReconciliation(operation);
    expect(await port.getReconciliation("__proto__")).toEqual(operation);
    expect(
      Object.hasOwn((await port.exportSnapshot()).reconciliations, "__proto__"),
    ).toBe(true);
  });
  it("keeps shadow reads write-free for v1 and v2, including orphan collection", async () => {
    const filePath = location();
    const state = createDurableMemoryFixture(2);
    writeFileSync(filePath, JSON.stringify(state));
    const before = readFileSync(filePath);
    const shadow = new SegmentedMemoryPort({ filePath, readOnly: true });
    expect(await shadow.query()).toHaveLength(2);
    expect(await shadow.exportSnapshot()).toEqual(state);
    expect(readFileSync(filePath)).toEqual(before);
    await expect(
      shadow.commit(reinforce(Object.values(state.records)[0]), 1),
    ).rejects.toMatchObject({ code: "CONTEXT_MEMORY_READ_ONLY" });
    await new SegmentedMemoryPort({ filePath }).query();
    const orphan = join(shadow.shardDirectory, `00-${"a".repeat(64)}.json`);
    writeFileSync(orphan, "orphan");
    expect(await shadow.query()).toHaveLength(2);
    expect(readFileSync(orphan, "utf8")).toBe("orphan");
  });
  it("validates a captured generation after concurrent commit and GC without mixing generations", async () => {
    const filePath = location();
    const port = new SegmentedMemoryPort({ filePath });
    const state = createDurableMemoryFixture(50);
    await port.importSnapshot(state);
    const original = Object.values(state.records)[0];
    const transition = reinforce(original);
    const decode = port._decodeShard.bind(port);
    let changed = false;
    let write;
    vi.spyOn(port, "_decodeShard").mockImplementation((...args) => {
      if (!changed) {
        changed = true;
        write = new SegmentedMemoryPort({ filePath }).commit(transition, 1);
      }
      return decode(...args);
    });
    const snapshot = await port.query();
    expect(await write).toMatchObject({ ok: true });
    expect(
      snapshot.find((record) => record.memoryId === original.memoryId),
    ).toEqual(original);
    expect(await port.read(original.memoryId)).toEqual(transition.record);
  });
  it("migrates v1 losslessly, preserves global audit order and rejects old writers", async () => {
    const filePath = location();
    const state = createDurableMemoryFixture(100);
    writeFileSync(filePath, JSON.stringify(state));
    const port = new SegmentedMemoryPort({ filePath });
    expect(await port.exportSnapshot()).toEqual(state);
    expect(JSON.parse(readFileSync(filePath)).schema).toBe(
      SEGMENTED_STORE_SCHEMA,
    );
    await expect(
      new DurableJsonMemoryPort({ filePath }).query(),
    ).rejects.toMatchObject({ code: "CONTEXT_MEMORY_STORE_CORRUPT" });
    expect(await new SegmentedMemoryPort({ filePath }).query()).toHaveLength(
      100,
    );
  });

  it("commits record, event and differently sharded reconciliation atomically; rejects stale CAS", async () => {
    const filePath = location();
    const port = new SegmentedMemoryPort({ filePath });
    const state = createDurableMemoryFixture(20);
    await port.importSnapshot(state);
    const record = Object.values(state.records)[0];
    const transition = {
      ...reinforce(record),
      reconciliation: { requestId: "cross-shard-reconcile", status: "pending" },
    };
    const [first, second] = await Promise.all([
      port.commit(transition, 1),
      new SegmentedMemoryPort({ filePath }).commit(transition, 1),
    ]);
    expect([first.ok, second.ok].sort()).toEqual([false, true]);
    expect(await port.getRevision()).toBe(21);
    expect(await port.getReconciliation("cross-shard-reconcile")).toEqual(
      transition.reconciliation,
    );
    const after = await port.exportSnapshot();
    expect(after.events).toEqual([...state.events, transition.event]);
    expect(after.records[record.memoryId]).toEqual(transition.record);
  });

  it.each(["migration", "commit"])(
    "preserves old authority and removes unpublished shards on %s rename failure",
    async (kind) => {
      const filePath = location();
      const state = createDurableMemoryFixture(10);
      const port = new SegmentedMemoryPort({ filePath });
      if (kind === "migration") writeFileSync(filePath, JSON.stringify(state));
      else await port.importSnapshot(state);
      const before = readFileSync(filePath);
      const rename = fs.renameSync;
      vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
        if (to === filePath)
          throw Object.assign(new Error("injected replacement failure"), {
            code: "EIO",
          });
        return rename(from, to);
      });
      syncBuiltinESMExports();
      await expect(
        kind === "migration"
          ? port.query()
          : port.commit(reinforce(Object.values(state.records)[0]), 1),
      ).rejects.toThrow("injected");
      expect(readFileSync(filePath)).toEqual(before);
      vi.restoreAllMocks();
      syncBuiltinESMExports();
      expect(await port.exportSnapshot()).toEqual(state);
      const manifest = JSON.parse(readFileSync(filePath));
      expect(
        readdirSync(port.shardDirectory).filter(
          (name) => !name.startsWith("query-"),
        ),
      ).toHaveLength(Object.keys(manifest.shards).length);
    },
  );

  it.each(["maxTotalBytes", "maxEvents", "maxStoreBytes"])(
    "enforces %s before replacing authority",
    async (name) => {
      const filePath = location();
      const state = createDurableMemoryFixture(2);
      const port = new SegmentedMemoryPort({ filePath });
      await port.importSnapshot(state);
      const manifest = JSON.parse(readFileSync(filePath));
      const before = readFileSync(filePath);
      const limit =
        name === "maxTotalBytes"
          ? manifest.totalBytes
          : name === "maxEvents"
            ? 2
            : 100;
      const bounded = new SegmentedMemoryPort({ filePath, [name]: limit });
      await expect(
        bounded.commit(reinforce(Object.values(state.records)[0]), 1),
      ).rejects.toBeDefined();
      expect(readFileSync(filePath)).toEqual(before);
      expect(await port.exportSnapshot()).toEqual(state);
    },
  );

  it.each(["fsync", "gc"])(
    "reports published state after post-rename %s failure and never replays stale CAS",
    async (failure) => {
      const filePath = location();
      const port = new SegmentedMemoryPort({ filePath });
      const state = createDurableMemoryFixture(10);
      await port.importSnapshot(state);
      const transition = reinforce(Object.values(state.records)[0]);
      let published = false;
      const rename = fs.renameSync;
      const sync = fs.fsyncSync;
      vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
        rename(from, to);
        if (to === filePath) published = true;
      });
      if (failure === "fsync") {
        // Windows skips directory fsync, so inject immediately after replacement
        // through the same post-publication maintenance boundary on that OS.
        if (process.platform === "win32") {
          const collect = port._collect.bind(port);
          vi.spyOn(port, "_collect").mockImplementation((manifest) => {
            if (published) throw new Error("injected fsync boundary");
            return collect(manifest);
          });
        } else
          vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
            if (published) throw new Error("injected sync");
            return sync(fd);
          });
      } else {
        const collect = port._collect.bind(port);
        vi.spyOn(port, "_collect").mockImplementation((manifest) => {
          if (published) throw new Error("injected cleanup");
          return collect(manifest);
        });
      }
      syncBuiltinESMExports();
      await expect(port.commit(transition, 1)).rejects.toMatchObject({
        code: "CONTEXT_MEMORY_COMMIT_PUBLISHED",
        committed: true,
        storeRevision: 11,
        cleanupComplete: false,
      });
      vi.restoreAllMocks();
      syncBuiltinESMExports();
      const reopened = new SegmentedMemoryPort({ filePath });
      expect(await reopened.read(transition.record.memoryId)).toEqual(
        transition.record,
      );
      expect(await reopened.commit(transition, 1)).toMatchObject({
        ok: false,
        currentRevision: 2,
        storeRevision: 11,
      });
      expect((await reopened.exportSnapshot()).events).toEqual([
        ...state.events,
        transition.event,
      ]);
    },
  );

  it("detects corrupt shards and hard-linked authorities without mutating them", async () => {
    const filePath = location();
    const port = new SegmentedMemoryPort({ filePath });
    const state = createDurableMemoryFixture(2);
    await port.importSnapshot(state);
    const shard = join(
      port.shardDirectory,
      readdirSync(port.shardDirectory)[0],
    );
    const bytes = readFileSync(shard);
    writeFileSync(shard, "corrupt");
    await expect(port.query()).rejects.toMatchObject({
      code: "CONTEXT_MEMORY_STORE_CORRUPT",
    });
    writeFileSync(shard, bytes);
    linkSync(filePath, `${filePath}.linked`);
    await expect(port.query()).rejects.toMatchObject({
      code: "CONTEXT_MEMORY_STORE_CORRUPT",
    });
  });

  it("collects crash leftovers under the authority lock and retains unknown files", async () => {
    const filePath = location();
    const port = new SegmentedMemoryPort({ filePath });
    await port.importSnapshot(createDurableMemoryFixture(2));
    const orphan = `00-${"a".repeat(64)}.json`;
    writeFileSync(join(port.shardDirectory, orphan), "interrupted write");
    writeFileSync(join(port.shardDirectory, "user-file"), "keep");
    expect(await port.query()).toHaveLength(2);
    expect(readdirSync(port.shardDirectory)).not.toContain(orphan);
    expect(readFileSync(join(port.shardDirectory, "user-file"), "utf8")).toBe(
      "keep",
    );
  });

  it("point reads only open their hash bucket; listing retains production sort semantics", async () => {
    const filePath = location();
    const state = createDurableMemoryFixture(300);
    const port = new SegmentedMemoryPort({ filePath });
    await port.importSnapshot(state);
    const spy = vi.spyOn(port, "_readShard");
    const record = Object.values(state.records)[123];
    expect(await port.read(record.memoryId)).toEqual(record);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await port.listRecords()).toHaveLength(300);
  });
});
