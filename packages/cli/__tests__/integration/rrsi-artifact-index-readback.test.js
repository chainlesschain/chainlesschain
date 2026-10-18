import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { inspectRrsiTenantIndexHistory } from "../../src/lib/evolution/rrsi-tenant-index-anchor-history.js";
import {
  openObservedTextFixture,
  openObservedTextIndex,
  registerPreparationPlan,
  reservePreparation,
  observationRequest,
} from "../fixtures/rrsi-observed-text.js";

const temp = fs.realpathSync.native(os.tmpdir());
describe("retained RRSI history and management share bounded index readback", () => {
  let root, fixture, observed, retained, indexPath, rows, chunk, target;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(temp, "cc-rrsi-index-readback-history-"));
    fixture = openObservedTextFixture(root);
    observed = openObservedTextIndex(fixture);
    indexPath = path.join(root, "store", "artifacts", "index.jsonl");
  }, 60_000);
  beforeAll(() => {
    registerPreparationPlan(fixture);
    reservePreparation(fixture);
  }, 60_000);
  beforeAll(() => {
    observed.registerObservedSkillText(
      observationRequest(fixture, "# Real bounded index history\r\n"),
    );
    retained = inspectRrsiTenantIndexHistory({ observedTextIndex: observed });
    rows = fs
      .readFileSync(indexPath, "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    chunk = rows.find(
      (entry) => entry.lineage?.type === "rrsi-observed-text-chunk",
    );
    if (!chunk) throw new Error("genuine retained chunk is missing");
    target = path.join(root, "store", "artifacts", "files", chunk.file);
  }, 60_000);
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => {
    const resolved = path.resolve(root);
    if (
      path.dirname(resolved) !== temp ||
      !path.basename(resolved).startsWith("cc-rrsi-index-readback-history-")
    )
      throw new Error("unsafe retained index readback cleanup");
    fs.rmSync(resolved, { recursive: true, force: true });
  }, 60_000);

  function resolveChunk() {
    return fixture.store.artifactPorts.resolve(chunk.lineage.envelope, {
      expectedDigest: chunk.recordDigest,
      expectedType: "rrsi-observed-text-chunk",
      purpose: "evolution-ledger",
      tenantId: chunk.lineage.tenantId,
    });
  }
  function forbidWholeIndexReads() {
    const originalWhole = fs.readFileSync,
      originalOpen = fs.openSync,
      originalClose = fs.closeSync;
    const live = new Set(),
      attempts = [];
    let opens = 0;
    vi.spyOn(fs, "openSync").mockImplementation((name, ...args) => {
      const fd = originalOpen(name, ...args);
      if (name === indexPath) {
        live.add(fd);
        opens++;
      }
      return fd;
    });
    vi.spyOn(fs, "closeSync").mockImplementation((fd) => {
      live.delete(fd);
      return originalClose(fd);
    });
    vi.spyOn(fs, "readFileSync").mockImplementation((name, ...args) => {
      if (name === indexPath || live.has(name)) {
        attempts.push(name);
        throw new Error("retained index must use a bounded descriptor");
      }
      return originalWhole(name, ...args);
    });
    return { live, attempts, opens: () => opens };
  }

  it("authenticates a genuine retained chunk through management and replays the original history without whole-index reads", () => {
    const state = forbidWholeIndexReads();
    expect(resolveChunk()).toMatchObject({
      authenticated: true,
      digest: chunk.recordDigest,
    });
    expect(
      inspectRrsiTenantIndexHistory({ observedTextIndex: observed }),
    ).toEqual(retained);
    expect(state.attempts).toEqual([]);
    expect(state.opens()).toBeGreaterThan(2);
    expect(state.live.size).toBe(0);
  }, 60_000);

  it("holds an actual target-row change during management payload reading and authenticates restored original history", () => {
    const originalBytes = fs.readFileSync(indexPath),
      inode = fs.lstatSync(indexPath, { bigint: true }).ino,
      head = fixture.store.journal.verify();
    const mutated = Buffer.from(
      rows
        .map((row) =>
          JSON.stringify(
            row.id === chunk.id
              ? { ...row, title: "changed during genuine payload read" }
              : row,
          ),
        )
        .join("\n") + "\n",
    );
    const state = forbidWholeIndexReads(),
      originalRead = fs.readSync,
      originalOpen = fs.openSync,
      originalClose = fs.closeSync,
      payloads = new Set();
    let fired = false;
    // Capture the existing instrumentation implementation before replacing the
    // spy; calling its mock function after replacement would recurse.
    const trackedOpen = originalOpen.getMockImplementation(),
      trackedClose = originalClose.getMockImplementation();
    vi.spyOn(fs, "openSync").mockImplementation((name, ...args) => {
      const fd = trackedOpen(name, ...args);
      if (name === target) payloads.add(fd);
      return fd;
    });
    vi.spyOn(fs, "closeSync").mockImplementation((fd) => {
      payloads.delete(fd);
      return trackedClose(fd);
    });
    vi.spyOn(fs, "readSync").mockImplementation((fd, ...args) => {
      const count = originalRead(fd, ...args);
      if (payloads.has(fd) && count > 0 && !fired) {
        fired = true;
        fs.writeFileSync(indexPath, mutated);
      }
      return count;
    });
    try {
      expect(resolveChunk).toThrow(
        expect.objectContaining({
          code: "CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED",
          message: "ArtifactStore index entry was replaced during readback",
        }),
      );
      expect(fired).toBe(true);
      expect(fs.lstatSync(indexPath, { bigint: true }).ino).toBe(inode);
      expect(state.attempts).toEqual([]);
      expect(state.live.size).toBe(0);
      expect(payloads.size).toBe(0);
    } finally {
      fs.writeFileSync(indexPath, originalBytes);
    }
    expect(resolveChunk()).toMatchObject({ authenticated: true });
    expect(fixture.store.journal.verify()).toEqual(head);
    expect(
      inspectRrsiTenantIndexHistory({ observedTextIndex: observed }),
    ).toEqual(retained);
    expect(state.attempts).toEqual([]);
    expect(state.live.size).toBe(0);
    expect(payloads.size).toBe(0);
  }, 60_000);
});
