import { afterEach, describe, expect, it, vi } from "vitest";
import fs, {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  linkSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  applyMemoryCommand,
  canonicalDigest,
  normalizeMemoryRecord,
  rankMemoryRecords,
} from "@chainlesschain/context-memory-kernel";
import { createDurableMemoryFixture } from "../../scripts/persistent-capacity-benchmark.mjs";
import {
  SegmentedMemoryPort,
  SEGMENTED_STORE_SCHEMA,
} from "../../src/lib/context-memory-kernel/segmented-memory-port.js";
import {
  DurableJsonMemoryPort,
  stateDigest,
} from "../../src/lib/context-memory-kernel/durable-memory-port.js";
import { CliCanonicalMemoryService } from "../../src/lib/context-memory-kernel/memory-service.js";
import { compareMemoryRows } from "../../src/lib/context-memory-kernel/memory-query-index.js";

const roots = [];
const portUrl = new URL(
  "../../src/lib/context-memory-kernel/segmented-memory-port.js",
  import.meta.url,
).href;
function fixture(count = 200) {
  const state = createDurableMemoryFixture(count);
  Object.entries(state.records).forEach(([id, record], index) => {
    state.records[id] = normalizeMemoryRecord({
      ...record,
      digest: undefined,
      category: index % 3 === 0 ? "special" : "general",
      scopeId: index % 4 === 0 ? "other-project" : "persistent-capacity",
      allowedSinks: index % 5 === 0 ? ["private"] : ["provider.local"],
    });
    const event = {
      ...state.events[index],
      recordDigest: state.records[id].digest,
    };
    delete event.digest;
    event.digest = canonicalDigest(event, "chainlesschain.memory-event/v1");
    state.events[index] = event;
  });
  state.digest = stateDigest(state);
  return state;
}
async function setup(count) {
  const root = mkdtempSync(join(tmpdir(), "cc-memory-query-"));
  roots.push(root);
  const filePath = join(root, "authority.json");
  const port = new SegmentedMemoryPort({ filePath });
  const state = fixture(count);
  await port.importSnapshot(state);
  return { port, state, filePath };
}
function indexes(port) {
  return readdirSync(port.shardDirectory)
    .filter((name) => name.startsWith("query-"))
    .map((name) => join(port.shardDirectory, name));
}
function reinforce(record) {
  return applyMemoryCommand(record, {
    type: "reinforce",
    expectedRevision: record.revision,
    confidenceDelta: 0.01,
    authority: "test",
    at: "2026-10-05T00:00:00.000Z",
  });
}
afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

describe("authority-bound memory business index", () => {
  it("pushes service filters and limit down, preserving full-scan order with fewer authority reads", async () => {
    const { port, state } = await setup(1000);
    const service = new CliCanonicalMemoryService({
      runtime: { memoryPort: port },
    });
    const read = vi.spyOn(port, "_readShardBytes");
    const actual = await service.list({ category: "special", limit: 7 });
    const expected = Object.values(state.records)
      .filter((row) => row.category === "special")
      .sort(compareMemoryRows)
      .slice(0, 7);
    expect(actual.map((row) => row.id)).toEqual(
      expected.map((row) => row.memoryId),
    );
    expect(read.mock.calls.length).toBeLessThanOrEqual(7);
    expect(read.mock.calls.length).toBeGreaterThan(0);
  });

  it("pages stable ties across reopened readers without duplicates, filtering scope/sink/tags before limits", async () => {
    const { port, state, filePath } = await setup(350);
    const options = {
      category: "special",
      scopeAdmissions: [{ scope: "project", scopeId: "persistent-capacity" }],
      sink: "provider.local",
      tags: ["bucket-3", "bucket-7"],
      limit: 2,
    };
    const expected = Object.values(state.records)
      .filter(
        (row) =>
          row.category === "special" &&
          row.scopeId === "persistent-capacity" &&
          row.allowedSinks.includes("provider.local") &&
          row.tags.some((tag) => options.tags.includes(tag)),
      )
      .sort(compareMemoryRows);
    const actual = [];
    let cursor = null;
    do {
      const page = await new SegmentedMemoryPort({ filePath }).listPage({
        ...options,
        cursor,
      });
      expect(page.storeRevision).toBe(350);
      actual.push(...page.records);
      cursor = page.nextCursor;
    } while (cursor);
    expect(actual).toEqual(expected);
    expect(
      (await port.listPage({ scopeAdmissions: [], limit: 1 })).records,
    ).toEqual([]);
    const publicPage = await new CliCanonicalMemoryService({
      runtime: { memoryPort: port },
    }).listPage(options);
    expect(publicPage.entries.map((entry) => entry.id)).toEqual(
      expected.slice(0, 2).map((record) => record.memoryId),
    );
  });

  it("binds cursors to filter, authority and generation, rejecting malformed and deleted-generation cursors", async () => {
    const { port, filePath } = await setup(60);
    const page = await port.listPage({ limit: 3 });
    for (const options of [
      { category: "special" },
      { sink: "private" },
      { cursor: "garbage" },
    ])
      await expect(
        port.listPage({ cursor: page.nextCursor, ...options }),
      ).rejects.toMatchObject({ code: "CONTEXT_MEMORY_CURSOR_INVALID" });
    const other = await setup(60);
    await expect(
      other.port.listPage({ cursor: page.nextCursor }),
    ).rejects.toMatchObject({ code: "CONTEXT_MEMORY_CURSOR_INVALID" });
    const record = page.records[0];
    const transition = applyMemoryCommand(record, {
      type: "delete",
      expectedRevision: record.revision,
      deletionFence: "delete-test-fence",
      authority: "test",
      at: "2026-10-05T00:00:00.000Z",
    });
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { SegmentedMemoryPort } from ${JSON.stringify(portUrl)}; const port = new SegmentedMemoryPort({ filePath: ${JSON.stringify(filePath)} }); console.log(JSON.stringify(await port.commit(${JSON.stringify(transition)}, 1)));`,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    await expect(
      port.listPage({ cursor: page.nextCursor }),
    ).rejects.toMatchObject({ code: "CONTEXT_MEMORY_CURSOR_INVALID" });
    expect(
      (await port.listRecords()).some(
        (row) => row.memoryId === record.memoryId,
      ),
    ).toBe(false);
    expect((await port.exportSnapshot()).events.at(-1)).toEqual(
      transition.event,
    );
    expect(await port.commit(transition, 1)).toMatchObject({
      ok: false,
      currentRevision: 2,
    });
  });

  it.each(["missing", "truncated", "stale"])(
    "rebuilds %s indexes from authority even with a warm decoded cache",
    async (failure) => {
      const { port, state } = await setup(100);
      const expected = await port.listRecords({ limit: 5 });
      const files = indexes(port);
      const original = files.map((file) => readFileSync(file));
      if (failure === "missing") files.forEach((file) => rmSync(file));
      else
        files.forEach((file, index) =>
          writeFileSync(
            file,
            failure === "truncated"
              ? "{"
              : original[(index + 1) % original.length],
          ),
        );
      expect(await port.listRecords({ limit: 5 })).toEqual(expected);
      files.forEach((file, index) =>
        expect(readFileSync(file)).toEqual(original[index]),
      );
      expect(await port.exportSnapshot()).toEqual(state);
    },
  );

  it("fails closed when authoritative rebuild is corrupt or when publishing the repair fails", async () => {
    const { port } = await setup(30);
    const file = indexes(port)[0];
    await port.listPage();
    rmSync(file);
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (to === file) throw new Error("injected index repair failure");
      return rename(from, to);
    });
    syncBuiltinESMExports();
    await expect(port.listPage()).rejects.toThrow(
      "injected index repair failure",
    );
    vi.restoreAllMocks();
    syncBuiltinESMExports();
    const manifest = JSON.parse(readFileSync(port.filePath));
    const bucket = file
      .split(/query-/u)
      .at(-1)
      .slice(0, 2);
    writeFileSync(
      port._shardPath(bucket, manifest.shards[bucket]),
      "bad authority",
    );
    await expect(port.listPage()).rejects.toMatchObject({
      code: "CONTEXT_MEMORY_STORE_CORRUPT",
    });
  });

  it("rejects unsafe index links and a descriptor that cannot be derived from authority", async () => {
    const { port } = await setup(20);
    const file = indexes(port)[0];
    linkSync(file, `${file}.linked`);
    await expect(port.listPage()).rejects.toMatchObject({
      code: "CONTEXT_MEMORY_STORE_CORRUPT",
    });
    rmSync(`${file}.linked`);
    const manifest = JSON.parse(readFileSync(port.filePath));
    const bucket = Object.keys(manifest.shards)[0];
    manifest.shards[bucket].queryDigest = `sha256:${"a".repeat(64)}`;
    delete manifest.digest;
    manifest.digest = canonicalDigest(manifest, SEGMENTED_STORE_SCHEMA);
    writeFileSync(port.filePath, JSON.stringify(manifest));
    await expect(port.listPage()).rejects.toMatchObject({
      code: "CONTEXT_MEMORY_STORE_CORRUPT",
    });
  });

  it("retains one captured generation during a competing CAS commit and shard collection", async () => {
    const { port, filePath } = await setup(200);
    const before = await port.listPage({ limit: 4 });
    const transition = reinforce(before.records[0]);
    const decode = port._decodeShard.bind(port);
    let write;
    vi.spyOn(port, "_decodeShard").mockImplementation((...args) => {
      // Validation is after lock release. A distinct process can commit and
      // collect the old files before this reader validates its owned buffers.
      write ??= JSON.parse(
        execFileSync(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `import { SegmentedMemoryPort } from ${JSON.stringify(portUrl)}; const port = new SegmentedMemoryPort({ filePath: ${JSON.stringify(filePath)} }); console.log(JSON.stringify(await port.commit(${JSON.stringify(transition)}, 1)));`,
          ],
          { cwd: process.cwd(), encoding: "utf8" },
        ),
      );
      return decode(...args);
    });
    const snapshot = await port.listPage({ limit: 4 });
    expect(snapshot).toEqual(before);
    expect(await write).toMatchObject({ ok: true });
    await expect(
      port.listPage({ cursor: snapshot.nextCursor }),
    ).rejects.toMatchObject({ code: "CONTEXT_MEMORY_CURSOR_INVALID" });
    expect(await port.read(transition.record.memoryId)).toEqual(
      transition.record,
    );
  });

  it("pushes recall permission gates without truncating lexical candidates before kernel ranking", async () => {
    const { port } = await setup(300);
    const request = {
      query: "persistent capacity record 123",
      sink: "provider.local",
      scopeAdmissions: [{ scope: "project", scopeId: "persistent-capacity" }],
      limit: 1,
      tokenBudget: 4096,
      now: "2026-10-05T00:00:00.000Z",
    };
    const full = await port.query();
    const filtered = await port.query(request);
    expect(filtered.length).toBeGreaterThan(request.limit);
    expect(filtered.length).toBeLessThan(full.length);
    expect(rankMemoryRecords(filtered, request)).toEqual(
      rankMemoryRecords(full, request),
    );
  });

  it("keeps shadow v1/v2 reads write-free and upgrades old v2 without audit or revision changes", async () => {
    const { port, state, filePath } = await setup(20);
    const manifest = JSON.parse(readFileSync(filePath));
    indexes(port).forEach((file) => rmSync(file));
    for (const descriptor of Object.values(manifest.shards)) {
      delete descriptor.queryDigest;
      delete descriptor.queryBytes;
    }
    delete manifest.digest;
    manifest.digest = canonicalDigest(manifest, SEGMENTED_STORE_SCHEMA);
    writeFileSync(filePath, JSON.stringify(manifest));
    const before = readFileSync(filePath);
    const shadow = new SegmentedMemoryPort({ filePath, readOnly: true });
    expect((await shadow.listPage()).records).toHaveLength(20);
    expect(indexes(port)).toHaveLength(0);
    expect(readFileSync(filePath)).toEqual(before);
    await port.listPage();
    expect(indexes(port).length).toBeGreaterThan(0);
    expect(await port.exportSnapshot()).toEqual(state);
    const legacyPath = join(roots.at(-1), "legacy.json");
    writeFileSync(legacyPath, JSON.stringify(state));
    const legacy = new DurableJsonMemoryPort({ filePath: legacyPath });
    const legacyShadow = new SegmentedMemoryPort({
      filePath: legacyPath,
      readOnly: true,
    });
    const page = await legacy.listPage({ limit: 2 });
    expect(
      await legacyShadow.listPage({ limit: 2, cursor: page.nextCursor }),
    ).toEqual(await legacy.listPage({ limit: 2, cursor: page.nextCursor }));
    expect(JSON.parse(readFileSync(legacyPath))).toEqual(state);
  });
});
