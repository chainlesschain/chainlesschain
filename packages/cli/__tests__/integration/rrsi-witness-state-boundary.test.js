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
import { EVOLUTION_WITNESS_STATE_READ_FAILED_CODE as FAILED } from "../../src/lib/evolution/evolution-file-witness.js";
import { openWitnessBoundaryFixture } from "../fixtures/evolution-witness-boundary.js";
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
  const target = path.resolve(root);
  if (
    path.dirname(target) !== temp ||
    !path.basename(target).startsWith(prefix)
  )
    throw new Error("unsafe witness integration cleanup");
  fs.rmSync(target, { recursive: true, force: true });
}
describe("real signed witness bytes in a new process", () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(temp, "cc-witness-state-process-"));
  });
  afterEach(() => cleanup(root, "cc-witness-state-process-"));
  const helper = fileURLToPath(
    new URL("../fixtures/rrsi-witness-state-process.mjs", import.meta.url),
  );
  const child = (kind, mode) => {
    // Prepare actual signed/segmented bytes outside the read watchdog. The
    // child only reopens existing storage; no ACL or time budget is widened.
    openWitnessBoundaryFixture(root, { segmented: kind === "segment" });
    return spawnSync(process.execPath, [helper, root, kind, mode, "existing"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    });
  };
  it.each(["head", "segment"])(
    "reauthenticates actual %s bytes with closed bounded descriptors",
    (kind) => {
      const response = child(kind, "read");
      expect(response.error).toBeUndefined();
      expect(response.status, response.stderr).toBe(0);
      const value = JSON.parse(response.stdout);
      expect(value).toMatchObject({
        kind,
        opens: 1,
        rawReads: 0,
        liveDescriptors: 0,
        requestsWithinChunk: true,
        payloadMatched: true,
        fullPhysicalStorageGraphVerified: false,
        grantsMutationOrPromotionAuthority: false,
      });
      expect(value.inspectionError).toBeUndefined();
      expect(value.actualReadBytes).toBe(value.expectedSize);
      expect(value.preservedDigest).toBe(value.originalDigest);
      expect(value.eofProbe).toEqual({
        requested: 1,
        count: 0,
        position: value.expectedSize,
      });
    },
  );
  it.runIf(process.platform !== "win32").each(["head", "segment"])(
    "rejects a real %s FIFO before content reading without waiting for a writer",
    (kind) => {
      const response = child(kind, "fifo");
      expect(response.error).toBeUndefined();
      expect(response.status, response.stderr).toBe(2);
      const value = JSON.parse(response.stderr);
      expect(value).toMatchObject({
        kind,
        code: FAILED,
        message: `${kind === "head" ? "witness" : "witness segment"} file identity is invalid`,
        fired: true,
        opens: 1,
        rawReads: 0,
        actualReadBytes: 0,
        liveDescriptors: 0,
        actualFifo: true,
      });
      expect(value.inspectionError).toBeUndefined();
      expect(value.preservedDigest).toBe(value.originalDigest);
      expect(value.preservedLeafInode).toBe(value.originalLeafInode);
    },
  );
});

describe.sequential(
  "retained RRSI history retains actual source and v2 witness directories",
  () => {
    let root, fixture, index, retained;
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(temp, "cc-witness-state-history-"));
      fixture = openObservedTextFixture(root);
      index = openObservedTextIndex(fixture);
    }, 60_000);
    beforeAll(() => {
      registerPreparationPlan(fixture);
      reservePreparation(fixture);
    }, 60_000);
    beforeAll(() => {
      index.registerObservedSkillText(
        observationRequest(fixture, "# Genuine witness boundary\r\n"),
      );
      retained = inspectRrsiTenantIndexHistory({ observedTextIndex: index });
    }, 60_000);
    afterAll(() => cleanup(root, "cc-witness-state-history-"), 60_000);
    it("authenticates signed retained history while graph and installation authority remain HOLD", () => {
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
    it.each(["source", "v2"])(
      "rejects a same-byte %s witness directory clone and reauthenticates after original restoration",
      (kind) => {
        const file =
          kind === "source"
            ? fixture.store.backend.descriptor.witnessFilePath
            : path.join(
                fixture.store.manifest.storage,
                "witness",
                "checkpoint.json",
              );
        const directory = path.dirname(file),
          saved = path.join(root, `saved-${kind}`),
          copy = path.resolve(directory);
        if (
          !copy.startsWith(path.resolve(root) + path.sep) ||
          path.dirname(saved) !== root
        )
          throw new Error("unsafe witness clone target");
        const original = fs.readFileSync(file),
          journal = fixture.store.journal.verify(),
          names = fs.readdirSync(directory);
        fs.renameSync(directory, saved);
        fs.cpSync(saved, directory, { recursive: true });
        if (process.platform !== "win32")
          fs.chmodSync(directory, fs.statSync(saved).mode & 0o7777);
        try {
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
                cause.message === "witness directory physical identity changed",
            ),
          ).toBe(true);
          expect(fs.readFileSync(file)).toEqual(original);
          expect(fs.readdirSync(directory)).toEqual(names);
        } finally {
          fs.rmSync(copy, { recursive: true, force: true });
          fs.renameSync(saved, directory);
        }
        expect(fixture.store.journal.verify()).toEqual(journal);
        expect(
          inspectRrsiTenantIndexHistory({ observedTextIndex: index }),
        ).toEqual(retained);
      },
      60_000,
    );
  },
);
