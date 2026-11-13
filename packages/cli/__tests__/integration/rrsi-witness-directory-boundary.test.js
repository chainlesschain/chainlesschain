import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  captureEvolutionFileWitnessDirectoryBoundaries as captureWitness,
  EVOLUTION_WITNESS_STATE_READ_FAILED_CODE as FAILED,
} from "../../src/lib/evolution/evolution-file-witness.js";
import { captureEvolutionLedgerFileBackendWitnessDirectoryBoundaries as captureSource } from "../../src/lib/evolution/evolution-ledger-file-backend.js";
import { captureEvolutionLedgerV2JournalWitnessDirectoryBoundaries as captureManifest } from "../../src/lib/evolution/evolution-ledger-v2-journal.js";
import {
  captureEvolutionLedgerManifestWitnessDirectoryBoundaries as captureAdapter,
  hasEvolutionLedgerManifestWitnessDirectoryBoundaries as hasAdapter,
} from "../../src/lib/evolution/evolution-ledger-manifest-witness-adapter.js";
import {
  captureRrsiObservedTextIndex,
  RRSI_OBSERVED_TEXT_HOLD_CODE as HOLD,
} from "../../src/lib/evolution/rrsi-observed-text-index.js";
import {
  inspectRrsiTenantIndexHistory,
  verifyRrsiTenantIndexAnchorHistory,
  RRSI_TENANT_INDEX_ANCHOR_HISTORY_HOLD_CODE as HISTORY_HOLD,
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
const options = { originalManifestPorts: true, originalWitnessPorts: true };
const chain = (error) => {
  const result = [];
  for (let cause = error; cause; cause = cause.cause) result.push(cause);
  return result;
};
function safe(root, ...targets) {
  for (const target of targets)
    if (!path.resolve(target).startsWith(path.resolve(root) + path.sep))
      throw new Error("unsafe witness history directory operation");
}

describe.sequential(
  "original source and manifest witnesses in retained history",
  () => {
    let root, fixture, index, initial, retained, components, source, manifest;
    const inspect = () =>
      inspectRrsiTenantIndexHistory({ observedTextIndex: index });
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(temp, "cc-rrsi-witness-directory-"));
      const first = openObservedTextFixture(root, options);
      // These empty directories test original ownership without manufacturing
      // hundreds of ledger events. Actual segmented content is covered separately
      // by evolution-witness-directory-boundary and witness-state regressions.
      for (const cap of [
        captureSource(first.store.backend),
        captureManifest(first.store.journal),
      ]) {
        const directory = path.join(
          cap.descriptor.state.directory.path,
          "checkpoint.json.segments-v2",
        );
        safe(root, directory);
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      }
      fixture = openObservedTextFixture(root, options);
      index = openObservedTextIndex(fixture);
      source = captureSource(fixture.store.backend);
      manifest = captureManifest(fixture.store.journal);
      components = [
        ["source", source],
        ["manifest", manifest],
      ].flatMap(([owner, cap]) =>
        ["state", "segments"].map((role) => ({
          owner,
          role,
          cap,
          directory: cap.descriptor[role].directory.path,
        })),
      );
      initial = inspect();
    }, 60_000);
    beforeAll(() => {
      registerPreparationPlan(fixture);
      reservePreparation(fixture);
    }, 60_000);
    beforeAll(() => {
      index.registerObservedSkillText(
        observationRequest(fixture, "# Retained original witness text\r\n"),
      );
      retained = inspect();
    }, 60_000);
    afterAll(() => {
      vi.restoreAllMocks();
      if (
        path.dirname(root) !== temp ||
        !path.basename(root).startsWith("cc-rrsi-witness-directory-")
      )
        throw new Error("unsafe witness history fixture cleanup");
      fs.rmSync(root, { recursive: true, force: true });
    }, 60_000);

    it("binds both independent original witnesses while retained preparation/text events advance", () => {
      expect(retained.current.checkpoint.sequence).toBeGreaterThan(
        initial.current.checkpoint.sequence,
      );
      expect(captureWitness(fixture.store.backend.witness)).toBe(source);
      expect(captureWitness(fixture.store.manifest.witness)).toBe(manifest);
      expect(captureAdapter(fixture.store.manifest.witnessAdapter)).toBe(
        manifest,
      );
      expect(source).not.toBe(manifest);
      for (const [owner, cap] of [
        ["source", source],
        ["manifest", manifest],
      ]) {
        const field = `${owner}WitnessDirectoryBoundaryDigest`;
        expect(retained[field]).toBe(
          rrsiHash(
            `chainlesschain.rrsi-${owner}-witness-directory-boundaries/v1`,
            cap.descriptor,
          ),
        );
        expect(retained[field]).toBe(initial[field]);
        expect(retained[`${owner}WitnessDirectoryBoundaryRechecked`]).toBe(
          true,
        );
        expect(retained[`${owner}WitnessBoundaryScope`]).toBe(
          "original-witness-state-and-segment-directories",
        );
      }
      expect(retained.localCompositionDigest).toBe(
        initial.localCompositionDigest,
      );
      expect(retained).toMatchObject({
        fullPhysicalStorageGraphVerified: false,
        grantsMutationOrPromotionAuthority: false,
        decision: "HOLD",
      });
    });

    it("keeps wrapper-backed manifest witnesses usable but explicitly unclaimed", () => {
      const wrapped = openObservedTextFixture(path.join(root, "wrapped"), {
        originalManifestPorts: true,
      });
      expect(captureManifest(wrapped.store.journal)).toBeNull();
      expect(hasAdapter(wrapped.store.manifest.witnessAdapter)).toBe(false);
      expect(() =>
        captureAdapter(wrapped.store.manifest.witnessAdapter),
      ).toThrow(TypeError);
      const report = inspectRrsiTenantIndexHistory({
        observedTextIndex: openObservedTextIndex(wrapped),
      });
      expect(report).toMatchObject({
        sourceWitnessDirectoryBoundaryRechecked: true,
        manifestWitnessDirectoryBoundaryDigest: null,
        manifestWitnessDirectoryBoundaryRechecked: false,
        manifestWitnessBoundaryScope: null,
        fullPhysicalStorageGraphVerified: false,
        decision: "HOLD",
      });
    }, 60_000);

    it("checks factory ownership without caller traps or filesystem probes", () => {
      let traps = 0;
      const adapter = fixture.store.manifest.witnessAdapter;
      const handler = Object.fromEntries(
        ["get", "ownKeys", "getPrototypeOf"].map((name) => [
          name,
          () => {
            traps++;
            throw new Error("caller trap");
          },
        ]),
      );
      const revoked = Proxy.revocable(adapter, handler);
      revoked.revoke();
      const fakes = [
        null,
        { ...adapter },
        new Proxy(adapter, handler),
        revoked.proxy,
      ];
      const spy = vi.spyOn(fs, "lstatSync").mockImplementation(() => {
        traps++;
        throw new Error("ownership probe I/O");
      });
      try {
        expect(hasAdapter(adapter)).toBe(true);
        for (const fake of fakes) {
          expect(hasAdapter(fake)).toBe(false);
          expect(() => captureAdapter(fake)).toThrow(TypeError);
        }
        expect(() => captureSource({ ...fixture.store.backend })).toThrow(
          TypeError,
        );
        expect(() => captureManifest({ ...fixture.store.journal })).toThrow(
          TypeError,
        );
        expect(() => captureSource(fixture.store.backend, {})).toThrow(
          TypeError,
        );
        expect(() => captureManifest(fixture.store.journal, {})).toThrow(
          TypeError,
        );
        expect(traps).toBe(0);
      } finally {
        spy.mockRestore();
      }
    });

    it("projects the same component digests into a genuine signed anchor history check", () => {
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
      expect(result.sourceWitnessDirectoryBoundaryDigest).toBe(
        retained.sourceWitnessDirectoryBoundaryDigest,
      );
      expect(result.manifestWitnessDirectoryBoundaryDigest).toBe(
        retained.manifestWitnessDirectoryBoundaryDigest,
      );
      expect(result).toMatchObject({
        sourceWitnessDirectoryBoundaryRechecked: true,
        manifestWitnessDirectoryBoundaryRechecked: true,
        storageGraphDigestVerified: false,
        decision: "HOLD",
      });
      expect(JSON.stringify(current.anchor)).not.toContain(
        "WitnessDirectoryBoundary",
      );
    }, 60_000);

    it.each([0, 1, 2, 3])(
      "rejects a real clone of witness component %i and recovers only the original directory",
      (i) => {
        const { directory, cap } = components[i];
        const saved = path.join(root, `original-${i}`);
        safe(root, directory, saved);
        fs.renameSync(directory, saved);
        try {
          fs.cpSync(saved, directory, { recursive: true });
          expect(() => cap.recheck()).toThrow(
            expect.objectContaining({ code: FAILED }),
          );
          let error;
          try {
            inspect();
          } catch (cause) {
            error = cause;
          }
          expect(error?.code).toBe(HISTORY_HOLD);
          expect(chain(error).some((cause) => cause.code === HOLD)).toBe(true);
          expect(chain(error).some((cause) => cause.code === FAILED)).toBe(
            true,
          );
        } finally {
          if (fs.existsSync(directory))
            fs.rmSync(directory, { recursive: true, force: true });
          fs.renameSync(saved, directory);
        }
        expect(inspect()).toEqual(retained);
      },
      60_000,
    );

    it.each([0, 1, 2, 3])(
      "rejects witness component %i replaced only after the final journal verification",
      (i) => {
        const history = captureRrsiObservedTextIndex(
          index,
        ).captureHistoryCheckpoints({ checkpoints: [] });
        const { directory } = components[i];
        const saved = path.join(root, `late-${i}`);
        safe(root, directory, saved);
        const artifactFiles = path.join(root, "store", "artifacts", "files");
        const originalLstat = fs.lstatSync;
        let count = 0,
          at = Infinity,
          fired = false;
        const spy = vi
          .spyOn(fs, "lstatSync")
          .mockImplementation((target, ...args) => {
            const stat = originalLstat(target, ...args);
            if (target === artifactFiles && ++count === at) {
              fired = true;
              fs.renameSync(directory, saved);
              fs.cpSync(saved, directory, { recursive: true });
            }
            return stat;
          });
        try {
          expect(history.recheck()).toBe(true);
          expect(count).toBeGreaterThan(0);
          at = count;
          count = 0;
          let error;
          try {
            history.recheck();
          } catch (cause) {
            error = cause;
          }
          expect(fired).toBe(true);
          expect(error?.code).toBe(HOLD);
          expect(chain(error).some((cause) => cause.code === FAILED)).toBe(
            true,
          );
        } finally {
          spy.mockRestore();
          if (fired) {
            fs.rmSync(directory, { recursive: true, force: true });
            fs.renameSync(saved, directory);
          }
        }
        expect(history.recheck()).toBe(true);
        expect(inspect()).toEqual(retained);
      },
      60_000,
    );

    it("reopens both original witnesses without changing persistent index identity or history results", () => {
      const reopened = openObservedTextFixture(root, options);
      const next = openObservedTextIndex(reopened);
      expect(next.descriptor).toEqual(index.descriptor);
      expect(
        inspectRrsiTenantIndexHistory({ observedTextIndex: next }),
      ).toEqual(retained);
    }, 60_000);
  },
);
