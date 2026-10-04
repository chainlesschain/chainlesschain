import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir, release } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const repo = process.env.CC_MEMORY_REPO || "/mnt/c/code/chainlesschain/.work/memory-capacity-20261004";
const gitDirectory = fs.readFileSync(join(repo, ".git"), "utf8").trim().replace(/^gitdir: /u, "").replaceAll("\\", "/").replace(/^([A-Za-z]):\//u, (_, drive) => `/mnt/${drive.toLowerCase()}/`);
const candidateSha = execFileSync("git", ["--git-dir", gitDirectory, "--work-tree", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
assert.equal(candidateSha, "244a3d10c0b3989b4f98a3461feaee27f113b441");
assert.equal(process.platform, "linux");
const { SegmentedMemoryPort } = await import(pathToFileURL(join(repo, "packages/cli/src/lib/context-memory-kernel/segmented-memory-port.js")));
const { createDurableMemoryFixture } = await import(pathToFileURL(join(repo, "packages/cli/scripts/persistent-capacity-benchmark.mjs")));
const { applyMemoryCommand, canonicalDigest } = createRequire(join(repo, "packages/cli/package.json"))("@chainlesschain/context-memory-kernel");
const root = fs.mkdtempSync(join(tmpdir(), "cc-memory-posix-fsync-"));
const outcomes = [];
const originalRename = fs.renameSync;
const originalSync = fs.fsyncSync;
try {
  for (const failingSync of [1, 2]) {
    const filePath = join(root, `authority-${failingSync}.json`);
    const port = new SegmentedMemoryPort({ filePath });
    const state = createDurableMemoryFixture(2);
    await port.importSnapshot(state);
    const record = Object.values(state.records)[0];
    const transition = applyMemoryCommand(record, { type: "reinforce", expectedRevision: record.revision, confidenceDelta: 0.01, authority: "posix-fsync-probe", at: "2026-10-04T00:00:00.000Z" });
    let published = false;
    let directorySyncs = 0;
    fs.renameSync = (from, to) => { originalRename(from, to); if (to === filePath) published = true; };
    fs.fsyncSync = (fd) => {
      if (published && fs.fstatSync(fd).isDirectory() && ++directorySyncs === failingSync) {
        throw Object.assign(new Error("injected post-publication directory fsync"), { code: "EIO" });
      }
      return originalSync(fd);
    };
    syncBuiltinESMExports();
    let failure;
    try { await port.commit(transition, 1); } catch (error) { failure = error; }
    finally { fs.renameSync = originalRename; fs.fsyncSync = originalSync; syncBuiltinESMExports(); }
    assert.equal(failure?.code, "CONTEXT_MEMORY_COMMIT_PUBLISHED");
    assert.equal(failure.committed, true);
    assert.equal(failure.cleanupComplete, false);
    assert.equal(failure.storeRevision, 3);
    assert.equal(failure.durability, failingSync === 1 ? "unknown" : "directory-sync-completed");
    assert.equal(directorySyncs, failingSync);
    const reopened = new SegmentedMemoryPort({ filePath });
    assert.deepEqual(await reopened.read(record.memoryId), transition.record);
    assert.deepEqual(await reopened.commit(transition, 1), { ok: false, currentRevision: 2, storeRevision: 3 });
    const snapshot = await reopened.exportSnapshot();
    assert.deepEqual(snapshot.events, [...state.events, transition.event]);
    assert.equal(fs.readdirSync(port.shardDirectory).length, Object.keys(JSON.parse(fs.readFileSync(filePath, "utf8")).shards).length);
    outcomes.push({ failureBoundary: failingSync === 1 ? "manifest-parent-directory-fsync" : "garbage-removal-directory-fsync", directorySyncs, code: failure.code, committed: failure.committed, durability: failure.durability, cleanupComplete: failure.cleanupComplete, storeRevision: 3, reopenedRecordVerified: true, staleCasRejected: true, auditVerified: true, noOrphanShards: true });
  }
  const receipt = { schema: "chainlesschain.segmented-memory-posix-probe/v1", candidateSha, host: { platform: process.platform, release: release(), node: process.version }, status: "passed", outcomes, scope: "two-record POSIX post-publication fsync fault injection; not capacity, power-loss, or production qualification" };
  receipt.digest = canonicalDigest(receipt, receipt.schema);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
} finally {
  fs.renameSync = originalRename; fs.fsyncSync = originalSync; syncBuiltinESMExports();
  fs.rmSync(root, { recursive: true, force: true });
}
