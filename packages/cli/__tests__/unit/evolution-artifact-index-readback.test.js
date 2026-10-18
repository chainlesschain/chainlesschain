import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  captureEvolutionLedgerBatchResolver,
  EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE as INTEGRITY,
  EVOLUTION_ARTIFACT_NOT_FOUND_CODE as NOT_FOUND,
  EVOLUTION_ARTIFACT_STORE_FAILED_CODE as STORE_FAILED,
  EVOLUTION_ARTIFACT_MAX_INDEX_BYTES,
  EVOLUTION_ARTIFACT_MAX_INDEX_ENTRIES,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { openArtifactByteFixture } from "../fixtures/evolution-artifact-bytes.js";

const temp = fs.realpathSync.native(os.tmpdir());
let root, directory, index;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(temp, "cc-artifact-index-readback-"));
  directory = path.join(root, "artifacts");
  index = path.join(directory, "index.jsonl");
});
afterEach(() => {
  vi.restoreAllMocks();
  const target = path.resolve(root);
  if (
    path.dirname(target) !== temp ||
    !path.basename(target).startsWith("cc-artifact-index-readback-")
  )
    throw new Error("unsafe index readback cleanup");
  fs.rmSync(target, { recursive: true, force: true });
});

function open(Store = ArtifactStore) {
  const fixture = openArtifactByteFixture(directory, { Store });
  const options = {
    expectedDigest: fixture.publication.digest,
    expectedType: "evolution-ledger-v2-journal",
    purpose: "evolution-ledger",
    tenantId: fixture.request.tenantId,
  };
  const resolver = fixture.ports.createEvolutionLedgerArtifactResolver({
    purpose: "evolution-ledger",
  });
  return {
    ...fixture,
    resolve: () => fixture.ports.resolve(fixture.publication.envelope, options),
    batch: () =>
      captureEvolutionLedgerBatchResolver(resolver)([fixture.request]),
  };
}

// Instrument only after fixture publication. Writer APIs retain their existing
// whole-index reads; the guarantee under test is the default readback path.
function instrument() {
  const originalOpen = fs.openSync,
    originalClose = fs.closeSync,
    originalRead = fs.readSync,
    originalWhole = fs.readFileSync;
  const live = new Map(),
    snapshots = [],
    wholeReads = [];
  vi.spyOn(fs, "openSync").mockImplementation((target, flags, ...args) => {
    const fd = originalOpen(target, flags, ...args);
    if (target === index) {
      const state = { flags, reads: [], closed: false };
      snapshots.push(state);
      live.set(fd, state);
    }
    return fd;
  });
  vi.spyOn(fs, "readSync").mockImplementation(
    (fd, buffer, offset, length, position) => {
      const count = originalRead(fd, buffer, offset, length, position);
      if (live.has(fd)) live.get(fd).reads.push({ length, position, count });
      return count;
    },
  );
  vi.spyOn(fs, "closeSync").mockImplementation((fd) => {
    if (live.has(fd)) {
      live.get(fd).closed = true;
      live.delete(fd);
    }
    return originalClose(fd);
  });
  vi.spyOn(fs, "readFileSync").mockImplementation((target, ...args) => {
    if (target === index || live.has(target)) {
      wholeReads.push(target);
      throw new Error("whole-index read is forbidden in this readback window");
    }
    return originalWhole(target, ...args);
  });
  return { live, snapshots, wholeReads };
}

function expectHeld(operation, code, message) {
  let error;
  try {
    operation();
  } catch (cause) {
    error = cause;
  }
  expect(error).toMatchObject({ code, message });
}

describe("default ArtifactPorts index readback uses bounded snapshots", () => {
  it.each(["resolve", "read", "batch"])(
    "authenticates %s with multi-block index snapshots and no whole-index read",
    (mode) => {
      const fixture = open();
      // Genuine ordinary deliveries can coexist with the signed target row.
      for (let number = 0; number < 6; number++)
        fixture.store.publishData({
          data: `ordinary delivery ${number}`,
          title: "x".repeat(12_000),
        });
      const size = fs.statSync(index).size;
      expect(size).toBeGreaterThan(65536);
      const state = instrument();
      expect(fixture[mode]()).toMatchObject(
        mode === "batch"
          ? [{ authenticated: true, digest: fixture.publication.digest }]
          : { authenticated: true, digest: fixture.publication.digest },
      );
      expect(state.wholeReads).toEqual([]);
      expect(state.live.size).toBe(0);
      expect(state.snapshots.length).toBeGreaterThanOrEqual(2);
      for (const snapshot of state.snapshots) {
        expect(snapshot.closed).toBe(true);
        expect(
          snapshot.flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR),
        ).toBe(0);
        expect(snapshot.reads.every((read) => read.length <= 65536)).toBe(true);
        expect(
          snapshot.reads.reduce((total, read) => total + read.count, 0),
        ).toBe(size);
        expect(snapshot.reads.at(-1)).toEqual({
          length: 1,
          position: size,
          count: 0,
        });
      }
    },
  );

  it("recognizes inherited and own references to the original repository methods by function identity", () => {
    class OriginalMethodsStore extends ArtifactStore {
      constructor(options) {
        super(options);
        this.list = ArtifactStore.prototype.list;
        this.get = ArtifactStore.prototype.get;
      }
    }
    const fixture = open(OriginalMethodsStore),
      state = instrument();
    expect(fixture.resolve()).toMatchObject({ authenticated: true });
    expect(state.wholeReads).toEqual([]);
    expect(state.live.size).toBe(0);
  });

  it.each(["list", "get"])(
    "preserves a custom %s wrapper and explicitly leaves its legacy I/O outside the default bounds",
    (method) => {
      let armed = false,
        calls = 0;
      class ForwardingStore extends ArtifactStore {
        [method](...args) {
          if (armed) calls++;
          return super[method](...args);
        }
      }
      const fixture = open(ForwardingStore),
        whole = vi.spyOn(fs, "readFileSync");
      armed = true;
      expect(fixture.resolve()).toMatchObject({ authenticated: true });
      expect(calls).toBeGreaterThan(0);
      expect(
        whole.mock.calls.filter(([target]) => target === index).length,
      ).toBeGreaterThan(0);
    },
  );

  it("detects a real same-inode append between management snapshots and later accepts the stable append", () => {
    const fixture = open(),
      inode = fs.lstatSync(index, { bigint: true }).ino;
    const appended = `${JSON.stringify({ id: "ordinary-appended-row" })}\n`;
    const state = instrument(),
      originalStat = fs.lstatSync;
    let fired = false,
      samples = 0;
    vi.spyOn(fs, "lstatSync").mockImplementation((target, ...args) => {
      const stat = originalStat(target, ...args);
      // resolve first takes a standalone admission snapshot. Mutate after the
      // next snapshot's final pathname sample (fourth path stat), inside the
      // first paired enumeration; its second snapshot sees stable new bytes.
      if (target === index && ++samples === 4) {
        fired = true;
        fs.appendFileSync(index, appended);
      }
      return stat;
    });
    expectHeld(
      fixture.resolve,
      INTEGRITY,
      "ArtifactStore.list is not exactly bound to one trusted index snapshot",
    );
    expect(fired).toBe(true);
    expect(fs.lstatSync(index, { bigint: true }).ino).toBe(inode);
    expect(fixture.resolve()).toMatchObject({ authenticated: true });
    expect(state.wholeReads).toEqual([]);
    expect(state.live.size).toBe(0);
  });

  it.each([
    [
      "missing",
      NOT_FOUND,
      "evolution artifact was removed, expired, or never persisted",
    ],
    [
      "duplicate-digest",
      INTEGRITY,
      "recordDigest has duplicate ArtifactStore index rows",
    ],
    [
      "duplicate-id",
      INTEGRITY,
      "evolution artifact id has duplicate index rows",
    ],
    [
      "partial-jsonl",
      INTEGRITY,
      "ArtifactStore index must end at a complete JSONL record",
    ],
    ["corrupt-json", INTEGRITY, "ArtifactStore index row 0 is not JSON"],
    [
      "too-many-rows",
      STORE_FAILED,
      "ArtifactStore index exceeds its trusted snapshot limits",
    ],
    ["inode-swap", INTEGRITY, "ArtifactStore index physical identity changed"],
  ])(
    "rejects actual %s index bytes without consulting legacy index readers",
    (fault, code, message) => {
      const fixture = open(),
        bytes = fs.readFileSync(index),
        row = JSON.parse(bytes.toString("utf8").trim());
      if (fault === "missing") fs.writeFileSync(index, "");
      if (fault === "duplicate-digest")
        fs.appendFileSync(
          index,
          `${JSON.stringify({ ...row, id: "art_other_00000000" })}\n`,
        );
      if (fault === "duplicate-id") {
        const duplicate = { ...row };
        delete duplicate.recordDigest;
        fs.appendFileSync(index, `${JSON.stringify(duplicate)}\n`);
      }
      if (fault === "partial-jsonl")
        fs.writeFileSync(index, bytes.subarray(0, -1));
      if (fault === "corrupt-json") fs.writeFileSync(index, "{broken}\n");
      if (fault === "too-many-rows")
        fs.appendFileSync(
          index,
          `${JSON.stringify({ id: "extra" })}\n`.repeat(
            EVOLUTION_ARTIFACT_MAX_INDEX_ENTRIES,
          ),
        );
      if (fault === "inode-swap") {
        fs.renameSync(index, path.join(root, "saved-index"));
        fs.writeFileSync(index, bytes);
      }
      const state = instrument();
      expectHeld(fixture.resolve, code, message);
      expect(state.wholeReads).toEqual([]);
      expect(state.live.size).toBe(0);
    },
  );

  it("rejects an actual oversized management index before reading its contents", () => {
    const fixture = open(),
      fd = fs.openSync(index, "r+");
    try {
      fs.ftruncateSync(fd, EVOLUTION_ARTIFACT_MAX_INDEX_BYTES + 1);
    } finally {
      fs.closeSync(fd);
    }
    const state = instrument();
    expectHeld(
      fixture.resolve,
      INTEGRITY,
      "ArtifactStore index exceeds its bounded snapshot size",
    );
    expect(state.snapshots.flatMap((snapshot) => snapshot.reads)).toEqual([]);
    expect(state.wholeReads).toEqual([]);
    expect(state.live.size).toBe(0);
  });
});
