import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureEvolutionLedgerFileManifestCatalogDirectoryBoundary as captureCatalog } from "../../src/lib/evolution/evolution-ledger-file-manifest-catalog.js";
import { captureEvolutionLedgerFileManifestHeadDirectoryBoundary as captureHead } from "../../src/lib/evolution/evolution-ledger-file-manifest-head-store.js";
import { EVOLUTION_MANIFEST_STATE_READ_FAILED_CODE as FAILED } from "../../src/lib/evolution/evolution-manifest-state-reader.js";
import { inspectRrsiTenantIndexHistory } from "../../src/lib/evolution/rrsi-tenant-index-anchor-history.js";
import { createRrsiObservedTextIndex } from "../../src/lib/evolution/rrsi-observed-text-index.js";
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
      fixture = openObservedTextFixture(root);
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
      expect(retained).not.toHaveProperty("manifestDirectoryBoundaryDigest");
    });
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
      const reopened = openObservedTextFixture(root),
        next = openObservedTextIndex(reopened);
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
