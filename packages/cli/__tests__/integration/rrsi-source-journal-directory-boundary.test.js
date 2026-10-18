import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { captureEvolutionLedgerDirectoryBoundary } from "../../src/lib/evolution/evolution-ledger.js";
import { captureEvolutionLedgerFileBackendSourceDirectoryBoundary as captureBackend } from "../../src/lib/evolution/evolution-ledger-file-backend.js";
import {
  captureRrsiObservedTextIndex,
  createRrsiObservedTextIndex,
  RRSI_OBSERVED_TEXT_HOLD_CODE,
} from "../../src/lib/evolution/rrsi-observed-text-index.js";
import {
  inspectRrsiTenantIndexHistory,
  verifyRrsiTenantIndexAnchorHistory,
} from "../../src/lib/evolution/rrsi-tenant-index-anchor-history.js";
import { rrsiHash } from "../../src/lib/evolution/rrsi-data.js";
import {
  openObservedTextFixture,
  openObservedTextIndex,
  registerPreparationPlan,
  reservePreparation,
  observationRequest,
} from "../fixtures/rrsi-observed-text.js";
import {
  historyAnchorInput,
  signHistoryAnchor,
} from "../fixtures/rrsi-anchor-history.js";

const temp = fs.realpathSync.native(os.tmpdir());
const hash = (descriptor) =>
  rrsiHash(
    "chainlesschain.rrsi-source-journal-directory-boundary/v1",
    descriptor,
  );
const chain = (error) => {
  const out = [];
  for (let cause = error; cause; cause = cause.cause) out.push(cause);
  return out;
};
function safe(root, ...targets) {
  for (const target of targets)
    if (!path.resolve(target).startsWith(path.resolve(root) + path.sep))
      throw new Error("unsafe source directory replacement");
}
function captureError(operation) {
  try {
    operation();
  } catch (error) {
    return error;
  }
  throw new Error("expected a source-directory HOLD");
}
describe.sequential(
  "RRSI history carries its original source journal directory capability",
  () => {
    let root, fixture, index, boundary, initial, retained, descriptor;
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(temp, "cc-rrsi-source-directory-"));
      fixture = openObservedTextFixture(root);
      index = openObservedTextIndex(fixture);
      boundary = captureBackend(fixture.store.backend);
      initial = inspectRrsiTenantIndexHistory({ observedTextIndex: index });
      descriptor = JSON.stringify(index.descriptor);
    }, 60_000);
    beforeAll(() => {
      registerPreparationPlan(fixture);
      reservePreparation(fixture);
    }, 60_000);
    beforeAll(() => {
      index.registerObservedSkillText(
        observationRequest(fixture, "# Original source directory Skill\r\n"),
      );
      retained = inspectRrsiTenantIndexHistory({ observedTextIndex: index });
    }, 60_000);
    afterAll(() => {
      vi.restoreAllMocks();
      if (
        path.dirname(root) !== temp ||
        !path.basename(root).startsWith("cc-rrsi-source-directory-")
      )
        throw new Error("unsafe RRSI source cleanup");
      fs.rmSync(root, { recursive: true, force: true });
    }, 60_000);
    it("exports the private source even when the public journal is a v2 wrapper", () => {
      expect(() =>
        captureEvolutionLedgerDirectoryBoundary(fixture.store.backend.ledger),
      ).toThrow(TypeError);
      expect(captureBackend(fixture.store.backend)).toBe(boundary);
      expect(
        boundary.descriptor.directories.map((entry) => entry.role),
      ).toEqual(["events", "authority", "segments", "anchors"]);
      const expected = hash(boundary.descriptor);
      for (const snapshot of [initial, retained])
        expect(snapshot).toMatchObject({
          sourceJournalDirectoryBoundaryDigest: expected,
          sourceJournalDirectoryBoundaryRechecked: true,
          sourceJournalBoundaryScope: "source-journal-four-directories",
          fullPhysicalStorageGraphVerified: false,
          tenantWideIndexAuthorityVerified: false,
          generationProvenanceVerified: false,
          grantsMutationOrPromotionAuthority: false,
          decision: "HOLD",
        });
      expect(retained.localCompositionDigest).toBe(
        initial.localCompositionDigest,
      );
      expect(JSON.stringify(index.descriptor)).toBe(descriptor);
      expect(index.descriptor).not.toHaveProperty(
        "sourceJournalDirectoryBoundaryDigest",
      );
    });
    it("includes the exact source digest in signed-prefix checks without authenticating declared graph or installer authority", () => {
      const keys = generateKeyPairSync("ed25519");
      const previous = signHistoryAnchor(
        historyAnchorInput(index, initial.current, keys),
        keys,
      );
      const current = signHistoryAnchor(
        historyAnchorInput(
          index,
          retained.current,
          keys,
          2,
          previous.anchor.anchorDigest,
        ),
        keys,
      );
      const result = verifyRrsiTenantIndexAnchorHistory({
        observedTextIndex: index,
        previous,
        current,
      });
      expect(result).toMatchObject({
        sourceJournalDirectoryBoundaryDigest: hash(boundary.descriptor),
        sourceJournalDirectoryBoundaryRechecked: true,
        sourceJournalBoundaryScope: "source-journal-four-directories",
        localRetainedHistoryReplayed: true,
        fullPhysicalStorageGraphVerified: false,
        storageGraphDigestVerified: false,
        rootAuthorityVerified: false,
        installationBindingSignatureVerified: false,
        routingPinVerified: false,
        crossProcessRollbackProtectionVerified: false,
        grantsMutationOrPromotionAuthority: false,
        decision: "HOLD",
      });
    }, 60_000);
    it.each(["events", "authority", "segments", "anchors"])(
      "holds an actual %s clone and recovers only after original restoration",
      (role) => {
        const directory = boundary.descriptor.directories.find(
          (entry) => entry.role === role,
        ).path;
        const saved = path.join(root, "saved-source-directory");
        safe(root, directory, saved);
        const head = fixture.store.journal.verify();
        fs.renameSync(directory, saved);
        fs.cpSync(saved, directory, { recursive: true });
        try {
          const error = captureError(() =>
            inspectRrsiTenantIndexHistory({ observedTextIndex: index }),
          );
          expect(error.code).toBe("CC_RRSI_ANCHOR_HISTORY_HOLD");
          expect(
            chain(error).some(
              (cause) =>
                cause.code === "CC_EVOLUTION_LEDGER_STORE_UNSAFE" &&
                cause.message.includes("boundary changed or became unsafe"),
            ),
          ).toBe(true);
          expect(JSON.stringify(index.descriptor)).toBe(descriptor);
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
    it("rechecks source directories after the final artifact-directory callback, after journal verification returned", () => {
      const history = captureRrsiObservedTextIndex(
        index,
      ).captureHistoryCheckpoints({ checkpoints: [] });
      const directory = boundary.descriptor.directories.find(
        (entry) => entry.role === "segments",
      ).path;
      const saved = path.join(root, "late-source-directory"),
        artifactFiles = path.join(root, "store", "artifacts", "files");
      safe(root, directory, saved);
      const nativeLstat = fs.lstatSync;
      let count = 0,
        at = Infinity,
        fired = false;
      const spy = vi
        .spyOn(fs, "lstatSync")
        .mockImplementation((target, ...args) => {
          const stat = nativeLstat(target, ...args);
          if (target === artifactFiles) {
            count++;
            if (count === at) {
              fired = true;
              fs.renameSync(directory, saved);
              fs.cpSync(saved, directory, { recursive: true });
            }
          }
          return stat;
        });
      try {
        expect(history.recheck()).toBe(true);
        expect(count).toBeGreaterThan(0);
        at = count;
        count = 0;
        const error = captureError(() => history.recheck());
        expect(fired).toBe(true);
        expect(count).toBe(at);
        expect(error.code).toBe(RRSI_OBSERVED_TEXT_HOLD_CODE);
        expect(
          chain(error).some(
            (cause) =>
              cause.code === "CC_EVOLUTION_LEDGER_STORE_UNSAFE" &&
              cause.message.includes("boundary changed or became unsafe"),
          ),
        ).toBe(true);
      } finally {
        spy.mockRestore();
        if (fired) {
          fs.rmSync(directory, { recursive: true, force: true });
          fs.renameSync(saved, directory);
        }
      }
      expect(history.recheck()).toBe(true);
      expect(
        inspectRrsiTenantIndexHistory({ observedTextIndex: index }),
      ).toEqual(retained);
    }, 60_000);
    it("refuses caller-provided replacement directory capabilities before invoking accessors", () => {
      let calls = 0;
      const composition = {
        ...fixture.composition,
        get sourceJournalBoundary() {
          calls++;
          throw new Error("replacement accessor");
        },
      };
      expect(() => createRrsiObservedTextIndex(composition)).toThrow();
      expect(calls).toBe(0);
    });
    it("reopens original retained records with an unchanged persistent descriptor and local composition", () => {
      const reopened = openObservedTextFixture(root),
        next = openObservedTextIndex(reopened);
      const history = inspectRrsiTenantIndexHistory({
        observedTextIndex: next,
      });
      expect(JSON.stringify(next.descriptor)).toBe(descriptor);
      expect(history).toEqual(retained);
      expect(hash(captureBackend(reopened.store.backend).descriptor)).toBe(
        hash(boundary.descriptor),
      );
    }, 60_000);
  },
);
