import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { SegmentedMemoryPort } from "../../src/lib/context-memory-kernel/segmented-memory-port.js";
import { createDurableMemoryFixture } from "../../scripts/persistent-capacity-benchmark.mjs";
import {
  observeQueryBundleHandles,
  projectQueryBundleDevice,
  restoreQueryBundleIdentityRuntime,
} from "../helpers/query-bundle-handles.js";

const temporaryParent = fs.realpathSync.native(os.tmpdir());
const roots = [];

afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  restoreQueryBundleIdentityRuntime();
  for (const root of roots.splice(0)) {
    if (
      path.dirname(path.resolve(root)) !== temporaryParent ||
      !path.basename(root).startsWith("cc-query-bundle-identity-") ||
      fs.realpathSync.native(root) !== path.resolve(root)
    )
      throw new Error("unsafe query bundle identity fixture cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function fixture({ corrupt = true } = {}) {
  const root = fs.mkdtempSync(
    path.join(temporaryParent, "cc-query-bundle-identity-"),
  );
  roots.push(root);
  const filePath = path.join(root, "authority.json");
  const port = new SegmentedMemoryPort({ filePath });
  await port.importSnapshot(createDurableMemoryFixture(40));
  await port.listPage({ limit: 7 });
  const authority = fs.readFileSync(filePath);
  const plan = port._queryBundlePlan(JSON.parse(authority.toString("utf8")));
  const corruptBytes = fs.readFileSync(plan.file);
  if (corrupt) corruptBytes[0] ^= 0x20;
  fs.writeFileSync(plan.file, corruptBytes);
  return { root, filePath, port, authority, plan, corruptBytes };
}

// Arm only after the actual bundle fd has read its damaged header. Mutate at
// its next checkpoint, before the codec can classify that damage as repairable.
// No sleeps or timing-dependent scheduling are needed.
function mutateAtReadCheckpoint(fixture, mutate, { beforeOpen = false } = {}) {
  let readPending = beforeOpen,
    mutations = 0;
  const handles = observeQueryBundleHandles(fixture.plan.file, () => {
    if (mutations === 0) readPending = true;
  });
  const readBundle = fixture.port._readQueryBundleIndexes.bind(fixture.port);
  vi.spyOn(fixture.port, "_readQueryBundleIndexes").mockImplementation(
    (manifest, checkpoint) =>
      readBundle(manifest, async (force) => {
        await checkpoint(force);
        if (!readPending || mutations !== 0) return;
        mutations++;
        mutate();
      }),
  );
  return { mutations: () => mutations, handles };
}

describe("query bundle identity failures take precedence over content repair", () => {
  it.each(process.platform === "win32" ? ["native", "projected"] : ["native"])(
    "does not repair a replacement ordinary file after reading corrupt bytes from the displaced inode (%s)",
    async (identityMode) => {
      const f = await fixture();
      if (identityMode === "projected") projectQueryBundleDevice(f.plan.file);
      const replacement = Buffer.from("replacement file must remain untouched");
      const displaced = `${f.plan.file}.displaced`;
      const repairReads = vi.spyOn(f.port, "_readQueryIndexBytes");
      const observation = mutateAtReadCheckpoint(f, () => {
        fs.renameSync(f.plan.file, displaced);
        fs.writeFileSync(f.plan.file, replacement);
      });

      await expect(f.port.listPage({ limit: 7 })).rejects.toMatchObject({
        code: "CONTEXT_MEMORY_STORE_CORRUPT",
      });
      expect(observation.mutations()).toBe(1);
      expect(observation.handles.data()).toHaveLength(1);
      expect(observation.handles.data()[0].bytesRead).toBe(
        f.plan.header.length,
      );
      if (identityMode === "projected") {
        // The bridge authenticates independent parent/volume handles without
        // reopening the bundle. They must not disarm the data-read injection.
        expect(observation.handles.readOnlyBundle()).toHaveLength(1);
        expect(
          observation.handles.opened.some(
            (handle) => handle.file === path.dirname(f.plan.file),
          ),
        ).toBe(true);
      }
      observation.handles.assertClosed();
      expect(repairReads).not.toHaveBeenCalled();
      expect(fs.readFileSync(f.plan.file)).toEqual(replacement);
      expect(fs.readFileSync(displaced)).toEqual(f.corruptBytes);
      expect(fs.readFileSync(f.filePath)).toEqual(f.authority);
      expect(fs.existsSync(`${f.filePath}.lock`)).toBe(false);
    },
  );

  it.each([true, false])(
    "rejects a redirected shard directory resolving to the same bundle inode (corrupt=%s)",
    async (corrupt) => {
      const f = await fixture({ corrupt });
      const displaced = `${f.port.shardDirectory}.displaced`;
      const before = fs.statSync(f.plan.file);
      const repairReads = vi.spyOn(f.port, "_readQueryIndexBytes");
      // Windows refuses directory renames while a child fd is open. Redirect at
      // the first codec checkpoint, after the port check but before opening the
      // same inode through the new link. No platform-specific skip is needed.
      const observation = mutateAtReadCheckpoint(
        f,
        () => {
          fs.renameSync(f.port.shardDirectory, displaced);
          fs.symlinkSync(
            displaced,
            f.port.shardDirectory,
            process.platform === "win32" ? "junction" : "dir",
          );
          const redirected = fs.statSync(f.plan.file);
          expect([redirected.dev, redirected.ino]).toEqual([
            before.dev,
            before.ino,
          ]);
        },
        { beforeOpen: true },
      );

      // No selected rows means no later shard read can accidentally supply the
      // missing post-bundle directory validation on the valid-content path.
      await expect(
        f.port.listPage({ category: "not-present", limit: 7 }),
      ).rejects.toMatchObject({
        code: "CONTEXT_MEMORY_STORE_CORRUPT",
      });
      expect(observation.mutations()).toBe(1);
      observation.handles.assertClosed();
      expect(repairReads).not.toHaveBeenCalled();
      expect(fs.lstatSync(f.port.shardDirectory).isSymbolicLink()).toBe(true);
      expect(fs.readFileSync(f.plan.file)).toEqual(f.corruptBytes);
      expect(fs.readFileSync(f.filePath)).toEqual(f.authority);
      expect(
        fs.readdirSync(displaced).filter((name) => name.endsWith(".tmp")),
      ).toEqual([]);
      expect(fs.existsSync(`${f.filePath}.lock`)).toBe(false);
    },
  );
});
