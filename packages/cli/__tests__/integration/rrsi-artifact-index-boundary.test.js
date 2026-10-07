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
import { captureEvolutionArtifactStoreDirectoryBoundary } from "../../src/lib/evolution/evolution-artifact-ports.js";
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
  new URL("../fixtures/rrsi-artifact-index-process.mjs", import.meta.url),
);
function cleanup(root, prefix) {
  const target = path.resolve(root);
  if (
    path.dirname(target) !== temp ||
    !path.basename(target).startsWith(prefix)
  )
    throw new Error("unsafe artifact index integration cleanup");
  fs.rmSync(target, { recursive: true, force: true });
}
describe("genuine index in a new process and actual POSIX FIFO open races", () => {
  let root, directory;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(temp, "cc-rrsi-artifact-index-process-"));
    directory = path.join(root, "artifacts");
    fs.mkdirSync(path.join(directory, "files"), { recursive: true });
    fs.writeFileSync(path.join(directory, "index.jsonl"), "");
  });
  afterEach(() => cleanup(root, "cc-rrsi-artifact-index-process-"));
  function child(mode = "") {
    return spawnSync(process.execPath, [helper, directory, mode], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    });
  }
  it("opens and reads a real empty index without granting authority in a new process", () => {
    const response = child();
    expect(response.error).toBeUndefined();
    expect(response.status, response.stderr).toBe(0);
    expect(JSON.parse(response.stdout)).toMatchObject({
      result: [],
      descriptor: {
        scope: "root-and-files-directories",
        indexFileIdentityVerified: false,
        indexContentsVerified: false,
        fullPhysicalStorageGraphVerified: false,
        tenantWideIndexAuthorityVerified: false,
        grantsMutationOrPromotionAuthority: false,
      },
    });
    expect(fs.readFileSync(path.join(directory, "index.jsonl"))).toHaveLength(
      0,
    );
  });
  it
    .runIf(process.platform !== "win32")
    .each(["fifo-constructor", "fifo-snapshot"])(
    "rejects actual %s leaf replacement without waiting for a FIFO writer",
    (mode) => {
      const response = child(mode);
      expect(response.error).toBeUndefined();
      expect(response.status, response.stderr).toBe(2);
      expect(JSON.parse(response.stderr)).toMatchObject({
        code: "CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED",
        faultInjected: true,
        message:
          "ArtifactStore index descriptor must be a regular, non-symlink, single-link file",
      });
      expect(fs.lstatSync(path.join(directory, "index.jsonl")).isFIFO()).toBe(
        true,
      );
      expect(fs.readFileSync(path.join(root, "saved-index"))).toHaveLength(0);
    },
  );
});

describe("real retained RRSI history requires its original index inode", () => {
  let root, fixture, index, retained, directoryBoundary;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(temp, "cc-rrsi-artifact-index-history-"));
    fixture = openObservedTextFixture(root);
    index = openObservedTextIndex(fixture);
    directoryBoundary = captureEvolutionArtifactStoreDirectoryBoundary(
      fixture.store.artifactPorts,
    );
  }, 60_000);
  beforeAll(() => {
    registerPreparationPlan(fixture);
    reservePreparation(fixture);
  }, 60_000);
  beforeAll(() => {
    index.registerObservedSkillText(
      observationRequest(fixture, "# Genuine index inode history\r\n"),
    );
    retained = inspectRrsiTenantIndexHistory({ observedTextIndex: index });
  }, 60_000);
  afterAll(() => cleanup(root, "cc-rrsi-artifact-index-history-"), 60_000);
  it("holds a same-byte index clone, preserves original history and leaves the directory digest unchanged", () => {
    const target = path.join(root, "store", "artifacts", "index.jsonl"),
      saved = path.join(root, "saved-index");
    const bytes = fs.readFileSync(target),
      head = fixture.store.journal.verify(),
      inode = fs.lstatSync(target, { bigint: true }).ino;
    if (!target.startsWith(root + path.sep) || path.dirname(saved) !== root)
      throw new Error("unsafe index history replacement");
    fs.renameSync(target, saved);
    fs.writeFileSync(target, bytes);
    try {
      expect(fs.lstatSync(target, { bigint: true }).ino).not.toBe(inode);
      expect(directoryBoundary.recheck()).toMatchObject({
        indexFileIdentityVerified: false,
        indexContentsVerified: false,
      });
      expect(() =>
        inspectRrsiTenantIndexHistory({ observedTextIndex: index }),
      ).toThrow(
        expect.objectContaining({
          code: "CC_RRSI_ANCHOR_HISTORY_HOLD",
          cause: expect.objectContaining({
            code: RRSI_OBSERVED_TEXT_HOLD_CODE,
            cause: expect.objectContaining({
              code: "CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED",
              message: "ArtifactStore index physical identity changed",
            }),
          }),
        }),
      );
      expect(fs.readFileSync(target)).toEqual(bytes);
    } finally {
      fs.unlinkSync(target);
      fs.renameSync(saved, target);
    }
    expect(fixture.store.journal.verify()).toEqual(head);
    expect(
      inspectRrsiTenantIndexHistory({ observedTextIndex: index })
        .artifactStoreDirectoryBoundaryDigest,
    ).toBe(retained.artifactStoreDirectoryBoundaryDigest);
  }, 60_000);
});
