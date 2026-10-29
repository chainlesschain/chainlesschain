import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { dirname, join, basename, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setImmediate as nextTurn } from "node:timers/promises";
import { applyMemoryCommand } from "@chainlesschain/context-memory-kernel";
import { createDurableMemoryFixture } from "../../scripts/persistent-capacity-benchmark.mjs";
import { SegmentedMemoryPort } from "../../src/lib/context-memory-kernel/segmented-memory-port.js";
import { CliCanonicalMemoryService } from "../../src/lib/context-memory-kernel/memory-service.js";
import { prepareCanonicalProviderContext } from "../../src/lib/context-memory-kernel/provider-context.js";
import { withFileLockAsync } from "../../src/lib/with-file-lock.js";

const temporaryParent = fs.realpathSync.native(tmpdir());
const roots = [];
function location() {
  const root = fs.mkdtempSync(join(temporaryParent, "cc-memory-cancel-"));
  roots.push(root);
  return join(root, "authority.json");
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(options = {}) {
  const filePath = location();
  const state = createDurableMemoryFixture(400);
  const port = new SegmentedMemoryPort({ filePath, ...options });
  await port.importSnapshot(state);
  return { filePath, state, port };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (
      dirname(resolve(root)) !== temporaryParent ||
      !basename(root).startsWith("cc-memory-cancel-")
    )
      throw new Error(
        "memory cancellation cleanup escaped its temporary parent",
      );
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("cancellable disk Memory queries", () => {
  it("rejects a pre-aborted list without creating an authority or lock", async () => {
    const filePath = location();
    const port = new SegmentedMemoryPort({ filePath });
    const controller = new AbortController();
    controller.abort();
    const service = new CliCanonicalMemoryService({
      runtime: { memoryPort: port },
    });
    await expect(
      service.list({ signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fs.readdirSync(dirname(filePath))).toEqual([]);
  });

  it.each(["validate-disk", "verified-memory"])(
    "delivers a scheduled Stop during %s index traversal and releases ownership",
    async (queryIndexCacheMode) => {
      const { port, filePath } = await fixture({ queryIndexCacheMode });
      const controller = new AbortController();
      const original = port._readQueryIndex.bind(port);
      let traversed = 0;
      vi.spyOn(port, "_readQueryIndex").mockImplementation((...args) => {
        if (++traversed === 1) setImmediate(() => controller.abort());
        return original(...args);
      });
      await expect(
        port.listPage({ limit: 20, signal: controller.signal }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(traversed).toBeGreaterThan(0);
      expect(traversed).toBeLessThan(
        Object.keys(JSON.parse(fs.readFileSync(filePath)).shards).length,
      );
      expect(fs.existsSync(`${filePath}.lock`)).toBe(false);
      expect(
        (await new SegmentedMemoryPort({ filePath }).listPage({ limit: 20 }))
          .records,
      ).toHaveLength(20);
    },
  );

  it("aborts a lock waiter without reclaiming the live owner's lock", async () => {
    const { port, filePath } = await fixture();
    const entered = deferred(),
      release = deferred();
    const owner = withFileLockAsync(
      filePath,
      async () => {
        entered.resolve();
        await release.promise;
      },
      { failIfUnavailable: true },
    );
    await entered.promise;
    const ownerBytes = fs.readFileSync(join(`${filePath}.lock`, "owner.json"));
    const controller = new AbortController();
    try {
      const pending = port.listPage({ signal: controller.signal });
      setImmediate(() => controller.abort());
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      expect(fs.readFileSync(join(`${filePath}.lock`, "owner.json"))).toEqual(
        ownerBytes,
      );
    } finally {
      release.resolve();
      await owner;
    }
    expect(fs.existsSync(`${filePath}.lock`)).toBe(false);
    expect((await port.listPage()).records.length).toBeGreaterThan(0);
  });

  it("does not return a partial full snapshot after cancellation during shard decoding", async () => {
    const { port, filePath } = await fixture();
    const controller = new AbortController();
    const decode = port._decodeShard.bind(port);
    let decoded = 0;
    vi.spyOn(port, "_decodeShard").mockImplementation((...args) => {
      const result = decode(...args);
      if (++decoded === 1) controller.abort();
      return result;
    });
    await expect(
      port.query(undefined, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(decoded).toBe(1);
    expect(fs.existsSync(`${filePath}.lock`)).toBe(false);
  });

  it("keeps one generation while a same-process writer waits across query yields", async () => {
    const { filePath, state } = await fixture();
    const entered = deferred();
    const reader = new SegmentedMemoryPort({
      filePath,
      lockObserver: () => entered.resolve(),
    });
    const writer = new SegmentedMemoryPort({ filePath });
    const record = Object.values(state.records)[0];
    const transition = applyMemoryCommand(record, {
      type: "reinforce",
      expectedRevision: record.revision,
      confidenceDelta: 0.01,
      authority: "test",
      at: "2026-10-29T00:00:00.000Z",
    });
    const pending = reader.listPage({ limit: 1000 });
    await entered.promise;
    const write = writer.commit(transition, record.revision);
    const [page, committed] = await Promise.all([pending, write]);
    expect(page.storeRevision).toBe(state.storeRevision);
    expect(
      page.records.find((row) => row.memoryId === record.memoryId),
    ).toEqual(record);
    expect(committed.ok).toBe(true);
    const next = await reader.listPage({ limit: 1000 });
    expect(next.storeRevision).toBe(state.storeRevision + 1);
    expect(
      next.records.find((row) => row.memoryId === record.memoryId),
    ).toEqual(transition.record);
  });

  it("cancels provider Memory recall before producing a model context plan", async () => {
    const { filePath } = await fixture();
    const controller = new AbortController();
    const original = SegmentedMemoryPort.prototype._readQueryIndex;
    let traversed = 0;
    vi.spyOn(
      SegmentedMemoryPort.prototype,
      "_readQueryIndex",
    ).mockImplementation(function (...args) {
      if (++traversed === 1) {
        setImmediate(() => controller.abort());
      }
      return original.apply(this, args);
    });
    await expect(
      prepareCanonicalProviderContext(
        [{ role: "user", content: "capacity records" }],
        {
          signal: controller.signal,
          provider: "ollama",
          model: "test-local-model",
          sessionId: "memory-cancel-test",
          contextMemoryEnv: {
            CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default",
          },
          contextMemoryFilePath: filePath,
          contextMemoryScopeAdmissions: [
            { scope: "project", scopeId: "persistent-capacity" },
          ],
          contextMemoryToolDefinitions: [],
        },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(traversed).toBeGreaterThan(0);
    expect(traversed).toBeLessThan(
      Object.keys(JSON.parse(fs.readFileSync(filePath)).shards).length,
    );
    await nextTurn();
    expect(fs.existsSync(`${filePath}.lock`)).toBe(false);
  });
});
