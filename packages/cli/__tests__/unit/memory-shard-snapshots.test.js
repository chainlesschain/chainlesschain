import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { applyMemoryCommand } from "@chainlesschain/context-memory-kernel";
import { createDurableMemoryFixture } from "../../scripts/persistent-capacity-benchmark.mjs";
import { SegmentedMemoryPort } from "../../src/lib/context-memory-kernel/segmented-memory-port.js";
import { MemoryShardSnapshots } from "../../src/lib/context-memory-kernel/memory-shard-snapshots.js";

const parent = fs.realpathSync.native(os.tmpdir());
const roots = [];
async function fixture(options = {}) {
  const root = fs.mkdtempSync(path.join(parent, "cc-memory-snapshots-"));
  roots.push(root);
  const filePath = path.join(root, "authority.json");
  const port = new SegmentedMemoryPort({ filePath, ...options });
  await port.importSnapshot(createDurableMemoryFixture(200));
  return { port, filePath };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (
      path.dirname(path.resolve(root)) !== parent ||
      !path.basename(root).startsWith("cc-memory-snapshots-")
    )
      throw Error("unsafe fixture cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("byte-verified decoded Memory snapshots", () => {
  it("rereads authority bytes on warm queries while avoiding repeated validation of unchanged bytes", async () => {
    const { port } = await fixture();
    const read = vi.spyOn(port, "_readShardBytes");
    const decode = vi.spyOn(port, "_decodeShard");
    const first = await port.listPage({ limit: 5 });
    expect(decode.mock.calls.length).toBeGreaterThan(0);
    read.mockClear();
    decode.mockClear();
    expect(await port.listPage({ limit: 5 })).toEqual(first);
    expect(read.mock.calls.length).toBeGreaterThan(0);
    expect(decode).not.toHaveBeenCalled();
  });
  it("does not let callers mutate the cached record graph", async () => {
    const { port } = await fixture();
    const first = await port.listPage({ limit: 5 });
    const expected = structuredClone(first);
    first.records[0].content = "caller replacement";
    first.records[0].tags.push("caller-tag");
    first.records[0].allowedSinks.length = 0;
    expect(await port.listPage({ limit: 5 })).toEqual(expected);
  });
  it.each(["validate-disk", "verified-memory"])(
    "rejects same-length authority corruption with preserved timestamps in %s mode",
    async (queryIndexCacheMode) => {
      const { port, filePath } = await fixture({ queryIndexCacheMode });
      const first = await port.listPage({ limit: 1 });
      const bucket = createHash("sha256")
        .update(first.records[0].memoryId)
        .digest("hex")
        .slice(0, 2);
      const manifest = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const shard = port._shardPath(bucket, manifest.shards[bucket]);
      const stat = fs.statSync(shard);
      const bytes = fs.readFileSync(shard);
      const changed = Buffer.from(bytes);
      const at = changed.indexOf(Buffer.from("persistent capacity"));
      expect(at).toBeGreaterThan(-1);
      changed[at] = "P".charCodeAt(0);
      fs.writeFileSync(shard, changed);
      fs.utimesSync(shard, stat.atime, stat.mtime);
      expect(changed.length).toBe(bytes.length);
      await expect(port.listPage({ limit: 1 })).rejects.toMatchObject({
        code: "CONTEXT_MEMORY_STORE_CORRUPT",
      });
    },
  );
  it("invalidates warm records after another port commits and after this port commits", async () => {
    const { port, filePath } = await fixture();
    let row = (await port.listPage({ limit: 1 })).records[0];
    for (const writer of [new SegmentedMemoryPort({ filePath }), port]) {
      const transition = applyMemoryCommand(row, {
        type: "reinforce",
        expectedRevision: row.revision,
        confidenceDelta: 0.01,
        authority: "test",
        at: "2026-10-29T00:00:00.000Z",
      });
      await writer.commit(transition, row.revision);
      row = transition.record;
      const page = await port.listPage({ limit: 20 });
      expect(
        page.records.find((value) => value.memoryId === row.memoryId),
      ).toEqual(row);
    }
  });
  it("supports a zero cache budget without skipping authority validation", async () => {
    const { port } = await fixture({ decodedShardCacheBytes: 0 });
    const first = await port.listPage({ limit: 3 });
    const decode = vi.spyOn(port, "_decodeShard");
    expect(await port.listPage({ limit: 3 })).toEqual(first);
    expect(decode.mock.calls.length).toBeGreaterThan(0);
  });
  it("does not expose cached plaintext after delete and purge commits", async () => {
    const { port, filePath } = await fixture();
    let row = (await port.listPage({ limit: 1 })).records[0];
    const writer = new SegmentedMemoryPort({ filePath });
    for (const type of ["delete", "purge"]) {
      const transition = applyMemoryCommand(row, {
        type,
        expectedRevision: row.revision,
        authority: "test",
        at: "2026-10-29T00:00:00.000Z",
        deletionFence: "snapshot-test-delete",
      });
      await writer.commit(transition, row.revision);
      row = transition.record;
      const visible = await port.listRecords();
      expect(visible.some((value) => value.memoryId === row.memoryId)).toBe(
        false,
      );
    }
    const tombstone = (
      await port.listRecords({ includeTombstones: true })
    ).find((value) => value.memoryId === row.memoryId);
    expect(tombstone).toEqual(row);
    expect(tombstone.state).toBe("purged");
  });
});

describe("decoded snapshot retention bounds", () => {
  it("evicts by source-byte budget and does not cache oversized snapshots", () => {
    const cache = new MemoryShardSnapshots(4);
    cache.observe("generation");
    const decode = vi.fn(() => ({}));
    const read = (bucket, value) =>
      cache.read("generation", bucket, Buffer.from(value), decode);
    read("a", "aaa");
    read("b", "bbb");
    read("a", "aaa");
    expect(decode).toHaveBeenCalledTimes(3);
    read("large", "large");
    read("large", "large");
    expect(decode).toHaveBeenCalledTimes(5);
  });
  it("limits retained graphs to 32 and never repopulates an old generation", () => {
    const cache = new MemoryShardSnapshots(100);
    cache.observe("old");
    const decode = vi.fn(() => ({}));
    for (let index = 0; index < 33; index++)
      cache.read("old", String(index), Buffer.from("x"), decode);
    cache.read("old", "0", Buffer.from("x"), decode);
    expect(decode).toHaveBeenCalledTimes(34);
    cache.observe("new");
    cache.read("old", "0", Buffer.from("x"), decode);
    cache.read("old", "0", Buffer.from("x"), decode);
    expect(decode).toHaveBeenCalledTimes(36);
    cache.read("new", "0", Buffer.from("x"), decode);
    cache.read("new", "0", Buffer.from("x"), decode);
    expect(decode).toHaveBeenCalledTimes(37);
  });
});
