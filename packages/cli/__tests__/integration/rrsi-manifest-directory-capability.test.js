import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { captureEvolutionLedgerFileManifestCatalogDirectoryBoundary as captureCatalog } from "../../src/lib/evolution/evolution-ledger-file-manifest-catalog.js";
import { captureEvolutionLedgerFileManifestHeadDirectoryBoundary as captureHead } from "../../src/lib/evolution/evolution-ledger-file-manifest-head-store.js";
import { captureEvolutionLedgerV2ManifestDirectoryBoundaries as captureComposition } from "../../src/lib/evolution/evolution-ledger-v2-manifest-backend.js";
import { captureEvolutionLedgerV2JournalManifestDirectoryBoundaries as captureJournal } from "../../src/lib/evolution/evolution-ledger-v2-journal.js";
import { rrsiHash } from "../../src/lib/evolution/rrsi-data.js";
import { EVOLUTION_MANIFEST_STATE_READ_FAILED_CODE as FAILED } from "../../src/lib/evolution/evolution-manifest-state-reader.js";
import { inspectRrsiTenantIndexHistory } from "../../src/lib/evolution/rrsi-tenant-index-anchor-history.js";
import {
  createRrsiObservedTextIndex,
  captureRrsiObservedTextIndex,
  RRSI_OBSERVED_TEXT_HOLD_CODE,
} from "../../src/lib/evolution/rrsi-observed-text-index.js";
import {
  openObservedTextFixture,
  openObservedTextIndex,
  registerPreparationPlan,
  reservePreparation,
  observationRequest,
} from "../fixtures/rrsi-observed-text.js";

const temp = fs.realpathSync.native(os.tmpdir());
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const chain = (error) => {
  const out = [];
  for (let cause = error; cause; cause = cause.cause) out.push(cause);
  return out;
};
describe.sequential(
  "genuine manifest directory components alongside retained RRSI history",
  () => {
    let root, fixture, index, initial, retained, components, backendDescriptors;
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(temp, "cc-rrsi-manifest-cap-"));
      fixture = openObservedTextFixture(root, { originalManifestPorts: true });
      index = openObservedTextIndex(fixture);
      const manifest = fixture.store.manifest;
      components = [
        {
          role: "catalog",
          backend: manifest.catalogBackend,
          capture: captureCatalog,
        },
        { role: "head", backend: manifest.headBackend, capture: captureHead },
      ].map((value) => {
        const cap = value.capture(value.backend);
        return { ...value, cap, digest: hash(cap.descriptor) };
      });
      backendDescriptors = components.map((value) =>
        JSON.stringify(value.backend.descriptor),
      );
      initial = inspectRrsiTenantIndexHistory({ observedTextIndex: index });
    }, 60_000);
    beforeAll(() => {
      registerPreparationPlan(fixture);
      reservePreparation(fixture);
    }, 60_000);
    beforeAll(() => {
      index.registerObservedSkillText(
        observationRequest(fixture, "# Original manifest directory text\r\n"),
      );
      retained = inspectRrsiTenantIndexHistory({ observedTextIndex: index });
    }, 60_000);
    afterAll(() => {
      if (
        path.dirname(root) !== temp ||
        !path.basename(root).startsWith("cc-rrsi-manifest-cap-")
      )
        throw new Error("unsafe manifest capability integration cleanup");
      fs.rmSync(root, { recursive: true, force: true });
    }, 60_000);
    it("holds exact original raw-backend capabilities through real preparation and observed-text commits", () => {
      expect(retained.current.checkpoint.sequence).toBeGreaterThan(
        initial.current.checkpoint.sequence,
      );
      for (const [i, value] of components.entries()) {
        expect(value.capture(value.backend)).toBe(value.cap);
        expect(hash(value.cap.recheck())).toBe(value.digest);
        expect(JSON.stringify(value.backend.descriptor)).toBe(
          backendDescriptors[i],
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
      expect(retained.manifestDirectoryBoundaryDigest).toBe(
        rrsiHash("chainlesschain.rrsi-manifest-directory-boundaries/v1", {
          catalog: components[0].cap.descriptor,
          head: components[1].cap.descriptor,
        }),
      );
      expect(retained.manifestDirectoryBoundaryDigest).toBe(
        initial.manifestDirectoryBoundaryDigest,
      );
      expect(retained.manifestDirectoryBoundaryRechecked).toBe(true);
    });
    it("captures only the actual factory's catalog and head through retained history commits", () => {
      const original = captureComposition(fixture.store.manifest.backend);
      expect(Object.isFrozen(original)).toBe(true);
      expect(captureComposition(fixture.store.manifest.backend)).toBe(original);
      expect(original.catalog).toBe(components[0].cap);
      expect(original.head).toBe(components[1].cap);
      expect(captureJournal(fixture.store.journal)).toBe(original);
      expect(
        inspectRrsiTenantIndexHistory({ observedTextIndex: index }),
      ).toEqual(retained);
      expect(original.catalog.descriptor.fullPhysicalStorageGraphVerified).toBe(
        false,
      );
      expect(original.head.descriptor.grantsMutationOrPromotionAuthority).toBe(
        false,
      );
    });
    it("keeps wrapped fault-injection stores usable without granting them original ownership", () => {
      const wrapped = openObservedTextFixture(path.join(root, "wrapped"));
      expect(() =>
        inspectRrsiTenantIndexHistory({
          observedTextIndex: openObservedTextIndex(wrapped),
        }),
      ).not.toThrow();
      expect(captureJournal(wrapped.store.journal)).toBeNull();
      expect(
        inspectRrsiTenantIndexHistory({
          observedTextIndex: openObservedTextIndex(wrapped),
        }),
      ).toMatchObject({
        manifestDirectoryBoundaryDigest: null,
        manifestDirectoryBoundaryRechecked: false,
        manifestBoundaryScope: null,
        fullPhysicalStorageGraphVerified: false,
        decision: "HOLD",
      });
      expect(() => captureComposition(wrapped.store.manifest.backend)).toThrow(
        TypeError,
      );
      const original = fixture.store.manifest.backend;
      let traps = 0;
      const proxy = new Proxy(original, {
        get() {
          traps++;
          throw new Error("untrusted getter");
        },
      });
      const revoked = Proxy.revocable(original, {});
      revoked.revoke();
      for (const fake of [{ ...original }, proxy, revoked.proxy, null])
        expect(() => captureComposition(fake)).toThrow(TypeError);
      expect(() => captureComposition(original, {})).toThrow(TypeError);
      expect(traps).toBe(0);
      for (const fake of [
        { ...fixture.store.journal },
        proxy,
        revoked.proxy,
        null,
      ])
        expect(() => captureJournal(fake)).toThrow(TypeError);
      expect(() => captureJournal(fixture.store.journal, {})).toThrow(
        TypeError,
      );
      expect(traps).toBe(0);
    }, 60_000);
    it.each(["catalog", "head"])(
      "rejects an actual %s clone with the original component and existing history reader",
      (role) => {
        const value = components.find((item) => item.role === role),
          directory = value.cap.descriptor.directory.path;
        const saved = path.join(root, `saved-${role}`);
        for (const target of [directory, saved])
          if (!path.resolve(target).startsWith(path.resolve(root) + path.sep))
            throw new Error("unsafe real manifest clone");
        fs.renameSync(directory, saved);
        fs.cpSync(saved, directory, { recursive: true });
        try {
          expect(() => value.capture(value.backend)).toThrowError(
            expect.objectContaining({ code: FAILED }),
          );
          expect(() =>
            captureComposition(fixture.store.manifest.backend),
          ).toThrowError(expect.objectContaining({ code: FAILED }));
          let error;
          try {
            inspectRrsiTenantIndexHistory({ observedTextIndex: index });
          } catch (cause) {
            error = cause;
          }
          expect(error?.code).toBe("CC_RRSI_ANCHOR_HISTORY_HOLD");
          expect(chain(error).some((cause) => cause.code === FAILED)).toBe(
            true,
          );
        } finally {
          fs.rmSync(directory, { recursive: true, force: true });
          fs.renameSync(saved, directory);
        }
        expect(hash(value.cap.recheck())).toBe(value.digest);
        expect(
          inspectRrsiTenantIndexHistory({ observedTextIndex: index }),
        ).toEqual(retained);
      },
      60_000,
    );
    it("refuses structural factory wrappers rather than using equal descriptor paths as ownership", () => {
      for (const value of components)
        expect(() => value.capture({ ...value.backend })).toThrow(TypeError);
      expect(() => captureCatalog(fixture.store.backend)).toThrow(TypeError);
      expect(() => captureHead(fixture.store.backend.ledger)).toThrow(
        TypeError,
      );
    });
    it.each(["catalog", "head"])(
      "rechecks the original %s after the final journal verification has returned",
      (role) => {
        const history = captureRrsiObservedTextIndex(
          index,
        ).captureHistoryCheckpoints({ checkpoints: [] });
        const directory = components.find((value) => value.role === role).cap
          .descriptor.directory.path;
        const saved = path.join(root, `late-${role}`);
        for (const target of [directory, saved])
          if (!path.resolve(target).startsWith(path.resolve(root) + path.sep))
            throw new Error("unsafe late manifest clone");
        const artifactFiles = path.join(root, "store", "artifacts", "files");
        const nativeLstat = fs.lstatSync;
        let count = 0,
          at = Infinity,
          fired = false;
        const spy = vi
          .spyOn(fs, "lstatSync")
          .mockImplementation((target, ...args) => {
            const stat = nativeLstat(target, ...args);
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
          expect(count).toBe(at);
          expect(error?.code).toBe(RRSI_OBSERVED_TEXT_HOLD_CODE);
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
        expect(
          inspectRrsiTenantIndexHistory({ observedTextIndex: index }),
        ).toEqual(retained);
      },
      60_000,
    );
    it("does not accept caller capabilities as a graph or history-composition grant", () => {
      let getters = 0;
      expect(() =>
        createRrsiObservedTextIndex({
          ...fixture.composition,
          get manifestDirectoryBoundary() {
            getters++;
            return components[0].cap;
          },
        }),
      ).toThrow();
      expect(getters).toBe(0);
      for (const value of components)
        expect(value.cap.descriptor).toMatchObject({
          fileIdentityVerified: false,
          fileContentsVerified: false,
          storageInventoryVerified: false,
          retentionStorageVerified: false,
          fullPhysicalStorageGraphVerified: false,
          rootAuthorityVerified: false,
          routingPinVerified: false,
          crossProcessRollbackProtectionVerified: false,
          grantsMutationOrPromotionAuthority: false,
        });
    });
    it("reopens original retained history and both original directories without changing composition or descriptors", () => {
      const reopened = openObservedTextFixture(root, {
          originalManifestPorts: true,
        }),
        next = openObservedTextIndex(reopened);
      const reopenedComposition = captureComposition(
        reopened.store.manifest.backend,
      );
      expect(hash(reopenedComposition.catalog.descriptor)).toBe(
        components[0].digest,
      );
      expect(hash(reopenedComposition.head.descriptor)).toBe(
        components[1].digest,
      );
      expect(
        inspectRrsiTenantIndexHistory({ observedTextIndex: next }),
      ).toEqual(retained);
      expect(
        hash(captureCatalog(reopened.store.manifest.catalogBackend).descriptor),
      ).toBe(components[0].digest);
      expect(
        hash(captureHead(reopened.store.manifest.headBackend).descriptor),
      ).toBe(components[1].digest);
      expect(next.descriptor).toEqual(index.descriptor);
    }, 60_000);
  },
);
