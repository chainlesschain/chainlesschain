import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { openJournalBoundaryFixture } from "../fixtures/evolution-journal-boundary.js";
import { inspectRrsiTenantIndexHistory } from "../../src/lib/evolution/rrsi-tenant-index-anchor-history.js";
import {
  openObservedTextFixture,
  openObservedTextIndex,
  registerPreparationPlan,
  reservePreparation,
  observationRequest,
} from "../fixtures/rrsi-observed-text.js";

const temp = fs.realpathSync.native(os.tmpdir());
function cleanup(root, prefix) {
  if (path.dirname(root) !== temp || !path.basename(root).startsWith(prefix))
    throw new Error("unsafe journal integration cleanup");
  fs.rmSync(root, { recursive: true, force: true });
}
const helper = fileURLToPath(
  new URL("../fixtures/rrsi-journal-state-process.mjs", import.meta.url),
);

describe("new process journal read watchdog", () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(temp, "cc-journal-process-"));
  });
  afterEach(() => cleanup(root, "cc-journal-process-"));
  const child = (branch, mode) => {
    const value = openJournalBoundaryFixture(root);
    if (branch === "snapshot") value.ledger.checkpointState();
    return spawnSync(process.execPath, [helper, root, mode, branch], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    });
  };
  it.each(["cold", "cached", "snapshot"])(
    "reauthenticates actual %s signed bytes with bounded closed descriptors",
    (branch) => {
      const response = child(branch, "read");
      expect(response.error).toBeUndefined();
      expect(response.status, response.stderr).toBe(0);
      const value = JSON.parse(response.stdout);
      expect(value).toMatchObject({
        branch,
        mode: "read",
        opens: 1,
        rawReads: 0,
        liveDescriptors: 0,
        requestsWithinChunk: true,
        nonblocking: true,
        preservedInode: true,
        authenticatedSequence: 1,
        fullPhysicalStorageGraphVerified: false,
        grantsMutationOrPromotionAuthority: false,
      });
      expect(value.actualReadBytes).toBe(value.expectedSize);
      expect(value.preservedDigest).toBe(value.originalDigest);
      expect(value.eofProbe).toEqual({
        requested: 1,
        count: 0,
        position: value.expectedSize,
      });
    },
  );
  it
    .runIf(process.platform !== "win32")
    .each([
      ...["cold", "cached", "snapshot"].flatMap((branch) =>
        ["fifo", "symlink", "ending-mode"].map((mode) => [branch, mode]),
      ),
      ["snapshot", "parent-fifo"],
    ])(
    "rejects real %s %s faults within the unchanged watchdog",
    (branch, mode) => {
      const response = child(branch, mode);
      expect(response.error).toBeUndefined();
      expect(response.status, response.stderr).toBe(2);
      const value = JSON.parse(response.stdout);
      expect(value).toMatchObject({
        branch,
        mode,
        fired: true,
        rawReads: 0,
        liveDescriptors: 0,
        preservedInode: true,
      });
      expect(value.code).toBe(
        ["ending-mode", "parent-fifo", "symlink"].includes(mode)
          ? "CC_EVOLUTION_LEDGER_STORE_UNSAFE"
          : "CC_EVOLUTION_LEDGER_CORRUPT",
      );
      expect(value.actualReadBytes).toBe(
        mode === "ending-mode" ? value.expectedSize : 0,
      );
      if (mode === "fifo")
        expect(value).toMatchObject({
          actualFifo: true,
          opens: 1,
          nonblocking: true,
        });
      if (mode === "parent-fifo") {
        expect(value.actualFifo).toBe(true);
        expect(value.directoryFlags & fs.constants.O_NONBLOCK).toBe(
          fs.constants.O_NONBLOCK,
        );
        expect(value.directoryFlags & fs.constants.O_DIRECTORY).toBe(
          fs.constants.O_DIRECTORY,
        );
      }
      expect(value.preservedDigest).toBe(value.originalDigest);
    },
  );
});

describe.sequential(
  "real RRSI retained history keeps its original journal and authority directories",
  () => {
    let root, fixture, index, retained;
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(temp, "cc-journal-history-"));
      fixture = openObservedTextFixture(root);
      index = openObservedTextIndex(fixture);
    }, 60_000);
    beforeAll(() => {
      registerPreparationPlan(fixture);
      reservePreparation(fixture);
    }, 60_000);
    beforeAll(() => {
      index.registerObservedSkillText(
        observationRequest(fixture, "# Genuine journal directory boundary\r\n"),
      );
      retained = inspectRrsiTenantIndexHistory({ observedTextIndex: index });
    }, 60_000);
    afterAll(() => cleanup(root, "cc-journal-history-"), 60_000);
    it("replays genuine history with installation and promotion still held", () => {
      expect(retained).toMatchObject({
        localRetainedHistoryReplayed: true,
        fullPhysicalStorageGraphVerified: false,
        tenantWideIndexAuthorityVerified: false,
        generationProvenanceVerified: false,
        grantsMutationOrPromotionAuthority: false,
        decision: "HOLD",
      });
      expect(
        inspectRrsiTenantIndexHistory({ observedTextIndex: index }),
      ).toEqual(retained);
    }, 60_000);
    it.each(["rootDir", "authorityRootDir", "segmentDir", "anchorDir"])(
      "holds history on a same-byte source %s clone and reauthenticates after restoration",
      (kind) => {
        const descriptor = fixture.store.backend.descriptor;
        const source = {
          rootDir: descriptor.rootDir,
          authorityRootDir: descriptor.authorityRootDir,
          segmentDir: path.join(descriptor.rootDir, "segments-v1"),
          anchorDir: path.join(descriptor.authorityRootDir, "head-anchors-v1"),
        };
        const directory = source[kind],
          saved = path.join(root, `saved-${kind}`);
        if (
          !path.resolve(directory).startsWith(path.resolve(root) + path.sep) ||
          path.dirname(saved) !== root
        )
          throw new Error("unsafe source journal directory clone");
        const head = fixture.store.journal.verify();
        const before = fs.readdirSync(directory);
        fs.renameSync(directory, saved);
        fs.cpSync(saved, directory, { recursive: true });
        try {
          let error;
          try {
            inspectRrsiTenantIndexHistory({ observedTextIndex: index });
          } catch (cause) {
            error = cause;
          }
          expect(error).toMatchObject({ code: "CC_RRSI_ANCHOR_HISTORY_HOLD" });
          const chain = [];
          for (let cause = error; cause; cause = cause.cause) chain.push(cause);
          expect(
            chain.some(
              (cause) =>
                cause.code === "CC_EVOLUTION_LEDGER_STORE_UNSAFE" &&
                cause.message.includes("boundary changed or became unsafe"),
            ),
          ).toBe(true);
          expect(fs.readdirSync(directory)).toEqual(before);
        } finally {
          fs.rmSync(directory, { recursive: true, force: true });
          fs.renameSync(saved, directory);
        }
        expect(fixture.store.journal.verify()).toEqual(head);
        expect(
          inspectRrsiTenantIndexHistory({ observedTextIndex: index }),
        ).toEqual(retained);
      },
      60_000,
    );
  },
);
