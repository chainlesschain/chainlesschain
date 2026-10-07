import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  openObservedTextFixture,
  openObservedTextIndex,
  registerPreparationPlan,
  reservePreparation,
  observationRequest,
  scope,
} from "../fixtures/rrsi-observed-text.js";
import {
  RRSI_OBSERVED_TEXT_EVENT_TYPE,
  RRSI_OBSERVED_TEXT_HOLD_CODE as HOLD,
} from "../../src/lib/evolution/rrsi-observed-text-index.js";
import { captureRrsiHistoryLedgerAdapter } from "../../src/lib/evolution/rrsi-history-ledger-adapter.js";
import {
  rrsiCanonical,
  rrsiEnvelope,
  rrsiHash,
} from "../../src/lib/evolution/rrsi-data.js";
const parent = fs.realpathSync.native(os.tmpdir());
const roots = [];
const helper = fileURLToPath(
  new URL("../fixtures/rrsi-observed-text-process.mjs", import.meta.url),
);
const text = "\uFEFF# observed\r\n来源未知😀\r\n";
const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const context = {
  audience: scope.audience,
  purpose: "evolution-ledger",
  retention: "ledger",
};
function root() {
  const value = fs.mkdtempSync(path.join(parent, "cc-rrsi-text-controls-"));
  roots.push(value);
  return value;
}
function records(value) {
  return value.store.journal
    .read()
    .filter((event) => event.type === RRSI_OBSERVED_TEXT_EVENT_TYPE);
}
function snapshot(target) {
  const entries = [];
  function visit(value) {
    const stat = fs.lstatSync(value);
    entries.push({
      path: path.relative(target, value),
      id: `${stat.dev}:${stat.ino}`,
      bytes: stat.isFile() ? fs.readFileSync(value).toString("base64") : null,
    });
    if (stat.isDirectory())
      for (const name of fs.readdirSync(value).sort())
        visit(path.join(value, name));
  }
  visit(target);
  return entries;
}
afterAll(() => {
  vi.restoreAllMocks();
  for (const value of roots) {
    if (
      path.dirname(value) !== parent ||
      !path.basename(value).startsWith("cc-rrsi-text-controls-")
    )
      throw new Error("unsafe observed text controls cleanup");
    fs.rmSync(value, { recursive: true, force: true });
  }
}, 60_000);

describe.sequential("retained text controls on original v2 journal", () => {
  let value,
    index,
    initial,
    armed = false,
    fired = false;
  beforeAll(() => {
    value = openObservedTextFixture(root(), {
      fault(phase) {
        if (armed && !fired && phase === "after-head") {
          fired = true;
          throw new Error("TEST ONLY text commit response lost");
        }
      },
    });
  }, 60_000);
  beforeAll(() => registerPreparationPlan(value), 60_000);
  beforeAll(() => reservePreparation(value), 60_000);
  beforeAll(() => {
    index = openObservedTextIndex(value);
    initial = index.registerObservedSkillText(observationRequest(value, text));
  }, 60_000);
  it("reconstructs exact text and persistent restrictions in a fresh process", () => {
    const before = value.store.journal.verify();
    const child = spawnSync(
      process.execPath,
      [helper, value.root, initial.skillTextDigest],
      { encoding: "utf8", windowsHide: true, timeout: 90_000 },
    );
    expect(child.status, child.stderr).toBe(0);
    expect(child.error).toBeUndefined();
    const output = JSON.parse(child.stdout);
    expect(output.text).toBe(text);
    expect(output.restrictions).toMatchObject({
      decision: "HOLD",
      generationProvenanceVerified: false,
      tenantWideIndexAuthorityVerified: false,
      observedBytesAuthenticated: true,
    });
    expect(value.store.journal.verify()).toEqual(before);
  }, 120_000);
  it("retains restrictions after actual head response loss and retries the same operation without duplicating", () => {
    armed = true;
    expect(() =>
      index.registerObservedSkillText(
        observationRequest(value, text, ["source-conflict"]),
      ),
    ).toThrow(expect.objectContaining({ code: "CC_RRSI_TEXT_COMMIT_UNKNOWN" }));
    expect(fired).toBe(true);
    armed = false;
    const restored = openObservedTextIndex(value);
    const result = restored.inspectRestrictions(initial.skillTextDigest);
    expect(result.restrictions).toContain("source-conflict");
    expect(records(value)).toHaveLength(2);
    const before = value.store.journal.verify();
    restored.registerObservedSkillText(
      observationRequest(value, text, ["source-conflict"]),
    );
    expect(value.store.journal.verify()).toEqual(before);
    expect(records(value)).toHaveLength(2);
  }, 60_000);
  it("stops artifact publication after the operation owner is replaced", () => {
    const artifacts = path.join(value.root, "store", "artifacts");
    const before = snapshot(artifacts);
    const ownerPath = path.join(
      value.store.backend.descriptor.authorityRootDir,
      "rrsi-registry-store-policy-operations.lock",
      "owner.json",
    );
    const read = fs.readFileSync;
    let replacement;
    vi.spyOn(fs, "readFileSync").mockImplementation((target, ...args) => {
      const result = read(target, ...args);
      if (target === ownerPath && !replacement) {
        replacement = {
          ...JSON.parse(result),
          token: "TEST-only-new-text-index-owner",
        };
        fs.writeFileSync(ownerPath, JSON.stringify(replacement));
      }
      return result;
    });
    try {
      expect(() =>
        index.registerObservedSkillText(
          observationRequest(value, "new Skill text"),
        ),
      ).toThrow(expect.objectContaining({ code: "STATE_LOCK_OWNERSHIP_LOST" }));
    } finally {
      vi.restoreAllMocks();
    }
    expect(replacement).toBeDefined();
    expect(snapshot(artifacts)).toEqual(before);
    expect(JSON.parse(fs.readFileSync(ownerPath))).toEqual(replacement);
  }, 60_000);
});

describe.each(["noncanonical-base64", "wrong-length", "invalid-utf8"])(
  "signed malformed retained text: %s",
  (mode) => {
    let value, index;
    beforeAll(() => {
      value = openObservedTextFixture(root());
    }, 60_000);
    beforeAll(() => registerPreparationPlan(value), 60_000);
    beforeAll(() => reservePreparation(value), 60_000);
    beforeAll(() => {
      index = openObservedTextIndex(value);
    }, 60_000);
    it("holds even when envelopes and declaration references are genuinely authenticated", () => {
      const bytes =
        mode === "invalid-utf8"
          ? Buffer.from([0xed, 0xa0, 0x80])
          : Buffer.from("A");
      const chunk = value.store.artifactPorts.putCanonical(
        "rrsi-observed-text-chunk",
        {
          schema: "chainlesschain.rrsi-observed-text-chunk/v1",
          byteLength: bytes.length,
          chunkDigest: digest(bytes),
          bytesBase64:
            bytes.toString("base64") +
            (mode === "noncanonical-base64" ? "\n" : ""),
        },
        context,
      );
      const manifest = value.store.artifactPorts.putCanonical(
        "rrsi-observed-text-manifest",
        {
          schema: "chainlesschain.rrsi-observed-text-manifest/v1",
          skillTextDigest: digest(bytes),
          byteLength: bytes.length + (mode === "wrong-length" ? 1 : 0),
          chunks: [
            {
              ref: {
                schema: chunk.ref.schema,
                ref: chunk.ref.ref,
                digest: chunk.ref.digest,
              },
              byteLength: bytes.length,
              chunkDigest: digest(bytes),
            },
          ],
        },
        context,
      );
      const preparation = captureRrsiHistoryLedgerAdapter(
        value.history,
      ).resolvePreparation("prep-1");
      const association = {
        historyScopeId: value.history.descriptor.scopeId,
        goalId: value.campaign.goalId,
        campaignDigest: value.campaign.campaignDigest,
        executionId: "prep-1",
        historyDescriptor: value.history.descriptor,
        registrationRecord: preparation.registrationRecord,
      };
      const before = value.store.journal.verify();
      const head = Object.fromEntries(
        ["ledgerId", "identityDigest", "epoch", "sequence", "headDigest"].map(
          (key) => [key, before[key]],
        ),
      );
      const manifestRef = {
        schema: manifest.ref.schema,
        ref: manifest.ref.ref,
        digest: manifest.ref.digest,
      };
      const restrictions = ["generation-unverified", "rrsi-evidence-required"];
      const record = rrsiEnvelope(
        "chainlesschain.rrsi-content-restriction-event/v1",
        "recordDigest",
        {
          descriptor: index.descriptor,
          ordinal: 1,
          skillTextDigest: digest(bytes),
          manifestRef,
          association,
          restrictions,
          previousRecordDigest: null,
          observedHead: head,
        },
      );
      const published = value.store.artifactPorts.putCanonical(
        "rrsi-content-restriction-event",
        record,
        context,
      );
      value.store.journal.appendDomainEvent(
        {
          type: RRSI_OBSERVED_TEXT_EVENT_TYPE,
          eventId: `rrsi-text.${rrsiHash(record.schema, { skillTextDigest: record.skillTextDigest, association, restrictions }).slice(7)}`,
          tenantId: scope.tenantId,
          artifactTenantId: scope.artifactTenantId,
          correlationId: index.descriptor.indexId,
          skillName: null,
          decision: "quarantined",
          reason: "TEST ONLY authenticated malformed retained bytes",
          sourceRefs: [manifestRef, association.registrationRecord.ref],
          subjectRef: published.ref,
        },
        {
          expectedHeadDigest: head.headDigest,
          expectedSequence: head.sequence,
        },
      );
      const expectedFailure = expect.objectContaining({
        code: HOLD,
        ...(mode === "invalid-utf8"
          ? {
              cause: expect.objectContaining({
                code: "ERR_ENCODING_INVALID_ENCODED_DATA",
              }),
            }
          : {
              message:
                mode === "noncanonical-base64"
                  ? "text chunk bytes or digest differ"
                  : "text chunk order or actual length differs",
            }),
      });
      expect(() => index.readObservedText(digest(bytes))).toThrow(
        expectedFailure,
      );
      expect(() => openObservedTextIndex(value)).toThrow(expectedFailure);
      expect(records(value)).toHaveLength(1);
    }, 60_000);
  },
);

describe.sequential(
  "retained maximum size and malformed declaration controls",
  () => {
    let value, index, initial;
    const maximumText = Array.from({ length: 16 }, (_, index) =>
      String.fromCharCode(65 + index).repeat(64 * 1024),
    ).join("");
    beforeAll(() => {
      value = openObservedTextFixture(root());
    }, 60_000);
    beforeAll(() => registerPreparationPlan(value), 60_000);
    beforeAll(() => reservePreparation(value), 60_000);
    beforeAll(() => {
      index = openObservedTextIndex(value);
    }, 60_000);
    it("retains and reads back exactly 1 MiB using 16 bounded chunks", () => {
      initial = index.registerObservedSkillText(
        observationRequest(value, maximumText),
      );
      expect(initial.skillTextDigest).toBe(digest(Buffer.from(maximumText)));
      expect(index.readObservedText(initial.skillTextDigest)).toBe(maximumText);
      const manifest = JSON.parse(
        value.store
          .resolver({
            ledgerId: value.store.journal.verify().ledgerId,
            epoch: value.store.journal.verify().epoch,
            tenantId: scope.artifactTenantId,
            ref: initial.manifestRef,
          })
          .bytes.toString(),
      ).value;
      expect(manifest.byteLength).toBe(1024 * 1024);
      expect(manifest.chunks).toHaveLength(16);
      expect(
        manifest.chunks.every((entry) => entry.byteLength === 64 * 1024),
      ).toBe(true);
    }, 180_000);
    it("rejects an authenticated but self-inconsistent History association on reopening", () => {
      const prior = records(value).at(-1);
      const old = JSON.parse(
        value.store
          .resolver({
            ledgerId: prior.ledgerId,
            epoch: prior.epoch,
            tenantId: scope.artifactTenantId,
            ref: prior.subjectRef,
          })
          .bytes.toString(),
      ).value;
      const association = JSON.parse(rrsiCanonical(old.association));
      association.historyDescriptor.goalId = "forged-goal";
      const current = value.store.journal.verify();
      const head = Object.fromEntries(
        ["ledgerId", "identityDigest", "epoch", "sequence", "headDigest"].map(
          (key) => [key, current[key]],
        ),
      );
      const record = rrsiEnvelope(
        "chainlesschain.rrsi-content-restriction-event/v1",
        "recordDigest",
        {
          descriptor: old.descriptor,
          ordinal: 2,
          skillTextDigest: old.skillTextDigest,
          manifestRef: old.manifestRef,
          association,
          restrictions: old.restrictions,
          previousRecordDigest: old.recordDigest,
          observedHead: head,
        },
      );
      const published = value.store.artifactPorts.putCanonical(
        "rrsi-content-restriction-event",
        record,
        context,
      );
      value.store.journal.appendDomainEvent(
        {
          type: RRSI_OBSERVED_TEXT_EVENT_TYPE,
          eventId: `rrsi-text.${rrsiHash(record.schema, { skillTextDigest: record.skillTextDigest, association, restrictions: record.restrictions }).slice(7)}`,
          tenantId: scope.tenantId,
          artifactTenantId: scope.artifactTenantId,
          correlationId: index.descriptor.indexId,
          skillName: null,
          decision: "quarantined",
          reason: "TEST ONLY signed semantic association corruption",
          sourceRefs: [
            old.manifestRef,
            association.registrationRecord.ref,
            {
              schema: prior.subjectRef.schema,
              ref: prior.subjectRef.ref,
              digest: prior.subjectRef.digest,
            },
          ],
          subjectRef: published.ref,
        },
        {
          expectedHeadDigest: head.headDigest,
          expectedSequence: head.sequence,
        },
      );
      expect(() => index.inspectRestrictions(initial.skillTextDigest)).toThrow(
        expect.objectContaining({ code: HOLD }),
      );
      expect(() => openObservedTextIndex(value)).toThrow(
        expect.objectContaining({ code: HOLD }),
      );
      expect(records(value)).toHaveLength(2);
    }, 60_000);
  },
);
