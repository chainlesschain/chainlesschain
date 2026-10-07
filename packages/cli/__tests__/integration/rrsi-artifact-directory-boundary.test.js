import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureEvolutionArtifactStoreDirectoryBoundary } from "../../src/lib/evolution/evolution-artifact-ports.js";
import {
  createRrsiObservedTextIndex,
  RRSI_OBSERVED_TEXT_HOLD_CODE as HOLD,
} from "../../src/lib/evolution/rrsi-observed-text-index.js";
import { inspectRrsiTenantIndexHistory } from "../../src/lib/evolution/rrsi-tenant-index-anchor-history.js";
import { rrsiHash } from "../../src/lib/evolution/rrsi-data.js";
import {
  openObservedTextFixture,
  openObservedTextIndex,
  registerPreparationPlan,
  reservePreparation,
  observationRequest,
} from "../fixtures/rrsi-observed-text.js";
import { openArtifactDirectoryPorts } from "../fixtures/rrsi-artifact-directory.js";

const temp = fs.realpathSync.native(os.tmpdir());
let root;
afterAll(() => {
  const target = path.resolve(root);
  if (
    path.dirname(target) !== temp ||
    !path.basename(target).startsWith("cc-rrsi-artifact-boundary-")
  )
    throw new Error("unsafe RRSI artifact boundary cleanup");
  fs.rmSync(target, { recursive: true, force: true });
}, 60_000);
function safeTargets(...targets) {
  for (const target of targets) {
    const relative = path.relative(root, path.resolve(target));
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      throw new Error("unsafe RRSI directory replacement target");
  }
}
function bytes(target) {
  const result = [];
  function visit(value) {
    const stat = fs.lstatSync(value);
    if (stat.isFile())
      result.push({
        path: path.relative(target, value),
        bytes: fs.readFileSync(value).toString("base64"),
      });
    else if (stat.isDirectory())
      for (const name of fs.readdirSync(value).sort())
        visit(path.join(value, name));
  }
  visit(target);
  return result;
}
describe.sequential(
  "genuine RRSI index retains its original artifact directory boundary",
  () => {
    let fixture, index, empty, retained, boundary;
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(temp, "cc-rrsi-artifact-boundary-"));
      fixture = openObservedTextFixture(root);
      index = openObservedTextIndex(fixture);
      empty = inspectRrsiTenantIndexHistory({ observedTextIndex: index });
      boundary = captureEvolutionArtifactStoreDirectoryBoundary(
        fixture.store.artifactPorts,
      );
    }, 60_000);
    beforeAll(() => {
      registerPreparationPlan(fixture);
      reservePreparation(fixture);
    }, 60_000);
    beforeAll(() => {
      index.registerObservedSkillText(
        observationRequest(fixture, "# Real directory boundary Skill\r\n"),
      );
      retained = inspectRrsiTenantIndexHistory({ observedTextIndex: index });
    }, 60_000);
    it("adds the exact directory-only digest without changing persisted index descriptors or composition semantics", () => {
      const expected = rrsiHash(
        "chainlesschain.rrsi-file-artifact-store-directory-boundary/v1",
        boundary.descriptor,
      );
      expect(empty.artifactStoreDirectoryBoundaryDigest).toBe(expected);
      expect(retained.artifactStoreDirectoryBoundaryDigest).toBe(expected);
      expect(retained).toMatchObject({
        artifactStoreDirectoryBoundaryRechecked: true,
        artifactStoreBoundaryScope: "root-and-files-directories",
        fullPhysicalStorageGraphVerified: false,
        tenantWideIndexAuthorityVerified: false,
        generationProvenanceVerified: false,
        decision: "HOLD",
      });
      expect(index.descriptor).not.toHaveProperty(
        "artifactStoreDirectoryBoundaryDigest",
      );
      expect(retained.localCompositionDigest).toBe(
        empty.localCompositionDigest,
      );
    }, 60_000);
    it.each(["root", "files"])(
      "holds a same-byte physical %s clone while original journal identity/history is unchanged",
      (name) => {
        const original = path.join(root, "store", "artifacts");
        const target =
            name === "root" ? original : path.join(original, "files"),
          saved = path.join(root, `saved-${name}`);
        const before = bytes(original),
          head = fixture.store.journal.verify(),
          identity = index.descriptor.ledgerIdentity;
        safeTargets(target, saved);
        fs.renameSync(target, saved);
        fs.cpSync(saved, target, { recursive: true });
        try {
          expect(bytes(original)).toEqual(before);
          expect(index.descriptor.ledgerIdentity).toBe(identity);
          let error;
          try {
            inspectRrsiTenantIndexHistory({ observedTextIndex: index });
          } catch (cause) {
            error = cause;
          }
          expect(error).toMatchObject({
            code: "CC_RRSI_ANCHOR_HISTORY_HOLD",
            cause: {
              code: HOLD,
              cause: {
                code: "CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED",
                message: `ArtifactStore ${name === "root" ? "root" : "files root"} physical identity changed`,
              },
            },
          });
          expect(bytes(original)).toEqual(before);
        } finally {
          safeTargets(target, saved);
          fs.rmSync(target, { recursive: true, force: true });
          fs.renameSync(saved, target);
        }
        expect(fixture.store.journal.verify()).toEqual(head);
        expect(
          inspectRrsiTenantIndexHistory({ observedTextIndex: index })
            .artifactStoreDirectoryBoundaryDigest,
        ).toBe(retained.artifactStoreDirectoryBoundaryDigest);
      },
      60_000,
    );
    it("refuses another genuine ports/resolver mixed into the original policy/backend", () => {
      const other = openArtifactDirectoryPorts(
        path.join(root, "other-artifacts"),
        {
          artifactTenantId: index.descriptor.artifactTenantId,
          audience: index.descriptor.audience,
        },
      );
      const resolver = other.ports.createEvolutionLedgerArtifactResolver({
        purpose: "evolution-ledger",
      });
      expect(() =>
        createRrsiObservedTextIndex({
          ...fixture.composition,
          artifactPorts: other.ports,
          ledgerArtifactResolver: resolver,
        }),
      ).toThrow(
        expect.objectContaining({
          code: HOLD,
          message: "text index requires the original policy storage graph",
        }),
      );
      const captured = captureEvolutionArtifactStoreDirectoryBoundary(
        other.ports,
      );
      expect(
        rrsiHash(
          "chainlesschain.rrsi-file-artifact-store-directory-boundary/v1",
          captured.descriptor,
        ),
      ).not.toBe(retained.artifactStoreDirectoryBoundaryDigest);
    });
    it("reopens the same original physical directories with the same digest and no tenant authority", () => {
      const reopened = openObservedTextFixture(root),
        fresh = openObservedTextIndex(reopened);
      const snapshot = inspectRrsiTenantIndexHistory({
        observedTextIndex: fresh,
      });
      expect(snapshot.artifactStoreDirectoryBoundaryDigest).toBe(
        retained.artifactStoreDirectoryBoundaryDigest,
      );
      expect(snapshot).toMatchObject({
        fullPhysicalStorageGraphVerified: false,
        tenantWideIndexAuthorityVerified: false,
        grantsMutationOrPromotionAuthority: false,
        decision: "HOLD",
      });
    }, 60_000);
  },
);
