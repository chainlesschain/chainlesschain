import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { applyMemoryCommand } from "@chainlesschain/context-memory-kernel";
import { createDurableMemoryFixture } from "../../scripts/persistent-capacity-benchmark.mjs";
import { SegmentedMemoryPort } from "../../src/lib/context-memory-kernel/segmented-memory-port.js";
import { compareMemoryRows } from "../../src/lib/context-memory-kernel/memory-query-index.js";
import {
  observeQueryBundleHandles,
  projectQueryBundleDevice,
  restoreQueryBundleIdentityRuntime,
} from "../helpers/query-bundle-handles.js";

const parent = fs.realpathSync.native(os.tmpdir());
const roots = [];
afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  restoreQueryBundleIdentityRuntime();
  for (const root of roots.splice(0)) {
    if (
      path.dirname(root) !== parent ||
      !path.basename(root).startsWith("cc-memory-bundle-port-")
    )
      throw new Error("Unsafe fixture cleanup path");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = fs.mkdtempSync(path.join(parent, "cc-memory-bundle-port-"));
  roots.push(root);
  const filePath = path.join(root, "authority.json");
  const state = createDurableMemoryFixture(400);
  const port = new SegmentedMemoryPort({ filePath });
  await port.importSnapshot(state);
  const manifest = () => JSON.parse(fs.readFileSync(filePath, "utf8"));
  const expected = Object.values(state.records)
    .sort(compareMemoryRows)
    .slice(0, 7);
  return { root, filePath, port, state, manifest, expected };
}

describe("default disk query bundle", () => {
  it.each(process.platform === "win32" ? ["native", "projected"] : ["native"])(
    "revalidates one bundle data descriptor without reopening compatibility indexes and preserves list results (%s)",
    async (identityMode) => {
      const f = await fixture();
      expect((await f.port.listPage({ limit: 7 })).records).toEqual(f.expected);
      const bundle = f.port._queryBundlePlan(f.manifest());
      if (identityMode === "projected") projectQueryBundleDevice(bundle.file);
      const individual = vi.spyOn(f.port, "_readQueryIndexBytes");
      const handles = observeQueryBundleHandles(bundle.file);
      expect((await f.port.listPage({ limit: 7 })).records).toEqual(f.expected);
      expect(individual).not.toHaveBeenCalled();
      expect(handles.data()).toHaveLength(1);
      expect(handles.data()[0].bytesRead).toBe(bundle.byteLength);
      // The parent/volume bridge retains exactly one bundle data descriptor.
      expect(handles.bundle()).toHaveLength(1);
      if (identityMode === "projected") {
        expect(
          handles.opened.some(
            (handle) => handle.file === path.dirname(bundle.file),
          ),
        ).toBe(true);
      }
      handles.assertClosed();
      expect(f.port.queryIndexCacheMode).toBe("validate-disk");
      const legacyLayout = new SegmentedMemoryPort({
        filePath: f.filePath,
        queryIndexLayout: "individual",
      });
      expect((await legacyLayout.listPage({ limit: 7 })).records).toEqual(
        f.expected,
      );
      handles.assertClosed();
    },
  );

  it("detects a damaged unselected frame despite a warm decoded cache and reconstructs current bytes", async () => {
    const f = await fixture();
    const first = await f.port.listPage({ limit: 1 });
    const selected = createHash("sha256")
      .update(first.records[0].memoryId)
      .digest("hex")
      .slice(0, 2);
    const plan = f.port._queryBundlePlan(f.manifest());
    const original = fs.readFileSync(plan.file);
    const damaged = Buffer.from(original);
    let offset = plan.header.length;
    for (const frame of plan.frames) {
      if (frame.bucket !== selected) {
        damaged[offset] ^= 0x20;
        break;
      }
      offset += frame.byteLength;
    }
    fs.writeFileSync(plan.file, damaged);
    const beforeAuthority = fs.readFileSync(f.filePath);
    const rebuild = vi.spyOn(f.port, "_readQueryIndexBytes");
    expect(await f.port.listPage({ limit: 1 })).toEqual(first);
    expect(rebuild).toHaveBeenCalledTimes(plan.frames.length);
    expect(fs.readFileSync(plan.file)).toEqual(original);
    expect(fs.readFileSync(f.filePath)).toEqual(beforeAuthority);
  });

  it("rejects an old generation bundle copied under the new generation name", async () => {
    const f = await fixture();
    const first = await f.port.listPage({ limit: 7 });
    const previous = f.port._queryBundlePlan(f.manifest());
    const staleBytes = fs.readFileSync(previous.file);
    const record = first.records[0];
    const transition = applyMemoryCommand(record, {
      type: "reinforce",
      expectedRevision: record.revision,
      confidenceDelta: 0.01,
      authority: "test",
      at: "2026-10-29T00:00:00.000Z",
    });
    expect((await f.port.commit(transition, record.revision)).ok).toBe(true);
    expect(fs.existsSync(previous.file)).toBe(false);
    const current = f.port._queryBundlePlan(f.manifest());
    fs.writeFileSync(current.file, staleBytes);
    const page = await f.port.listPage({ limit: 400 });
    expect(
      page.records.find((value) => value.memoryId === record.memoryId),
    ).toEqual(transition.record);
    expect(page.storeRevision).toBeGreaterThan(first.storeRevision);
    expect(
      fs.readFileSync(current.file).subarray(0, current.header.length),
    ).toEqual(current.header);
  });

  it.each(["hardlink", "junction"])(
    "does not repair an unsafe active bundle %s",
    async (kind) => {
      const f = await fixture();
      await f.port.listPage();
      const plan = f.port._queryBundlePlan(f.manifest());
      if (kind === "hardlink") {
        fs.linkSync(plan.file, path.join(f.root, "linked-query"));
      } else {
        fs.rmSync(plan.file);
        const external = path.join(f.root, "external");
        fs.mkdirSync(external);
        fs.writeFileSync(path.join(external, "untouched"), "retained");
        fs.symlinkSync(
          external,
          plan.file,
          process.platform === "win32" ? "junction" : "dir",
        );
      }
      await expect(f.port.listPage()).rejects.toMatchObject({
        code: "CONTEXT_MEMORY_STORE_CORRUPT",
      });
      if (kind === "junction")
        expect(
          fs.readFileSync(path.join(f.root, "external", "untouched"), "utf8"),
        ).toBe("retained");
    },
  );

  it("falls back to fully validated individual files when additional cache capacity is unavailable", async () => {
    const f = await fixture();
    await f.port.listPage();
    const manifest = f.manifest();
    const previous = f.port._queryBundlePlan(manifest);
    const maxTotalBytes =
      manifest.totalBytes +
      Object.values(manifest.shards).reduce(
        (sum, entry) => sum + entry.queryBytes,
        0,
      );
    const bounded = new SegmentedMemoryPort({
      filePath: f.filePath,
      maxTotalBytes,
    });
    const reads = vi.spyOn(bounded, "_readQueryIndexBytes");
    expect(bounded._queryBundlePlan(manifest)).toBeNull();
    expect((await bounded.listPage({ limit: 7 })).records).toEqual(f.expected);
    expect(reads).toHaveBeenCalledTimes(Object.keys(manifest.shards).length);
    expect(fs.existsSync(previous.file)).toBe(false);
  });

  it("keeps a read-only missing-bundle query write-free", async () => {
    const f = await fixture();
    const plan = f.port._queryBundlePlan(f.manifest());
    const before = fs.readdirSync(f.port.shardDirectory).sort();
    const authority = fs.readFileSync(f.filePath);
    const shadow = new SegmentedMemoryPort({
      filePath: f.filePath,
      readOnly: true,
    });
    expect((await shadow.listPage({ limit: 7 })).records).toEqual(f.expected);
    expect(fs.readdirSync(f.port.shardDirectory).sort()).toEqual(before);
    expect(fs.readFileSync(f.filePath)).toEqual(authority);
    expect(fs.existsSync(plan.file)).toBe(false);
  });

  it("rejects publication failure without returning a result or changing canonical authority", async () => {
    const f = await fixture();
    const plan = f.port._queryBundlePlan(f.manifest());
    const authority = fs.readFileSync(f.filePath);
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (to === plan.file)
        throw new Error("injected bundle publication failure");
      return rename(from, to);
    });
    syncBuiltinESMExports();
    await expect(f.port.listPage()).rejects.toThrow(
      "injected bundle publication failure",
    );
    expect(fs.readFileSync(f.filePath)).toEqual(authority);
    expect(fs.existsSync(plan.file)).toBe(false);
    expect(
      fs
        .readdirSync(f.port.shardDirectory)
        .filter((file) => file.endsWith(".tmp")),
    ).toEqual([]);
    expect(fs.existsSync(`${f.filePath}.lock`)).toBe(false);
  });

  it("honors Stop during a warm bundle read before returning records and releases the authority lock", async () => {
    const f = await fixture();
    await f.port.listPage();
    const authority = fs.readFileSync(f.filePath);
    const controller = new AbortController();
    const original = f.port._readQueryIndex.bind(f.port);
    let traversed = 0;
    vi.spyOn(f.port, "_readQueryIndex").mockImplementation((...args) => {
      if (++traversed === 1) controller.abort();
      return original(...args);
    });
    await expect(
      f.port.listPage({ signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fs.existsSync(`${f.filePath}.lock`)).toBe(false);
    expect(fs.readFileSync(f.filePath)).toEqual(authority);
    expect(traversed).toBe(1);
  });
});
