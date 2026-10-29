import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { applyMemoryCommand } from "@chainlesschain/context-memory-kernel";
import { SegmentedMemoryPort } from "../../src/lib/context-memory-kernel/segmented-memory-port.js";
import { compareMemoryRows } from "../../src/lib/context-memory-kernel/memory-query-index.js";
import { stateDigest } from "../../src/lib/context-memory-kernel/durable-memory-port.js";
import { createDurableMemoryFixture } from "../../scripts/persistent-capacity-benchmark.mjs";
import { loadLegacySegmentedMemoryPort } from "../helpers/legacy-segmented-memory-port.js";

const temporaryParent = fs.realpathSync.native(os.tmpdir());
const roots = [];
const workers = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const worker of workers.splice(0)) {
    if (worker.child.exitCode === null && worker.child.signalCode === null)
      worker.child.kill();
    await worker.done;
  }
  for (const root of roots.splice(0)) {
    if (
      path.dirname(path.resolve(root)) !== temporaryParent ||
      !path.basename(root).startsWith("cc-query-bundle-legacy-")
    )
      throw new Error("unsafe legacy bundle fixture cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function fixture(count = 40) {
  const root = fs.mkdtempSync(
    path.join(temporaryParent, "cc-query-bundle-legacy-"),
  );
  roots.push(root);
  const filePath = path.join(root, "authority.json");
  const port = new SegmentedMemoryPort({ filePath });
  const state = createDurableMemoryFixture(count);
  await port.importSnapshot(state);
  const expected = Object.values(state.records).sort(compareMemoryRows);
  expect(await port.listRecords()).toEqual(expected);
  const manifest = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const bundle = port._queryBundlePlan(manifest);
  expect(bundle).not.toBeNull();
  expect(fs.existsSync(bundle.file)).toBe(true);
  return { root, port, filePath, state, expected, manifest, bundle };
}

function transition(record, type) {
  return applyMemoryCommand(record, {
    type,
    expectedRevision: record.revision,
    confidenceDelta: 0.01,
    authority: "legacy-bundle-test",
    at: "2026-10-29T00:00:00.000Z",
    deletionFence: "legacy-bundle-delete-fence",
  });
}

function spawnLegacyWriter(filePath) {
  const helper = new URL(
    "../helpers/legacy-segmented-memory-port.js",
    import.meta.url,
  ).href;
  const code = `
    import fs from "node:fs";
    import path from "node:path";
    import { loadLegacySegmentedMemoryPort } from ${JSON.stringify(helper)};
    const send = (message) => new Promise((resolve, reject) =>
      process.send(message, (error) => error ? reject(error) : resolve()));
    const Legacy = await loadLegacySegmentedMemoryPort();
    const port = new Legacy({ filePath: process.argv[1] });
    process.once("message", async (message) => {
      try {
        if (message.type !== "commit") throw new Error("unexpected writer command");
        let settled = false;
        const commit = port.commit(message.transition, message.expectedRevision)
          .then((value) => { settled = true; return { value }; },
            (error) => { settled = true; return { error: { message: error.message, code: error.code } }; });
        await new Promise((resolve) => setImmediate(resolve));
        let owner = null;
        try { owner = fs.readFileSync(path.join(process.argv[1] + ".lock", "owner.json"), "utf8"); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
        await send({ type: "pending", settled, owner });
        const result = await commit;
        if (result.error) {
          process.exitCode = 1;
          await send({ type: "failed", ...result.error });
        } else await send({ type: "committed", result: result.value });
      } catch (error) {
        process.exitCode = 1;
        await send({ type: "failed", message: error.message, code: error.code });
      } finally { process.disconnect(); }
    });
    await send({ type: "ready", legacy: true, pid: process.pid });
  `;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", code, filePath],
    {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
    },
  );
  const events = [];
  const waiters = new Set();
  let stdout = "",
    stderr = "",
    closed = false;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.on("message", (event) => {
    events.push(event);
    for (const waiter of waiters) {
      if (event.type === waiter.type) {
        clearTimeout(waiter.timer);
        waiters.delete(waiter);
        waiter.resolve(event);
      } else if (event.type === "failed") {
        clearTimeout(waiter.timer);
        waiters.delete(waiter);
        waiter.reject(
          new Error(`legacy writer failed: ${JSON.stringify(event)}`),
        );
      }
    }
  });
  const done = new Promise((resolve) =>
    child.once("close", (code, signal) => {
      closed = true;
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(
          new Error(
            `legacy writer exited while waiting for ${waiter.type}: ${stderr}`,
          ),
        );
      }
      waiters.clear();
      resolve({ code, signal, stdout, stderr });
    }),
  );
  const worker = {
    child,
    done,
    events,
    waitFor(type) {
      const event = events.find((value) => value.type === type);
      if (event) return Promise.resolve(event);
      if (closed)
        return Promise.reject(
          new Error(`legacy writer already exited: ${stderr}`),
        );
      return new Promise((resolve, reject) => {
        const waiter = { type, resolve, reject, timer: null };
        waiter.timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(
            new Error(
              `legacy writer ${type} timeout: events=${JSON.stringify(events)} stderr=${stderr}`,
            ),
          );
        }, 15_000);
        waiters.add(waiter);
      });
    },
  };
  workers.push(worker);
  return worker;
}

describe("query bundle compatibility with the actual e7 port", () => {
  it("lets the old collector delete a new bundle, then rebuilds identical bytes without changing authority", async () => {
    const f = await fixture();
    const Legacy = await loadLegacySegmentedMemoryPort();
    const legacy = new Legacy({ filePath: f.filePath });
    expect(legacy._queryBundlePlan).toBeUndefined();
    const beforeManifest = fs.readFileSync(f.filePath);
    const beforeBundle = fs.readFileSync(f.bundle.file);
    const unrelated = path.join(f.port.shardDirectory, "user-kept-file");
    fs.writeFileSync(unrelated, "keep");

    expect(await legacy.listRecords()).toEqual(f.expected);
    expect(fs.existsSync(f.bundle.file)).toBe(false);
    expect(fs.readFileSync(f.filePath)).toEqual(beforeManifest);
    expect(await f.port.listRecords()).toEqual(f.expected);
    expect(fs.readFileSync(f.bundle.file)).toEqual(beforeBundle);
    expect(fs.readFileSync(unrelated, "utf8")).toBe("keep");
    expect(await f.port.exportSnapshot()).toEqual(f.state);
  });

  it("removes superseded bundles across real old-writer delete and purge commits", async () => {
    const f = await fixture();
    const Legacy = await loadLegacySegmentedMemoryPort();
    const legacy = new Legacy({ filePath: f.filePath });
    const original = f.expected[0];
    const deleted = transition(original, "delete");
    expect(await legacy.commit(deleted, original.revision)).toMatchObject({
      ok: true,
      storeRevision: f.state.storeRevision + 1,
    });
    expect(fs.existsSync(f.bundle.file)).toBe(false);
    expect(
      (await f.port.listRecords()).some(
        (record) => record.memoryId === original.memoryId,
      ),
    ).toBe(false);
    const deletedBundle = f.port._queryBundlePlan(
      JSON.parse(fs.readFileSync(f.filePath, "utf8")),
    );
    expect(deletedBundle.file).not.toBe(f.bundle.file);
    expect(fs.existsSync(deletedBundle.file)).toBe(true);

    const purged = transition(deleted.record, "purge");
    expect(await legacy.commit(purged, deleted.record.revision)).toMatchObject({
      ok: true,
      storeRevision: f.state.storeRevision + 2,
    });
    expect(fs.existsSync(f.bundle.file)).toBe(false);
    expect(fs.existsSync(deletedBundle.file)).toBe(false);
    expect(
      (await f.port.listRecords()).some(
        (record) => record.memoryId === original.memoryId,
      ),
    ).toBe(false);
    const currentBundle = f.port._queryBundlePlan(
      JSON.parse(fs.readFileSync(f.filePath, "utf8")),
    );
    expect(fs.existsSync(currentBundle.file)).toBe(true);
    expect(currentBundle.file).not.toBe(deletedBundle.file);
    const expected = {
      ...f.state,
      storeRevision: f.state.storeRevision + 2,
      records: { ...f.state.records, [original.memoryId]: purged.record },
      events: [...f.state.events, deleted.event, purged.event],
    };
    expected.digest = stateDigest(expected);
    expect(await f.port.exportSnapshot()).toEqual(expected);
    expect(
      (await f.port.listRecords({ includeTombstones: true })).find(
        (record) => record.memoryId === original.memoryId,
      ),
    ).toEqual(purged.record);
    expect(purged.record.state).toBe("purged");
  });

  it("keeps a real old child writer pending while the new reader validates one locked bundle generation", async () => {
    const f = await fixture(80);
    const original = f.expected[0];
    const changed = transition(original, "reinforce");
    const writer = spawnLegacyWriter(f.filePath);
    const ready = await writer.waitFor("ready");
    expect(ready.legacy).toBe(true);
    expect(ready.pid).not.toBe(process.pid);
    const readBundle = f.port._readQueryBundleIndexes.bind(f.port);
    let checkpointCount = 0,
      contentionObserved = false;
    vi.spyOn(f.port, "_readQueryBundleIndexes").mockImplementation(
      (manifest, checkpoint) =>
        readBundle(manifest, async (force) => {
          await checkpoint(force);
          // Initial check, header read, then the first frame read: the bundle fd is
          // still open and the authority lock must remain owned by this reader.
          if (++checkpointCount !== 3) return;
          const ownerPath = path.join(`${f.filePath}.lock`, "owner.json");
          const owner = fs.readFileSync(ownerPath, "utf8");
          expect(JSON.parse(owner).pid).toBe(process.pid);
          writer.child.send({
            type: "commit",
            transition: changed,
            expectedRevision: original.revision,
          });
          const pending = await writer.waitFor("pending");
          expect(pending.settled).toBe(false);
          expect(pending.owner).toBe(owner);
          expect(fs.readFileSync(ownerPath, "utf8")).toBe(owner);
          contentionObserved = true;
        }),
    );

    const captured = await f.port.listPage({ limit: 1000 });
    expect(contentionObserved).toBe(true);
    expect(captured.storeRevision).toBe(f.state.storeRevision);
    expect(captured.records).toEqual(f.expected);
    expect(captured.nextCursor).toBeNull();
    const committed = await writer.waitFor("committed");
    expect(committed.result).toMatchObject({
      ok: true,
      storeRevision: f.state.storeRevision + 1,
      revision: changed.record.revision,
    });
    expect(await writer.done).toMatchObject({
      code: 0,
      signal: null,
      stderr: "",
    });
    expect(fs.existsSync(f.bundle.file)).toBe(false);
    expect(fs.existsSync(`${f.filePath}.lock`)).toBe(false);
    const next = await f.port.listPage({ limit: 1000 });
    expect(next.storeRevision).toBe(f.state.storeRevision + 1);
    expect(next.records).toEqual(
      f.expected
        .map((record) =>
          record.memoryId === original.memoryId ? changed.record : record,
        )
        .sort(compareMemoryRows),
    );
    const snapshot = await f.port.exportSnapshot();
    expect(snapshot.events).toEqual([...f.state.events, changed.event]);
    expect(snapshot.records[original.memoryId]).toEqual(changed.record);
  });
});
