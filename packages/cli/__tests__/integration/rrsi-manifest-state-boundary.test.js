import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { EVOLUTION_MANIFEST_STATE_READ_FAILED_CODE as FAILED } from "../../src/lib/evolution/evolution-manifest-state-reader.js";
import {
  inspectRrsiTenantIndexHistory,
  verifyRrsiTenantIndexAnchorHistory,
} from "../../src/lib/evolution/rrsi-tenant-index-anchor-history.js";
import { captureRrsiObservedTextIndex } from "../../src/lib/evolution/rrsi-observed-text-index.js";
import { captureEvolutionLedgerV2JournalManifestDirectoryBoundaries } from "../../src/lib/evolution/evolution-ledger-v2-journal.js";
import { rrsiHash } from "../../src/lib/evolution/rrsi-data.js";
import { v2FixtureDomainEvent } from "../fixtures/evolution-ledger-v2-store.js";
import {
  historyAnchorInput,
  signHistoryAnchor,
} from "../fixtures/rrsi-anchor-history.js";
import {
  openObservedTextFixture,
  openObservedTextIndex,
  registerPreparationPlan,
  reservePreparation,
  observationRequest,
} from "../fixtures/rrsi-observed-text.js";

const temp = fs.realpathSync.native(os.tmpdir());
function cleanup(root, prefix) {
  const target = path.resolve(root);
  if (
    path.dirname(target) !== temp ||
    !path.basename(target).startsWith(prefix)
  )
    throw new Error("unsafe manifest state integration cleanup");
  fs.rmSync(target, { recursive: true, force: true });
}
describe("real manifest state bytes and actual FIFO replacement in a new process", () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(temp, "cc-manifest-state-process-"));
  });
  afterEach(() => cleanup(root, "cc-manifest-state-process-"));
  const helper = fileURLToPath(
    new URL("../fixtures/rrsi-manifest-state-process.mjs", import.meta.url),
  );
  function child(kind, mode) {
    return spawnSync(
      process.execPath,
      [helper, path.join(root, kind), kind, mode],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 15_000,
      },
    );
  }
  it.each(["catalog", "head"])(
    "reads genuine %s backend state with actual descriptor bytes and no authority grant",
    (kind) => {
      const response = child(kind, "read");
      expect(response.error).toBeUndefined();
      expect(response.status, response.stderr).toBe(0);
      const result = JSON.parse(response.stdout);
      expect(result).toMatchObject({
        kind,
        opens: 1,
        rawReads: 0,
        liveDescriptors: 0,
        payloadMatched: true,
        localOnly: true,
        physicalWindowOnly: true,
        fullPhysicalStorageGraphVerified: false,
      });
      expect(result.actualReadBytes).toBe(result.expectedSize);
    },
  );
  it.runIf(process.platform !== "win32").each(["catalog", "head"])(
    "rejects a real %s FIFO leaf without waiting for a writer",
    (kind) => {
      const response = child(kind, "fifo");
      expect(response.error).toBeUndefined();
      expect(response.status, response.stderr).toBe(2);
      const result = JSON.parse(response.stderr);
      expect(result).toMatchObject({
        kind,
        code: FAILED,
        message: `manifest ${kind} file identity is invalid`,
        faultInjected: true,
        opens: 1,
        rawReads: 0,
        actualReadBytes: 0,
        liveDescriptors: 0,
        actualFifoVerified: true,
      });
      expect(result.savedByteLength).toBe(result.expectedSize);
    },
  );
});

describe.sequential(
  "real retained RRSI history keeps its original v2 state directories",
  () => {
    let root, fixture, index, retained;
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(temp, "cc-manifest-state-history-"));
      fixture = openObservedTextFixture(root, { originalManifestPorts: true });
      index = openObservedTextIndex(fixture);
    }, 60_000);
    beforeAll(() => {
      registerPreparationPlan(fixture);
      reservePreparation(fixture);
    }, 60_000);
    beforeAll(() => {
      index.registerObservedSkillText(
        observationRequest(fixture, "# Genuine v2 state boundary\r\n"),
      );
      retained = inspectRrsiTenantIndexHistory({ observedTextIndex: index });
    }, 60_000);
    afterAll(() => cleanup(root, "cc-manifest-state-history-"), 60_000);

    it("authenticates signed retained history while complete physical graph and external authority remain HOLD", () => {
      expect(retained).toMatchObject({
        localRetainedHistoryReplayed: true,
        manifestDirectoryBoundaryRechecked: true,
        manifestBoundaryScope: "original-catalog-and-head-directories",
        fullPhysicalStorageGraphVerified: false,
        tenantWideIndexAuthorityVerified: false,
        generationProvenanceVerified: false,
        grantsMutationOrPromotionAuthority: false,
        decision: "HOLD",
      });
      expect(
        inspectRrsiTenantIndexHistory({ observedTextIndex: index }),
      ).toEqual(retained);
      const original =
        captureEvolutionLedgerV2JournalManifestDirectoryBoundaries(
          fixture.store.journal,
        );
      expect(retained.manifestDirectoryBoundaryDigest).toBe(
        rrsiHash("chainlesschain.rrsi-manifest-directory-boundaries/v1", {
          catalog: original.catalog.descriptor,
          head: original.head.descriptor,
        }),
      );
      const keys = generateKeyPairSync("ed25519");
      const signed = signHistoryAnchor(
        historyAnchorInput(index, retained.current, keys),
        keys,
      );
      const verified = verifyRrsiTenantIndexAnchorHistory({
        observedTextIndex: index,
        previous: signed,
        current: signed,
      });
      expect(verified).toMatchObject({
        manifestDirectoryBoundaryDigest:
          retained.manifestDirectoryBoundaryDigest,
        manifestDirectoryBoundaryRechecked: true,
        manifestBoundaryScope: "original-catalog-and-head-directories",
        storageGraphDigestVerified: false,
        rootAuthorityVerified: false,
        routingPinVerified: false,
        decision: "HOLD",
      });
    }, 60_000);

    it.each(["catalog", "head"])(
      "holds a same-byte %s directory clone and reauthenticates the original signed history after restore",
      (kind) => {
        const target = path.join(fixture.store.manifest.storage, kind),
          saved = path.join(root, `saved-${kind}`),
          copy = path.resolve(target);
        if (
          !copy.startsWith(path.resolve(root) + path.sep) ||
          path.dirname(saved) !== root
        )
          throw new Error("unsafe manifest directory copy target");
        const name = `manifest-${kind}.json`,
          originalBytes = fs.readFileSync(path.join(target, name)),
          head = fixture.store.journal.verify(),
          inode = fs.lstatSync(target, { bigint: true }).ino;
        fs.renameSync(target, saved);
        fs.cpSync(saved, target, { recursive: true });
        try {
          expect(fs.lstatSync(target, { bigint: true }).ino).not.toBe(inode);
          let error;
          try {
            inspectRrsiTenantIndexHistory({ observedTextIndex: index });
          } catch (cause) {
            error = cause;
          }
          expect(error?.code).toBe("CC_RRSI_ANCHOR_HISTORY_HOLD");
          const chain = [];
          for (let current = error; current; current = current.cause)
            chain.push(current);
          expect(
            chain.some(
              (cause) =>
                cause.code === FAILED &&
                cause.message ===
                  `manifest ${kind} directory physical identity changed`,
            ),
          ).toBe(true);
          expect(fs.readFileSync(path.join(target, name))).toEqual(
            originalBytes,
          );
          expect(fs.readdirSync(target)).toEqual([name]);
          // A pre-existing capability must still check the original directory;
          // even opening a new observed-text index cannot claim this clone.
          expect(() => openObservedTextIndex(fixture)).toThrow();
        } finally {
          fs.rmSync(copy, { recursive: true, force: true });
          fs.renameSync(saved, target);
        }
        expect(fixture.store.journal.verify()).toEqual(head);
        expect(
          inspectRrsiTenantIndexHistory({ observedTextIndex: index }),
        ).toEqual(retained);
      },
      60_000,
    );

    it("retains the same directory digest across real append and independent reopen without granting full-graph authority", () => {
      const capture = captureRrsiObservedTextIndex(
        index,
      ).captureHistoryCheckpoints({ checkpoints: [] });
      fixture.store.journal.appendDomainEvent(
        v2FixtureDomainEvent(fixture.store, "manifest-history-append"),
      );
      expect(() => capture.recheck()).toThrow();
      const current = inspectRrsiTenantIndexHistory({
        observedTextIndex: index,
      });
      expect(current.current.checkpoint.sequence).toBeGreaterThan(
        retained.current.checkpoint.sequence,
      );
      expect(current.manifestDirectoryBoundaryDigest).toBe(
        retained.manifestDirectoryBoundaryDigest,
      );
      const reopened = openObservedTextFixture(root, {
        originalManifestPorts: true,
      });
      const reopenedHistory = inspectRrsiTenantIndexHistory({
        observedTextIndex: openObservedTextIndex(reopened),
      });
      expect(reopenedHistory).toEqual(current);
      expect(current).toMatchObject({
        fullPhysicalStorageGraphVerified: false,
        generationProvenanceVerified: false,
        grantsMutationOrPromotionAuthority: false,
        decision: "HOLD",
      });
    }, 60_000);
  },
);
