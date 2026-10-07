import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { inspectRrsiTenantIndexHistory } from "../../src/lib/evolution/rrsi-tenant-index-anchor-history.js";
import { RRSI_OBSERVED_TEXT_HOLD_CODE } from "../../src/lib/evolution/rrsi-observed-text-index.js";
import {
  openObservedTextFixture,
  openObservedTextIndex,
  registerPreparationPlan,
  reservePreparation,
  observationRequest,
} from "../fixtures/rrsi-observed-text.js";

const temp = fs.realpathSync.native(os.tmpdir());
const helper = fileURLToPath(
  new URL("../fixtures/rrsi-artifact-bytes-process.mjs", import.meta.url),
);
function cleanup(root, prefix) {
  const target = path.resolve(root);
  if (
    path.dirname(target) !== temp ||
    !path.basename(target).startsWith(prefix)
  )
    throw new Error("unsafe artifact bytes integration cleanup");
  fs.rmSync(target, { recursive: true, force: true });
}
describe("fresh-process three-phase artifact bytes and actual FIFO replacement", () => {
  let root, directory;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(temp, "cc-rrsi-artifact-bytes-process-"));
    directory = path.join(root, "artifacts");
  });
  afterEach(() => cleanup(root, "cc-rrsi-artifact-bytes-process-"));
  function child(phase = 0) {
    return spawnSync(process.execPath, [helper, directory, String(phase)], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    });
  }
  it("authenticates real signed bytes through three bounded reads in a new process without a graph grant", () => {
    const response = child();
    expect(response.error).toBeUndefined();
    expect(response.status, response.stderr).toBe(0);
    const result = JSON.parse(response.stdout);
    expect(result).toMatchObject({
      authenticated: true,
      found: true,
      opens: 3,
      rawReads: 0,
      liveArtifactDescriptors: 0,
      descriptor: {
        scope: "root-and-files-directories",
        artifactInventoryVerified: false,
        fullPhysicalStorageGraphVerified: false,
        grantsMutationOrPromotionAuthority: false,
      },
    });
    expect(result.actualReadBytes).toBe(3 * result.expectedSize);
  });
  it.runIf(process.platform !== "win32").each([1, 2, 3])(
    "rejects an actual phase %s FIFO leaf swap without waiting for a writer",
    (phase) => {
      const response = child(phase);
      expect(response.error).toBeUndefined();
      expect(response.status, response.stderr).toBe(2);
      const result = JSON.parse(response.stderr);
      expect(result).toMatchObject({
        code: "CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED",
        faultInjected: true,
        injectedPhase: phase,
        opens: phase,
        rawReads: 0,
        actualFifoVerified: true,
        liveArtifactDescriptors: 0,
        message:
          phase === 2
            ? "stored artifact could not be opened safely"
            : "ArtifactStore integrity verification failed",
      });
      if (phase === 2)
        expect(result.causeCode).toBe("CC_ARTIFACT_BOUNDED_READ_FAILED");
      expect(result.actualReadBytes).toBe((phase - 1) * result.expectedSize);
      expect(fs.lstatSync(path.join(root, "saved-artifact")).isFile()).toBe(
        true,
      );
    },
  );
});

describe("real retained RRSI text respects the bounded artifact byte reader", () => {
  let root, fixture, index, retained;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(temp, "cc-rrsi-artifact-byte-history-"));
    fixture = openObservedTextFixture(root);
    index = openObservedTextIndex(fixture);
  }, 60_000);
  beforeAll(() => {
    registerPreparationPlan(fixture);
    reservePreparation(fixture);
  }, 60_000);
  beforeAll(() => {
    index.registerObservedSkillText(
      observationRequest(fixture, "# Real bounded artifact Skill\r\n"),
    );
    retained = inspectRrsiTenantIndexHistory({ observedTextIndex: index });
  }, 60_000);
  afterAll(() => cleanup(root, "cc-rrsi-artifact-byte-history-"), 60_000);
  it("holds an oversized actual retained chunk and preserves journal/index bytes through rejection", () => {
    const artifactRoot = path.join(root, "store", "artifacts"),
      indexPath = path.join(artifactRoot, "index.jsonl");
    const rows = fs
      .readFileSync(indexPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const entry = rows.find(
      (entry) => entry.lineage?.type === "rrsi-observed-text-chunk",
    );
    expect(entry).toBeDefined();
    const target = path.join(artifactRoot, "files", entry.file);
    if (
      !target.startsWith(
        path.join(root, "store", "artifacts", "files") + path.sep,
      )
    )
      throw new Error("unsafe retained chunk target");
    const original = fs.readFileSync(target),
      originalIndex = fs.readFileSync(indexPath),
      head = fixture.store.journal.verify();
    fs.chmodSync(target, 0o600);
    const fd = fs.openSync(target, "r+");
    try {
      fs.ftruncateSync(fd, 1024 * 1024 + 1);
    } finally {
      fs.closeSync(fd);
    }
    try {
      expect(() =>
        inspectRrsiTenantIndexHistory({ observedTextIndex: index }),
      ).toThrow(
        expect.objectContaining({
          code: "CC_RRSI_ANCHOR_HISTORY_HOLD",
          cause: expect.objectContaining({
            code: RRSI_OBSERVED_TEXT_HOLD_CODE,
            cause: expect.objectContaining({
              code: "CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED",
              message: "ArtifactStore integrity verification failed",
            }),
          }),
        }),
      );
      expect(fs.lstatSync(target, { bigint: true }).size).toBe(1048577n);
      expect(fs.readFileSync(indexPath)).toEqual(originalIndex);
    } finally {
      fs.writeFileSync(target, original);
    }
    expect(fixture.store.journal.verify()).toEqual(head);
    expect(
      inspectRrsiTenantIndexHistory({ observedTextIndex: index })
        .artifactStoreDirectoryBoundaryDigest,
    ).toBe(retained.artifactStoreDirectoryBoundaryDigest);
  }, 60_000);
});
