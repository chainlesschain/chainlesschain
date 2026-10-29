import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { SegmentedMemoryPort } from "../../src/lib/context-memory-kernel/segmented-memory-port.js";

const roots = [];
afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-memory-directory-"),
  );
  roots.push(root);
  const port = new SegmentedMemoryPort({
    filePath: path.join(root, "authority.json"),
  });
  fs.mkdirSync(port.shardDirectory, { mode: 0o700 });
  return port;
}

it("does not adopt a directory replacement between identity comparison and baseline publication", async () => {
  const port = fixture();
  const displaced = `${port.shardDirectory}.displaced`;
  const lstat = fs.lstatSync;
  const original = lstat(port.shardDirectory);
  const identity = (stat) => `${stat.dev}:${stat.ino}`;
  let replacement;
  await port._locked(() => {
    let shardStats = 0;
    vi.spyOn(fs, "lstatSync").mockImplementation((file, ...args) => {
      if (file === port.shardDirectory && ++shardStats === 3) {
        // The old path compared the second observation, then silently assigned
        // the third to its baseline. With a single checked observation, the
        // third read belongs to the following validation and must be rejected.
        fs.renameSync(port.shardDirectory, displaced);
        fs.mkdirSync(port.shardDirectory, { mode: 0o700 });
        replacement = lstat(port.shardDirectory);
      }
      return lstat(file, ...args);
    });
    syncBuiltinESMExports();
    expect(() => port._checkDirectories()).not.toThrow();
    expect(() => port._checkDirectories()).toThrow(
      expect.objectContaining({ code: "CONTEXT_MEMORY_STORE_CORRUPT" }),
    );
    expect(identity(replacement)).not.toBe(identity(original));
    expect(port._shardIdentity).toBe(identity(original));
  });
});

it.skipIf(process.platform === "win32")(
  "checks private directory permissions again on each validation",
  async () => {
    const port = fixture();
    await port._locked(() => {
      port._checkDirectories();
      fs.chmodSync(port.shardDirectory, 0o755);
      expect(() => port._checkDirectories()).toThrow(
        expect.objectContaining({ code: "CONTEXT_MEMORY_STORE_CORRUPT" }),
      );
    });
  },
);
