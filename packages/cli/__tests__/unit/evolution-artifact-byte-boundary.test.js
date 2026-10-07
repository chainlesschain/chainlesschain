import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  captureEvolutionArtifactStoreDirectoryBoundary,
  EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE as INTEGRITY,
  EVOLUTION_ARTIFACT_MAX_CANONICAL_BYTES as MAXIMUM,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { openArtifactByteFixture } from "../fixtures/evolution-artifact-bytes.js";

const temp = fs.realpathSync.native(os.tmpdir());
let root, directory;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(temp, "cc-evolution-artifact-bytes-"));
  directory = path.join(root, "artifacts");
});
afterEach(() => {
  vi.restoreAllMocks();
  const target = path.resolve(root);
  if (
    path.dirname(target) !== temp ||
    !path.basename(target).startsWith("cc-evolution-artifact-bytes-")
  )
    throw new Error("unsafe artifact bytes cleanup");
  fs.rmSync(target, { recursive: true, force: true });
});
function held(operation, phase) {
  let error;
  try {
    operation();
  } catch (cause) {
    error = cause;
  }
  expect(error).toMatchObject({
    code: INTEGRITY,
    message:
      phase === 2
        ? "stored artifact could not be opened safely"
        : "ArtifactStore integrity verification failed",
  });
  if (phase === 2)
    expect(error.cause).toMatchObject({
      code: "CC_ARTIFACT_BOUNDED_READ_FAILED",
    });
}
function instrument(target, fault = () => {}) {
  const originalOpen = fs.openSync,
    originalRead = fs.readSync,
    originalClose = fs.closeSync;
  const live = new Map(),
    phases = [],
    closed = [],
    reads = [];
  vi.spyOn(fs, "openSync").mockImplementation((name, ...args) => {
    const flags = args[0];
    const phase =
      name === target &&
      typeof flags === "number" &&
      !(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR))
        ? phases.length + 1
        : 0;
    if (phase) fault(phase);
    const fd = originalOpen(name, ...args);
    if (phase) {
      phases.push(phase);
      live.set(fd, phase);
    }
    return fd;
  });
  vi.spyOn(fs, "readSync").mockImplementation(
    (fd, buffer, offset, length, position) => {
      const count = originalRead(fd, buffer, offset, length, position);
      if (live.has(fd))
        reads.push({ phase: live.get(fd), length, position, count });
      return count;
    },
  );
  vi.spyOn(fs, "closeSync").mockImplementation((fd) => {
    if (live.has(fd)) {
      closed.push(live.get(fd));
      live.delete(fd);
    }
    return originalClose(fd);
  });
  return { live, phases, closed, reads };
}
describe("genuine three-phase artifact reads", () => {
  it("bounds all three artifact reads, forwards the same frozen limits and authenticates exact signed bytes", () => {
    let armed = false;
    const limits = [];
    class ObservedStore extends ArtifactStore {
      verifyIntegrity(entry, bounds) {
        if (armed) limits.push(bounds);
        return super.verifyIntegrity(entry, bounds);
      }
    }
    const fixture = openArtifactByteFixture(directory, {
      Store: ObservedStore,
      value: { text: "x".repeat(150000) },
    });
    const state = instrument(fixture.target),
      whole = vi.spyOn(fs, "readFileSync");
    armed = true;
    expect(fixture.read()).toMatchObject({
      authenticated: true,
      found: true,
      digest: fixture.publication.digest,
    });
    expect(state.phases).toEqual([1, 2, 3]);
    expect(state.closed).toEqual([1, 2, 3]);
    expect(state.live.size).toBe(0);
    expect(limits).toHaveLength(2);
    expect(limits[0]).toBe(limits[1]);
    expect(Object.isFrozen(limits[0])).toBe(true);
    expect(limits[0]).toEqual({
      expectedSize: fixture.entry.size,
      maximumBytes: MAXIMUM,
    });
    expect(state.reads.reduce((sum, entry) => sum + entry.count, 0)).toBe(
      3 * fixture.entry.size,
    );
    expect(state.reads.every((entry) => entry.length <= 65536)).toBe(true);
    expect(
      state.reads.filter((entry) => entry.position === fixture.entry.size),
    ).toEqual(
      [1, 2, 3].map((phase) => ({
        phase,
        position: fixture.entry.size,
        length: 1,
        count: 0,
      })),
    );
    expect(whole).not.toHaveBeenCalled();
  });
  it.each(
    [1, 2, 3].flatMap((phase) =>
      ["expected-size", "maximum-size"].map((kind) => [phase, kind]),
    ),
  )(
    "rejects real phase %s %s growth before content reads in that phase",
    (phase, kind) => {
      const fixture = openArtifactByteFixture(directory);
      fs.chmodSync(fixture.target, 0o600);
      let fired = false;
      const state = instrument(fixture.target, (current) => {
        if (current === phase) {
          fired = true;
          const fd = fs.openSync(fixture.target, "r+");
          try {
            fs.ftruncateSync(
              fd,
              kind === "expected-size" ? fixture.entry.size + 1 : MAXIMUM + 1,
            );
          } finally {
            fs.closeSync(fd);
          }
        }
      });
      held(fixture.read, phase);
      expect(fired).toBe(true);
      expect(state.phases).toEqual(
        Array.from({ length: phase }, (_, i) => i + 1),
      );
      expect(state.reads.filter((entry) => entry.phase === phase)).toEqual([]);
      expect(state.live.size).toBe(0);
      expect(state.closed).toEqual(state.phases);
    },
  );
  it("keeps same-byte artifact inode replacement between independent reads outside a lifetime pin", () => {
    const fixture = openArtifactByteFixture(directory),
      bytes = fs.readFileSync(fixture.target);
    const inode = fs.lstatSync(fixture.target, { bigint: true }).ino,
      saved = path.join(root, "saved-artifact");
    fs.renameSync(fixture.target, saved);
    fs.writeFileSync(fixture.target, bytes);
    expect(fs.lstatSync(fixture.target, { bigint: true }).ino).not.toBe(inode);
    expect(fixture.read()).toMatchObject({ authenticated: true, found: true });
    expect(
      captureEvolutionArtifactStoreDirectoryBoundary(fixture.ports).descriptor,
    ).toMatchObject({
      scope: "root-and-files-directories",
      artifactInventoryVerified: false,
      fullPhysicalStorageGraphVerified: false,
      generationProvenanceVerified: false,
      grantsMutationOrPromotionAuthority: false,
    });
  });
  it("rejects same-size changed content through the original signed digest", () => {
    const fixture = openArtifactByteFixture(directory),
      bytes = fs.readFileSync(fixture.target);
    fs.chmodSync(fixture.target, 0o600);
    bytes[bytes.length - 2] ^= 1;
    fs.writeFileSync(fixture.target, bytes);
    held(fixture.read, 1);
  });
  it("retains the subclass integrity callback's real index mutation while forwarding bounds", () => {
    let armed = false,
      fired = false;
    class MutatingStore extends ArtifactStore {
      verifyIntegrity(entry, bounds) {
        const result = super.verifyIntegrity(entry, bounds);
        if (armed && !fired) {
          fired = true;
          const rows = fs
            .readFileSync(this._indexFile(), "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
          rows[0].title = "genuine hook changed the index";
          fs.writeFileSync(
            this._indexFile(),
            rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
          );
        }
        return result;
      }
    }
    const fixture = openArtifactByteFixture(directory, {
      Store: MutatingStore,
    });
    armed = true;
    expect(fixture.read).toThrow(
      expect.objectContaining({
        code: INTEGRITY,
        message:
          "ArtifactStore index entry was replaced during ledger readback",
      }),
    );
    expect(fired).toBe(true);
  });
});
