import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  inspectRrsiTenantIndexHistory,
  RRSI_TENANT_INDEX_ANCHOR_HISTORY_HOLD_CODE as HOLD,
} from "../../src/lib/evolution/rrsi-tenant-index-anchor-history.js";
import { captureRrsiObservedTextIndex } from "../../src/lib/evolution/rrsi-observed-text-index.js";
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
const helper = fileURLToPath(
  new URL("../fixtures/rrsi-anchor-history-process.mjs", import.meta.url),
);
let root;
afterAll(() => {
  const target = path.resolve(root);
  if (
    path.dirname(target) !== temp ||
    !path.basename(target).startsWith("cc-rrsi-anchor-prefix-process-")
  )
    throw new Error("unsafe anchor prefix process cleanup");
  fs.rmSync(target, { recursive: true, force: true });
}, 60_000);
function child(mode, value = {}) {
  return spawnSync(
    process.execPath,
    [helper, root, mode, JSON.stringify(value)],
    { encoding: "utf8", windowsHide: true, timeout: 90_000 },
  );
}
function artifacts() {
  const base = path.join(root, "store", "artifacts"),
    result = [];
  function visit(target) {
    const stat = fs.lstatSync(target, { bigint: true });
    result.push({
      path: path.relative(base, target),
      identity: `${stat.dev}:${stat.ino}`,
      digest: stat.isFile()
        ? createHash("sha256").update(fs.readFileSync(target)).digest("hex")
        : null,
    });
    if (stat.isDirectory())
      for (const name of fs.readdirSync(target).sort())
        visit(path.join(target, name));
  }
  visit(base);
  return result;
}
describe.sequential(
  "signed local anchor prefix across original v2 processes",
  () => {
    let fixture, index, keys, initial, first, latest;
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(temp, "cc-rrsi-anchor-prefix-process-"));
      fixture = openObservedTextFixture(root);
      index = openObservedTextIndex(fixture);
      keys = generateKeyPairSync("ed25519");
      initial = inspectRrsiTenantIndexHistory({ observedTextIndex: index });
    }, 60_000);
    beforeAll(() => {
      registerPreparationPlan(fixture);
      reservePreparation(fixture);
    }, 60_000);
    beforeAll(() => {
      index.registerObservedSkillText(
        observationRequest(fixture, "# Retained process Skill\r\n"),
      );
      first = inspectRrsiTenantIndexHistory({ observedTextIndex: index });
    }, 60_000);
    beforeAll(() => {
      index.registerObservedSkillText(
        observationRequest(fixture, "# Retained process Skill\r\n", [
          "source-conflict",
        ]),
      );
      latest = inspectRrsiTenantIndexHistory({ observedTextIndex: index });
    }, 60_000);
    function packets(point = latest.current) {
      const previous = signHistoryAnchor(
        historyAnchorInput(index, initial.current, keys),
        keys,
      );
      const current = signHistoryAnchor(
        historyAnchorInput(index, point, keys, 2, previous.anchor.anchorDigest),
        keys,
      );
      return { previous, current };
    }
    it("reconstructs genuine local prefixes in a new process while preserving artifacts and denying external authority", () => {
      const head = fixture.store.journal.verify(),
        before = artifacts(),
        response = child("verify", packets());
      expect(response.error).toBeUndefined();
      expect(response.status, response.stderr).toBe(0);
      const result = JSON.parse(response.stdout);
      expect(result).toMatchObject({
        localJournalPrefixVerified: true,
        localRestrictionPrefixVerified: true,
        rootAuthorityVerified: false,
        routingPinVerified: false,
        storageGraphDigestVerified: false,
        tenantWideIndexAuthorityVerified: false,
        generationProvenanceVerified: false,
        historyTransferVerified: false,
        authenticated: false,
        decision: "HOLD",
        current: latest.current,
      });
      expect(result.localCompositionDigest).toBe(latest.localCompositionDigest);
      expect(fixture.store.journal.verify()).toEqual(head);
      expect(artifacts()).toEqual(before);
    }, 120_000);
    it("holds a captured proof after another real process authenticates a new event", () => {
      const captured = captureRrsiObservedTextIndex(
        index,
      ).captureHistoryCheckpoints({
        checkpoints: [first.current.checkpoint, latest.current.checkpoint],
      });
      const response = child("append");
      expect(response.error).toBeUndefined();
      expect(response.status, response.stderr).toBe(0);
      expect(JSON.parse(response.stdout).sequence).toBe(
        captured.snapshot.current.checkpoint.sequence + 1,
      );
      expect(() => captured.recheck()).toThrow(
        /head changed after prefix capture/,
      );
      latest = inspectRrsiTenantIndexHistory({ observedTextIndex: index });
      expect(latest.current.restrictionHistory).toEqual(
        captured.snapshot.current.restrictionHistory,
      );
    }, 120_000);
    it("rejects a fresh, valid signature that erases retained restrictions without appending or publishing", () => {
      const value = packets(),
        previous = value.previous;
      const input = historyAnchorInput(
        index,
        latest.current,
        keys,
        2,
        previous.anchor.anchorDigest,
      );
      input.restrictionHistory = {
        ...input.restrictionHistory,
        recordCount: 0,
        tailRecordDigest: null,
      };
      value.current = signHistoryAnchor(input, keys);
      const head = fixture.store.journal.verify(),
        before = artifacts(),
        response = child("verify", value);
      expect(response.error).toBeUndefined();
      expect(response.status).toBe(2);
      expect(JSON.parse(response.stderr)).toMatchObject({
        code: HOLD,
        message:
          "anchor restriction declaration differs from retained prefix history",
      });
      expect(fixture.store.journal.verify()).toEqual(head);
      expect(artifacts()).toEqual(before);
    }, 120_000);
  },
);
